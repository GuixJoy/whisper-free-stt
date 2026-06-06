use tauri_plugin_sql::{Migration, MigrationKind};

#[tauri::command]
fn get_backend_path() -> Result<String, String> {
    // Try to find the Python STT backend relative to the binary
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
    // Fall back to stt in PATH
    Ok("stt".to_string())
}

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
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:stt.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![get_backend_path])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
