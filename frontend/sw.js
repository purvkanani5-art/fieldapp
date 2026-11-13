/* Kshetralekha service worker: the app shell is cached so the app opens with no signal; API calls always go
   to the network (the app's own outbox handles offline submissions). Bump CACHE_VERSION on every deploy. */
const CACHE_VERSION = 'kl-v3';
const SHELL = ['./', './index.html', './styles.css', './core.js', './views-field.js', './views-me.js', './views-staff.js', './views-planner.js', './app.js', './manifest.webmanifest', './icon.svg', './logo.png',
  './icon-192.png', './apple-touch-icon.png', './fonts/bricolage.woff2', './fonts/jakarta.woff2'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_VERSION).then((c) => Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.includes('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('./index.html'))),
  );
});
