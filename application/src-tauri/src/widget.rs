use tauri::{AppHandle, Emitter, Manager};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn is_wayland() -> bool {
    std::env::var("WAYLAND_DISPLAY").is_ok()
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

// Internal helper: show + position the widget window. Called by
// `toggle_widget` (the only IPC entry point for visibility).
pub fn show_widget(app: AppHandle) -> Result<(), String> {
    eprintln!("[widget] show_widget called");
    let window = app
        .get_webview_window("widget")
        .ok_or_else(|| {
            eprintln!("[widget] show_widget: window not found");
            "Widget window not found".to_string()
        })?;

    // Keep it panel-like: no taskbar entry, on top where supported.
    let _ = window.set_skip_taskbar(true);

    // On Wayland, clients cannot position windows — the compositor manages placement.
    // Skip positioning and always-on-top; WM rules (sway/hyprland config) handle it.
    if !is_wayland() {
        eprintln!("[widget] show_widget: setting position (X11/native)");
        if let Ok(Some(monitor)) = window.primary_monitor() {
            let m_size = monitor.size();
            let m_pos = monitor.position();
            // Window is fixed 264x64 (see tauri.conf.json); fall back to that
            // when outer_size is not yet available (e.g. before first show).
            let (w, h) = window
                .outer_size()
                .map(|s| (s.width as i32, s.height as i32))
                .unwrap_or((264, 64));
            // Use generous margins: 30px right, 60px bottom (accounts for macOS Dock / Windows taskbar)
            let x = (m_pos.x + m_size.width as i32 - w - 30) as f64;
            let y = (m_pos.y + m_size.height as i32 - h - 60) as f64;
            eprintln!("[widget] show_widget: positioning at ({x}, {y})");
            let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                x: x as i32,
                y: y as i32,
            }));
        }
        let _ = window.set_always_on_top(true);
    } else {
        eprintln!("[widget] show_widget: skipping position/always-on-top (Wayland)");
    }

    eprintln!("[widget] show_widget: calling window.show()");
    window
        .show()
        .map_err(|e| {
            eprintln!("[widget] show_widget: window.show() failed: {e}");
            format!("Failed to show widget: {e}")
        })?;
    let _ = app.emit("widget-visibility-changed", true);
    eprintln!("[widget] show_widget: success!");
    Ok(())
}

#[tauri::command]
pub fn hide_widget(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("widget")
        .ok_or("Widget window not found")?;
    window
        .hide()
        .map_err(|e| format!("Failed to hide widget: {e}"))?;
    let _ = app.emit("widget-visibility-changed", false);
    Ok(())
}

#[tauri::command]
pub fn toggle_widget(app: AppHandle) -> Result<bool, String> {
    eprintln!("[widget] toggle_widget called");
    let window = app
        .get_webview_window("widget")
        .ok_or_else(|| {
            eprintln!("[widget] Widget window not found!");
            "Widget window not found".to_string()
        })?;
    eprintln!("[widget] Widget window found, visible={}", window.is_visible().unwrap_or(false));
    let visible = if window.is_visible().unwrap_or(false) {
        eprintln!("[widget] Hiding widget");
        window
            .hide()
            .map_err(|e| format!("Failed to hide widget: {e}"))?;
        false
    } else {
        eprintln!("[widget] Showing widget");
        show_widget(app.clone())?;
        true
    };
    let _ = app.emit("widget-visibility-changed", visible);
    Ok(visible)
}
