//! Windows-only push-to-talk hook: bare Ctrl+Win hold.
//!
//! Tauri's global-shortcut backend requires a main key, so a pure modifier
//! chord (Ctrl+Win) cannot be registered there. This low-level keyboard hook
//! watches for Ctrl+Win held together and emits `ptt-hook` pressed/released
//! events; the frontend drives the existing start/stop path off those, so
//! the overlay, sounds, widget, and guards are all reused.
//!
//! Key-down events for Ctrl always pass through (the OS must see matching
//! downs/ups or modifiers stick). A Win key-down passes only when Ctrl is
//! NOT held; while Ctrl is held the down is swallowed so Windows never
//! enters Win-held state at all — no shortcut layer, no Start menu, no
//! on-screen-keyboard highlight. Bare Win taps behave exactly as stock.
//! While a session is active every *other* key-down is swallowed for the
//! same reason (Win+I opening Settings mid-sentence, …); key-ups always
//! pass so nothing sticks. Ctrl+Alt+Del cannot be swallowed by design
//! (secure attention sequence) and still works.
//! ponytail: Alt+Tab and friends are also swallowed mid-hold; per-app
//! allow-listing if that ever matters (it hasn't — holds last seconds).

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter};
use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_CONTROL};
use windows::Win32::UI::WindowsAndMessaging::*;

const VK_LCONTROL: u32 = 0xA2;
const VK_RCONTROL: u32 = 0xA3;
const VK_LWIN: u32 = 0x5B;
const VK_RWIN: u32 = 0x5C;

static APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();
static CTRL_DOWN: AtomicBool = AtomicBool::new(false);
static WIN_DOWN: AtomicBool = AtomicBool::new(false);
static ACTIVE: AtomicBool = AtomicBool::new(false);
static IN_SESSION: AtomicBool = AtomicBool::new(false);
/// Whether the current Win hold's key-down was swallowed (Ctrl was already
/// held). The matching key-up must then be swallowed too, or the OS sees a
/// stuck Win.
static WIN_SWALLOWED: AtomicBool = AtomicBool::new(false);

fn emit(payload: &str) {
    if let Some(app) = APP.get() {
        let _ = app.emit("ptt-hook", payload);
    }
}

unsafe extern "system" fn hook_proc(ncode: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if ncode == HC_ACTION as i32 {
        let info = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
        // Our own typing/paste output must never retrigger the hook.
        if info.flags.0 & LLKHF_INJECTED.0 == 0 {
            let msg = wparam.0 as u32;
            let down = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
            let up = msg == WM_KEYUP || msg == WM_SYSKEYUP;

            match info.vkCode {
                VK_LCONTROL | VK_RCONTROL => {
                    if down {
                        CTRL_DOWN.store(true, Ordering::SeqCst);
                    } else if up {
                        CTRL_DOWN.store(false, Ordering::SeqCst);
                    }
                }
                VK_LWIN | VK_RWIN => {
                    if down {
                        WIN_DOWN.store(true, Ordering::SeqCst);
                        // Resync before trusting CTRL_DOWN: the hook receives no
                        // events on the secure desktop (UAC, Ctrl+Alt+Del), so
                        // a Ctrl released there leaves the flag stuck true —
                        // and the next *plain* Win tap would then be swallowed
                        // and start a recording with no Ctrl held.
                        let ctrl_now =
                            unsafe { GetAsyncKeyState(VK_CONTROL.0 as i32) } as u16 & 0x8000 != 0;
                        CTRL_DOWN.store(ctrl_now, Ordering::SeqCst);
                        if CTRL_DOWN.load(Ordering::SeqCst) {
                            // Ctrl already held: consume the Win press so the
                            // OS never enters Win-held state. Track it so the
                            // matching release is consumed as well.
                            WIN_SWALLOWED.store(true, Ordering::SeqCst);
                        }
                    } else if up {
                        WIN_DOWN.store(false, Ordering::SeqCst);
                        if WIN_SWALLOWED.swap(false, Ordering::SeqCst) {
                            IN_SESSION.store(false, Ordering::SeqCst);
                            if ACTIVE.swap(false, Ordering::SeqCst) {
                                emit("released");
                            }
                            return LRESULT(1);
                        }
                        // Its down passed through (Win pressed first): let the
                        // up through too and close session tracking, so future
                        // third keys are not swallowed outside a session.
                        // (The Start menu may pop — normal Win behavior wins.)
                        IN_SESSION.store(false, Ordering::SeqCst);
                    }
                }
                _ => {
                    // Third key pressed during a session: swallow the
                    // down-stroke so no Win+<key> shortcut can fire
                    // mid-dictation (Win+I opening Settings, …). Ups always
                    // pass: swallowing an up for a down that passed earlier
                    // would leave the key logically stuck down.
                    if down && IN_SESSION.load(Ordering::SeqCst) {
                        return LRESULT(1);
                    }
                }
            }

            let held = CTRL_DOWN.load(Ordering::SeqCst) && WIN_DOWN.load(Ordering::SeqCst);
            if held != ACTIVE.swap(held, Ordering::SeqCst) {
                if held {
                    IN_SESSION.store(true, Ordering::SeqCst);
                    emit("pressed");
                } else {
                    // Released via Ctrl while Win is still down: the session
                    // flag stays set so the coming Win-up is swallowed above.
                    emit("released");
                }
            }

            // Swallow a Win key-down consumed above: evaluated after state so
            // pressed/released still fire exactly once.
            if down
                && matches!(info.vkCode, VK_LWIN | VK_RWIN)
                && WIN_SWALLOWED.load(Ordering::SeqCst)
            {
                return LRESULT(1);
            }
        }
    }
    CallNextHookEx(None, ncode, wparam, lparam)
}

/// Install the hook on a background thread with its own message loop.
/// Install failure is non-fatal (logged); the registered global shortcut
/// keeps working as the fallback PTT path.
pub fn start_ptt_hook(app: AppHandle) {
    if APP.set(app).is_err() {
        return;
    }
    std::thread::spawn(|| unsafe {
        match SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), None, 0) {
            Ok(hook) => {
                eprintln!("[ptt-hook] installed (hold Ctrl+Win to talk): {hook:?}");
                let mut msg = std::mem::MaybeUninit::<MSG>::zeroed().assume_init();
                while GetMessageW(&mut msg, None, 0, 0).as_bool() {}
            }
            Err(e) => eprintln!("[ptt-hook] install failed ({e}); Ctrl+Win PTT disabled"),
        }
    });
}
