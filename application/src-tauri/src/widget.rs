use tauri::{AppHandle, Emitter, Manager};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn is_wayland() -> bool {
    std::env::var("WAYLAND_DISPLAY").is_ok()
}

/// Show + position the widget window. Visibility entry points: `show_widget`
/// (PTT auto-show), `hide_widget`, and `toggle_widget` (manual control).
#[tauri::command]
pub fn show_widget(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("widget")
        .ok_or_else(|| "Widget window not found".to_string())?;

    let _ = window.set_skip_taskbar(true);

    // On Wayland, clients cannot position windows — the compositor manages
    // placement. Skip positioning; WM rules (sway/hyprland) handle it.
    if !is_wayland() {
        if let Ok(Some(monitor)) = window.primary_monitor() {
            let m_size = monitor.size();
            let m_pos = monitor.position();
            // Window is fixed 264x64 (tauri.conf.json); fall back to that when
            // outer_size is unavailable (e.g. before first show).
            let (w, h) = window
                .outer_size()
                .map(|s| (s.width as i32, s.height as i32))
                .unwrap_or((264, 64));
            // Bottom-center, just above the taskbar: horizontally centered,
            // vertically clear of the taskbar (~48px) plus margin.
            let x = m_pos.x + (m_size.width as i32 - w) / 2;
            let y = m_pos.y + m_size.height as i32 - h - 80;
            let _ =
                window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
        }
        let _ = window.set_always_on_top(true);
    }

    window
        .show()
        .map_err(|e| format!("Failed to show widget: {e}"))?;
    let _ = app.emit("widget-visibility-changed", true);
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
    let visible = app
        .get_webview_window("widget")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);

    if visible {
        hide_widget(app)?;
        Ok(false)
    } else {
        show_widget(app)?;
        Ok(true)
    }
}
