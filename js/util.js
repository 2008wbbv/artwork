// small shared helpers — no dependencies, no build step
export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp  = (a, b, t) => a + (b - a) * t;
export const smoothstep = t => t * t * (3 - 2 * t);
export const easeOut = t => 1 - Math.pow(1 - t, 3);

/** deterministic prng — same seed, same painting, every time */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s = '') {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function shuffle(arr, rnd = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const pick = (arr, rnd = Math.random) => arr[Math.floor(rnd() * arr.length)];

export function fmtClock(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60), s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtDuration(mins) {
  if (mins < 60) return `${Math.round(mins)} min`;
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

export const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** strip museum-supplied html and squash it to a readable sentence or two */
export function plain(html, max = 190) {
  if (!html) return '';
  let t = String(html).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&#8217;|&rsquo;/g, '’')
    .replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return (stop > 60 ? cut.slice(0, stop + 1) : cut.replace(/\s+\S*$/, '') + '…').trim();
}

export const reducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export async function fetchJSON(url, { timeout = 14000, signal } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  if (signal) signal.addEventListener('abort', () => ctl.abort(), { once: true });
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

/** run tasks with a concurrency ceiling; failures resolve to null */
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const n = i++;
      try { out[n] = await fn(items[n], n); } catch { out[n] = null; }
    }
  });
  await Promise.all(workers);
  return out.filter(Boolean);
}

export function debounce(fn, ms = 180) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export const nowISODay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
}
