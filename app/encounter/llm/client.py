import time
from app import kv
from tenacity import (
    retry,
    wait_exponential_jitter,
    stop_after_attempt,
    RetryCallState,
)
from flask import current_app
from typing import Optional, Any, Callable, Literal
from groq import Groq, RateLimitError
from app.encounter.keys import EncounterKeys
import os

RATE_LIMIT_PAUSE_KEY = EncounterKeys.RATE_LIMIT_PAUSE_KEY


def wait_for_rate_limit_clear():
    while True:
        pause_until = kv.get(RATE_LIMIT_PAUSE_KEY)
        if pause_until is None:
            return
        remaining = float(pause_until) - time.time()
        if remaining <= 0:
            return
        time.sleep(min(remaining, 2))


def set_rate_limit_pause(seconds: float):
    pause_until = time.time() + seconds
    current = kv.get(RATE_LIMIT_PAUSE_KEY)
    if current and float(current) >= pause_until:
        return
    kv.set(RATE_LIMIT_PAUSE_KEY, pause_until, px=int ((seconds + 5) * 1000))


def _set_rate_limiter(retry_state: RetryCallState):
    if not retry_state.outcome or not retry_state.outcome.failed:
        return
    if not isinstance(retry_state.outcome.exception(), RateLimitError):
        return
    to_wait = min(30, 10 *retry_state.attempt_number)
    set_rate_limit_pause(to_wait)


class EncounterLLM:
    def __init__(self, api_key=None):
        if not api_key:
            try:
                api_key = current_app.config.get("GROQ_API_KEY")
            except RuntimeError:
                api_key = os.getenv("GROQ_API_KEY")
        self.client = Groq(api_key=api_key)

    @retry(
        stop=stop_after_attempt(5),
        wait=wait_exponential_jitter(initial=2, max=10, exp_base=2),
        before_sleep=_set_rate_limiter,
    )
    def send_request(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        response_format: Optional[Any] = None,
        temperature=0,
        validator_callback: Optional[Callable] = None,
        reasoning_effort: Literal['low', 'medium', 'high'] = "low",
    ):
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})

        messages.append({"role": "user", "content": prompt})
        wait_for_rate_limit_clear()
        response = self.client.chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=messages,
            temperature=temperature,
            stream=False,
            response_format=response_format,
            reasoning_effort=reasoning_effort
        )
        raw_content = response.choices[0].message.content

        if validator_callback:
            return validator_callback(raw_content)
        return raw_content

client: Optional[EncounterLLM] = None

def load_encounterllm_client():
    global client
    if client:
        return client
    client = EncounterLLM()
    return client
