"""Shortcut definitions, conflict detection, and focused binding manager."""

from __future__ import annotations

import tkinter as tk
from dataclasses import dataclass
from typing import Callable

from stt.ui.models import DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS
from stt.ui.platform import PlatformCapabilities


ShortcutHandler = Callable[[], None]


@dataclass(frozen=True)
class ShortcutStatus:
    action: str
    sequence: str
    scope: str


def detect_conflicts(shortcuts: dict[str, str]) -> dict[str, list[str]]:
    inverse: dict[str, list[str]] = {}
    for action in SHORTCUT_ACTIONS:
        seq = shortcuts.get(action, "").strip()
        if not seq:
            continue
        inverse.setdefault(seq, []).append(action)
    return {seq: acts for seq, acts in inverse.items() if len(acts) > 1}


def reset_defaults() -> dict[str, str]:
    return dict(DEFAULT_SHORTCUTS)


def scope_for_action(action: str, caps: PlatformCapabilities, preference: str) -> str:
    if preference == "focused_only":
        return "app-focused"
    if caps.global_shortcuts:
        return "global"
    if caps.global_shortcuts_via_portal:
        return "portal/global-possible"
    return "app-focused"


class ShortcutManager:
    def __init__(self, root: tk.Tk):
        self.root = root
        self._bound_sequences: set[str] = set()

    def clear(self) -> None:
        for seq in list(self._bound_sequences):
            self.root.unbind(seq)
        self._bound_sequences.clear()

    def bind_focused(
        self,
        shortcuts: dict[str, str],
        handlers: dict[str, ShortcutHandler],
    ) -> list[ShortcutStatus]:
        self.clear()
        statuses: list[ShortcutStatus] = []
        for action in SHORTCUT_ACTIONS:
            seq = shortcuts.get(action, "").strip()
            if not seq:
                statuses.append(ShortcutStatus(action=action, sequence="", scope="unsupported"))
                continue
            handler = handlers.get(action)
            if handler is None:
                statuses.append(ShortcutStatus(action=action, sequence=seq, scope="unsupported"))
                continue
            self.root.bind(seq, lambda _event, fn=handler: fn())
            self._bound_sequences.add(seq)
            statuses.append(ShortcutStatus(action=action, sequence=seq, scope="app-focused"))
        return statuses

