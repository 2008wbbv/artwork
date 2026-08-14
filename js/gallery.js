/* ============================================================
   The hang: turns a playlist into a viewing order, keeps images
   warm, quietly skips anything that won't load, and remembers
   what you've already been shown.
   ============================================================ */
import { runQuery, loadImage, targetWidth } from './sources.js';
import { load, save, cached } from './store.js';
import { shuffle, pool } from './util.js';
import { byId } from './playlists.js';

const TTL = 20 * 60 * 60 * 1000;    // museum queries are cached for the best part of a day
const SEEN_CAP = 500;

export class Gallery {
  constructor() {
    this.playlist = null;
    this.items = [];
    this.order = [];
    this.i = -1;
    this.current = null;
    this.onstatus = () => {};
    this.onupgrade = () => {};
    this._ctl = null;
  }

  get size() { return this.items.length; }

  async use(playlistId) {
    const pl = byId(playlistId);
    this.playlist = pl;
    this._ctl?.abort();
    const ctl = this._ctl = new AbortController();
    this.onstatus({ state: 'loading', playlist: pl });

    const spin = pl.rand ? Math.floor(Math.random() * 5) : 0;
    const key = `${pl.id}.${spin}`;

    let items = [];
    try {
      items = await cached(key, TTL, async () => {
        const parts = await pool(pl.queries, 3, q => runQuery(this._spun(q, spin), ctl.signal));
        return dedupe(parts.flat()).map(serialisable);
      });
    } catch (err) {
      console.warn('[artwork] playlist load failed', err);
    }
    if (ctl.signal.aborted) return this.items.length;

    // museum records travel through localStorage, so image() has to be rebuilt
    this.items = items.map(rehydrate).filter(Boolean);
    this.order = this._orderFor(this.items);
    this.i = -1;
    this.onstatus({ state: this.items.length ? 'ready' : 'empty', playlist: pl, count: this.items.length });
    return this.items.length;
  }

  _spun(q, spin) {
    if (!spin) return q;
    if (q.src === 'aic') return { ...q, page: 1 + spin };
    if (q.src === 'cma') return { ...q, params: { ...q.params, skip: String(spin * 45) } };
    return q;
  }

  /** unseen first, then everything else — both shuffled */
  _orderFor(items) {
    const seen = new Set(load('seen', []));
    const fresh = [], again = [];
    items.forEach((a, n) => (seen.has(a.key) ? again : fresh).push(n));
    return [...shuffle(fresh), ...shuffle(again)];
  }

  markSeen(key) {
    const seen = load('seen', []).filter(k => k !== key);
    seen.push(key);
    save('seen', seen.slice(-SEEN_CAP));
  }

  /** next artwork with a decoded image, skipping anything broken */
  async advance() {
    if (!this.items.length) return null;
    const w = targetWidth();
    for (let tries = 0; tries < 6; tries++) {
      this.i = (this.i + 1) % this.order.length;
      const art = this.items[this.order[this.i]];
      if (!art) continue;
      try {
        const { img, tainted } = await loadImage(art.image(w));
        this.current = { art, img, tainted };
        this.markSeen(art.key);
        this._warmNext(w);
        this._upgrade(this.current, img.naturalWidth || 0);
        return this.current;
      } catch {
        /* a dead image link is not worth telling anyone about */
      }
    }
    return null;
  }

  /** the museum's press-quality file, fetched quietly behind the small one */
  _upgrade(entry, haveWidth) {
    const art = entry.art;
    const net = navigator.connection || {};
    if (!art.hiRes || net.saveData) return;
    if (net.effectiveType && !/4g|5g/.test(net.effectiveType)) return;
    const want = window.innerWidth * Math.min(window.devicePixelRatio || 1, 2);
    if (haveWidth >= want * 0.85) return;                 // already sharp enough
    loadImage(art.hiRes).then(({ img, tainted }) => {
      if (this.current !== entry) return;                 // the interval moved on
      entry.img = img; entry.tainted = tainted;
      this.onupgrade(entry);
    }).catch(() => {});
  }

  /** put a specific picture up, wherever it came from */
  async show(art) {
    try {
      const w = targetWidth();
      const { img, tainted } = await loadImage(art.image(w));
      this.current = { art, img, tainted };
      this.markSeen(art.key);
      this._upgrade(this.current, img.naturalWidth || 0);
      return this.current;
    } catch { return null; }
  }

  _warmNext(w) {
    const nxt = this.items[this.order[(this.i + 1) % this.order.length]];
    if (!nxt) return;
    const pre = new Image();
    pre.crossOrigin = 'anonymous';
    pre.decoding = 'async';
    pre.src = nxt.image(w);
  }
}

function dedupe(list) {
  const out = [], seen = new Set();
  for (const a of list) {
    const k = (a.artist + '|' + a.title).toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(k) || seen.has(a.key)) continue;
    seen.add(k); seen.add(a.key);
    out.push(a);
  }
  return out;
}

/** the image() closure doesn't survive JSON, so rebuild it from the key */
function rehydrate(a) {
  if (typeof a.image === 'function') return a;
  const [src, id] = String(a.key || '').split(':');
  if (typeof a.image !== 'string') return null;
  const url = a.image;
  a.image = src === 'aic' ? (w => url.replace('{w}', w)) : (() => url);
  return a;
}

/** flatten image() into something JSON can hold, before caching */
function serialisable(a) {
  const copy = { ...a };
  copy.image = a.src === 'aic' ? a.image('{w}') : a.image(1200);
  return copy;
}
