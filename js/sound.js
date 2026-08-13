/* ============================================================
   Two soft bells and a small chord, synthesised on the spot.
   No files to download, nothing that sounds like an alarm.
   ============================================================ */
let ctx = null;

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export const wake = () => ac();

function bell(freq, { at = 0, dur = 2.6, gain = .18, type = 'sine' } = {}) {
  const c = ac(); if (!c) return;
  const t = c.currentTime + at;
  const o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  lp.type = 'lowpass'; lp.frequency.setValueAtTime(2200, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + .015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(lp).connect(g).connect(c.destination);
  o.start(t); o.stop(t + dur + .05);
}

/** end of a focus interval — a settling, descending pair */
export const chimeRest = (v = 1) => {
  bell(523.25, { gain: .16 * v, dur: 3.1 });
  bell(392.00, { at: .42, gain: .13 * v, dur: 3.6 });
  bell(261.63, { at: .84, gain: .10 * v, dur: 4.2 });
};

/** end of a break — lifting, a fifth up */
export const chimeWork = (v = 1) => {
  bell(392.00, { gain: .13 * v, dur: 2.4 });
  bell(587.33, { at: .34, gain: .15 * v, dur: 2.8 });
};

/** a badge */
export const chimeBadge = (v = 1) => {
  [659.25, 830.61, 987.77].forEach((f, i) =>
    bell(f, { at: i * .11, gain: .10 * v, dur: 2.2, type: 'triangle' }));
};
