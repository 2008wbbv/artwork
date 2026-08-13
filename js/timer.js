/* ============================================================
   The clock. Wall-clock driven, so a throttled background tab
   or a sleeping laptop can't make it drift.
   ============================================================ */

export const PHASES = {
  focus: { id: 'focus', label: 'Focus' },
  short: { id: 'short', label: 'Pause' },
  long:  { id: 'long',  label: 'Long pause' },
};

export class Timer {
  constructor(settings) {
    this.s = settings;                 // live reference; edits apply to the next interval
    this.phase = 'focus';
    this.state = 'idle';               // idle · running · paused
    this.round = 0;                    // completed focus intervals in this set
    this.left = this.lengthOf('focus');
    this.endAt = 0;
    this.startedAt = 0;
    this.onphase = () => {};
    this.oncomplete = () => {};
    this.onstate = () => {};
  }

  lengthOf(phase) {
    const m = phase === 'focus' ? this.s.focusMin : phase === 'short' ? this.s.shortMin : this.s.longMin;
    return Math.max(1, m) * 60000;
  }

  get duration() { return this.lengthOf(this.phase); }
  get progress() { return 1 - this.left / this.duration; }
  get label() { return PHASES[this.phase].label; }

  start() {
    if (this.state === 'running') return;
    if (this.state === 'idle') this.startedAt = Date.now();
    this.endAt = Date.now() + this.left;
    this.state = 'running';
    this.onstate(this);
  }

  pause() {
    if (this.state !== 'running') return;
    this.left = Math.max(0, this.endAt - Date.now());
    this.state = 'paused';
    this.onstate(this);
  }

  toggle() { this.state === 'running' ? this.pause() : this.start(); }

  /** back to the top of the current interval, same picture */
  reset() {
    this.left = this.duration;
    this.state = 'idle';
    this.onstate(this);
  }

  /** move on without finishing — no credit, no badge */
  skip() { this._advance(false); }

  /** call once per frame */
  update() {
    if (this.state !== 'running') return false;
    const left = Math.max(0, this.endAt - Date.now());
    const changed = Math.ceil(left / 1000) !== Math.ceil(this.left / 1000);
    this.left = left;
    if (left <= 0) { this._advance(true); return true; }
    return changed;
  }

  _advance(completed) {
    const done = this.phase;
    const mins = this.duration / 60000;
    if (completed && done === 'focus') this.round++;
    const wasLong = done === 'focus' && this.round > 0 && this.round % Math.max(1, this.s.longEvery) === 0;
    const next = done === 'focus' ? (wasLong ? 'long' : 'short') : 'focus';
    if (next === 'focus' && done === 'long') this.round = 0;

    if (completed) this.oncomplete({ phase: done, minutes: mins, next });

    this.phase = next;
    this.left = this.duration;
    this.startedAt = Date.now();
    const auto = next === 'focus' ? this.s.autoFocus : this.s.autoBreak;
    this.state = completed && auto ? 'running' : 'idle';
    if (this.state === 'running') this.endAt = Date.now() + this.left;
    this.onphase({ phase: next, from: done, completed });
    this.onstate(this);
  }
}
