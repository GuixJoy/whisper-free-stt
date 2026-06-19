# STT Widget — Window Manager Configuration

The floating widget uses Tauri's multi-window system with `alwaysOnTop: true`.
Most desktop environments (GNOME, KDE, Windows, macOS) handle this natively.

For tiling window managers on Linux, add the appropriate config snippet below.

## Supported Window Managers

### Sway (Wayland, wlroots-based)

Add to `~/.config/sway/config`:

```
for_window [app_id="widget"] floating enable, sticky enable, border pixel 0
```

**Note:** On Wayland, `data-tauri-drag-region` (client-side drag) does not work.
Use Sway's move commands (e.g., `$mod+Shift+drag`) to reposition the widget.

### Hyprland (Wayland, own compositor)

Add to `~/.config/hypr/hyprland.conf`:

```
windowrulev2 = float, class:^(stt-ui)$
windowrulev2 = pin, class:^(stt-ui)$
windowrulev2 = noanim, class:^(stt-ui)$
windowrulev2 = size 220 56, class:^(stt-ui)$
```

### i3 (X11)

Add to `~/.config/i3/config`:

```
for_window [class="stt-ui"] floating enable, sticky enable, border pixel 0
```

### GNOME / KDE / Windows / macOS

No configuration needed. The widget uses native always-on-top and transparent
window APIs that work out of the box on these platforms.

## Platform Notes

| Feature | Windows | macOS | Linux X11 | Linux Wayland |
|---|---|---|---|---|
| Always on top | Yes | Yes | Yes | Requires WM rules |
| Window positioning | Yes | Yes | Yes | Requires WM rules |
| Drag to move | Yes | Yes | Yes | No (use WM move) |
| Glass blur effect | Yes | Yes | Needs compositor | Yes |

## How to Apply

After adding the config lines, restart your window manager or reload its config:
- **Sway**: `swaymsg reload`
- **Hyprland**: `hyprctl reload`
- **i3**: `$mod+Shift+r`

## Finding Your Window Class

If the rules don't match, find the actual class/app_id:

**Sway/Wayland:**
```bash
swaymsg -t get_tree | grep app_id
```

**Hyprland:**
```bash
hyprctl clients | grep class
```

**i3/X11:**
```bash
xprop | grep WM_CLASS
```
