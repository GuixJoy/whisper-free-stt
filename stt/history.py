"""Async SQLite persistence for transcript history.

Thread-safe, fire-and-forget writes. The orchestrator calls write() in a
daemon thread so the streaming pipeline is never blocked by I/O.

Schema mirrors stt-ui/src-tauri/src/lib.rs migrations:
  transcripts(id, raw_text, processed_text, language, mode, model,
              duration_sec, favorite, created_at)
  transcripts_fts (FTS5 virtual table, auto-synced via triggers)
"""

from __future__ import annotations

import os
import sqlite3
import threading
import time
from pathlib import Path
from typing import Optional

from stt.log import get_logger

logger = get_logger(__name__)


def default_db_path() -> Path:
    """Get the default history database path.
    
    Uses $STT_DATA_DIR if set, otherwise ~/.local/share/stt/history.db
    """
    if data_dir := os.environ.get("STT_DATA_DIR"):
        return Path(data_dir).expanduser() / "history.db"
    return Path("~/.local/share/stt/history.db").expanduser()


class HistoryStore:
    """Thread-safe async transcript store backed by local SQLite."""

    def __init__(self, db_path: str | Path | None = None) -> None:
        path = Path(db_path) if db_path else default_db_path()
        resolved = path.expanduser().resolve()
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
                CREATE TABLE IF NOT EXISTS dictionary_entries (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    phrase TEXT NOT NULL,
                    replacement TEXT NOT NULL,
                    category TEXT DEFAULT 'custom',
                    notes TEXT DEFAULT '',
                    use_count INTEGER DEFAULT 0,
                    is_favorite INTEGER DEFAULT 0,
                    auto_learned INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(phrase)
                );
                CREATE INDEX IF NOT EXISTS idx_dict_category ON dictionary_entries(category);
                CREATE INDEX IF NOT EXISTS idx_dict_favorite ON dictionary_entries(is_favorite);
                CREATE INDEX IF NOT EXISTS idx_dict_phrase ON dictionary_entries(phrase);
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

    @staticmethod
    def _sanitize_fts_query(text: str) -> str:
        """Sanitize text for FTS5 MATCH query.
        
        Removes FTS5 special characters and operators to prevent injection.
        Only keeps alphanumeric terms longer than 2 characters.
        """
        import re
        words = re.findall(r'\b[a-zA-Z]{3,}\b', text.lower())
        return " OR ".join(words) if words else ""

    def search_similar(
        self,
        raw_text: str,
        limit: int = 3,
    ) -> list[dict[str, object]]:
        """FTS5 full-text search for similar past transcripts (fast, no embedding needed)."""
        try:
            with self._conn() as conn:
                terms = self._sanitize_fts_query(raw_text)
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
                    today = datetime.now(datetime.UTC).date()
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

                # Weekly word counts per day (last 7 days) for bar chart
                weekly_words = []
                for i in range(6, -1, -1):
                    row_day = conn.execute(
                        """SELECT date('now', '-' || ? || ' days'),
                                  COALESCE(SUM(LENGTH(raw_text) - LENGTH(REPLACE(raw_text, ' ', '')) + 1), 0)
                           FROM transcripts WHERE raw_text != '' AND date(created_at) = date('now', '-' || ? || ' days')""",
                        (i, i),
                    ).fetchone()
                    day_label = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
                    from datetime import datetime as _dt
                    d = _dt.now(_dt.UTC).date() - __import__("datetime").timedelta(days=i)
                    weekly_words.append({"label": day_label[d.weekday()], "words": int(row_day[1]) if row_day else 0})

                return {
                    "wpm": wpm,
                    "wpmTrend": wpm_trend,
                    "totalWords": total_words,
                    "wordsTrend": words_trend,
                    "aiFixes": ai_fixes,
                    "categories": categories,
                    "streak": {"current": current_streak, "longest": longest_streak},
                    "heatmap": heatmap,
                    "weeklyWords": weekly_words,
                }
        except Exception as e:
            return {"wpm": 0, "wpmTrend": 0, "totalWords": 0, "wordsTrend": 0, "aiFixes": 0, "categories": [], "streak": {"current": 0, "longest": 0}, "heatmap": [], "weeklyWords": []}

    def get_voice_intelligence(self) -> dict[str, object]:
        """Compute voice intelligence insights from transcript history."""
        try:
            from datetime import datetime, timedelta
            with self._conn() as conn:
                # Most active day of week
                day_rows = conn.execute(
                    """SELECT strftime('%w', created_at) as dow,
                              COUNT(*) as cnt,
                              COALESCE(SUM(LENGTH(raw_text) - LENGTH(REPLACE(raw_text, ' ', '')) + 1), 0) as words
                       FROM transcripts WHERE raw_text != '' GROUP BY dow ORDER BY words DESC"""
                ).fetchall()
                dow_names = {0: "Sunday", 1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday"}
                most_active_day = "—"
                most_active_day_words = 0
                if day_rows:
                    most_active_day = dow_names.get(int(day_rows[0][0]), "—")
                    most_active_day_words = int(day_rows[0][2])

                # Most productive hour
                hour_rows = conn.execute(
                    """SELECT strftime('%H', created_at) as hour, COUNT(*) as cnt
                       FROM transcripts GROUP BY hour ORDER BY cnt DESC"""
                ).fetchall()
                most_productive_hour = "—"
                if hour_rows:
                    h = int(hour_rows[0][0])
                    if h == 0: most_productive_hour = "12 AM"
                    elif h < 12: most_productive_hour = f"{h} AM"
                    elif h == 12: most_productive_hour = "12 PM"
                    else: most_productive_hour = f"{h - 12} PM"

                # Average dictation length
                avg_row = conn.execute(
                    "SELECT COALESCE(AVG(duration_sec), 0) FROM transcripts WHERE duration_sec > 0"
                ).fetchone()
                avg_duration = float(avg_row[0]) if avg_row else 0
                if avg_duration > 0:
                    if avg_duration < 60:
                        avg_dictation = f"{avg_duration:.0f} seconds"
                    else:
                        avg_dictation = f"{avg_duration / 60:.1f} minutes"
                else:
                    avg_dictation = "—"

                # Most used language
                lang_rows = conn.execute(
                    """SELECT language, COUNT(*) as cnt FROM transcripts
                       WHERE language != '' GROUP BY language ORDER BY cnt DESC"""
                ).fetchall()
                most_used_language = "—"
                language_pct = 0
                if lang_rows:
                    most_used_language = lang_rows[0][0]
                    total_sessions = sum(int(r[1]) for r in lang_rows)
                    language_pct = round(int(lang_rows[0][1]) / total_sessions * 100) if total_sessions > 0 else 0

                return {
                    "mostActiveDay": most_active_day,
                    "mostProductiveHour": most_productive_hour,
                    "avgDictationLength": avg_dictation,
                    "mostUsedLanguage": most_used_language,
                    "mostActiveDayWords": most_active_day_words,
                    "peakVoiceUsage": f"{int(hour_rows[0][1])} sessions" if hour_rows else "No sessions",
                    "perUtterance": f"Avg {avg_duration:.1f}s" if avg_duration > 0 else "No data",
                    "languagePercentage": language_pct,
                }
        except Exception:
            return {
                "mostActiveDay": "—", "mostProductiveHour": "—",
                "avgDictationLength": "—", "mostUsedLanguage": "—",
                "mostActiveDayWords": 0, "peakVoiceUsage": "No sessions",
                "perUtterance": "No data", "languagePercentage": 0,
            }

    def search_history(self, query: str, limit: int = 50) -> list[dict[str, object]]:
        """Full-text search across transcript history."""
        try:
            with self._conn() as conn:
                terms = self._sanitize_fts_query(query)
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
                    cursor = conn.execute("DELETE FROM transcripts WHERE id = ?", (entry_id,))
                    conn.commit()
                    return cursor.rowcount > 0
        except Exception:
            return False


    # ------------------------------------------------------------------
    # Dictionary CRUD
    # ------------------------------------------------------------------

    def list_dictionary(
        self,
        search: str = "",
        category: str = "",
        favorite_only: bool = False,
    ) -> list[dict[str, object]]:
        try:
            with self._conn() as conn:
                clauses = ["1=1"]
                params: list = []
                if search.strip():
                    clauses.append("phrase LIKE ?")
                    params.append(f"%{search.strip()}%")
                if category.strip():
                    clauses.append("category = ?")
                    params.append(category.strip())
                if favorite_only:
                    clauses.append("is_favorite = 1")
                where = " AND ".join(clauses)
                rows = conn.execute(
                    f"""SELECT id, phrase, replacement, category, notes,
                               use_count, is_favorite, auto_learned,
                               created_at, updated_at
                        FROM dictionary_entries
                        WHERE {where}
                        ORDER BY is_favorite DESC, updated_at DESC""",
                    params,
                ).fetchall()
                return [
                    {
                        "id": r[0],
                        "phrase": r[1],
                        "replacement": r[2],
                        "category": r[3],
                        "notes": r[4],
                        "use_count": r[5],
                        "is_favorite": bool(r[6]),
                        "auto_learned": bool(r[7]),
                        "created_at": r[8],
                        "updated_at": r[9],
                    }
                    for r in rows
                ]
        except Exception:
            return []

    def get_dictionary_entry(self, entry_id: int) -> dict[str, object] | None:
        try:
            with self._conn() as conn:
                row = conn.execute(
                    """SELECT id, phrase, replacement, category, notes,
                              use_count, is_favorite, auto_learned,
                              created_at, updated_at
                       FROM dictionary_entries WHERE id = ?""",
                    (entry_id,),
                ).fetchone()
                if row is None:
                    return None
                return {
                    "id": row[0],
                    "phrase": row[1],
                    "replacement": row[2],
                    "category": row[3],
                    "notes": row[4],
                    "use_count": row[5],
                    "is_favorite": bool(row[6]),
                    "auto_learned": bool(row[7]),
                    "created_at": row[8],
                    "updated_at": row[9],
                }
        except Exception:
            return None

    def add_dictionary_entry(
        self,
        phrase: str,
        replacement: str,
        category: str = "custom",
        notes: str = "",
        auto_learned: bool = False,
    ) -> dict[str, object] | None:
        phrase = phrase.strip()
        replacement = replacement.strip()
        if not phrase or not replacement:
            return None
        if len(phrase) > 60 or len(replacement) > 60:
            return None
        try:
            with self._write_lock:
                with self._conn() as conn:
                    cur = conn.execute(
                        """INSERT OR IGNORE INTO dictionary_entries
                           (phrase, replacement, category, notes, auto_learned)
                           VALUES (?, ?, ?, ?, ?)""",
                        (phrase, replacement, category, notes, int(auto_learned)),
                    )
                    conn.commit()
                    if cur.lastrowid == 0:
                        return None
                    return self.get_dictionary_entry(cur.lastrowid)
        except Exception as exc:
            logger.error("dictionary add failed: %s", exc)
            return None

    def update_dictionary_entry(
        self,
        entry_id: int,
        phrase: str = "",
        replacement: str = "",
        category: str = "",
        notes: str = "",
    ) -> dict[str, object] | None:
        try:
            with self._write_lock:
                with self._conn() as conn:
                    updates = []
                    params: list = []
                    if phrase.strip():
                        if len(phrase.strip()) > 60:
                            return None
                        updates.append("phrase = ?")
                        params.append(phrase.strip())
                    if replacement.strip():
                        if len(replacement.strip()) > 60:
                            return None
                        updates.append("replacement = ?")
                        params.append(replacement.strip())
                    if category.strip():
                        updates.append("category = ?")
                        params.append(category.strip())
                    if notes is not None:
                        updates.append("notes = ?")
                        params.append(notes.strip())
                    if not updates:
                        return self.get_dictionary_entry(entry_id)
                    updates.append("updated_at = CURRENT_TIMESTAMP")
                    params.append(entry_id)
                    conn.execute(
                        f"UPDATE dictionary_entries SET {', '.join(updates)} WHERE id = ?",
                        params,
                    )
                    conn.commit()
                    return self.get_dictionary_entry(entry_id)
        except Exception as exc:
            logger.error("dictionary update failed: %s", exc)
            return None

    def delete_dictionary_entry(self, entry_id: int) -> bool:
        try:
            with self._write_lock:
                with self._conn() as conn:
                    cursor = conn.execute(
                        "DELETE FROM dictionary_entries WHERE id = ?",
                        (entry_id,),
                    )
                    conn.commit()
                    return cursor.rowcount > 0
        except Exception:
            return False

    def toggle_dictionary_favorite(self, entry_id: int) -> bool | None:
        try:
            with self._write_lock:
                with self._conn() as conn:
                    row = conn.execute(
                        "SELECT is_favorite FROM dictionary_entries WHERE id = ?",
                        (entry_id,),
                    ).fetchone()
                    if row is None:
                        return None
                    new_val = 0 if row[0] else 1
                    conn.execute(
                        "UPDATE dictionary_entries SET is_favorite = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                        (new_val, entry_id),
                    )
                    conn.commit()
                    return bool(new_val)
        except Exception:
            return None

    def increment_dictionary_use_count(self, entry_id: int) -> bool:
        try:
            with self._write_lock:
                with self._conn() as conn:
                    conn.execute(
                        "UPDATE dictionary_entries SET use_count = use_count + 1 WHERE id = ?",
                        (entry_id,),
                    )
                    conn.commit()
                    return True
        except Exception:
            return False

    def get_dict_replacements(self) -> list[dict[str, str]]:
        try:
            with self._conn() as conn:
                rows = conn.execute(
                    """SELECT phrase, replacement FROM dictionary_entries
                       ORDER BY is_favorite DESC, LENGTH(phrase) DESC"""
                ).fetchall()
                return [{"phrase": r[0], "replacement": r[1]} for r in rows]
        except Exception:
            return []

    def get_dict_hotwords(self, weighted: bool = False) -> str:
        """Return comma-separated phrases AND replacements for ASR word boosting.
        
        Boosting both forms covers all entry types:
        - Identity (API→API): boosts the word itself
        - Expansion (CEO→Chief Executive Officer): boosts the short form user speaks
        - Correction (flouray→Floure): boosts the correct target form
        
        When weighted=True, starred terms get higher boost (faster-whisper syntax).
        Otherwise returns plain comma-separated terms (whisper.cpp compatible).
        """
        try:
            with self._conn() as conn:
                rows = conn.execute(
                    "SELECT phrase, replacement, is_favorite FROM dictionary_entries ORDER BY is_favorite DESC"
                ).fetchall()
                terms: list[str] = []
                seen: set[str] = set()
                for r in rows:
                    for term in (r[0], r[1]):
                        term = term.strip()
                        if term and term not in seen:
                            if weighted and r[2]:
                                terms.append(f"{term}:5.0")
                            elif weighted:
                                terms.append(f"{term}:2.0")
                            else:
                                terms.append(term)
                            seen.add(term)
                return ", ".join(terms)
        except Exception:
            return ""

    def import_dictionary_csv(self, csv_text: str) -> dict[str, int]:
        import csv as _csv
        imported = 0
        skipped = 0
        try:
            reader = _csv.reader(csv_text.splitlines())
            with self._write_lock:
                with self._conn() as conn:
                    first_row = True
                    for row in reader:
                        if not row or not any(cell.strip() for cell in row):
                            continue
                        # Skip CSV header row from export
                        if first_row and len(row) >= 2:
                            if row[0].strip().lower() == "phrase" and row[1].strip().lower() == "replacement":
                                first_row = False
                                continue
                        first_row = False
                        if len(row) == 1:
                            phrase = row[0].strip()
                            replacement = phrase
                        elif len(row) >= 2:
                            phrase = row[0].strip()
                            replacement = row[1].strip()
                        else:
                            skipped += 1
                            continue
                        if not phrase or not replacement:
                            skipped += 1
                            continue
                        if len(phrase) > 60 or len(replacement) > 60:
                            skipped += 1
                            continue
                        if imported >= 1000:
                            skipped += 1
                            continue
                        try:
                            cur = conn.execute(
                                """INSERT OR IGNORE INTO dictionary_entries
                                   (phrase, replacement) VALUES (?, ?)""",
                                (phrase, replacement),
                            )
                            if cur.rowcount and cur.rowcount > 0:
                                imported += 1
                            else:
                                skipped += 1
                        except Exception:
                            skipped += 1
                    conn.commit()
        except Exception as exc:
            logger.error("dictionary csv import failed: %s", exc)
        return {"imported": imported, "skipped": skipped}

    def export_dictionary_csv(self) -> str:
        try:
            with self._conn() as conn:
                rows = conn.execute(
                    """SELECT phrase, replacement FROM dictionary_entries
                       ORDER BY is_favorite DESC, updated_at DESC"""
                ).fetchall()
            lines = ["phrase,replacement"]
            for r in rows:
                p = r[0].replace('"', '""')
                rep = r[1].replace('"', '""')
                lines.append(f'"{p}","{rep}"')
            return "\n".join(lines)
        except Exception:
            return ""

    def build_dict_llm_context(self) -> str:
        """Layer 3: Build a dictionary-aware context string for LLM prompt injection.
        
        Only includes starred entries and correction/expansion entries (not identities).
        Tells the LLM to preserve specific terms and avoid phonetic alternatives.
        """
        try:
            with self._conn() as conn:
                rows = conn.execute(
                    """SELECT phrase, replacement, is_favorite
                       FROM dictionary_entries
                       WHERE phrase != replacement
                       ORDER BY is_favorite DESC, use_count DESC
                       LIMIT 20"""
                ).fetchall()
            if not rows:
                return ""
            lines = [
                "IMPORTANT DICTIONARY: The following terms must appear exactly as shown.",
                "Do NOT replace them with similar-sounding alternatives."
            ]
            for phrase, replacement, is_fav in rows:
                fav_mark = "★ " if is_fav else ""
                lines.append(f"  {fav_mark}\"{phrase}\" → \"{replacement}\"")
            return "\n".join(lines)
        except Exception:
            return ""

    def apply_dictionary_replacements(self, text: str) -> str:
        """Layer 1: Exact regex word-boundary replacement."""
        import re
        replacements = self.get_dict_replacements()
        for entry in replacements:
            phrase = entry["phrase"]
            replacement = entry["replacement"]
            pattern = re.compile(r'(?<!\w)' + re.escape(phrase) + r'(?!\w)', flags=re.IGNORECASE)
            if phrase != replacement:
                text, count = pattern.subn(replacement, text)
                if count > 0:
                    self._incr_use_count(phrase, count)
                    logger.debug("dict exact", phrase=phrase, replacement=replacement, count=count)
            else:
                matches = pattern.findall(text)
                if matches:
                    self._incr_use_count(phrase, len(matches))
        return text

    def apply_fuzzy_replacements(self, text: str) -> str:
        """Layer 2: Fuzzy phonetic matching using Levenshtein ratio.
        
        For words NOT matched by exact replacement, checks Levenshtein
        similarity against dictionary phrases. Thresholds:
        - words <= 4 chars: ratio >= 0.75 (strict — avoids false positives on short words)
        - words 5-6 chars: ratio >= 0.65
        - words >= 7 chars: ratio >= 0.60
        
        Also handles concatenated forms like "FloryFloor" by trying sliding-window
        substring matching against dictionary phrases.
        
        Only operates on correction/expansion entries (phrase != replacement).
        """
        import re
        import difflib

        entries = self.get_dict_replacements()
        fuzzy_entries = [(e["phrase"].lower(), e["replacement"], e["phrase"]) 
                         for e in entries if e["phrase"].lower() != e["replacement"].lower()]
        if not fuzzy_entries:
            return text

        fuzzy_hits: dict[str, int] = {}

        def _lev_ratio(a: str, b: str) -> float:
            return difflib.SequenceMatcher(None, a, b).ratio()

        def _threshold(max_len: int) -> float:
            if max_len <= 4:
                return 0.75
            elif max_len <= 6:
                return 0.65
            else:
                return 0.60

        def _find_best(token_lower: str):
            best_ratio = 0.0
            best_replacement = ""
            best_phrase = ""
            for phrase_lower, replacement, orig_phrase in fuzzy_entries:
                if token_lower == replacement.lower():
                    return (1.0, replacement, orig_phrase)
                if token_lower == phrase_lower:
                    return (1.0, replacement, orig_phrase)
                max_len = max(len(token_lower), len(phrase_lower))
                if max_len == 0:
                    continue
                ratio = _lev_ratio(token_lower, phrase_lower)
                thresh = _threshold(max_len)
                if ratio > best_ratio and ratio >= thresh:
                    len_ratio = min(len(token_lower), len(phrase_lower)) / max_len
                    if len_ratio >= 0.45:
                        best_ratio = ratio
                        best_replacement = replacement
                        best_phrase = orig_phrase
            if best_ratio >= _threshold(max(len(token_lower), len(best_phrase)) if best_phrase else 1):
                return (best_ratio, best_replacement, best_phrase)
            return (0.0, "", "")

        # Split into words, preserving whitespace and punctuation
        tokens = re.split(r'(\s+|[^\w\s])', text)
        result: list[str] = []

        for token in tokens:
            if not token.isalpha() or len(token) < 2:
                result.append(token)
                continue

            token_lower = token.lower()
            best_ratio, best_replacement, best_phrase = _find_best(token_lower)

            if best_replacement:
                if token[0].isupper():
                    result.append(best_replacement)
                else:
                    result.append(best_replacement.lower() if best_replacement[0].isupper() and token[0].islower() else best_replacement)
                fuzzy_hits[best_phrase] = fuzzy_hits.get(best_phrase, 0) + 1
            else:
                result.append(token)

        # Increment use_count for fuzzy matches
        for phrase, count in fuzzy_hits.items():
            self._incr_use_count(phrase, count)

        return "".join(result)

    def _incr_use_count(self, phrase: str, count: int) -> None:
        try:
            with self._write_lock:
                with self._conn() as conn:
                    conn.execute(
                        "UPDATE dictionary_entries SET use_count = use_count + ? WHERE phrase = ?",
                        (count, phrase),
                    )
                    conn.commit()
        except Exception:
            pass


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
