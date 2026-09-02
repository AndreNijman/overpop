/* OVERPOP — service worker.

   The precache list is *derived from index.html at install time* rather than
   hand-maintained. With ~50 classic script tags a hand-written list is a
   guaranteed drift bug: someone adds a file, forgets the SW, and the game half
   works offline in a way that only shows up on a cold cache.

   ---------------------------------------------------------------------------
   WHY THE VERSION LINE BELOW MATTERS MORE THAN ANYTHING ELSE IN THIS FILE

   A service worker is only re-installed when the BYTES OF sw.js CHANGE. This file
   used to carry a hardcoded `overpop-v1`, so shipping new game code changed
   nothing here — the already-installed worker kept serving the old JS out of its
   cache indefinitely, and the only way a returning player saw an update was to
   hard-refresh or clear site data. That is a caching bug that hides the entire
   deploy, and it is exactly what was reported.

   So VERSION is stamped by `node tools/stamp.mjs` from a hash of every file that
   gets precached. Change a shipped file and this line changes with it; the browser
   then sees a byte-different sw.js, installs, and takes over.

   It is not a step anyone has to remember: tools/suites/sw.mjs FAILS when the
   stamp does not match the files on disk, so a stale stamp cannot reach a deploy.

   Never hand-edit the line below.
   ---------------------------------------------------------------------------

   Cache policy is CACHE-FIRST WITHIN ONE VERSION, which matters for a game loaded
   as ~50 separate classic scripts: serving some files from a new deploy and some
   from an old one would produce a subtly broken game that no error message
   explains. Each version gets its own cache, filled completely before it is used,
   and the previous one is deleted only once the new worker is in charge — so a
   session only ever sees one build. */

'use strict';

const VERSION = '90597d95ef1c';
const CACHE_NAME = 'overpop-' + VERSION;

// Everything index.html can't tell us about.
const EXTRA = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

async function buildPrecacheList() {
  const urls = new Set(EXTRA);
  try {
    const res = await fetch('./index.html', { cache: 'reload' });
    const html = await res.text();
    const re = /<script[^>]+src=["']([^"']+)["']/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      const src = m[1];
      if (!/^https?:|^\/\//i.test(src)) urls.add(src.startsWith('./') ? src : './' + src);
    }
  } catch (e) {
    // If index.html is unreachable we still install with EXTRA; the fetch
    // handler will populate the rest lazily on first online play.
  }
  return [...urls];
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const list = await buildPrecacheList();
    // `cache: 'reload'` so the precache comes from the network rather than the
    // HTTP cache — otherwise a new version could be filled with old bytes.
    // Individually, so one 404 can't reject the whole install.
    await Promise.all(list.map(url =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
    ));
    // Take over as soon as this version is fully cached. Paired with the page
    // reloading itself on `controllerchange`, that is what makes an update apply
    // without the player clearing anything.
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Every other version goes, including any left by an interrupted install.
    const names = await caches.keys();
    await Promise.all(names
      .filter(n => n.startsWith('overpop-') && n !== CACHE_NAME)
      .map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  /* sw.js is never served from the cache. A cached worker script cannot notice
     that it is out of date — that is the deadlock this whole file guards against. */
  if (url.pathname.endsWith('/sw.js')) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);

    /* Navigations are NETWORK-FIRST with the cache as the offline fallback. The
       document is what pulls in every script, so fetching it fresh is what lets a
       new deploy be noticed even on a browser that has not re-checked the worker.
       Everything else stays cache-first, because a half-new bundle is worse than
       a wholly old one. */
    if (req.mode === 'navigate') {
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        if (fresh && fresh.ok) {
          cache.put(req, fresh.clone()).catch(() => {});
          return fresh;
        }
      } catch (e) { /* offline — fall through to the cache */ }
      const cachedDoc = await cache.match(req, { ignoreSearch: true }) ||
        await cache.match('./index.html');
      if (cachedDoc) return cachedDoc;
      return fetch(req);
    }

    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;

    const res = await fetch(req);
    if (res && res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
    return res;
  })());
});

self.addEventListener('message', event => {
  const data = event.data;
  if (data === 'skipWaiting') { self.skipWaiting(); return; }
  if (data === 'version' && event.source) event.source.postMessage({ opVersion: VERSION });
});
