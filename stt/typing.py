"""Type text into currently focused input on Wayland."""

from __future__ import annotations

import shutil
import subprocess

from stt.config import TypingConfig


def type_to_focused_input(text: str, config: TypingConfig) -> bool:
    """Type text into the active focused input field via wtype."""
    if not config.enabled:
        return False
    if not text.strip():
        return False

    wtype = shutil.which(config.wtype_path)
    if wtype is None:
        print(f"Warning: '{config.wtype_path}' not found in PATH. Typing skipped.")
        return False

    try:
        proc = subprocess.run(
            [wtype, text],
            text=True,
            timeout=10,
        )
        return proc.returncode == 0
    except subprocess.TimeoutExpired:
        print("wtype timed out while typing.")
        return False
    except Exception as exc:
        print(f"wtype error: {exc}")
        return False
