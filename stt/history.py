"""Async SQLite persistence for transcript history.

Thread-safe, fire-and-forget writes. The orchestrator calls write() in a
daemon thread so the streaming pipeline is never blocked by I/O.

Schema mirrors stt-ui/src-tauri/src/lib.rs migrations:
  transcripts(id, raw_text, processed_text, language, mode, model,
              duration_sec, favorite, created_at)
  transcripts_fts (FTS5 virtual table, auto-synced via triggers)
"""

from __future__ import annotations

import sqlite3
import threading
import time
from pathlib import Path
from typing import Optional


class HistoryStore:
    """Thread-safe async transcript store backed by local SQLite."""

    def __init__(self, db_path: str | Path = "~/.local/share/stt/history.db") -> None:
        resolved = Path(db_path).expanduser().resolve()
        resolved.parent.mkdir(parents=True, exist_ok=True)
        self._db_path = str(resolved)
        self._write_lock = threading.Lock()
        self._ensure_schema()

    # ------------------------------------------------------------------
    # Schema (idempotent)
    # ------------------------------------------------------------------

    def _ensure_schema(self) -> None:
        with self._conn() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS transcripts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    raw_text TEXT NOT NULL,
                    processed_text TEXT NOT NULL DEFAULT '',
                    language TEXT DEFAULT '',
                    mode TEXT DEFAULT 'cleanup',
                    model TEXT DEFAULT '',
                    duration_sec REAL DEFAULT 0.0,
                    favorite INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );
                CREATE VIRTUAL TABLE IF NOT EXISTS transcripts_fts USING fts5(
                    raw_text, processed_text, content='transcripts', content_rowid='id'
                );
                CREATE TRIGGER IF NOT EXISTS transcripts_ai AFTER INSERT ON transcripts BEGIN
                    INSERT INTO transcripts_fts(raw_text, processed_text)
                    VALUES (new.raw_text, new.processed_text);
                END;
                CREATE TRIGGER IF NOT EXISTS transcripts_ad AFTER DELETE ON transcripts BEGIN
                    INSERT INTO transcripts_fts(transcripts_fts, raw_text, processed_text)
                    VALUES ('delete', old.raw_text, old.processed_text);
                END;
                CREATE TRIGGER IF NOT EXISTS transcripts_au AFTER UPDATE ON transcripts BEGIN
                    INSERT INTO transcripts_fts(transcripts_fts, raw_text, processed_text)
                    VALUES ('delete', old.raw_text, old.processed_text);
                    INSERT INTO transcripts_fts(raw_text, processed_text)
                    VALUES (new.raw_text, new.processed_text);
                END;
            """)

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path, timeout=5)
        conn.execute("PRAGMA busy_timeout=3000")
        return conn

    # ------------------------------------------------------------------
    # Write (fire-and-forget safe — caller should wrap in daemon thread)
    # ------------------------------------------------------------------

    def insert(
        self,
        raw_text: str,
        processed_text: str = "",
        *,
        language: str = "",
        mode: str = "cleanup",
        model: str = "",
        duration_sec: float = 0.0,
    ) -> Optional[int]:
        """Insert a transcript row. Returns the new row id, or None on failure."""
        try:
            with self._write_lock:
                with self._conn() as conn:
                    cur = conn.execute(
                        """INSERT INTO transcripts
                           (raw_text, processed_text, language, mode, model, duration_sec)
                           VALUES (?, ?, ?, ?, ?, ?)""",
                        (raw_text, processed_text, language, mode, model, duration_sec),
                    )
                    conn.commit()
                    return cur.lastrowid
        except Exception as exc:
            print(f"[history] write failed: {exc}", flush=True)
            return None

    def write_async(
        self,
        raw_text: str,
        processed_text: str = "",
        *,
        language: str = "",
        mode: str = "cleanup",
        model: str = "",
        duration_sec: float = 0.0,
    ) -> None:
        """Fire-and-forget write in a daemon thread. Never blocks the caller."""
        threading.Thread(
            target=self.insert,
            args=(raw_text, processed_text),
            kwargs={
                "language": language,
                "mode": mode,
                "model": model,
                "duration_sec": duration_sec,
            },
            daemon=True,
        ).start()

    # ------------------------------------------------------------------
    # Query (for few-shot context injection)
    # ------------------------------------------------------------------

    def search_similar(
        self,
        raw_text: str,
        limit: int = 3,
    ) -> list[dict[str, object]]:
        """FTS5 full-text search for similar past transcripts (fast, no embedding needed)."""
        try:
            with self._conn() as conn:
                # Use FTS5 simple query — matches any term in the raw_text
                # sanitize: drop punctuation, keep alphanumeric terms
                terms = " OR ".join(
                    w for w in raw_text.lower().split()
                    if len(w) > 2 and w.isalpha()
                )
                if not terms:
                    return []

                rows = conn.execute(
                    """SELECT t.raw_text, t.processed_text, t.language, t.mode, t.model
                       FROM transcripts t
                       JOIN transcripts_fts fts ON t.id = fts.rowid
                       WHERE transcripts_fts MATCH ?
                       ORDER BY rank
                       LIMIT ?""",
                    (terms, limit),
                ).fetchall()

                return [
                    {
                        "raw_text": r[0],
                        "processed_text": r[1],
                        "language": r[2],
                        "mode": r[3],
                        "model": r[4],
                    }
                    for r in rows
                ]
        except Exception:
            return []

    def recent_cleanups(self, limit: int = 5) -> list[dict[str, object]]:
        """Return the most recent (raw, corrected) pairs for few-shot context."""
        try:
            with self._conn() as conn:
                rows = conn.execute(
                    """SELECT raw_text, processed_text
                       FROM transcripts
                       WHERE processed_text != '' AND processed_text != raw_text
                       ORDER BY created_at DESC
                       LIMIT ?""",
                    (limit,),
                ).fetchall()
                return [{"raw_text": r[0], "processed_text": r[1]} for r in rows]
        except Exception:
            return []

    def get_recent(self, limit: int = 100) -> list[dict[str, object]]:
        """Return recent transcript rows for UI display."""
        try:
            with self._conn() as conn:
                rows = conn.execute(
                    """SELECT id, raw_text, processed_text, language, mode, model,
                              duration_sec, favorite, created_at
                       FROM transcripts
                       ORDER BY created_at DESC
                       LIMIT ?""",
                    (limit,),
                ).fetchall()
                return [
                    {
                        "id": r[0],
                        "raw_text": r[1],
                        "processed_text": r[2],
                        "language": r[3],
                        "mode": r[4],
                        "model": r[5],
                        "duration_sec": r[6],
                        "favorite": r[7],
                        "created_at": r[8],
                    }
                    for r in rows
                ]
        except Exception:
            return []


# Module-level singleton — initialized lazily on first use
_store: Optional[HistoryStore] = None
_store_lock = threading.Lock()


def get_store(db_path: str | Path | None = None) -> HistoryStore:
    """Get or create the singleton HistoryStore."""
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                _store = HistoryStore(db_path) if db_path else HistoryStore()
    return _store
