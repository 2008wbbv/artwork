// everything lives in this browser; nothing is ever sent anywhere
const NS = 'artwork.v1.';
const mem = new Map();

export function load(key, fallback) {
  if (mem.has(key)) return mem.get(key);
  try {
    const raw = localStorage.getItem(NS + key);
    const val = raw == null ? fallback : JSON.parse(raw);
    mem.set(key, val);
    return val;
  } catch { return fallback; }
}

/** load a key that must be a list — a value of the wrong shape reads as empty */
export function list(key) {
  const val = load(key, []);
  return Array.isArray(val) ? val : [];
}

export function save(key, val) {
  mem.set(key, val);
  try { localStorage.setItem(NS + key, JSON.stringify(val)); } catch { /* private mode */ }
  return val;
}

export function drop(key) {
  mem.delete(key);
  try { localStorage.removeItem(NS + key); } catch {}
}

/** time-boxed cache for museum responses so a playlist re-opens instantly */
export function cached(key, ttlMs, produce) {
  const hit = load('cache.' + key, null);
  if (hit && Date.now() - hit.t < ttlMs && hit.v?.length) return Promise.resolve(hit.v);
  return Promise.resolve(produce()).then(v => {
    if (v && v.length) save('cache.' + key, { t: Date.now(), v });
    return v && v.length ? v : (hit?.v ?? v);
  }).catch(err => {
    if (hit?.v?.length) return hit.v;   // stale is better than empty
    throw err;
  });
}
