# STT Widget — Window Manager Configuration

The floating widget uses Tauri's multi-window system with `alwaysOnTop: true`.
Most desktop environments (GNOME, KDE, Windows, macOS) handle this natively.

For tiling window managers on Linux, add the appropriate config snippet below.

## Supported Window Managers

### Sway (Wayland, wlroots-based)

Add to `~/.config/sway/config`:

```
for_window [app_id="stt-widget"] floating enable, sticky enable, border pixel 0
```

### Hyprland (Wayland, own compositor)

Add to `~/.config/hypr/hyprland.conf`:

```
windowrulev2 = float, class:(stt-widget)
windowrulev2 = pin, class:(stt-widget)
windowrulev2 = noanim, class:(stt-widget)
```

### i3 (X11)

Add to `~/.config/i3/config`:

```
for_window [class="stt-widget"] floating enable, sticky enable, border pixel 0
```

### GNOME / KDE / Windows / macOS

No configuration needed. The widget uses native always-on-top and transparent
window APIs that work out of the box on these platforms.

## How to Apply

After adding the config lines, restart your window manager or reload its config:
- **Sway**: `swaymsg reload`
- **Hyprland**: `hyprctl reload`
- **i3**: `$mod+Shift+r`
