/* ============================================================
   Sound. Two sources, both open and key-less:

     · SomaFM — hand-programmed, listener-supported, and the
       closest thing the internet has to a good record shop.
       somafm.com/support/ if you end up leaving it on all day.
     · Radio Browser — a community index, used here to turn up
       stations outside the curated shelf.
   ============================================================ */
import { fetchJSON } from './util.js';
import { load, list, save } from './store.js';

const SOMA = (id, q = 128) => `https://ice1.somafm.com/${id}-${q}-mp3`;

export const STATIONS = [
  { g:'Jazz & lounge', id:'secretagent',   name:'Secret Agent',        note:'Spy jazz, crime-film lounge, cocktail menace.' },
  { g:'Jazz & lounge', id:'illstreet',     name:'Ill Street Lounge',   note:'Bachelor-pad exotica and vintage easy listening.' },
  { g:'Jazz & lounge', id:'sonicuniverse', name:'Sonic Universe',      note:'Nu jazz and avant-garde European jazz.' },
  { g:'Jazz & lounge', id:'bossa',         name:'Bossa Beyond',        note:'Bossa nova, samba, and silk.' },
  { g:'Low-key house', id:'beatblender',   name:'Beat Blender',        note:'Late-night deep house and downtempo.' },
  { g:'Low-key house', id:'thetrip',       name:'The Trip',            note:'Prog house and trip-hop for the long haul.' },
  { g:'Low-key house', id:'groovesalad',   name:'Groove Salad',        note:'The chilled plate. The default for a reason.' },
  { g:'Low-key house', id:'fluid',         name:'Fluid',               note:'Instrumental hip-hop, future soul, liquid.' },
  { g:'Air',           id:'dronezone',     name:'Drone Zone',          note:'Atmospheric ambient. Nothing will startle you.' },
  { g:'Air',           id:'spacestation',  name:'Space Station Soma',  note:'Ambient and mid-tempo electronica.' },
  { g:'Air',           id:'synphaera',     name:'Synphaera',           note:'Modern ambient from the Synphaera label.' },
  { g:'Air',           id:'lush',          name:'Lush',                note:'Mostly female vocals, electronic edges.' },
].map(s => ({ ...s, src: 'soma', url: SOMA(s.id), alts: [SOMA(s.id, 256), `https://ice2.somafm.com/${s.id}-128-mp3`], home: `https://somafm.com/${s.id}/` }));

const MIRRORS = ['https://de1.api.radio-browser.info', 'https://de2.api.radio-browser.info', 'https://all.api.radio-browser.info'];

export const DISCOVER_TAGS = [
  { tag: 'jazz',             label: 'Jazz' },
  { tag: 'lounge',           label: 'Lounge' },
  { tag: 'bossa nova',       label: 'Bossa nova' },
  { tag: 'deep house',       label: 'Deep house' },
  { tag: 'downtempo',        label: 'Downtempo' },
  { tag: 'ambient',          label: 'Ambient' },
  { tag: 'video game music', label: 'Game music' },
  { tag: 'chiptune',         label: 'Chiptune' },
];

/* ------------------------------------------------------- yours
   Two ways to bring your own: a stream URL, which is remembered,
   and files off this machine, which are not — the browser hands
   out a URL for a picked file that dies with the tab, and there
   is no way to keep one without uploading the file somewhere.
   Nothing here is uploaded anywhere, so files are re-picked each
   session. */

/** stream URLs the listener has added, oldest first */
export const mine = () => list('mine').filter(s => s && s.url);

export function addMine({ url, name }) {
  const clean = String(url || '').trim();
  if (!/^https:\/\//i.test(clean)) throw new Error('needs to start with https://');
  const list = mine().filter(s => s.url !== clean);
  const st = {
    src: 'mine', g: 'Yours', id: 'mine:' + clean, url: clean, alts: [], home: '',
    name: (name || '').trim() || labelFor(clean),
    note: 'Added by you',
  };
  list.push(st);
  save('mine', list.slice(-40));
  return st;
}

export function dropMine(id) {
  save('mine', mine().filter(s => s.id !== id));
}

/** something readable off a bare URL */
function labelFor(url) {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop() || '';
    return (last.replace(/\.\w{2,4}$/, '').replace(/[-_]+/g, ' ').trim() || u.hostname).slice(0, 46);
  } catch { return url.slice(0, 46); }
}

/** a station made out of files picked off this machine */
export function fromFiles(files) {
  const tracks = [...files]
    .filter(f => f.type.startsWith('audio/') || /\.(mp3|m4a|ogg|oga|opus|wav|flac|aac|webm)$/i.test(f.name))
    .map(f => ({ name: f.name.replace(/\.\w+$/, '').replace(/^\d+[\s.\-_]+/, '').slice(0, 60), url: URL.createObjectURL(f) }));
  if (!tracks.length) return null;
  return {
    src: 'files', g: 'Yours', kind: 'files', id: 'files:' + Date.now(),
    name: tracks.length === 1 ? tracks[0].name : `${tracks.length} tracks off this machine`,
    note: 'Yours · stays in this browser', tracks, url: tracks[0].url, alts: [], home: '',
  };
}

/** community index → a handful of stations that are actually up */
export async function discover(tag) {
  const key = 'radio.' + tag;
  const hit = load('cache.' + key, null);
  if (hit && Date.now() - hit.t < 6 * 3600e3) return hit.v;
  const p = new URLSearchParams({
    tagList: tag, limit: '18', hidebroken: 'true', order: 'clickcount',
    reverse: 'true', codec: 'MP3', is_https: 'true',
  });
  for (const host of MIRRORS) {
    try {
      const rows = await fetchJSON(`${host}/json/stations/search?${p}`, { timeout: 9000 });
      const list = (rows || [])
        .filter(r => r.url_resolved?.startsWith('https://') && r.lastcheckok !== 0)
        .slice(0, 10)
        .map(r => ({
          src: 'rb', g: 'Discover', id: r.stationuuid, name: r.name.trim().slice(0, 46),
          note: [r.country, r.bitrate ? r.bitrate + ' kbps' : ''].filter(Boolean).join(' · '),
          url: r.url_resolved, alts: [], home: r.homepage || '',
        }));
      if (list.length) { save('cache.' + key, { t: Date.now(), v: list }); return list; }
    } catch { /* try the next mirror */ }
  }
  return hit?.v || [];
}

export class Radio {
  constructor(settings) {
    this.s = settings;
    this.el = new Audio();
    this.el.preload = 'none';
    this.el.volume = 0;
    this.station = null;
    this.playing = false;
    this.track = '';
    this.onchange = () => {};
    this._poll = null;
    this._fade = null;
    this._tryIdx = 0;
    this._told = null;
    this._stopped = true;
    this._i = 0;
    this._bad = 0;
    this.el.addEventListener('error', () => this._fallback());
    this.el.addEventListener('playing', () => { this.playing = true; this.onchange(this); });
    this.el.addEventListener('pause', () => { this.playing = false; this.onchange(this); });
    // a radio station never ends; a stack of your own records does
    this.el.addEventListener('ended', () => this.station?.kind === 'files' && this.skip(1));
  }

  get isQueue() { return this.station?.kind === 'files'; }

  get volume() { return this.s.volume; }

  /** whatever was playing last time, curated or found */
  remembered() {
    return STATIONS.find(s => s.id === this.s.stationId)
      || mine().find(s => s.id === this.s.stationId)
      || (this.s.station?.url ? this.s.station : null)
      || STATIONS[0];
  }

  async play(station) {
    const st = station || this.station || this.remembered();
    const changing = st !== this.station || !this.el.getAttribute('src');
    this.station = st;
    this.s.stationId = st.id;
    // curated stations are found again by id; found and added ones have to be kept whole,
    // and a stack of local files cannot be kept at all — its URLs die with the tab
    this.s.station = st.src === 'rb' || st.src === 'mine' ? st : null;
    this._stopped = false;
    if (changing) {
      this._tryIdx = 0; this._told = null; this.track = '';
      this._i = 0;
      this.el.src = st.kind === 'files' ? st.tracks[0].url : st.url;
    }
    try {
      this.el.volume = 0;
      await this.el.play();
      this._to(this.s.volume);
      this._watch();
    } catch (err) {
      this.playing = false;
      this.onchange(this, this._once(err));
    }
  }

  stop({ fade = true } = {}) {
    clearInterval(this._poll); this._poll = null;
    this._stopped = true;
    // dropping the source raises an error event of its own; _fallback ignores it
    const done = () => { this.el.pause(); this.el.removeAttribute('src'); this.el.load(); this.playing = false; this.onchange(this); };
    if (!fade || this.el.paused) return done();
    this._to(0, 420, done);
  }

  toggle() { this.playing ? this.stop() : this.play(); }

  /** forwards or back through your own tracks; wraps both ways */
  skip(by = 1) {
    const st = this.station;
    if (st?.kind !== 'files') return;
    const n = st.tracks.length;
    this._i = ((this._i + by) % n + n) % n;
    this._stopped = false;
    this.el.src = st.tracks[this._i].url;
    this.el.volume = this.s.volume;
    this.el.play().catch(() => {});
    this._watch();
  }

  shuffle() {
    const st = this.station;
    if (st?.kind !== 'files' || st.tracks.length < 3) return;
    const here = st.tracks[this._i];
    for (let i = st.tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [st.tracks[i], st.tracks[j]] = [st.tracks[j], st.tracks[i]];
    }
    this._i = st.tracks.indexOf(here);
    this.onchange(this);
  }

  setVolume(v) {
    this.s.volume = v;
    if (this.playing) this._to(v, 120);
  }

  /** duck under a chime, then come back up */
  duck(ms = 2600) {
    if (!this.playing) return;
    this._to(this.s.volume * .22, 420, () => {
      setTimeout(() => this.playing && this._to(this.s.volume, 1400), ms);
    });
  }

  _to(target, ms = 1100, done) {
    clearInterval(this._fade);
    const from = this.el.volume, steps = Math.max(1, Math.round(ms / 40));
    let i = 0;
    this._fade = setInterval(() => {
      i++;
      const t = i / steps;
      this.el.volume = Math.max(0, Math.min(1, from + (target - from) * t));
      if (i >= steps) { clearInterval(this._fade); done?.(); }
    }, 40);
  }

  _fallback() {
    if (this._stopped) return;
    // one unreadable file shouldn't end the evening
    if (this.station?.kind === 'files') {
      if (++this._bad <= this.station.tracks.length) return this.skip(1);
      this._bad = 0;
      this.playing = false;
      return this.onchange(this, this._once(new Error('none of those would play')));
    }
    const alts = this.station?.alts || [];
    if (this._tryIdx < alts.length) {
      this.el.src = alts[this._tryIdx++];
      this.el.play().catch(() => {});
    } else {
      this.playing = false;
      this.onchange(this, this._once(new Error('stream unavailable')));
    }
  }

  /** report a dead stream once per station, not once per retry */
  _once(err) {
    if (this._told === this.station?.id) return null;
    this._told = this.station?.id;
    return err;
  }

  /** SomaFM publishes what's on right now; your own files say so themselves */
  _watch() {
    clearInterval(this._poll);
    if (this.station?.kind === 'files') {
      this._bad = 0;
      this.track = this.station.tracks[this._i]?.name || '';
      this.onchange(this);
      return;
    }
    if (this.station?.src !== 'soma') { this.track = ''; this.onchange(this); return; }
    const tick = async () => {
      try {
        const j = await fetchJSON(`https://somafm.com/songs/${this.station.id}.json`, { timeout: 8000 });
        const s = (j.songs || [])[0];
        const next = s ? [s.artist, s.title].filter(Boolean).join(' — ') : '';
        if (next !== this.track) { this.track = next; this.onchange(this); }
      } catch { /* the music matters more than the metadata */ }
    };
    tick();
    this._poll = setInterval(tick, 25000);
  }
}
