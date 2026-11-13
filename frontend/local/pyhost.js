/* GitHub Pages build: no server, so /api requests go to the backend running on this phone (local/pyworker.js).
   Active on *.github.io or with ?local=1; otherwise this file does nothing and the app talks to its server. */
(() => {
  const on = location.hostname.endsWith('github.io') || new URLSearchParams(location.search).has('local');
  if (!on) return;
  window.KL_LOCAL = true;

  const worker = new Worker(new URL('./local/pyworker.js', document.baseURI), { type: 'module' });
  const pending = new Map();
  let seq = 0;
  let markReady;
  let markFailed;
  const ready = new Promise((resolve, reject) => { markReady = resolve; markFailed = reject; });
  ready.catch(() => {});
  const t0 = performance.now();

  function note(text) {
    const box = document.getElementById('splash');
    if (!box) return;
    let p = box.querySelector('.boot-note');
    if (!p) {
      p = document.createElement('p');
      p.className = 'boot-note';
      box.querySelector('.in').appendChild(p);
    }
    p.textContent = text;
  }
  note('Starting the app on this phone…');

  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'progress') note(`${m.text}…`);
    else if (m.type === 'ready') { window.KL_LOCAL_TZ = m.tz; window.KL_LOCAL_BOOT_MS = Math.round(performance.now() - t0); markReady(); }
    else if (m.type === 'failed') {
      console.error('Phone server failed: ' + m.error);
      note('Could not start: ' + m.error);
      const box = document.getElementById('splash');
      if (box && !box.querySelector('.boot-retry')) {
        const b = document.createElement('button');
        b.className = 'btn lime boot-retry';
        b.textContent = 'Try again';
        b.onclick = () => location.reload();
        box.querySelector('.in').appendChild(b);
      }
      markFailed(new Error(m.error));
    } else if (m.type === 'response') {
      const p = pending.get(m.id);
      if (p) { pending.delete(m.id); p(m); }
    }
  };
  worker.onerror = (e) => { note('Could not start: ' + (e.message || 'worker error')); markFailed(new Error(e.message)); };

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return realFetch(input, init);
    const method = (init.method || 'GET').toUpperCase();
    const headers = {};
    new Headers(init.headers || {}).forEach((v, k) => { headers[k] = v; });
    let body = null;
    if (init.body !== undefined && init.body !== null) {
      const r = new Request(location.href, { method: 'POST', body: init.body, headers: init.headers });
      body = await r.arrayBuffer();
      const ct = r.headers.get('content-type');
      if (ct) headers['content-type'] = ct;
    }
    try { await ready; } catch { throw new TypeError('The phone server did not start'); }
    const id = ++seq;
    const res = await new Promise((resolve) => {
      pending.set(id, resolve);
      worker.postMessage({ type: 'request', id, method, path: url.pathname, query: url.search.replace(/^\?/, ''), headers, body }, body ? [body] : []);
    });
    const empty = res.status === 204 || res.status === 304;
    return new Response(empty ? null : res.body, { status: res.status, headers: res.headers });
  };

  /* Links to /api (PDFs, photos, CSV export) cannot be opened by the browser directly: fetch them here. */
  document.addEventListener('click', async (e) => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    const url = new URL(a.getAttribute('href'), location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return;
    e.preventDefault();
    e.stopPropagation();
    const w = a.target === '_blank' ? window.open('', '_blank') : null;
    try {
      const res = await window.fetch(url.pathname + url.search);
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const cd = res.headers.get('content-disposition') || '';
      const name = (cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i) || [])[1];
      if (!w && name) {
        const d = document.createElement('a');
        d.href = href; d.download = decodeURIComponent(name);
        document.body.appendChild(d); d.click(); d.remove();
      } else if (w) w.location.href = href;
      else location.href = href;
    } catch (err) {
      if (w) w.close();
      if (typeof toast === 'function') toast('Could not open the file: ' + err.message, 'error');
    }
  }, true);
})();
