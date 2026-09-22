# Floure — Waybar + Hyprland

Status pill and `Super+Space` hotkey for Floure dictation, sharing one script
and the Floure local control channel (loopback `127.0.0.1:17833`, override with
`FLOURE_PORT`). No new dependencies beyond `curl`.

## Install

```bash
mkdir -p ~/.config/waybar/scripts
cp application/wm-config/waybar/floure-waybar.sh ~/.config/waybar/scripts/
chmod +x ~/.config/waybar/scripts/floure-waybar.sh
```

1. Add `"custom/floure"` to your Waybar `modules-right` (or -left/-center).
2. Merge `config-snippet.json` into `~/.config/waybar/config`.
3. Append `style-snippet.css` to `~/.config/waybar/style.css`.
4. Add to `~/.config/hypr/hyprland.conf` (see `../hyprland`):
   `bind = $mainMod, SPACE, exec, ~/.config/waybar/scripts/floure-waybar.sh toggle`
5. Reload: `pkill -USR2 waybar; hyprctl reload` (or restart Waybar).

## Behavior

| Action                  | What happens                                        |
| ----------------------- | --------------------------------------------------- |
| Waybar shows `○ Floure` | Idle — click (or `Super+Space`) to dictate          |
| Waybar shows `● Floure` | Recording — click (or `Super+Space`) to stop        |
| Right-click module      | Focus the Floure main window                        |
| App not running         | Module shows idle with tooltip "Floure not running" |

## Notes

- Click and hotkey hit the same `POST /toggle` endpoint — they can never
  desync from each other.
- First-ever toggle may take a while (model download); the script allows 60s.
- Port clash or sandbox blocks the bind: Floure logs
  `[control] bind ... failed` and keeps running without the channel.
- Waybar itself never sees keys — the compositor owns `Super+Space`.
