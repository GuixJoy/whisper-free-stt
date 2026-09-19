#!/usr/bin/env bash
# Floure Waybar helper — one script for the Waybar module AND compositor hotkeys.
# Talks to the Floure local control channel (loopback only, no new dependencies
# beyond curl). Port defaults to 17833, override with FLOURE_PORT.
#
#   floure-waybar.sh           # print Waybar JSON for current status (module exec)
#   floure-waybar.sh toggle    # start/stop recording, print fresh Waybar JSON (on-click + hotkey)
#   floure-waybar.sh show      # focus the main window (on-right-click)
set -u

PORT="${FLOURE_PORT:-17833}"
BASE="http://127.0.0.1:${PORT}"

waybar_json() {
  printf '{"text": "%s", "tooltip": "%s", "class": "%s"}\n' "$1" "$2" "$3"
}

is_recording() {
  # $1 = status JSON; prints "true"/"false", empty when unparseable.
  printf '%s' "$1" | grep -o '"recording"[[:space:]]*:[[:space:]]*\(true\|false\)' | grep -o '\(true\|false\)$'
}

render_status() {
  # $1 = status JSON from /status or /toggle.
  local rec
  rec="$(is_recording "$1")"
  if [ "$rec" = "true" ]; then
    waybar_json "● Floure" "Floure: recording — click to stop" "recording"
  elif [ "$rec" = "false" ]; then
    waybar_json "○ Floure" "Floure: idle — click to dictate (Super+Space)" "idle"
  else
    local err
    err="$(printf '%s' "$1" | head -c 160)"
    waybar_json "○ Floure" "Floure: ${err:-unexpected response}" "error"
  fi
}

cmd_status() {
  local resp
  if ! resp="$(curl -sS --max-time 2 "${BASE}/status" 2>/dev/null)"; then
    waybar_json "○ Floure" "Floure not running" "idle"
    return 0
  fi
  render_status "$resp"
}

cmd_toggle() {
  # First run may block on model download — allow a long timeout.
  local resp
  if ! resp="$(curl -sS --max-time 60 -X POST "${BASE}/toggle" 2>/dev/null)"; then
    waybar_json "○ Floure" "Floure not running" "error"
    return 0
  fi
  render_status "$resp"
}

cmd_show() {
  curl -sS --max-time 2 -X POST "${BASE}/show" >/dev/null 2>&1
  cmd_status
}

case "${1:-status}" in
  status) cmd_status ;;
  toggle) cmd_toggle ;;
  show) cmd_show ;;
  *)
    echo "usage: $(basename "$0") [status|toggle|show]" >&2
    exit 2
    ;;
esac
