"""Platform and capability detection for desktop UI."""

from __future__ import annotations

import os
import platform
import shutil
from dataclasses import dataclass


@dataclass(frozen=True)
class PlatformCapabilities:
    platform_label: str
    is_wayland: bool
    focused_shortcuts: bool
    global_shortcuts: bool
    global_shortcuts_via_portal: bool
    always_on_top: bool
    clipboard: bool
    notes: tuple[str, ...]


def detect_capabilities() -> PlatformCapabilities:
    system = platform.system().lower()
    session_type = os.environ.get("XDG_SESSION_TYPE", "").lower()
    is_wayland = session_type == "wayland"
    notes: list[str] = []

    if system == "windows":
        platform_label = "Windows"
        global_shortcuts = True
        portal = False
        always_on_top = True
    elif system == "darwin":
        platform_label = "macOS"
        global_shortcuts = True
        portal = False
        always_on_top = True
        notes.append("Global shortcuts may need Accessibility/Input Monitoring permission.")
    elif system == "linux":
        platform_label = "Linux Wayland" if is_wayland else "Linux X11"
        if is_wayland:
            portal = shutil.which("gdbus") is not None and bool(os.environ.get("DBUS_SESSION_BUS_ADDRESS"))
            global_shortcuts = False
            if portal:
                notes.append("Wayland: portal-based global shortcuts may be available depending on compositor.")
            else:
                notes.append("Wayland: global shortcuts unavailable; focused shortcuts and buttons remain available.")
            always_on_top = False
        else:
            portal = False
            global_shortcuts = True
            always_on_top = True
    else:
        platform_label = platform.system()
        global_shortcuts = False
        portal = False
        always_on_top = False

    return PlatformCapabilities(
        platform_label=platform_label,
        is_wayland=is_wayland,
        focused_shortcuts=True,
        global_shortcuts=global_shortcuts,
        global_shortcuts_via_portal=portal,
        always_on_top=always_on_top,
        clipboard=True,
        notes=tuple(notes),
    )


def capability_rows(c: PlatformCapabilities) -> list[tuple[str, str]]:
    return [
        ("App window + focused shortcuts", "✅"),
        ("Global shortcuts", "✅" if c.global_shortcuts else ("⚠️ portal-dependent" if c.global_shortcuts_via_portal else "❌")),
        ("Clipboard", "✅" if c.clipboard else "❌"),
        ("Always-on-top compact window", "✅" if c.always_on_top else "⚠️ compositor/WM dependent"),
        ("True universal global PTT", "✅" if c.global_shortcuts else "❌"),
    ]

