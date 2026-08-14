/* ============================================================
   Everything you can see and press.
   ============================================================ */
import { $, $$, escapeHtml, fmtDuration, reducedMotion } from './util.js';
import { shelves, GROUPS } from './playlists.js';
import { STATIONS, DISCOVER_TAGS, discover, mine, addMine, dropMine, fromFiles } from './radio.js';
import { BADGES } from './badges.js';
import { profile, worksBy } from './artist.js';
import { rooms, count, when, style, columns } from './museum.js';
import { Painter } from './painter.js';
import { loadImage } from './sources.js';

const HUSH_AFTER = 6200;

/** the listener's own stream addresses, with a way to take them back off */
const ownRows = (list, cur) => (list.length ? list.map(s => `
  <div class="row row--own ${s.id === cur ? 'is-on' : ''}">
    <button class="row__pick" data-station="${escapeHtml(s.id)}" data-own='${escapeHtml(JSON.stringify(s))}'>
      <i class="row__dot"></i>
      <span class="row__text">
        <span class="row__name">${escapeHtml(s.name)}</span>
        <span class="row__note">${escapeHtml(s.url)}</span>
      </span>
    </button>
    <button class="row__drop" data-drop="${escapeHtml(s.id)}" aria-label="Remove ${escapeHtml(s.name)}" title="Remove">×</button>
  </div>`).join('')
  : '<p class="sect__note">Nothing of yours yet.</p>');
/** no two frames on the wall come closer than this */
const MIN_GAP = 16;

/** the horizontal reach of a column's frames, shifts and all */
function spanOf(col) {
  const frames = $$('.hung__frame', col);
  if (!frames.length) return null;
  let left = Infinity, right = -Infinity;
  for (const f of frames) {
    const r = f.getBoundingClientRect();
    if (r.width < 2) continue;
    left = Math.min(left, r.left);
    right = Math.max(right, r.right);
  }
  return left === Infinity ? null : { left, right };
}

/** how deep a column may hang, given how much wall the screen affords */
const wallBudget = () => (innerHeight >= 820 ? 2.3 : innerHeight >= 660 ? 1.62 : 1.1);
/** the side of a miniature on this screen */
const miniSide = () => Math.min(158, Math.max(92, innerHeight * .17));

export class UI {
  constructor({ settings, ledger }) {
    this.s = settings;
    this.ledger = ledger;
    this.on = {};                       // filled in by main
    this.el = {
      shell: $('#shell'), phase: $('#phase-label'), clock: $('#clock'),
      rail: $('#rail-fill'), railBox: $('.rail'), start: $('#btn-start'),
      skip: $('#btn-skip'), reset: $('#btn-reset'), cycle: $('#cycle'),
      label: $('#wall-label'), title: $('#label-title'), artist: $('#label-artist'),
      meta: $('#label-meta'), note: $('#label-note'), more: $('#label-more'), link: $('#label-link'),
      artistTab: $('.tabs [data-tab="artist"]'), doing: $('#doing'),
      museum: $('#label-museum'), chip: $('#playlist-chip'), chipName: $('#playlist-name'),
      chipGroup: $('#playlist-group'), drawer: $('#drawer'), scrim: $('#scrim'),
      toasts: $('#toasts'), intro: $('#intro'), np: $('#nowplaying'), npText: $('#np-text'),
      npPrev: $('#np-prev'), npNext: $('#np-next'),
      sound: $('#btn-sound'), grain: $('.grain'),
    };
    this._zoneEls = {
      centre: $('.centre'), label: this.el.label,
      dock: $('.dock'), top: $('.bar--top'),
    };
    this._hush = null;
    this._wire();
    this.armHush();
  }

  /* ------------------------------------------------ chrome */
  setPhase(timer) {
    this._phase = timer.label;
    this._idle = timer.state === 'idle';
    this.el.phase.textContent = timer.label;
    this._title();
  }

  setClock(text, ms) {
    if (text === this._clockText) return;
    this._clockText = text;
    this.el.clock.textContent = text;
    this.el.clock.setAttribute('datetime', 'PT' + Math.round(ms / 1000) + 'S');
    this._title();
  }

  _title() {
    document.title = this._idle
      ? 'artwork — a pomodoro that paints'
      : `${this.el.clock.textContent} · ${(this._phase || '').toLowerCase()} — artwork`;
  }

  setProgress(p) {
    const w = (p * 100).toFixed(2) + '%';
    if (w === this._railW) return;
    this._railW = w;
    this.el.rail.style.width = w;
    this.el.railBox.setAttribute('aria-valuenow', Math.round(p * 100));
  }

  setState(timer) {
    this.el.shell.dataset.state = timer.state;
    this.el.shell.dataset.phase = timer.phase;
    // an interval under way belongs to the picture, not to the clock
    this.el.shell.dataset.mini = timer.state === 'idle' ? '0' : '1';
    this.el.start.textContent =
      timer.state === 'running' ? 'Pause' :
      timer.state === 'paused' ? 'Resume' :
      timer.phase === 'focus' ? 'Begin' : 'Rest';
    if (timer.state !== 'running') this.unhush();
    this.armHush();
    this.setPhase(timer);
    this.drawCycle(timer);
  }

  drawCycle(timer) {
    const n = Math.max(2, Math.min(8, this.s.longEvery));
    const done = timer.round % n;
    const now = timer.phase === 'focus' ? done : -1;
    this.el.cycle.innerHTML = Array.from({ length: n }, (_, i) =>
      `<b class="${i < done ? 'is-done' : ''} ${i === now ? 'is-now' : ''}"></b>`).join('');
  }

  /* --------------------------------------------- wall label */
  showLabel(art) {
    const L = this.el;
    this._current = art;
    if (L.artistTab) L.artistTab.hidden = !art?.artist || art.artist === 'Unknown';
    if (!art || !this.s.labelOn) { L.label.hidden = true; return; }
    L.label.hidden = false;
    L.label.dataset.fade = '1';
    const paint = () => {
      L.title.textContent = art.title;
      L.artist.textContent = [art.artist, art.date].filter(Boolean).join(' · ');
      L.meta.textContent = [art.medium, art.place].filter(Boolean).join(' · ');
      const room = window.innerHeight > 720 && window.innerWidth > 760;
      L.note.textContent = room ? (art.note || '') : '';
      L.note.hidden = !L.note.textContent;
      L.more.textContent = [art.dims, art.credit].filter(Boolean).join(' · ');
      L.museum.textContent = [art.museumShort, art.gallery].filter(Boolean).join(' · ');
      L.link.href = art.url;
      L.link.title = art.credit || art.museum;
      L.label.dataset.fade = '0';
    };
    reducedMotion() ? paint() : setTimeout(paint, 560);
  }

  /** darken only where the picture is bright enough to swallow the type */
  setScrims(zones) {
    for (const [k, el] of Object.entries(this._zoneEls)) {
      const v = zones[k];
      if (v == null || !el) continue;
      const want = Math.max(0, Math.min(1, (v - .30) / .34)).toFixed(2);
      if (el.style.getPropertyValue('--sc') !== want) el.style.setProperty('--sc', want);
    }
  }

  setAccent([h, s, l]) {
    const r = document.documentElement.style;
    r.setProperty('--accent', `hsl(${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`);
    r.setProperty('--accent-soft', `hsl(${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}% / .3)`);
  }

  setPlaylistChip(pl, count) {
    this.el.chipGroup.textContent = count === 0 ? `${pl.group} · …` : count ? `${pl.group} · ${count}` : pl.group;
    this.el.chipName.textContent = pl.name;
  }

  /* ------------------------------------------------- hush */
  armHush() {
    clearTimeout(this._hush);
    if (!this.s.recede) return;
    this._hush = setTimeout(() => {
      if (this.el.shell.dataset.state === 'running' && !this._drawerOpen())
        this.el.shell.dataset.recede = '1';
    }, HUSH_AFTER);
  }

  unhush() {
    if (this.el.shell.dataset.recede === '1') this.el.shell.dataset.recede = '0';
    this.armHush();
  }

  _drawerOpen() { return this.el.drawer.dataset.open === '1'; }

  /* ----------------------------------------------- drawer */
  openDrawer(tab) {
    const d = this.el.drawer;
    clearTimeout(this._closing);            // reopening mid-slide must not get hidden behind us
    d.hidden = false; this.el.scrim.hidden = false;
    requestAnimationFrame(() => { d.dataset.open = '1'; this.el.scrim.dataset.open = '1'; });
    if (tab) this.showTab(tab);
    this.unhush();
  }

  closeDrawer() {
    const d = this.el.drawer;
    d.dataset.open = '0'; this.el.scrim.dataset.open = '0';
    clearTimeout(this._closing);
    this._closing = setTimeout(() => { d.hidden = true; this.el.scrim.hidden = true; }, 520);
    this.armHush();
  }

  toggleDrawer(tab) {
    if (this._drawerOpen() && $(`.tabs button.is-on`)?.dataset.tab === tab) this.closeDrawer();
    else this.openDrawer(tab);
  }

  showTab(tab) {
    $$('.tabs button').forEach(b => b.classList.toggle('is-on', b.dataset.tab === tab));
    $$('.panel').forEach(p => (p.hidden = p.dataset.panel !== tab));
    if (tab === 'artist') this.renderArtist();
    if (tab === 'badges') this.renderBadges();
    if (tab === 'settings') this.renderSettings();
    if (tab === 'sound') this.renderSound();
  }

  /* --------------------------------------------- museum */
  /** everything you've painted, repainted from its seed and hung up */
  openMuseum() {
    const box = $('#museum'), hall = $('#hall');
    const list = rooms();
    $('#museum-sub').textContent = count()
      ? `${count()} ${count() === 1 ? 'picture' : 'pictures'} · ${list.length} ${list.length === 1 ? 'room' : 'rooms'}`
      : 'Nothing hung yet';
    const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV'];
    const frame = h => {
      const st = style(h);
      return `<button class="hung ${st.mat ? '' : 'hung--nomat'}" data-hung="${escapeHtml(h.k)}"
                data-room="__ROOM__" data-frame="${st.frame}" data-size="${st.size}"
                style="--drop:${st.drop}px;--shift:${st.shift}px">
        <span class="hung__frame"><span class="hung__mat"><canvas width="10" height="10"></canvas></span></span>
        <span class="hung__tag">${escapeHtml(h.a.title)}</span>
      </button>`;
    };
    hall.innerHTML = list.length ? list.map((r, n) => `
      <section class="room">
        <p class="room__n">Room ${ROMAN[n] || n + 1}</p>
        <h3 class="room__name">${escapeHtml(r.name)}</h3>
        <p class="room__note">${escapeHtml(r.note || '')}</p>
        <div class="wall">${columns(r.works, wallBudget()).map(col =>
          `<span class="col ${col.works.length > 1 ? 'col--stacked' : ''}" data-pull="${col.pull}"
                 style="--lift:${col.lift}px;--pull:${col.pull}px">${col.works.map(frame).join('')}</span>`
        ).join('')}</div>
        <i class="bench" aria-hidden="true"></i>
        ${n % 3 === 1 ? '<i class="palm" aria-hidden="true"></i>' : ''}
      </section>`).join('').replace(/__ROOM__/g, () => '')
      : `<p class="museum__empty">The walls are bare. Finish an interval and whatever was on the screen is hung here, repainted from its seed.</p>`;
    // stamp each frame with the room it hangs in
    $$('.room', hall).forEach((room, n) =>
      $$('.hung', room).forEach(el => (el.dataset.room = list[n].id)));

    this._hung = new Map(list.flatMap(r => r.works.map(h => [r.id + '|' + h.k, h])));
    box.hidden = false;
    hall.scrollLeft = 0;
    hall.focus({ preventScroll: true });
    this._paintWalls();
    this.on.museumOpen?.();
  }

  /** the wall was laid out for a different window; lay it out again */
  relayout() {
    if ($('#museum').hidden) return;
    this.openMuseum();
  }

  closeMuseum() {
    $('#museum').hidden = true;
    $('#plaque').hidden = true;
    this._queue = [];
  }

  /** repaint each frame as it comes into view, one per animation frame */
  _paintWalls() {
    const hall = $('#hall');
    this._queue = [];
    this._seen?.disconnect();
    this._seen = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) {
        this._seen.unobserve(e.target);
        this._queue.push(e.target);
      }
      this._drain();
    }, { root: hall, rootMargin: '400px' });
    $$('.hung', hall).forEach(el => this._seen.observe(el));
  }

  _drain() {
    if (this._draining) return;
    this._draining = true;
    const step = async () => {
      const el = this._queue.shift();
      if (!el) { this._draining = false; this._space(); return; }
      await this._paintOne(el).catch(() => {});
      this._space();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* Columns lean into their neighbours, and the frames vary in width,
     so where two happen to land is not knowable before they are on the
     wall. Measure them and push each column right until nothing is
     closer to its neighbour than a hand's breadth. One pass, left to
     right: moving a column moves everything after it. */
  _space() {
    cancelAnimationFrame(this._spacing);
    this._spacing = requestAnimationFrame(() => {
      for (const room of $$('.room', $('#hall'))) {
        const cols = $$('.col', room);
        let prevRight = -Infinity;
        for (const col of cols) {
          col.style.setProperty('--pull', (+col.dataset.pull || 0) + 'px');
          const box = spanOf(col);
          if (!box) continue;
          const short = prevRight + MIN_GAP - box.left;
          if (short > 0) {
            col.style.setProperty('--pull', Math.round((+col.dataset.pull || 0) + short) + 'px');
            prevRight = box.right + short;
          } else {
            prevRight = box.right;
          }
        }
      }
    });
  }

  async _paintOne(el) {
    const h = this._hung?.get(el.dataset.room + '|' + el.dataset.hung);
    const cv = $('canvas', el);
    if (!h || !cv || cv.dataset.done) return;
    cv.dataset.done = '1';
    const { img } = await loadImage(h.a.image(520), 11000);
    const wide = img.naturalWidth >= img.naturalHeight;
    const scale = +el.dataset.size || 1;
    const side = Math.round(miniSide() * scale);
    const w = wide ? side : Math.round(side * (img.naturalWidth / img.naturalHeight));
    const ht = wide ? Math.round(side * (img.naturalHeight / img.naturalWidth)) : side;
    const mini = new Painter(cv, { fixed: { w, h: ht }, coarse: true });
    cv.style.width = w + 'px';
    cv.style.height = ht + 'px';
    mini.load(img, { key: h.k });
    mini.finish();
  }

  showPlaque(h) {
    const p = $('#plaque');
    if (!h) { p.hidden = true; return; }
    p.hidden = false;
    p.innerHTML = `
      <div>
        <p class="plaque__title">${escapeHtml(h.a.title)}</p>
        <p class="plaque__by">${escapeHtml([h.a.artist, h.a.date].filter(Boolean).join(' · '))}</p>
        <p class="plaque__meta">${escapeHtml([h.a.medium, h.a.museum].filter(Boolean).join(' · '))}</p>
        ${h.a.note ? `<p class="plaque__note">${escapeHtml(h.a.note)}</p>` : ''}
      </div>
      <div class="plaque__side">
        <p class="plaque__when">${escapeHtml(when(h))}</p>
        ${h.d ? `<p class="plaque__note">“${escapeHtml(h.d)}”</p>` : ''}
        <p class="plaque__when">Click to hang it again</p>
      </div>`;
  }

  /* --------------------------------------------- artist */
  /** the hand behind the current picture: who they were, and what else is hanging */
  openArtist(art) {
    if (!art?.artist || art.artist === 'Unknown') return;
    this._artist = art;
    const tab = $('.tabs [data-tab="artist"]');
    if (tab) tab.hidden = false;
    this.openDrawer('artist');
  }

  async renderArtist() {
    const art = this._artist;
    const box = $('#panel-artist');
    if (!art) { box.innerHTML = '<p class="sect__note">No hand recorded for this one.</p>'; return; }
    const name = art.artist;
    const life = [art.nationality, art.artistBio?.match(/\b(1[0-9]{3})[–-](1[0-9]{3})\b/)?.[0]]
      .filter(Boolean).join(' · ');
    box.innerHTML = `
      <section class="sect artist">
        <div class="frame frame--empty"><div class="frame__mat"><span>looking…</span></div></div>
        <h3 class="artist__name">${escapeHtml(name)}</h3>
        ${life ? `<p class="artist__life">${escapeHtml(life)}</p>` : ''}
      </section>
      <section class="sect"><h3 class="sect__head">Elsewhere in the collections</h3>
        <p class="sect__note" id="works-note">Asking the five museums…</p>
        <div class="works" id="works"></div>
      </section>`;

    const token = (this._artistToken = Symbol('artist'));
    const [who, works] = await Promise.all([
      profile(name).catch(() => null),
      worksBy(name, art.key).catch(() => []),
    ]);
    if (token !== this._artistToken || this._artist !== art) return;   // they moved on

    const head = $('.artist', box);
    if (head) head.innerHTML = `
      ${who?.face
        ? `<div class="frame"><div class="frame__mat"><img src="${escapeHtml(who.face)}" alt="${escapeHtml(name)}" loading="lazy"
             onerror="this.closest('.frame').className='frame frame--empty';this.replaceWith(Object.assign(document.createElement('span'),{textContent:'no likeness'}))"></div></div>`
        : `<div class="frame frame--empty"><div class="frame__mat"><span>no likeness</span></div></div>`}
      <h3 class="artist__name">${escapeHtml(who?.name || name)}</h3>
      <p class="artist__life">${escapeHtml(who?.line || life || 'Painter')}</p>
      ${who?.bio ? `<p class="artist__bio">${escapeHtml(who.bio)}</p>` : ''}
      ${who?.url ? `<a class="artist__more" href="${escapeHtml(who.url)}" target="_blank" rel="noopener noreferrer">Wikipedia ↗</a>` : ''}`;

    this._works = works;
    const note = $('#works-note'), grid = $('#works');
    if (!grid) return;
    if (!works.length) { note.textContent = 'Nothing else of theirs is open-licensed in these five.'; return; }
    note.textContent = `${works.length} more, and any of them will do next.`;
    grid.innerHTML = works.map((w, n) => `
      <button class="work" data-work="${n}" title="${escapeHtml(w.title)} — ${escapeHtml(w.museumShort)}">
        <img src="${escapeHtml(w.image(360))}" alt="" loading="lazy">
        <b>${escapeHtml(w.title)}</b>
      </button>`).join('');
  }

  /* ---------------------------------------------- toasts */
  toast({ kicker = 'Unlocked', name, seal = '✦', ms = 5200 }) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<i class="toast__seal">${seal}</i><span>
      <span class="toast__kicker">${escapeHtml(kicker)}</span>
      <span class="toast__name">${escapeHtml(name)}</span></span>`;
    this.el.toasts.append(t);
    setTimeout(() => { t.dataset.out = '1'; setTimeout(() => t.remove(), 520); }, ms);
  }

  /* --------------------------------------------- panels */
  renderPlaylists() {
    const cur = this.s.playlist;
    const html = GROUPS.map(g => {
      const rows = shelves().filter(p => p.group === g).map(p => `
        <button class="row ${p.id === cur ? 'is-on' : ''}" data-playlist="${p.id}">
          <i class="row__dot"></i>
          <span class="row__text">
            <span class="row__name">${escapeHtml(p.name)}</span>
            <span class="row__note">${escapeHtml(p.note)}</span>
          </span>
        </button>`).join('');
      return `<section class="sect"><h3 class="sect__head">${g}</h3>${rows}</section>`;
    }).join('');
    $('#panel-playlists').innerHTML =
      `<p class="sect__note">Every picture here is out of copyright and published openly by the museum that holds it.</p>${html}`;
  }

  renderSound() {
    const cur = this.s.stationId;
    const groups = [...new Set(STATIONS.map(s => s.g))];
    const rows = list => list.map(s => `
      <button class="row ${s.id === cur ? 'is-on' : ''}" data-station="${escapeHtml(s.id)}">
        <i class="row__dot"></i>
        <span class="row__text">
          <span class="row__name">${escapeHtml(s.name)}</span>
          <span class="row__note">${escapeHtml(s.note)}</span>
        </span>
      </button>`).join('');
    $('#panel-sound').innerHTML = `
      <section class="sect">
        <h3 class="sect__head">Volume</h3>
        <div class="field">
          <span class="field__label">Radio</span>
          <span class="field__ctl">
            <input type="range" id="vol" min="0" max="100" value="${Math.round(this.s.volume * 100)}">
            <span class="num" id="vol-n">${Math.round(this.s.volume * 100)}</span>
          </span>
        </div>
        <div class="field">
          <span class="field__label">Chime between intervals
            <span class="field__sub">A small bell, not an alarm.</span></span>
          <span class="field__ctl"><button class="sw" id="sw-chimes" aria-pressed="${!!this.s.chimes}" aria-label="Chimes"></button></span>
        </div>
      </section>
      <section class="sect">
        <h3 class="sect__head">Yours</h3>
        <p class="sect__note">Play your own instead. A stream address is remembered; files stay in this
          browser and are never uploaded anywhere, which also means they have to be picked again next time.</p>
        <div class="bring">
          <input type="url" id="own-url" placeholder="https://… stream address" autocomplete="off" spellcheck="false">
          <button class="btn btn--quiet" id="own-add">Add</button>
        </div>
        <div class="bring">
          <input type="file" id="own-files" accept="audio/*" multiple hidden>
          <button class="btn btn--quiet bring__wide" id="own-pick">Choose files from this machine…</button>
        </div>
        <div id="own-list">${ownRows(mine(), cur)}</div>
      </section>
      ${groups.map(g => `<section class="sect"><h3 class="sect__head">${escapeHtml(g)}</h3>${rows(STATIONS.filter(s => s.g === g))}</section>`).join('')}
      <section class="sect">
        <h3 class="sect__head">Elsewhere</h3>
        <p class="sect__note">Search the community radio index for something else in this mood — including
          the stations that play nothing but game soundtracks.</p>
        <div class="seg" id="tags">${DISCOVER_TAGS.map(t => `<button data-tag="${escapeHtml(t.tag)}">${escapeHtml(t.label)}</button>`).join('')}</div>
        <div id="discovered"></div>
      </section>
      <p class="sect__note">Curated stations come from SomaFM — listener-supported, no adverts. If you leave it on all day, consider chipping in at somafm.com/support.</p>`;
    const picker = $('#own-files');
    if (picker) picker.onchange = () => { this._ownFiles(picker.files); picker.value = ''; };
    const url = $('#own-url');
    if (url) url.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); this._addOwn(); } };
  }

  /** repaint just the list of your own stations */
  _ownList() {
    const box = $('#own-list');
    if (box) box.innerHTML = ownRows(mine(), this.s.stationId);
  }

  _addOwn() {
    const f = $('#own-url');
    if (!f || !f.value.trim()) return;
    try {
      const st = addMine({ url: f.value });
      f.value = '';
      this._ownList();
      this.on.station?.(st.id, st);
      this.toast({ kicker: 'Added', name: st.name, seal: '♪', ms: 3400 });
    } catch (err) {
      this.toast({ kicker: 'That address won’t work', name: err.message, seal: '◦', ms: 4600 });
      f.focus();
    }
  }

  /** files picked off this machine become a stack of records to play through */
  _ownFiles(files) {
    const st = fromFiles(files);
    if (!st) return this.toast({ kicker: 'Nothing playable', name: 'Those weren’t audio files.', seal: '◦', ms: 4200 });
    this.on.station?.(st.id, st);
    this.toast({ kicker: 'Playing yours', name: st.name, seal: '♪', ms: 3400 });
  }

  renderDiscovered(list, tag) {
    const box = $('#discovered');
    if (!box) return;
    const adhoc = this.s.station;
    box.innerHTML = list.length ? list.map(s => `
      <button class="row ${s.id === this.s.stationId ? 'is-on' : ''}" data-station="${escapeHtml(s.id)}" data-adhoc='${escapeHtml(JSON.stringify(s))}'>
        <i class="row__dot"></i>
        <span class="row__text">
          <span class="row__name">${escapeHtml(s.name)}</span>
          <span class="row__note">${escapeHtml(s.note)}</span>
        </span>
      </button>`).join('')
      : `<p class="sect__note">Nothing answered for “${escapeHtml(tag)}”. Try another.</p>`;
    if (adhoc && !list.some(s => s.id === adhoc.id) && adhoc.id === this.s.stationId) box.insertAdjacentHTML('afterbegin', `
      <button class="row is-on" data-station="${escapeHtml(adhoc.id)}" data-adhoc='${escapeHtml(JSON.stringify(adhoc))}'>
        <i class="row__dot"></i><span class="row__text">
        <span class="row__name">${escapeHtml(adhoc.name)}</span>
        <span class="row__note">${escapeHtml(adhoc.note || 'playing now')}</span></span></button>`);
  }

  renderBadges() {
    const st = this.ledger.stats;
    const cards = BADGES.map(b => {
      const got = this.ledger.has(b.id);
      const v = Math.min(this.ledger.value(b), b.target);
      return `<article class="badge ${got ? 'is-got' : 'is-locked'}">
        <i class="badge__seal">${got ? '✦' : '◦'}</i>
        <h4 class="badge__name">${escapeHtml(b.name)}</h4>
        <p class="badge__how">${escapeHtml(b.how)}</p>
        ${got ? '' : `<div class="badge__bar"><i style="width:${(v / b.target * 100).toFixed(0)}%"></i></div>
        <span class="badge__n">${v} / ${b.target}</span>`}
      </article>`;
    }).join('');
    $('#panel-badges').innerHTML = `
      <div class="stats">
        <div class="stat"><b>${st.works}</b><span>Pictures</span></div>
        <div class="stat"><b>${fmtDuration(st.focusMin).replace(' min', '′').replace(' h', 'h')}</b><span>Focused</span></div>
        <div class="stat"><b>${st.streak || 0}</b><span>Day streak</span></div>
      </div>
      <p class="sect__note">A picture counts once it has finished painting — badges are a record of time actually sat through.</p>
      <div class="badges">${cards}</div>`;
  }

  renderSettings() {
    const s = this.s;
    const range = (id, label, sub, min, max, step, val, unit = ' min') => `
      <div class="field">
        <span class="field__label">${label}${sub ? `<span class="field__sub">${sub}</span>` : ''}</span>
        <span class="field__ctl">
          <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}">
          <span class="num" data-for="${id}">${val}${unit}</span>
        </span>
      </div>`;
    const sw = (id, label, sub, on) => `
      <div class="field">
        <span class="field__label">${label}${sub ? `<span class="field__sub">${sub}</span>` : ''}</span>
        <span class="field__ctl"><button class="sw" id="${id}" aria-pressed="${!!on}" aria-label="${label}"></button></span>
      </div>`;
    $('#panel-settings').innerHTML = `
      <section class="sect">
        <h3 class="sect__head">Intervals</h3>
        ${range('set-focus', 'Focus', '', 5, 90, 5, s.focusMin)}
        ${range('set-short', 'Pause', '', 1, 30, 1, s.shortMin)}
        ${range('set-long', 'Long pause', '', 5, 45, 5, s.longMin)}
        ${range('set-every', 'Long pause after', '', 2, 8, 1, s.longEvery, '')}
        ${sw('set-autobreak', 'Start pauses automatically', 'The picture keeps painting through the rest.', s.autoBreak)}
        ${sw('set-autofocus', 'Start focus automatically', '', s.autoFocus)}
      </section>
      <section class="sect">
        <h3 class="sect__head">The room</h3>
        <div class="field">
          <span class="field__label">The picture
            <span class="field__sub">Filling the screen crops it; hanging it shows the whole thing on a wall.</span></span>
          <span class="field__ctl seg seg--fit">
            <button data-fit="fill" class="${s.fit !== 'frame' ? 'is-on' : ''}">Fill</button>
            <button data-fit="frame" class="${s.fit === 'frame' ? 'is-on' : ''}">Hang</button>
          </span>
        </div>
        ${sw('set-recede', 'Let the interface recede', 'After a few still seconds, everything but the clock fades.', s.recede)}
        ${sw('set-label', 'Show the wall label', '', s.labelOn)}
        ${sw('set-grain', 'Film grain', '', s.grain)}
        ${sw('sw-notify', 'Tell me when an interval ends', 'A desktop note, only when you\'ve tabbed away.', s.notify)}
      </section>
      <section class="sect">
        <h3 class="sect__head">Keys</h3>
        <dl class="keys">
          <dt><kbd>space</kbd></dt><dd>start · pause</dd>
          <dt><kbd>s</kbd><kbd>r</kbd></dt><dd>skip the interval · reset it</dd>
          <dt><kbd>+</kbd><kbd>−</kbd></dt><dd>five minutes more or less — the brush keeps pace</dd>
          <dt><kbd>n</kbd></dt><dd>another painting</dd>
          <dt><kbd>m</kbd></dt><dd>radio on · off</dd>
          <dt><kbd>[</kbd><kbd>]</kbd></dt><dd>back · on, through your own tracks</dd>
          <dt><kbd>g</kbd></dt><dd>your museum</dd>
          <dt><kbd>p</kbd><kbd>b</kbd><kbd>,</kbd></dt><dd>playlists · badges · settings</dd>
          <dt><kbd>esc</kbd></dt><dd>close this panel</dd>
        </dl>
      </section>
      <section class="sect">
        <h3 class="sect__head">Sources</h3>
        <p class="sect__note">Pictures: the Art Institute of Chicago, the Metropolitan Museum of Art, the
          Cleveland Museum of Art, the Victoria and Albert Museum, Statens Museum for Kunst, Wikidata and
          Wikimedia Commons, through their open APIs — public-domain, CC0 and freely licensed works only.
          Where a picture is under a Creative Commons licence, the licence is named on its label.
          Sound: SomaFM, the Radio Browser index, and whatever you bring yourself. Nothing you do here
          leaves your browser.</p>
        <button class="row" id="wipe"><i class="row__dot"></i><span class="row__text">
          <span class="row__name">Forget everything</span>
          <span class="row__note">Clears the museum, badges, statistics, cached pictures and settings.</span></span></button>
      </section>`;
  }

  /* ------------------------------------------------ wiring */
  _wire() {
    const E = this.el;
    E.doing.value = this.s.doing || '';
    E.doing.oninput = () => this.on.doing?.(E.doing.value);
    E.doing.onkeydown = e => { if (e.key === 'Enter') E.doing.blur(); };
    E.start.onclick = () => this.on.toggle?.();
    E.skip.onclick = () => this.on.skip?.();
    E.reset.onclick = () => this.on.reset?.();
    E.chip.onclick = () => this.toggleDrawer('playlists');
    $('#btn-badges').onclick = () => this.toggleDrawer('badges');
    $('#btn-museum').onclick = () => this.openMuseum();
    $('#museum-close').onclick = () => this.closeMuseum();

    const hall = $('#hall');
    hall.addEventListener('pointerover', e => {
      const el = e.target.closest('.hung');
      if (el) this.showPlaque(this._hung?.get(el.dataset.room + '|' + el.dataset.hung));
    });
    hall.addEventListener('pointerleave', () => this.showPlaque(null));
    hall.addEventListener('click', e => {
      const el = e.target.closest('.hung');
      if (!el || this._dragged) return;
      const h = this._hung?.get(el.dataset.room + '|' + el.dataset.hung);
      if (h) { this.closeMuseum(); this.on.rehang?.(h); }
    });
    hall.addEventListener('wheel', e => {                 // a hall runs sideways
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      hall.scrollLeft += e.deltaY;
    }, { passive: false });
    let down = 0, from = 0;
    hall.addEventListener('pointerdown', e => {
      down = e.clientX; from = hall.scrollLeft; this._dragged = false;
      hall.dataset.dragging = '1'; hall.setPointerCapture(e.pointerId);
    });
    hall.addEventListener('pointermove', e => {
      if (!hall.dataset.dragging) return;
      const d = e.clientX - down;
      if (Math.abs(d) > 4) this._dragged = true;
      hall.scrollLeft = from - d;
    });
    const up = () => { hall.dataset.dragging = ''; setTimeout(() => (this._dragged = false), 30); };
    hall.addEventListener('pointerup', up);
    hall.addEventListener('pointercancel', up);
    this.el.artist.onclick = () => this.openArtist(this._current);
    $('#btn-settings').onclick = () => this.toggleDrawer('settings');
    $('#btn-next-art').onclick = e => {
      e.currentTarget.classList.remove('ico--spin');
      void e.currentTarget.offsetWidth;
      e.currentTarget.classList.add('ico--spin');
      this.on.nextArt?.();
    };
    E.sound.onclick = e => (e.shiftKey ? this.toggleDrawer('sound') : this.on.toggleRadio?.());
    E.npPrev.onclick = () => this.on.skipTrack?.(-1);
    E.npNext.onclick = () => this.on.skipTrack?.(1);
    E.sound.oncontextmenu = e => { e.preventDefault(); this.toggleDrawer('sound'); };
    $('#drawer-close').onclick = () => this.closeDrawer();
    E.scrim.onclick = () => this.closeDrawer();
    $('#tabs').onclick = e => {
      const b = e.target.closest('button[data-tab]');
      if (b) this.showTab(b.dataset.tab);
    };

    E.drawer.addEventListener('click', e => {
      const pl = e.target.closest('[data-playlist]');
      if (pl) { this.on.playlist?.(pl.dataset.playlist); return; }
      const drop = e.target.closest('[data-drop]');
      if (drop) { dropMine(drop.dataset.drop); this._ownList(); return; }
      const st = e.target.closest('[data-station]');
      if (st) {
        const adhoc = st.dataset.adhoc || st.dataset.own;
        this.on.station?.(st.dataset.station, adhoc ? JSON.parse(adhoc) : null);
        $$('[data-station]', E.drawer).forEach(r => r.classList.toggle('is-on', r === st));
        $$('.row--own', E.drawer).forEach(r => r.classList.toggle('is-on', r.contains(st)));
        return;
      }
      if (e.target.closest('#own-pick')) { $('#own-files')?.click(); return; }
      if (e.target.closest('#own-add')) { this._addOwn(); return; }
      const work = e.target.closest('[data-work]');
      if (work) {
        const w = this._works?.[+work.dataset.work];
        if (w) { this.closeDrawer(); this.on.showWork?.(w); }
        return;
      }
      const fit = e.target.closest('[data-fit]');
      if (fit) {
        $$('[data-fit]', E.drawer).forEach(f => f.classList.toggle('is-on', f === fit));
        this.on.fit?.(fit.dataset.fit);
        return;
      }
      const tag = e.target.closest('[data-tag]');
      if (tag) {
        $$('#tags button').forEach(b => b.classList.toggle('is-on', b === tag));
        $('#discovered').innerHTML = '<p class="sect__note">Asking around…</p>';
        discover(tag.dataset.tag).then(l => this.renderDiscovered(l, tag.dataset.tag));
        return;
      }
      const sw = e.target.closest('.sw');
      if (sw) {
        const on = sw.getAttribute('aria-pressed') !== 'true';
        sw.setAttribute('aria-pressed', String(on));
        this.on.setting?.(sw.id, on);
        return;
      }
      if (e.target.closest('#wipe')) this.on.wipe?.();
    });

    E.drawer.addEventListener('input', e => {
      const r = e.target.closest('input[type=range]');
      if (!r) return;
      const out = $(`[data-for="${r.id}"]`, E.drawer);
      if (out) out.textContent = r.value + (r.id === 'set-every' ? '' : ' min');
      if (r.id === 'vol') { $('#vol-n').textContent = r.value; this.on.volume?.(r.value / 100); return; }
      this.on.setting?.(r.id, +r.value);
    });

    const stir = () => this.unhush();
    ['pointermove', 'pointerdown', 'wheel', 'touchstart'].forEach(ev =>
      window.addEventListener(ev, stir, { passive: true }));

    window.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      if (k === 'escape') { this.closeMuseum(); this.closeDrawer(); return; }   // even from a focused slider
      if (!$('#museum').hidden) {
        const hall = $('#hall');
        if (k === 'arrowright') { hall.scrollLeft += window.innerWidth * .6; return; }
        if (k === 'arrowleft') { hall.scrollLeft -= window.innerWidth * .6; return; }
        if (k === 'home') { hall.scrollLeft = 0; return; }
        if (k === 'end') { hall.scrollLeft = hall.scrollWidth; return; }
      }
      if (e.target.matches('input,textarea,select')) return;
      this.unhush();
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // space belongs to whatever button has focus, if any
      if (k === ' ' && e.target.closest('button')) return;
      if (k === ' ') { e.preventDefault(); this.on.toggle?.(); }
      else if (k === 's') this.on.skip?.();
      else if (k === 'r') this.on.reset?.();
      else if (k === 'n') this.on.nextArt?.();
      else if (k === 'm') this.on.toggleRadio?.();
      else if (k === '[') this.on.skipTrack?.(-1);
      else if (k === ']') this.on.skipTrack?.(1);
      else if (k === 'b') this.toggleDrawer('badges');
      else if (k === 'g') ($('#museum').hidden ? this.openMuseum() : this.closeMuseum());
      else if (k === 'p') this.toggleDrawer('playlists');
      else if (k === ',') this.toggleDrawer('settings');
      else if (k === '+' || k === '=') this.on.stretch?.(1);
      else if (k === '-' || k === '_') this.on.stretch?.(-1);
      else if (k === '?' || k === '/') this.openDrawer('settings');
    });
  }

  setRadioUI(radio) {
    const lvl = !radio.playing ? 0 : radio.volume < .4 ? 1 : 2;
    this.el.sound.dataset.level = String(lvl);
    this.el.sound.setAttribute('aria-pressed', String(radio.playing));
    const show = radio.playing && (radio.track || radio.station?.name);
    this.el.np.hidden = !show;
    if (show) this.el.npText.textContent = radio.track || radio.station.name;
    // you can move through your own records; you cannot move through a radio station
    const queued = show && radio.isQueue && radio.station.tracks.length > 1;
    this.el.npPrev.hidden = this.el.npNext.hidden = !queued;
  }

  setGrain(on) { this.el.grain.style.display = on ? '' : 'none'; }

  dismissIntro() {
    this.el.shell.dataset.intro = '0';
    this.el.intro.dataset.gone = '1';
    setTimeout(() => (this.el.intro.hidden = true), 1200);
  }
}
