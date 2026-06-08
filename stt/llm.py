"""LLM client — DeepSeek and OpenRouter backends. Auto-detected from env."""

from __future__ import annotations

import os
import urllib.request
import json as _json

from stt.config import LLMConfig, LLMMode, LLMProvider
from stt.prompts import build_user_prompt


def rewrite(transcript: str, config: LLMConfig, *, few_shot_context: str = "") -> str:
    """Rewrite a transcript using the configured LLM backend.

    If `few_shot_context` is provided (from history-based similarity search),
    it is prepended to the prompt so the LLM sees past correction examples.
    """
    if config.mode is LLMMode.OFF:
        raise ValueError("LLM rewriting is disabled (mode=OFF).")

    api_key = os.environ.get(config.api_key_env, "")
    if not api_key:
        print(f"Warning: {config.api_key_env} not set. Returning raw transcript.", flush=True)
        return transcript

    user_prompt = build_user_prompt(transcript, config.mode, few_shot_context)
    payload = _build_payload(config, user_prompt)
    headers = _build_headers(api_key, config.provider)

    result = _call_api(config.base_url, headers, payload, config.timeout_sec)
    if result is not None:
        return result

    if config.fallback_model and config.provider is LLMProvider.OPENROUTER:
        print(f"Fallback to {config.fallback_model}...")
        payload["model"] = config.fallback_model
        result = _call_api(config.base_url, headers, payload, config.timeout_sec)
        if result is not None:
            return result

    print("LLM call failed. Returning raw transcript.")
    return transcript


def is_available(config: LLMConfig) -> bool:
    return bool(os.environ.get(config.api_key_env, ""))


def _build_payload(config: LLMConfig, user_prompt: str) -> dict[str, object]:
    # Single user message — no system prompt. Saves tokens, faster inference.
    """Builds the JSON-compatible request payload for the LLM containing a single user message.

    Parameters:
        config (LLMConfig): Configuration providing model, max_tokens, temperature.
        user_prompt (str): The user-facing prompt to include as the sole message.

    Returns:
        dict[str, object]: Payload with keys:
            - "model": model name from `config`.
            - "messages": list with a single `{"role": "user", "content": user_prompt}` entry.
            - "max_tokens": from config.max_tokens; >=512 for EMAIL/BULLET_LIST modes.
            - "temperature": from config.temperature (defaults to 0.2).
            - "stream": False
    """
    max_tokens = config.max_tokens if config.max_tokens else 256
    # EMAIL and BULLET_LIST modes produce longer output; ensure room for formatting.
    from stt.config import LLMMode
    if config.mode in (LLMMode.EMAIL, LLMMode.BULLET_LIST):
        mode_min = 512
        if max_tokens < mode_min:
            import sys
            print(f"Warning: mode {config.mode.value} needs >= {mode_min} tokens; "
                  f"overriding config max_tokens ({max_tokens})", file=sys.stderr, flush=True)
            max_tokens = mode_min
    return {
        "model": config.model,
        "messages": [
            {"role": "user", "content": user_prompt},
        ],
        "max_tokens": max_tokens,
        "temperature": config.temperature if config.temperature else 0.2,
        "stream": False,
    }


def _build_headers(api_key: str, provider: LLMProvider) -> dict[str, str]:
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }
    if provider is LLMProvider.OPENROUTER:
        headers["HTTP-Referer"] = "http://localhost"
        headers["X-Title"] = "stt-local"
    return headers


def _call_api(url: str, headers: dict[str, str], payload: dict[str, object], timeout: float) -> str | None:
    try:
        req = urllib.request.Request(
            url,
            data=_json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = _json.loads(resp.read().decode("utf-8"))
        return body["choices"][0]["message"]["content"].strip()
    except Exception as exc:
        print(f"LLM API call failed: {exc}", flush=True)
        return None
