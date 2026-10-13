// Service worker: enough to be installable, and careful about what it touches.
//
// A PWA needs a fetch handler before a browser will offer "add to home screen".
// That is the reason this file exists — but a payment app caching the wrong
// thing is worse than no cache at all, so almost everything is passed straight
// through to the network.
//
// What is deliberately NOT cached:
//
//   * anything cross-origin — the indexer and the proof server are the chain's
//     view of the world, and a stale answer about whether an invoice settled is
//     a wrong answer, not a fast one;
//   * /keys/ and /zkir/ — roughly 233 MB of proving material, which would fill
//     a phone's storage quota and evict everything else in the process;
//   * anything that is not a GET.
//
// What is cached is the shell: the document and its static assets, so the app
// opens on a bad connection and then tells the user the chain is unreachable —
// which is a better failure than a blank tab.

const VERSION = 'mask-shell-v1';
const SHELL = ['/', '/index.html', '/favicon.svg', '/manifest.webmanifest', '/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      // Individually, and tolerantly: one missing file must not fail the whole
      // install and leave the app without a worker at all.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Is this something we are willing to keep a copy of? */
function cacheable(request) {
  if (request.method !== 'GET') return false;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith('/keys/') || url.pathname.startsWith('/zkir/')) return false;
  if (url.pathname.startsWith('/api/')) return false;
  return true;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (!cacheable(request)) return; // straight to the network, untouched

  // Navigations: network first, so a running devnet always wins, with the
  // cached shell as the fallback when there is no network at all.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(VERSION).then((c) => c.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html').then((r) => r ?? Response.error())),
    );
    return;
  }

  // Static assets: cache first, then fill the cache behind the request.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            void caches.open(VERSION).then((c) => c.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
