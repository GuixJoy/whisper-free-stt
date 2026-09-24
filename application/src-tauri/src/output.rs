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
        ("windows", _) => copy_to_windows_clipboard(text),
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
    if !copy_to_windows_clipboard(text)? {
        return Ok(false);
    }
    // Brief beat so the clipboard settles before the keystroke lands.
    // ponytail: fixed 150ms; no paste-complete signal exists to wait on instead.
    std::thread::sleep(std::time::Duration::from_millis(150));
    send_ctrl_v()
}

/// Windows clipboard write, Unicode-safe.
///
/// `clip.exe` decodes stdin with the console/OEM code page unless the bytes
/// are UTF-16 with a BOM, so the raw UTF-8 the Unix arms write pastes "café"
/// as "cafÃ©" — and the app ships Whisper profiles for exactly those
/// languages. `CREATE_NO_WINDOW` stops the console window from flashing and
/// taking focus away from the paste target.
#[cfg(windows)]
fn copy_to_windows_clipboard(text: &str) -> Result<bool> {
    use std::io::Write;
    use std::os::windows::process::CommandExt;
    use std::process::Stdio;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let mut wide = vec![0xFEFFu16]; // BOM: marks the payload as UTF-16LE
    wide.extend(text.encode_utf16());
    let mut bytes = Vec::with_capacity(wide.len() * 2);
    for unit in wide {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }

    let mut child = Command::new("clip.exe")
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    if let Some(ref mut stdin) = child.stdin {
        stdin.write_all(&bytes)?;
    }
    Ok(child.wait()?.success())
}

/// Unreachable in practice: the Windows arms run only when
/// `std::env::consts::OS == "windows"`. Present so they resolve on every
/// target, exactly like the `send_ctrl_v` stub.
#[cfg(not(windows))]
fn copy_to_windows_clipboard(text: &str) -> Result<bool> {
    run_piped_command(text, "clip.exe", &[])
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

/// Non-Windows stub: `type_windows_paste` is only reachable through the
/// `("windows", _)` match arm, but arms compile on every platform, so the
/// symbol must exist everywhere to keep Linux/macOS builds green.
#[cfg(not(windows))]
fn send_ctrl_v() -> Result<bool> {
    Err(anyhow::anyhow!("No typing backend available"))
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
