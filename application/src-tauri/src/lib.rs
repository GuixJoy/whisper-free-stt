mod audio;
#[cfg(test)]
mod bench;
mod compute;
mod config;
mod control;
mod llm;
mod models;
mod output;
mod parakeet;
mod pipeline;
#[cfg(test)]
mod tests;
mod vad;
mod whisper;
mod widget;

use crate::config::AppConfig;
use crate::models::ModelManager;
use crate::models::ModelStatus;
use rusqlite::Connection;
use serde::Serialize;
use tauri::{Emitter, Manager};
use thiserror::Error;

// ---------------------------------------------------------------------------
// Error types (thiserror pattern from Tauri v2 docs)
// ---------------------------------------------------------------------------

#[derive(Debug, Error)]
enum AppError {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Tauri error: {0}")]
    Tauri(#[from] tauri::Error),

    #[error("Config error: {0}")]
    Config(String),

    #[error("Audio error: {0}")]
    Audio(String),
}

impl AppError {
    /// Stable, machine-readable discriminant. The frontend branches on this
    /// instead of pattern-matching human-readable message text.
    fn kind(&self) -> &'static str {
        match self {
            Self::Database(_) => "database",
            Self::Io(_) => "io",
            Self::Tauri(_) => "tauri",
            Self::Config(_) => "config",
            Self::Audio(_) => "audio",
        }
    }
}

/// Wire shape for a command error: `{ kind, message }`.
///
/// This used to serialize as a bare string (`serialize_str`), so the frontend
/// could only display an error, never branch on it — every failure looked the
/// same regardless of cause.
#[derive(serde::Serialize)]
struct ErrorPayload {
    kind: &'static str,
    message: String,
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        ErrorPayload {
            kind: self.kind(),
            message: self.to_string(),
        }
        .serialize(serializer)
    }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
struct DictionaryEntry {
    id: i64,
    phrase: String,
    replacement: String,
    category: String,
    notes: String,
    use_count: i64,
    is_favorite: bool,
    auto_learned: bool,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize)]
struct TranscriptRow {
    id: i64,
    raw_text: String,
    processed_text: String,
    language: String,
    mode: String,
    model: String,
    duration_sec: f64,
    favorite: i64,
    created_at: String,
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

fn history_db_path() -> Result<std::path::PathBuf, AppError> {
    Ok(crate::config::history_db_path())
}

/// Open the history DB, creating the `transcripts` schema if it is absent.
///
/// This is the only bootstrap for `history.db` — the plugin-sql migrations
/// were registered against a different file (`stt.db`) that nothing reads, so
/// a fresh install had no `transcripts` table and every history read/write
/// failed with "no such table: transcripts".
fn open_history_db() -> Result<Connection, AppError> {
    let conn = Connection::open(crate::config::history_db_path())?;
    ensure_history_schema(&conn)?;
    Ok(conn)
}

fn ensure_history_schema(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS transcripts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            raw_text TEXT NOT NULL,
            processed_text TEXT NOT NULL DEFAULT '',
            language TEXT DEFAULT '',
            mode TEXT DEFAULT 'cleanup',
            favorite INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            model TEXT DEFAULT '',
            duration_sec REAL DEFAULT 0.0
        );",
    )
}

#[tauri::command]
async fn get_history(limit: usize) -> Result<Vec<TranscriptRow>, AppError> {
    let rows = tauri::async_runtime::spawn_blocking(move || {
        let conn = open_history_db()?;
        let mut stmt = conn.prepare(
            "SELECT id, raw_text, processed_text, language, mode, model, duration_sec, favorite, created_at
             FROM transcripts ORDER BY created_at DESC LIMIT ?1",
        )?;
        let rows = stmt
            .query_map([limit as i64], |row| {
                Ok(TranscriptRow {
                    id: row.get(0)?,
                    raw_text: row.get(1)?,
                    processed_text: row.get(2)?,
                    language: row.get(3)?,
                    mode: row.get(4)?,
                    model: row.get(5)?,
                    duration_sec: row.get(6)?,
                    favorite: row.get(7)?,
                    created_at: row.get(8)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok::<Vec<TranscriptRow>, AppError>(rows)
    })
    .await??;
    Ok(rows)
}

#[tauri::command]
async fn delete_history_entry(id: i64) -> Result<bool, AppError> {
    let ok = tauri::async_runtime::spawn_blocking(move || {
        let conn = open_history_db()?;
        let deleted = conn.execute("DELETE FROM transcripts WHERE id = ?1", [id])?;
        Ok::<bool, AppError>(deleted > 0)
    })
    .await??;
    Ok(ok)
}

#[tauri::command]
async fn toggle_history_favorite(id: i64) -> Result<i64, AppError> {
    let db_path = history_db_path()?;
    // Single statement so concurrent toggles can't both read the same
    // value and lose an update.
    let new_val = tauri::async_runtime::spawn_blocking(move || {
        let conn = Connection::open(db_path)?;
        let new_val: i64 = conn.query_row(
            "UPDATE transcripts SET favorite = 1 - favorite WHERE id = ?1 RETURNING favorite",
            [id],
            |row| row.get(0),
        )?;
        Ok::<i64, AppError>(new_val)
    })
    .await??;
    Ok(new_val)
}

// ---------------------------------------------------------------------------
// Insights types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InsightsCategory {
    name: String,
    words: i64,
    max_words: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InsightsStreak {
    current: i64,
    longest: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InsightsHeatmapDay {
    date: String,
    level: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InsightsData {
    wpm: i64,
    wpm_trend: i64,
    total_words: i64,
    words_this_week: i64,
    words_trend: i64,
    ai_fixes: i64,
    categories: Vec<InsightsCategory>,
    streak: InsightsStreak,
    heatmap: Vec<InsightsHeatmapDay>,
    weekly_words: Vec<WeeklyWordDay>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WeeklyWordDay {
    label: String,
    words: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct VoiceIntelligenceData {
    most_active_day: String,
    most_productive_hour: String,
    avg_dictation_length: String,
    most_used_language: String,
    most_active_day_words: i64,
    peak_voice_usage: String,
    per_utterance: String,
    language_percentage: i64,
}

// ---------------------------------------------------------------------------
// Dictionary commands
// ---------------------------------------------------------------------------

fn ensure_dict_table(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS dictionary_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phrase TEXT NOT NULL UNIQUE,
            replacement TEXT NOT NULL,
            category TEXT DEFAULT 'custom',
            notes TEXT DEFAULT '',
            use_count INTEGER DEFAULT 0,
            is_favorite INTEGER DEFAULT 0,
            auto_learned INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );",
    )
}

#[tauri::command]
async fn get_dictionary(
    search: Option<String>,
    category: Option<String>,
    favorite: Option<bool>,
) -> Result<Vec<DictionaryEntry>, AppError> {
    let db_path = history_db_path()?;
    let rows = tauri::async_runtime::spawn_blocking(move || {
        let conn = Connection::open(db_path)?;
        ensure_dict_table(&conn)?;

        let sql = "SELECT id, phrase, replacement, category, notes, use_count, is_favorite, auto_learned, created_at, updated_at
             FROM dictionary_entries ORDER BY is_favorite DESC, updated_at DESC";
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt
            .query_map([], |row| {
                Ok(DictionaryEntry {
                    id: row.get(0)?,
                    phrase: row.get(1)?,
                    replacement: row.get(2)?,
                    category: row.get(3)?,
                    notes: row.get(4)?,
                    use_count: row.get(5)?,
                    is_favorite: row.get::<_, i64>(6)? != 0,
                    auto_learned: row.get::<_, i64>(7)? != 0,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        // Filter in-memory (simpler than dynamic SQL on rusqlite)
        let rows: Vec<DictionaryEntry> = rows.into_iter()
            .filter(|r| {
                if let Some(ref s) = search {
                    if !s.trim().is_empty() && !r.phrase.to_lowercase().contains(&s.trim().to_lowercase()) {
                        return false;
                    }
                }
                if let Some(ref cat) = category {
                    if !cat.trim().is_empty() && r.category != cat.trim() {
                        return false;
                    }
                }
                if favorite.unwrap_or(false) && !r.is_favorite {
                    return false;
                }
                true
            })
            .collect();

        Ok::<Vec<DictionaryEntry>, AppError>(rows)
    })
    .await??;
    Ok(rows)
}

#[tauri::command]
async fn add_dictionary_entry(
    phrase: String,
    replacement: String,
    category: Option<String>,
    notes: Option<String>,
) -> Result<Option<DictionaryEntry>, AppError> {
    let db_path = history_db_path()?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        let conn = Connection::open(db_path)?;
        ensure_dict_table(&conn)?;

        let phrase = phrase.trim();
        let replacement = replacement.trim();
        if phrase.is_empty() || replacement.is_empty() || phrase.len() > 60 || replacement.len() > 60 {
            return Ok::<Option<DictionaryEntry>, AppError>(None);
        }

        let cat = category.unwrap_or_else(|| "custom".into());
        let nts = notes.unwrap_or_default();

        conn.execute(
            "INSERT OR IGNORE INTO dictionary_entries (phrase, replacement, category, notes) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![phrase, replacement, cat, nts],
        )?;

        let last_id = conn.last_insert_rowid();
        if last_id == 0 {
            return Ok(None);
        }

        let mut stmt = conn.prepare(
            "SELECT id, phrase, replacement, category, notes, use_count, is_favorite, auto_learned, created_at, updated_at
             FROM dictionary_entries WHERE id = ?1",
        )?;
        let entry = stmt.query_row([last_id], |row| {
            Ok(DictionaryEntry {
                id: row.get(0)?,
                phrase: row.get(1)?,
                replacement: row.get(2)?,
                category: row.get(3)?,
                notes: row.get(4)?,
                use_count: row.get(5)?,
                is_favorite: row.get::<_, i64>(6)? != 0,
                auto_learned: row.get::<_, i64>(7)? != 0,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })?;
        Ok(Some(entry))
    })
    .await??;
    Ok(result)
}

#[tauri::command]
async fn update_dictionary_entry(
    id: i64,
    phrase: Option<String>,
    replacement: Option<String>,
    category: Option<String>,
    notes: Option<String>,
) -> Result<Option<DictionaryEntry>, AppError> {
    let db_path = history_db_path()?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        let conn = Connection::open(db_path)?;
        ensure_dict_table(&conn)?;

        if let Some(ref p) = phrase {
            if !p.trim().is_empty() && p.trim().len() <= 60 {
                conn.execute("UPDATE dictionary_entries SET phrase = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
                    rusqlite::params![p.trim(), id])?;
            }
        }
        if let Some(ref r) = replacement {
            if !r.trim().is_empty() && r.trim().len() <= 60 {
                conn.execute("UPDATE dictionary_entries SET replacement = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
                    rusqlite::params![r.trim(), id])?;
            }
        }
        if let Some(ref cat) = category {
            if !cat.trim().is_empty() {
                conn.execute("UPDATE dictionary_entries SET category = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
                    rusqlite::params![cat, id])?;
            }
        }
        if let Some(ref n) = notes {
            conn.execute("UPDATE dictionary_entries SET notes = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
                rusqlite::params![n, id])?;
        }

        let mut stmt = conn.prepare(
            "SELECT id, phrase, replacement, category, notes, use_count, is_favorite, auto_learned, created_at, updated_at
             FROM dictionary_entries WHERE id = ?1",
        )?;
        let entry = stmt.query_row([id], |row| {
            Ok(DictionaryEntry {
                id: row.get(0)?,
                phrase: row.get(1)?,
                replacement: row.get(2)?,
                category: row.get(3)?,
                notes: row.get(4)?,
                use_count: row.get(5)?,
                is_favorite: row.get::<_, i64>(6)? != 0,
                auto_learned: row.get::<_, i64>(7)? != 0,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })?;
        Ok::<Option<DictionaryEntry>, AppError>(Some(entry))
    })
    .await??;
    Ok(result)
}

#[tauri::command]
async fn delete_dictionary_entry(id: i64) -> Result<bool, AppError> {
    let db_path = history_db_path()?;
    let ok = tauri::async_runtime::spawn_blocking(move || {
        let conn = Connection::open(db_path)?;
        ensure_dict_table(&conn)?;
        conn.execute("DELETE FROM dictionary_entries WHERE id = ?1", [id])?;
        Ok::<bool, AppError>(true)
    })
    .await??;
    Ok(ok)
}

#[tauri::command]
async fn toggle_dictionary_favorite(id: i64) -> Result<Option<bool>, AppError> {
    let db_path = history_db_path()?;
    // Single statement so concurrent toggles can't both read the same
    // value and lose an update.
    let result = tauri::async_runtime::spawn_blocking(move || {
        let conn = Connection::open(db_path)?;
        ensure_dict_table(&conn)?;

        let new_val: i64 = conn.query_row(
            "UPDATE dictionary_entries SET is_favorite = 1 - is_favorite, updated_at = CURRENT_TIMESTAMP WHERE id = ?1 RETURNING is_favorite",
            [id],
            |row| row.get(0),
        )?;
        Ok::<Option<bool>, AppError>(Some(new_val != 0))
    })
    .await??;
    Ok(result)
}

#[tauri::command]
async fn import_dictionary_csv(csv_text: String) -> Result<serde_json::Value, AppError> {
    let db_path = history_db_path()?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        let conn = Connection::open(db_path)?;
        ensure_dict_table(&conn)?;

        let mut imported: u32 = 0;
        let mut skipped: u32 = 0;

        let mut reader = csv::ReaderBuilder::new()
            .has_headers(false)
            .flexible(true)
            .from_reader(csv_text.as_bytes());

        for record in reader.records() {
            if imported >= 1000 {
                skipped += 1;
                continue;
            }
            let row = match record {
                Ok(r) => r,
                Err(_) => {
                    skipped += 1;
                    continue;
                }
            };
            let fields: Vec<&str> = row.iter().collect();
            if fields.is_empty() || fields.iter().all(|f| f.trim().is_empty()) {
                continue;
            }
            let phrase = fields[0].trim();
            let replacement = if fields.len() >= 2 {
                fields[1].trim()
            } else {
                phrase
            };

            if phrase.is_empty()
                || replacement.is_empty()
                || phrase.len() > 60
                || replacement.len() > 60
            {
                skipped += 1;
                continue;
            }

            match conn.execute(
                "INSERT OR IGNORE INTO dictionary_entries (phrase, replacement) VALUES (?1, ?2)",
                rusqlite::params![phrase, replacement],
            ) {
                Ok(1) => imported += 1,
                _ => skipped += 1,
            }
        }

        Ok::<serde_json::Value, AppError>(serde_json::json!({
            "imported": imported,
            "skipped": skipped,
        }))
    })
    .await??;
    Ok(result)
}

#[tauri::command]
async fn export_dictionary_csv() -> Result<serde_json::Value, AppError> {
    let db_path = history_db_path()?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        let conn = Connection::open(db_path)?;
        ensure_dict_table(&conn)?;

        let mut stmt = conn.prepare(
            "SELECT phrase, replacement FROM dictionary_entries ORDER BY is_favorite DESC, updated_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

        let mut csv_lines = vec!["phrase,replacement".to_string()];
        for row in rows {
            let (phrase, replacement) = row?;
            let escaped_p = phrase.replace('"', "\"\"");
            let escaped_r = replacement.replace('"', "\"\"");
            csv_lines.push(format!("\"{}\",\"{}\"", escaped_p, escaped_r));
        }

        Ok::<serde_json::Value, AppError>(serde_json::json!({
            "csv": csv_lines.join("\n"),
        }))
    })
    .await??;
    Ok(result)
}

#[tauri::command]
async fn get_insights() -> Result<InsightsData, AppError> {
    let db_path = history_db_path()?;
    let data = tauri::async_runtime::spawn_blocking(move || {
        let conn = Connection::open(&db_path)?;

        // Total words (all time)
        let total_words: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(LENGTH(raw_text) - LENGTH(REPLACE(raw_text, ' ', '')) + 1), 0) FROM transcripts WHERE raw_text != ''",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);

        // Words this week
        let words_this_week: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(LENGTH(raw_text) - LENGTH(REPLACE(raw_text, ' ', '')) + 1), 0) FROM transcripts WHERE raw_text != '' AND created_at >= datetime('now', '-7 days')",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);

        // Words last week
        let words_prev_week: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(LENGTH(raw_text) - LENGTH(REPLACE(raw_text, ' ', '')) + 1), 0) FROM transcripts WHERE raw_text != '' AND created_at >= datetime('now', '-14 days') AND created_at < datetime('now', '-7 days')",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);

        // WPM
        let wpm: i64 = conn
            .query_row(
                "SELECT COALESCE(AVG((LENGTH(raw_text) - LENGTH(REPLACE(raw_text, ' ', '')) + 1) / MAX(duration_sec / 60.0, 0.001)), 0) FROM transcripts WHERE raw_text != '' AND duration_sec > 0",
                [],
                |r| r.get::<_, f64>(0).map(|v| v as i64),
            )
            .unwrap_or(0);

        // WPM this week
        let wpm_now: i64 = conn
            .query_row(
                "SELECT COALESCE(AVG((LENGTH(raw_text) - LENGTH(REPLACE(raw_text, ' ', '')) + 1) / MAX(duration_sec / 60.0, 0.001)), 0) FROM transcripts WHERE raw_text != '' AND duration_sec > 0 AND created_at >= datetime('now', '-7 days')",
                [],
                |r| r.get::<_, f64>(0).map(|v| v as i64),
            )
            .unwrap_or(0);

        // WPM last week
        let wpm_prev: i64 = conn
            .query_row(
                "SELECT COALESCE(AVG((LENGTH(raw_text) - LENGTH(REPLACE(raw_text, ' ', '')) + 1) / MAX(duration_sec / 60.0, 0.001)), 0) FROM transcripts WHERE raw_text != '' AND duration_sec > 0 AND created_at >= datetime('now', '-14 days') AND created_at < datetime('now', '-7 days')",
                [],
                |r| r.get::<_, f64>(0).map(|v| v as i64),
            )
            .unwrap_or(0);

        // AI fixes
        let ai_fixes: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM transcripts WHERE processed_text != '' AND processed_text != raw_text AND mode != 'off'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);

        // Categories by mode
        let mut categories = Vec::new();
        {
            let mut stmt = conn.prepare(
                "SELECT mode, COALESCE(SUM(LENGTH(raw_text) - LENGTH(REPLACE(raw_text, ' ', '')) + 1), 0) as words FROM transcripts WHERE raw_text != '' AND mode != 'off' GROUP BY mode ORDER BY words DESC",
            )?;
            let rows = stmt.query_map([], |row| {
                let mode: String = row.get(0)?;
                let words: i64 = row.get(1)?;
                Ok((mode, words))
            })?;
            let mode_map = |m: &str| -> &str {
                match m {
                    "cleanup" => "AI Prompts",
                    "email" => "Emails",
                    "bullet_list" => "Documents",
                    "commit_message" => "Messages",
                    _ => "Other",
                }
            };
            for r in rows.flatten() {
                let (mode, words) = r;
                categories.push(InsightsCategory {
                    name: mode_map(&mode).to_string(),
                    words,
                    max_words: total_words.max(1),
                });
            }
            // Add uncategorized (mode='off') — merge into existing "Other" if present
            let other_words: i64 = conn
                .query_row(
                    "SELECT COALESCE(SUM(LENGTH(raw_text) - LENGTH(REPLACE(raw_text, ' ', '')) + 1), 0) FROM transcripts WHERE raw_text != '' AND mode = 'off'",
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            if other_words > 0 {
                if let Some(existing) = categories.iter_mut().find(|c| c.name == "Other") {
                    existing.words += other_words;
                } else {
                    categories.push(InsightsCategory {
                        name: "Other".to_string(),
                        words: other_words,
                        max_words: total_words.max(1),
                    });
                }
            }
        }

        // Streak: consecutive days with at least one transcript
        let (current_streak, longest_streak) = {
            // Get all distinct days with transcripts, ordered descending
            let dates: Vec<String> = {
                let mut stmt = conn.prepare(
                    "SELECT DISTINCT date(created_at) as day FROM transcripts ORDER BY day DESC",
                )?;
                let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
                rows.filter_map(|r| r.ok()).collect()
            };

            let day_set: std::collections::HashSet<&str> = dates.iter().map(|s| s.as_str()).collect();

            // Current streak: count backwards from today using SQLite date functions
            let current = {
                let mut count = 0i64;
                // Manual date stepping using SQLite
                for offset in 0..2000i64 {
                    let check: String = conn
                        .query_row(
                            "SELECT date('now', '-' || ?1 || ' days')",
                            [offset],
                            |r| r.get(0),
                        )
                        .unwrap_or_default();
                    if day_set.contains(check.as_str()) {
                        count += 1;
                    } else {
                        break;
                    }
                }
                count
            };

            // Longest streak: scan all sorted dates
            let mut longest = 0i64;
            let mut temp = 1i64;
            for i in 1..dates.len() {
                // Use SQLite to check if dates are consecutive
                let diff: i64 = conn
                    .query_row(
                        "SELECT julianday(?1) - julianday(?2)",
                        [&dates[i - 1], &dates[i]],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                if diff == 1 {
                    temp += 1;
                } else {
                    longest = longest.max(temp);
                    temp = 1;
                }
            }
            longest = longest.max(temp);

            (current, longest)
        };

        // Heatmap: transcripts per day for last 182 days (fill zero-activity days)
        let heatmap = {
            let mut activity_map = std::collections::HashMap::new();
            let mut stmt = conn.prepare(
                "SELECT date(created_at) as day, COUNT(*) as cnt FROM transcripts WHERE created_at >= datetime('now', '-182 days') GROUP BY day",
            )?;
            let rows = stmt.query_map([], |row| {
                let day: String = row.get(0)?;
                let cnt: i64 = row.get(1)?;
                Ok((day, cnt))
            })?;
            for r in rows.flatten() {
                activity_map.insert(r.0, r.1);
            }
            let mut heatmap = Vec::new();
            for offset in (0..182i64).rev() {
                let day: String = conn
                    .query_row("SELECT date('now', '-' || ?1 || ' days')", [offset], |r| r.get(0))
                    .unwrap_or_default();
                let cnt = activity_map.get(&day).copied().unwrap_or(0);
                let level = match cnt {
                    0 => 0,
                    1..=2 => 1,
                    3..=5 => 2,
                    6..=10 => 3,
                    _ => 4,
                };
                heatmap.push(InsightsHeatmapDay { date: day, level });
            }
            heatmap
        };

        // Trend percentages
        let wpm_trend = if wpm_prev > 0 {
            ((wpm_now - wpm_prev) as f64 / wpm_prev as f64 * 100.0).round() as i64
        } else {
            0
        };
        let words_trend = if words_prev_week > 0 {
            ((words_this_week - words_prev_week) as f64 / words_prev_week as f64 * 100.0).round() as i64
        } else {
            0
        };

        // Weekly word counts per day (last 7 days) for bar chart
        let weekly_words = {
            let day_names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
            let mut result = Vec::new();
            for offset in (0..7i64).rev() {
                let day: String = conn
                    .query_row(
                        "SELECT date('now', '-' || ?1 || ' days')",
                        [offset],
                        |r| r.get(0),
                    )
                    .unwrap_or_default();
                let words: i64 = conn
                    .query_row(
                        "SELECT COALESCE(SUM(LENGTH(raw_text) - LENGTH(REPLACE(raw_text, ' ', '')) + 1), 0) FROM transcripts WHERE raw_text != '' AND date(created_at) = ?1",
                        [&day],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                // Convert to day-of-week name
                let dow: String = conn
                    .query_row("SELECT strftime('%w', ?1)", [&day], |r| r.get(0))
                    .unwrap_or_default();
                let idx = dow.parse::<usize>().unwrap_or(0);
                result.push(WeeklyWordDay {
                    label: day_names[idx].to_string(),
                    words,
                });
            }
            result
        };

        Ok::<InsightsData, AppError>(InsightsData {
            wpm,
            wpm_trend,
            total_words,
            words_this_week,
            words_trend,
            ai_fixes,
            categories,
            streak: InsightsStreak {
                current: current_streak,
                longest: longest_streak,
            },
            heatmap,
            weekly_words,
        })
    })
    .await??;
    Ok(data)
}

#[tauri::command]
async fn get_voice_intelligence() -> Result<VoiceIntelligenceData, AppError> {
    let db_path = history_db_path()?;
    let data = tauri::async_runtime::spawn_blocking(move || {
        let conn = Connection::open(&db_path)?;

        // Most active day of week
        let (most_active_day, most_active_day_words): (String, i64) = conn
            .query_row(
                "SELECT CASE CAST(strftime('%w', created_at) AS INTEGER) \
                 WHEN 0 THEN 'Sunday' WHEN 1 THEN 'Monday' WHEN 2 THEN 'Tuesday' \
                 WHEN 3 THEN 'Wednesday' WHEN 4 THEN 'Thursday' WHEN 5 THEN 'Friday' \
                 ELSE 'Saturday' END, \
                 COALESCE(SUM(LENGTH(raw_text) - LENGTH(REPLACE(raw_text, ' ', '')) + 1), 0) \
                 FROM transcripts WHERE raw_text != '' GROUP BY strftime('%w', created_at) ORDER BY 2 DESC LIMIT 1",
                [],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)),
            )
            .unwrap_or(("—".into(), 0));

        // Most productive hour
        let (most_productive_hour, peak_sessions): (i64, i64) = conn
            .query_row(
                "SELECT CAST(strftime('%H', created_at) AS INTEGER) as h, COUNT(*) as cnt \
                 FROM transcripts GROUP BY h ORDER BY cnt DESC LIMIT 1",
                [],
                |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
            )
            .unwrap_or((0, 0));
        let hour_label = match most_productive_hour {
            0 => "12 AM".into(),
            1..=11 => format!("{} AM", most_productive_hour),
            12 => "12 PM".into(),
            13..=23 => format!("{} PM", most_productive_hour - 12),
            _ => "—".into(),
        };

        // Average dictation length
        let avg_duration: f64 = conn
            .query_row(
                "SELECT COALESCE(AVG(duration_sec), 0) FROM transcripts WHERE duration_sec > 0",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0.0);
        let avg_dictation = if avg_duration > 0.0 {
            if avg_duration < 60.0 {
                format!("{:.0} seconds", avg_duration)
            } else {
                format!("{:.1} minutes", avg_duration / 60.0)
            }
        } else {
            "—".into()
        };

        // Most used language
        let (most_used_lang, lang_sessions): (String, i64) = conn
            .query_row(
                "SELECT language, COUNT(*) as cnt FROM transcripts \
                 WHERE language != '' GROUP BY language ORDER BY cnt DESC LIMIT 1",
                [],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)),
            )
            .unwrap_or(("—".into(), 0));
        let total_sessions: i64 = conn
            .query_row("SELECT COUNT(*) FROM transcripts WHERE language != ''", [], |r| r.get(0))
            .unwrap_or(0);
        let language_pct = if total_sessions > 0 {
            (lang_sessions as f64 / total_sessions as f64 * 100.0).round() as i64
        } else {
            0
        };

        Ok::<VoiceIntelligenceData, AppError>(VoiceIntelligenceData {
            most_active_day,
            most_productive_hour: hour_label,
            avg_dictation_length: avg_dictation,
            most_used_language: most_used_lang,
            most_active_day_words,
            peak_voice_usage: format!("{} sessions", peak_sessions),
            per_utterance: if avg_duration > 0.0 { format!("Avg {:.1}s", avg_duration) } else { "No data".into() },
            language_percentage: language_pct,
        })
    })
    .await??;
    Ok(data)
}

#[tauri::command]
async fn start_listening(app: tauri::AppHandle) -> Result<(), AppError> {
    eprintln!("[backend] start_listening invoked");
    // Model loading and the lazy VAD download are blocking, and
    // `reqwest::blocking` must never run on the async runtime: its internal
    // tokio runtime panics on drop there ("Cannot drop a runtime in a context
    // where blocking is not allowed"). Tauri runs non-async command bodies
    // inside `async_runtime::spawn`, so this must be an async command that
    // hands the work to the blocking pool.
    let result = tauri::async_runtime::spawn_blocking(move || {
        let config = AppConfig::load();
        crate::pipeline::start_pipeline(app, config)
    })
    .await
    .map_err(|e| AppError::Audio(format!("pipeline task failed: {e}")))?;

    match &result {
        Ok(_) => eprintln!("[backend] start_listening OK"),
        Err(e) => eprintln!("[backend] start_listening FAILED: {}", e),
    }
    result.map_err(|e| AppError::Audio(e.to_string()))
}

#[tauri::command]
fn stop_listening() {
    crate::pipeline::stop_pipeline();
}

/// Engine warm state for the start-up notice: "warming" while the
/// background warm thread runs, "ready" once its engines are cached,
/// "cold" when models are missing (first press downloads instead).
#[tauri::command]
fn engine_status() -> &'static str {
    if crate::pipeline::is_warming() {
        "warming"
    } else if crate::pipeline::is_ready() {
        "ready"
    } else {
        "cold"
    }
}

#[tauri::command]
fn check_model_status() -> Result<Vec<ModelStatus>, AppError> {
    let config = AppConfig::load();
    let manager = ModelManager::new(config.model_dir);
    Ok(manager.status())
}

#[tauri::command]
fn download_model(app: tauri::AppHandle, id: String) -> Result<(), AppError> {
    let config = AppConfig::load();
    // Double-click while a fetch runs: the progress bar is already moving,
    // stay silent instead of erroring.
    if crate::models::is_downloading(&config.model_dir.join(&id)) {
        return Ok(());
    }
    let manager = ModelManager::new(config.model_dir);
    // Blocking HTTP download — run it on a plain thread so the command
    // returns immediately and no runtime is involved.
    std::thread::spawn(move || {
        let emit_progress = |percent: usize, bytes: u64| {
            let _ = app.emit(
                "model_download_progress",
                serde_json::json!({"id": id, "percent": percent, "bytes": bytes}),
            );
        };
        match manager.download(&id, emit_progress) {
            Ok(()) => {
                let _ = app.emit(
                    "model_download_progress",
                    serde_json::json!({"id": id, "percent": 100, "done": true}),
                );
            }
            Err(e) => {
                eprintln!("[models] download_model {} failed: {}", id, e);
                let _ = app.emit(
                    "model_download_error",
                    serde_json::json!({"id": id, "error": e.to_string()}),
                );
            }
        }
    });
    Ok(())
}

#[tauri::command]
async fn set_floure_config(update: crate::config::SettingsUpdate) -> Result<(), AppError> {
    let mut config = AppConfig::load();
    config.apply_update(update);
    config.save().map_err(|e| AppError::Config(e.to_string()))
}

#[tauri::command]
fn set_openrouter_api_key(key: String) {
    crate::llm::set_openrouter_api_key(key);
}

#[tauri::command]
fn delete_model_file(path: String) -> Result<(), AppError> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Ok(());
    }
    // Confine deletion to the models dir: the path arrives over IPC and
    // must never resolve outside it (symlinks included — hence canonicalize).
    let root = AppConfig::load()
        .model_dir
        .canonicalize()
        .map_err(AppError::Io)?;
    let p = std::path::Path::new(&path)
        .canonicalize()
        .map_err(AppError::Io)?;
    if !p.starts_with(&root) {
        return Err(AppError::Io(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "refusing to delete outside the models directory",
        )));
    }
    if p.is_dir() {
        std::fs::remove_dir_all(&p).map_err(AppError::Io)?;
    } else if p.is_file() {
        std::fs::remove_file(&p).map_err(AppError::Io)?;
    }
    Ok(())
}

#[tauri::command]
fn check_system_deps() -> serde_json::Value {
    let platform = std::env::consts::OS;
    let mut checks: Vec<serde_json::Value> = Vec::new();

    if platform == "linux" {
        let has_pulse = std::process::Command::new("sh")
            .arg("-c")
            .arg("command -v pactl")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        checks.push(serde_json::json!({
            "name": "Audio Server",
            "status": if has_pulse { "pass" } else { "fail" },
            "message": if has_pulse { "PulseAudio/PipeWire detected" } else { "PulseAudio/PipeWire not found" },
            "fixHint": if has_pulse { None::<&str> } else { Some("Install: sudo apt install pipewire-pulse") }
        }));

        let has_audio_access = if has_pulse {
            std::process::Command::new("pactl")
                .arg("info")
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
        } else {
            false
        };

        checks.push(serde_json::json!({
            "name": "Audio Group",
            "status": if has_audio_access { "pass" } else { "warning" },
            "message": if has_audio_access { "Audio access available" } else { "May need audio group membership" },
            "fixHint": if has_audio_access { None::<&str> } else {
                Some("Run: sudo usermod -aG audio $USER   then log out and back in")
            }
        }));

        let has_clipboard = std::process::Command::new("sh")
            .arg("-c")
            .arg("command -v wl-copy || command -v xclip")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        checks.push(serde_json::json!({
            "name": "Clipboard Tool",
            "status": if has_clipboard { "pass" } else { "warning" },
            "message": if has_clipboard { "wl-copy or xclip available" } else { "No clipboard tool found" },
            "fixHint": if has_clipboard { None::<&str> } else { Some("Install: sudo apt install wl-clipboard xclip") }
        }));

        // Typing is the app's whole point: without the tool for this display
        // server the transcript is never typed. Check it explicitly — this
        // was previously unverified, so a machine missing it passed the
        // checks and then silently failed at output time.
        let (_, display_server) = crate::output::detect_platform();
        let typing_tool = if display_server == "wayland" {
            "wtype"
        } else {
            "xdotool"
        };
        let has_typing = std::process::Command::new("sh")
            .arg("-c")
            .arg(format!("command -v {typing_tool}"))
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        checks.push(serde_json::json!({
            "name": "Typing Tool",
            "status": if has_typing { "pass" } else { "fail" },
            "message": if has_typing {
                format!("{typing_tool} available ({display_server})")
            } else {
                format!("{typing_tool} not found ({display_server}) — transcripts will not be typed")
            },
            "fixHint": if has_typing { None::<&str> } else {
                Some(if display_server == "wayland" {
                    "Install: sudo apt install wtype"
                } else {
                    "Install: sudo apt install xdotool"
                })
            }
        }));
    } else if platform == "macos" {
        checks.push(serde_json::json!({
            "name": "Audio Server", "status": "pass", "message": "CoreAudio available", "fixHint": null
        }));
        checks.push(serde_json::json!({
            "name": "Clipboard Tool", "status": "pass", "message": "pbcopy available", "fixHint": null
        }));
    } else {
        checks.push(serde_json::json!({
            "name": "Audio Server", "status": "pass", "message": "WASAPI available", "fixHint": null
        }));
        checks.push(serde_json::json!({
            "name": "Clipboard Tool", "status": "pass", "message": "clip.exe available", "fixHint": null
        }));
    }

    serde_json::json!(checks)
}

// ---------------------------------------------------------------------------
// App entry point
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            check_system_deps,
            check_model_status,
            download_model,
            delete_model_file,
            get_history,
            delete_history_entry,
            toggle_history_favorite,
            get_insights,
            get_voice_intelligence,
            get_dictionary,
            add_dictionary_entry,
            update_dictionary_entry,
            delete_dictionary_entry,
            toggle_dictionary_favorite,
            import_dictionary_csv,
            export_dictionary_csv,
            set_floure_config,
            set_openrouter_api_key,
            start_listening,
            stop_listening,
            engine_status,
            widget::show_widget,
            widget::hide_widget,
            widget::toggle_widget
        ])
        .setup(|app| {
            // --- Local control channel (Waybar, compositor hotkeys) ---
            // Loopback-only; bind failures are non-fatal (logged in control.rs).
            control::start_control_server(app.handle().clone());

            // --- Background engine warm-up: first press must not pay load ---
            let warm_handle = app.handle().clone();
            std::thread::spawn(move || {
                crate::pipeline::warm_engines(
                    warm_handle,
                    crate::config::AppConfig::load(),
                );
            });

            // --- System tray with start/stop menu ---
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::TrayIconBuilder;

            let show_item = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let start_item =
                MenuItem::with_id(app, "start", "Start Listening", true, None::<&str>)?;
            let stop_item = MenuItem::with_id(app, "stop", "Stop Listening", true, None::<&str>)?;
            let toggle_widget_item =
                MenuItem::with_id(app, "toggle_widget", "Toggle Widget", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[
                    &show_item,
                    &start_item,
                    &stop_item,
                    &toggle_widget_item,
                    &quit_item,
                ],
            )?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("STT — Speech to Text")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "start" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.emit("tray-action", "start");
                        }
                    }
                    "stop" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.emit("tray-action", "stop");
                        }
                    }
                    "toggle_widget" => {
                        let _ = widget::toggle_widget(app.clone());
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            // --- Minimize to tray instead of closing ---
            if let Some(window) = app.get_webview_window("main") {
                let window_clone = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        // Prevent close, minimize to tray instead
                        api.prevent_close();
                        let _ = window_clone.hide();
                    }
                });
            }

            // NOTE (Wayland): compositors ignore alwaysOnTop. The previous
            // re-show-on-blur workaround stole focus in a loop, so it was
            // removed. On sway/hyprland, pin the widget with a WM rule, e.g.:
            //   sway: for_window [app_id="floure"] floating enable, sticky enable
            //   hypr: windowrulev2 = float, title:(floure)

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
