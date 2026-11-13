/* Kshetralekha: routing, sign-in, navigation (tab bar on phones, sidebar on computers), the prototype's
   person switch, event wiring and start-up. */

const TABS_FIELD = [['home', 'home', 'Home'], ['work', 'work', 'Work'], ['tasks', 'kanban', 'Tasks'], ['inbox', 'bell', 'Inbox'], ['me', 'user', 'Me']];
const TABS_STAFF = [['home', 'home', 'Home'], ['planner', 'kanban', 'Planner'], ['manage', 'manage', 'Manage'], ['inbox', 'bell', 'Inbox'], ['me', 'user', 'Me']];
const TAB_OF = { attendance: 'work', trips: 'work', registers: 'work', farmers: 'work', sign: 'work', updates: 'me', leaves: 'me', feedback: 'me', dashboard: 'manage', approvals: 'manage', team: 'manage', hrdesk: 'manage', admin: 'manage' };
const STAFF_ROUTES = new Set(['manage', 'dashboard', 'approvals', 'team', 'hrdesk', 'admin']);
const NEEDS_GPS = new Set(['attendance', 'trips', 'registers', 'sign', 'farmers']);

function route() {
  const h = location.hash.replace(/^#/, '') || 'home';
  const i = h.indexOf('/');
  return i === -1 ? { name: h, arg: '' } : { name: h.slice(0, i), arg: h.slice(i + 1) };
}
function tabOf(view) {
  if (view === 'planner' || view === 'tasks') return isStaff() ? 'planner' : 'tasks';
  return TAB_OF[view] || view;
}
function badgeFor(k) {
  const unread = KL.me?.unread || 0;
  const pend = KL.me?.pendingApprovals || 0;
  if (k === 'inbox' && unread) return `<span class="badge">${unread}</span>`;
  if (k === 'manage' && pend) return `<span class="badge">${pend}</span>`;
  return '';
}
function tabBar(active) {
  const tabs = isStaff() ? TABS_STAFF : TABS_FIELD;
  return `<nav class="tabbar" aria-label="Main">${tabs.map(([k, icon, label]) => `<a href="#${k}" class="${active === k ? 'on' : ''}">${ic(icon)}${label}${badgeFor(k)}</a>`).join('')}</nav>`;
}
function sideNav(active) {
  const u = KL.user;
  const tabs = isStaff() ? [...TABS_STAFF.slice(0, 2), ['work', 'work', 'Field work'], ...TABS_STAFF.slice(2)] : TABS_FIELD;
  const quick = [['attendance', 'pin', 'Site check-in'], ['trips', 'bike', 'Travel'], ['registers', 'box', 'Site registers'], ['farmers', 'sprout', 'Farmers'], ['updates', 'note', 'Daily update']];
  const link = ([k, icon, label]) => `<a class="nav ${active === k ? 'on' : ''}" href="#${k}">${ic(icon)}<span>${label}</span>${badgeFor(k)}</a>`;
  return `<aside class="side" aria-label="Navigation">
    <a class="brand" href="#home"><img src="./icon.svg" alt="" /><span><b>Kshetralekha</b><small>${esc(KL.boot?.company?.short || 'Sajeevan')} · field app</small></span></a>
    ${tabs.map(link).join('')}
    <div class="sep"></div><div class="label">Quick</div>
    ${quick.map(link).join('')}
    <div class="foot-card">${KL.boot?.demo ? `<b style="color:var(--violet);font-size:12px;letter-spacing:.08em">PROTOTYPE</b>` : ''}
      <div class="me-chip">${avatar(u.name)}<span style="flex:1;min-width:0"><b style="color:var(--ink);display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(u.name)}</b>${esc(ROLE_TEXT[u.role] || u.role)}</span></div>
      ${KL.boot?.demo ? `<button type="button" class="btn small wide" style="margin-top:10px" data-action="switchOpen">${ic('swap')} View as someone else</button>` : ''}
    </div>
  </aside>`;
}
function switcherPill() {
  if (!KL.boot?.demo) return '';
  const u = KL.user;
  return `<button type="button" class="switcher" data-action="switchOpen" aria-label="View the app as someone else">${avatar(u.name, 'sm')}<span>${esc(firstName(u.name))}</span><span class="role">${esc(ROLE_TEXT[u.role] || u.role)}</span>${ic('swap')}</button>`;
}

/* ---------------------------------------------------------------- sign-in */
function loginView() {
  const l = KL.ui.login;
  const demo = KL.demoInfo && KL.demoInfo.demo;
  return `<div class="auth">
    <section class="top">
      <svg class="rows" viewBox="0 0 400 120" preserveAspectRatio="none" aria-hidden="true"><path d="M-10 70c70-30 140-42 210-42s140 12 210 42" fill="none" stroke="rgba(244,239,223,.18)" stroke-width="10"/><path d="M-10 104c70-24 140-34 210-34s140 10 210 34" fill="none" stroke="rgba(244,239,223,.1)" stroke-width="9"/></svg>
      <div class="brand"><img src="./icon.svg" alt="" /><span><b>Kshetralekha</b><small>BY SAJEEVAN · FIELD APP</small></span></div>
      <h1>Every field day, <em>on record.</em></h1>
      <p class="lede">Site check-ins, travel, stock registers, farmer agreements and team tasks in one app. It keeps working without signal.</p>
      <img class="floaty" src="./icon.svg" alt="" />
    </section>
    <div class="panel"><div class="card stack">
      ${demo ? `<div><b style="font-family:var(--display);font-size:20px;letter-spacing:-.01em">Try the prototype</b><p class="hint">Tap a person to sign in as them. You can switch person any time.</p></div>
      <div class="demo-people">${KL.demoInfo.people.map((p) => `<button type="button" data-action="demoLogin" data-emp="${esc(p.employee_id)}">${avatar(p.name)}<span style="min-width:0"><b>${esc(p.name)}</b><small>${esc(ROLE_TEXT[p.role] || p.role)}${p.designation ? ` · ${esc(p.designation)}` : ''}</small></span></button>`).join('')}</div>
      <div class="or"><span></span>or sign in with your PIN<span></span></div>` : ''}
      ${window.KL_LOCAL ? `<div class="banner info">${ic('shield')}<div><b>Runs entirely on this phone</b><p>This online demo has no server: the app and its sample data live in this browser. Nothing you enter leaves the device.</p></div></div>` : ''}
      ${l.error ? `<div class="banner bad">${ic('alert')}<div><b>${esc(l.error)}</b></div></div>` : ''}
      <label class="field"><span>Employee ID</span><input id="login-emp" class="input" value="${esc(l.emp)}" placeholder="EMP101" autocapitalize="characters" autocomplete="username" data-input="loginEmp" /></label>
      <label class="field"><span>PIN</span><input id="login-pin" class="input pinbox" type="password" inputmode="numeric" value="${esc(l.pin)}" placeholder="••••" autocomplete="current-password" data-input="loginPin" /></label>
      <button type="button" class="btn primary wide ${l.busy ? 'busy' : ''}" data-action="login" ${l.busy ? 'disabled' : ''}>${l.busy ? 'Signing in' : 'Sign in'}</button>
      <p class="hint">Office staff will sign in with Microsoft here once the company tenant is connected. Forgotten PIN: ask HR to reset it.</p>
    </div>
    <div class="partner"><span>An app of</span><img src="./logo.png" alt="Sajeevan" /></div></div>
  </div>`;
}
Inputs.loginEmp = (el) => (KL.ui.login.emp = el.value);
Inputs.loginPin = (el) => (KL.ui.login.pin = el.value);
async function signIn(employeeId, pin) {
  const l = KL.ui.login;
  l.busy = true; l.error = ''; render();
  try {
    const r = await api('/api/auth/login', { json: { employeeId, pin, device: deviceName() } });
    l.pin = ''; l.busy = false;
    await signedIn(r);
  } catch (e) {
    l.busy = false; l.error = e.status === 0 ? 'No connection. Connect to the internet to sign in the first time.' : e.message;
    render();
  }
}
/** After any sign-in (PIN, demo tap or person switch): fresh state, load lists, go Home. */
async function signedIn(r) {
  closeCamera();
  KL.token = r.token; KL.user = r.user;
  KL.cache = {}; KL.stale = {}; KL.ui.photos = {}; KL.ui.forms = {}; KL.ui.gps = null; KL.ui.sheetTask = null; KL.ui.completing = null; KL.ui.signed = null;
  localStorage.setItem('kl.token', KL.token); localStorage.setItem('kl.user', JSON.stringify(KL.user));
  await boot();
  KL.lastRoute = '';
  if (location.hash === '#home' || !location.hash) render(); else location.hash = '#home';
  Outbox.flush();
}
Actions.login = () => signIn(KL.ui.login.emp, KL.ui.login.pin);
Actions.demoLogin = (el) => signIn(el.dataset.emp, KL.demoInfo?.pin || '1234');
function deviceName() {
  const ua = navigator.userAgent;
  return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android phone' : /Windows/.test(ua) ? 'Windows PC' : /Mac/.test(ua) ? 'Mac' : 'Browser';
}

/* ---------------------------------------------------------------- prototype: view as someone else */
Actions.switchOpen = async () => {
  const d = KL.demoInfo && KL.demoInfo.people?.length ? KL.demoInfo : await api('/api/demo').catch(() => null);
  if (d) KL.demoInfo = d;
  const people = d?.people || [];
  const me = KL.user.employee_id;
  const html = `<p class="muted" style="margin-top:0">Prototype only. Switch to a manager to assign work, or to a field worker to do it, and watch the other side update.</p>
    <div class="people-pick">${people.map((p) => `<button type="button" data-action="switchTo" data-emp="${esc(p.employee_id)}" class="${p.employee_id === me ? 'on' : ''}">${avatar(p.name, 'lg')}<span class="tx"><b>${esc(p.name)}</b><small>${esc(ROLE_TEXT[p.role] || p.role)}${p.designation ? ` · ${esc(p.designation)}` : ''} · ${esc(p.employee_id)}</small></span>${p.employee_id === me ? tag('You now', 'ok') : `<span class="chev">${ic('chevron')}</span>`}</button>`).join('')}</div>`;
  modal({ title: 'View the app as…', html, noButtons: true });
};
Actions.switchTo = async (el) => {
  if (el.dataset.emp === KL.user.employee_id) { KL.closeModal?.(null); return; }
  el.classList.add('busy');
  try {
    const r = await api('/api/demo/switch', { json: { employeeId: el.dataset.emp } });
    KL.closeModal?.(null);
    await signedIn(r);
    toast(`Now viewing as ${firstName(r.user.name)} · ${ROLE_TEXT[r.user.role] || r.user.role}`);
  } catch (e) { el.classList.remove('busy'); toast(e.message, 'error'); }
};
Actions.demoLoc = (el) => { DemoLoc.set(el.dataset.mode); KL.ui.gps = null; KL.ui.gpsError = ''; locate(true); };
Actions.theme = (el) => { try { localStorage.setItem('kl.theme', el.dataset.theme); } catch { /* private mode */ } applyTheme(); render(); };

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

/* ---------------------------------------------------------------- render */
function hideSplash() {
  const s = $('#splash');
  if (!s || s.dataset.going) return;
  s.dataset.going = '1';
  setTimeout(() => { s.classList.add('gone'); setTimeout(() => s.remove(), 500); }, Math.max(0, 700 - performance.now()));
}
function render() {
  const app = $('#app');
  const signedOut = !KL.token || !KL.user;
  document.body.classList.toggle('signed-out', signedOut);
  if (signedOut) { app.innerHTML = loginView(); renderTaskSheet(); hideSplash(); return; }
  if (!KL.boot) {
    app.innerHTML = `<div class="auth"><div class="panel" style="margin-top:20vh"><div class="card stack" style="text-align:center"><img src="./icon.svg" alt="" style="width:64px;margin:0 auto;border-radius:18px" /><b>Loading your sites and settings…</b>${spinner()}<p class="hint">Needs a connection the first time.</p><div class="btns"><button type="button" class="btn" data-action="retryBoot">Retry</button><button type="button" class="btn ghost" data-action="logout">Sign out</button></div></div></div></div>`;
    return;
  }
  let { name, arg } = route();
  if (name === 'task' && arg) {
    if (KL.ui.sheetTask !== arg) { KL.ui.sheetTask = arg; KL.ui.completing = null; invalidate(`planner:task:${arg}`); locate(); }
    name = isStaff() ? 'planner' : 'tasks'; arg = '';
  }
  let view = Views[name] ? name : 'home';
  if (STAFF_ROUTES.has(view) && !isStaff()) view = 'home';
  if (view === 'hrdesk' && !['admin', 'hr'].includes(KL.user.role)) view = 'manage';
  if (NEEDS_GPS.has(view)) locate();
  const entering = KL.lastRoute !== location.hash;
  KL.lastRoute = location.hash;
  if (entering) { KL.seenCounts = new Set(); KL.ui.previewFn = null; }
  // keep the signature across re-renders (the canvas is rebuilt with the DOM)
  const sigKeep = KL.sig && $('#sig') && !KL.sig.isEmpty() ? KL.sig.dataUrl() : null;
  const scroll = entering ? 0 : window.scrollY;
  const boardX = entering ? 0 : $('.board')?.scrollLeft || 0;
  const tab = tabOf(view);
  app.innerHTML = `${sideNav(tab)}<main class="view ${entering ? 'enter' : ''}" id="main">${Views[view](arg)}</main>${tabBar(tab)}${switcherPill()}`;
  const canvas = $('#sig');
  if (canvas) {
    KL.sig = signaturePad(canvas);
    if (sigKeep) { const im = new Image(); im.onload = () => { canvas.getContext('2d').drawImage(im, 0, 0, canvas.width / (devicePixelRatio || 1), canvas.height / (devicePixelRatio || 1)); KL.sig.restored = true; }; im.src = sigKeep; KL.sig.isEmpty = () => false; }
  } else KL.sig = null;
  if (boardX && $('.board')) $('.board').scrollLeft = boardX;
  if (typeof applyPlanFilter === 'function' && F('pl-q', '')) applyPlanFilter();
  loadAuthImages();
  countUp(app);
  window.scrollTo(0, scroll);
  renderTaskSheet();
  hideSplash();
}
Actions.retryBoot = async () => { await boot(); render(); };

function bindEvents() {
  const roots = [$('#app'), $('#modal'), $('#sheet')];
  for (const root of roots) {
    root.addEventListener('click', (e) => {
      if (root.id === 'sheet' && e.target === root) return Actions.taskClose();
      const el = e.target.closest('[data-action]');
      if (!el || el.disabled || !root.contains(el)) return;
      const fn = Actions[el.dataset.action];
      if (fn) { e.preventDefault(); e.stopPropagation(); fn(el, e); }
    });
    root.addEventListener('change', (e) => { const el = e.target.closest('[data-change]'); const fn = el && Changes[el.dataset.change]; if (fn) fn(el, e); });
    root.addEventListener('input', (e) => { const el = e.target.closest('[data-input]'); const fn = el && Inputs[el.dataset.input]; if (fn) fn(el, e); });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if ($('#cam')) return closeCamera();
      if (!$('#modal').hidden) return KL.closeModal?.(null);
      if (KL.ui.sheetTask) return Actions.taskClose();
    }
    if (e.key !== 'Enter') return;
    const id = e.target.id;
    if (id === 'login-pin') Actions.login();
    else if (id === 'tc-text') { e.preventDefault(); Actions.taskComment(); }
    else if (id === 'tc-item') { e.preventDefault(); Actions.taskCheckAdd(); }
    else if (e.target.matches?.('[role="button"][data-action]')) { e.preventDefault(); e.target.click(); }
  });
  window.addEventListener('hashchange', () => { if (route().name !== 'sign') KL.sig = null; if (route().name !== 'task' && KL.ui.sheetTask && KL.lastRoute?.startsWith('#task/')) KL.ui.sheetTask = null; render(); });
  window.addEventListener('online', () => { Outbox.flush(); render(); });
  window.addEventListener('offline', () => render());
  document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible' && KL.token) { await refreshMe(); Outbox.flush(); render(); } });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
}

(async function start() {
  applyTheme();
  bindEvents();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
  KL.demoInfo = await api('/api/demo').catch(() => null);
  render();
  if (KL.token) {
    await boot();
    KL.outboxCount = (await Outbox.all().catch(() => [])).length;
    render();
    Outbox.flush();
  }
  setInterval(() => { for (const el of $$('[data-since]')) el.textContent = duration(el.dataset.since); }, 30000);
  setInterval(async () => { if (document.visibilityState === 'visible' && KL.token) { const before = `${KL.me?.unread}/${KL.me?.pendingApprovals}`; await refreshMe(); if (`${KL.me?.unread}/${KL.me?.pendingApprovals}` !== before) { invalidate('inbox', 'planner'); render(); } } }, 30000);
})();
