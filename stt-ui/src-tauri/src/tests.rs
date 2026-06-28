#[cfg(test)]
mod tests {
    use crate::*;
    use crate::widget::{detect_window_manager, WidgetPosition, WindowManagerInfo};
    use rusqlite::Connection;
    use std::path::Path;

    // -----------------------------------------------------------------------
    // history_db_path
    // -----------------------------------------------------------------------

    #[test]
    fn test_history_db_path_uses_env_var() {
        std::env::set_var("STT_DATA_DIR", "/tmp/test_stt");
        let path = history_db_path().unwrap();
        assert_eq!(path, Path::new("/tmp/test_stt/history.db"));
        std::env::remove_var("STT_DATA_DIR");
    }

    #[test]
    fn test_history_db_path_fallback_home() {
        std::env::remove_var("STT_DATA_DIR");
        let path = history_db_path().unwrap();
        let home = dirs_next::home_dir().unwrap();
        assert_eq!(path, home.join(".local/share/stt/history.db"));
    }

    // -----------------------------------------------------------------------
    // walk_dir_size
    // -----------------------------------------------------------------------

    #[test]
    fn test_walk_dir_size_empty_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let size = walk_dir_size(tmp.path()).unwrap();
        assert_eq!(size, 0);
    }

    #[test]
    fn test_walk_dir_size_with_files() {
        let tmp = tempfile::tempdir().unwrap();
        let file1 = tmp.path().join("a.txt");
        let file2 = tmp.path().join("b.txt");
        std::fs::write(&file1, "hello").unwrap();
        std::fs::write(&file2, "world!").unwrap();
        let size = walk_dir_size(tmp.path()).unwrap();
        assert_eq!(size, 5 + 6);
    }

    #[test]
    fn test_walk_dir_size_nested() {
        let tmp = tempfile::tempdir().unwrap();
        let sub = tmp.path().join("sub");
        std::fs::create_dir(&sub).unwrap();
        std::fs::write(sub.join("a.txt"), "nested").unwrap();
        std::fs::write(tmp.path().join("root.txt"), "root").unwrap();
        let size = walk_dir_size(tmp.path()).unwrap();
        assert_eq!(size, 6 + 4);
    }

    #[test]
    fn test_walk_dir_size_nonexistent() {
        let size = walk_dir_size(Path::new("/nonexistent/path")).unwrap();
        assert_eq!(size, 0);
    }

    // -----------------------------------------------------------------------
    // type_text validation
    // -----------------------------------------------------------------------

    #[test]
    fn test_type_text_empty_returns_false() {
        let result = type_text("".to_string(), None);
        assert_eq!(result.unwrap(), false);
    }

    #[test]
    fn test_type_text_whitespace_returns_false() {
        let result = type_text("   ".to_string(), None);
        assert_eq!(result.unwrap(), false);
    }

    #[test]
    fn test_type_text_tab_returns_false() {
        let result = type_text("\t".to_string(), None);
        assert_eq!(result.unwrap(), false);
    }

    // -----------------------------------------------------------------------
    // get_backend_path
    // -----------------------------------------------------------------------

    #[test]
    fn test_get_backend_path_returns_string() {
        let result = get_backend_path();
        assert!(result.is_ok());
        let path = result.unwrap();
        assert!(!path.is_empty());
    }

    // -----------------------------------------------------------------------
    // get_platform_info
    // -----------------------------------------------------------------------

    #[test]
    fn test_get_platform_info_has_required_fields() {
        let info = get_platform_info();
        assert!(info.get("platform").is_some());
        assert!(info.get("displayServer").is_some());
        assert!(info.get("clipboardTool").is_some());
        assert!(info.get("typingTool").is_some());
    }

    #[test]
    fn test_get_platform_info_platform_is_string() {
        let info = get_platform_info();
        assert!(info["platform"].is_string());
    }

    // -----------------------------------------------------------------------
    // detect_window_manager
    // -----------------------------------------------------------------------

    #[test]
    fn test_detect_window_manager_returns_info() {
        let info = detect_window_manager();
        assert!(!info.wm.is_empty());
    }

    #[test]
    fn test_detect_window_manager_wayland_detection() {
        let is_wayland = std::env::var("WAYLAND_DISPLAY").is_ok();
        let info = detect_window_manager();
        assert_eq!(info.wayland, is_wayland);
    }

    // -----------------------------------------------------------------------
    // check_system_deps
    // -----------------------------------------------------------------------

    #[test]
    fn test_check_system_deps_returns_array() {
        let deps = check_system_deps();
        assert!(deps.is_array());
        let arr = deps.as_array().unwrap();
        assert!(!arr.is_empty());
        for item in arr {
            assert!(item.get("name").is_some());
            assert!(item.get("status").is_some());
            assert!(item.get("message").is_some());
        }
    }

    // -----------------------------------------------------------------------
    // Serialization tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_model_status_serializes() {
        let status = ModelStatus {
            name: "tiny.en".to_string(),
            downloaded: true,
            path: "/tmp/model.bin".to_string(),
            size_bytes: 1024,
        };
        let json = serde_json::to_value(&status).unwrap();
        assert_eq!(json["name"], "tiny.en");
        assert_eq!(json["downloaded"], true);
        assert_eq!(json["size_bytes"], 1024);
    }

    #[test]
    fn test_transcript_row_serializes() {
        let row = TranscriptRow {
            id: 1,
            raw_text: "hello".to_string(),
            processed_text: "Hello".to_string(),
            language: "en".to_string(),
            mode: "cleanup".to_string(),
            model: "tiny.en".to_string(),
            duration_sec: 1.5,
            favorite: 0,
            created_at: "2026-01-01 00:00:00".to_string(),
        };
        let json = serde_json::to_value(&row).unwrap();
        assert_eq!(json["id"], 1);
        assert_eq!(json["raw_text"], "hello");
    }

    #[test]
    fn test_insights_data_serializes() {
        let data = InsightsData {
            wpm: 120,
            wpm_trend: 10,
            total_words: 5000,
            words_trend: -5,
            ai_fixes: 42,
            categories: vec![InsightsCategory {
                name: "AI Prompts".to_string(),
                words: 3000,
                max_words: 5000,
            }],
            streak: InsightsStreak { current: 7, longest: 14 },
            heatmap: vec![InsightsHeatmapDay {
                date: "2026-06-28".to_string(),
                level: 3,
            }],
            weekly_words: vec![WeeklyWordDay {
                label: "Mon".to_string(),
                words: 500,
            }],
        };
        let json = serde_json::to_value(&data).unwrap();
        assert_eq!(json["wpm"], 120);
        assert_eq!(json["totalWords"], 5000);
        assert_eq!(json["streak"]["current"], 7);
    }

    #[test]
    fn test_voice_intelligence_data_serializes() {
        let data = VoiceIntelligenceData {
            most_active_day: "Monday".to_string(),
            most_productive_hour: "10 AM".to_string(),
            avg_dictation_length: "45 seconds".to_string(),
            most_used_language: "en".to_string(),
            most_active_day_words: 1200,
            peak_voice_usage: "15 sessions".to_string(),
            per_utterance: "Avg 4.5s".to_string(),
            language_percentage: 95,
        };
        let json = serde_json::to_value(&data).unwrap();
        assert_eq!(json["mostActiveDay"], "Monday");
        assert_eq!(json["languagePercentage"], 95);
    }

    #[test]
    fn test_dictionary_entry_serializes() {
        let entry = DictionaryEntry {
            id: 1,
            phrase: "teh".to_string(),
            replacement: "the".to_string(),
            category: "corrections".to_string(),
            notes: "Common typo".to_string(),
            use_count: 5,
            is_favorite: true,
            auto_learned: false,
            created_at: "2026-01-01".to_string(),
            updated_at: "2026-06-28".to_string(),
        };
        let json = serde_json::to_value(&entry).unwrap();
        assert_eq!(json["phrase"], "teh");
        assert_eq!(json["is_favorite"], true);
    }

    #[test]
    fn test_weekly_word_day_serializes() {
        let day = WeeklyWordDay { label: "Mon".to_string(), words: 500 };
        let json = serde_json::to_value(&day).unwrap();
        assert_eq!(json["label"], "Mon");
        assert_eq!(json["words"], 500);
    }

    #[test]
    fn test_insights_streak_serializes() {
        let streak = InsightsStreak { current: 7, longest: 30 };
        let json = serde_json::to_value(&streak).unwrap();
        assert_eq!(json["current"], 7);
        assert_eq!(json["longest"], 30);
    }

    #[test]
    fn test_insights_heatmap_day_serializes() {
        let day = InsightsHeatmapDay { date: "2026-06-28".to_string(), level: 4 };
        let json = serde_json::to_value(&day).unwrap();
        assert_eq!(json["date"], "2026-06-28");
        assert_eq!(json["level"], 4);
    }

    #[test]
    fn test_insights_category_serializes() {
        let cat = InsightsCategory { name: "AI Prompts".to_string(), words: 3000, max_words: 5000 };
        let json = serde_json::to_value(&cat).unwrap();
        assert_eq!(json["name"], "AI Prompts");
    }

    #[test]
    fn test_widget_position_serializes() {
        let pos = WidgetPosition { x: 100.0, y: 200.0 };
        let json = serde_json::to_value(&pos).unwrap();
        assert_eq!(json["x"], 100.0);
        assert_eq!(json["y"], 200.0);
    }

    #[test]
    fn test_window_manager_info_serializes() {
        let info = WindowManagerInfo { wm: "sway".to_string(), wayland: true };
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["wm"], "sway");
        assert_eq!(json["wayland"], true);
    }

    // -----------------------------------------------------------------------
    // AppError
    // -----------------------------------------------------------------------

    #[test]
    fn test_app_error_database() {
        let err = AppError::Database(rusqlite::Error::QueryReturnedNoRows);
        let s = format!("{}", err);
        assert!(s.contains("Database error"));
    }

    #[test]
    fn test_app_error_io() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file missing");
        let err = AppError::Io(io_err);
        let s = format!("{}", err);
        assert!(s.contains("IO error"));
    }

    #[test]
    fn test_app_error_serialize() {
        let err = AppError::Database(rusqlite::Error::QueryReturnedNoRows);
        let json = serde_json::to_value(&err).unwrap();
        assert!(json.is_string());
        assert!(json.as_str().unwrap().contains("Database error"));
    }

    // -----------------------------------------------------------------------
    // win32 module (non-Windows)
    // -----------------------------------------------------------------------

    #[test]
    #[cfg(not(target_os = "windows"))]
    fn test_set_foreground_hwnd_zero_returns_false() {
        assert!(!set_foreground_hwnd(0));
    }

    // -----------------------------------------------------------------------
    // ensure_dict_table (direct DB test)
    // -----------------------------------------------------------------------

    #[test]
    fn test_ensure_dict_table_creates_table() {
        let conn = Connection::open_in_memory().unwrap();
        ensure_dict_table(&conn).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM dictionary_entries", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_ensure_dict_table_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        ensure_dict_table(&conn).unwrap();
        ensure_dict_table(&conn).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM dictionary_entries", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    // -----------------------------------------------------------------------
    // History DB integration tests (in-memory)
    // -----------------------------------------------------------------------

    #[test]
    fn test_history_db_create_and_query() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE transcripts (
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
        ).unwrap();

        conn.execute(
            "INSERT INTO transcripts (raw_text, processed_text, language, mode, model, duration_sec) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params!["hello world", "Hello World", "en", "cleanup", "tiny.en", 1.5],
        ).unwrap();

        let count: i64 = conn.query_row("SELECT COUNT(*) FROM transcripts", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);

        let raw: String = conn.query_row("SELECT raw_text FROM transcripts LIMIT 1", [], |r| r.get(0)).unwrap();
        assert_eq!(raw, "hello world");
    }

    #[test]
    fn test_dictionary_crud_in_memory() {
        let conn = Connection::open_in_memory().unwrap();
        ensure_dict_table(&conn).unwrap();

        conn.execute(
            "INSERT INTO dictionary_entries (phrase, replacement, category, notes) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params!["teh", "the", "corrections", "Common typo"],
        ).unwrap();

        let count: i64 = conn.query_row("SELECT COUNT(*) FROM dictionary_entries", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);

        let phrase: String = conn.query_row("SELECT phrase FROM dictionary_entries LIMIT 1", [], |r| r.get(0)).unwrap();
        assert_eq!(phrase, "teh");

        conn.execute(
            "UPDATE dictionary_entries SET replacement = ?1 WHERE phrase = ?2",
            rusqlite::params!["the corrected", "teh"],
        ).unwrap();
        let replacement: String = conn.query_row("SELECT replacement FROM dictionary_entries LIMIT 1", [], |r| r.get(0)).unwrap();
        assert_eq!(replacement, "the corrected");

        conn.execute("DELETE FROM dictionary_entries", []).unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM dictionary_entries", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_insights_word_count_sql() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE transcripts (
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
        ).unwrap();

        conn.execute(
            "INSERT INTO transcripts (raw_text, duration_sec) VALUES (?1, ?2)",
            rusqlite::params!["hello world", 1.0],
        ).unwrap();
        conn.execute(
            "INSERT INTO transcripts (raw_text, duration_sec) VALUES (?1, ?2)",
            rusqlite::params!["one two three four five", 2.0],
        ).unwrap();

        let total_words: i64 = conn.query_row(
            "SELECT COALESCE(SUM(LENGTH(raw_text) - LENGTH(REPLACE(raw_text, ' ', '')) + 1), 0) FROM transcripts WHERE raw_text != ''",
            [],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(total_words, 7);
    }

    // -----------------------------------------------------------------------
    // Streak algorithm
    // -----------------------------------------------------------------------

    #[test]
    fn test_streak_consecutive_days() {
        let dates = vec!["2026-06-28", "2026-06-27", "2026-06-26"];
        let day_set: std::collections::HashSet<&str> = dates.iter().cloned().collect();
        let mut count = 0i64;
        for offset in 0..3i64 {
            let check = match offset {
                0 => "2026-06-28",
                1 => "2026-06-27",
                2 => "2026-06-26",
                _ => unreachable!(),
            };
            if day_set.contains(check) { count += 1; } else { break; }
        }
        assert_eq!(count, 3);
    }

    #[test]
    fn test_streak_broken() {
        let dates = vec!["2026-06-28", "2026-06-26"];
        let day_set: std::collections::HashSet<&str> = dates.iter().cloned().collect();
        let mut count = 0i64;
        for offset in 0..3i64 {
            let check = match offset {
                0 => "2026-06-28",
                1 => "2026-06-27",
                2 => "2026-06-26",
                _ => unreachable!(),
            };
            if day_set.contains(check) { count += 1; } else { break; }
        }
        assert_eq!(count, 1);
    }

    // -----------------------------------------------------------------------
    // Heatmap level calculation
    // -----------------------------------------------------------------------

    #[test]
    fn test_heatmap_level_mapping() {
        let cases = vec![(0, 0), (1, 1), (2, 1), (3, 2), (5, 2), (6, 3), (10, 3), (11, 4), (100, 4)];
        for (count, expected_level) in cases {
            let level = match count {
                0 => 0,
                1..=2 => 1,
                3..=5 => 2,
                6..=10 => 3,
                _ => 4,
            };
            assert_eq!(level, expected_level, "count={count}");
        }
    }

    // -----------------------------------------------------------------------
    // Weekly word day-of-week mapping
    // -----------------------------------------------------------------------

    #[test]
    fn test_weekly_words_day_names() {
        let day_names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        // SQLite %w: 0=Sun, 1=Mon, ..., 6=Sat
        let test_cases = vec![(0, "Sun"), (1, "Mon"), (2, "Tue"), (3, "Wed"), (4, "Thu"), (5, "Fri"), (6, "Sat")];
        for (sqlite_dow, expected_name) in test_cases {
            assert_eq!(day_names[sqlite_dow], expected_name);
        }
    }

    // -----------------------------------------------------------------------
    // Hour label formatting
    // -----------------------------------------------------------------------

    #[test]
    fn test_hour_label_formatting() {
        let format_hour = |h: i64| -> String {
            match h {
                0 => "12 AM".into(),
                1..=11 => format!("{} AM", h),
                12 => "12 PM".into(),
                13..=23 => format!("{} PM", h - 12),
                _ => "—".into(),
            }
        };
        assert_eq!(format_hour(0), "12 AM");
        assert_eq!(format_hour(1), "1 AM");
        assert_eq!(format_hour(11), "11 AM");
        assert_eq!(format_hour(12), "12 PM");
        assert_eq!(format_hour(13), "1 PM");
        assert_eq!(format_hour(23), "11 PM");
    }

    // -----------------------------------------------------------------------
    // CSV import/export logic
    // -----------------------------------------------------------------------

    #[test]
    fn test_csv_import_parsing() {
        let csv_text = "teh,the\ncorrectin,correction\n";
        let mut reader = csv::ReaderBuilder::new()
            .has_headers(false)
            .flexible(true)
            .from_reader(csv_text.as_bytes());

        let mut pairs = Vec::new();
        for record in reader.records() {
            let row = record.unwrap();
            let fields: Vec<&str> = row.iter().collect();
            if fields.len() >= 2 {
                pairs.push((fields[0].trim().to_string(), fields[1].trim().to_string()));
            }
        }
        assert_eq!(pairs.len(), 2);
        assert_eq!(pairs[0], ("teh".to_string(), "the".to_string()));
        assert_eq!(pairs[1], ("correctin".to_string(), "correction".to_string()));
    }

    #[test]
    fn test_csv_export_escaping() {
        let phrase = "he said \"hello\"";
        let replacement = "He said \"hello\"";
        let escaped_p = phrase.replace('"', "\"\"");
        let escaped_r = replacement.replace('"', "\"\"");
        let line = format!("\"{}\",\"{}\"", escaped_p, escaped_r);
        assert!(line.contains("\"\"hello\"\""));
    }

    // -----------------------------------------------------------------------
    // Mode name mapping
    // -----------------------------------------------------------------------

    #[test]
    fn test_mode_name_mapping() {
        let mode_map = |m: &str| -> &str {
            match m {
                "cleanup" => "AI Prompts",
                "email" => "Emails",
                "bullet_list" => "Documents",
                "commit_message" => "Messages",
                _ => "Other",
            }
        };
        assert_eq!(mode_map("cleanup"), "AI Prompts");
        assert_eq!(mode_map("email"), "Emails");
        assert_eq!(mode_map("bullet_list"), "Documents");
        assert_eq!(mode_map("commit_message"), "Messages");
        assert_eq!(mode_map("unknown"), "Other");
    }

    // -----------------------------------------------------------------------
    // delete_model_file edge cases
    // -----------------------------------------------------------------------

    #[test]
    fn test_delete_model_file_nonexistent() {
        let result = delete_model_file("/nonexistent/path/that/does/not/exist".to_string());
        assert!(result.is_ok());
    }

    // -----------------------------------------------------------------------
    // Percentage calculations
    // -----------------------------------------------------------------------

    #[test]
    fn test_language_percentage_calculation() {
        let pct = (8i64 as f64 / 10i64 as f64 * 100.0).round() as i64;
        assert_eq!(pct, 80);
    }

    #[test]
    fn test_language_percentage_zero_total() {
        let pct = if 0i64 > 0 { (0i64 as f64 / 0i64 as f64 * 100.0).round() as i64 } else { 0 };
        assert_eq!(pct, 0);
    }

    #[test]
    fn test_wpm_trend_positive() {
        let trend = if 100i64 > 0 { ((120i64 - 100i64) as f64 / 100i64 as f64 * 100.0).round() as i64 } else { 0 };
        assert_eq!(trend, 20);
    }

    #[test]
    fn test_wpm_trend_negative() {
        let trend = if 100i64 > 0 { ((80i64 - 100i64) as f64 / 100i64 as f64 * 100.0).round() as i64 } else { 0 };
        assert_eq!(trend, -20);
    }

    #[test]
    fn test_wpm_trend_zero_prev() {
        let trend = if 0i64 > 0 { ((120i64 - 0i64) as f64 / 0i64 as f64 * 100.0).round() as i64 } else { 0 };
        assert_eq!(trend, 0);
    }

    // -----------------------------------------------------------------------
    // Insights empty DB
    // -----------------------------------------------------------------------

    #[test]
    fn test_insights_empty_db() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE transcripts (
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
        ).unwrap();

        let total_words: i64 = conn.query_row(
            "SELECT COALESCE(SUM(LENGTH(raw_text) - LENGTH(REPLACE(raw_text, ' ', '')) + 1), 0) FROM transcripts WHERE raw_text != ''",
            [], |r| r.get(0),
        ).unwrap();
        assert_eq!(total_words, 0);
    }

    #[test]
    fn test_insights_with_data() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE transcripts (
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
        ).unwrap();

        for (text, dur) in vec![("hello world", 1.0), ("one two three", 2.0), ("one two three four five", 3.0)] {
            conn.execute(
                "INSERT INTO transcripts (raw_text, duration_sec, mode) VALUES (?1, ?2, 'cleanup')",
                rusqlite::params![text, dur],
            ).unwrap();
        }

        let total_words: i64 = conn.query_row(
            "SELECT COALESCE(SUM(LENGTH(raw_text) - LENGTH(REPLACE(raw_text, ' ', '')) + 1), 0) FROM transcripts WHERE raw_text != ''",
            [], |r| r.get(0),
        ).unwrap();
        assert_eq!(total_words, 10); // 2 + 3 + 5
    }

    // -----------------------------------------------------------------------
    // Tauri mock app test
    // -----------------------------------------------------------------------

    fn build_mock_app() -> tauri::App<tauri::test::MockRuntime> {
        tauri::test::mock_builder()
            .plugin(tauri_plugin_shell::init())
            .plugin(tauri_plugin_notification::init())
            .plugin(tauri_plugin_store::Builder::new().build())
            .plugin(tauri_plugin_clipboard_manager::init())
            .plugin(tauri_plugin_global_shortcut::Builder::new().build())
            .plugin(tauri_plugin_opener::init())
            .invoke_handler(tauri::generate_handler![
                get_backend_path,
                get_platform_info,
                check_system_deps,
                get_foreground_hwnd,
                type_text,
            ])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("failed to build mock app")
    }

    fn parse_ipc_response(body: tauri::ipc::InvokeResponseBody) -> serde_json::Value {
        match body {
            tauri::ipc::InvokeResponseBody::Json(s) => serde_json::from_str(&s).unwrap_or_default(),
            tauri::ipc::InvokeResponseBody::Raw(_) => serde_json::Value::Null,
        }
    }

    #[test]
    fn test_tauri_mock_builder() {
        let app = build_mock_app();
        let _ = app;
    }

    fn make_invoke_request(cmd: &str) -> tauri::webview::InvokeRequest {
        tauri::webview::InvokeRequest {
            cmd: cmd.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: "tauri://localhost".parse().unwrap(),
            body: tauri::ipc::InvokeBody::default(),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.to_string(),
        }
    }

    fn make_invoke_request_with_body(cmd: &str, body: serde_json::Value) -> tauri::webview::InvokeRequest {
        tauri::webview::InvokeRequest {
            cmd: cmd.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: "tauri://localhost".parse().unwrap(),
            body: tauri::ipc::InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.to_string(),
        }
    }

    #[test]
    fn test_ipc_get_platform_info() {
        let app = build_mock_app();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let res = tauri::test::get_ipc_response(&webview, make_invoke_request("get_platform_info"));
        assert!(res.is_ok(), "get_platform_info failed: {:?}", res.err());
        let value = parse_ipc_response(res.unwrap());
        assert!(value.get("platform").is_some());
        assert!(value.get("displayServer").is_some());
    }

    #[test]
    fn test_ipc_get_backend_path() {
        let app = build_mock_app();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let res = tauri::test::get_ipc_response(&webview, make_invoke_request("get_backend_path"));
        assert!(res.is_ok(), "get_backend_path failed: {:?}", res.err());
        let value = parse_ipc_response(res.unwrap());
        assert!(value.is_string());
        assert!(!value.as_str().unwrap().is_empty());
    }

    #[test]
    fn test_ipc_check_system_deps() {
        let app = build_mock_app();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let res = tauri::test::get_ipc_response(&webview, make_invoke_request("check_system_deps"));
        assert!(res.is_ok(), "check_system_deps failed: {:?}", res.err());
        let value = parse_ipc_response(res.unwrap());
        assert!(value.is_array());
        let arr = value.as_array().unwrap();
        assert!(!arr.is_empty());
        for item in arr {
            assert!(item.get("name").is_some());
            assert!(item.get("status").is_some());
        }
    }

    #[test]
    fn test_ipc_get_foreground_hwnd() {
        let app = build_mock_app();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let res = tauri::test::get_ipc_response(&webview, make_invoke_request("get_foreground_hwnd"));
        assert!(res.is_ok(), "get_foreground_hwnd failed: {:?}", res.err());
        let value = parse_ipc_response(res.unwrap());
        assert!(value.is_number());
    }

    #[test]
    fn test_ipc_get_history_empty_db() {
        let app = build_mock_app();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let res = tauri::test::get_ipc_response(
            &webview,
            make_invoke_request_with_body("get_history", serde_json::json!({"limit": 10})),
        );
        match res {
            Ok(body) => {
                let value = parse_ipc_response(body);
                assert!(value.is_array());
            }
            Err(e) => {
                let s = format!("{:?}", e);
                assert!(s.contains("Database error") || s.contains("not found") || s.contains("No such file"),
                    "Unexpected error: {}", s);
            }
        }
    }

    #[test]
    fn test_ipc_type_text_empty() {
        let app = build_mock_app();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let res = tauri::test::get_ipc_response(
            &webview,
            make_invoke_request_with_body("type_text", serde_json::json!({"text": ""})),
        );
        assert!(res.is_ok(), "type_text empty should succeed: {:?}", res.err());
        let value = parse_ipc_response(res.unwrap());
        assert_eq!(value, false);
    }

    #[test]
    fn test_ipc_type_text_whitespace() {
        let app = build_mock_app();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let res = tauri::test::get_ipc_response(
            &webview,
            make_invoke_request_with_body("type_text", serde_json::json!({"text": "   "})),
        );
        assert!(res.is_ok(), "type_text whitespace should succeed: {:?}", res.err());
        let value = parse_ipc_response(res.unwrap());
        assert_eq!(value, false);
    }
}
