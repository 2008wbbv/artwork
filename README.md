# artwork

A pomodoro timer where the background is a painting from a museum collection —
and the painting **paints itself**, stroke by stroke, for exactly as long as the
interval lasts. Twenty-five minutes of focus is twenty-five minutes of
brushwork; the last details land as the clock reaches zero.

Everything runs in the browser. No server, no build step, no account, no
tracking. Open `index.html` from any static host and it works.

---

## What's in it

**The painting.** Each interval starts on a toned ground with a thin lay-in of
the composition, then builds in five passes — broad wash strokes off a heavily
blurred reduction of the picture, then progressively finer ones, each laid
*along* the local edge direction the way a brush actually moves, shortened where
the picture has detail. In the last few minutes a glaze of the real file brings
it into focus. The whole schedule is stretched across the interval, and it is
deterministic: resize the window, or swap the picture mid-session, and it
replays instantly to exactly where you were.

**Playlists.** Around thirty, grouped by *Curated* (The Ten, Blue Hour, Quiet
Rooms, Still Life, Gardens), *Movements* (Impressionism, the Dutch Golden Age,
Ukiyo-e, Baroque, Romanticism, Vienna 1900, American Light…), *Artists* (Monet,
Van Gogh, Hokusai & Hiroshige, Vermeer, Turner, Sargent, Degas, Cassatt…),
*Places* (Venice, Paris, Japan, The Sea, New York) and *Museums*. Each is a set
of queries across three collections, merged, de-duplicated and shuffled;
anything you've already been shown goes to the back of the queue.

**The wall label.** Title, hand, date, medium, where it is right now — down to
the gallery number when the museum publishes one — and a link straight to the
object page. Plus the museum's own note about the picture where there is one.

**Sound.** SomaFM's hand-programmed stations (Secret Agent, Ill Street Lounge,
Sonic Universe, Bossa Beyond, Beat Blender, The Trip, Groove Salad, Drone Zone…)
with what's playing right now, and a search across the Radio Browser community
index for anything else in the same mood. The radio ducks under the chime
between intervals.

**Badges.** Twenty-three, awarded only for pictures you actually sat through —
ten works by German painters (*Kunsthalle*), twenty pictures of Venice (*Acqua
Alta*), fifteen Japanese ones (*The Floating World*), five by a single hand
(*Deep Cut*), seven days running (*The Regular*), and so on.

**Quiet by default.** After a few still seconds the interface recedes to almost
nothing and leaves you with the clock and the picture; move the mouse and it
comes back. Text never fights the painting: the brightness under each cluster of
type is measured live and only the area beneath it is darkened.

## Keys

| | |
|---|---|
| `space` | start / pause |
| `s` | skip this interval |
| `r` | reset it |
| `n` | another painting |
| `m` | radio on / off |
| `p` `b` `,` | playlists · badges · settings |
| `esc` | close the panel |

## Running it

It's a static site — no dependencies, no bundler.

```bash
python3 -m http.server 8000     # or: npx http-server
open http://localhost:8000
```

ES modules need to be served over HTTP, so opening `index.html` straight off
the filesystem won't work. To publish: any static host will do; the included
GitHub Actions workflow deploys to GitHub Pages once Pages is set to *GitHub
Actions* in the repository settings.

## Where the pictures come from

| Collection | API | Terms |
|---|---|---|
| [Art Institute of Chicago](https://api.artic.edu/docs/) | `api.artic.edu` | public-domain works only, CC0 metadata |
| [The Metropolitan Museum of Art](https://metmuseum.github.io/) | `collectionapi.metmuseum.org` | `isPublicDomain` works only |
| [Cleveland Museum of Art](https://openaccess-api.clevelandart.org/) | `openaccess-api.clevelandart.org` | CC0 works only |

Sound comes from [SomaFM](https://somafm.com) — listener-supported and
advert-free; if you leave it on all day, [chip
in](https://somafm.com/support/) — and the [Radio
Browser](https://www.radio-browser.info/) index.

No keys, no accounts, no proxy: every request goes straight from your browser
to the museum. All three send permissive CORS headers.

## Typography

The WeWork wordmark is set in **Apercu** (Colophon Foundry), which is licensed
and can't ship in an open repo. The interface uses **Plus Jakarta Sans**, the
closest freely-licensed relative — geometric grotesque, tall x-height, quiet
personality — with **Instrument Serif** italic for titles, the way a wall label
would set them. If you license Apercu, put it first in `--sans` at the top of
`css/app.css` and everything follows.

## Layout

```
index.html          markup only; everything else is injected
css/app.css         one stylesheet, sectioned
js/main.js          wiring
  painter.js        the stroke engine
  gallery.js        viewing order, image loading, caching
  sources.js        the three museum adapters, normalised to one shape
  playlists.js      the catalogue
  timer.js          wall-clock pomodoro state machine
  radio.js          stations, streaming, now-playing
  badges.js         the ledger
  ui.js             panels, labels, toasts, keys
  sound.js          the chimes, synthesised
  store.js          localStorage with a TTL cache
  util.js           small shared helpers
```

Your settings, badges and statistics live in `localStorage` under `artwork.v1.*`
and nowhere else. *Settings → Forget everything* clears the lot.

## Notes

- Museum responses are cached for the best part of a day, so re-opening a
  playlist is instant and the APIs aren't hammered.
- If a museum can't be reached, the timer carries on and paints a quiet
  abstraction instead; pictures return by themselves when the network does.
- The picture starts from the museum's web-sized file, and quietly upgrades to
  the press-quality one mid-interval when the connection looks willing — never
  on a metered or slow one.
- `prefers-reduced-motion` drops the finest stroke pass and the cross-dissolve.
