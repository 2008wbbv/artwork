/* ============================================================
   Enough of artwork to open with no network at all: the shell is
   cached on install, and the last few pictures you were shown are
   kept as they go past, so a flight still gets a painting.
   ============================================================ */
const SHELL = 'artwork-shell-v3';
const PICTURES = 'artwork-pictures-v1';
const KEEP = 40;

const FILES = [
  './', './index.html', './css/app.css', './manifest.webmanifest', './assets/favicon.svg',
  './js/main.js', './js/painter.js', './js/gallery.js', './js/sources.js', './js/playlists.js',
  './js/timer.js', './js/radio.js', './js/badges.js', './js/ui.js', './js/sound.js',
  './js/store.js', './js/util.js', './js/artist.js', './js/museum.js', './js/keys.js', './js/notify.js',
  './js/tape.js',
];

const PICTURE_HOSTS = /artic\.edu|images\.metmuseum\.org|openaccess-cdn|framemark\.vam|iip\.smk|iip-thumb\.smk|upload\.wikimedia|commons\.wikimedia/;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== SHELL && k !== PICTURES).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

/** keep the picture cache from growing without end */
async function trim() {
  const c = await caches.open(PICTURES);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - KEEP; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // the app itself: from the cache, and freshened in the background
  if (url.origin === location.origin) {
    e.respondWith(caches.match(request).then(hit => {
      const live = fetch(request).then(r => {
        if (r.ok) caches.open(SHELL).then(c => c.put(request, r.clone()));
        return r;
      }).catch(() => hit);
      return hit || live;
    }));
    return;
  }

  // pictures: use the network, but keep a copy of the last few
  if (PICTURE_HOSTS.test(url.hostname)) {
    e.respondWith(fetch(request).then(r => {
      if (r.ok) caches.open(PICTURES).then(c => c.put(request, r.clone()).then(trim));
      return r;
    }).catch(() => caches.match(request)));
  }
  // everything else — museum APIs, radio, wikipedia — goes straight out
});
