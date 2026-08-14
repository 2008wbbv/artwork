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
      face: j.thumbnail?.source ? j.thumbnail.source.replace(/\/\d+px-/, '/480px-') : '',
      url: j.content_urls?.desktop?.page || `${WIKI}/wiki/${encodeURIComponent(title)}`,
    };
  };

  let out = null;
  try { out = await summary(name); } catch { /* try the long way round */ }
  if (!out) {
    try {
      const p = new URLSearchParams({ action: 'query', list: 'search', srsearch: `${name} painter artist`,
        format: 'json', origin: '*', srlimit: '1' });
      const j = await fetchJSON(`${WIKI}/w/api.php?${p}`, { timeout: 9000 });
      const first = j.query?.search?.[0]?.title;
      if (first) out = await summary(first);
    } catch { /* they may simply not be in there */ }
  }
  if (out) save('cache.' + key, { t: Date.now(), v: out });
  return out;
}

/** what else the five museums are holding by the same hand */
export async function worksBy(name, exceptKey = '') {
  const key = 'works.' + slug(name);
  const hit = load('cache.' + key, null);
  const rehydrate = list => list.map(a => {
    const [src] = String(a.key).split(':');
    const url = a.image;
    if (typeof url !== 'string') return null;
    a.image = src === 'aic' || src === 'vam' || src === 'smk' ? (w => url.replace('{w}', w)) : (() => url);
    return a;
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
    save('cache.' + key, { t: Date.now(), v: found.map(a => ({
      ...a, image: ['aic', 'vam', 'smk'].includes(a.src) ? a.image('{w}') : a.image(1200),
    })) });
  }
  return found.filter(a => a.key !== exceptKey);
}
