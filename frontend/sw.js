/* Kshetralekha service worker: the app shell is cached so the app opens with no signal; API calls always go
   to the network (the app's own outbox handles offline submissions). Bump CACHE_VERSION on every deploy. */
const CACHE_VERSION = 'kl-v11';
const PYODIDE_CACHE = 'kl-pyodide-314.0.7'; // the Python runtime from the CDN, kept across app versions
const SHELL = ['./', './index.html', './styles.css', './core.js', './views-field.js', './views-me.js', './views-staff.js', './views-planner.js', './views-modules.js', './views-sites.js', './views-hrops.js', './views-home.js', './views-fieldapp.js', './app.js', './manifest.webmanifest', './icon.svg', './logo.png',
  './icon-192.png', './apple-touch-icon.png', './fonts/plex-sans-latin.woff2', './fonts/plex-sans-latin-ext.woff2', './fonts/noto-sans-gujarati.woff2', './fonts/noto-sans-devanagari.woff2', './local/pyhost.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_VERSION).then((c) => Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION && k !== PYODIDE_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.includes('/api/')) return;
  if (url.hostname === 'cdn.jsdelivr.net') { // the versioned Python runtime never changes: cache first
    e.respondWith(caches.open(PYODIDE_CACHE).then((c) => c.match(e.request).then((hit) => hit || fetch(e.request).then((res) => { if (res.ok) c.put(e.request, res.clone()); return res; }))));
    return;
  }
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
