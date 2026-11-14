/* Kshetralekha core: state, API, offline outbox, GPS, camera with evidence stamp, signature pad, UI helpers. */

const KL = {
  token: localStorage.getItem('kl.token') || '',
  user: JSON.parse(localStorage.getItem('kl.user') || 'null'),
  boot: null, // /api/bootstrap
  me: null, // /api/me
  cache: {},
  loading: {},
  ui: { login: { emp: '', pin: '' }, gps: null, gpsError: '', photos: {}, forms: {} },
  afterRender: [],
  imgUrls: {},
};
const Views = {};
const Actions = {};
const Changes = {};
const Inputs = {};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const isStaff = () => KL.user && ['admin', 'manager', 'hr'].includes(KL.user.role);
const isAdmin = () => KL.user && KL.user.role === 'admin';
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
function fmtDate(iso, withTime = true) {
  if (!iso) return '–';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return withTime && iso.length > 10 ? `${date}, ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : date;
}
function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
function duration(fromIso, toIso) {
  const ms = new Date(toIso || Date.now()) - new Date(fromIso);
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return h ? `${h} h ${m} min` : `${m} min`;
}
const fmtNum = (n, d = 0) => (n === null || n === undefined || Number.isNaN(Number(n)) ? '–' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: 0 }));
const rupees = (n) => `₹${fmtNum(n, 0)}`;

/* ---------------------------------------------------------------- toast / modal */
let toastTimer = null;
function toast(msg, kind = 'ok') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = kind === 'error' ? 'error' : '';
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), kind === 'error' ? 4200 : 2600);
}
function modal({ title, message = '', html = '', fields = [], confirmText = 'OK', cancelText = 'Cancel', danger = false, wide = false, noButtons = false }) {
  const m = $('#modal');
  return new Promise((resolve) => {
    m.innerHTML = `<div class="sheet ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><div class="grab"></div><h2>${esc(title)}</h2>${message ? `<p class="muted">${esc(message)}</p>` : ''}${html}
      <div class="stack">${fields
        .map((f) => `<label class="field"><span>${esc(f.label)}</span>${f.type === 'textarea' ? `<textarea id="m-${f.key}" class="input" placeholder="${esc(f.placeholder || '')}">${esc(f.value || '')}</textarea>` : f.type === 'select' ? `<select id="m-${f.key}" class="select">${(f.options || []).map((o) => `<option value="${esc(o)}" ${o === f.value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>` : `<input id="m-${f.key}" class="input" type="${esc(f.type || 'text')}" inputmode="${esc(f.inputmode || '')}" value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder || '')}" />`}</label>`)
        .join('')}</div>
      ${noButtons ? '' : `<div class="actions"><button type="button" class="btn" data-modal="cancel">${esc(cancelText)}</button><button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-modal="confirm">${esc(confirmText)}</button></div>`}</div>`;
    m.hidden = false;
    const finish = (v) => { m.hidden = true; m.innerHTML = ''; m.onclick = null; KL.closeModal = null; resolve(v); };
    KL.closeModal = finish;
    setTimeout(() => { const first = m.querySelector('input, textarea, select'); if (first && fields.length) first.focus(); }, 60);
    m.onclick = (e) => {
      const b = e.target.closest('[data-modal]');
      if (e.target === m || b?.dataset.modal === 'cancel') return finish(null);
      if (b?.dataset.modal === 'confirm') {
        if (!fields.length) return finish(true);
        const out = {};
        for (const f of fields) out[f.key] = $(`#m-${f.key}`).value.trim();
        finish(out);
      }
    };
  });
}

/* ---------------------------------------------------------------- API */
class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data; }
}
async function api(path, { method, json, form } = {}) {
  const headers = {};
  if (KL.token) headers.Authorization = `Bearer ${KL.token}`;
  let body;
  if (form) body = form;
  else if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  let res;
  try {
    res = await fetch(path, { method: method || (body ? 'POST' : 'GET'), headers, body });
  } catch (e) {
    throw new ApiError('offline', 0, null);
  }
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = { detail: text }; }
  if (res.status === 401 && KL.token && !path.startsWith('/api/auth/')) { logout(); throw new ApiError('Signed out', 401, data); }
  if (!res.ok) throw new ApiError((data && (data.detail || data.message)) || `Error ${res.status}`, res.status, data);
  return data;
}
function logout() {
  KL.token = ''; KL.user = null; KL.me = null; KL.boot = null; KL.cache = {}; KL.stale = {}; KL.ui.sheetTask = null;
  localStorage.removeItem('kl.token'); localStorage.removeItem('kl.user');
  location.hash = '#home';
  render();
}
/** Load once, cache, re-render when it arrives. Returns null while loading (or the previous value while
    refreshing, so screens do not flash), {error} on failure. */
function data(key, loader) {
  if (KL.cache[key] !== undefined) return KL.cache[key];
  const token = KL.token;
  if (!KL.loading[key]) {
    KL.loading[key] = true;
    loader().then((v) => { if (KL.token === token) KL.cache[key] = v; }).catch((e) => {
      if (KL.token !== token) return;
      KL.cache[key] = KL.stale?.[key] && e.message === 'offline' ? KL.stale[key] : { error: e.message === 'offline' ? 'No connection. Showing nothing until you are back online.' : e.message };
    }).finally(() => { delete KL.loading[key]; if (KL.stale) delete KL.stale[key]; render(); });
  }
  return KL.stale?.[key] ?? null;
}
function invalidate(...keys) {
  KL.stale = KL.stale || {};
  const drop = (c) => { if (KL.cache[c] && !KL.cache[c].error) KL.stale[c] = KL.cache[c]; delete KL.cache[c]; };
  if (!keys.length) { for (const c of Object.keys(KL.cache)) drop(c); return; }
  for (const k of keys) for (const c of Object.keys(KL.cache)) if (c === k || c.startsWith(k + ':')) drop(c);
}
async function refreshMe() {
  try { KL.me = await api('/api/me'); KL.user = KL.me.user; localStorage.setItem('kl.user', JSON.stringify(KL.user)); } catch { /* offline: keep what we have */ }
}

/* ---------------------------------------------------------------- outbox (IndexedDB) */
const Outbox = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('kshetralekha', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('outbox', { keyPath: 'id' });
      req.onsuccess = () => { this.db = req.result; resolve(this.db); };
      req.onerror = () => reject(req.error);
    });
  },
  async all() {
    const db = await this.open();
    return new Promise((resolve) => { const r = db.transaction('outbox').objectStore('outbox').getAll(); r.onsuccess = () => resolve(r.result || []); r.onerror = () => resolve([]); });
  },
  async add(item) {
    const db = await this.open();
    item.id = item.id || crypto.randomUUID();
    item.createdAt = new Date().toISOString();
    await new Promise((resolve, reject) => { const t = db.transaction('outbox', 'readwrite'); t.objectStore('outbox').put(item); t.oncomplete = resolve; t.onerror = () => reject(t.error); });
    KL.outboxCount = (KL.outboxCount || 0) + 1;
    return item.id;
  },
  async remove(id) {
    const db = await this.open();
    await new Promise((resolve) => { const t = db.transaction('outbox', 'readwrite'); t.objectStore('outbox').delete(id); t.oncomplete = resolve; t.onerror = resolve; });
  },
  flushing: false,
  async flush() {
    if (this.flushing || !navigator.onLine || !KL.token) return;
    this.flushing = true;
    try {
      const items = await this.all();
      let sent = 0;
      for (const it of items) {
        try {
          const form = new FormData();
          for (const [k, v] of Object.entries(it.fields || {})) form.append(k, v);
          for (const f of it.files || []) form.append(f.field, f.blob, f.name);
          await api(it.path, { form });
          await this.remove(it.id);
          sent++;
        } catch (e) {
          if (e.status === 0) break; // still offline
          if (e.status >= 400 && e.status < 500 && e.status !== 409) {
            await this.remove(it.id);
            toast(`${it.label}: ${e.message}`, 'error');
          } else if (e.status === 409) {
            await this.remove(it.id);
          }
        }
      }
      KL.outboxCount = (await this.all()).length;
      if (sent) { toast(`Sent ${sent} saved item${sent === 1 ? '' : 's'}`); invalidate(); render(); }
    } finally {
      this.flushing = false;
    }
  },
};
/** Submit a multipart form; when offline, keep it on the phone and send later. Returns {queued:true} or the response. */
async function submitEvidence(path, fields, files, label) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) form.append(k, v);
  for (const f of files) form.append(f.field, f.blob, f.name);
  try {
    return await api(path, { form });
  } catch (e) {
    if (e.status === 0) {
      await Outbox.add({ path, fields, files, label });
      toast(`No signal: ${label} saved on this phone, sends automatically`);
      return { queued: true };
    }
    throw e;
  }
}

/* ---------------------------------------------------------------- GPS */
/** Prototype only: pretend to be at the site (or away from it), so check-in, trips and registers can be tried on a PC. */
const DemoLoc = {
  get mode() { try { return localStorage.getItem('kl.demoLoc') || 'site'; } catch { return 'site'; } },
  set(m) { try { localStorage.setItem('kl.demoLoc', m); } catch { /* private mode */ } },
  active() { return Boolean(KL.boot && KL.boot.demo) && this.mode !== 'real'; },
};
function demoTargetSite() {
  const att = KL.me?.openAttendance;
  return siteById(att?.site_id) || siteById(F('att-site', '')) || siteById(F('trip-site', '')) || (KL.boot?.mySites || [])[0] || (KL.boot?.sites || [])[0] || null;
}
function simulatedFix() {
  const s = demoTargetSite();
  if (!s) return null;
  const away = DemoLoc.mode === 'away';
  const dist = away ? s.radius_m + 420 + Math.random() * 200 : Math.random() * s.radius_m * 0.35;
  const ang = Math.random() * Math.PI * 2;
  const dLat = (dist * Math.cos(ang)) / 111320;
  const dLng = (dist * Math.sin(ang)) / (111320 * Math.cos((s.lat * Math.PI) / 180));
  return { lat: s.lat + dLat, lng: s.lng + dLng, accuracy: 6 + Math.round(Math.random() * 8), at: new Date().toISOString(), simulated: true };
}
function getFix({ timeout = 15000, fresh = false } = {}) {
  if (DemoLoc.active()) {
    const f = simulatedFix();
    if (f) return new Promise((resolve) => setTimeout(() => resolve(f), 550));
  }
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This phone has no location service'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: new Date().toISOString() }),
      (err) => reject(new Error(err.code === 1 ? 'Location is blocked. Allow location for this app in your phone settings.' : err.code === 3 ? 'Could not get a location fix. Move to open sky and try again.' : 'Location unavailable right now.')),
      { enableHighAccuracy: true, timeout, maximumAge: fresh ? 0 : 10000 },
    );
  });
}
function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371008.8, r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
/** Start locating in the background; the view re-renders when the fix lands. */
function locate(force = false) {
  if (KL.ui.locating) return;
  if (!force && KL.ui.gps && Date.now() - new Date(KL.ui.gps.at).getTime() < 20000) return;
  KL.ui.locating = true; KL.ui.gpsError = '';
  render();
  getFix({ fresh: force }).then((fix) => { KL.ui.gps = fix; }).catch((e) => { KL.ui.gpsError = e.message; }).finally(() => { KL.ui.locating = false; render(); });
}
function gpsLine(site) {
  const g = KL.ui.gps;
  if (KL.ui.locating && !g) return `<div class="gps wait"><span class="dot"></span><span>Finding your location…</span>${DemoLoc.active() ? '<span class="sim">demo</span>' : ''}</div>`;
  if (!g) return `<div class="gps bad"><span class="dot"></span><span>${esc(KL.ui.gpsError || 'Location not found yet.')}</span><button type="button" class="btn small ghost" data-action="locate">Retry</button></div>`;
  let text = `±${Math.round(g.accuracy)} m · ${g.lat.toFixed(5)}, ${g.lng.toFixed(5)}`;
  let cls = 'ok';
  if (site) {
    const d = distanceM(g.lat, g.lng, site.lat, site.lng);
    const slack = Math.min(g.accuracy || 0, 50);
    const inside = d <= site.radius_m + slack;
    cls = inside ? 'ok' : 'bad';
    text = `${inside ? 'At the site' : 'Not at the site'}: ${fmtNum(d)} m away (allowed ${site.radius_m} m) · GPS ±${Math.round(g.accuracy)} m`;
  }
  return `<div class="gps ${cls}"><span class="dot"></span><span>${esc(text)}</span>${g.simulated ? '<span class="sim">demo</span>' : ''}<button type="button" class="btn small ghost" data-action="locate" aria-label="Refresh location">${ic('refresh')}</button></div>`;
}
/** A small map of the geofence with you on it. */
function geoCard(site) {
  if (!site) return '';
  const g = KL.ui.gps;
  let me = '';
  let legend = `<span>${esc(site.name)}</span>${tag(KL.ui.locating ? 'Locating…' : 'No fix yet', 'warn')}`;
  if (g) {
    const d = distanceM(g.lat, g.lng, site.lat, site.lng);
    const k = 60 / site.radius_m; // the fence circle is 60 px in radius
    const dy = (g.lat - site.lat) * 111320, dx = (g.lng - site.lng) * 111320 * Math.cos((site.lat * Math.PI) / 180);
    const len = Math.hypot(dx, dy) * k, cap = 70;
    const f = len > cap ? cap / len : 1;
    const inside = insideSite(site);
    me = `<span class="me ${inside ? '' : 'out'}" style="left:calc(50% + ${(dx * k * f).toFixed(1)}px);top:calc(50% - ${(dy * k * f).toFixed(1)}px)"></span>`;
    legend = `<span>${esc(site.name)} · ${site.radius_m} m fence</span>${tag(inside ? 'Inside' : `${fmtNum(d)} m away`, inside ? 'ok' : 'bad')}`;
  }
  return `<div class="geo-card"><div class="grid"></div><div class="fence"></div><div class="site"></div>${me}<div class="legend">${legend}</div></div>`;
}
/** Prototype switch: pretend location (at the site, away) or the real GPS. */
function demoRibbon() {
  if (!KL.boot?.demo) return '';
  const m = DemoLoc.mode;
  return `<div class="demo-ribbon">${ic('compass')}<span>Prototype location</span><div class="seg">${[['site', 'At site'], ['away', 'Away'], ['real', 'Real GPS']].map(([k, l]) => `<button type="button" data-action="demoLoc" data-mode="${k}" aria-pressed="${m === k}">${l}</button>`).join('')}</div></div>`;
}
function insideSite(site) {
  const g = KL.ui.gps;
  if (!g || !site) return false;
  return distanceM(g.lat, g.lng, site.lat, site.lng) <= site.radius_m + Math.min(g.accuracy || 0, 50);
}

/* ---------------------------------------------------------------- camera */
/** Open the camera (file input with capture) and return a stamped, compressed JPEG. Must be called from a tap. */
function stampLines(stamp, sample) {
  const at = new Date();
  const g = KL.ui.gps;
  return { at, g, lines: [...(sample ? ['DEMO SAMPLE PHOTO'] : []), ...stamp, at.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }), g ? `GPS ${g.lat.toFixed(5)}, ${g.lng.toFixed(5)} (±${Math.round(g.accuracy)} m)` : 'GPS not available'] };
}
function setPhoto(slot, blob, at, gps, sample = false) {
  if (KL.ui.photos[slot]) URL.revokeObjectURL(KL.ui.photos[slot].url);
  KL.ui.photos[slot] = { blob, url: URL.createObjectURL(blob), at: at.toISOString(), gps, sample };
}
/** Full-screen camera inside the app (getUserMedia); falls back to a photo file, and in the prototype to a sample photo. */
function openCamera(slot, { facing = 'environment', stamp = [], kind = '' } = {}) {
  closeCamera();
  const demo = Boolean(KL.boot && KL.boot.demo);
  const selfie = facing === 'user';
  const el = document.createElement('div');
  el.className = 'cam'; el.id = 'cam';
  el.innerHTML = `<div class="cam-top"><button type="button" class="round" data-cam="close" aria-label="Close">${ic('x')}</button><b>${selfie ? 'Selfie' : 'Evidence photo'}</b><button type="button" class="round" data-cam="flip" aria-label="Switch camera">${ic('flip')}</button></div>
    <video playsinline autoplay muted></video><div class="frame ${selfie ? '' : 'rect'}"></div><div class="flash"></div>
    <div class="note">${selfie ? 'Keep your face in the oval.' : 'Fill the frame.'} Time and GPS are stamped on the photo.</div>
    <div class="cam-bar"><button type="button" class="round" data-cam="file" aria-label="Choose a photo file">${ic('image')}</button><button type="button" class="shutter" data-cam="shoot" aria-label="Take the photo"></button><button type="button" class="round" data-cam="sample" aria-label="Use a sample photo" ${demo ? '' : 'style="visibility:hidden"'}>${ic('sparkle')}</button></div>`;
  document.body.appendChild(el);
  const state = { facing, stream: null };
  KL.cam = state;
  const video = el.querySelector('video');
  const noCam = () => {
    if (!el.isConnected || el.querySelector('.nocam')) return;
    video.remove(); el.querySelector('.frame')?.remove(); el.querySelector('.note')?.remove();
    const box = document.createElement('div');
    box.className = 'nocam';
    box.innerHTML = `<div style="width:76px;height:76px;border-radius:26px;background:rgba(255,255,255,.1);display:grid;place-items:center;margin:0 auto">${ic('camera')}</div><h2 style="font-size:24px">No camera available</h2><p>This device has no camera, or the browser was not allowed to use it.${demo ? ' In the prototype you can use a sample photo to see the whole flow.' : ''}</p><div class="btns" style="justify-content:center;max-width:360px;margin:6px auto 0">${demo ? '<button type="button" class="btn lime" data-cam="sample">Use a sample photo</button>' : ''}<button type="button" class="btn" data-cam="file" style="background:rgba(255,255,255,.12);color:#fff">Choose a photo file</button></div>`;
    el.insertBefore(box, el.querySelector('.cam-bar'));
    const sh = el.querySelector('.shutter');
    sh.disabled = true; sh.style.opacity = '.3';
  };
  const start = async () => {
    if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
    video.style.transform = state.facing === 'user' ? 'scaleX(-1)' : ''; // preview mirrored like a mirror; the saved photo is not
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera');
      state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: state.facing, width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false });
      if (!el.isConnected) { state.stream.getTracks().forEach((t) => t.stop()); return; }
      video.srcObject = state.stream;
    } catch { noCam(); }
  };
  const finish = async (source, sample) => {
    try {
      const { at, g, lines } = stampLines(stamp, sample);
      const out = await stampImage(source, lines, false); // never mirror: evidence photos show what the camera saw
      setPhoto(slot, out.blob, at, g, sample);
      closeCamera();
      render();
    } catch (e) { toast('Could not take the photo: ' + e.message, 'error'); }
  };
  el.onclick = (e) => {
    const b = e.target.closest('[data-cam]');
    if (!b || b.disabled) return;
    const what = b.dataset.cam;
    if (what === 'close') return closeCamera();
    if (what === 'flip') { state.facing = state.facing === 'user' ? 'environment' : 'user'; return start(); }
    if (what === 'file') { closeCamera(); return pickPhoto(slot, { facing, stamp }); }
    if (what === 'sample') return finish(samplePhoto(kind || (selfie ? 'selfie' : 'field')), true);
    if (what === 'shoot') {
      if (!video.videoWidth) return;
      const fl = el.querySelector('.flash');
      fl.classList.add('on'); setTimeout(() => fl.classList.remove('on'), 80);
      const c = document.createElement('canvas');
      c.width = video.videoWidth; c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      finish(c, false);
    }
  };
  start();
}
function closeCamera() {
  if (KL.cam?.stream) KL.cam.stream.getTracks().forEach((t) => t.stop());
  KL.cam = null;
  $('#cam')?.remove();
}
/** Drawn stand-in photos for the prototype (selfie, odometer, stock, field), so every flow can be tried without a camera. */
function samplePhoto(kind) {
  const portrait = kind === 'selfie';
  const c = document.createElement('canvas');
  c.width = portrait ? 900 : 1280; c.height = portrait ? 1200 : 900;
  const x = c.getContext('2d');
  const W = c.width, H = c.height;
  const lin = (y0, y1, a, b) => { const g = x.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, a); g.addColorStop(1, b); return g; };
  const rr = (X, Y, w, h, r) => { x.beginPath(); if (x.roundRect) x.roundRect(X, Y, w, h, r); else x.rect(X, Y, w, h); };
  if (kind === 'odometer') {
    x.fillStyle = lin(0, H, '#20262b', '#0b0e10'); x.fillRect(0, 0, W, H);
    x.strokeStyle = '#3a444c'; x.lineWidth = 26; x.beginPath(); x.arc(W / 2, H * 0.62, 360, Math.PI * 1.05, Math.PI * 1.95); x.stroke();
    x.strokeStyle = '#e8eef2'; x.lineWidth = 6;
    for (let i = 0; i <= 12; i++) { const a = Math.PI * (1.05 + (0.9 * i) / 12); x.beginPath(); x.moveTo(W / 2 + Math.cos(a) * 320, H * 0.62 + Math.sin(a) * 320); x.lineTo(W / 2 + Math.cos(a) * 350, H * 0.62 + Math.sin(a) * 350); x.stroke(); }
    x.strokeStyle = '#ff5a36'; x.lineWidth = 10; x.beginPath(); x.moveTo(W / 2, H * 0.62); x.lineTo(W / 2 + Math.cos(Math.PI * 1.32) * 300, H * 0.62 + Math.sin(Math.PI * 1.32) * 300); x.stroke();
    const reading = String(Math.round(Number(F('trip-end-reading')) || Number(F('trip-reading')) || 48213)).padStart(6, '0');
    rr(W / 2 - 300, H * 0.68, 600, 150, 18); x.fillStyle = '#0d1a12'; x.fill(); x.strokeStyle = '#4c5a52'; x.lineWidth = 4; x.stroke();
    x.fillStyle = '#b9f27a'; x.font = '700 104px ui-monospace, Consolas, monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(reading.split('').join(' '), W / 2 - 20, H * 0.68 + 78);
    x.font = '700 40px system-ui'; x.fillText('km', W / 2 + 250, H * 0.68 + 84);
  } else if (kind === 'selfie') {
    x.fillStyle = lin(0, H, '#bfe0f2', '#f2ead2'); x.fillRect(0, 0, W, H);
    x.fillStyle = '#6aa65a'; x.fillRect(0, H * 0.62, W, H);
    x.fillStyle = '#3f7d3c'; for (let i = 0; i < 9; i++) { x.beginPath(); x.ellipse(i * 120 + 30, H * 0.62, 90, 50, 0, Math.PI, 0); x.fill(); }
    x.fillStyle = '#1e7a4c'; x.beginPath(); x.ellipse(W / 2, H * 1.02, 330, 330, 0, Math.PI, 0); x.fill();
    x.fillStyle = '#c99573'; x.fillRect(W / 2 - 55, H * 0.52, 110, 110);
    x.beginPath(); x.ellipse(W / 2, H * 0.42, 160, 200, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#2b1d14'; x.beginPath(); x.ellipse(W / 2, H * 0.31, 170, 110, 0, Math.PI, 0); x.fill();
    x.fillStyle = '#f2c94c'; x.beginPath(); x.ellipse(W / 2, H * 0.29, 200, 120, 0, Math.PI, 0); x.fill(); x.fillRect(W / 2 - 230, H * 0.285, 460, 26);
    x.fillStyle = '#2b1d14'; x.beginPath(); x.arc(W / 2 - 60, H * 0.43, 14, 0, 7); x.arc(W / 2 + 60, H * 0.43, 14, 0, 7); x.fill();
    x.strokeStyle = '#7a3e2a'; x.lineWidth = 8; x.lineCap = 'round'; x.beginPath(); x.arc(W / 2, H * 0.47, 60, 0.2 * Math.PI, 0.8 * Math.PI); x.stroke();
    x.fillStyle = '#fff'; x.font = '800 64px system-ui'; x.textAlign = 'center'; x.fillText(initials(KL.user?.name || ''), W / 2, H * 0.86);
  } else if (kind === 'stock') {
    x.fillStyle = lin(0, H, '#cfe6f5', '#efe6cf'); x.fillRect(0, 0, W, H);
    x.fillStyle = '#9a7b55'; x.fillRect(0, H * 0.7, W, H);
    for (let row = 0; row < 4; row++) for (let i = 0; i < 6 - row; i++) {
      const bx = 180 + row * 75 + i * 150, by = H * 0.7 - (row + 1) * 105;
      rr(bx, by, 140, 98, 30); x.fillStyle = row % 2 ? '#f4efe3' : '#ebe3d0'; x.fill(); x.strokeStyle = '#b9ad93'; x.lineWidth = 3; x.stroke();
      x.fillStyle = '#1e7a4c'; x.font = '800 22px system-ui'; x.textAlign = 'center'; x.fillText('BIOCHAR', bx + 70, by + 56);
    }
  } else {
    x.fillStyle = lin(0, H, '#bcdcf0', '#f6efd9'); x.fillRect(0, 0, W, H);
    x.fillStyle = '#8a6a3f'; x.fillRect(0, H * 0.55, W, H);
    x.strokeStyle = '#6e5230'; x.lineWidth = 10;
    for (let i = -6; i < 14; i++) { x.beginPath(); x.moveTo(W / 2, H * 0.55); x.lineTo(W / 2 + i * 160, H); x.stroke(); }
    for (let i = 0; i < 7; i++) {
      const sx = 160 + i * 160, sy = H * 0.8 - (i % 2) * 40;
      x.strokeStyle = '#3f7d3c'; x.lineWidth = 8; x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx, sy - 90); x.stroke();
      x.fillStyle = '#5fb04f'; x.beginPath(); x.ellipse(sx - 26, sy - 90, 34, 16, -0.6, 0, 7); x.ellipse(sx + 26, sy - 105, 34, 16, 0.6, 0, 7); x.fill();
    }
  }
  return c;
}
function pickPhoto(slot, { facing = 'environment', stamp = [] } = {}) {
  const input = $('#pick-photo');
  input.setAttribute('capture', facing);
  input.value = '';
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const { at, g, lines } = stampLines(stamp, false);
      const out = await stampImage(file, lines, false); // never mirror: evidence photos must show what the camera saw
      setPhoto(slot, out.blob, at, g);
      render();
    } catch (e) {
      toast('Could not read the photo: ' + e.message, 'error');
    }
  };
  input.click();
}
async function stampImage(file, lines, mirror = false) {
  const bitmap = await loadBitmap(file);
  const max = 1280;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
  ctx.drawImage(bitmap, 0, 0, w, h);
  if (mirror) ctx.setTransform(1, 0, 0, 1, 0, 0);
  const fs = Math.max(14, Math.round(w / 42));
  const pad = Math.round(fs * 0.6);
  const bh = lines.length * (fs + 4) + pad * 2;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, h - bh, w, bh);
  ctx.fillStyle = '#fff';
  ctx.font = `600 ${fs}px system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  lines.forEach((t, i) => ctx.fillText(t, pad, h - bh + pad + i * (fs + 4)));
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82));
  if (bitmap.close) bitmap.close();
  return { blob, width: w, height: h };
}
function loadBitmap(file) {
  if (file instanceof HTMLCanvasElement) return Promise.resolve(file);
  if (window.createImageBitmap) return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => loadImageEl(file));
  return loadImageEl(file);
}
function loadImageEl(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => reject(new Error('unreadable image'));
    img.src = url;
  });
}
function photoBox(slot, label, facing = 'environment', stamp = []) {
  const p = KL.ui.photos[slot];
  const kind = slot.startsWith('trip') ? 'odometer' : facing === 'user' ? 'selfie' : slot === 'mov' ? 'stock' : 'field';
  const attrs = `data-action="photo" data-slot="${esc(slot)}" data-facing="${esc(facing)}" data-kind="${kind}" data-stamp="${esc(JSON.stringify(stamp))}"`;
  if (!p) return `<button type="button" class="photo" ${attrs} style="width:100%;cursor:pointer;font:inherit"><span class="ph"><span class="ring">${ic('camera')}</span>${esc(label)}<small class="muted" style="font-weight:600">Time and GPS are stamped on the photo</small></span></button>`;
  return `<div class="stack">
    <div class="photo has"><img src="${p.url}" alt="${esc(label)}" /><span class="stamp-chip">${ic('shield')} ${p.sample ? 'Sample · ' : ''}stamped ${esc(new Date(p.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }))}</span></div>
    <button type="button" class="btn small" ${attrs}>${ic('camera')} Retake</button>
  </div>`;
}
function photoFile(slot, name) {
  const p = KL.ui.photos[slot];
  return p ? [{ field: 'photo', blob: p.blob, name }] : [];
}
function clearPhotos(...slots) {
  for (const s of slots) { if (KL.ui.photos[s]) URL.revokeObjectURL(KL.ui.photos[s].url); delete KL.ui.photos[s]; }
}
/** Pick any file (KML, PDF, image) through the generic input. */
function pickFile(accept, onFile) {
  const input = $('#pick-file');
  input.setAttribute('accept', accept || '*/*');
  input.value = '';
  input.onchange = () => { const f = input.files && input.files[0]; if (f) onFile(f); };
  input.click();
}

/* ---------------------------------------------------------------- authenticated images */
async function loadAuthImages() {
  for (const img of $$('img.authimg[data-file]:not([src])')) {
    const id = img.dataset.file;
    if (KL.imgUrls[id]) { img.src = KL.imgUrls[id]; continue; }
    try {
      const res = await fetch(`/api/files/${id}`, { headers: { Authorization: `Bearer ${KL.token}` } });
      if (!res.ok) continue;
      const url = URL.createObjectURL(await res.blob());
      KL.imgUrls[id] = url;
      img.src = url;
    } catch { /* offline */ }
  }
}
const fileLink = (id, text = 'Open') => `<a class="btn small" href="/api/files/${esc(id)}?token=${encodeURIComponent(KL.token)}" target="_blank" rel="noopener">${esc(text)}</a>`;
const authImg = (id, cls = 'thumb') => (id ? `<img class="authimg ${cls}" data-file="${esc(id)}" alt="" />` : '');

/* ---------------------------------------------------------------- signature pad */
function signaturePad(canvas) {
  const ctx = canvas.getContext('2d');
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * ratio; canvas.height = rect.height * ratio;
  ctx.scale(ratio, ratio);
  ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
  let drawing = false, points = 0, last = null;
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.onpointerdown = (e) => { drawing = true; last = pos(e); canvas.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(last.x + 0.1, last.y + 0.1); ctx.stroke(); points++; };
  canvas.onpointermove = (e) => { if (!drawing) return; const p = pos(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; points++; };
  canvas.onpointerup = canvas.onpointercancel = () => { drawing = false; };
  return {
    clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); points = 0; },
    isEmpty() { return points < 8; }, // a real signature is many points; a stray tap is not
    dataUrl() { return canvas.toDataURL('image/png'); },
  };
}

/* ---------------------------------------------------------------- UI pieces */
function topbar(title, back = '#home', right = '') {
  return `<div class="topbar"><a class="back" href="${esc(back)}" aria-label="Back">${ic('back')}<span class="lbl">Back</span></a><h1>${esc(title)}</h1>${right ? `<div class="right">${right}</div>` : ''}</div>`;
}
function group(title, body, note = '', link = '') {
  return `<section class="group"><div class="gh"><h2>${esc(title)}</h2>${link || (note ? `<span class="note">${note}</span>` : '')}</div>${body}</section>`;
}
const emptyState = (icon, title, text = '') => `<div class="card empty-state"><div class="art">${ic(icon)}</div><b>${esc(title)}</b>${text ? `<span>${esc(text)}</span>` : ''}</div>`;
function lrow({ href, action, data = {}, icon = 'dot', tone = '', title, sub, right = '', chev = true }) {
  const attrs = Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ');
  const inner = `<span class="icon ${tone}">${icon.startsWith('<') ? icon : ic(icon)}</span><span class="tx"><b>${esc(title)}</b>${sub ? `<span class="wrap">${sub}</span>` : ''}</span>${right}${chev ? `<span class="chev">${ic('chevron')}</span>` : ''}`;
  if (href) return `<a class="lrow" href="${esc(href)}" ${attrs}>${inner}</a>`;
  if (action) return `<button type="button" class="lrow" data-action="${esc(action)}" ${attrs}>${inner}</button>`;
  return `<div class="lrow-static row">${inner}</div>`;
}
const tag = (text, tone = '') => `<span class="tag ${tone}">${esc(text)}</span>`;
function statusTag(status, kind = '') {
  const map = { ok: ['At site', 'ok'], pending: ['Awaiting approval', 'warn'], rejected: ['Rejected', 'bad'], open: ['In progress', 'info'], submitted: ['Awaiting approval', 'warn'], approved: ['Approved', 'ok'], closed: ['Closed', ''], in_progress: ['In progress', 'info'], not_started: ['Not started', ''], completed: ['Completed', 'ok'] };
  let [t, tone] = map[status] || [status, ''];
  if (kind === 'attendance' && status === 'pending') t = 'Exception, awaiting approval';
  return tag(t, tone);
}
const spinner = (text = 'Loading…') => `<div class="spinner" role="status"><span class="sr-only">${esc(text)}</span><div class="skel"></div><div class="skel" style="opacity:.65"></div><div class="skel" style="opacity:.35"></div></div>`;
const errorBox = (msg) => `<div class="banner bad">${ic('alert')}<div><b>Could not load</b><p>${esc(msg)}</p></div></div>`;
function field(label, control) { return `<label class="field"><span>${esc(label)}</span>${control}</label>`; }
function input(id, value, { type = 'text', placeholder = '', inputmode = '', step = '', min = '' } = {}) {
  return `<input id="${esc(id)}" class="input" type="${type}" value="${esc(value ?? '')}" placeholder="${esc(placeholder)}" ${inputmode ? `inputmode="${inputmode}"` : ''} ${step ? `step="${step}"` : ''} ${min !== '' ? `min="${min}"` : ''} data-input="form" data-key="${esc(id)}" autocomplete="off" />`;
}
function select(id, value, options, { blank = '' } = {}) {
  return `<select id="${esc(id)}" class="select" data-change="form" data-key="${esc(id)}">${blank ? `<option value="">${esc(blank)}</option>` : ''}${options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select>`;
}
function textarea(id, value, placeholder = '') {
  return `<textarea id="${esc(id)}" class="input" placeholder="${esc(placeholder)}" data-input="form" data-key="${esc(id)}">${esc(value ?? '')}</textarea>`;
}
/** Form values live in KL.ui.forms[key] so re-renders keep what was typed. */
const F = (key, def = '') => (KL.ui.forms[key] === undefined ? def : KL.ui.forms[key]);
const setF = (key, v) => { KL.ui.forms[key] = v; };
const clearF = (...keys) => { for (const k of keys) delete KL.ui.forms[k]; };
/** Typing never re-renders (that would steal the tap that follows); views that need a live figure render it inside
    #preview and set KL.ui.previewFn, which is re-run on every keystroke. */
Inputs.form = (el) => {
  setF(el.dataset.key, el.value);
  const box = $('#preview');
  if (box && KL.ui.previewFn) box.innerHTML = KL.ui.previewFn();
};
Changes.form = (el) => {
  setF(el.dataset.key, el.value);
  if (DemoLoc.active() && ['att-site', 'trip-site'].includes(el.dataset.key)) { KL.ui.gps = null; locate(true); return; } // the pretend location follows the chosen site
  render();
};

const siteById = (id) => (KL.boot ? KL.boot.sites.find((s) => s.id === id) : null);
const siteName = (id) => siteById(id)?.name || 'Unassigned';
const personName = (id) => (KL.boot ? KL.boot.people.find((p) => p.id === id)?.name : '') || '';
const AV_COLORS = ['#3E5C50', '#4B5A6B', '#5B5368', '#6B5446', '#46606A', '#55603F', '#6A4E5A', '#3F566E']; // muted, white initials ≥ 6.6:1
function initials(name) {
  const p = String(name || '').trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] || '?') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}
function avatar(name, size = '') {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `<span class="avatar ${size}" style="background:${AV_COLORS[h % AV_COLORS.length]}" title="${esc(name)}">${esc(initials(name))}</span>`;
}
const personById = (id) => (KL.boot ? KL.boot.people.find((p) => p.id === id) : null);
const ROLE_TEXT = { admin: 'Director', manager: 'Manager', hr: 'HR', field: 'Field staff' };
const firstName = (n) => String(n || '').split(' ')[0];

/** A number that counts up the first time it appears on a screen. */
const num = (n, key, fmt = '') => `<span data-count="${Number(n) || 0}" data-ck="${esc(key)}" data-fmt="${fmt}">${fmt === 'rupee' ? rupees(n) : fmtNum(n)}</span>`;
function countUp(root = document) {
  KL.seenCounts = KL.seenCounts || new Set();
  for (const el of $$('[data-count]', root)) {
    const key = el.dataset.ck;
    if (!key || KL.seenCounts.has(key)) continue;
    KL.seenCounts.add(key);
    const end = Number(el.dataset.count);
    if (!end || matchMedia('(prefers-reduced-motion: reduce)').matches) continue;
    const fmt = el.dataset.fmt === 'rupee' ? rupees : (v) => fmtNum(v);
    const t0 = performance.now(), dur = 800;
    const step = (t) => { const k = Math.min(1, (t - t0) / dur); el.textContent = fmt(Math.round(end * (1 - (1 - k) ** 3))); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
}
/** Full-screen tick with falling leaves after something important is done. */
function celebrate(title, text = '') {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'success';
    const leaves = Array.from({ length: 16 }, (_, i) => `<i class="leaf" style="left:${(Math.random() * 100).toFixed(1)}%;--dx:${(Math.random() * 140 - 70).toFixed(0)}px;--rot:${(Math.random() * 540).toFixed(0)}deg;animation-delay:${(Math.random() * 0.6).toFixed(2)}s;background:${['#3fa66b', '#c6e86a', '#1e7a4c', '#9bd45a'][i % 4]}"></i>`).join('');
    el.innerHTML = `${leaves}<div class="box" role="alertdialog" aria-label="${esc(title)}"><svg class="tickmark" viewBox="0 0 92 92"><circle cx="46" cy="46" r="42"/><path d="M28 47l12 12 24-26"/></svg><h2>${esc(title)}</h2><p>${esc(text)}</p><button type="button" class="btn primary wide">Done</button></div>`;
    document.body.appendChild(el);
    let gone = false;
    const done = () => { if (gone) return; gone = true; el.style.transition = 'opacity .2s'; el.style.opacity = '0'; setTimeout(() => { el.remove(); resolve(); }, 200); };
    el.onclick = done;
    setTimeout(done, 2800);
  });
}
function applyTheme() {
  let t = 'auto';
  try { t = localStorage.getItem('kl.theme') || 'auto'; } catch { /* private mode */ }
  if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0c120f' : '#f5f3ec');
}
const PROJECT_ICON = { biochar: 'flame', agroforestry: 'tree', gasifier: 'cog', office: 'building', other: 'pin' };

/* ---------------------------------------------------------------- line icons (24-unit grid, stroked) */
const ICONS = {
  home: '<path d="M3.5 11.5 12 4.5l8.5 7"/><path d="M6 10v9.5h12V10"/><path d="M10 19.5v-5h4v5"/>',
  work: '<rect x="3.5" y="7.5" width="17" height="12" rx="3"/><path d="M9 7.5V5.5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3.5 12.5h17"/>',
  manage: '<path d="M4 19.5V13M10 19.5V5M16 19.5v-9M4 19.5h16"/>',
  bell: '<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5h-14z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c.8-3.8 3.8-6 7.5-6s6.7 2.2 7.5 6"/>',
  users: '<circle cx="9" cy="8.5" r="3.3"/><path d="M2.5 19c.6-3.3 3.1-5.3 6.5-5.3s5.9 2 6.5 5.3"/><path d="M15.5 5.6a3.3 3.3 0 0 1 0 5.8M17.5 13.8c2.3.6 3.6 2.4 4 5.2"/>',
  pin: '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
  bike: '<circle cx="6" cy="16.5" r="3.2"/><circle cx="18" cy="16.5" r="3.2"/><path d="M6 16.5 9.5 9h4l3 7.5M9.5 9H7M13.5 9l1.3-3H17"/>',
  box: '<path d="M3.5 8.5 12 4l8.5 4.5v8L12 21l-8.5-4.5z"/><path d="M3.5 8.5 12 13l8.5-4.5M12 13v8"/>',
  leaf: '<path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14z"/><path d="M5 19l7-7"/>',
  sprout: '<path d="M12 21v-9"/><path d="M12 12c-1-5-4-7.5-8.5-7.5C4 9.5 7 12 12 12z"/><path d="M12 10c.5-5 3.5-7.5 8-7.5-.5 5-3.5 7.5-8 7.5z"/>',
  tree: '<path d="M12 3.5 6 12h3.5l-3 5h11l-3-5H18z"/><path d="M12 17v4"/>',
  note: '<path d="M6 3.5h9l4 4v13H6z"/><path d="M15 3.5v4h4M9 12h6M9 15.5h6"/>',
  check: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.3l2.3 2.3 4.7-5"/>',
  tick: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  camera: '<path d="M4 8.5h3l1.6-2.5h6.8L17 8.5h3a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 20 20H4a1.5 1.5 0 0 1-1.5-1.5V10A1.5 1.5 0 0 1 4 8.5z"/><circle cx="12" cy="14" r="3.3"/>',
  doc: '<path d="M6 3.5h9l4 4v13H6z"/><path d="M15 3.5v4h4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
  chat: '<path d="M4 5.5h16v10.5H9.5L5 20z"/><path d="M8 9.5h8M8 12.5h5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 17v2.5h16V17"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 17v2.5h16V17"/>',
  logout: '<path d="M10 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H10"/><path d="M14 8l4 4-4 4M9 12h9"/>',
  chart: '<path d="M4 19.5h16"/><path d="M6 16v-5M11 16V7M16 16v-3"/>',
  folder: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.3M12 18.2v2.3M3.5 12h2.3M18.2 12h2.3M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6"/>',
  fuel: '<path d="M5 20V5.5A1.5 1.5 0 0 1 6.5 4h6A1.5 1.5 0 0 1 14 5.5V20"/><path d="M4 20h11M7 8h4"/><path d="M14 10h2l2 2v5a1.5 1.5 0 0 0 3 0v-6.5L18.5 8"/>',
  map: '<path d="M3.5 6.5 9 4.5l6 2 5.5-2v13L15 19.5l-6-2-5.5 2z"/><path d="M9 4.5v13M15 6.5v13"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M20 16l-5-5-7 8"/>',
  clip: '<path d="M8.5 12.5 15 6a3 3 0 0 1 4.3 4.3l-8.5 8.5a5 5 0 0 1-7-7L12 3.5"/>',
  shield: '<path d="M12 3.5 5 6v6c0 4.5 3 7.5 7 8.5 4-1 7-4 7-8.5V6z"/><path d="M9 12l2 2 4-4"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="M15 9l-2 5-5 2 2-5z"/>',
  flame: '<path d="M12 21c4 0 7-2.8 7-7 0-3.5-2.5-6-4-8 0 2.5-1.5 4-3 4 0-3-1.5-5.5-4-7 .3 3-3 5.5-3 10 0 4.2 3 8 7 8z"/>',
  building: '<rect x="4" y="3.5" width="16" height="17" rx="1.5"/><path d="M4 20.5h16M9 7.5h2M13 7.5h2M9 11h2M13 11h2M9 14.5h2M13 14.5h2M10.5 20.5v-3h3v3"/>',
  pen: '<path d="M4 20l4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10z"/><path d="M13.5 8l3 3"/>',
  receipt: '<path d="M6 3.5h12v17l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5z"/><path d="M9 8h6M9 11.5h6M9 15h4"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M8 12.5a4.5 4.5 0 1 1 8 0c-.8 1.2-1.5 2-1.5 3.5h-5c0-1.5-.7-2.3-1.5-3.5z"/>',
  alert: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  refresh: '<path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  back: '<path d="M14 6l-6 6 6 6"/>',
  send: '<path d="M3.5 11.5 20.5 4l-5 16.5-3.5-7z"/><path d="M12 13.5l8.5-9.5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  dot: '<circle cx="12" cy="12" r="3"/>',
  inbox: '<path d="M3.5 13.5V18a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5v-4.5"/><path d="M3.5 13.5h5l1.5 2.5h4l1.5-2.5h5"/><path d="M6.5 13.5 8 5.5h8l1.5 8"/>',
  scale: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8 9a5.5 5.5 0 0 1 8 0"/><path d="M12 12l2-3"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  flip: '<path d="M4 8.5h3l1.6-2.5h6.8L17 8.5h3a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 20 20H4a1.5 1.5 0 0 1-1.5-1.5V10A1.5 1.5 0 0 1 4 8.5z"/><path d="M9 14a3 3 0 0 1 5.3-1.9M15 14a3 3 0 0 1-5.3 1.9M14.6 10.6v1.6H13M9.4 17.4v-1.6H11"/>',
  sparkle: '<path d="M12 3.5l1.8 5 5 1.8-5 1.8-1.8 5-1.8-5-5-1.8 5-1.8z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  kanban: '<rect x="3.5" y="4" width="4.6" height="15" rx="1.6"/><rect x="9.7" y="4" width="4.6" height="9.5" rx="1.6"/><rect x="15.9" y="4" width="4.6" height="12" rx="1.6"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><path d="M4.5 6.5h.6M4.5 12h.6M4.5 17.5h.6"/>',
  pie: '<path d="M11 4a8.5 8.5 0 1 0 9 9h-9z"/><path d="M14 3.5a7 7 0 0 1 6.5 6.5H14z"/>',
  flag: '<path d="M5.5 21V4.5"/><path d="M5.5 4.5h11l-2 4 2 4h-11"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/><path d="M10 11v5M14 11v5"/>',
  checklist: '<path d="M4 6.5l1.5 1.5L8 5.5M4 12.5 5.5 14 8 11.5M4 18.5 5.5 20 8 17.5"/><path d="M11 7h9M11 13h9M11 19h9"/>',
  swap: '<path d="M7 4 3.5 7.5 7 11M3.5 7.5h13M17 13l3.5 3.5L17 20M20.5 16.5h-13"/>',
  moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".8"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  more: '<circle cx="5.5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="18.5" cy="12" r="1"/>',
};
const ic = (name) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.dot}</svg>`;
