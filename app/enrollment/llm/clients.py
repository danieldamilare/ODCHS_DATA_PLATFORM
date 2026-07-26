from app.enrollment.llm.keys import get_key, release_key
from app.enrollment.llm.prompt import SYSTEM_PROMT
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

    for attempt in range(max_retries + 1):
        current_api_key = get_key()
        print("Gemini successfully acquired key: ", current_api_key)
        if current_api_key is None:
            raise AllKeysExhausted()
        try:
            client = genai.Client(api_key=current_api_key)
            uploaded_file = client.files.upload(file=image_path)
            response = client.interactions.create(
                model=MODEL_NAME,
                system_instruction=SYSTEM_PROMT,
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
                release_key(current_api_key, to_cool=True)
                if current_api_key is None:
                    # every key currently exhausted/cooling down — don't burn retries spinning
                    raise AllKeysExhausted(
                        "All API keys exhausted or cooling down"
                    ) from e
                continue
            elif any(s in err for s in ("ssl", "eof", "503", "unavailable")):
                release_key(current_api_key)
                time.sleep(2**attempt)
                continue
            else:
                release_key(current_api_key)
                raise

    raise ValueError(f"Max retries exceeded: {last_error}")
