//! Local control channel for external integrations (Waybar, compositor keybinds).
//!
//! Loopback-only HTTP server, std-only (no new dependencies). Same-user local
//! access only — it never binds beyond 127.0.0.1.
//!
//! - `GET  /status` → `{"state":"listening"|"idle","recording":bool}`
//! - `POST /toggle` → flips recording, returns the new status JSON
//! - `POST /start`  → start recording (idempotent-ish: 409 if already running)
//! - `POST /stop`   → stop recording
//! - `POST /show`   → unminimize + focus the main window (Waybar right-click)
//!
//! Port: 17833, override with `FLOURE_PORT`.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Manager};

pub const DEFAULT_PORT: u16 = 17833;

fn port() -> u16 {
    std::env::var("FLOURE_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_PORT)
}

fn is_recording() -> bool {
    crate::pipeline::get_running_flag().load(Ordering::SeqCst)
}

fn status_json() -> String {
    let recording = is_recording();
    let state = if recording { "listening" } else { "idle" };
    format!(r#"{{"state":"{state}","recording":{recording}}}"#)
}

fn respond(stream: &mut TcpStream, code: u16, body: &str) {
    let reason = match code {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        405 => "Method Not Allowed",
        409 => "Conflict",
        500 => "Internal Server Error",
        _ => "Error",
    };
    let resp = format!(
        "HTTP/1.1 {code} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(resp.as_bytes());
}

fn error_json(message: &str) -> String {
    let escaped = serde_json::to_string(message).unwrap_or_else(|_| r#""error""#.to_string());
    format!(r#"{{"error":{escaped}}}"#)
}

fn do_start(app: &AppHandle) -> Result<(), String> {
    if is_recording() {
        return Err("already recording".to_string());
    }
    let config = crate::config::AppConfig::load();
    crate::pipeline::start_pipeline(app.clone(), config).map_err(|e| e.to_string())
}

fn handle(app: &AppHandle, method: &str, path: &str, stream: &mut TcpStream) {
    match (method, path) {
        ("GET", "/status") => respond(stream, 200, &status_json()),
        ("POST", "/toggle") => {
            if is_recording() {
                crate::pipeline::stop_pipeline();
                respond(stream, 200, &status_json());
            } else {
                match do_start(app) {
                    Ok(()) => respond(stream, 200, &status_json()),
                    Err(e) => respond(stream, 500, &error_json(&e)),
                }
            }
        }
        ("POST", "/start") => match do_start(app) {
            Ok(()) => respond(stream, 200, &status_json()),
            Err(e) if e == "already recording" => respond(stream, 409, &error_json(&e)),
            Err(e) => respond(stream, 500, &error_json(&e)),
        },
        ("POST", "/stop") => {
            crate::pipeline::stop_pipeline();
            respond(stream, 200, &status_json());
        }
        ("POST", "/show") => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            respond(stream, 200, r#"{"ok":true}"#);
        }
        (_, "/status" | "/toggle" | "/start" | "/stop" | "/show") => {
            respond(stream, 405, &error_json("method not allowed"))
        }
        _ => respond(stream, 404, &error_json("not found")),
    }
}

fn handle_connection(app: AppHandle, mut stream: TcpStream) {
    let mut buf = [0u8; 8192];
    let mut total = 0usize;
    // Read until end of headers or buffer full (requests have no body).
    loop {
        match stream.read(&mut buf[total..]) {
            Ok(0) => break,
            Ok(n) => {
                total += n;
                if total >= buf.len() {
                    break;
                }
                if buf[..total].windows(4).any(|w| w == b"\r\n\r\n") {
                    break;
                }
            }
            Err(_) => return,
        }
    }
    if total == 0 {
        return;
    }
    let request = String::from_utf8_lossy(&buf[..total]);
    let mut lines = request.lines();
    let request_line = match lines.next() {
        Some(l) => l,
        None => {
            respond(&mut stream, 400, &error_json("bad request"));
            return;
        }
    };
    let mut parts = request_line.split_whitespace();
    let (method, target) = match (parts.next(), parts.next()) {
        (Some(m), Some(t)) => (m, t),
        _ => {
            respond(&mut stream, 400, &error_json("bad request"));
            return;
        }
    };
    // Strip query string if present.
    let path = target.split('?').next().unwrap_or(target);
    handle(&app, method, path, &mut stream);
}

/// Spawn the loopback control server on a background thread. Never blocks.
/// Bind failures (port taken, sandbox) log to stderr and are non-fatal.
pub fn start_control_server(app: AppHandle) {
    let port = port();
    std::thread::spawn(move || {
        let listener = match TcpListener::bind(("127.0.0.1", port)) {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[control] bind 127.0.0.1:{port} failed: {e} — Waybar/hotkey integration disabled");
                return;
            }
        };
        eprintln!("[control] listening on 127.0.0.1:{port}");
        for stream in listener.incoming() {
            match stream {
                Ok(stream) => {
                    let app = app.clone();
                    std::thread::spawn(move || handle_connection(app, stream));
                }
                Err(e) => {
                    eprintln!("[control] accept failed: {e}");
                }
            }
        }
    });
}
