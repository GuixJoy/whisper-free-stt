"""Type text into currently focused input on Wayland."""

from __future__ import annotations

import shutil
import subprocess

from kakashi import get_logger

from stt.config import TypingConfig

logger = get_logger(__name__)

_wtype_cache: dict[str, str | None] = {}


def type_to_focused_input(text: str, config: TypingConfig) -> bool:
    """Type text into the active focused input field via wtype."""
    if not config.enabled:
        return False
    if not text.strip():
        return False
    import os as _os
    if not _os.environ.get("WAYLAND_DISPLAY"):
        return False  # not on Wayland — don't hang

    path_key = config.wtype_path
    if path_key not in _wtype_cache:
        _wtype_cache[path_key] = shutil.which(path_key)
    wtype = _wtype_cache[path_key]
    if wtype is None:
        logger.warning("'%s' not found in PATH. Typing skipped.", path_key)
        return False

    try:
        proc = subprocess.run(
            [wtype, text],
            text=True,
            timeout=10,
        )
        return proc.returncode == 0
    except subprocess.TimeoutExpired:
        logger.warning("wtype timed out while typing.")
        return False
    except Exception as exc:
        logger.error("wtype error: %s", exc)
        return False
