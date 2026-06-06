"""Background runner for orchestrator with UI event queue hooks."""

from __future__ import annotations

import queue
import threading
from dataclasses import dataclass

from stt.config import AppConfig
from stt.orchestrator import RunHooks, run


@dataclass(frozen=True)
class BackendEvent:
    kind: str
    payload: object


class BackendRunner:
    def __init__(self) -> None:
        self.events: queue.Queue[BackendEvent] = queue.Queue()
        self.stop_event: threading.Event | None = None
        self.worker: threading.Thread | None = None

    def is_running(self) -> bool:
        return bool(self.worker and self.worker.is_alive())

    def start(self, config: AppConfig) -> bool:
        if self.is_running():
            return False
        self.stop_event = threading.Event()
        hooks = RunHooks(
            on_state=lambda s: self.events.put(BackendEvent("state", s)),
            on_activity=lambda s: self.events.put(BackendEvent("activity", s)),
            on_partial=lambda s: self.events.put(BackendEvent("partial", s)),
            on_raw=lambda s: self.events.put(BackendEvent("raw", s)),
            on_processed=lambda s: self.events.put(BackendEvent("processed", s)),
            on_mic_level=lambda s: self.events.put(BackendEvent("mic", s)),
            on_error=lambda s: self.events.put(BackendEvent("error", s)),
        )
        self.worker = threading.Thread(
            target=run,
            kwargs={
                "config": config,
                "stop_event": self.stop_event,
                "hooks": hooks,
                "enable_signal_handlers": False,
            },
            daemon=True,
        )
        self.worker.start()
        return True

    def stop(self) -> None:
        if self.stop_event:
            self.stop_event.set()
        if self.worker and self.worker.is_alive():
            self.worker.join(timeout=1.0)
