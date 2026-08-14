/* ============================================================
   Everything you have painted, kept as forty bytes each.

   The renderer is deterministic — a picture is fully described
   by which artwork it was, the seed, and the size of the canvas
   — so nothing here stores an image. The frames on the wall are
   repainted from the record, stroke by stroke, exactly as you
   first watched them go down.
   ============================================================ */
import { list as stored, save } from './store.js';

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
  const list = stored('hung').filter(h => h.k !== art.key);
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
  return stored('hung').slice().reverse().map(h => ({
    ...h,
    a: { ...h.a, image: rebuild(h.a.image) },
  }));
}

export const count = () => stored('hung').length;

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
/* Frames are chosen the way a framer would: by what the picture is
   and roughly when it was made, then varied within that. A 1640 oil
   gets a carved and gilded thing; a drawing gets a mount and a plain
   moulding; a 1910 canvas gets something the picture doesn't have to
   argue with. */
const FRAME_POOLS = {
  paper:  ['plaster', 'limewash', 'slim', 'silver'],
  early:  ['ornate', 'swept', 'tortoise', 'cassetta'],          // before 1700
  middle: ['gilt', 'cassetta', 'walnut', 'ornate', 'gilt'],     // 1700 – 1850
  late:   ['oak', 'ebony', 'slim', 'gilt', 'walnut', 'silver'], // 1850 – 1900
  modern: ['box', 'ebony', 'slim', 'limewash', 'oak'],          // after 1900
};
const ON_PAPER = /paper|print|watercolo|drawing|etch|engrav|lithograph|pastel|gouache|chalk|ink|charcoal|woodblock/i;

function pool(h, paper) {
  if (paper) return FRAME_POOLS.paper;
  const y = h.a.year || (h.a.century ? h.a.century * 100 - 50 : 0);
  if (!y) return FRAME_POOLS.middle;
  if (y < 1700) return FRAME_POOLS.early;
  if (y < 1850) return FRAME_POOLS.middle;
  if (y < 1900) return FRAME_POOLS.late;
  return FRAME_POOLS.modern;
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function style(h) {
  const n = hash(h.k);
  const paper = ON_PAPER.test(h.a.medium || '');
  return {
    frame: (p => p[(n >>> 16) % p.length])(pool(h, paper)),
    mat: paper,                                    // works on paper get a mount, oils don't
    size: [.7, .8, .9, 1, 1, 1.12, 1.16, .84][(n >>> 4) % 8],
    drop: [-32, -16, 0, 14, 28, -10, 22, -24][(n >>> 8) % 8],
    shift: [-14, 8, -6, 16, 0, -18, 10, 4][(n >>> 12) % 8],
  };
}

/* A salon hang: pictures crowd into the same horizontal run, small ones
   stacked two and three high between the big ones, columns pulled into
   their neighbours so nothing sits on a grid. The budget is how much
   wall one column may carry — short screens get a thinner hang so
   nothing runs off the top or bottom. */
export function columns(works, budget = 2.05) {
  const out = [];
  for (let i = 0; i < works.length;) {
    const take = [];
    let room = budget;                             // how much wall this column can carry
    while (i < works.length && take.length < 3) {
      const st = style(works[i]);
      if (take.length && st.size > room) break;
      take.push(works[i]);
      room -= st.size;
      i++;
      if (room <= .45) break;
    }
    const n = hash(take[0].k + take.length);
    out.push({
      works: take,
      lift: [-20, 0, 14, -9, 21, 5][n % 6],         // the whole column sits high or low
      pull: [-14, -38, -56, -24, -46, -18][(n >>> 5) % 6], // and leans into the one before it
    });
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
