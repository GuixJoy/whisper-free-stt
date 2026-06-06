"""Milestone 1 desktop UI shell (Tkinter) for STT."""

from __future__ import annotations

import argparse
import queue
import threading
import time
import tkinter as tk
from dataclasses import dataclass
from tkinter import ttk

from stt.cli import build_arg_parser, build_config, load_dotenv, _ensure_cuda_libs
from stt.orchestrator import RunHooks, run


@dataclass(frozen=True)
class TranscriptEntry:
    raw: str = ""
    cleaned: str = ""


class STTDesktopApp:
    def __init__(self, root: tk.Tk, args: argparse.Namespace):
        self.root = root
        self.args = args
        self.config = build_config(args)
        self.events: queue.Queue[tuple[str, object]] = queue.Queue()
        self.stop_event: threading.Event | None = None
        self.worker: threading.Thread | None = None
        self.transcripts: list[TranscriptEntry] = []
        self.show_raw = tk.BooleanVar(value=False)
        self.armed = tk.BooleanVar(value=True)
        self.status_var = tk.StringVar(value="Idle")
        self.activity_var = tk.StringVar(value="Ready")
        self.shortcut_var = tk.StringVar(value="Shortcuts: Ctrl+Space start/stop • Ctrl+Shift+C copy")
        self.mic_level_var = tk.DoubleVar(value=0.0)
        self._copy_flash_job: str | None = None
        self._build_ui()
        self._bind_shortcuts()
        self.root.after(40, self._drain_events)

    def _build_ui(self) -> None:
        self.root.title("STT Sketch")
        self.root.geometry("980x680")
        self.root.minsize(760, 520)
        bg = "#f9f4e8"
        ink = "#2b2623"
        accent = "#2f9e8f"
        card = "#fffdf6"
        self.root.configure(bg=bg)

        style = ttk.Style(self.root)
        style.theme_use("clam")
        style.configure("Sketch.TFrame", background=bg)
        style.configure("Card.TFrame", background=card, borderwidth=2, relief="groove")
        style.configure("Sketch.TLabel", background=bg, foreground=ink, font=("TkDefaultFont", 10))
        style.configure("Status.TLabel", background=card, foreground=ink, font=("TkDefaultFont", 24, "bold"))
        style.configure("Sketch.TButton", padding=8)
        style.configure("Sketch.Horizontal.TProgressbar", troughcolor="#efe7d6", background=accent, bordercolor=ink)

        outer = ttk.Frame(self.root, style="Sketch.TFrame", padding=16)
        outer.pack(fill="both", expand=True)

        top = ttk.Frame(outer, style="Card.TFrame", padding=14)
        top.pack(fill="x")

        status_row = ttk.Frame(top, style="Card.TFrame")
        status_row.pack(fill="x")
        ttk.Label(status_row, text="Status", style="Sketch.TLabel").pack(anchor="w")
        ttk.Label(status_row, textvariable=self.status_var, style="Status.TLabel").pack(anchor="w", pady=(2, 10))

        self.mic_meter = ttk.Progressbar(
            status_row,
            maximum=1.0,
            variable=self.mic_level_var,
            style="Sketch.Horizontal.TProgressbar",
            length=300,
        )
        self.mic_meter.pack(anchor="w")

        controls = ttk.Frame(top, style="Card.TFrame")
        controls.pack(fill="x", pady=(12, 0))
        self.start_btn = ttk.Button(controls, text="Start", command=self.toggle_listening, style="Sketch.TButton")
        self.start_btn.pack(side="left", padx=(0, 8))
        ttk.Button(controls, text="Push to Talk", command=self._ptt_tap, style="Sketch.TButton").pack(side="left", padx=(0, 8))
        ttk.Checkbutton(controls, text="Armed", variable=self.armed, command=self._sync_armed).pack(side="left", padx=(0, 8))
        ttk.Button(controls, text="Copy Transcript", command=self.copy_latest, style="Sketch.TButton").pack(side="left", padx=(0, 8))
        ttk.Button(controls, text="Clear Transcript", command=self.clear_transcripts, style="Sketch.TButton").pack(side="left")

        ttk.Label(top, textvariable=self.shortcut_var, style="Sketch.TLabel").pack(anchor="w", pady=(12, 0))

        body = ttk.Frame(outer, style="Card.TFrame", padding=12)
        body.pack(fill="both", expand=True, pady=(14, 10))

        header = ttk.Frame(body, style="Card.TFrame")
        header.pack(fill="x")
        ttk.Label(header, text="Transcript", style="Sketch.TLabel").pack(side="left")
        ttk.Checkbutton(
            header,
            text="Show raw transcript",
            variable=self.show_raw,
            command=self._refresh_transcript,
        ).pack(side="right")

        self.transcript_text = tk.Text(
            body,
            wrap="word",
            height=20,
            bg=card,
            fg=ink,
            bd=0,
            highlightthickness=0,
            font=("TkDefaultFont", 11),
            padx=6,
            pady=8,
        )
        self.transcript_text.pack(fill="both", expand=True, pady=(8, 0))
        self.transcript_text.configure(state="disabled")

        footer = ttk.Frame(outer, style="Card.TFrame", padding=8)
        footer.pack(fill="x")
        ttk.Label(footer, textvariable=self.activity_var, style="Sketch.TLabel").pack(anchor="w")

    def _bind_shortcuts(self) -> None:
        self.root.bind("<Control-space>", lambda _evt: self.toggle_listening())
        self.root.bind("<Control-Shift-C>", lambda _evt: self.copy_latest())

    def _sync_armed(self) -> None:
        if not self.armed.get():
            self.stop_listening()
            self._set_status("Idle")
            self.activity_var.set("Sleeping (disarmed)")
        else:
            self.activity_var.set("Armed")

    def _ptt_tap(self) -> None:
        if self.worker and self.worker.is_alive():
            self.stop_listening()
        elif self.armed.get():
            self.start_listening()

    def toggle_listening(self) -> None:
        if self.worker and self.worker.is_alive():
            self.stop_listening()
            return
        if not self.armed.get():
            self.activity_var.set("Cannot start while disarmed")
            return
        self.start_listening()

    def start_listening(self) -> None:
        if self.worker and self.worker.is_alive():
            return
        self.stop_event = threading.Event()
        hooks = RunHooks(
            on_state=lambda s: self.events.put(("state", s)),
            on_activity=lambda m: self.events.put(("activity", m)),
            on_partial=lambda t: self.events.put(("partial", t)),
            on_raw=lambda t: self.events.put(("raw", t)),
            on_processed=lambda t: self.events.put(("processed", t)),
            on_mic_level=lambda r: self.events.put(("mic", r)),
            on_error=lambda m: self.events.put(("error", m)),
        )
        self.worker = threading.Thread(
            target=run,
            kwargs={
                "config": self.config,
                "stop_event": self.stop_event,
                "hooks": hooks,
                "enable_signal_handlers": False,
            },
            daemon=True,
        )
        self.worker.start()
        self.start_btn.configure(text="Stop")
        self._set_status("Listening")
        self.activity_var.set("Listening")

    def stop_listening(self) -> None:
        if self.stop_event:
            self.stop_event.set()
        self.start_btn.configure(text="Start")
        self._set_status("Idle")

    def copy_latest(self) -> None:
        text = self._latest_display_text()
        if not text:
            self.activity_var.set("Nothing to copy")
            return
        self.root.clipboard_clear()
        self.root.clipboard_append(text)
        self.root.update_idletasks()
        self._set_status("Copied")
        self.activity_var.set("Transcript copied to clipboard")
        if self._copy_flash_job:
            self.root.after_cancel(self._copy_flash_job)
        self._copy_flash_job = self.root.after(900, lambda: self._set_status("Idle"))

    def clear_transcripts(self) -> None:
        self.transcripts.clear()
        self._refresh_transcript()
        self.activity_var.set("Transcript cleared")

    def _latest_display_text(self) -> str:
        if not self.transcripts:
            return ""
        latest = self.transcripts[-1]
        if self.show_raw.get():
            return latest.raw or latest.cleaned
        return latest.cleaned or latest.raw

    def _refresh_transcript(self) -> None:
        lines: list[str] = []
        for item in self.transcripts:
            text = item.raw if self.show_raw.get() else (item.cleaned or item.raw)
            if text:
                lines.append(text)
        self.transcript_text.configure(state="normal")
        self.transcript_text.delete("1.0", "end")
        if lines:
            self.transcript_text.insert("1.0", "\n\n".join(lines))
        else:
            self.transcript_text.insert("1.0", "No transcript yet. Press Start and speak.")
        self.transcript_text.configure(state="disabled")

    def _set_status(self, state: str) -> None:
        self.status_var.set(state)
        if state == "Listening":
            self.start_btn.configure(text="Stop")
        elif state in {"Idle", "Error"}:
            self.start_btn.configure(text="Start")

    def _drain_events(self) -> None:
        try:
            while True:
                kind, payload = self.events.get_nowait()
                if kind == "state":
                    state_map = {
                        "idle": "Idle",
                        "listening": "Listening",
                        "transcribing": "Transcribing",
                        "rewriting": "Rewriting",
                        "copied": "Copied",
                        "error": "Error",
                    }
                    self._set_status(state_map.get(str(payload), "Idle"))
                elif kind == "activity":
                    self.activity_var.set(str(payload))
                elif kind == "partial":
                    self.activity_var.set(f"Partial: {payload}")
                elif kind == "raw":
                    self.transcripts.append(TranscriptEntry(raw=str(payload), cleaned=""))
                    self._refresh_transcript()
                elif kind == "processed":
                    if not self.transcripts:
                        self.transcripts.append(TranscriptEntry(raw=str(payload), cleaned=str(payload)))
                    else:
                        last = self.transcripts[-1]
                        self.transcripts[-1] = TranscriptEntry(raw=last.raw, cleaned=str(payload))
                    self._refresh_transcript()
                elif kind == "mic":
                    rms = float(payload)
                    level = max(0.0, min(1.0, rms * 30.0))
                    self.mic_level_var.set(level)
                elif kind == "error":
                    self._set_status("Error")
                    self.activity_var.set(str(payload))
        except queue.Empty:
            pass

        if self.worker and not self.worker.is_alive() and self.status_var.get() == "Listening":
            self._set_status("Idle")
            self.activity_var.set("Stopped")
        self.root.after(40, self._drain_events)


def main(argv: list[str] | None = None) -> None:
    load_dotenv()
    _ensure_cuda_libs()
    parser = build_arg_parser()
    args = parser.parse_args(argv)
    root = tk.Tk()
    app = STTDesktopApp(root, args)

    def _on_close() -> None:
        app.stop_listening()
        time.sleep(0.05)
        root.destroy()

    root.protocol("WM_DELETE_WINDOW", _on_close)
    root.mainloop()


if __name__ == "__main__":
    main()
