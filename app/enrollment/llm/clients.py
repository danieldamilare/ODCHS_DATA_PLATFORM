from app.enrollment.llm.keys import get_key, release_key
from app.enrollment.llm.prompt import SYSTEM_PROMPT
from app.enrollment.schema import OCRResponse
from google import genai
from time import perf_counter
from pydantic import ValidationError
from google.genai import types
from app import kv
import json


from PIL import Image
import time
import traceback


class AllKeysExhausted(Exception):
    pass


class LLMExtractionFailed(Exception):
    pass

class ServerConnectionError(Exception):
    pass

GEMINI_CIRCUIT = "Gemini:circuit_breaker"
MODEL_NAME = "gemini-3.5-flash"

SUCCESS_COOLDOWN_SECONDS = 10

RATE_LIMIT_COOLDOWN_SECONDS = 70

TRANSIENT_COOLDOWN_SECONDS = 10


def gemini_client(image_path: str, max_retries: int = 4) -> OCRResponse:
    if kv.get(GEMINI_CIRCUIT):
        raise ServerConnectionError("Server is currently down. Gently waiting")
    last_error = None
    attempt = 0

    config = types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT,
        temperature=0,
        candidate_count=1,
        response_mime_type="application/json",
        response_schema=OCRResponse,
    )

    img = Image.open(image_path)
    all_server_error_count = 0

    while attempt <= max_retries:
        current_api_key = get_key()

        if current_api_key is None:
            raise AllKeysExhausted()  

        released = False
        try:
            client = genai.Client(api_key=current_api_key)
            t0 = perf_counter()
            response = client.models.generate_content(
                model=MODEL_NAME,
                contents=[img, "Extract data from the image"],
                config=config,
            )
            print(f"Gemini call took {perf_counter() - t0:.3f}s")

            release_key(current_api_key, to_cool=True, cooldown_time=SUCCESS_COOLDOWN_SECONDS)
            released = True

            if not response.text:
                last_error = "Empty response text from Gemini"
                attempt += 1
                time.sleep(1)
                continue

            try:
                return OCRResponse.model_validate_json(response.text)
            except (ValidationError, json.JSONDecodeError) as e:
                last_error = e
                attempt += 1
                time.sleep(1)
                continue

        except Exception as e:
            last_error = e
            err_text = str(e).lower()

            if "429" in err_text or "quota" in err_text or "rate limit" in err_text:
                release_key(current_api_key, to_cool=True, cooldown_time=RATE_LIMIT_COOLDOWN_SECONDS)
                released = True
                time.sleep(1)
                continue 

            elif any(s in err_text for s in ("ssl", "eof", "503", "unavailable", "timeout", "connection")):
                all_server_error_count +=1
                release_key(current_api_key, to_cool=True, cooldown_time=TRANSIENT_COOLDOWN_SECONDS)
                released = True
                attempt += 1
                time.sleep(2 ** (attempt+1))
                continue

            else:
                print("Unhandled Gemini error: ", e, traceback.format_exc())
                release_key(current_api_key, to_cool=True, cooldown_time=TRANSIENT_COOLDOWN_SECONDS)
                released = True
                raise

        finally:
            if not released:
                release_key(current_api_key, to_cool=True, cooldown_time=TRANSIENT_COOLDOWN_SECONDS)

    if all_server_error_count > (max_retries * 0.60):
        kv.setex(GEMINI_CIRCUIT, 360, "Server error")
        raise  ServerConnectionError("Gemini server is unstable")
    raise LLMExtractionFailed(f"Max retries exceeded: {last_error}")
