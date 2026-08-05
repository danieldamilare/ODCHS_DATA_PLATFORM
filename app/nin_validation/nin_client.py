import requests
from requests.adapters import HTTPAdapter
from app import kv
import time
from typing import Tuple, Optional, Dict, Any
from tenacity import (
    retry,
    stop_after_attempt,
    retry_if_exception_type,
    wait_exponential,
)
from datetime import date
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from redis.exceptions import LockError

_client = None



@dataclass
class NINValidationResult:
    success: bool
    msg: str
    payload: Optional[Dict] = None
    sys_err: bool = False

class NINServerError(Exception):
    pass

class  NINValidatorError(Exception):
    pass

def refresh_token_help(retry_state):
    print("Tenacity forcing refreshing token")
    if retry_state.args:
        client = retry_state.args[0]
        client.refresh_token(force=True)

class NINClient:
    def __init__(self, nin_url, nin_validate_url, nin_server_token_url, nin_origin, ):
        # print(nin_url, nin_validate_url, nin_server_token_url, nin_origin)
        self.session = requests.Session()
        adapter = HTTPAdapter(pool_connections=15, pool_maxsize=25, max_retries=4)
        self.session.mount("http://", adapter)
        self.session.mount("https://", adapter)
        self.nin_url = nin_url
        self.nin_validate_url = nin_validate_url
        self.nin_server_token_url = nin_server_token_url
        self.token_key = "nin_token"
        self.lock_key = "nin_token_lock"
        self.kv = kv
        #original thought ttl is 5 minutes, benchmark shows it is something around 100s
        self.token_ttl = 90 
        self.refresh_grace_period = 10
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
        # print(self.base_header)


    def get_token(self) -> Tuple[str | None, float | None]:
        raw = self.kv.hgetall(self.token_key)
        if raw:
            return raw["token"], float(raw["fetched_at"])
        return None, None

    def set_token(self, token: str, fetched_at: float):
        # print("Set Token Entered ")
        self.kv.hset(
            self.token_key, mapping={"token": token, "fetched_at": fetched_at}
        )

    def fetch_valid_token(self) -> str | None:
        token, fetched_at = self.get_token()
        # print("valid token", token, fetched_at)
        if fetched_at and (time.time() - fetched_at) < self.token_ttl:
            return token
        return None

    #get token has its own iternal retry to avoid post retry loop
    @retry(
                stop=stop_after_attempt(4),
                wait=wait_exponential(1, 3, 10),
                retry=retry_if_exception_type(IOError),
                reraise=True,
        )
    def _set_token_from_server(self):
        # print("server_token", self.nin_server_token_url)
        response = self.session.post(
            self.nin_server_token_url, json={}, headers=self.base_header.copy(), timeout=20
        )
        # print("_set_token_response_text: response text", response.text)
        try:
            if response.ok:
                bearer_token = response.json().get("bearerToken")
                # print("bearer_token", bearer_token)
                self.set_token(bearer_token, time.time())
                return
            raise ValueError("Invalid Response from server")
        except Exception as e:
            raise IOError from e

    
    def refresh_token(self, force=False):
        # print("[refresh_token] entered")
        if (token := self.fetch_valid_token()) and not force:
            # print("[refresh_token] cache hit")
            return token

        try:
            #benchmark shows this is ignoring the force = True. I should probably check the token time to be less than 20s
            with self.kv.lock(self.lock_key, timeout=60, blocking_timeout=15):
                # a simple way to prevent cache stampede
                token, fetched_at = self.get_token()
                if fetched_at and time.time() - fetched_at <= self.refresh_grace_period:
                    return token
                try:
                    self._set_token_from_server()
                    return self.fetch_valid_token()
                except Exception as e:
                    raise NINValidatorError from e
        except LockError:
            return None

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
            wait=wait_exponential(1, 5, 20),
            retry=retry_if_exception_type((NINValidatorError, NINServerError)),
            before_sleep=refresh_token_help,
            reraise=True,
    )
    def post_request(
        self,
        url: str,
        json_data: Optional[Dict[str, Any]] = None,
        timeout = 20
    ) -> Any:
        json_data = json_data or {}
        request_headers = self.base_header.copy()
        fresh_token = self.fetch_valid_token()
        if not fresh_token:
            fresh_token = self.refresh_token()
        request_headers['application_crest'] = fresh_token

        try:
            response = self.session.post(url, json=json_data, headers=request_headers, timeout=timeout)
            text = response.text.lower()
            headers = response.headers
            is_expired_text = "expired" in text or "unauthorized" in text
            is_html_error = "text/html" in headers.get("Content-Type", "").lower()
            if (
                is_expired_text 
                or response.status_code != 200
                or is_html_error 
            ):
                print("error", text)
                token, fetched_at = self.get_token()
                # print(f"Token: {token}, Token lifetime: {time.time() - fetched_at}")
                raise NINValidatorError("Error occured while validating NIN. This can be a server error or session expiry error")
            return response.json()
        except (
            requests.exceptions.ConnectionError,
            requests.exceptions.Timeout,
            requests.exceptions.RequestException
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
            exception_stack = []
            invalid_nin_payloads = []
            with ThreadPoolExecutor(max_workers=2) as executor:
                futures = {executor.submit(self.post_request, 
                                           self.nin_validate_url,
                                           json_data = payload,
                                           ): payload  for payload in to_process}
                for future in as_completed(futures)             :
                    try:
                        result = future.result()
                        if result.get("responseCode", 0) == 200:
                            return NINValidationResult(
                                success=True,
                                msg= result.get("responseMsg", "Successfully verified NIN"),
                                payload=result
                            )
                        else:
                            invalid_nin_payloads.append(result)
                    except Exception as e:
                        exception_stack.append(e)

            if invalid_nin_payloads:
                cur = invalid_nin_payloads.pop()
                return  NINValidationResult(
                    success = False,
                    msg  = cur.get("responseMsg", "NIN Validation failed"),
                    payload = cur,
                )
            if exception_stack:
                err = exception_stack.pop() #pick the last error anyone can work
                if isinstance(err, NINServerError):
                    return NINValidationResult(
                        success = False,
                        msg = str(err)[:300],
                    )
                elif isinstance(err, NINValidatorError):
                    return NINValidationResult(
                        success=False,
                        msg=  str(err)[:300]
                    )
                else:
                    return NINValidationResult(
                        success=False,
                        msg= str(err)[:300],
                        sys_err=True
                    )
            return NINValidationResult(success=False, msg="System Error", sys_err=True)
        except Exception as e:
            return NINValidationResult(
                success=False,
                msg= str(e)[:300],
                sys_err=True
            )


def load_nin_client():
    from flask import current_app
    global _client
    if _client is not None:
        return _client
    _client = NINClient(
        current_app.config["NIN_SERVER_URL"],
        current_app.config["NIN_VALIDATE_URL"],
        current_app.config["NIN_SERVER_TOKEN_URL"],
        current_app.config["NIN_ORIGIN"])
    return _client
