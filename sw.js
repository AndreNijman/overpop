/* OVERPOP — service worker.

   The precache list is *derived from index.html at install time* rather than
   hand-maintained. With ~50 classic script tags a hand-written list is a
   guaranteed drift bug: someone adds a file, forgets the SW, and the game half
   works offline in a way that only shows up on a cold cache.

   Cache-first, network-fallback, with successful same-origin responses stashed.
   Bump CACHE_NAME on any breaking change to force a clean re-precache. */

'use strict';

const CACHE_NAME = 'overpop-v1';

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
    // Individually, so one 404 can't reject the whole install.
    await Promise.all(list.map(url =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
    ));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;

    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (e) {
      // Navigation offline with nothing cached for this exact URL: fall back to
      // the shell so the game still boots.
      if (req.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      throw e;
    }
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
