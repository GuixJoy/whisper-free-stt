use anyhow::Result;
use std::process::Command;

pub fn detect_platform() -> (&'static str, &'static str) {
    let platform = std::env::consts::OS;
    let display_server = if platform == "linux" {
        if std::env::var("WAYLAND_DISPLAY").is_ok()
            || std::env::var("XDG_SESSION_TYPE").as_deref() == Ok("wayland")
        {
            "wayland"
        } else if std::env::var("DISPLAY").is_ok() {
            "x11"
        } else {
            "unknown"
        }
    } else {
        "native"
    };
    (platform, display_server)
}

pub fn type_text(text: &str) -> Result<bool> {
    if text.trim().is_empty() {
        return Ok(false);
    }

    let (platform, display_server) = detect_platform();

    match (platform, display_server) {
        ("windows", _) => type_windows_paste(text),
        ("linux", "wayland") => run_piped_command(text, "wtype", &["-"]),
        ("linux", "x11") | ("linux", "unknown") => {
            run_piped_command(text, "xdotool", &["type", "--clearmodifiers"])
        }
        ("macos", _) => {
            let escaped = text.replace('\\', "\\\\").replace('"', "\\\"");
            let script = format!("tell application \"System Events\" to keystroke \"{escaped}\"");
            let output = Command::new("osascript").args(["-e", &script]).output()?;
            Ok(output.status.success())
        }
        _ => Err(anyhow::anyhow!("No typing backend available")),
    }
}

pub fn copy_to_clipboard(text: &str) -> Result<bool> {
    if text.is_empty() {
        return Ok(false);
    }

    let (platform, display_server) = detect_platform();

    match (platform, display_server) {
        ("windows", _) => run_piped_command(text, "clip.exe", &[]),
        ("linux", "wayland") => run_piped_command(text, "wl-copy", &[]),
        ("linux", "x11") | ("linux", "unknown") => {
            run_piped_command(text, "xclip", &["-selection", "clipboard"])
        }
        ("macos", _) => {
            let escaped = text.replace('\\', "\\\\").replace('"', "\\\"");
            let script = format!("tell application \"System Events\" to keystroke \"{escaped}\"");
            let output = Command::new("osascript").args(["-e", &script]).output()?;
            Ok(output.status.success())
        }
        _ => Err(anyhow::anyhow!("No clipboard backend available")),
    }
}

pub fn save_to_history(
    text: &str,
    raw_text: &str,
    mode: &str,
    model: &str,
    db_path: &std::path::Path,
) -> Result<()> {
    use rusqlite::Connection;
    let conn = Connection::open(db_path)?;
    crate::ensure_history_schema(&conn)?;
    conn.execute(
        "INSERT INTO transcripts (raw_text, processed_text, language, mode, model, duration_sec)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![raw_text, text, "en", mode, model, 0.0f64],
    )?;
    Ok(())
}

pub fn type_windows_paste(text: &str) -> Result<bool> {
    // Clipboard first (proven reliable via clip.exe), then Ctrl+V injected
    // with SendInput. Powershell + SendKeys is out: Send throws without a
    // message pump, SendWait blocks forever on busy windows.
    if !run_piped_command(text, "clip.exe", &[])? {
        return Ok(false);
    }
    // Brief beat so the clipboard settles before the keystroke lands.
    std::thread::sleep(std::time::Duration::from_millis(150));
    send_ctrl_v()
}

#[cfg(windows)]
fn send_ctrl_v() -> Result<bool> {
    use windows::Win32::UI::Input::KeyboardAndMouse::*;
    fn key(vk: VIRTUAL_KEY, up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: if up {
                        KEYEVENTF_KEYUP
                    } else {
                        KEYBD_EVENT_FLAGS(0)
                    },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }
    let inputs = [
        key(VK_CONTROL, false),
        key(VK_V, false),
        key(VK_V, true),
        key(VK_CONTROL, true),
    ];
    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    Ok(sent == inputs.len() as u32)
}

pub fn run_piped_command(text: &str, tool: &str, prefix_args: &[&str]) -> Result<bool> {
    let mut child = Command::new(tool)
        .args(prefix_args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()?;

    if let Some(ref mut stdin) = child.stdin {
        use std::io::Write;
        stdin.write_all(text.as_bytes())?;
    }

    let status = child.wait()?;
    Ok(status.success())
}
