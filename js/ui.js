/* ============================================================
   Everything you can see and press.
   ============================================================ */
import { $, $$, escapeHtml, fmtDuration, reducedMotion } from './util.js';
import { PLAYLISTS, GROUPS } from './playlists.js';
import { STATIONS, DISCOVER_TAGS, discover } from './radio.js';
import { BADGES } from './badges.js';

const HUSH_AFTER = 6200;

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
      meta: $('#label-meta'), note: $('#label-note'), link: $('#label-link'),
      museum: $('#label-museum'), chip: $('#playlist-chip'), chipName: $('#playlist-name'),
      chipGroup: $('#playlist-group'), drawer: $('#drawer'), scrim: $('#scrim'),
      toasts: $('#toasts'), intro: $('#intro'), np: $('#nowplaying'), npText: $('#np-text'),
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
    this.el.rail.style.width = (p * 100).toFixed(2) + '%';
    this.el.railBox.setAttribute('aria-valuenow', Math.round(p * 100));
  }

  setState(timer) {
    this.el.shell.dataset.state = timer.state;
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
    this.el.chipGroup.textContent = count ? `${pl.group} · ${count}` : pl.group;
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
    this.el.shell.dataset.recede = '0';
    this.armHush();
  }

  _drawerOpen() { return this.el.drawer.dataset.open === '1'; }

  /* ----------------------------------------------- drawer */
  openDrawer(tab) {
    const d = this.el.drawer;
    d.hidden = false; this.el.scrim.hidden = false;
    requestAnimationFrame(() => { d.dataset.open = '1'; this.el.scrim.dataset.open = '1'; });
    if (tab) this.showTab(tab);
    this.unhush();
  }

  closeDrawer() {
    const d = this.el.drawer;
    d.dataset.open = '0'; this.el.scrim.dataset.open = '0';
    setTimeout(() => { d.hidden = true; this.el.scrim.hidden = true; }, 520);
    this.armHush();
  }

  toggleDrawer(tab) {
    if (this._drawerOpen() && $(`.tabs button.is-on`)?.dataset.tab === tab) this.closeDrawer();
    else this.openDrawer(tab);
  }

  showTab(tab) {
    $$('.tabs button').forEach(b => b.classList.toggle('is-on', b.dataset.tab === tab));
    $$('.panel').forEach(p => (p.hidden = p.dataset.panel !== tab));
    if (tab === 'badges') this.renderBadges();
    if (tab === 'settings') this.renderSettings();
    if (tab === 'sound') this.renderSound();
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
      const rows = PLAYLISTS.filter(p => p.group === g).map(p => `
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
      ${groups.map(g => `<section class="sect"><h3 class="sect__head">${escapeHtml(g)}</h3>${rows(STATIONS.filter(s => s.g === g))}</section>`).join('')}
      <section class="sect">
        <h3 class="sect__head">Elsewhere</h3>
        <p class="sect__note">Search the community radio index for something else in this mood.</p>
        <div class="seg" id="tags">${DISCOVER_TAGS.map(t => `<button data-tag="${escapeHtml(t.tag)}">${escapeHtml(t.label)}</button>`).join('')}</div>
        <div id="discovered"></div>
      </section>
      <p class="sect__note">Curated stations come from SomaFM — listener-supported, no adverts. If you leave it on all day, consider chipping in at somafm.com/support.</p>`;
  }

  renderDiscovered(list, tag) {
    const box = $('#discovered');
    if (!box) return;
    box.innerHTML = list.length ? list.map(s => `
      <button class="row ${s.id === this.s.stationId ? 'is-on' : ''}" data-station="${escapeHtml(s.id)}" data-adhoc='${escapeHtml(JSON.stringify(s))}'>
        <i class="row__dot"></i>
        <span class="row__text">
          <span class="row__name">${escapeHtml(s.name)}</span>
          <span class="row__note">${escapeHtml(s.note)}</span>
        </span>
      </button>`).join('')
      : `<p class="sect__note">Nothing answered for “${escapeHtml(tag)}”. Try another.</p>`;
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
        ${sw('set-recede', 'Let the interface recede', 'After a few still seconds, everything but the clock fades.', s.recede)}
        ${sw('set-label', 'Show the wall label', '', s.labelOn)}
        ${sw('set-grain', 'Film grain', '', s.grain)}
      </section>
      <section class="sect">
        <h3 class="sect__head">Sources</h3>
        <p class="sect__note">Pictures: the Art Institute of Chicago, the Metropolitan Museum of Art, and the Cleveland Museum of Art, through their open APIs — public-domain and CC0 works only. Sound: SomaFM and the Radio Browser index. Nothing you do here leaves your browser.</p>
        <button class="row" id="wipe"><i class="row__dot"></i><span class="row__text">
          <span class="row__name">Forget everything</span>
          <span class="row__note">Clears badges, statistics, cached pictures and settings.</span></span></button>
      </section>`;
  }

  /* ------------------------------------------------ wiring */
  _wire() {
    const E = this.el;
    E.start.onclick = () => this.on.toggle?.();
    E.skip.onclick = () => this.on.skip?.();
    E.reset.onclick = () => this.on.reset?.();
    E.chip.onclick = () => this.toggleDrawer('playlists');
    $('#btn-badges').onclick = () => this.toggleDrawer('badges');
    $('#btn-settings').onclick = () => this.toggleDrawer('settings');
    $('#btn-next-art').onclick = e => {
      e.currentTarget.classList.remove('ico--spin');
      void e.currentTarget.offsetWidth;
      e.currentTarget.classList.add('ico--spin');
      this.on.nextArt?.();
    };
    E.sound.onclick = e => (e.shiftKey ? this.toggleDrawer('sound') : this.on.toggleRadio?.());
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
      const st = e.target.closest('[data-station]');
      if (st) {
        const adhoc = st.dataset.adhoc ? JSON.parse(st.dataset.adhoc) : null;
        this.on.station?.(st.dataset.station, adhoc);
        $$('[data-station]', E.drawer).forEach(r => r.classList.toggle('is-on', r === st));
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
      if (e.target.matches('input,textarea')) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') { this.closeDrawer(); return; }
      this.unhush();
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (k === ' ') { e.preventDefault(); this.on.toggle?.(); }
      else if (k === 's') this.on.skip?.();
      else if (k === 'r') this.on.reset?.();
      else if (k === 'n') this.on.nextArt?.();
      else if (k === 'm') this.on.toggleRadio?.();
      else if (k === 'b') this.toggleDrawer('badges');
      else if (k === 'p') this.toggleDrawer('playlists');
      else if (k === ',') this.toggleDrawer('settings');
      else if (k === '?') this.toast({ kicker: 'Keys', name: 'space · s · r · n · m · b · p · ,', seal: '⌘', ms: 6000 });
    });
  }

  setRadioUI(radio) {
    const lvl = !radio.playing ? 0 : radio.volume < .4 ? 1 : 2;
    this.el.sound.dataset.level = String(lvl);
    this.el.sound.setAttribute('aria-pressed', String(radio.playing));
    const show = radio.playing && (radio.track || radio.station?.name);
    this.el.np.hidden = !show;
    if (show) this.el.npText.textContent = radio.track || radio.station.name;
  }

  setGrain(on) { this.el.grain.style.display = on ? '' : 'none'; }

  dismissIntro() {
    this.el.intro.dataset.gone = '1';
    setTimeout(() => (this.el.intro.hidden = true), 1200);
  }
}
