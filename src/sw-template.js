/* Generated into dist/sw.js at build time. Offline app shell; content is network-first. */
const VERSION = __VERSION__;
const SHELL = __SHELL__;
const CACHE = 'shell-' + VERSION;
// Camera models: their paths carry the model version, so one cache serves every app version.
const MODELS = 'models-v1';
// MediaPipe's WebAssembly: its file names don't change between versions, so the cache is per version.
const WASM = 'mediapipe-' + __MP_VERSION__;

// A new version waits until the app asks for it (Home's "Update now"), so a deploy never swaps the
// files under a running session (audit task 15). The very first install activates at once as usual.
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

// Weak Wi-Fi: give the network 4 s, then use the cached copy.
const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => (k.startsWith('shell-') && k !== CACHE) || (k.startsWith('mediapipe-') && k !== WASM)).map((k) => caches.delete(k))))
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
      Promise.race([fetch(req), timeout(4000)])
        .then((res) => {
          // Only good answers are cached (an error page never replaces the content).
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || fetch(req))),
    );
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(Promise.race([fetch(req), timeout(4000)]).catch(() => caches.match('./').then((hit) => hit || fetch(req))));
    return;
  }

  // Camera models and MediaPipe's WebAssembly: kept in their own cache across app updates (their paths
  // carry the version), fetched once on first use, so analysis works offline (owner decision 2026-10-30).
  if (url.pathname.includes('/models/') || url.pathname.includes('/mediapipe/')) {
    event.respondWith(
      caches.open(url.pathname.includes('/models/') ? MODELS : WASM).then((c) =>
        c.match(req).then(
          (hit) =>
            hit ||
            fetch(req).then((res) => {
              if (res.ok) c.put(req, res.clone());
              return res;
            }),
        ),
      ),
    );
    return;
  }

  event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
