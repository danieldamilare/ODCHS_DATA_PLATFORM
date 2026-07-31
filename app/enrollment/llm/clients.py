from app.enrollment.llm.keys import get_key, release_key
from app.enrollment.llm.prompt import SYSTEM_PROMPT
from app.enrollment.schema import OCRResponse
from app.logger import logger as w_logger
from flask import current_app
from google import genai
from time import perf_counter


from google.genai._gaos.lib.compat_errors import (
    RateLimitError,
    APIStatusError,
    APIError,
)


import httpx
import time
import traceback


class AllKeysExhausted(Exception):
    pass


class LLMExtractionFailed(Exception):
    pass


MODEL_NAME = "gemini-3.6-flash"

SUCCESS_COOLDOWN_SECONDS = 10

RATE_LIMIT_COOLDOWN_SECONDS = 70

TRANSIENT_COOLDOWN_SECONDS = 10


def gemini_client(image_path: str, logger=None, max_retries=4) -> OCRResponse:
    last_error = None
    attempt = 0
    keys_tried = 0

    while attempt <= max_retries:
        current_api_key = get_key()
        w_logger.info("Gemini successfully acquired key: ", current_api_key)

        if current_api_key is None:
            raise AllKeysExhausted()

        keys_tried += 1
        released = False

        try:
            client = genai.Client(api_key=current_api_key)
            t0 = perf_counter()
            uploaded_file = client.files.upload(file=image_path)
            w_logger.debug(f"Upload file time: {perf_counter() - t0:.3f}s")
            t0 = perf_counter()
            response = client.interactions.create(
                model=MODEL_NAME,
                system_instruction=SYSTEM_PROMPT,
                response_format={
                    "type": "text",
                    "mime_type": "application/json",
                    "schema": OCRResponse.model_json_schema(),
                },
                input=[
                    {"type": "text", "text": "Extract data from the image"},
                    {
                        "type": "image",
                        "uri": uploaded_file.uri,
                        "mime_type": uploaded_file.mime_type,
                    },
                ],
            )
            w_logger.debug(f"Interaction time  time: {perf_counter() - t0:.3f}s")
            w_logger.debug("Gemini sent response text: ", response.output_text)

            release_key(
                current_api_key, to_cool=True, cooldown_time=SUCCESS_COOLDOWN_SECONDS
            )
            released = True

            try:
                return OCRResponse.model_validate_json(response.output_text)
            except (ValidationError, json.JSONDecodeError) as e:
                w_logger.error(f"OCR schema validation failed: {e}")
                last_error = e
                attempt += 1
                time.sleep(1)
                continue

        except RateLimitError as e:
            w_logger.error(f"Rate limit hit, cooling key: {e}")
            last_error = e
            try:
                body = (
                    getattr(e, "response", None)
                    or getattr(e, "body", None)
                    or getattr(e, "args", None)
                )
                w_logger.error(f"RAW 429 BODY: {body!r}")
                w_logger.error(f"RAW 429 ATTRS: {vars(e)!r}")
            except Exception as inspect_err:
                w_logger.error(f"Could not introspect error: {inspect_err}")
            release_key(
                current_api_key,
                to_cool=True,
                cooldown_time=RATE_LIMIT_COOLDOWN_SECONDS,
            )
            released = True
            time.sleep(1)
            continue

        except APIStatusError as e:
            status_code = getattr(e, "status_code", None) or getattr(e, "code", None)
            w_logger.error(f"Gemini API status error encountered (status={status_code}): {e}")
            last_error = e

            if status_code is not None and 500 <= int(status_code) < 600:
                release_key(
                    current_api_key,
                    to_cool=True,
                    cooldown_time=TRANSIENT_COOLDOWN_SECONDS,
                )
                released = True
                attempt += 1
                time.sleep(2**attempt)
                continue
            else:
                release_key(
                    current_api_key,
                    to_cool=True,
                    cooldown_time=TRANSIENT_COOLDOWN_SECONDS,
                )
                released = True
                raise

        except APIError as e:
            w_logger.error(f"Gemini API error encountered: {e}")
            last_error = e
            release_key(
                current_api_key, to_cool=True, cooldown_time=TRANSIENT_COOLDOWN_SECONDS
            )
            released = True
            attempt += 1
            time.sleep(2**attempt)
            continue

        except (httpx.TimeoutException, httpx.NetworkError) as e:
            w_logger.error(f"Network transport error encountered: {e}")
            last_error = e
            release_key(
                current_api_key, to_cool=True, cooldown_time=TRANSIENT_COOLDOWN_SECONDS
            )
            released = True
            attempt += 1
            time.sleep(2**attempt)
            continue

        except Exception as e:
            w_logger.error(f"Generic Error, all catch for {e}")
            traceback.print_exc()
            last_error = e
            release_key(
                current_api_key, to_cool=True, cooldown_time=TRANSIENT_COOLDOWN_SECONDS
            )
            released = True
            raise

        finally:
            if not released:
                release_key(
                    current_api_key,
                    to_cool=True,
                    cooldown_time=TRANSIENT_COOLDOWN_SECONDS,
                )

    raise ValueError(f"Max retries exceeded: {last_error}")
