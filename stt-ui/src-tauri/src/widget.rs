use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct WidgetPosition {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Serialize)]
pub struct WindowManagerInfo {
    pub wm: String,
    pub wayland: bool,
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn show_widget(app: AppHandle) -> Result<(), String> {
    eprintln!("[widget] show_widget called");
    let window = app
        .get_webview_window("widget")
        .ok_or_else(|| {
            eprintln!("[widget] show_widget: window not found");
            "Widget window not found".to_string()
        })?;

    eprintln!("[widget] show_widget: window found, setting position...");
    // Position at bottom-right corner with margin
    if let Ok(monitor) = window.primary_monitor() {
        if let Some(monitor) = monitor {
            let m_size = monitor.size();
            let m_pos = monitor.position();
            let w_size = window
                .outer_size()
                .map_err(|e| format!("Failed to get widget size: {e}"))?;
            let x = (m_pos.x + m_size.width as i32 - w_size.width as i32 - 30) as f64;
            let y = (m_pos.y + m_size.height as i32 - w_size.height as i32 - 30) as f64;
            eprintln!("[widget] show_widget: positioning at ({x}, {y})");
            let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                x: x as i32,
                y: y as i32,
            }));
        }
    }

    let _ = window.set_always_on_top(true);
    eprintln!("[widget] show_widget: calling window.show()");
    window
        .show()
        .map_err(|e| {
            eprintln!("[widget] show_widget: window.show() failed: {e}");
            format!("Failed to show widget: {e}")
        })?;
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
    Ok(())
}

#[tauri::command]
pub fn get_widget_visible(app: AppHandle) -> Result<bool, String> {
    let window = app
        .get_webview_window("widget")
        .ok_or("Widget window not found")?;
    Ok(window.is_visible().unwrap_or(false))
}

#[tauri::command]
pub fn get_widget_position(app: AppHandle) -> Result<WidgetPosition, String> {
    let window = app
        .get_webview_window("widget")
        .ok_or("Widget window not found")?;
    let pos = window
        .outer_position()
        .map_err(|e| format!("Failed to get widget position: {e}"))?;
    Ok(WidgetPosition {
        x: pos.x as f64,
        y: pos.y as f64,
    })
}

#[tauri::command]
pub fn set_widget_position(app: AppHandle, x: f64, y: f64) -> Result<(), String> {
    let window = app
        .get_webview_window("widget")
        .ok_or("Widget window not found")?;
    let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
        x: x as i32,
        y: y as i32,
    }));
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
    eprintln!("[widget] Emitted widget-visibility-changed={visible}");
    Ok(visible)
}

#[tauri::command]
pub fn detect_window_manager() -> WindowManagerInfo {
    let wayland = std::env::var("WAYLAND_DISPLAY").is_ok();

    let wm = if std::env::var("SWAYSOCK").is_ok() {
        "sway".to_string()
    } else if std::env::var("HYPRLAND_INSTANCE_SIGNATURE").is_ok() {
        "hyprland".to_string()
    } else if std::env::var("I3SOCK").is_ok() {
        "i3".to_string()
    } else if let Ok(xdg) = std::env::var("XDG_CURRENT_DESKTOP") {
        let lower = xdg.to_lowercase();
        if lower.contains("gnome") {
            "gnome".to_string()
        } else if lower.contains("kde") {
            "kde".to_string()
        } else {
            lower
        }
    } else if wayland {
        "wayland-unknown".to_string()
    } else {
        "unknown".to_string()
    };

    WindowManagerInfo { wm, wayland }
}
