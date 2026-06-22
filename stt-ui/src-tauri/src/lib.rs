mod widget;

use rusqlite::Connection;
use serde::Serialize;
use tauri::{Emitter, Manager};
use tauri_plugin_sql::{Migration, MigrationKind};
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
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

fn history_db_path() -> Result<std::path::PathBuf, AppError> {
    // Support STT_DATA_DIR env var for consistent path with Python backend
    let base = if let Ok(data_dir) = std::env::var("STT_DATA_DIR") {
        std::path::PathBuf::from(data_dir)
    } else {
        let home = dirs_next::home_dir().ok_or_else(|| {
            AppError::Io(std::io::Error::other("Could not determine home directory"))
        })?;
        home.join(".local/share/stt")
    };
    Ok(base.join("history.db"))
}

#[tauri::command]
async fn get_history(limit: usize) -> Result<Vec<TranscriptRow>, AppError> {
    let db_path = history_db_path()?;
    let rows = tauri::async_runtime::spawn_blocking(move || {
        let conn = Connection::open(db_path)?;
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
    let result = tauri::async_runtime::spawn_blocking(move || {
        let conn = Connection::open(db_path)?;
        ensure_dict_table(&conn)?;

        let current: i64 = conn.query_row(
            "SELECT is_favorite FROM dictionary_entries WHERE id = ?1",
            [id],
            |row| row.get(0),
        )?;
        let new_val = if current != 0 { 0 } else { 1 };
        conn.execute(
            "UPDATE dictionary_entries SET is_favorite = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
            rusqlite::params![new_val, id],
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
            let replacement = if fields.len() >= 2 { fields[1].trim() } else { phrase };

            if phrase.is_empty() || replacement.is_empty() || phrase.len() > 60 || replacement.len() > 60 {
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

#[derive(Debug, Serialize)]
struct ModelStatus {
    name: String,
    downloaded: bool,
    path: String,
    size_bytes: u64,
}

#[tauri::command]
fn check_model_status() -> Result<Vec<ModelStatus>, AppError> {
    let home = dirs_next::home_dir().ok_or_else(|| {
        AppError::Io(std::io::Error::other("Could not determine home directory"))
    })?;

    let mut statuses = Vec::new();

    // whisper.cpp models: ~/.local/share/pywhispercpp/models/ggml-{name}.bin
    let cpp_dir = home.join(".local/share/pywhispercpp/models");
    for name in &["tiny.en", "base.en", "small.en"] {
        let path = cpp_dir.join(format!("ggml-{}.bin", name));
        let (downloaded, size_bytes) = if path.exists() {
            let meta = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            (true, meta)
        } else {
            (false, 0)
        };
        statuses.push(ModelStatus {
            name: name.to_string(),
            downloaded,
            path: path.to_string_lossy().to_string(),
            size_bytes,
        });
    }

    // faster-whisper models: ~/.cache/huggingface/hub/models--{org}--{repo}/
    let hf_dir = home.join(".cache/huggingface/hub");
    let fw_models: Vec<(&str, &str, &str)> = vec![
        ("tiny.en", "Systran", "faster-whisper-tiny"),
        ("base.en", "Systran", "faster-whisper-base"),
        ("small.en", "Systran", "faster-whisper-small"),
        ("distil-large-v3", "Systran", "faster-distil-whisper-large-v3"),
        ("large-v3-turbo", "mobiuslabsgmbh", "faster-whisper-large-v3-turbo"),
    ];

    for (name, org, repo) in &fw_models {
        let model_dir = hf_dir.join(format!("models--{}--{}", org, repo));
        let (downloaded, size_bytes) = if model_dir.exists() {
            // Walk the directory to sum file sizes
            let total = walk_dir_size(&model_dir).unwrap_or(0);
            (total > 0, total)
        } else {
            (false, 0)
        };
        statuses.push(ModelStatus {
            name: name.to_string(),
            downloaded,
            path: model_dir.to_string_lossy().to_string(),
            size_bytes,
        });
    }

    Ok(statuses)
}

#[tauri::command]
fn delete_model_file(path: String) -> Result<(), AppError> {
    let p = std::path::Path::new(&path);
    if p.is_dir() {
        std::fs::remove_dir_all(p).map_err(AppError::Io)?;
    } else if p.is_file() {
        std::fs::remove_file(p).map_err(AppError::Io)?;
    }
    Ok(())
}

fn walk_dir_size(path: &std::path::Path) -> Result<u64, AppError> {
    let mut total = 0u64;
    if path.is_dir() {
        for entry in std::fs::read_dir(path).map_err(AppError::Io)? {
            let entry = entry.map_err(AppError::Io)?;
            let meta = entry.metadata().map_err(AppError::Io)?;
            if meta.is_file() {
                total += meta.len();
            } else if meta.is_dir() {
                total += walk_dir_size(&entry.path())?;
            }
        }
    }
    Ok(total)
}

#[tauri::command]
fn get_backend_path() -> Result<String, AppError> {
    let candidates = vec![
        std::env::current_dir()
            .unwrap_or_default()
            .join("../stt/cli.py")
            .to_string_lossy()
            .to_string(),
        "/usr/local/bin/stt".to_string(),
    ];
    for c in &candidates {
        if std::path::Path::new(c).exists() {
            return Ok(c.clone());
        }
    }
    Ok("stt".to_string())
}

#[tauri::command]
fn get_platform_info() -> serde_json::Value {
    let platform = std::env::consts::OS;
    let display_server = if platform == "linux" {
        if std::env::var("WAYLAND_DISPLAY").is_ok() {
            "wayland"
        } else if std::env::var("DISPLAY").is_ok() {
            "x11"
        } else {
            "unknown"
        }
    } else {
        "native"
    };

    let (clipboard_tool, typing_tool) = match (platform, display_server) {
        ("linux", "wayland") => ("wl-copy", "wtype"),
        ("linux", "x11") => ("xclip", "xdotool"),
        ("macos", _) => ("pbcopy", "osascript"),
        ("windows", _) => ("clip.exe", "powershell"),
        _ => ("unknown", "unknown"),
    };

    serde_json::json!({
        "platform": platform,
        "displayServer": display_server,
        "clipboardTool": clipboard_tool,
        "typingTool": typing_tool,
    })
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
    let migrations = vec![
        Migration {
            version: 1,
            description: "create transcript history table",
            sql: "CREATE TABLE IF NOT EXISTS transcripts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                raw_text TEXT NOT NULL,
                processed_text TEXT NOT NULL DEFAULT '',
                language TEXT DEFAULT '',
                mode TEXT DEFAULT 'cleanup',
                favorite INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add model and duration columns",
            sql: "ALTER TABLE transcripts ADD COLUMN model TEXT DEFAULT '';
                 ALTER TABLE transcripts ADD COLUMN duration_sec REAL DEFAULT 0.0;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "create full-text search index",
            sql: "CREATE VIRTUAL TABLE IF NOT EXISTS transcripts_fts USING fts5(
                raw_text, processed_text, content='transcripts', content_rowid='id'
            );
            CREATE TRIGGER IF NOT EXISTS transcripts_ai AFTER INSERT ON transcripts BEGIN
                INSERT INTO transcripts_fts(raw_text, processed_text) VALUES (new.raw_text, new.processed_text);
            END;
            CREATE TRIGGER IF NOT EXISTS transcripts_ad AFTER DELETE ON transcripts BEGIN
                INSERT INTO transcripts_fts(transcripts_fts, raw_text, processed_text) VALUES ('delete', old.raw_text, old.processed_text);
            END;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "create dictionary entries table",
            sql: "CREATE TABLE IF NOT EXISTS dictionary_entries (
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
            );
            CREATE INDEX IF NOT EXISTS idx_dict_category ON dictionary_entries(category);
            CREATE INDEX IF NOT EXISTS idx_dict_favorite ON dictionary_entries(is_favorite);
            CREATE INDEX IF NOT EXISTS idx_dict_phrase ON dictionary_entries(phrase);",
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:stt.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_backend_path,
            get_platform_info,
            check_system_deps,
            check_model_status,
            delete_model_file,
            get_history,
            get_dictionary,
            add_dictionary_entry,
            update_dictionary_entry,
            delete_dictionary_entry,
            toggle_dictionary_favorite,
            import_dictionary_csv,
            export_dictionary_csv,
            widget::show_widget,
            widget::hide_widget,
            widget::get_widget_visible,
            widget::get_widget_position,
            widget::set_widget_position,
            widget::toggle_widget,
            widget::detect_window_manager
        ])
        .setup(|app| {
            // --- System tray with start/stop menu ---
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};

            let show_item = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let start_item = MenuItem::with_id(app, "start", "Start Listening", true, None::<&str>)?;
            let stop_item = MenuItem::with_id(app, "stop", "Stop Listening", true, None::<&str>)?;
            let toggle_widget_item = MenuItem::with_id(app, "toggle_widget", "Toggle Widget", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &start_item, &stop_item, &toggle_widget_item, &quit_item])?;

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
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
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

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
