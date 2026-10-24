/* Generated into dist/sw.js at build time. Offline app shell; content is network-first. */
const VERSION = __VERSION__;
const SHELL = __SHELL__;
const CACHE = 'shell-' + VERSION;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Only this site's own files are cached. YouTube and anything else go straight to the network.
  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith('/content/programme.json')) {
    // Network first so content edits arrive on reload; cached copy when offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req)),
    );
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('./')));
    return;
  }

  event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
