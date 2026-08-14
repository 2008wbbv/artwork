/* ============================================================
   artwork — wiring.
   ============================================================ */
import { $, fmtClock, debounce } from './util.js';
import { load, save, drop } from './store.js';
import { Painter } from './painter.js';
import { Gallery } from './gallery.js';
import { Timer } from './timer.js';
import { Radio, STATIONS } from './radio.js';
import { Ledger } from './badges.js';
import { UI } from './ui.js';
import { byId } from './playlists.js';
import * as sound from './sound.js';

const DEFAULTS = {
  focusMin: 25, shortMin: 5, longMin: 15, longEvery: 4,
  autoBreak: true, autoFocus: false,
  playlist: 'the-ten',
  volume: .5, stationId: 'secretagent', station: null, radioOn: true,
  chimes: true, recede: true, labelOn: true, grain: true, fit: 'fill',
};

const settings = { ...DEFAULTS, ...load('settings', {}) };
const persist = debounce(() => save('settings', settings), 250);

const painter = new Painter($('#stage'));
const gallery = new Gallery();
const ledger  = new Ledger();
const timer   = new Timer(settings);
const radio   = new Radio(settings);
const ui      = new UI({ settings, ledger });

const OFFLINE_CARD = {
  title: 'Untitled', artist: 'No connection', date: '',
  medium: 'Colour on canvas', place: '',
  note: 'The museums can’t be reached from here, so this one is being made up on the spot. The clock is unaffected; the pictures come back when the network does.',
  museumShort: 'artwork', gallery: '', url: '#', credit: '',
};

// the painting is pinned to the clock: however the interval is stretched, the
// brush carries on from where it is and re-fits what is left
let pin = { p: 0, left: 0 };
const repin = p => { pin = { p, left: Math.max(1000, timer.left) }; };
const paintProgress = () =>
  pin.p + (1 - pin.p) * (1 - Math.min(1, Math.max(0, timer.left / pin.left)));

let swapping = false;        // holding the old picture while the next one loads
let hanging = 0;             // only the most recent request gets to hang
const firstRun = !load('settings', null);

/* ------------------------------------------------ pictures */
async function hang({ silent = false } = {}) {
  const mine = ++hanging;
  swapping = true;
  const had = gallery.current;
  const next = await gallery.advance();
  if (mine !== hanging) return null;              // a later request overtook this one

  if (!next) {
    // a handful of dead links is not the same as being offline. If there's a
    // picture on the wall already, start it again rather than take it down.
    if (had?.img) {
      painter.load(had.img, { tainted: had.tainted, key: had.art.key + ':again' });
      ui.setAccent(painter.accentHsl);
      ui.showLabel(had.art);
      swapping = false;
      refresh(silent);
      return had.art;
    }
    await painter.paintFallback(Date.now());
    if (mine !== hanging) return null;
    ui.setAccent(painter.accentHsl);
    ui.showLabel(OFFLINE_CARD);
    if (!silent) ui.toast({ kicker: 'No signal', name: 'The collections are out of reach', seal: '⌾', ms: 5000 });
    swapping = false;
    refresh(silent);
    return null;
  }
  painter.load(next.img, { tainted: next.tainted, key: next.art.key });
  ui.setAccent(painter.accentHsl);
  ui.showLabel(next.art);
  swapping = false;
  return next.art;
}

/** the shelf has gone stale — fetch it again, quietly, at most once a minute */
let refreshedAt = 0;
function refresh(silent) {
  if (Date.now() - refreshedAt < 60000) return;
  refreshedAt = Date.now();
  const id = settings.playlist;
  for (let spin = 0; spin < 5; spin++) drop(`cache.${id}.${spin}`);
  gallery.use(id).then(n => {
    if (n && !gallery.current) hang({ silent: true });
    if (!silent && n) ui.toast({ kicker: 'Refreshed', name: `${n} works back on the shelf`, seal: '❋', ms: 3000 });
  }).catch(() => {});
}

async function choosePlaylist(id, { announce = true } = {}) {
  settings.playlist = id;
  persist();
  const pl = byId(id);
  ui.setPlaylistChip(pl, 0);
  painter.fit = settings.fit;
ui.renderPlaylists();
  const n = await gallery.use(id);
  ui.setPlaylistChip(pl, n);
  if (!n) {
    if (id !== DEFAULTS.playlist) {
      ui.toast({ kicker: 'Empty wall', name: 'Nothing came back — trying another shelf', seal: '⌾' });
      return choosePlaylist(DEFAULTS.playlist, { announce: false });
    }
    await hang();                       // paints a quiet abstraction and says why
    return;
  }
  await hang();
  if (announce) ui.toast({ kicker: pl.group, name: `${pl.name} · ${n} works`, seal: '❋', ms: 3800 });
}

/* --------------------------------------------------- clock */
timer.onstate = t => ui.setState(t);

timer.onphase = ({ phase, completed }) => {
  repin(0);
  ui.setState(timer);
  hang({ silent: true });
  if (completed && settings.chimes) {
    radio.duck(2800);
    phase === 'focus' ? sound.chimeWork() : sound.chimeRest();
  }
};

timer.oncomplete = ({ phase, minutes }) => {
  const art = gallery.current?.art;
  const fresh = ledger.record({
    art, phase, minutes,
    playlist: byId(settings.playlist),
    silent: !radio.playing,
    startedAt: timer.startedAt,
  });
  fresh.forEach((b, i) => setTimeout(() => {
    ui.toast({ kicker: 'Badge unlocked', name: b.name });
    if (settings.chimes) sound.chimeBadge(.8);
  }, 900 + i * 900));
};

/* ---------------------------------------------------- loop */
let last = performance.now(), scrimAt = 0;
function frame(now) {
  const dt = Math.min(64, now - last);
  last = now;

  if (timer.update() || timer.state !== 'running') {
    ui.setClock(fmtClock(timer.left), timer.left);
  }
  if (!swapping) {
    const p = paintProgress();
    painter.setProgress(Math.max(.006, p));   // a few marks on the canvas before you begin
    ui.setProgress(p);
  }
  painter.frame(dt);

  if (now - scrimAt > 800) {
    scrimAt = now;
    ui.setScrims(painter.zones());
  }
  requestAnimationFrame(frame);
}

/* ------------------------------------------------- actions */
ui.on = {
  toggle() {
    sound.wake();
    timer.toggle();
    if (timer.state === 'running' && settings.radioOn && !radio.playing) radio.play();
  },
  skip() { timer.skip(); },
  reset() { timer.reset(); repin(0); ui.setClock(fmtClock(timer.left), timer.left); },
  stretch(dir) {
    const here = paintProgress();
    if (!timer.stretch(dir * 5 * 60000)) return;
    repin(here);                                   // the paint stays put; the rest re-fits
    persist();
    ui.setClock(fmtClock(timer.left), timer.left);
    if (!$('#panel-settings').hidden) ui.renderSettings();
    ui.toast({ kicker: timer.label, name: `${Math.round(timer.duration / 60000)} minutes`,
               seal: dir > 0 ? '+' : '−', ms: 2000 });
  },
  nextArt() { hang({ silent: true }); },
  async showWork(art) {
    swapping = true;
    const next = await gallery.show(art);
    swapping = false;
    if (!next) return ui.toast({ kicker: 'Sorry', name: 'That one would not load', seal: '⌾', ms: 3500 });
    painter.load(next.img, { tainted: next.tainted, key: next.art.key });
    ui.setAccent(painter.accentHsl);
    ui.showLabel(next.art);
  },
  playlist(id) { ui.closeDrawer(); choosePlaylist(id); },
  toggleRadio() {
    sound.wake();
    settings.radioOn = !radio.playing;
    persist();
    radio.toggle();
  },
  station(id, adhoc) {
    const st = adhoc || STATIONS.find(s => s.id === id);
    if (!st) return;
    settings.radioOn = true;
    persist();
    radio.play(st);
  },
  volume(v) { radio.setVolume(v); persist(); },
  fit(mode) { settings.fit = mode; persist(); painter.setFit(mode); },
  wipe() {
    if (!confirm('Clear every badge, statistic and setting stored in this browser?')) return;
    Object.keys(localStorage).filter(k => k.startsWith('artwork.v1.')).forEach(k => localStorage.removeItem(k));
    location.reload();
  },
  setting(id, value) {
    const map = {
      'set-focus': 'focusMin', 'set-short': 'shortMin', 'set-long': 'longMin', 'set-every': 'longEvery',
      'set-autobreak': 'autoBreak', 'set-autofocus': 'autoFocus', 'set-recede': 'recede',
      'set-label': 'labelOn', 'set-grain': 'grain', 'sw-chimes': 'chimes',
    };
    const key = map[id];
    if (!key) return;
    settings[key] = value;
    persist();
    if (key === 'grain') ui.setGrain(value);
    if (key === 'labelOn') ui.showLabel(value ? gallery.current?.art : null);
    if (key === 'recede') value ? ui.armHush() : ui.unhush();
    if (['focusMin', 'shortMin', 'longMin'].includes(key) && timer.state === 'idle') {
      timer.reset();                       // takes the new length; a running interval keeps its own
      repin(0);
      ui.setClock(fmtClock(timer.left), timer.left);
    }
    if (key === 'longEvery') ui.drawCycle(timer);
  },
};

gallery.onupgrade = entry => {
  if (entry === gallery.current) painter.upgrade(entry.img, entry.tainted);
};

radio.onchange = (r, err) => {
  ui.setRadioUI(r);
  if (err) ui.toast({ kicker: 'Sound', name: 'That station did not answer', seal: '⌾', ms: 4200 });
};

/* --------------------------------------------------- boot */
window.addEventListener('resize', debounce(() => painter.resize(), 220));
window.addEventListener('orientationchange', () => setTimeout(() => painter.resize(), 320));
window.addEventListener('online', () => {
  if (!gallery.items.length) choosePlaylist(settings.playlist, { announce: false });
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { last = performance.now(); painter.catchUp = true; }
});

painter.fit = settings.fit;
ui.renderPlaylists();
ui.setPlaylistChip(byId(settings.playlist), 0);
ui.setGrain(settings.grain);
ui.setClock(fmtClock(timer.left), timer.left);
ui.setState(timer);
repin(0);
ui.setRadioUI(radio);
requestAnimationFrame(frame);

choosePlaylist(settings.playlist, { announce: false });

$('#intro-go').onclick = () => {
  ui.dismissIntro();
  sound.wake();
  timer.start();
  if (settings.radioOn) {
    radio.play();
    if (firstRun) setTimeout(() => ui.toast({
      kicker: 'Now playing', name: `${radio.remembered().name} · press M for silence`,
      seal: '♪', ms: 6000,
    }), 1800);
  }
  save('settings', settings);
};

// let people look around before committing
$('#intro').addEventListener('click', e => {
  if (e.target === $('#intro')) { ui.dismissIntro(); sound.wake(); }
});

if (!firstRun) setTimeout(() => ledger.check(), 1200);
window.artwork = { painter, gallery, timer, radio, ledger, settings };
