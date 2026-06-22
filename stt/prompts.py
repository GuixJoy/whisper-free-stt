"""Centralized prompt templates for LLM rewriting. Pure functions."""

from __future__ import annotations

from stt.config import LLMMode

SYSTEM_PROMPT = ""  # not used — we pass everything as user message for speed

_CLEANUP = (
    "Fix punctuation, capitalization, and remove filler words (um, uh). "
    "Preserve technical terms. "
    "IMPORTANT: Return ONLY the corrected transcript text. "
    "Do NOT add any labels, headers, commentary, safety ratings, or explanations."
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


def build_user_prompt(
    transcript: str,
    mode: LLMMode,
    few_shot_context: str = "",
    dictionary_context: str = "",
) -> str:
    """Build the user-level prompt for a given LLM mode and transcript.

    If few_shot_context is provided (from history-based similarity search),
    it is prepended before the instruction so the LLM sees past corrections.

    If dictionary_context is provided, it is prepended before the instruction
    to tell the LLM about custom terms that must be preserved.
    """
    instruction = _MODE_INSTRUCTIONS.get(mode, _CLEANUP)
    parts = []
    if few_shot_context:
        parts.append(few_shot_context)
    if dictionary_context:
        parts.append(dictionary_context)
    parts.append(instruction)
    parts.append(f"Transcript:\n{transcript}")
    return "\n\n".join(parts)
