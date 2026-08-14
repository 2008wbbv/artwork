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

/* size fraction of the short edge · which blur level to sample ·
   how much of the interval this layer owns · how picky it is about detail */
const LAYERS = [
  { t0:0,   t1:.09, size:.120, mip:3, over:2.0, elong:2.1, wide:.56, alpha:[.42,.62], detail:0,   halo:.38 },
  { t0:.09, t1:.32, size:.056, mip:2, over:1.7, elong:2.0, wide:.56, alpha:[.52,.74], detail:0,   halo:.26 },
  { t0:.32, t1:.60, size:.027, mip:1, over:1.5, elong:1.9, wide:.54, alpha:[.62,.84], detail:.12, halo:0   },
  { t0:.60, t1:.85, size:.0132,mip:0, over:1.3, elong:1.9, wide:.50, alpha:[.60,.86], detail:.44, halo:0   },
  { t0:.85, t1:1,   size:.0068,mip:0, over:1.0, elong:1.9, wide:.48, alpha:[.55,.82], detail:.70, halo:0   },
];

export class Painter {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });

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
    this.glazeAt = 0;
    this.seed = 1;
    this.ground = '#141210';
    this.groundLuma = .1;
    this.accent = '#c9a227';
    this.accentHsl = [.116, .68, .53];
    this.lowMotion = reducedMotion();
    this.glazeMax = .55;
    this.setSize();
  }

  /* ---------------------------------------------------- sizing */
  setSize() {
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
    this.cv.style.width = cssW + 'px';
    this.cv.style.height = cssH + 'px';
    return true;
  }

  /** cover-fit the picture over the viewport, with a little overscan —
      museum photographs often carry a sliver of frame or mount at the edge */
  _rect() {
    const iw = this.img.naturalWidth || this.img.width;
    const ih = this.img.naturalHeight || this.img.height;
    const s = Math.max(this.W / iw, this.H / ih) * 1.035;
    const w = iw * s, h = ih * s;
    return { x: (this.W - w) / 2, y: (this.H - h) / 2, w, h };
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
    this._gauge();
    this.drawn = 0;
    this.glazeAt = 0;
    // the new wash goes down over the old picture, the way a canvas gets reused
    this.dissolve = hadPicture && !this.lowMotion ? 1 : 0;
    this._diss = 0;
    if (!this.dissolve) this._ground();
    this.catchUp = true;
  }

  /** how far the file is being stretched decides how far the picture can resolve */
  _gauge() {
    const rect = this.plan?.rect || this._rect();
    const src = this.img?.naturalWidth || 1;
    const up = rect.w / src;
    this.glazeMax = up > 2.1 ? .30 : up > 1.35 ? .44 : .58;
  }

  /** the sharper file arrived mid-interval: keep every stroke, sample better from here on */
  upgrade(img, tainted = false) {
    if (!this.plan || !img) return;
    this.img = img;
    this.tainted = tainted;
    this._buildMips();
    this._readPixels();
    this._gradients();
    this._gauge();
  }

  _buildMips() {
    this.mips = [];
    const widths = [520, 260, 130, 64];
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
  }

  _ground(alpha = 1, tooth = true) {
    const g = this.ctx;
    const rect = this.plan?.rect || this._rect();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = alpha;
    g.fillStyle = this.ground;
    g.fillRect(0, 0, this.W, this.H);
    // the lay-in: masses and light only, far too soft to read as a photograph
    if (this.mips[3]) {
      g.globalAlpha = .34 * alpha;
      g.drawImage(this.mips[3], rect.x, rect.y, rect.w, rect.h);
    }
    // a little tooth, so gaps between strokes read as canvas
    if (tooth) {
      g.globalAlpha = .05 * alpha;
      g.fillStyle = this._tooth();
      g.fillRect(0, 0, this.W, this.H);
    }
    g.globalAlpha = 1;
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
    this._toothPat = this.ctx.createPattern(c, 'repeat');
    return this._toothPat;
  }

  /* ------------------------------------------------- the plan */
  _buildPlan() {
    const rnd = mulberry32(this.seed);
    const rect = this._rect();
    const min = Math.min(this.W, this.H);
    const xs = [], ys = [], an = [], sz = [], al = [], lm = [], lay = [];
    const bounds = [];
    const upscale = rect.w / (this.img?.naturalWidth || rect.w);
    const cut = this.lowMotion ? 4 : upscale > 2.3 ? 4 : LAYERS.length;
    const layers = LAYERS.slice(0, cut);

    layers.forEach((L, li) => {
      const cell = Math.max(2, L.size * min);
      // one cell of bleed on every side, so the picture runs off the edges
      const nx = Math.ceil(this.W / cell) + 2, ny = Math.ceil(this.H / cell) + 2;
      const cells = nx * ny;
      const count = Math.round(cells * L.over);
      const start = xs.length;
      const order = new Int32Array(cells);
      for (let i = 0; i < cells; i++) order[i] = i;
      for (let i = cells - 1; i > 0; i--) {       // shuffled so coverage grows evenly, not in rows
        const j = Math.floor(rnd() * (i + 1));
        const t = order[i]; order[i] = order[j]; order[j] = t;
      }
      for (let k = 0; k < count; k++) {
        const c = order[k % cells];
        const x = ((c % nx) + rnd() - 1) * cell;
        const y = (Math.floor(c / nx) + rnd() - 1) * cell;
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
        xs.push(x); ys.push(y);
        an.push(a + (rnd() - .5) * .34);
        sz.push(cell * lerp(.62, 1.62, Math.pow(rnd(), 1.7)));
        al.push(lerp(L.alpha[0], L.alpha[1], rnd()));
        lm.push(lerp(1.16, .66, clamp(m, 0, 1)));
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
      this.glazeAt = 0;
      this.catchUp = true;
    }
    this.target = t;
  }

  /* ------------------------------------------------- painting */
  _stroke(i) {
    const P = this.plan, g = this.ctx;
    const L = P.bounds[P.lay[i]];
    const x = P.xs[i], y = P.ys[i], ang = P.an[i], s = P.sz[i];
    const len = s * L.elong * P.lm[i] * .5, wid = s * L.wide * .5;

    if (this.tainted) {                              // no pixel access: reveal through the shape
      g.save();
      g.beginPath();
      g.ellipse(x, y, len, wid, ang, 0, TAU);
      g.clip();
      g.globalAlpha = P.al[i];
      const m = this.mips[L.mip];
      g.drawImage(m, P.rect.x, P.rect.y, P.rect.w, P.rect.h);
      g.restore();
      g.globalAlpha = 1;
      return;
    }

    const im = this.data[L.mip];
    const u = clamp((x - P.rect.x) / P.rect.w, 0, .999);
    const v = clamp((y - P.rect.y) / P.rect.h, 0, .999);
    const px = ((v * im.height | 0) * im.width + (u * im.width | 0)) * 4;
    const d = im.data;
    const jit = (i % 7 - 3) * 2.2;
    const r = clamp(d[px] + jit, 0, 255) | 0;
    const gg = clamp(d[px + 1] + jit * .8, 0, 255) | 0;
    const b = clamp(d[px + 2] - jit * .6, 0, 255) | 0;

    g.fillStyle = `rgb(${r},${gg},${b})`;
    if (L.halo) {                                    // soft shoulder, so the broad passages read as wash
      g.globalAlpha = P.al[i] * L.halo;
      g.beginPath();
      g.ellipse(x, y, len * 1.3, wid * 1.34, ang, 0, TAU);
      g.fill();
    }
    g.globalAlpha = P.al[i];
    g.beginPath();
    g.ellipse(x, y, len, wid, ang, 0, TAU);
    g.fill();

    if (L.mip < 2 && i % 6 === 0) {                  // an occasional bristle catching the light
      const k = 1 + ((i % 5) - 2) * .055;
      g.globalAlpha = P.al[i] * .45;
      g.fillStyle = `rgb(${clamp(r * k, 0, 255) | 0},${clamp(gg * k, 0, 255) | 0},${clamp(b * k, 0, 255) | 0})`;
      g.beginPath();
      g.ellipse(x + Math.cos(ang) * len * .18, y + Math.sin(ang) * len * .18, len * .62, wid * .34, ang, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
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
      return;
    }

    if (this.drawn < this.target) {
      const budget = this.catchUp ? 11 : 6;
      const t0 = performance.now();
      while (this.drawn < this.target) {
        this._stroke(this.drawn++);
        if ((this.drawn & 63) === 0 && performance.now() - t0 > budget) break;
      }
      if (this.drawn >= this.target) this.catchUp = false;
    }

    // the last minutes bring the picture into focus — glazed on in thin increments
    const want = smoothstep(clamp((this.progress - .82) / .18, 0, 1)) * (this.glazeMax ?? .55);
    if (want > this.glazeAt + .006 && this.img) {
      const step = (want - this.glazeAt) / (1 - this.glazeAt);
      const c = this.ctx;
      c.globalAlpha = clamp(step, 0, 1);
      c.drawImage(this.img, this.plan.rect.x, this.plan.rect.y, this.plan.rect.w, this.plan.rect.h);
      c.globalAlpha = 1;
      this.glazeAt = want;
    }
  }

  /** viewport changed: rebuild the plan and race back to where we were */
  resize() {
    if (!this.setSize() || !this.img) return;
    this._buildPlan();
    this.drawn = 0;
    this.glazeAt = 0;
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
    const ux = v => clamp(Math.round(((v * this.W) - R.x) / R.w * im.width), 0, im.width - 1);
    const uy = v => clamp(Math.round(((v * this.H) - R.y) / R.h * im.height), 0, im.height - 1);
    const ax = ux(x0), bx = ux(x1), ay = uy(y0), by = uy(y1);
    let sum = 0, n = 0;
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
      const p = (y * im.width + x) * 4;
      sum += (d[p] * .299 + d[p + 1] * .587 + d[p + 2] * .114) / 255; n++;
    }
    return lerp(this.groundLuma, n ? sum / n : .45, t);
  }

  zones() {
    return {
      centre: this.zoneLuma(.28, .30, .72, .70),
      label:  this.zoneLuma(.00, .70, .34, 1),
      dock:   this.zoneLuma(.72, .80, 1, 1),
      top:    this.zoneLuma(0, 0, 1, .11),
    };
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
