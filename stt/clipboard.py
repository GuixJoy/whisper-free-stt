"""Clipboard integration — auto-detects Wayland (wl-copy) or X11 (xclip)."""

from __future__ import annotations

import os
import subprocess
import shutil

from stt.log import get_logger

from stt.config import ClipboardConfig

logger = get_logger(__name__)

_tool_cache: dict[str, str | None] = {}


def _is_wayland() -> bool:
    return bool(os.environ.get("WAYLAND_DISPLAY"))


def copy_to_clipboard(text: str, config: ClipboardConfig) -> bool:
    """Copy text to the system clipboard.

    Auto-detects Wayland (wl-copy) or X11 (xclip) based on environment.
    """
    if not config.enabled:
        return False

    if _is_wayland():
        return _copy_wl(text, config.wl_copy_path)
    elif os.environ.get("DISPLAY"):
        return _copy_xclip(text, config.xclip_path)
    else:
        logger.warning("No display server detected. Clipboard skipped.")
        return False


def _copy_wl(text: str, wl_copy_path: str) -> bool:
    if wl_copy_path not in _tool_cache:
        _tool_cache[wl_copy_path] = shutil.which(wl_copy_path)
    wl_copy = _tool_cache[wl_copy_path]
    if wl_copy is None:
        logger.warning(f"'{wl_copy_path}' not found. Clipboard skipped.")
        return False
    try:
        proc = subprocess.run([wl_copy], input=text, text=True, timeout=10)
        return proc.returncode == 0
    except Exception as exc:
        logger.error(f"wl-copy error: {exc}")
        return False


def _copy_xclip(text: str, xclip_path: str) -> bool:
    if xclip_path not in _tool_cache:
        _tool_cache[xclip_path] = shutil.which(xclip_path)
    xclip = _tool_cache[xclip_path]
    if xclip is None:
        logger.warning(f"'{xclip_path}' not found. Clipboard skipped.")
        return False
    try:
        proc = subprocess.run(
            [xclip, "-selection", "clipboard"],
            input=text, text=True, timeout=10,
        )
        return proc.returncode == 0
    except Exception as exc:
        logger.error(f"xclip error: {exc}")
        return False


def is_available(config: ClipboardConfig) -> bool:
    if _is_wayland():
        return shutil.which(config.wl_copy_path) is not None
    return shutil.which(config.xclip_path) is not None
