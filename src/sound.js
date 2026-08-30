// Optional Web Audio blips. No asset files — everything is an OscillatorNode.
// Off by default; app.js flips `enabled` from the poker.sound store at boot and
// whenever the toggle changes. Every call is a no-op when disabled or when the
// browser has no usable AudioContext (e.g. headless).

let enabled = false;
let ctx = null;

export function setSoundEnabled(v) {
  enabled = !!v;
  if (enabled) ac(); // warm the context up on the user gesture that enabled it
}
export function soundEnabled() {
  return enabled;
}

function ac() {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch (e) {
    return null;
  }
}

function blip(freq, dur, delay = 0, type = 'sine', peak = 0.14) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

// a buy-in landing on the table
export function chip() {
  if (!enabled) return;
  blip(660, 0.07, 0, 'triangle', 0.11);
  blip(990, 0.06, 0.035, 'triangle', 0.07);
}

// stacks balanced at cash-out
export function cash() {
  if (!enabled) return;
  [523.25, 659.25, 783.99].forEach((f, i) => blip(f, 0.16, i * 0.06, 'sine', 0.11));
}

// the results screen
export function fanfare() {
  if (!enabled) return;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => blip(f, 0.22, i * 0.1, 'triangle', 0.12));
  blip(1567.98, 0.4, 0.44, 'sine', 0.09);
}
