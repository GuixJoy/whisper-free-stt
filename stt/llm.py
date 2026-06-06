"""OpenRouter LLM client for transcript rewriting. Uses stdlib only."""

from __future__ import annotations

import os
import urllib.request
import json as _json

from stt.config import LLMConfig, LLMMode
from stt.prompts import SYSTEM_PROMPT, build_user_prompt


def rewrite(transcript: str, config: LLMConfig) -> str:
    """Send transcript to OpenRouter for rewriting. Returns original on failure."""
    if config.mode is LLMMode.OFF:
        raise ValueError("LLM rewriting is disabled (mode=OFF).")

    api_key = os.environ.get(config.api_key_env, "")
    if not api_key:
        print(f"Warning: {config.api_key_env} not set. Returning raw transcript.", flush=True)
        return transcript

    user_prompt = build_user_prompt(transcript, config.mode)
    payload = {
        "model": config.model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "max_tokens": config.max_tokens,
        "temperature": config.temperature,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost",
        "X-Title": "stt-local",
    }

    try:
        req = urllib.request.Request(
            config.base_url,
            data=_json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=config.timeout_sec) as resp:
            body = _json.loads(resp.read().decode("utf-8"))
        return body["choices"][0]["message"]["content"].strip()
    except Exception as exc:
        print(f"OpenRouter call failed: {exc}", flush=True)
        return transcript


def is_available(config: LLMConfig) -> bool:
    """Check whether the API key is present."""
    return bool(os.environ.get(config.api_key_env, ""))
