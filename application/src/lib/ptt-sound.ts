// ── PTT earcons: tiny WebAudio blips on talk start/stop (Wispr Flow-style) ──
//
// No audio assets, no dependencies — a short oscillator blip with an
// exponential decay envelope. The context is created lazily and resumed on
// every play: browsers start it suspended until the first real user
// interaction unlocks it, after which global-hotkey presses can sound too.

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function blip(fromHz: number, toHz: number) {
  const ac = context();
  if (!ac) return;
  try {
    const t = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(fromHz, t);
    osc.frequency.exponentialRampToValueAtTime(toHz, t + 0.09);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.13);
  } catch {
    /* audio is best-effort — never break PTT over a blip */
  }
}

/// Ascending blip on PTT press (talk start).
export function playPttStart() {
  blip(660, 880);
}

/// Descending blip on PTT release (talk stop).
export function playPttStop() {
  blip(880, 660);
}
