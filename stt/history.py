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

from kakashi import get_logger

logger = get_logger(__name__)


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
            logger.error("history write failed: %s", exc)
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

    def get_insights(self) -> dict[str, object]:
        """Compute analytics for the Insights dashboard."""
        try:
            with self._conn() as conn:
                # Total words (all time)
                row = conn.execute(
                    "SELECT COALESCE(SUM(LENGTH(raw_text) - LENGTH(REPLACE(raw_text, ' ', '')) + 1), 0) FROM transcripts WHERE raw_text != ''"
                ).fetchone()
                total_words = int(row[0]) if row else 0

                # Words this week vs last week for trend
                row_now = conn.execute(
                    """SELECT COALESCE(SUM(LENGTH(raw_text) - LENGTH(REPLACE(raw_text, ' ', '')) + 1), 0)
                       FROM transcripts WHERE raw_text != '' AND created_at >= datetime('now', '-7 days')"""
                ).fetchone()
                words_this_week = int(row_now[0]) if row_now else 0

                row_prev = conn.execute(
                    """SELECT COALESCE(SUM(LENGTH(raw_text) - LENGTH(REPLACE(raw_text, ' ', '')) + 1), 0)
                       FROM transcripts WHERE raw_text != '' AND created_at >= datetime('now', '-14 days') AND created_at < datetime('now', '-7 days')"""
                ).fetchone()
                words_prev_week = int(row_prev[0]) if row_prev else 0

                # Words per minute (avg over all sessions with duration > 0)
                row_wpm = conn.execute(
                    """SELECT COALESCE(AVG(
                         (LENGTH(raw_text) - LENGTH(REPLACE(raw_text, ' ', '')) + 1) / MAX(duration_sec / 60.0, 0.001)
                       ), 0)
                       FROM transcripts WHERE raw_text != '' AND duration_sec > 0"""
                ).fetchone()
                wpm = int(row_wpm[0]) if row_wpm else 0

                # WPM trend (this week vs last week)
                row_wpm_now = conn.execute(
                    """SELECT COALESCE(AVG(
                         (LENGTH(raw_text) - LENGTH(REPLACE(raw_text, ' ', '')) + 1) / MAX(duration_sec / 60.0, 0.001)
                       ), 0)
                       FROM transcripts WHERE raw_text != '' AND duration_sec > 0 AND created_at >= datetime('now', '-7 days')"""
                ).fetchone()
                wpm_now = int(row_wpm_now[0]) if row_wpm_now else 0

                row_wpm_prev = conn.execute(
                    """SELECT COALESCE(AVG(
                         (LENGTH(raw_text) - LENGTH(REPLACE(raw_text, ' ', '')) + 1) / MAX(duration_sec / 60.0, 0.001)
                       ), 0)
                       FROM transcripts WHERE raw_text != '' AND duration_sec > 0 AND created_at >= datetime('now', '-14 days') AND created_at < datetime('now', '-7 days')"""
                ).fetchone()
                wpm_prev = int(row_wpm_prev[0]) if row_wpm_prev else 0

                # AI fixes: rows where processed != raw (mode != 'off')
                row_fixes = conn.execute(
                    "SELECT COUNT(*) FROM transcripts WHERE processed_text != '' AND processed_text != raw_text AND mode != 'off'"
                ).fetchone()
                ai_fixes = int(row_fixes[0]) if row_fixes else 0

                # Usage breakdown by mode
                mode_rows = conn.execute(
                    """SELECT mode, COALESCE(SUM(LENGTH(raw_text) - LENGTH(REPLACE(raw_text, ' ', '')) + 1), 0) as words
                       FROM transcripts WHERE raw_text != '' AND mode != 'off'
                       GROUP BY mode ORDER BY words DESC"""
                ).fetchall()
                mode_map = {"cleanup": "AI Prompts", "email": "Emails", "bullet_list": "Documents", "commit_message": "Messages"}
                categories = []
                for r in mode_rows:
                    name = mode_map.get(r[0], r[0].title())
                    categories.append({"name": name, "words": int(r[1]), "maxWords": max(total_words, 1)})
                # Add uncategorized (mode='off') as 'Other'
                row_other = conn.execute(
                    """SELECT COALESCE(SUM(LENGTH(raw_text) - LENGTH(REPLACE(raw_text, ' ', '')) + 1), 0)
                       FROM transcripts WHERE raw_text != '' AND mode = 'off'"""
                ).fetchone()
                other_words = int(row_other[0]) if row_other else 0
                if other_words > 0:
                    categories.append({"name": "Other", "words": other_words, "maxWords": max(total_words, 1)})

                # Streak: consecutive days with at least one transcript
                streak_rows = conn.execute(
                    """SELECT DISTINCT date(created_at) as day FROM transcripts ORDER BY day DESC"""
                ).fetchall()
                days = [r[0] for r in streak_rows]

                current_streak = 0
                longest_streak = 0
                temp_streak = 0
                if days:
                    from datetime import datetime, timedelta
                    today = datetime.utcnow().date()
                    prev = None
                    for d_str in days:
                        d = datetime.strptime(d_str, "%Y-%m-%d").date() if isinstance(d_str, str) else d_str
                        if prev is None:
                            temp_streak = 1
                            prev = d
                        elif (prev - d).days == 1:
                            temp_streak += 1
                            prev = d
                        elif (prev - d).days == 0:
                            continue
                        else:
                            longest_streak = max(longest_streak, temp_streak)
                            temp_streak = 1
                            prev = d
                    longest_streak = max(longest_streak, temp_streak)
                    # Current streak: count from today backwards
                    current_streak = 0
                    check = today
                    day_set = set(days)
                    while check.isoformat() in day_set or (isinstance(day_set, set) and any(str(check) == d for d in days)):
                        current_streak += 1
                        check -= timedelta(days=1)

                # Heatmap: transcripts per day for last 182 days
                heatmap_rows = conn.execute(
                    """SELECT date(created_at) as day, COUNT(*) as cnt
                       FROM transcripts
                       WHERE created_at >= datetime('now', '-182 days')
                       GROUP BY day"""
                ).fetchall()
                heatmap = []
                for r in heatmap_rows:
                    cnt = int(r[1])
                    if cnt == 0: level = 0
                    elif cnt <= 2: level = 1
                    elif cnt <= 5: level = 2
                    elif cnt <= 10: level = 3
                    else: level = 4
                    heatmap.append({"date": r[0], "level": level})

                # Trend percentages
                wpm_trend = 0
                if wpm_prev > 0:
                    wpm_trend = round((wpm_now - wpm_prev) / wpm_prev * 100)
                words_trend = 0
                if words_prev_week > 0:
                    words_trend = round((words_this_week - words_prev_week) / words_prev_week * 100)

                return {
                    "wpm": wpm,
                    "wpmTrend": wpm_trend,
                    "totalWords": total_words,
                    "wordsTrend": words_trend,
                    "aiFixes": ai_fixes,
                    "categories": categories,
                    "streak": {"current": current_streak, "longest": longest_streak},
                    "heatmap": heatmap,
                }
        except Exception as e:
            return {"wpm": 0, "wpmTrend": 0, "totalWords": 0, "wordsTrend": 0, "aiFixes": 0, "categories": [], "streak": {"current": 0, "longest": 0}, "heatmap": []}

    def search_history(self, query: str, limit: int = 50) -> list[dict[str, object]]:
        """Full-text search across transcript history."""
        try:
            with self._conn() as conn:
                terms = " OR ".join(
                    w for w in query.lower().split()
                    if len(w) > 2 and w.isalpha()
                )
                if not terms:
                    return []
                rows = conn.execute(
                    """SELECT t.id, t.raw_text, t.processed_text, t.language, t.mode,
                              t.model, t.duration_sec, t.favorite, t.created_at
                       FROM transcripts t
                       JOIN transcripts_fts fts ON t.id = fts.rowid
                       WHERE transcripts_fts MATCH ?
                       ORDER BY rank LIMIT ?""",
                    (terms, limit),
                ).fetchall()
                return [
                    {
                        "id": r[0], "raw_text": r[1], "processed_text": r[2],
                        "language": r[3], "mode": r[4], "model": r[5],
                        "duration_sec": r[6], "favorite": r[7], "created_at": r[8],
                    }
                    for r in rows
                ]
        except Exception:
            return []

    def export_csv(self, limit: int = 1000) -> str:
        """Export history as CSV string."""
        try:
            with self._conn() as conn:
                rows = conn.execute(
                    """SELECT id, raw_text, processed_text, language, mode, model,
                              duration_sec, created_at
                       FROM transcripts ORDER BY created_at DESC LIMIT ?""",
                    (limit,),
                ).fetchall()
            lines = ["id,raw_text,processed_text,language,mode,model,duration_sec,created_at"]
            for r in rows:
                raw = r[1].replace('"', '""')
                proc = r[2].replace('"', '""')
                lines.append(f'{r[0]},"{raw}","{proc}",{r[3]},{r[4]},{r[5]},{r[6]},{r[7]}')
            return "\n".join(lines)
        except Exception:
            return ""

    def export_text(self, limit: int = 1000) -> str:
        """Export history as a formatted text file."""
        try:
            with self._conn() as conn:
                rows = conn.execute(
                    """SELECT id, raw_text, processed_text, language, mode, model,
                              duration_sec, favorite, created_at
                       FROM transcripts ORDER BY created_at DESC LIMIT ?""",
                    (limit,),
                ).fetchall()

            if not rows:
                return "STT Transcript History\n========================\n\nNo transcripts found.\n"

            earliest = rows[-1][8]
            latest = rows[0][8]

            lines = [
                "STT Transcript History",
                "=" * 40,
                f"Date range: {earliest} — {latest}",
                f"Total transcripts: {len(rows)}",
                "",
                "-" * 40,
                "",
            ]

            for r in rows:
                raw_text = r[1]
                processed_text = r[2]
                mode = r[4]
                created_at = r[8]

                lines.append(f"[{created_at}] {mode}")
                lines.append(f"  {raw_text}")
                if processed_text and processed_text != raw_text:
                    lines.append(f"  → {processed_text}")
                lines.append("")

            total_words = sum(
                len(r[1].split()) for r in rows if r[1]
            )
            ai_fixes = sum(
                1 for r in rows if r[2] and r[2] != r[1] and r[4] != "off"
            )

            lines.extend([
                "-" * 40,
                f"Summary: {len(rows)} transcripts, {total_words} total words, {ai_fixes} AI-corrected",
                "",
            ])

            return "\n".join(lines)
        except Exception:
            return ""

    def toggle_favorite(self, entry_id: int) -> Optional[bool]:
        """Toggle the favorite status of a transcript entry. Returns new state or None on failure."""
        try:
            with self._write_lock:
                with self._conn() as conn:
                    row = conn.execute(
                        "SELECT favorite FROM transcripts WHERE id = ?", (entry_id,)
                    ).fetchone()
                    if row is None:
                        return None
                    new_val = 0 if row[0] else 1
                    conn.execute(
                        "UPDATE transcripts SET favorite = ? WHERE id = ?",
                        (new_val, entry_id),
                    )
                    conn.commit()
                    return bool(new_val)
        except Exception:
            return None

    def delete_entry(self, entry_id: int) -> bool:
        """Delete a single transcript entry by ID."""
        try:
            with self._write_lock:
                with self._conn() as conn:
                    conn.execute("DELETE FROM transcripts WHERE id = ?", (entry_id,))
                    conn.commit()
                    return True
        except Exception:
            return False


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
