/* ============================================================
   The painter.

   A picture is not faded in — it is *painted*: a toned ground
   first, then broad strokes off a blurred reduction of the
   image, then progressively finer ones, each laid along the
   direction of the local edge the way a brush actually moves.
   The whole schedule is stretched across the interval, so the
   last details land as the timer reaches zero.

   Everything is deterministic for a given seed and canvas size,
   which is what lets a resize (or a mid-session change of
   picture) replay instantly to exactly where you were.
   ============================================================ */
import { mulberry32, hashStr, clamp, lerp, smoothstep, reducedMotion } from './util.js';

const TAU = Math.PI * 2;
const MAX_PIXELS = 5.2e6;
const MAX_WET = 22;      // brushes on the canvas at once
const BURST = 60;        // beyond this many strokes behind, stop animating and catch up

/* size fraction of the short edge · which blur level to sample ·
   how much of the interval this layer owns · how picky it is about detail */
const LAYERS = [
  { t0:0,   t1:.09, size:.120, mip:3, over:2.4, elong:2.1, wide:.84, alpha:[.42,.62], detail:0,   segs:7, bristle:3, blunt:[.58,.78], halo:.34 },
  { t0:.09, t1:.32, size:.056, mip:2, over:1.9, elong:2.3, wide:.70, alpha:[.52,.74], detail:0,   segs:6, bristle:3, blunt:[.44,.64], halo:.22 },
  { t0:.32, t1:.58, size:.027, mip:1, over:1.6, elong:2.4, wide:.58, alpha:[.62,.84], detail:.12, segs:5, bristle:2, blunt:[.32,.52], halo:0   },
  { t0:.58, t1:.78, size:.0132,mip:0, over:1.35,elong:2.3, wide:.52, alpha:[.60,.86], detail:.34, segs:4, bristle:2, blunt:[.24,.44], halo:0, sweep:7 },
  { t0:.78, t1:.93, size:.0062,mip:0, over:1.2, elong:2.2, wide:.48, alpha:[.55,.82], detail:.50, segs:3, bristle:1, blunt:[.18,.38], halo:0, sweep:11 },
  { t0:.93, t1:1,   size:.0032,mip:0, over:1.0, elong:2.0, wide:.46, alpha:[.50,.78], detail:.72, segs:2, bristle:0, blunt:[.14,.32], halo:0, sweep:16 },
];

export class Painter {
  /** `fixed` paints into a canvas of a given size instead of the viewport, and
      `coarse` uses a bigger brush and fewer passes — between them that's a
      miniature of any picture, from nothing but its seed. */
  constructor(canvas, { fixed = null, coarse = false } = {}) {
    this.fixed = fixed;
    this.coarse = coarse;
    this.cv = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    // paint that has dried; the wet strokes are re-drawn over it every frame
    this.settled = document.createElement('canvas');
    this.sctx = this.settled.getContext('2d', { alpha: false });
    this.active = [];

    this.mips = [];
    this.data = [];
    this.grad = null;
    this.plan = null;
    this.img = null;
    this.tainted = true;
    this.drawn = 0;
    this.target = 0;
    this.progress = 0;
    this.catchUp = false;
    this.dissolve = 0;
    this.dirty = true;
    this.seed = 1;
    this.ground = '#141210';
    this.groundLuma = .1;
    this.accent = '#c9a227';
    this.accentHsl = [.116, .68, .53];
    this.lowMotion = reducedMotion();
    this.fit = 'fill';                 // 'fill' bleeds off the edges · 'frame' hangs it on a wall
    this.wall = '#0f0e0d';
    this._min = 900;                   // short edge, for the flow field
    this._px = new Float32Array(64);   // scratch: the path a single stroke takes
    this._py = new Float32Array(64);
    this.setSize();
  }

  /* ---------------------------------------------------- sizing */
  setSize() {
    if (this.fixed) {
      if (this.fixed.w === this.W && this.fixed.h === this.H) return false;
      this.W = this.cv.width = this.settled.width = this.fixed.w;
      this.H = this.cv.height = this.settled.height = this.fixed.h;
      this.dpr = 1;
      this._toothPat = null;
      return true;
    }
    const cssW = Math.max(320, window.innerWidth);
    const cssH = Math.max(320, window.innerHeight);
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    // stay at least 1:1 with CSS pixels — a soft canvas is worse than a busy one
    if (cssW * cssH * dpr * dpr > MAX_PIXELS)
      dpr = Math.max(1, Math.min(dpr, Math.sqrt(MAX_PIXELS / (cssW * cssH))));
    const w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
    if (w === this.W && h === this.H) return false;
    this.W = w; this.H = h; this.dpr = dpr;
    this._toothPat = null;
    this.cv.width = w; this.cv.height = h;
    this.settled.width = w; this.settled.height = h;
    this.cv.style.width = cssW + 'px';
    this.cv.style.height = cssH + 'px';
    return true;
  }

  /** where the picture sits. Filling overscans by 3.5%, because museum
      photographs often carry a sliver of frame or mount at the edge;
      framing fits the whole thing and leaves a wall around it. */
  _rect() {
    const iw = this.img.naturalWidth || this.img.width;
    const ih = this.img.naturalHeight || this.img.height;
    const s = this.fit === 'frame'
      ? Math.min(this.W / iw, this.H / ih) * .72
      : Math.max(this.W / iw, this.H / ih) * 1.035;
    const w = iw * s, h = ih * s;
    const y = this.fit === 'frame' ? (this.H - h) / 2 - this.H * .012 : (this.H - h) / 2;
    return { x: (this.W - w) / 2, y, w, h };
  }

  /** switch between filling the screen and hanging it, mid-interval if you like */
  setFit(fit) {
    if (fit === this.fit) return;
    this.fit = fit;
    if (!this.img) return;
    this._buildPlan();
    this.drawn = 0;
    this.active.length = 0;
    this.dissolve = 0;
    this._ground();
    this.target = this._targetFor(this.progress);
    this.catchUp = true;
  }

  /* ----------------------------------------------- loading art */
  load(img, { tainted = false, key = '' } = {}) {
    const hadPicture = this.drawn > 0 || this.dissolve > 0;
    this.img = img;
    this.tainted = tainted;
    this.seed = hashStr(key || String(Math.random()));
    this._buildMips();
    this._readPixels();
    this._gradients();
    this._analyse();
    this._buildPlan();
    this.drawn = 0;
    this.active.length = 0;
    // the new wash goes down over the old picture, the way a canvas gets reused
    this.dissolve = hadPicture && !this.lowMotion ? 1 : 0;
    this._diss = 0;
    if (!this.dissolve) this._ground();
    this.catchUp = true;
  }

  /** the sharper file arrived mid-interval: keep every stroke, sample better from here on */
  upgrade(img, tainted = false) {
    if (!this.plan || !img) return;
    this.img = img;
    this.tainted = tainted;
    this._buildMips();
    this._readPixels();
    this._gradients();
  }

  _buildMips() {
    this.mips = [];
    const widths = [1040, 400, 176, 72];
    const iw = this.img.naturalWidth || 1, ih = this.img.naturalHeight || 1;
    let src = this.img;
    for (const target of widths) {
      const w = Math.max(8, Math.min(target, iw));
      const h = Math.max(8, Math.round(w * ih / iw));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.imageSmoothingQuality = 'high';
      g.drawImage(src, 0, 0, w, h);
      this.mips.push(c);
      src = c;                                   // step down from the previous level: smoother, cheaper
    }
  }

  _readPixels() {
    this.data = [];
    if (this.tainted) return;
    try {
      for (const c of this.mips) {
        const g = c.getContext('2d', { willReadFrequently: true });
        this.data.push(g.getImageData(0, 0, c.width, c.height));
      }
    } catch {
      this.tainted = true;                       // CORS said no; fall back to clipped reveals
      this.data = [];
    }
  }

  /** edge directions off the mid mip — brushes follow the form */
  _gradients() {
    const im = this.data[2];
    if (!im) { this.grad = null; return; }
    const { width: w, height: h, data: d } = im;
    const lum = new Float32Array(w * h);
    for (let i = 0, p = 0; i < lum.length; i++, p += 4)
      lum[i] = (d[p] * .299 + d[p + 1] * .587 + d[p + 2] * .114) / 255;
    const ang = new Float32Array(w * h), mag = new Float32Array(w * h);
    const at = (x, y) => lum[clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)
               - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)
               - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      const i = y * w + x;
      mag[i] = Math.hypot(gx, gy);
      ang[i] = Math.atan2(gy, gx) + Math.PI / 2;   // along the edge, not across it
    }
    this.grad = { w, h, ang, mag };
  }

  /** the ground tone and the accent the interface borrows from the picture */
  _analyse() {
    const im = this.data[3];
    let r = 90, g = 84, b = 78;
    if (im) {
      const d = im.data;
      let R = 0, G = 0, B = 0, n = 0;
      const buckets = new Array(12).fill(0).map(() => ({ r:0, g:0, b:0, w:0 }));
      for (let p = 0; p < d.length; p += 4) {
        R += d[p]; G += d[p+1]; B += d[p+2]; n++;
        const mx = Math.max(d[p], d[p+1], d[p+2]), mn = Math.min(d[p], d[p+1], d[p+2]);
        const sat = mx ? (mx - mn) / mx : 0;
        const [hh] = rgbToHsl(d[p], d[p+1], d[p+2]);
        const bk = buckets[Math.min(11, Math.floor(hh * 12))];
        const weight = sat * sat * (1 - Math.abs(((mx + mn) / 510) - .5) * 1.2);
        bk.r += d[p] * weight; bk.g += d[p+1] * weight; bk.b += d[p+2] * weight;
        bk.w += weight;
      }
      r = R / n; g = G / n; b = B / n;
      const best = buckets.reduce((a, c) => (c.w > a.w ? c : a), buckets[0]);
      if (best.w > 0.4) {
        const [h, s, l] = rgbToHsl(best.r / best.w, best.g / best.w, best.b / best.w);
        this.accentHsl = [h, clamp(s * 1.15, .3, .85), clamp(l, .48, .68)];
        this.accent = hslToCss(...this.accentHsl);
      } else {
        this.accentHsl = [.116, .68, .53];
        this.accent = hslToCss(...this.accentHsl);
      }
    } else {
      this.accentHsl = [.116, .68, .53];
      this.accent = hslToCss(...this.accentHsl);
    }
    // an imprimatura: the average, knocked back and desaturated
    const gr = [r, g, b].map(v => clamp(v * .52 + 12, 8, 190));
    const avg = (gr[0] + gr[1] + gr[2]) / 3;
    const tone = gr.map(v => lerp(avg, v, .55) * .9);
    this.ground = `rgb(${tone.map(Math.round).join(',')})`;
    this.groundLuma = (tone[0] * .299 + tone[1] * .587 + tone[2] * .114) / 255;
    const wall = tone.map(v => clamp(v * .42 + 6, 6, 90));
    this.wall = `rgb(${wall.map(Math.round).join(',')})`;
    this.wallLuma = (wall[0] * .299 + wall[1] * .587 + wall[2] * .114) / 255;
  }

  _ground(alpha = 1, tooth = true) {
    const g = this.sctx;
    const rect = this.plan?.rect || this._rect();
    const framed = this.fit === 'frame';
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = alpha;

    if (framed) {
      g.fillStyle = this.wall;
      g.fillRect(0, 0, this.W, this.H);
      const lit = g.createRadialGradient(this.W / 2, this.H * .1, 0, this.W / 2, this.H * .1, this.H * 1.25);
      lit.addColorStop(0, 'rgba(255,248,232,.09)');
      lit.addColorStop(1, 'rgba(255,248,232,0)');
      g.fillStyle = lit;                         // a light somewhere above, as in any decent room
      g.fillRect(0, 0, this.W, this.H);
      g.save();                                  // the canvas throws a little shadow on the wall
      g.shadowColor = 'rgba(0,0,0,.55)';
      g.shadowBlur = Math.round(this.H * .05);
      g.shadowOffsetY = Math.round(this.H * .016);
      g.fillStyle = this.ground;
      g.fillRect(rect.x, rect.y, rect.w, rect.h);
      g.restore();
    } else {
      g.fillStyle = this.ground;
      g.fillRect(0, 0, this.W, this.H);
    }

    // a little tooth, so gaps between strokes read as canvas
    if (tooth) {
      g.globalAlpha = .05 * alpha;
      g.fillStyle = this._tooth();
      framed ? g.fillRect(rect.x, rect.y, rect.w, rect.h) : g.fillRect(0, 0, this.W, this.H);
    }
    g.globalAlpha = 1;
    this.dirty = true;
  }

  /** one tile of canvas weave, reused for every picture */
  _tooth() {
    if (this._toothPat) return this._toothPat;
    const s = 128;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');
    const rnd = mulberry32(0x51ed7a);
    const step = Math.max(3, Math.round(this.dpr * 2.5));
    g.fillStyle = '#000';
    for (let i = 0, n = (s * s) / (step * step * 26); i < n; i++)
      g.fillRect(rnd() * s, rnd() * s, step, step * .6);
    this._toothPat = this.sctx.createPattern(c, 'repeat');
    return this._toothPat;
  }

  /* ------------------------------------------------- the plan */
  _buildPlan() {
    const rnd = mulberry32(this.seed);
    const rect = this._rect();
    const framed = this.fit === 'frame';
    const field = framed ? rect : { x: 0, y: 0, w: this.W, h: this.H };
    const min = framed ? Math.min(rect.w, rect.h) : Math.min(this.W, this.H);
    this._min = min;
    const xs = [], ys = [], an = [], sz = [], al = [], lm = [], lay = [];
    const bounds = [];
    const upscale = rect.w / (this.img?.naturalWidth || rect.w);
    const cut = this.coarse ? 3 : this.lowMotion ? 4 : upscale > 2.3 ? 4 : LAYERS.length;
    const layers = LAYERS.slice(0, cut).map(L => this.coarse
      ? { ...L, size: L.size * 1.5, over: L.over * .85, t1: L.t1 / LAYERS[2].t1 }
      : L);

    layers.forEach((L, li) => {
      const cell = Math.max(2, L.size * min);
      // one cell of bleed on every side, so the picture runs off its edges
      const bleed = framed ? 0 : 1;
      const nx = Math.ceil(field.w / cell) + bleed * 2, ny = Math.ceil(field.h / cell) + bleed * 2;
      const cells = nx * ny;
      const count = Math.round(cells * L.over);
      const start = xs.length;
      const order = new Int32Array(cells);
      for (let i = 0; i < cells; i++) order[i] = i;
      for (let i = cells - 1; i > 0; i--) {       // shuffled so coverage grows evenly, not in rows
        const j = Math.floor(rnd() * (i + 1));
        const t = order[i]; order[i] = order[j]; order[j] = t;
      }
      const made = [];
      for (let k = 0; k < count; k++) {
        const c = order[k % cells];
        const x = field.x + ((c % nx) + rnd() - bleed) * cell;
        const y = field.y + (Math.floor(c / nx) + rnd() - bleed) * cell;
        const u = (x - rect.x) / rect.w, v = (y - rect.y) / rect.h;
        let m = 0, a;
        if (this.grad) {
          const gw = this.grad.w, gh = this.grad.h;
          const gi = clamp(Math.floor(v * gh), 0, gh - 1) * gw + clamp(Math.floor(u * gw), 0, gw - 1);
          m = this.grad.mag[gi];
          a = this.grad.ang[gi];
          if (m < .28) a = flow(x, y, min) * .7 + a * .3;     // flat passages get a calm sweep
        } else {
          a = flow(x, y, min);
        }
        if (L.detail && m < .5 && rnd() > 1 - L.detail) continue;   // spend the fine work on edges
        made.push({
          x, y,
          a: a + (rnd() - .5) * lerp(.86, .3, clamp(m, 0, 1)),
          s: cell * lerp(.62, 1.62, Math.pow(rnd(), 1.7)),
          al: lerp(L.alpha[0], L.alpha[1], rnd()),
          lm: lerp(1.16, .66, clamp(m, 0, 1)),
          k: 0,
        });
      }
      if (L.sweep) {
        // the finishing passes travel over the picture in bands, so you can
        // watch it sharpen under the brush instead of everywhere at once
        const band = (field.h + field.w * .42) / L.sweep;
        for (const st of made) st.k = Math.floor(((st.y - field.y) + (st.x - field.x) * .42) / band) + rnd() * .5;
        made.sort((p, q) => p.k - q.k);
      }
      for (const st of made) {
        xs.push(st.x); ys.push(st.y);
        an.push(st.a); sz.push(st.s); al.push(st.al); lm.push(st.lm);
        lay.push(li);
      }
      bounds.push({ ...L, start, end: xs.length });
    });

    this.plan = {
      xs: Float32Array.from(xs), ys: Float32Array.from(ys),
      an: Float32Array.from(an), sz: Float32Array.from(sz),
      al: Float32Array.from(al), lm: Float32Array.from(lm), lay: Uint8Array.from(lay),
      bounds, n: xs.length, rect,
    };
  }

  /** where the schedule says we should be at this fraction of the interval */
  _targetFor(p) {
    const b = this.plan?.bounds;
    if (!b) return 0;
    for (const L of b) {
      if (p >= L.t1) continue;
      if (p <= L.t0) return L.start;
      return L.start + Math.round((L.end - L.start) * (p - L.t0) / (L.t1 - L.t0));
    }
    return this.plan.n;
  }

  setProgress(p) {
    this.progress = clamp(p, 0, 1);
    const t = this._targetFor(this.progress);
    if (t < this.drawn) {                       // rewound: the canvas has to be scraped back
      this._ground();
      this.drawn = 0;
      this.active.length = 0;
      this.catchUp = true;
    }
    this.target = t;
  }

  /* ------------------------------------------------- painting */
  /** the direction the brush is travelling at this point, following the form
      without ever doubling back on itself */
  _heading(x, y, prev) {
    const G = this.grad;
    let a;
    if (G) {
      const R = this.plan.rect;
      const u = clamp((x - R.x) / R.w, 0, .999), v = clamp((y - R.y) / R.h, 0, .999);
      const gi = ((v * G.h) | 0) * G.w + ((u * G.w) | 0);
      a = G.mag[gi] < .28 ? flow(x, y, this._min) : G.ang[gi];
    } else {
      a = flow(x, y, this._min);
    }
    // an edge direction has no sign, so pick the reading nearest the current heading
    while (a - prev > Math.PI / 2) a -= Math.PI;
    while (a - prev < -Math.PI / 2) a += Math.PI;
    return prev + (a - prev) * .6;
  }

  /** lay the stroke's path into the scratch buffers, returns the segment count */
  _path(x, y, ang, len, segs) {
    const px = this._px, py = this._py;
    const step = len / segs;
    let a = ang;
    let cx = x - Math.cos(ang) * len * .5;
    let cy = y - Math.sin(ang) * len * .5;
    for (let k = 0; k <= segs; k++) {
      px[k] = cx; py[k] = cy;
      a = this._heading(cx, cy, a);
      cx += Math.cos(a) * step;
      cy += Math.sin(a) * step;
    }
    return segs;
  }

  /** a point along the stroke's path at a fractional position */
  _at(segs, t, out) {
    const px = this._px, py = this._py;
    const f = clamp(t, 0, 1) * segs;
    const k = Math.min(segs - 1, Math.floor(f)), u = f - k;
    out[0] = px[k] + (px[k + 1] - px[k]) * u;
    out[1] = py[k] + (py[k + 1] - py[k]) * u;
    out[2] = Math.atan2(py[k + 1] - py[k], px[k + 1] - px[k]);
    return out;
  }

  /** the outline of a loaded brush: the belly sits early, where it landed
      with the most paint, the edges are never quite even, and the ends are
      chiselled off the way a flat brush leaves them. */
  _outline(g, segs, wid, blunt, ph = 0, t0 = 0, t1 = 1) {
    const n = Math.max(3, Math.ceil((t1 - t0) * segs * 2.2));
    const ax = [], ay = [], bx = [], by = [];
    const p = [0, 0, 0];
    const chisel = (((ph * 7) % 1) - .5) * .9;
    for (let j = 0; j <= n; j++) {
      const t = t0 + (t1 - t0) * (j / n);
      this._at(segs, t, p);
      const body = blunt + (1 - blunt) * Math.pow(Math.sin(Math.PI * Math.pow(t, .72)), .5);
      const wobA = 1 + .17 * Math.sin(t * 9.3 + ph) + .085 * Math.sin(t * 23.7 + ph * 1.7);
      const wobB = 1 + .17 * Math.sin(t * 8.1 + ph * 2.3 + 2) + .085 * Math.sin(t * 21.3 + ph);
      const half = wid * .5 * body;
      const sx = -Math.sin(p[2]), sy = Math.cos(p[2]);
      const cx = Math.cos(p[2]), cy = Math.sin(p[2]);
      // the tips are cut at an angle, not squared off
      const lead = (j === 0 ? -1 : j === n ? 1 : 0) * half * chisel;
      ax[j] = p[0] + sx * half * wobA + cx * lead;
      ay[j] = p[1] + sy * half * wobA + cy * lead;
      bx[j] = p[0] - sx * half * wobB - cx * lead;
      by[j] = p[1] - sy * half * wobB - cy * lead;
    }
    g.beginPath();
    g.moveTo(ax[0], ay[0]);
    for (let j = 1; j < n; j++)
      g.quadraticCurveTo(ax[j], ay[j], (ax[j] + ax[j + 1]) / 2, (ay[j] + ay[j + 1]) / 2);
    g.lineTo(ax[n], ay[n]);
    g.lineTo(bx[n], by[n]);
    for (let j = n - 1; j > 0; j--)
      g.quadraticCurveTo(bx[j], by[j], (bx[j] + bx[j - 1]) / 2, (by[j] + by[j - 1]) / 2);
    g.closePath();
  }

  /** the hairs the brush drags through the wet paint */
  _bristles(g, segs, wid, n, r, gg, b, alpha, seed, t1 = 1) {
    const p = [0, 0, 0];
    const steps = Math.max(2, Math.ceil(t1 * segs * 1.6));
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.lineWidth = Math.max(.6, wid * .13);
    for (let h = 0; h < n; h++) {
      const off = ((h + 1) / (n + 1) - .5) * wid * .78;
      const k = 1 + ((seed + h * 7) % 5) * .045;          // each hair carries slightly different paint
      const from = ((seed + h * 3) % 4) === 0 ? .12 : .04; // and some start late
      if (t1 <= from) continue;
      g.globalAlpha = alpha * .42;
      g.strokeStyle = `rgb(${clamp(r * k, 0, 255) | 0},${clamp(gg * k, 0, 255) | 0},${clamp(b * k, 0, 255) | 0})`;
      g.beginPath();
      for (let j = 0; j <= steps; j++) {
        const t = from + (t1 - from) * (j / steps);
        this._at(segs, t, p);
        const taper = Math.pow(Math.sin(Math.PI * t), .4);
        const wob = off * taper * (1 + .2 * Math.sin(t * 9 + h * 2.3));   // hairs weave, they don't run parallel
        const x = p[0] - Math.sin(p[2]) * wob;
        const y = p[1] + Math.cos(p[2]) * wob;
        j === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.stroke();
    }
  }

  /** paint stroke i into g, as far along as `upTo` */
  _stroke(i, g, upTo = 1) {
    const P = this.plan;
    const L = P.bounds[P.lay[i]];
    const x = P.xs[i], y = P.ys[i], s = P.sz[i];
    const len = s * L.elong * P.lm[i];
    const wid = s * L.wide;
    const segs = this._path(x, y, P.an[i], len, L.segs);
    const blunt = lerp(L.blunt[0], L.blunt[1], (i % 5) / 4);   // a broad brush lays bands, a fine one points
    const ph = (i % 23) * .41;                                 // this brush's own irregularities
    const t = clamp(upTo, .02, 1);
    const box = this._box(segs, wid);

    if (this.tainted) {                                   // no pixel access: reveal through the shape
      g.save();
      this._outline(g, segs, wid, blunt, ph, 0, t);
      g.clip();
      g.globalAlpha = P.al[i];
      g.drawImage(this.mips[L.mip], P.rect.x, P.rect.y, P.rect.w, P.rect.h);
      g.restore();
      g.globalAlpha = 1;
      return box;
    }

    const im = this.data[L.mip];
    const u = clamp((x - P.rect.x) / P.rect.w, 0, .999);
    const v = clamp((y - P.rect.y) / P.rect.h, 0, .999);
    const px = (((v * im.height) | 0) * im.width + ((u * im.width) | 0)) * 4;
    const d = im.data;
    const jit = (i % 7 - 3) * 2.2;
    const r = clamp(d[px] + jit, 0, 255) | 0;
    const gg = clamp(d[px + 1] + jit * .8, 0, 255) | 0;
    const b = clamp(d[px + 2] - jit * .6, 0, 255) | 0;
    const paint = `rgb(${r},${gg},${b})`;

    if (L.halo) {                                         // the broad passages sit in a wash
      g.globalAlpha = P.al[i] * L.halo;
      g.fillStyle = paint;
      this._outline(g, segs, wid * 1.5, .55, ph + 1.9, 0, t);
      g.fill();
    }
    g.globalAlpha = P.al[i];
    g.fillStyle = paint;
    this._outline(g, segs, wid, blunt, ph, 0, t);
    g.fill();

    if (L.bristle && wid > 5) this._bristles(g, segs, wid, L.bristle, r, gg, b, P.al[i], i, t);

    if (t < 1 && wid > 3) {                               // the wet tip, where the brush is right now
      const p = this._at(segs, t, [0, 0, 0]);
      g.globalAlpha = P.al[i] * .5;
      g.fillStyle = `rgb(${clamp(r * 1.1, 0, 255) | 0},${clamp(gg * 1.1, 0, 255) | 0},${clamp(b * 1.1, 0, 255) | 0})`;
      g.beginPath();
      g.ellipse(p[0], p[1], wid * .42, wid * .5, p[2], 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
    return box;
  }

  /** the patch of canvas a stroke can reach, clamped to the frame */
  _box(segs, wid) {
    const px = this._px, py = this._py;
    let x0 = px[0], x1 = px[0], y0 = py[0], y1 = py[0];
    for (let k = 1; k <= segs; k++) {
      if (px[k] < x0) x0 = px[k]; else if (px[k] > x1) x1 = px[k];
      if (py[k] < y0) y0 = py[k]; else if (py[k] > y1) y1 = py[k];
    }
    const pad = wid * 1.3 + 3;
    x0 = Math.max(0, Math.floor(x0 - pad)); y0 = Math.max(0, Math.floor(y0 - pad));
    x1 = Math.min(this.W, Math.ceil(x1 + pad)); y1 = Math.min(this.H, Math.ceil(y1 + pad));
    return x1 > x0 && y1 > y0 ? [x0, y0, x1 - x0, y1 - y0] : null;
  }

  /** how long this stroke should take to lay down, in ms */
  _duration(i) {
    const P = this.plan, L = P.bounds[P.lay[i]];
    const len = P.sz[i] * L.elong * P.lm[i];
    return clamp(len / (.62 * this.dpr) * 1.6, 190, 1150);
  }

  /** called every animation frame; keeps within a strict time budget */
  frame(dt = 16) {
    if (!this.plan) return;

    if (this.dissolve > 0) {                         // laying the new ground over the old picture
      this._diss = (this._diss || 0) + dt;
      if (this._diss < 56) return;                   // fewer, fatter steps: a wash, not an animation
      const step = this._diss; this._diss = 0;
      const was = 1 - this.dissolve;
      this.dissolve = Math.max(0, this.dissolve - step / 1150);
      const now = 1 - this.dissolve;
      const a = (smoothstep(now) - smoothstep(was)) / Math.max(.001, 1 - smoothstep(was));
      this._ground(clamp(a, 0, 1), this.dissolve === 0);
      if (this.dissolve === 0) this._ground(1);
      this._present();
      return;
    }

    const behind = this.target - this.drawn - this.active.length;

    // a long way behind — a replay, a resize, or a picture arriving mid-interval.
    // Those go straight onto the dry layer, as fast as the frame will allow.
    if (this.catchUp || behind > BURST) {
      const t0 = performance.now();
      while (this.drawn < this.target - this.active.length) {
        this._stroke(this.drawn++, this.sctx);
        if ((this.drawn & 31) === 0 && performance.now() - t0 > 11) break;
      }
      this.dirty = true;
      if (this.drawn >= this.target - this.active.length) this.catchUp = false;
      this._present();
      return;
    }

    // otherwise: begin as many strokes as the schedule is asking for, and let
    // each one travel. Nothing appears fully formed.
    const want = clamp(1 + Math.ceil(behind * .5), 1, MAX_WET);
    while (this.drawn + this.active.length < this.target && this.active.length < want)
      this.active.push({ i: this.drawn + this.active.length, t: 0, d: this._duration(this.drawn + this.active.length) });

    let settledAny = false;
    for (let k = this.active.length - 1; k >= 0; k--) {
      const a = this.active[k];
      a.t += dt / a.d;
      if (a.t >= 1 && a.i === this.drawn) {          // strokes dry in the order they were begun
        this._stroke(a.i, this.sctx);
        this.drawn++;
        this.active.splice(k, 1);
        settledAny = true;
      }
    }
    // a stroke that finished out of order waits its turn without moving further
    for (const a of this.active) if (a.t > 1) a.t = 1;
    if (settledAny) this.dirty = true;
    this._present();
  }

  /** dry paint, then whatever the brush is in the middle of. Only the patches
      under a moving brush are re-drawn; the rest of the canvas is left alone. */
  _present() {
    const ctx = this.ctx;
    const wet = this._wet || (this._wet = []);
    if (!this.dirty && !this.active.length && !wet.length) return;
    ctx.globalAlpha = 1;
    if (this.dirty) {
      ctx.drawImage(this.settled, 0, 0);          // ground changed, or a burst of dry strokes
      this.dirty = false;
    } else {
      for (const b of wet) ctx.drawImage(this.settled, b[0], b[1], b[2], b[3], b[0], b[1], b[2], b[3]);
    }
    wet.length = 0;
    for (const a of this.active) {
      const b = this._stroke(a.i, ctx, a.t);
      if (b) wet.push(b);
    }
  }

  /** viewport changed: rebuild the plan and race back to where we were */
  resize() {
    if (!this.setSize() || !this.img) return;
    this._buildPlan();
    this.drawn = 0;
    this.active.length = 0;
    this.dissolve = 0;
    this._ground();
    this.target = this._targetFor(this.progress);
    this.catchUp = true;
  }

  /** how bright the canvas is inside a viewport-relative box, right now */
  zoneLuma(x0, y0, x1, y1) {
    const im = this.data[3];
    const t = clamp(this.progress * 1.7, 0, 1);
    if (!im || !this.plan) return lerp(this.groundLuma, .45, t);
    const R = this.plan.rect, d = im.data;
    // how much of this corner of the screen the picture actually occupies
    const bw = (x1 - x0) * this.W, bh = (y1 - y0) * this.H;
    const ox = Math.max(0, Math.min(x1 * this.W, R.x + R.w) - Math.max(x0 * this.W, R.x));
    const oy = Math.max(0, Math.min(y1 * this.H, R.y + R.h) - Math.max(y0 * this.H, R.y));
    const cover = clamp((ox * oy) / Math.max(1, bw * bh), 0, 1);
    const ux = v => clamp(Math.round(((v * this.W) - R.x) / R.w * im.width), 0, im.width - 1);
    const uy = v => clamp(Math.round(((v * this.H) - R.y) / R.h * im.height), 0, im.height - 1);
    const ax = ux(x0), bx = ux(x1), ay = uy(y0), by = uy(y1);
    let sum = 0, n = 0;
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
      const p = (y * im.width + x) * 4;
      sum += (d[p] * .299 + d[p + 1] * .587 + d[p + 2] * .114) / 255; n++;
    }
    const lit = lerp(this.wallLuma ?? .1, n ? sum / n : .45, cover);
    return lerp(this.groundLuma, lit, t);
  }

  zones() {
    return {
      centre: this.zoneLuma(.28, .30, .72, .70),
      label:  this.zoneLuma(.00, .70, .34, 1),
      dock:   this.zoneLuma(.72, .80, 1, 1),
      top:    this.zoneLuma(0, 0, 1, .11),
    };
  }

  /** paint the whole thing now, for a frame on a wall */
  finish() {
    if (!this.plan) return;
    this.setProgress(1);
    this.active.length = 0;
    while (this.drawn < this.target) this._stroke(this.drawn++, this.sctx);
    this.dirty = true;
    this._present();
  }

  /** a quiet abstraction for when the collections can't be reached */
  paintFallback(seed = Date.now()) {
    const rnd = mulberry32(seed >>> 0);
    const c = document.createElement('canvas');
    c.width = 900; c.height = 600;
    const g = c.getContext('2d');
    const h = rnd();
    g.fillStyle = hslToCss(h, .22, .18); g.fillRect(0, 0, 900, 600);
    for (let i = 0; i < 5; i++) {
      const grd = g.createLinearGradient(rnd() * 900, 0, rnd() * 900, 600);
      grd.addColorStop(0, hslToCss((h + rnd() * .12) % 1, .3, .2 + rnd() * .35));
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = .5; g.fillStyle = grd;
      g.fillRect(0, rnd() * 400, 900, 120 + rnd() * 260);
    }
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => { this.load(img, { tainted: false, key: 'fallback' + seed }); resolve(); };
      img.src = c.toDataURL();
    });
  }
}

/* ------------------------------------------------------ maths */
function flow(x, y, s) {
  return Math.sin(x / (s * .55)) * .9 + Math.cos(y / (s * .42)) * .8 + 0.5;
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0; const l = (mx + mn) / 2;
  if (mx !== mn) {
    const dd = mx - mn;
    s = l > .5 ? dd / (2 - mx - mn) : dd / (mx + mn);
    h = mx === r ? (g - b) / dd + (g < b ? 6 : 0) : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4;
    h /= 6;
  }
  return [h, s, l];
}

const hslToCss = (h, s, l) =>
  `hsl(${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
