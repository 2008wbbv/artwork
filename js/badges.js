/* ============================================================
   The ledger. Counts only what you actually sat through: a
   picture has to finish painting for it to count, which means
   the badges are a record of time spent, not clicks.
   ============================================================ */
import { load, list, save } from './store.js';
import { nowISODay, daysBetween } from './util.js';

const NATION_ALIAS = {
  English: 'British', Scottish: 'British', Welsh: 'British',
  Netherlandish: 'Dutch', Flemish: 'Flemish', Venetian: 'Italian',
  Iranian: 'Persian', Argentine: 'Argentinian',
};

const PLACES = [
  ['venice',   /\bvenice|venetian|venezia|grand canal|doge/i],
  ['paris',    /\bparis|montmartre|seine|louvre|tuileries/i],
  ['japan',    /\bjapan|edo|kyoto|tokyo|ukiyo|fuji|hokkaido/i],
  ['new-york', /\bnew york|manhattan|brooklyn|hudson river\b/i],
  ['london',   /\blondon|thames|westminster/i],
  ['rome',     /\brome|roman campagna|tiber|vatican/i],
  ['holland',  /\bholland|netherlands|dutch|amsterdam|delft|haarlem/i],
  ['italy',    /\bitaly|italian|florence|naples|tuscan/i],
  ['france',   /\bfrance|french|normandy|provence|giverny|brittany/i],
  ['germany',  /\bgermany|german|munich|dresden|bavaria|rhine/i],
  ['spain',    /\bspain|spanish|madrid|andalusia|seville/i],
  ['america',  /\bamerica|united states|new england|california|adirondack/i],
  ['sea',      /\bsea|ocean|coast|shore|wave|harbou?r|marine|ship|sail/i],
  ['night',    /\bnight|nocturne|moonlight|evening|dusk|lamplight/i],
];

const blank = () => ({
  intervals: 0, focus: 0, breaks: 0, focusMin: 0, works: 0,
  museums: {}, nations: {}, artists: {}, places: {}, tags: {},
  nights: 0, dawns: 0, silent: 0, longest: 0,
  days: {}, streak: 0, bestStreak: 0, lastDay: null,
});

export const BADGES = [
  { id:'first-light',  name:'First Light',      how:'Finish your first interval.',                     target:1,   v:s=>s.intervals },
  { id:'the-hang',     name:'The Hang',         how:'Watch ten pictures through to the last stroke.',  target:10,  v:s=>s.works },
  { id:'full-wall',    name:'Full Wall',        how:'Twenty-five pictures finished.',                  target:25,  v:s=>s.works },
  { id:'long-gallery', name:'The Long Gallery', how:'One hundred pictures finished.',                  target:100, v:s=>s.works },
  { id:'ten-hours',    name:'Ten Hours',        how:'Six hundred minutes of focus.',                   target:600, v:s=>Math.round(s.focusMin) },
  { id:'long-sitting', name:'The Long Sitting', how:'Finish a focus interval of forty-five minutes or more.', target:1, v:s=>s.longest >= 45 ? 1 : 0 },
  { id:'four-square',  name:'Four Square',      how:'Four focus intervals inside one day.',            target:4,   v:s=>Math.max(0,...Object.values(s.days||{}),0) },
  { id:'the-regular',  name:'The Regular',      how:'Come back seven days running.',                   target:7,   v:s=>s.bestStreak },
  { id:'nocturne',     name:'Nocturne',         how:'Ten intervals begun after nine at night.',        target:10,  v:s=>s.nights },
  { id:'dawn-chorus',  name:'Dawn Chorus',      how:'Begin an interval before six in the morning.',    target:1,   v:s=>s.dawns },
  { id:'quiet-room',   name:'Quiet Room',       how:'Ten intervals with the radio off.',               target:10,  v:s=>s.silent },
  { id:'salon-hang',   name:'Salon Hang',       how:'See work from all three museums.',                target:3,   v:s=>Object.keys(s.museums).length },
  { id:'grand-tour',   name:'The Grand Tour',   how:'Pictures from twelve different places.',          target:12,  v:s=>Object.keys(s.places).length },
  { id:'deep-cut',     name:'Deep Cut',         how:'Five pictures by a single hand.',                 target:5,   v:s=>Math.max(0,...Object.values(s.artists),0) },
  { id:'dutch-light',  name:'Dutch Light',      how:'Ten works by Dutch painters.',                    target:10,  v:s=>s.nations.Dutch|0 },
  { id:'kunsthalle',   name:'Kunsthalle',       how:'Ten works by German painters.',                   target:10,  v:s=>s.nations.German|0 },
  { id:'le-salon',     name:'Le Salon',         how:'Fifteen works by French painters.',               target:15,  v:s=>s.nations.French|0 },
  { id:'acqua-alta',   name:'Acqua Alta',       how:'Twenty pictures of Venice.',                      target:20,  v:s=>s.places.venice|0 },
  { id:'floating',     name:'The Floating World',how:'Fifteen Japanese pictures.',                     target:15,  v:s=>s.places.japan|0 },
  { id:'boulevard',    name:'Boulevard',        how:'Twelve pictures of Paris.',                       target:12,  v:s=>s.places.paris|0 },
  { id:'plein-air',    name:'En Plein Air',     how:'Twelve impressionist pictures.',                  target:12,  v:s=>s.tags.impressionism|0 },
  { id:'sea-legs',     name:'Sea Legs',         how:'Fifteen pictures of the sea.',                    target:15,  v:s=>s.places.sea|0 },
  { id:'small-hours',  name:'The Small Hours',  how:'Twelve pictures painted after dark.',             target:12,  v:s=>s.places.night|0 },
];

export class Ledger {
  constructor() {
    this.stats = { ...blank(), ...load('stats', {}) };
    this.unlocked = new Set(list('badges'));
  }

  save() { save('stats', this.stats); save('badges', [...this.unlocked]); }

  /** an interval ran to zero */
  record({ art, phase, minutes, playlist, silent, startedAt = Date.now() }) {
    const s = this.stats;
    const hour = new Date(startedAt).getHours();
    s.intervals++;
    if (phase === 'focus') {
      s.focus++;
      s.focusMin += minutes;
      s.longest = Math.max(s.longest, minutes);
      const day = nowISODay();
      s.days[day] = (s.days[day] || 0) + 1;
      if (s.lastDay !== day) {
        s.streak = s.lastDay && daysBetween(s.lastDay, day) === 1 ? s.streak + 1 : 1;
        s.bestStreak = Math.max(s.bestStreak || 0, s.streak);
        s.lastDay = day;
      }
      // keep the day ledger from growing forever
      const days = Object.keys(s.days).sort();
      if (days.length > 400) days.slice(0, days.length - 400).forEach(d => delete s.days[d]);
    } else s.breaks++;

    if (hour >= 21 || hour < 3) s.nights++;
    if (hour >= 3 && hour < 6) s.dawns++;
    if (silent) s.silent++;

    if (art) {
      s.works++;
      bump(s.museums, art.museumShort || art.src);
      if (art.artist && art.artist !== 'Unknown') bump(s.artists, art.artist);
      const nat = NATION_ALIAS[art.nationality] || art.nationality;
      if (nat) bump(s.nations, nat);
      const hay = [art.title, art.place, art.culture, art.department, art.note, art.style].filter(Boolean).join(' · ');
      for (const [tag, re] of PLACES) if (re.test(hay)) bump(s.places, tag);
      for (const t of (playlist?.tags || [])) bump(s.tags, t);
      if (art.style) bump(s.tags, art.style.toLowerCase());
    }

    const fresh = this.check();
    this.save();
    return fresh;
  }

  check() {
    const fresh = [];
    for (const b of BADGES) {
      if (this.unlocked.has(b.id)) continue;
      if (this.value(b) >= b.target) { this.unlocked.add(b.id); fresh.push(b); }
    }
    if (fresh.length) this.save();
    return fresh;
  }

  value(b) {
    try { return Math.max(0, b.v(this.stats) || 0); } catch { return 0; }
  }

  has(id) { return this.unlocked.has(id); }

  reset() {
    this.stats = blank();
    this.unlocked = new Set();
    this.save();
  }
}

function bump(obj, key) {
  if (!key) return;
  obj[key] = (obj[key] || 0) + 1;
}
