"""Tests for stt/llm.py — LLM client (DeepSeek and OpenRouter backends)."""

import json
import os
import unittest
from unittest.mock import MagicMock, patch, call
from io import BytesIO


class TestBuildPayload(unittest.TestCase):
    """Tests for _build_payload() — request body construction."""

    def setUp(self):
        from stt.config import LLMConfig, LLMProvider, LLMMode
        self.config = LLMConfig(
            provider=LLMProvider.DEEPSEEK,
            mode=LLMMode.CLEANUP,
            model="deepseek-chat",
        )

    def test_model_from_config(self):
        from stt.llm import _build_payload
        payload = _build_payload(self.config, "test prompt")
        self.assertEqual(payload["model"], "deepseek-chat")

    def test_messages_is_single_user_message(self):
        """No system prompt — single user message only for speed/token saving."""
        from stt.llm import _build_payload
        payload = _build_payload(self.config, "my prompt text")
        messages = payload["messages"]
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0]["role"], "user")
        self.assertEqual(messages[0]["content"], "my prompt text")

    def test_max_tokens_is_256(self):
        from stt.llm import _build_payload
        payload = _build_payload(self.config, "test")
        self.assertEqual(payload["max_tokens"], 256)

    def test_temperature_is_0_2(self):
        from stt.llm import _build_payload
        payload = _build_payload(self.config, "test")
        self.assertAlmostEqual(payload["temperature"], 0.2)

    def test_stream_is_false(self):
        from stt.llm import _build_payload
        payload = _build_payload(self.config, "test")
        self.assertFalse(payload["stream"])

    def test_payload_is_json_serializable(self):
        from stt.llm import _build_payload
        payload = _build_payload(self.config, "test prompt")
        # Should not raise
        serialized = json.dumps(payload)
        self.assertIsInstance(serialized, str)


class TestBuildHeaders(unittest.TestCase):
    """Tests for _build_headers() — HTTP header construction."""

    def test_content_type_json(self):
        from stt.config import LLMProvider
        from stt.llm import _build_headers
        headers = _build_headers("sk-test", LLMProvider.DEEPSEEK)
        self.assertEqual(headers["Content-Type"], "application/json")

    def test_authorization_bearer(self):
        from stt.config import LLMProvider
        from stt.llm import _build_headers
        headers = _build_headers("my-api-key", LLMProvider.DEEPSEEK)
        self.assertEqual(headers["Authorization"], "Bearer my-api-key")

    def test_deepseek_no_extra_headers(self):
        """DeepSeek does not require HTTP-Referer or X-Title headers."""
        from stt.config import LLMProvider
        from stt.llm import _build_headers
        headers = _build_headers("sk-test", LLMProvider.DEEPSEEK)
        self.assertNotIn("HTTP-Referer", headers)
        self.assertNotIn("X-Title", headers)

    def test_openrouter_adds_referer_header(self):
        from stt.config import LLMProvider
        from stt.llm import _build_headers
        headers = _build_headers("sk-or-key", LLMProvider.OPENROUTER)
        self.assertIn("HTTP-Referer", headers)
        self.assertEqual(headers["HTTP-Referer"], "http://localhost")

    def test_openrouter_adds_title_header(self):
        from stt.config import LLMProvider
        from stt.llm import _build_headers
        headers = _build_headers("sk-or-key", LLMProvider.OPENROUTER)
        self.assertIn("X-Title", headers)
        self.assertEqual(headers["X-Title"], "stt-local")

    def test_openrouter_has_bearer_auth(self):
        from stt.config import LLMProvider
        from stt.llm import _build_headers
        headers = _build_headers("my-or-key", LLMProvider.OPENROUTER)
        self.assertEqual(headers["Authorization"], "Bearer my-or-key")


class TestIsAvailable(unittest.TestCase):
    """Tests for is_available() — API key presence check."""

    def test_returns_true_when_key_set(self):
        from stt.config import LLMConfig, LLMProvider, LLMMode
        from stt.llm import is_available
        cfg = LLMConfig(provider=LLMProvider.DEEPSEEK, mode=LLMMode.CLEANUP)
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "sk-key"}, clear=False):
            self.assertTrue(is_available(cfg))

    def test_returns_false_when_key_not_set(self):
        from stt.config import LLMConfig, LLMProvider, LLMMode
        from stt.llm import is_available
        cfg = LLMConfig(provider=LLMProvider.DEEPSEEK, mode=LLMMode.CLEANUP)
        env = {k: v for k, v in os.environ.items() if k != "DEEPSEEK_API_KEY"}
        with patch.dict(os.environ, env, clear=True):
            self.assertFalse(is_available(cfg))

    def test_returns_false_when_key_empty(self):
        from stt.config import LLMConfig, LLMProvider, LLMMode
        from stt.llm import is_available
        cfg = LLMConfig(provider=LLMProvider.DEEPSEEK, mode=LLMMode.CLEANUP)
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": ""}, clear=False):
            self.assertFalse(is_available(cfg))


class TestRewrite(unittest.TestCase):
    """Tests for rewrite() — main LLM rewriting function."""

    def _make_config(self, mode=None, provider=None, model="deepseek-chat",
                     fallback_model="", timeout_sec=15.0):
        from stt.config import LLMConfig, LLMMode, LLMProvider
        return LLMConfig(
            mode=mode or LLMMode.CLEANUP,
            provider=provider or LLMProvider.DEEPSEEK,
            model=model,
            fallback_model=fallback_model,
            timeout_sec=timeout_sec,
        )

    def test_raises_when_mode_off(self):
        from stt.config import LLMMode
        from stt.llm import rewrite
        cfg = self._make_config(mode=LLMMode.OFF)
        with self.assertRaises(ValueError):
            rewrite("any transcript", cfg)

    def test_returns_transcript_when_no_api_key(self):
        """No API key configured → return transcript unchanged with warning."""
        from stt.llm import rewrite
        cfg = self._make_config()
        env = {k: v for k, v in os.environ.items() if k != "DEEPSEEK_API_KEY"}
        with patch.dict(os.environ, env, clear=True):
            result = rewrite("my raw transcript", cfg)
        self.assertEqual(result, "my raw transcript")

    def test_returns_llm_result_on_success(self):
        """Successful API call returns the LLM-processed text."""
        from stt.llm import rewrite
        cfg = self._make_config()
        mock_response_body = json.dumps({
            "choices": [{"message": {"content": "  LLM cleaned text  "}}]
        }).encode("utf-8")

        mock_resp = MagicMock()
        mock_resp.read.return_value = mock_response_body
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)

        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "sk-test"}, clear=False):
            with patch("urllib.request.urlopen", return_value=mock_resp):
                result = rewrite("raw text", cfg)

        self.assertEqual(result, "LLM cleaned text")  # stripped

    def test_returns_transcript_when_api_fails(self):
        """API failure → fallback to returning raw transcript."""
        from stt.llm import rewrite
        cfg = self._make_config()
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "sk-test"}, clear=False):
            with patch("urllib.request.urlopen", side_effect=Exception("Network error")):
                result = rewrite("original transcript", cfg)
        self.assertEqual(result, "original transcript")

    def test_openrouter_fallback_tried_on_primary_failure(self):
        """OpenRouter config: fallback model is tried when primary fails."""
        from stt.config import LLMProvider
        from stt.llm import rewrite, _call_api

        cfg = self._make_config(
            provider=LLMProvider.OPENROUTER,
            model="openai/gpt-4o-mini",
            fallback_model="anthropic/claude-3-5-haiku-latest",
        )
        call_count = [0]

        def mock_call_api(url, headers, payload, timeout):
            call_count[0] += 1
            if call_count[0] == 1:
                return None  # Primary fails
            return "Fallback result"  # Fallback succeeds

        with patch.dict(os.environ, {"OPENROUTER_API_KEY": "sk-or"}, clear=False):
            with patch("stt.llm._call_api", side_effect=mock_call_api):
                result = rewrite("transcript text", cfg)

        self.assertEqual(result, "Fallback result")
        self.assertEqual(call_count[0], 2)

    def test_deepseek_no_fallback_attempted(self):
        """DeepSeek config: no fallback model → only one API call made."""
        from stt.llm import rewrite
        cfg = self._make_config()  # DEEPSEEK, no fallback

        call_count = [0]

        def mock_call_api(url, headers, payload, timeout):
            call_count[0] += 1
            return None  # Always fails

        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "sk-test"}, clear=False):
            with patch("stt.llm._call_api", side_effect=mock_call_api):
                result = rewrite("raw text", cfg)

        self.assertEqual(result, "raw text")
        self.assertEqual(call_count[0], 1)  # Only primary attempt

    def test_openrouter_fallback_returns_transcript_if_both_fail(self):
        """OpenRouter: both primary and fallback fail → return raw transcript."""
        from stt.config import LLMProvider
        from stt.llm import rewrite
        cfg = self._make_config(
            provider=LLMProvider.OPENROUTER,
            model="openai/gpt-4o-mini",
            fallback_model="anthropic/claude-3-5-haiku-latest",
        )

        with patch.dict(os.environ, {"OPENROUTER_API_KEY": "sk-or"}, clear=False):
            with patch("stt.llm._call_api", return_value=None):
                result = rewrite("original text", cfg)

        self.assertEqual(result, "original text")

    def test_rewrite_strips_whitespace_from_response(self):
        """The LLM response content should be stripped of leading/trailing whitespace."""
        from stt.llm import rewrite
        cfg = self._make_config()
        mock_response_body = json.dumps({
            "choices": [{"message": {"content": "  \n  cleaned text \n  "}}]
        }).encode("utf-8")

        mock_resp = MagicMock()
        mock_resp.read.return_value = mock_response_body
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)

        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "sk-test"}, clear=False):
            with patch("urllib.request.urlopen", return_value=mock_resp):
                result = rewrite("raw", cfg)

        self.assertEqual(result, "cleaned text")


class TestCallApi(unittest.TestCase):
    """Tests for _call_api() — low-level HTTP call."""

    def test_returns_none_on_exception(self):
        from stt.llm import _call_api
        with patch("urllib.request.urlopen", side_effect=Exception("timeout")):
            result = _call_api("http://fake", {}, {}, 5.0)
        self.assertIsNone(result)

    def test_returns_content_on_success(self):
        from stt.llm import _call_api
        body = json.dumps({
            "choices": [{"message": {"content": "  result text  "}}]
        }).encode()
        mock_resp = MagicMock()
        mock_resp.read.return_value = body
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)

        with patch("urllib.request.urlopen", return_value=mock_resp):
            result = _call_api("http://fake", {"Content-Type": "application/json"}, {}, 5.0)

        self.assertEqual(result, "result text")  # stripped

    def test_uses_post_method(self):
        """The HTTP request must use POST method."""
        import urllib.request
        from stt.llm import _call_api
        captured_request = [None]

        def fake_urlopen(req, timeout=None):
            captured_request[0] = req
            raise Exception("stop")

        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            _call_api("http://fake", {}, {"key": "val"}, 5.0)

        if captured_request[0] is not None:
            self.assertEqual(captured_request[0].method, "POST")

    def test_payload_json_encoded(self):
        """Payload dict is serialized to JSON bytes in the request body."""
        from stt.llm import _call_api
        captured_request = [None]

        def fake_urlopen(req, timeout=None):
            captured_request[0] = req
            raise Exception("stop")

        payload = {"model": "test", "messages": []}
        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            _call_api("http://fake", {}, payload, 5.0)

        if captured_request[0] is not None:
            data = captured_request[0].data
            decoded = json.loads(data.decode("utf-8"))
            self.assertEqual(decoded["model"], "test")


if __name__ == "__main__":
    unittest.main()