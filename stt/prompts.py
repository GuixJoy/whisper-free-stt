"""Centralized prompt templates for LLM rewriting. Pure functions."""

from __future__ import annotations

from stt.config import LLMMode

SYSTEM_PROMPT = ""  # not used — we pass everything as user message for speed

_CLEANUP = (
    "Fix punctuation, capitalization, and remove filler words (um, uh). "
    "Preserve technical terms. Return only the cleaned text."
)

_BULLET = (
    "Convert the following microphone transcript into a clean, "
    "well-structured bulleted list. Group related points together. "
    "Return only the bullet list with no preamble."
)

_EMAIL = (
    "Rewrite the following microphone transcript as a professional email. "
    "Add a short subject line in brackets at the top. "
    "Return only the email body with no extra preamble."
)

_COMMIT = (
    "Convert the following microphone transcript into a git commit message. "
    "Use conventional commit format (type: short description). "
    "Keep the subject line under 72 characters. "
    "Return only the commit message with no preamble."
)

_MODE_INSTRUCTIONS: dict[LLMMode, str] = {
    LLMMode.CLEANUP: _CLEANUP,
    LLMMode.BULLET_LIST: _BULLET,
    LLMMode.EMAIL: _EMAIL,
    LLMMode.COMMIT_MESSAGE: _COMMIT,
}


def build_user_prompt(transcript: str, mode: LLMMode) -> str:
    """Build the user-level prompt for a given LLM mode and transcript."""
    instruction = _MODE_INSTRUCTIONS.get(mode, _CLEANUP)
    return f"{instruction}\n\nTranscript:\n{transcript}"
