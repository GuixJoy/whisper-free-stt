use anyhow::Result;
use std::process::Command;

pub fn detect_platform() -> (&'static str, &'static str) {
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
    (platform, display_server)
}

pub fn type_text(text: &str) -> Result<bool> {
    if text.trim().is_empty() {
        return Ok(false);
    }

    let (platform, display_server) = detect_platform();

    match (platform, display_server) {
        ("windows", _) => type_windows_paste(text),
        ("linux", "wayland") => type_via_command(text, "wtype", &[]),
        ("linux", "x11") | ("linux", "unknown") => {
            type_via_command(text, "xdotool", &["type", "--clearmodifiers"])
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
        ("windows", _) => copy_via_command(text, "clip.exe", &[]),
        ("linux", "wayland") => copy_via_command(text, "wl-copy", &[]),
        ("linux", "x11") | ("linux", "unknown") => {
            copy_via_command(text, "xclip", &["-selection", "clipboard"])
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
    conn.execute(
        "INSERT INTO transcripts (raw_text, processed_text, language, mode, model, duration_sec)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![raw_text, text, "en", mode, model, 0.0f64],
    )?;
    Ok(())
}

pub fn type_windows_paste(text: &str) -> Result<bool> {
    let escaped = text.replace("'", "''");
    let ps_script = format!(
        "Add-Type -AssemblyName System.Windows.Forms; \
         [System.Windows.Forms.Clipboard]::SetText('{}'); \
         Start-Sleep -Milliseconds 30; \
         [System.Windows.Forms.SendKeys]::SendWait('^v')",
        escaped
    );
    let output = Command::new("powershell")
        .args(["-STA", "-NoProfile", "-Command", &ps_script])
        .output()?;
    Ok(output.status.success())
}

pub fn type_via_command(text: &str, tool: &str, prefix_args: &[&str]) -> Result<bool> {
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

pub fn copy_via_command(text: &str, tool: &str, prefix_args: &[&str]) -> Result<bool> {
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