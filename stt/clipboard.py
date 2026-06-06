"""Wayland clipboard integration via wl-copy."""

from __future__ import annotations

import subprocess
import shutil

from stt.config import ClipboardConfig


def copy_to_clipboard(text: str, config: ClipboardConfig) -> bool:
    """Copy text to the Wayland clipboard via wl-copy. Returns success."""
    if not config.enabled:
        return False
    wl_copy = shutil.which(config.wl_copy_path)
    if wl_copy is None:
        print(f"Warning: '{config.wl_copy_path}' not found. Clipboard skipped.")
        return False
    try:
        proc = subprocess.run([wl_copy], input=text, text=True, timeout=10)
        return proc.returncode == 0
    except Exception as exc:
        print(f"wl-copy error: {exc}")
        return False


def is_available(config: ClipboardConfig) -> bool:
    return shutil.which(config.wl_copy_path) is not None
