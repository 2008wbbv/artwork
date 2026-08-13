/* ============================================================
   Sound. Two sources, both open and key-less:

     · SomaFM — hand-programmed, listener-supported, and the
       closest thing the internet has to a good record shop.
       somafm.com/support/ if you end up leaving it on all day.
     · Radio Browser — a community index, used here to turn up
       stations outside the curated shelf.
   ============================================================ */
import { fetchJSON } from './util.js';
import { load, save } from './store.js';

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
  { tag: 'jazz',       label: 'Jazz' },
  { tag: 'lounge',     label: 'Lounge' },
  { tag: 'bossa nova', label: 'Bossa nova' },
  { tag: 'deep house', label: 'Deep house' },
  { tag: 'downtempo',  label: 'Downtempo' },
  { tag: 'ambient',    label: 'Ambient' },
];

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
    this.el.addEventListener('error', () => this._fallback());
    this.el.addEventListener('playing', () => { this.playing = true; this.onchange(this); });
    this.el.addEventListener('pause', () => { this.playing = false; this.onchange(this); });
  }

  get volume() { return this.s.volume; }

  async play(station) {
    const st = station || this.station || STATIONS.find(s => s.id === this.s.stationId) || STATIONS[0];
    const changing = st !== this.station;
    this.station = st;
    this.s.stationId = st.id;
    if (changing) { this._tryIdx = 0; this._told = null; this.el.src = st.url; this.track = ''; }
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
    const done = () => { this.el.pause(); this.el.removeAttribute('src'); this.el.load(); this.playing = false; this.onchange(this); };
    if (!fade || this.el.paused) return done();
    this._to(0, 420, done);
  }

  toggle() { this.playing ? this.stop() : this.play(); }

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

  /** SomaFM publishes what's on right now */
  _watch() {
    clearInterval(this._poll);
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
