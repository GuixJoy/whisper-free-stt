"""LLM client — DeepSeek, OpenRouter, and Ollama backends. Auto-detected from env.

Supports both synchronous (rewrite) and streaming (rewrite_stream) modes.
Streaming yields tokens as they arrive via SSE, dramatically reducing perceived latency.
"""

from __future__ import annotations

import os
import urllib.request
import json as _json

from stt.config import LLMConfig, LLMMode, LLMProvider
from stt.prompts import build_user_prompt


def rewrite(transcript: str, config: LLMConfig, *, few_shot_context: str = "") -> str:
    """Rewrite a transcript using the configured LLM backend (synchronous)."""
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


def rewrite_stream(
    transcript: str, config: LLMConfig, *, few_shot_context: str = ""
) -> "Generator[str, None, None]":
    """Yield tokens from the LLM as they arrive via SSE streaming.

    Falls back to synchronous rewrite if streaming fails or API key is missing.
    Yields the complete transcript as a single token on fallback.
    """
    if config.mode is LLMMode.OFF:
        return

    api_key = os.environ.get(config.api_key_env, "")
    if not api_key and config.provider is not LLMProvider.OLLAMA:
        yield transcript
        return

    user_prompt = build_user_prompt(transcript, config.mode, few_shot_context)
    payload = _build_payload(config, user_prompt)
    payload["stream"] = True
    headers = _build_headers(api_key, config.provider)

    try:
        yield from _stream_api(config.base_url, headers, payload, config.timeout_sec)
    except Exception as exc:
        print(f"LLM streaming failed ({exc}), falling back to sync...", flush=True)
        payload["stream"] = False
        result = _call_api(config.base_url, headers, payload, config.timeout_sec)
        yield result if result else transcript


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

        # Ollama format: {"message":{"content":"text"}}
        if "message" in body:
            text = body["message"].get("content", "")
            return _clean_response(text.strip()) if text else None

        # OpenAI format: {"choices":[{"message":{"content":"text"}}]}
        text = body["choices"][0]["message"]["content"]
        if text is None:
            return None
        return _clean_response(text.strip())
    except Exception as exc:
        print(f"LLM API call failed: {exc}", flush=True)
        return None


def _stream_api(
    url: str, headers: dict[str, str], payload: dict[str, object], timeout: float
) -> "Generator[str, None, None]":
    """Stream tokens from an OpenAI-compatible SSE or Ollama NDJSON endpoint."""
    req = urllib.request.Request(
        url,
        data=_json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        for raw_line in resp:
            line = raw_line.decode("utf-8").strip()
            if not line:
                continue

            # Ollama NDJSON format: {"message":{"content":"token"},"done":false}
            if line.startswith("{"):
                try:
                    chunk = _json.loads(line)
                    if chunk.get("done"):
                        break
                    token = chunk.get("message", {}).get("content", "")
                    if token:
                        yield token
                except _json.JSONDecodeError:
                    continue
                continue

            # OpenAI SSE format: data: {"choices":[{"delta":{"content":"token"}}]}
            if line.startswith("data: "):
                data = line[6:]
                if data == "[DONE]":
                    break
                try:
                    chunk = _json.loads(data)
                    delta = chunk.get("choices", [{}])[0].get("delta", {}).get("content", "")
                    if delta:
                        yield delta
                except (_json.JSONDecodeError, IndexError, KeyError):
                    continue


import re as _re

# Patterns that some models prepend/append that aren't part of the transcript.
_JUNK_LINE_RE = _re.compile(
    r"^\s*(?:user\s+)?safety\s*:?\s*\w+\s*$",
    _re.IGNORECASE,
)


def _clean_response(text: str) -> str:
    """Strip common junk lines models inject (e.g. 'User Safety: safe')."""
    lines = text.splitlines()
    cleaned = [ln for ln in lines if not _JUNK_LINE_RE.match(ln)]
    return "\n".join(cleaned).strip()
