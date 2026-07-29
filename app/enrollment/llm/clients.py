from app.enrollment.llm.keys import get_key, release_key
from app.enrollment.llm.prompt import SYSTEM_PROMPT
from app.enrollment.schema import OCRResponse
from flask import current_app
from google import genai
from google.genai.errors import ClientError, ServerError
import httpx
import time


class AllKeysExhausted(Exception):
    pass


class LLMExtractionFailed(Exception):
    pass


MODEL_NAME = "gemini-3.6-flash"


def gemini_client(image_path: str, logger=None, max_retries=4) -> OCRResponse:
    print("Gemini recieved image path: ", image_path)
    last_error = None
    attempt = 0
    keys_tried = 0

    while attempt <= max_retries:
        current_api_key = get_key()
        print("Gemini successfully acquired key: ", current_api_key)
        if current_api_key is None:
            raise AllKeysExhausted()
        keys_tried += 1

        try:
            client = genai.Client(api_key=current_api_key)
            uploaded_file = client.files.upload(file=image_path)
            print("Successfully uploaded file about to create interaction")
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
            print("Gemini sent response text: ", response.output_text)
            release_key(current_api_key)
            return OCRResponse.model_validate_json(response.output_text)

        except ClientError as e:
            print(f"Gemini Client Error encountered: {e}")
            last_error = e

            status_code = getattr(e, "code", None)

            if status_code == 429 or "429" in str(e) or "quota" in str(e).lower():
                print("Rate limit hit, cooling key...")
                release_key(current_api_key, to_cool=True)
                time.sleep(1)
                continue
            else:
                release_key(current_api_key)
                raise

        except ServerError as e:
            print(f"Gemini Server Error encountered: {e}")
            last_error = e

            release_key(current_api_key)
            attempt += 1
            time.sleep(2**attempt)
            continue

        except (httpx.TimeoutException, httpx.NetworkError) as e:
            print(f"Network transport error encountered: {e}")
            last_error = e

            release_key(current_api_key)
            attempt += 1
            time.sleep(2**attempt)
            continue

        except Exception as e:
            release_key(current_api_key)
            raise
    raise ValueError(f"Max retries exceeded: {last_error}")
