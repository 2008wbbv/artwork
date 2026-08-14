/* ============================================================
   The tape — an experiment.

   Instead of a painting, run a build timelapse behind the clock
   and make it last exactly as long as you do. A YouTube video of
   somebody laying blocks for two hours, compressed into your
   twenty-five minutes, so the thing finishes as your interval
   finishes.

   YouTube's player only offers rates up to 2×, which is nowhere
   near enough for a two-hour build, so the rate does the fine
   work and the playhead is walked forward to keep the video on
   the same clock as the timer. Muted throughout — whatever you
   are listening to is none of the tape's business.
   ============================================================ */
import { load, save } from './store.js';

const API = 'https://www.youtube.com/iframe_api';
const DRIFT = 1.2;          // seconds out of step before the playhead is moved
const CHECK = 1500;         // how often to look — often enough that the jumps stay small

/** the eleven-character id out of whatever was pasted */
export function videoId(input) {
  const t = String(input || '').trim();
  if (/^[\w-]{11}$/.test(t)) return t;
  const m = t.match(/(?:v=|\/embed\/|\/shorts\/|youtu\.be\/|\/live\/)([\w-]{11})/);
  return m ? m[1] : '';
}

export const remembered = () => load('tape', null);
export const remember = tape => save('tape', tape);
export const forget = () => save('tape', null);

let apiReady = null;
/** the IFrame API loads itself into the page and calls a global when it's up */
function ready() {
  if (apiReady) return apiReady;
  apiReady = new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
    const s = document.createElement('script');
    s.src = API;
    s.onerror = () => reject(new Error('YouTube could not be reached'));
    document.head.append(s);
    setTimeout(() => reject(new Error('YouTube did not answer')), 12000);
  });
  return apiReady;
}

export class Tape {
  constructor(host) {
    this.host = host;                 // the element the iframe replaces
    this.player = null;
    this.id = '';
    this.length = 0;                  // seconds of video
    this.live = false;                // showing, as opposed to merely loaded
    this.onerror = () => {};
    this.onready = () => {};
    this._poll = null;
    this._want = 0;                   // where the video should be, in seconds
  }

  /** put a video behind the clock; resolves once its length is known */
  async load(id) {
    const clean = videoId(id);
    if (!clean) throw new Error('that is not a YouTube link');
    await ready();
    if (this.player && this.id === clean) return this.length;
    this.id = clean;
    if (this.player) { this.player.destroy(); this.player = null; }
    const slot = document.createElement('div');
    slot.className = 'tape__frame';
    this.host.replaceChildren(slot);
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = why => { if (!settled) { settled = true; reject(new Error(why)); } };
      this.player = new YT.Player(slot, {
        videoId: clean,
        playerVars: {
          autoplay: 1, mute: 1, controls: 0, disablekb: 1, fs: 0,
          modestbranding: 1, playsinline: 1, rel: 0, iv_load_policy: 3,
        },
        events: {
          onReady: e => {
            e.target.mute();
            this.length = e.target.getDuration() || 0;
            settled = true;
            this.onready(this);
            resolve(this.length);
          },
          onError: e => {
            const why = { 2: 'that video id looks wrong', 5: 'that video will not play here',
              100: 'that video is gone', 101: 'the owner does not allow it off YouTube',
              150: 'the owner does not allow it off YouTube' }[e.data] || 'that video will not play';
            fail(why);
            this.onerror(new Error(why));
          },
        },
      });
      setTimeout(() => fail('that video took too long'), 14000);
    });
  }

  /** show it and start walking it in step with the interval */
  begin(getProgress, getRemainingMs) {
    if (!this.player) return;
    this.live = true;
    this.host.dataset.on = '1';
    this.player.mute();
    this.player.playVideo();
    clearInterval(this._poll);
    const step = () => {
      if (!this.live || !this.player?.getDuration) return;
      const total = this.length || this.player.getDuration() || 0;
      if (!total) return;
      const p = Math.max(0, Math.min(1, getProgress()));
      this._want = p * total;
      // how fast the rest of the tape has to run to land on the same second as the clock
      const leftV = Math.max(0, total - this._want);
      const leftT = Math.max(1, getRemainingMs() / 1000);
      this._rate(leftV / leftT);
      const at = this.player.getCurrentTime?.() || 0;
      if (Math.abs(at - this._want) > DRIFT) this.player.seekTo(this._want, true);
    };
    step();
    this._poll = setInterval(step, CHECK);
  }

  /** the fastest rate the player offers that isn't faster than we need */
  _rate(want) {
    const rates = [...(this.player.getAvailablePlaybackRates?.() || [1])].sort((a, b) => a - b);
    let best = rates[0];
    for (const r of rates) if (r <= want) best = r;
    if (this._at !== best) { this._at = best; this.player.setPlaybackRate(best); }
  }

  pause() { this.live && this.player?.pauseVideo?.(); clearInterval(this._poll); this._poll = null; }

  resume(getProgress, getRemainingMs) { if (this.live) this.begin(getProgress, getRemainingMs); }

  /** back to the paintings */
  hide() {
    this.live = false;
    clearInterval(this._poll); this._poll = null;
    this.host.dataset.on = '0';
    this.player?.pauseVideo?.();
  }

  destroy() {
    this.hide();
    this.player?.destroy?.();
    this.player = null;
    this.id = '';
    this.length = 0;
    this.host.replaceChildren();
  }
}
