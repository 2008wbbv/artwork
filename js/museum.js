/* ============================================================
   Everything you have painted, kept as forty bytes each.

   The renderer is deterministic — a picture is fully described
   by which artwork it was, the seed, and the size of the canvas
   — so nothing here stores an image. The frames on the wall are
   repainted from the record, stroke by stroke, exactly as you
   first watched them go down.
   ============================================================ */
import { load, save } from './store.js';

const CAP = 240;
const ROMAN = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth',
  'Ninth', 'Tenth', 'Eleventh', 'Twelfth', 'Thirteenth', 'Fourteenth', 'Fifteenth', 'Sixteenth',
  'Seventeenth', 'Eighteenth', 'Nineteenth', 'Twentieth', 'Twenty-first'];

const TEMPLATED = ['aic', 'vam', 'smk'];
const flat = a => (TEMPLATED.includes(a.src) ? a.image('{w}') : a.image(1200));
const rebuild = url => (url.includes('{w}') ? (w => url.replace(/\{w\}/g, w)) : (() => url));

/** record a finished picture */
export function hang({ art, minutes, phase, doing }) {
  if (!art?.key || art.key.startsWith('fallback')) return;
  const list = load('hung', []).filter(h => h.k !== art.key);
  list.push({
    k: art.key,
    at: Date.now(),
    m: Math.round(minutes),
    p: phase,
    d: (doing || '').slice(0, 90),
    a: {
      src: art.src, title: art.title, artist: art.artist, date: art.date, year: art.year || null,
      century: art.century || null, medium: art.medium, museum: art.museumShort, url: art.url,
      note: (art.note || '').slice(0, 300), nationality: art.nationality || '', image: flat(art),
    },
  });
  save('hung', list.slice(-CAP));
}

/** newest first, with image() put back */
export function collection() {
  return load('hung', []).slice().reverse().map(h => ({
    ...h,
    a: { ...h.a, image: rebuild(h.a.image) },
  }));
}

export const count = () => load('hung', []).length;

export function forget() { save('hung', []); }

/** the hang: which wall each picture belongs on */
export function rooms() {
  const all = collection();
  if (!all.length) return [];
  const out = [];

  if (all.length > 3) {
    out.push({ id: 'lately', name: 'Lately', note: 'The last few, newest first.', works: all.slice(0, 8) });
  }

  const byCentury = new Map();
  for (const h of all) {
    const c = h.a.century || (h.a.year ? Math.floor((h.a.year - 1) / 100) + 1 : null);
    const k = c || 0;
    if (!byCentury.has(k)) byCentury.set(k, []);
    byCentury.get(k).push(h);
  }
  [...byCentury.keys()].sort((x, y) => x - y).forEach(c => {
    const works = byCentury.get(c);
    out.push(c
      ? { id: 'c' + c, name: `The ${ROMAN[c] || c + 'th'} Century`, note: `${works.length} ${works.length === 1 ? 'picture' : 'pictures'}.`, works }
      : { id: 'undated', name: 'Undated', note: 'No year recorded for these.', works });
  });

  const byHand = new Map();
  for (const h of all) {
    const n = h.a.artist;
    if (!n || n === 'Unknown') continue;
    if (!byHand.has(n)) byHand.set(n, []);
    byHand.get(n).push(h);
  }
  const regulars = [...byHand.entries()].filter(([, w]) => w.length >= 3)
    .sort((x, y) => y[1].length - x[1].length);
  if (regulars.length) {
    out.push({
      id: 'regulars', name: 'The Regulars', works: regulars.flatMap(([, w]) => w),
      note: regulars.map(([n, w]) => `${n} (${w.length})`).slice(0, 4).join(' · '),
    });
  }
  return out;
}

/* ------------------------------------------------------------
   How each picture is framed and hung. Stable for a given work —
   the same painting comes back in the same frame, in the same
   spot on the wall, every time you visit.
   ------------------------------------------------------------ */
const FRAMES = ['gilt', 'oak', 'ebony', 'plaster', 'ornate', 'slim'];
const ON_PAPER = /paper|print|watercolo|drawing|etch|engrav|lithograph|pastel|gouache|chalk|ink|charcoal|woodblock/i;

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function style(h) {
  const n = hash(h.k);
  const paper = ON_PAPER.test(h.a.medium || '');
  return {
    frame: paper && n % 7 === 0 ? 'plaster' : FRAMES[n % FRAMES.length],
    mat: paper,                                    // works on paper get a mount, oils don't
    size: [.74, .86, 1, 1, 1.14, 1.28][(n >> 4) % 6],
    drop: [-52, -26, 0, 0, 22, 44, -14, 34][(n >> 8) % 8],
  };
}

/** a wall isn't a queue: some pictures hang alone, some stack in twos */
export function columns(works) {
  const out = [];
  for (let i = 0; i < works.length;) {
    const a = works[i], sa = style(a);
    const b = works[i + 1], sb = b && style(b);
    const pair = b && sa.size <= .86 && sb.size <= .86;
    if (pair) { out.push([a, b]); i += 2; } else { out.push([a]); i += 1; }
  }
  return out;
}

/** a line for the label: when you painted it, and for how long */
export function when(h) {
  const d = new Date(h.at);
  const day = d.toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `Painted here ${day}, ${time} · ${h.m} minutes`;
}
