import requests
from requests.adapters import HTTPAdapter
from app import kv
import time
from typing import Tuple, Optional, Dict, Any
from app.nin_validation.nin_limiter import ACQUIRE_SCRIPT, RELEASE_SCRIPT, NoSlotAvailable
from tenacity import (
    retry,
    stop_after_attempt,
    retry_if_exception_type,
    wait_exponential,
    wait_random,
)
from datetime import date
from dataclasses import dataclass
from redis.exceptions import LockError
import contextlib
import uuid

_client = None


@dataclass
class NINValidationResult:
    success: bool
    msg: str
    payload: Optional[Dict] = None
    sys_err: bool = False
    retry: bool = False


class NINServerError(Exception):
    pass


class NINValidatorError(Exception):
    pass


def count_retries_token(retry_state):
    client = retry_state.args[0]
    client.kv.hincrby(client.client_id, "total_token_retries", 1)


def count_retries_request(retry_state):
    client = retry_state.args[0]
    client.kv.hincrby(client.client_id, "total_request_retries", 1)


class NINClient:
    def __init__(
        self,
        nin_url,
        nin_validate_url,
        nin_server_token_url,
        nin_origin,
        max_slot = 3,
        request_ttl = 45_000
    ):
        self.session = requests.Session()
        adapter = HTTPAdapter(pool_connections=15, pool_maxsize=25, max_retries=2)
        self.session.mount("http://", adapter)
        self.session.mount("https://", adapter)
        self.nin_url = nin_url
        self.nin_validate_url = nin_validate_url
        self.nin_server_token_url = nin_server_token_url
        self.token_key = "nin_token"
        self.lock_key = "nin_token_lock"
        self.slots = "nin:slot"
        self.max_slot = max_slot
        self.kv = kv
        self.request_ttl = request_ttl
        # originally thought ttl is 5 minutes, benchmark shows it is something around 100s
        self.token_ttl = 90
        self.acquire_script = self.kv.register_script(ACQUIRE_SCRIPT)
        self.release_script = self.kv.register_script(RELEASE_SCRIPT)
        self.base_header: Dict = {
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-GB,en;q=0.9",
            "Content-Type": "application/json",
            "application_crest": "",
            "Origin": nin_origin,
            "Referer": self.nin_url,
            "DNT": "1",
            "sec-ch-ua": '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Linux"',
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin",
        }
        self.client_id = str(uuid.uuid4())
        self.kv.hset(
            self.client_id,
            mapping={
                "total_request": 0,
                "total_request_retries": 0,
                "total_error": 0,
                "token_refresh": 0,
                "token_error": 0,
                "total_token_retries": 0,
            },
        )

    @contextlib.contextmanager
    def acquire_slot(self):
        # print("Acquiring")
        got = self.acquire_script(keys=[self.slots], args=[self.request_ttl, self.max_slot])
        if not got:
            raise NoSlotAvailable("all NIN Slots leased")
        slot, fence = got[0], got[1]
        try: 
            yield slot
        finally:
            # print("releasing")
            self.release_script(keys=[self.slots], args=[slot, fence])


    def get_token(self) -> Tuple[str | None, float | None]:
        raw = self.kv.hgetall(self.token_key)
        if raw:
            return raw["token"], float(raw["fetched_at"])
        return None, None

    def set_token(self, token: str, fetched_at: float):
        self.kv.hset(self.token_key, mapping={"token": token, "fetched_at": fetched_at})

    def fetch_valid_token(self) -> str | None:
        token, fetched_at = self.get_token()
        if fetched_at and (time.time() - fetched_at) < self.token_ttl:
            return token
        return None

    # get token has its own iternal retry to avoid post retry loop
    @retry(
        stop=stop_after_attempt(4),
        wait=wait_exponential(1, 3, 10),
        retry=retry_if_exception_type((IOError)),
        reraise=True,
        before_sleep=count_retries_token,
    )
    @retry(
        stop=stop_after_attempt(4),
        wait=wait_random(1, 2),
        retry=retry_if_exception_type(NoSlotAvailable),
        reraise=True
    )
    def _set_token_from_server(self):
        # t0 = time.perf_counter()
        with self.acquire_slot():
            # t1 = time.perf_counter()
            response = self.session.post(
                self.nin_server_token_url,
                json={},
                headers=self.base_header.copy(),
                timeout=20,
            )
        # t2 = time.perf_counter()
        # print(
        #     f"acquire={1000*(t1-t0):.2f}ms "
        #     f"http={1000*(t2-t1):.2f}ms")
        try:
            if response.ok:
                bearer_token = response.json().get("bearerToken")
                self.set_token(bearer_token, time.time())
                self.kv.hincrby(self.client_id, "token_refresh", 1)
                return
            raise ValueError("Invalid Response from server")
        except Exception as e:
            self.kv.hincrby(self.client_id, "token_error", 1)
            raise IOError from e

    def refresh_expired_token(self, current_token=None):
        try:
            with self.kv.lock(self.lock_key, timeout=60, blocking_timeout=15):
                if current_token is not None:
                    new_token, _ = self.get_token()
                    if new_token != current_token:
                        return new_token
                try:
                    self._set_token_from_server()
                    return self.fetch_valid_token()
                except Exception as e:
                    raise NINValidatorError from e
        except LockError:
            return self.fetch_valid_token()

    def refresh_token(self):
        if token := self.fetch_valid_token():
            return token

        try:
            with self.kv.lock(self.lock_key, timeout=60, blocking_timeout=15):
                if token := self.fetch_valid_token():
                    return token
                try:
                    self._set_token_from_server()
                    return self.fetch_valid_token()
                except NoSlotAvailable as e:
                    raise e
                except Exception as e:
                    raise NINValidatorError from e
        except LockError:
            return self.fetch_valid_token()

    def _build_payload(self, d: str, m: str, y: str, nin: str):
        payload = {
            "applyingFor": "FRESH",
            "dateOfBirth": f"{d}/{m}/{y}",
            "dateOfBirthDay": str(int(d)),
            "dateOfBirthMonth": f"0{m}" if len(m) == 1 else m,
            "dateOfBirthYear": y,
            "nin": nin.strip(),
        }
        return payload

    @retry(
        stop=stop_after_attempt(4),
        wait=wait_exponential(1, min=2, max=10) + wait_random(0.1, 0.6),
        retry=retry_if_exception_type((NINValidatorError, NINServerError)),
        reraise=True,
        before_sleep=count_retries_request,
    )
    @retry(
        stop=stop_after_attempt(4),
        wait=wait_random(1, 2),
        retry=retry_if_exception_type(NoSlotAvailable),
        reraise=True
    )
    def post_request(
        self, url: str, json_data: Optional[Dict[str, Any]] = None, timeout=20
    ) -> Any:
        json_data = json_data or {}
        request_headers = self.base_header.copy()

        fresh_token = self.fetch_valid_token()
        if not fresh_token:
            fresh_token = self.refresh_token()

        request_headers["application_crest"] = fresh_token

        try:
            # t0 = time.perf_counter()
            with self.acquire_slot():
                # t1 = time.perf_counter()
                response = self.session.post(
                    url, json=json_data, headers=request_headers, timeout=timeout
                )
            # t2 = time.perf_counter()

            # print(
                # f"acquire={1000*(t1-t0):.2f}ms "
                # f"http={1000*(t2-t1):.2f}ms")

            text = response.text.lower()
            headers = response.headers
            is_expired_text = "expired" in text or "unauthorized" in text
            is_html_error = "text/html" in headers.get("Content-Type", "").lower()
            self.kv.sadd(
                f"{self.client_id}:messages",
                f"{response.status_code}:{response.text[:200]}",
            )
            if is_expired_text:
                self.refresh_expired_token(fresh_token)

            self.kv.hincrby(
                f"{self.client_id}:error_code", f"error:{response.status_code}"
            )

            if is_expired_text or response.status_code != 200 or is_html_error:
                self.kv.hincrby(self.client_id, "total_error", 1)
                raise NINValidatorError(
                    "Error occured while validating NIN. This can be a server error or session expiry error"
                )
            self.kv.hincrby(self.client_id, "total_request", 1)
            return response.json()
        except (
            requests.exceptions.ConnectionError,
            requests.exceptions.Timeout,
            requests.exceptions.RequestException,
        ) as e:
            raise NINServerError(str(e))

    def build_payload_from_dob(self, dob: date, nin: str):
        parsed_dob = dob.strftime("%d/%m/%Y")
        d, m, y = parsed_dob.strip().split("/")
        payload1 = self._build_payload(d, m, y, nin)
        payload2 = None
        if int(d) <= 12:
            payload2 = self._build_payload(m, d, y, nin)
        to_process = [x for x in (payload1, payload2) if x]
        return to_process

    def validate_nin(self, dob: date, nin: str) -> NINValidationResult:
        try:
            to_process = self.build_payload_from_dob(dob, nin)
            last_result = None
            had_sys_error = False

            for payload in to_process:
                try:
                    result = self.post_request(self.nin_validate_url, json_data=payload)
                    if result.get("responseCode", 0) == 200:
                        return NINValidationResult(
                            True, result.get("responseMsg", "Successfully verified NIN"),
                            payload=result.get("details"),
                        )
                    last_result = result                    
                except (NINServerError, NINValidatorError):
                    had_sys_error = True                    

            if had_sys_error:
                return NINValidationResult(False, "NIN server error", sys_err=True)
            if last_result:
                return NINValidationResult(
                    False, last_result.get("responseMsg", "NIN Validation failed"),
                    payload=last_result,
                )
            return NINValidationResult(False, "NIN server error", sys_err=True)
        except NoSlotAvailable:
            return NINValidationResult(False, "Server Overload.Please Retry", sys_err=True, retry=True)
        except Exception:
            return NINValidationResult(False, "Server Error while Validating", sys_err=True)
    
def load_nin_client():
    from flask import current_app

    global _client
    if _client is not None:
        return _client
    _client = NINClient(
        current_app.config["NIN_SERVER_URL"],
        current_app.config["NIN_VALIDATE_URL"],
        current_app.config["NIN_SERVER_TOKEN_URL"],
        current_app.config["NIN_ORIGIN"],
    )
    return _client
