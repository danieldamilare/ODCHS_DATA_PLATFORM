import os
import json
import traceback
from time import perf_counter

from google import genai
from google.genai import types
from pydantic import ValidationError
from PIL import Image
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
    retry_if_exception,
    before_sleep_log,
)
import logging

from app.enrollment.llm.prompt import SYSTEM_PROMPT
from app.enrollment.schema import OCRResponse
from app import kv
from flask import current_app

logger = logging.getLogger(__name__)

GEMINI_CIRCUIT = "Gemini:circuit_breaker"
CIRCUIT_BREAKER_SECONDS = 180

MODEL_NAME = "gemini-3.5-flash-lite"


class LLMExtractionFailed(Exception):
    pass


class ServerConnectionError(Exception):
    pass


class RateLimitExceeded(Exception):
    """Raised when retries are exhausted specifically due to 429/quota errors.
    Distinct from LLMExtractionFailed so callers (e.g. the celery task) can
    retry later instead of treating it as a permanent per-form failure."""

    pass


def _is_transient(exc: BaseException) -> bool:
    err_text = str(exc).lower()
    return any(
        s in err_text
        for s in ("ssl", "eof", "503", "unavailable", "timeout", "connection")
    )


def _is_rate_limited(exc: BaseException) -> bool:
    err_text = str(exc).lower()
    return "429" in err_text or "quota" in err_text or "rate limit" in err_text


def _is_retryable(exc: BaseException) -> bool:
    return _is_transient(exc) or _is_rate_limited(exc)


def _get_gemini_keys() -> list[str]:
    """Retrieve and sanitize comma-separated API keys from config/env."""
    raw_keys = ""
    try:
        raw_keys = current_app.config.get("GEMINI_API_KEY", "")
    except RuntimeError:
        raw_keys = os.getenv("GEMINI_API_KEY", "")
    keys = [k.strip() for k in raw_keys.split(",") if k.strip()]
    return keys if keys else [""]

@retry(
    stop=stop_after_attempt(5),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    retry=(
        retry_if_exception_type(
            (ValidationError, json.JSONDecodeError, LLMExtractionFailed)
        )
        | retry_if_exception(_is_retryable)
    ),
    before_sleep=before_sleep_log(logger, logging.WARNING),
    reraise=True,
)
def _call_gemini(image_path: str, gemini_key) -> OCRResponse:
    if kv.get(GEMINI_CIRCUIT):
        raise ServerConnectionError("Server is currently down. Gently waiting")

    client = genai.Client(
        api_key=gemini_key,
        http_options=types.HttpOptions(timeout=120000),
    )
    config = types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT,
        temperature=0,
        candidate_count=1,
        response_mime_type="application/json",
        response_schema=OCRResponse,
    )

    with Image.open(image_path) as img:
        t0 = perf_counter()
        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=[img, "Extract data from the image"],
            config=config,
        )
        print(f"Gemini call took {perf_counter() - t0:.3f}s")

    if not response.text:
        raise LLMExtractionFailed("Empty response text from Gemini")

    try:
        return OCRResponse.model_validate_json(response.text)
    except (ValidationError, json.JSONDecodeError):
        raise


def gemini_client(image_path: str) -> OCRResponse:
    if kv.get(GEMINI_CIRCUIT):
        raise ServerConnectionError("Server is currently down. Gently waiting")
    
    keys = _get_gemini_keys()
    last_exception = None
    for idx, gemini_key in enumerate(keys,1):
        try:
            print(f"Attempting Gemini extraction using key {idx}/{len(keys)} (model: {MODEL_NAME})")
            return _call_gemini(image_path, gemini_key)
        except Exception as e:
            last_exception = e
            err_text = str(e).lower()

            if any(
                s in err_text
                for s in ("ssl", "eof", "503", "unavailable", "timeout", "connection", "server")
            ):
                kv.setex(GEMINI_CIRCUIT, CIRCUIT_BREAKER_SECONDS, "Server error")
                raise ServerConnectionError(f"Gemini server is unstable: {e}") from e

            print("Gemini extraction failed: ", e, traceback.format_exc())
            print(
                f"Key {idx}/{len(keys)} ({MODEL_NAME}) exhausted all 5 retries: {e}. "
                f"{'Switching to next key...' if idx < len(keys) else 'No more keys left.'}"
            )

    # All keys exhausted their retries
    err_text = str(last_exception).lower()
    if "429" in err_text or "quota" in err_text or "rate limit" in err_text:
        raise RateLimitExceeded(f"All Gemini API keys rate-limited after retries: {last_exception}") from last_exception

    print("Gemini extraction failed across all keys: ", last_exception, traceback.format_exc())
    raise LLMExtractionFailed(f"All API keys exhausted retries: {last_exception}") from last_exception
