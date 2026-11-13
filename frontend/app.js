/* Kshetralekha: routing, login, tab bar, event wiring, start-up. */

const TABS_FIELD = [['home', 'home', 'Home'], ['work', 'work', 'Work'], ['inbox', 'bell', 'Inbox'], ['me', 'user', 'Me']];
const TABS_STAFF = [['home', 'home', 'Home'], ['work', 'work', 'Work'], ['manage', 'manage', 'Manage'], ['inbox', 'bell', 'Inbox'], ['me', 'user', 'Me']];
const TAB_OF = { attendance: 'work', trips: 'work', registers: 'work', farmers: 'work', sign: 'work', updates: 'me', leaves: 'me', feedback: 'me', dashboard: 'manage', approvals: 'manage', team: 'manage', hrdesk: 'manage', admin: 'manage' };
const STAFF_ROUTES = new Set(['manage', 'dashboard', 'approvals', 'team', 'hrdesk', 'admin']);

function route() {
  const h = location.hash.replace(/^#/, '') || 'home';
  const i = h.indexOf('/');
  return i === -1 ? { name: h, arg: '' } : { name: h.slice(0, i), arg: h.slice(i + 1) };
}

function tabBar(active) {
  const tabs = isStaff() ? TABS_STAFF : TABS_FIELD;
  const unread = KL.me?.unread || 0;
  const pend = KL.me?.pendingApprovals || 0;
  return `<nav class="tabbar">${tabs
    .map(([k, icon, label]) => `<a href="#${k}" class="${active === k ? 'on' : ''}">${ic(icon)}${label}${k === 'inbox' && unread ? `<span class="badge">${unread}</span>` : ''}${k === 'manage' && pend ? `<span class="badge">${pend}</span>` : ''}</a>`)
    .join('')}</nav>`;
}

function loginView() {
  const l = KL.ui.login;
  return `<div class="login">
    <img class="logo" src="./logo.png" alt="Sajeevan" />
    <p class="tagline">Field app · Kshetralekha</p>
    <div class="card stack">
      ${l.error ? `<div class="banner bad"><b>${esc(l.error)}</b></div>` : ''}
      <label class="field"><span>Employee ID</span><input id="login-emp" class="input" value="${esc(l.emp)}" placeholder="EMP101" autocapitalize="characters" autocomplete="username" data-input="loginEmp" /></label>
      <label class="field"><span>PIN</span><input id="login-pin" class="input pinbox" type="password" inputmode="numeric" value="${esc(l.pin)}" placeholder="••••" autocomplete="current-password" data-input="loginPin" /></label>
      <button type="button" class="btn primary wide" data-action="login" ${l.busy ? 'disabled' : ''}>${l.busy ? 'Signing in…' : 'Sign in'}</button>
      <p class="hint">Office staff will sign in with Microsoft here once the company tenant is connected. Forgotten PIN: ask HR to reset it.</p>
      <p class="hint">Prototype accounts, PIN 1234: EMP001 director · EMP002 manager · EMP003 HR · EMP101 biochar · EMP102 agroforestry · EMP103 gasifier.</p>
    </div></div>`;
}
Inputs.loginEmp = (el) => (KL.ui.login.emp = el.value);
Inputs.loginPin = (el) => (KL.ui.login.pin = el.value);
Actions.login = async () => {
  const l = KL.ui.login;
  l.busy = true; l.error = ''; render();
  try {
    const r = await api('/api/auth/login', { json: { employeeId: l.emp, pin: l.pin, device: deviceName() } });
    KL.token = r.token; KL.user = r.user;
    localStorage.setItem('kl.token', KL.token); localStorage.setItem('kl.user', JSON.stringify(KL.user));
    l.pin = ''; l.busy = false;
    await boot();
    location.hash = '#home';
    Outbox.flush();
  } catch (e) {
    l.busy = false; l.error = e.status === 0 ? 'No connection. Connect to the internet to sign in the first time.' : e.message;
  }
  render();
};
function deviceName() {
  const ua = navigator.userAgent;
  return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android phone' : /Windows/.test(ua) ? 'Windows PC' : /Mac/.test(ua) ? 'Mac' : 'Browser';
}

async function boot() {
  if (!KL.token) return;
  try {
    const [me, b] = await Promise.all([api('/api/me'), api('/api/bootstrap')]);
    KL.me = me; KL.user = me.user; KL.boot = b;
    localStorage.setItem('kl.user', JSON.stringify(KL.user)); localStorage.setItem('kl.boot', JSON.stringify(b));
  } catch (e) {
    if (e.status === 401) return;
    KL.boot = KL.boot || JSON.parse(localStorage.getItem('kl.boot') || 'null'); // offline: last known lists
  }
}

const NEEDS_GPS = new Set(['attendance', 'trips', 'registers', 'sign', 'farmers']);

function render() {
  const app = $('#app');
  if (!KL.token || !KL.user) { app.innerHTML = loginView(); return; }
  if (!KL.boot) { app.innerHTML = `<div class="login"><img class="logo" src="./logo.png" alt="Sajeevan" />${spinner('Loading your sites and settings…')}<p class="hint" style="text-align:center">Needs a connection the first time. <button type="button" class="btn small ghost" data-action="retryBoot">Retry</button> · <button type="button" class="btn small ghost" data-action="logout">Sign out</button></p></div>`; return; }
  const { name, arg } = route();
  let view = Views[name] ? name : 'home';
  if (STAFF_ROUTES.has(view) && !isStaff()) view = 'home';
  if (NEEDS_GPS.has(view)) locate();
  // keep the signature across re-renders (the canvas is rebuilt with the DOM)
  const sigKeep = KL.sig && $('#sig') && !KL.sig.isEmpty() ? KL.sig.dataUrl() : null;
  const scroll = window.scrollY;
  app.innerHTML = Views[view](arg) + tabBar(TAB_OF[view] || view);
  const canvas = $('#sig');
  if (canvas) {
    KL.sig = signaturePad(canvas);
    if (sigKeep) { const im = new Image(); im.onload = () => { canvas.getContext('2d').drawImage(im, 0, 0, canvas.width / (devicePixelRatio || 1), canvas.height / (devicePixelRatio || 1)); KL.sig.restored = true; }; im.src = sigKeep; KL.sig.isEmpty = () => false; }
  } else KL.sig = null;
  loadAuthImages();
  window.scrollTo(0, scroll);
}
Actions.retryBoot = async () => { await boot(); render(); };

function bindEvents() {
  const app = $('#app');
  app.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const fn = Actions[el.dataset.action];
    if (fn) { e.preventDefault(); fn(el, e); }
  });
  app.addEventListener('change', (e) => { const el = e.target.closest('[data-change]'); const fn = el && Changes[el.dataset.change]; if (fn) fn(el, e); });
  app.addEventListener('input', (e) => { const el = e.target.closest('[data-input]'); const fn = el && Inputs[el.dataset.input]; if (fn) fn(el, e); });
  app.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'login-pin') Actions.login(); });
  window.addEventListener('hashchange', () => { if (route().name !== 'sign') KL.sig = null; render(); });
  window.addEventListener('online', () => { Outbox.flush(); render(); });
  window.addEventListener('offline', () => render());
  document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible' && KL.token) { await refreshMe(); Outbox.flush(); render(); } });
}

(async function start() {
  bindEvents();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
  render();
  if (KL.token) {
    await boot();
    KL.outboxCount = (await Outbox.all().catch(() => [])).length;
    render();
    Outbox.flush();
    setInterval(async () => { if (document.visibilityState === 'visible' && KL.token) { const before = KL.me?.unread; await refreshMe(); if (KL.me?.unread !== before) render(); } }, 60000);
  }
})();
