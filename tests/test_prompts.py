"""Tests for stt/prompts.py — centralized LLM prompt templates."""

import unittest

from stt.config import LLMMode
from stt.prompts import (
    SYSTEM_PROMPT,
    _CLEANUP,
    _BULLET,
    _EMAIL,
    _COMMIT,
    _MODE_INSTRUCTIONS,
    build_user_prompt,
)


class TestSystemPrompt(unittest.TestCase):
    def test_system_prompt_is_empty_string(self):
        """No system prompt is used — everything goes as user message for speed."""
        self.assertEqual(SYSTEM_PROMPT, "")


class TestModeInstructions(unittest.TestCase):
    def test_all_active_modes_have_instructions(self):
        """Every non-OFF LLMMode must have a non-empty instruction."""
        active_modes = [
            LLMMode.CLEANUP,
            LLMMode.BULLET_LIST,
            LLMMode.EMAIL,
            LLMMode.COMMIT_MESSAGE,
        ]
        for mode in active_modes:
            with self.subTest(mode=mode):
                self.assertIn(mode, _MODE_INSTRUCTIONS)
                self.assertTrue(_MODE_INSTRUCTIONS[mode].strip())

    def test_off_mode_not_in_instructions(self):
        """LLMMode.OFF has no instruction entry."""
        self.assertNotIn(LLMMode.OFF, _MODE_INSTRUCTIONS)

    def test_cleanup_instruction_content(self):
        """CLEANUP instruction mentions punctuation and filler words."""
        self.assertIn("punctuation", _CLEANUP.lower())
        self.assertIn("filler", _CLEANUP.lower())

    def test_bullet_instruction_content(self):
        """BULLET instruction mentions bullet list."""
        self.assertIn("bullet", _BULLET.lower())

    def test_email_instruction_content(self):
        """EMAIL instruction mentions professional email."""
        self.assertIn("email", _EMAIL.lower())

    def test_commit_instruction_content(self):
        """COMMIT instruction mentions git commit message."""
        self.assertIn("commit", _COMMIT.lower())


class TestBuildUserPrompt(unittest.TestCase):
    def test_cleanup_mode_format(self):
        transcript = "um hello world"
        result = build_user_prompt(transcript, LLMMode.CLEANUP)
        self.assertIn(_CLEANUP, result)
        self.assertIn("Transcript:", result)
        self.assertIn(transcript, result)

    def test_prompt_format_has_double_newlines(self):
        """The instruction and transcript are separated by a blank line."""
        result = build_user_prompt("test text", LLMMode.CLEANUP)
        self.assertIn("\n\nTranscript:\n", result)

    def test_bullet_list_mode(self):
        transcript = "first point second point"
        result = build_user_prompt(transcript, LLMMode.BULLET_LIST)
        self.assertIn(_BULLET, result)
        self.assertIn(transcript, result)

    def test_email_mode(self):
        transcript = "please schedule a meeting"
        result = build_user_prompt(transcript, LLMMode.EMAIL)
        self.assertIn(_EMAIL, result)
        self.assertIn(transcript, result)

    def test_commit_message_mode(self):
        transcript = "add new feature for user login"
        result = build_user_prompt(transcript, LLMMode.COMMIT_MESSAGE)
        self.assertIn(_COMMIT, result)
        self.assertIn(transcript, result)

    def test_unknown_mode_falls_back_to_cleanup(self):
        """An unmapped mode should fall back to _CLEANUP instruction."""
        from unittest.mock import MagicMock
        fake_mode = MagicMock(spec=LLMMode)
        # _MODE_INSTRUCTIONS.get(fake_mode, _CLEANUP) → _CLEANUP
        result = build_user_prompt("some text", fake_mode)  # type: ignore[arg-type]
        self.assertIn(_CLEANUP, result)

    def test_empty_transcript(self):
        """Empty transcript is embedded as-is."""
        result = build_user_prompt("", LLMMode.CLEANUP)
        self.assertIn("Transcript:\n", result)
        self.assertTrue(result.endswith("Transcript:\n"))

    def test_multiline_transcript_preserved(self):
        transcript = "line one\nline two\nline three"
        result = build_user_prompt(transcript, LLMMode.CLEANUP)
        self.assertIn(transcript, result)

    def test_prompt_structure_exact(self):
        """Verify the exact format: instruction + blank line + 'Transcript:\\n' + text."""
        transcript = "hello world"
        result = build_user_prompt(transcript, LLMMode.CLEANUP)
        expected = f"{_CLEANUP}\n\nTranscript:\n{transcript}"
        self.assertEqual(result, expected)

    def test_transcript_with_special_characters(self):
        transcript = "C++ is fun! 100% true. Let's go → done."
        result = build_user_prompt(transcript, LLMMode.CLEANUP)
        self.assertIn(transcript, result)

    def test_all_modes_produce_different_instructions(self):
        """Each mode produces a distinct prompt (different instruction prefix)."""
        prompts = [
            build_user_prompt("test", LLMMode.CLEANUP),
            build_user_prompt("test", LLMMode.BULLET_LIST),
            build_user_prompt("test", LLMMode.EMAIL),
            build_user_prompt("test", LLMMode.COMMIT_MESSAGE),
        ]
        self.assertEqual(len(set(prompts)), 4, "Each mode should produce a unique prompt")


if __name__ == "__main__":
    unittest.main()