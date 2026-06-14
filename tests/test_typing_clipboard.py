"""Tests for stt/typing.py and stt/clipboard.py — cached path lookups."""

import unittest
from unittest.mock import patch, MagicMock
import os


class TestTypingCache(unittest.TestCase):
    """Tests for shutil.which caching in typing.py."""

    def setUp(self):
        import stt.typing as mod
        self._orig_cache = dict(mod._wtype_cache)
        mod._wtype_cache.clear()

    def tearDown(self):
        import stt.typing as mod
        mod._wtype_cache.clear()
        mod._wtype_cache.update(self._orig_cache)

    def test_returns_false_when_disabled(self):
        from stt.typing import type_to_focused_input
        from stt.config import TypingConfig
        cfg = TypingConfig(enabled=False)
        self.assertFalse(type_to_focused_input("hello", cfg))

    def test_returns_false_when_empty_text(self):
        from stt.typing import type_to_focused_input
        from stt.config import TypingConfig
        cfg = TypingConfig(enabled=True)
        self.assertFalse(type_to_focused_input("  ", cfg))

    def test_returns_false_without_wayland(self):
        from stt.typing import type_to_focused_input
        from stt.config import TypingConfig
        cfg = TypingConfig(enabled=True)
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("WAYLAND_DISPLAY", None)
            self.assertFalse(type_to_focused_input("hello", cfg))

    def test_path_caching_works(self):
        """shutil.which should only be called once per unique path."""
        import stt.typing as mod
        from stt.config import TypingConfig
        with patch.dict(os.environ, {"WAYLAND_DISPLAY": ":1"}):
            with patch("shutil.which", return_value="/usr/bin/wtype") as mock_which:
                cfg = TypingConfig(enabled=True, wtype_path="wtype")
                # First call — should call shutil.which
                mod.type_to_focused_input("test", cfg)
                self.assertEqual(mock_which.call_count, 1)
                # Second call — should use cache
                mod.type_to_focused_input("test2", cfg)
                self.assertEqual(mock_which.call_count, 1)

    def test_different_paths_get_separate_cache_entries(self):
        import stt.typing as mod
        from stt.config import TypingConfig
        with patch.dict(os.environ, {"WAYLAND_DISPLAY": ":1"}):
            with patch("shutil.which", side_effect=lambda p: f"/usr/bin/{p}"):
                cfg1 = TypingConfig(enabled=True, wtype_path="wtype")
                cfg2 = TypingConfig(enabled=True, wtype_path="xdotool")
                mod.type_to_focused_input("a", cfg1)
                mod.type_to_focused_input("b", cfg2)
                self.assertIn("wtype", mod._wtype_cache)
                self.assertIn("xdotool", mod._wtype_cache)


class TestClipboardCache(unittest.TestCase):
    """Tests for shutil.which caching in clipboard.py."""

    def setUp(self):
        import stt.clipboard as mod
        self._orig_cache = dict(mod._wl_copy_cache)
        mod._wl_copy_cache.clear()

    def tearDown(self):
        import stt.clipboard as mod
        mod._wl_copy_cache.clear()
        mod._wl_copy_cache.update(self._orig_cache)

    def test_returns_false_when_disabled(self):
        from stt.clipboard import copy_to_clipboard
        from stt.config import ClipboardConfig
        cfg = ClipboardConfig(enabled=False)
        self.assertFalse(copy_to_clipboard("hello", cfg))

    def test_path_caching_works(self):
        """shutil.which should only be called once per unique path."""
        import stt.clipboard as mod
        from stt.config import ClipboardConfig
        with patch("shutil.which", return_value="/usr/bin/wl-copy") as mock_which:
            cfg = ClipboardConfig(enabled=True, wl_copy_path="wl-copy")
            mod.copy_to_clipboard("test", cfg)
            self.assertEqual(mock_which.call_count, 1)
            mod.copy_to_clipboard("test2", cfg)
            self.assertEqual(mock_which.call_count, 1)

    def test_none_path_cached(self):
        """When tool not found, None should be cached to avoid repeated lookups."""
        import stt.clipboard as mod
        from stt.config import ClipboardConfig
        with patch("shutil.which", return_value=None) as mock_which:
            cfg = ClipboardConfig(enabled=True, wl_copy_path="nonexistent")
            mod.copy_to_clipboard("test", cfg)
            self.assertEqual(mock_which.call_count, 1)
            # Second call should still use cache (no additional which call)
            mod.copy_to_clipboard("test2", cfg)
            self.assertEqual(mock_which.call_count, 1)
