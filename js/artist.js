/* ============================================================
   Who painted it. A short life off Wikipedia — which is where
   the portrait comes from too, usually one they painted of
   themselves — and whatever else of theirs the five collections
   are holding.
   ============================================================ */
import { fetchJSON, plain, pool } from './util.js';
import { load, save } from './store.js';
import { runQuery } from './sources.js';

const WIKI = 'https://en.wikipedia.org';
const LIFE = 30 * 24 * 3600e3;      // a painter's dates are not going to change
const SHELF = 12 * 3600e3;

const slug = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z ]/g, '').trim();
const surname = s => slug(s).split(' ').filter(w => w.length > 2).pop() || '';

/* Take the thumbnail exactly as it comes. Rewriting the width in the URL —
   which is the obvious thing to do — earns a 400 from Wikimedia every time,
   which is why no portrait ever appeared. Their thumbnail is around 320px
   wide and the frame is smaller than that, so there is nothing to gain. */
const face = j => j.thumbnail?.source || j.originalimage?.source || '';

/** a page summary: the first paragraph, and a picture of them */
export async function profile(name) {
  const key = 'artist.' + slug(name);
  const hit = load('cache.' + key, null);
  if (hit && Date.now() - hit.t < LIFE) return hit.v;

  const summary = async title => {
    const j = await fetchJSON(`${WIKI}/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`, { timeout: 9000 });
    if (!j || j.type === 'disambiguation' || !j.extract) return null;
    return {
      name: j.title,
      line: j.description || '',
      bio: plain(j.extract, 420),
      face: face(j),
      url: j.content_urls?.desktop?.page || `${WIKI}/wiki/${encodeURIComponent(title)}`,
    };
  };

  const clean = name
    .replace(/^(attributed to|workshop of|circle of|studio of|follower of|manner of|after|school of|copy after)\s+/i, '')
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/,\s*(jr|sr|the elder|the younger)\.?$/i, m => m.replace(',', ''))
    .replace(/\s+/g, ' ').trim();

  // an artist's name is often somebody else's too — Astrid Holm the painter
  // and Astrid Holm the actress share a page title, and only one of them
  // painted anything
  const plausible = p => p && /paint|artist|engrav|sculpt|print|draught|draftsm|illustrat|etch|watercolo/i
    .test(`${p.line} ${p.bio}`);

  let out = null;
  try { out = await summary(clean); } catch { /* try the long way round */ }
  if (!out && clean !== name) { try { out = await summary(name); } catch { /* keep going */ } }
  if (out && !plausible(out)) out = null;
  if (!out) {
    try {
      const p = new URLSearchParams({ action: 'query', list: 'search', srsearch: `${clean} painter artist`,
        format: 'json', origin: '*', srlimit: '3' });
      const j = await fetchJSON(`${WIKI}/w/api.php?${p}`, { timeout: 9000 });
      for (const hit of (j.query?.search || []).slice(0, 3)) {
        const cand = await summary(hit.title).catch(() => null);
        if (plausible(cand)) { out = cand; break; }
      }
    } catch { /* they may simply not be in there */ }
  }
  save('cache.' + key, { t: Date.now(), v: out });   // remember the misses too, so we stop asking
  return out;
}

/** flatten image() to something JSON can hold */
const TEMPLATED = ['aic', 'vam', 'smk'];      // these take a width straight into the url
const serialise = a => ({ ...a, image: TEMPLATED.includes(a.src) ? a.image('{w}') : a.image(1200) });

/** what else the collections are holding by the same hand */
export async function worksBy(name, exceptKey = '') {
  const key = 'works.' + slug(name);
  const hit = load('cache.' + key, null);
  // a copy every time: the cache hands back the same objects on every call,
  // and turning their image field into a function in place meant the second
  // look at an artist found nothing left to show
  const rehydrate = list => list.map(a => {
    if (typeof a.image === 'function') return a;
    if (typeof a.image !== 'string') return null;
    const url = a.image;
    return { ...a, image: url.includes('{w}') ? (w => url.replace(/\{w\}/g, w)) : (() => url) };
  }).filter(Boolean);

  if (hit && Date.now() - hit.t < SHELF) return rehydrate(hit.v).filter(a => a.key !== exceptKey);

  const specs = [
    { src: 'aic', q: name, limit: 30 },
    { src: 'met', params: { q: name, artistOrCulture: 'true' }, take: 14 },
    { src: 'cma', params: { artists: name }, limit: 16 },
    { src: 'vam', params: { q: name }, limit: 20 },
    { src: 'smk', params: { keys: name }, limit: 16 },
  ];
  const last = surname(name);
  const parts = await pool(specs, 3, spec => runQuery(spec).catch(() => []));
  const seen = new Set();
  const found = parts.flat().filter(a => {
    if (!last || !slug(a.artist).includes(last)) return false;      // text search is generous; we are not
    const k = slug(a.title);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 12);

  if (found.length) {
    save('cache.' + key, { t: Date.now(), v: found.map(serialise) });
  }
  return found.filter(a => a.key !== exceptKey);
}
