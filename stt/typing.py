"""Type text into currently focused input — auto-detects Wayland (wtype) or X11 (xdotool)."""

from __future__ import annotations

import os
import shutil
import subprocess

from stt.log import get_logger

from stt.config import TypingConfig

logger = get_logger(__name__)

_tool_cache: dict[str, str | None] = {}


def _is_wayland() -> bool:
    return bool(os.environ.get("WAYLAND_DISPLAY"))


def type_to_focused_input(text: str, config: TypingConfig) -> bool:
    """Type text into the active focused input field.

    Auto-detects Wayland (wtype) or X11 (xdotool) based on environment.
    """
    if not config.enabled:
        return False
    if not text.strip():
        return False

    if _is_wayland():
        return _type_wtype(text, config.wtype_path)
    elif os.environ.get("DISPLAY"):
        return _type_xdotool(text, config.xdotool_path)
    else:
        logger.warning("No display server detected (WAYLAND_DISPLAY/DISPLAY). Typing skipped.")
        return False


def _type_wtype(text: str, wtype_path: str) -> bool:
    if wtype_path not in _tool_cache:
        _tool_cache[wtype_path] = shutil.which(wtype_path)
    wtype = _tool_cache[wtype_path]
    if wtype is None:
        logger.warning(f"'{wtype_path}' not found in PATH. Typing skipped.")
        return False
    try:
        proc = subprocess.run([wtype, text], text=True, timeout=10)
        return proc.returncode == 0
    except subprocess.TimeoutExpired:
        logger.warning("wtype timed out while typing.")
        return False
    except Exception as exc:
        logger.error(f"wtype error: {exc}")
        return False


def _type_xdotool(text: str, xdotool_path: str) -> bool:
    if xdotool_path not in _tool_cache:
        _tool_cache[xdotool_path] = shutil.which(xdotool_path)
    xdotool = _tool_cache[xdotool_path]
    if xdotool is None:
        logger.warning(f"'{xdotool_path}' not found in PATH. Typing skipped.")
        return False
    try:
        proc = subprocess.run([xdotool, "type", "--clearmodifiers", text], text=True, timeout=10)
        return proc.returncode == 0
    except subprocess.TimeoutExpired:
        logger.warning("xdotool timed out while typing.")
        return False
    except Exception as exc:
        logger.error(f"xdotool error: {exc}")
        return False
