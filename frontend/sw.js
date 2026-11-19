/* Kshetralekha service worker: the app shell is cached so the app opens with no signal; API calls always go
   to the network (the app's own outbox handles offline submissions). Bump CACHE_VERSION on every deploy. */
const CACHE_VERSION = 'kl-v27';
const PYODIDE_CACHE = 'kl-pyodide-314.0.7'; // the Python runtime from the CDN, kept across app versions
const SHELL = ['./', './index.html', './styles.css', './i18n.js', './i18n.gu.js', './i18n.hi.js', './core.js', './views-field.js', './views-me.js', './views-staff.js', './views-planner.js', './views-modules.js', './views-sites.js', './views-hrops.js', './views-home.js', './views-fieldapp.js', './views-lists.js', './views-forms.js', './views-hub.js', './views-cases.js', './views-policies.js', './views-perms.js', './app.js', './manifest.webmanifest', './icon.svg', './logo.png',
  './icon-192.png', './icon-512.png', './icon-maskable-192.png', './icon-maskable-512.png', './favicon.ico', './logo-h.svg', './logo-h-dark.svg', './logo-stacked.svg', './logo-stacked-dark.svg', './apple-touch-icon.png', './fonts/jakarta-latin.woff2', './fonts/jakarta-latin-ext.woff2', './fonts/noto-sans-gujarati.woff2', './fonts/noto-sans-devanagari.woff2', './local/pyhost.js'];

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
  if (url.origin !== self.location.origin) return; // map library and tiles: the browser handles them (a failed script must fail, not become the app page)
  // Network first for fresh app files, but: only good replies are cached (a 502 during a deploy must not replace
  // core.js), and on weak "connected but stalled" signal the cached copy is used after 4 s instead of a long wait.
  e.respondWith(new Promise((resolve) => {
    let done = false;
    const give = (r) => { if (!done && r) { done = true; resolve(r); } };
    const cached = () => caches.match(e.request).then((hit) => hit || (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined)); // only a page falls back to the app
    const slow = setTimeout(() => caches.match(e.request).then(give), 4000);
    fetch(e.request)
      .then((res) => {
        clearTimeout(slow);
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(e.request, copy)).catch(() => {});
          give(res);
        } else caches.match(e.request).then((hit) => give(hit || res));
      })
      .catch(() => { clearTimeout(slow); cached().then((r) => give(r || Response.error())); });
  }));
});
