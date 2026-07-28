from app.enrollment.llm.keys import get_key, release_key
from app.enrollment.llm.prompt import SYSTEM_PROMPT
from app.enrollment.schema import OCRResponse
from flask import current_app
from google import genai
import time


class AllKeysExhausted(Exception):
    pass


class LLMExtractionFailed(Exception):
    pass


MODEL_NAME = "gemini-3.5-flash"


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

        except Exception as e:
            print("Gemini client raised an exception: ", str(e))
            last_error = e
            err = str(e).lower()
            if logger:
                logger.info(f"Gemini attempt {attempt} failed: {e}")

            if "429" in err or "quota" in err:
                print("Error cuaght in 429 path")
                release_key(current_api_key, to_cool=True)
                time.sleep(1)
                continue
            elif any(s in err for s in ("ssl", "eof", "503", "unavailable")):
                release_key(current_api_key)
                attempt += 1
                time.sleep(2**attempt)
                continue
            else:
                release_key(current_api_key)
                raise

    raise ValueError(f"Max retries exceeded: {last_error}")
