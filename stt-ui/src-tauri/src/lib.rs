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

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_history(limit: usize) -> Result<Vec<TranscriptRow>, AppError> {
    let db_path = dirs_next::home_dir()
        .unwrap_or_default()
        .join(".local/share/stt/history.db");
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
    Ok(rows)
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
        .invoke_handler(tauri::generate_handler![
            get_backend_path,
            get_platform_info,
            check_system_deps,
            get_history
        ])
        .setup(|app| {
            // --- System tray with start/stop menu ---
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};

            let show_item = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let start_item = MenuItem::with_id(app, "start", "Start Listening", true, None::<&str>)?;
            let stop_item = MenuItem::with_id(app, "stop", "Stop Listening", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &start_item, &stop_item, &quit_item])?;

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
