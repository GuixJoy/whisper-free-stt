"""Wayland clipboard integration via wl-copy."""

from __future__ import annotations

import subprocess
import shutil

from stt.config import ClipboardConfig

_wl_copy_cache: dict[str, str | None] = {}


def copy_to_clipboard(text: str, config: ClipboardConfig) -> bool:
    """Copy text to the Wayland clipboard via wl-copy. Returns success."""
    if not config.enabled:
        return False

    path_key = config.wl_copy_path
    if path_key not in _wl_copy_cache:
        _wl_copy_cache[path_key] = shutil.which(path_key)
    wl_copy = _wl_copy_cache[path_key]
    if wl_copy is None:
        print(f"Warning: '{path_key}' not found. Clipboard skipped.")
        return False
    try:
        proc = subprocess.run([wl_copy], input=text, text=True, timeout=10)
        return proc.returncode == 0
    except Exception as exc:
        print(f"wl-copy error: {exc}")
        return False


def is_available(config: ClipboardConfig) -> bool:
    return shutil.which(config.wl_copy_path) is not None
