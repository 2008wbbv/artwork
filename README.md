<div align="center">

# artwork

**A pomodoro timer whose background is a museum painting — and the painting paints itself, stroke by stroke, for exactly as long as you work.**

[![license](https://img.shields.io/badge/license-MIT-c9a227?style=flat-square)](LICENSE)
[![no build step](https://img.shields.io/badge/build_step-none-c9a227?style=flat-square)](#run-it)
![dependencies](https://img.shields.io/badge/dependencies-0-c9a227?style=flat-square)
[![runs](https://img.shields.io/badge/runs-entirely_client--side-c9a227?style=flat-square)](#notes)

<img src="docs/hero.jpg" alt="artwork running: a Turner painting of Venice, rendered in brushstrokes, with a 0:00 clock over it" width="100%">

</div>

Twenty-five minutes of focus is twenty-five minutes of brushwork. It starts on a bare toned canvas — the picture is never underneath, waiting to be uncovered. Every mark is a brush stroke that you watch being made: it travels along its path in real time, curving with the local image gradient the way a loaded brush does, tapering at both ends, dragging a few bristles of slightly different paint behind it. Five passes, broad blunt bands down to fine points on the edges, and the last of them lands exactly as the clock reaches zero. Around fourteen thousand strokes, one at a time.

<img src="docs/stages.jpg" alt="the same painting at four stages of completion" width="100%">

<sup>One interval, four moments: 6% · 30% · 62% · done. J. M. W. Turner, *Venice, from the Porch of Madonna della Salute*, ca. 1835 — The Met, gallery 808.</sup>

## Run it

Static files, no bundler, no dependencies. It just needs to be served over HTTP, because ES modules are.

```bash
git clone https://github.com/2008wbbv/artwork
cd artwork
python3 -m http.server 8000    # or: npx http-server
```

Then open `http://localhost:8000`. To publish, drop it on any static host — the included Actions workflow deploys to GitHub Pages once *Settings → Pages* is set to **GitHub Actions**.

## What's in it

- **33 playlists** by movement, artist, place, museum and curator's pick — Impressionism, the Dutch Golden Age, Ukiyo-e, Vienna 1900, Monet, Hokusai, Vermeer, Venice, Paris, The Sea, The North.
- **A wall label** for every picture: title, hand, date, medium, the museum's own note, and the gallery it's hanging in right now. Hover it for the credit line.
- **The hand behind it.** Click the artist and you get a short life off Wikipedia — with their portrait, often a self-portrait, in a gilt frame — and everything else of theirs across the five collections. Click any of those and it goes up on the wall.
- **Radio**, from SomaFM and the Radio Browser index, with what's playing right now. Ducks under the chime between intervals.
- **23 badges**, awarded only for pictures you actually sat through — ten German painters, twenty Venices, five works by one hand, seven days running.
- **Two ways to look.** *Fill* bleeds the picture off every edge; *Hang* fits the whole thing on a lit wall, which portrait paintings prefer.

  <img src="docs/fit-fill.jpg" alt="a portrait painting filling the screen, heavily cropped" width="49%"> <img src="docs/fit-hang.jpg" alt="the same painting hung whole on a wall" width="49%">

  <sup>Van Gogh's *Madame Roulin and Her Baby*, filling the screen and hung on the wall.</sup>

- **An interface that gets out of the way.** The clock sits in the middle of the screen until you start; then it steps aside into the corner and leaves the wall to the picture. Hold still for six seconds and everything except the clock fades to nothing — move the mouse and it comes back. The brightness under each cluster of type is measured live, and only that patch of picture is darkened, so the text never fights the painting.

<img src="docs/playlists.jpg" alt="the playlist drawer" width="49%"> <img src="docs/badges.jpg" alt="the badge shelf" width="49%">

## Pictures

Five open collections. No keys, no accounts, no proxy — every request goes straight from your browser to the museum, and all five send permissive CORS headers.

| Collection | Endpoint | Filter |
|---|---|---|
| [Art Institute of Chicago](https://api.artic.edu/docs/) | `api.artic.edu` | public domain only |
| [The Metropolitan Museum of Art](https://metmuseum.github.io/) | `collectionapi.metmuseum.org` | `isPublicDomain` only |
| [Cleveland Museum of Art](https://openaccess-api.clevelandart.org/) | `openaccess-api.clevelandart.org` | CC0 only |
| [Victoria and Albert Museum](https://developers.vam.ac.uk/) | `api.vam.ac.uk` | made before 1920 |
| [SMK — National Gallery of Denmark](https://www.smk.dk/en/article/smk-api/) | `api.smk.dk` | `public_domain` only |

Artist lives and portraits come from the [Wikipedia REST API](https://en.wikipedia.org/api/rest_v1/).

Responses are cached for the best part of a day. Pictures start from the museum's web-sized file and quietly upgrade to the press-quality one mid-interval when the connection looks willing — never on a metered or slow one.

## Keys

| | |
|---|---|
| <kbd>space</kbd> | start · pause |
| <kbd>s</kbd> <kbd>r</kbd> | skip the interval · reset it |
| <kbd>+</kbd> <kbd>−</kbd> | five minutes more or less — the brush keeps pace |
| <kbd>n</kbd> | another painting |
| <kbd>m</kbd> | radio on · off |
| <kbd>p</kbd> <kbd>b</kbd> <kbd>,</kbd> | playlists · badges · settings |

## Notes

- Nothing leaves the browser. Settings, badges and statistics live in `localStorage` under `artwork.v1.*`; *Settings → Forget everything* clears the lot.
- The stroke plan is seeded and deterministic, so resizing the window — or swapping the picture mid-interval — replays instantly to exactly the same level of completion.
- Offline, the timer carries on and paints a quiet abstraction instead. Pictures come back by themselves when the network does.
- `prefers-reduced-motion` drops the finest stroke pass and the dissolve between pictures.

```
js/painter.js      the stroke engine
js/gallery.js      viewing order, image loading, caching
js/sources.js      five museum adapters, normalised to one shape
js/artist.js       who painted it, and what else of theirs is hanging
js/playlists.js    the catalogue
js/timer.js        wall-clock pomodoro state machine
js/radio.js        stations, streaming, now-playing
js/badges.js       the ledger
js/ui.js           panels, labels, toasts, keys
```

## Credits

- The five museums above, for putting their collections in the public domain and then publishing an API for them.
- [Wikipedia](https://en.wikipedia.org), for the lives.
- [SomaFM](https://somafm.com) — listener-supported, advert-free, hand-programmed. If you leave it on all day, [chip in](https://somafm.com/support/).
- [Radio Browser](https://www.radio-browser.info/), a community index of everything else.
- Type is [Plus Jakarta Sans](https://fonts.google.com/specimen/Plus+Jakarta+Sans) and [Instrument Serif](https://fonts.google.com/specimen/Instrument+Serif). The WeWork wordmark is Apercu, which is licensed and can't ship here — Plus Jakarta is the closest free relative. If you own Apercu, put it first in `--sans` at the top of `css/app.css` and everything follows.

## License

MIT. The code is yours to do as you like with. The paintings were already everyone's.
