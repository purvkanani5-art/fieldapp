/* Kshetralekha: routing, sign-in, navigation (tab bar on phones, sidebar on computers), the prototype's
   person switch, event wiring and start-up. */

const TABS_FIELD_ALL = [['home', 'home', 'Today'], ['mysite', 'pin', 'Site'], ['+', 'plus', 'Add'], ['requests', 'receipt', 'Requests'], ['me', 'user', 'Me']];
const TABS_STAFF = [['home', 'home', 'Home'], ['sites', 'pin', 'Sites'], ['planner', 'kanban', 'Planner'], ['hr', 'users', 'People'], ['inbox', 'bell', 'Inbox']];
const fieldTabs = () => TABS_FIELD_ALL.filter(([k]) => k !== 'mysite' || (KL.boot?.mySites || []).some((s) => s.project_type !== 'office'));
const TAB_OF = { attendance: 'work', trips: 'work', registers: 'work', farmers: 'work', sign: 'work', updates: 'me', leaves: 'me', feedback: 'me', dashboard: 'manage', approvals: 'manage', team: 'manage', hrdesk: 'manage', admin: 'manage',
  people: 'manage', personedit: 'manage', reports: 'manage', hrsettings: 'manage', messages: 'manage', privacy: 'me', security: 'me',
  notices: 'me', notice: 'me', surveys: 'me', survey: 'me', changes: 'me', poshdesk: 'me' };
const FIELD_ONLY = new Set(['requests']);
const STAFF_ROUTES = new Set(['manage', 'dashboard', 'approvals', 'team', 'hrdesk', 'admin', 'people', 'personedit', 'reports', 'hrsettings', 'messages', 'hr', 'assign', 'monthend', 'hrreg', 'noticenew']);
const NEEDS_GPS = new Set(['attendance', 'trips', 'registers', 'sign', 'farmers']);

const SECTION_LABEL = {'home': 'Home', 'sites': 'Sites', 'mysite': 'My site', 'planner': 'Planner', 'tasks': 'My tasks', 'hr': 'People', 'me': 'Me', 'inbox': 'Inbox', 'manage': 'Manage'};
function route() {
  const h = location.hash.replace(/^#/, '') || 'home';
  const i = h.indexOf('/');
  return i === -1 ? { name: h, arg: '' } : { name: h.slice(0, i), arg: h.slice(i + 1) };
}
const SITE_VIEWS = new Set(['site', 'sites', 'mysite', 'work', 'registers', 'farmers', 'sign', 'carbon', 'map', 'muster']);
const PEOPLE_VIEWS = new Set(['hr', 'hub', 'people', 'person', 'personedit', 'assign', 'attsum', 'monthend', 'hrreg', 'changes', 'notices', 'notice', 'noticenew', 'surveys', 'survey', 'surveynew', 'poshdesk', 'hrsettings', 'messages', 'approvals', 'team', 'hrdesk', 'admin', 'manage', 'reports', 'dashboard', 'me', 'updates', 'leaves', 'feedback', 'privacy', 'security']);
const FIELD_TAB = { home: 'home', tasks: 'home', inbox: 'home', attendance: 'home', updates: 'home', task: 'home', notice: 'me', notices: 'me', survey: 'me', surveys: 'me',
  mysite: 'mysite', site: 'mysite', muster: 'mysite', registers: 'mysite', farmers: 'mysite', sign: 'mysite', map: 'mysite', carbon: 'mysite',
  requests: 'requests', leaves: 'requests', trips: 'requests', me: 'me', person: 'me', attsum: 'me', feedback: 'me', settings: 'me', privacy: 'me', security: 'me', changes: 'me', poshdesk: 'me', hr: 'me', hub: 'me' };
function tabOf(view) {
  if (KL.user && KL.user.role === 'field') {
    if (view === 'rec') { const k = kindDef(route().arg.split('/')[0]); return k && ['expense', 'advance', 'regularisation'].includes(k.key) ? 'requests' : k && ['hr', 'money'].includes(k.group) ? 'me' : 'mysite'; }
    return FIELD_TAB[view] || 'home';
  }
  if (view === 'planner' || view === 'tasks') return isStaff() ? 'planner' : 'tasks';
  if (view === 'rec') { const k = kindDef(route().arg.split('/')[0]); view = k && ['hr', 'money'].includes(k.group) ? 'hr' : 'site'; }
  if (SITE_VIEWS.has(view) || view === 'site') return isStaff() ? 'sites' : 'mysite';
  if (PEOPLE_VIEWS.has(view)) return isStaff() ? 'hr' : (['hr', 'hub', 'person', 'attsum'].includes(view) ? 'me' : TAB_OF[view] || view);
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
  const tabs = isStaff() ? TABS_STAFF : fieldTabs();
  return `<nav class="tabbar ${isStaff() ? '' : 'fa-tabbar'}" aria-label="Main">${tabs.map(([k, icon, label]) => (k === '+' ? `<button type="button" class="fa-plus" data-action="plusOpen" aria-label="Add something new">${ic('plus')}</button>` : `<a href="#${k}" class="${active === k ? 'on' : ''}" ${active === k ? 'aria-current="page"' : ''}>${ic(icon)}<span>${label}</span>${badgeFor(k)}</a>`)).join('')}</nav>`;
}
/** Desktop sidebar, grouped by area. Each item shows only for roles that may open it (the same guards as render()). */
function navGroups() {
  const staff = isStaff();
  if (!staff) {
    const hasSiteF = (KL.boot?.mySites || []).some((s) => s.project_type !== 'office');
    return [[null, [['home', 'home', 'Today'], ...(hasSiteF ? [['mysite', 'pin', 'Site']] : []), ['requests', 'receipt', 'Requests'], ['me', 'user', 'Me']]],
      ['More', [['tasks', 'kanban', 'My tasks'], ['inbox', 'bell', 'Messages', KL.me?.unread || 0], ['attendance', 'pin', 'Check-in'], ['updates', 'note', 'Daily update']]]];
  }
  const hrRole = ['admin', 'hr'].includes(KL.user.role);
  const pend = KL.me?.pendingApprovals || 0;
  const unread = KL.me?.unread || 0;
  const hasSite = (KL.boot?.mySites || []).some((s) => s.project_type !== 'office');
  const g = [
    [null, [['home', 'home', 'Home']]],
    ['My work', [[staff ? 'planner' : 'tasks', 'kanban', staff ? 'Planner' : 'My tasks'], ['inbox', 'bell', 'Inbox', unread], ['attendance', 'pin', 'Check-in'], ['updates', 'note', 'Daily update'],
      ['leaves', 'sun', 'Leave'], ['trips', 'bike', 'Travel'], ['rec/expense', 'receipt', 'Expenses']]],
    staff ? ['Team', [['approvals', 'check', 'Approvals', pend], ['team', 'clock', 'Team activity'], ['attsum', 'calendar', 'Attendance']]] : null,
    ['People & HR', staff
      ? [['hr', 'users', 'People'], ['people', 'user', 'Directory'], ['monthend', 'lock', 'Month end'], ['hrreg', 'list', 'Registers'], ['changes', 'clock', 'Change log'],
        ...(hrRole ? [['hrdesk', 'folder', 'HR desk']] : []), ['notices', 'bell', 'Notices'], ['surveys', 'chart', 'Surveys'], ['rec/policy', 'doc', 'Policies']]
      : [['person/me', 'user', 'My record'], ['attsum', 'calendar', 'Attendance'], ['notices', 'bell', 'Notices'], ['surveys', 'chart', 'Surveys'], ['feedback', 'chat', 'Complaints'], ['rec/policy', 'doc', 'Policies']]],
    ['Operations', [...(staff || hasSite ? [[staff ? 'sites' : 'mysite', 'pin', staff ? 'Sites' : 'My site']] : []), ['map', 'map', 'Map'], ...(staff ? [['carbon', 'leaf', 'Carbon chain'], ['hub/supply', 'box', 'Purchasing']] : [])]],
    staff ? ['Reports', [['reports', 'chart', 'Reports']]] : null,
    staff ? ['Admin', [['admin', 'cog', 'Administration'], ...(hrRole ? [['hrsettings', 'cog', 'HR settings']] : [])]] : null,
  ];
  return g.filter(Boolean);
}
function sideNav(active) {
  const u = KL.user;
  const cur = location.hash.replace('#', '') || 'home';
  const pm = KL.boot?.projects || {};
  const ms = (KL.boot?.mySites || []).filter((s) => s.project_type !== 'office');
  const tree = Object.entries(pm).map(([key, p]) => [p, ms.filter((s) => s.project_type === key)]).filter(([, l]) => l.length);
  const on = (k) => cur === k || cur.startsWith(`${k}/`) || (k === active && !navGroups().some(([, items]) => items.some(([x]) => x !== k && (cur === x || cur.startsWith(`${x}/`)))));
  const link = ([k, icon, label, badge]) => `<a class="nav ${on(k) ? 'on' : ''}" href="#${k}" title="${esc(label)}" ${on(k) ? 'aria-current="page"' : ''}>${ic(icon)}<span>${esc(label)}</span>${badge ? `<span class="badge">${badge}</span>` : ''}</a>`;
  return `<aside class="side" aria-label="Main navigation">
    <div class="side-top"><a class="brand" href="#home"><img src="./icon.svg" alt="" /><span><b>Kshetralekha</b><small>${esc(KL.boot?.company?.short || 'Sajeevan')}</small></span></a>
      <button type="button" class="btn ghost icon-only side-toggle" data-action="sideToggle" aria-label="Collapse the menu" title="Collapse the menu">${ic('back')}</button></div>
    <nav class="side-nav">${navGroups().map(([title, items]) => `<div class="nav-group">${title ? `<div class="label">${esc(title)}</div>` : ''}${items.map(link).join('')}${title === 'Operations' ? tree.map(([p, list]) => `<div class="nav-tree"><span class="tree-label">${ic(p.icon)}<span>${esc(p.name)}</span></span>${list.map((s) => `<a class="nav sub ${cur.startsWith(`site/${s.id}`) ? 'on' : ''}" href="#site/${esc(s.id)}" title="${esc(s.name)}"><span>${esc(s.name)}</span></a>`).join('')}</div>`).join('') : ''}</div>`).join('')}</nav>
    <div class="side-foot">
      <a class="me-chip ${cur === 'me' ? 'on' : ''}" href="#me">${avatar(u.name, 'sm')}<span><b>${esc(u.name)}</b><small>${esc(ROLE_TEXT[u.role] || u.role)}</small></span></a>
      ${KL.boot?.demo ? `<button type="button" class="btn small wide" data-action="switchOpen">${ic('swap')}<span>View as someone else</span></button>` : ''}
    </div>
  </aside>`;
}
Actions.sideToggle = () => { const mini = !document.body.classList.contains('side-mini'); document.body.classList.toggle('side-mini', mini); try { localStorage.setItem('kl.side', mini ? 'mini' : ''); } catch { /* private */ } };
try { if (localStorage.getItem('kl.side') === 'mini') document.body.classList.add('side-mini'); } catch { /* private */ }
function switcherPill() {
  if (!KL.boot?.demo) return '';
  const u = KL.user;
  return `<button type="button" class="switcher" data-action="switchOpen" aria-label="View the app as someone else">${avatar(u.name, 'sm')}<span>${esc(firstName(u.name))}</span><span class="role">${esc(ROLE_TEXT[u.role] || u.role)}</span>${ic('swap')}</button>`;
}

/* ---------------------------------------------------------------- sign-in */
function loginView() {
  const l = KL.ui.login;
  const demo = KL.demoInfo && KL.demoInfo.demo;
  const byRole = demo ? ['admin', 'manager', 'hr', 'field'].map((r) => [r, KL.demoInfo.people.filter((p) => p.role === r)]).filter(([, list]) => list.length) : [];
  return `<div class="auth">
    <section class="top">
      <div class="brand"><img src="./icon.svg" alt="" /><span><b>Kshetralekha</b><small>Sajeevan Life · field operations and HR</small></span></div>
      <h1>Sign in</h1>
      <p class="lede">Attendance, site records, approvals and HR in one place. Works without signal; anything saved offline is sent when you are back online.</p>
    </section>
    <div class="panel">
      ${window.KL_LOCAL ? `<div class="banner info">${ic('shield')}<div><b>Runs entirely on this phone</b><p>This online demo has no server: the app and its sample data live in this browser. Nothing you enter leaves the device.</p></div></div>` : ''}
      <div class="card stack">
        ${l.error ? `<div class="banner bad" role="alert">${ic('alert')}<div><b>${esc(l.error)}</b></div></div>` : ''}
        ${field('Employee ID', `<input id="login-emp" class="input" value="${esc(l.emp)}" placeholder="EMP101" autocapitalize="characters" autocomplete="username" data-input="loginEmp" />`)}
        ${field('PIN', `<input id="login-pin" class="input pinbox" type="password" inputmode="numeric" value="${esc(l.pin)}" placeholder="••••" autocomplete="current-password" data-input="loginPin" />`, { help: 'Forgotten PIN: ask HR to reset it.' })}
        ${l.need2fa ? field('Code from your authenticator app', `<input id="login-code" class="input pinbox" inputmode="numeric" value="${esc(l.code || '')}" placeholder="123456" autocomplete="one-time-code" data-input="loginCode" />`) : ''}
        <button type="button" class="btn primary wide ${l.busy ? 'busy' : ''}" data-action="login" ${l.busy ? 'disabled' : ''}>${l.busy ? 'Signing in' : 'Sign in'}</button>
        <p class="hint">Office staff will sign in with Microsoft here once the company tenant is connected.</p>
      </div>
      ${demo ? `<div class="card stack demo-card"><div><b class="card-title">Try the prototype</b><p class="hint">Choose a person to sign in as them. You can switch person at any time.</p></div>
        ${byRole.map(([r, list]) => `<div class="demo-group"><span class="demo-role">${esc(ROLE_TEXT[r] || r)}</span><div class="demo-people">${list.map((p) => `<button type="button" data-action="demoLogin" data-emp="${esc(p.employee_id)}">${avatar(p.name, 'sm')}<span style="min-width:0"><b>${esc(p.name)}</b><small>${esc(p.designation || ROLE_TEXT[p.role] || p.role)}</small></span></button>`).join('')}</div></div>`).join('')}
        <p class="hint">Reviewers: this web prototype leaves out what only the phone app can do (push notifications, background location). See Me → For reviewers.</p></div>` : ''}
      <div class="partner"><span>An app of</span><img src="./logo.png" alt="Sajeevan" /></div>
    </div>
  </div>`;
}
Inputs.loginEmp = (el) => (KL.ui.login.emp = el.value);
Inputs.loginPin = (el) => (KL.ui.login.pin = el.value);
Inputs.loginCode = (el) => (KL.ui.login.code = el.value);
async function signIn(employeeId, pin) {
  const l = KL.ui.login;
  l.busy = true; l.error = ''; render();
  try {
    const r = await api('/api/auth/login', { json: { employeeId, pin, device: deviceName(), code: l.need2fa ? l.code || '' : undefined } });
    l.pin = ''; l.busy = false; l.need2fa = false; l.code = '';
    await signedIn(r);
  } catch (e) {
    l.busy = false; l.error = e.status === 0 ? 'No connection. Connect to the internet to sign in the first time.' : e.message;
    if (e.data && e.data.need2fa) { l.need2fa = true; l.emp = employeeId; l.pin = pin; }
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
Actions.demoLogin = (el) => { KL.ui.login.need2fa = false; signIn(el.dataset.emp, KL.demoInfo?.pin || '1234'); };
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
  document.body.classList.toggle('field-ui', Boolean(KL.user && KL.user.role === 'field'));
  if (signedOut) { app.innerHTML = loginView(); renderTaskSheet(); hideSplash(); return; }
  if (!KL.boot) {
    app.innerHTML = `<div class="auth"><div class="panel" style="margin-top:20vh"><div class="card stack" style="text-align:center"><img src="./icon.svg" alt="" style="width:64px;margin:0 auto;border-radius:18px" /><b>Loading your sites and settings…</b>${spinner()}<p class="hint">Needs a connection the first time.</p><div class="btns"><button type="button" class="btn" data-action="retryBoot">Retry</button><button type="button" class="btn ghost" data-action="logout">Sign out</button></div></div></div></div>`;
    return;
  }
  if (!KL.user.consent_at && KL.boot.demo !== undefined) { app.innerHTML = consentView(); hideSplash(); return; }
  let { name, arg } = route();
  if (name === 'task' && arg) {
    if (KL.ui.sheetTask !== arg) { KL.ui.sheetTask = arg; KL.ui.completing = null; invalidate(`planner:task:${arg}`); locate(); }
    name = isStaff() ? 'planner' : 'tasks'; arg = '';
  }
  let view = Views[name] ? name : 'home';
  if (STAFF_ROUTES.has(view) && !isStaff()) view = 'home';
  if (FIELD_ONLY.has(view) && isStaff()) view = 'me';
  if (view === 'hrdesk' && !['admin', 'hr'].includes(KL.user.role)) view = 'manage';
  if (['surveynew', 'hrsettings', 'personedit'].includes(view) && !['admin', 'hr'].includes(KL.user.role)) view = isStaff() ? 'manage' : 'home';
  if (NEEDS_GPS.has(view)) locate();
  const entering = KL.lastRoute !== location.hash;
  KL.lastRoute = location.hash;
  if (entering) { KL.seenCounts = new Set(); KL.ui.previewFn = null; }
  // keep the signature across re-renders (the canvas is rebuilt with the DOM)
  const sigKeep = KL.sig && $('#sig') && !KL.sig.isEmpty() ? KL.sig.dataUrl() : null;
  const scroll = entering ? 0 : window.scrollY;
  const boardX = entering ? 0 : $('.board')?.scrollLeft || 0;
  const tab = tabOf(view);
  KL.ui.section = { href: `#${tab}`, label: SECTION_LABEL[tab] || tab };
  KL.ui.backLabel = '';
  // record details open in a drawer beside their list on wide screens; on phones they are a full screen
  const [rk, rid, rmode] = view === 'rec' ? String(arg).split('/') : [];
  const drawer = view === 'rec' && rid && rid !== 'new' && !rmode && innerWidth >= 1040;
  const main = drawer ? Views.rec(rk) : Views[view](arg);
  const side = drawer ? drawerShell(Views.rec(arg), `#rec/${rk}`) : '';
  app.innerHTML = `${sideNav(tab)}<main class="view ${entering ? 'enter' : ''}" id="main">${main}</main>${side}${tabBar(tab)}${switcherPill()}`;
  document.body.classList.toggle('has-drawer', Boolean(drawer));
  const canvas = $('#sig');
  if (canvas) {
    KL.sig = signaturePad(canvas);
    if (sigKeep) { const im = new Image(); im.onload = () => { canvas.getContext('2d').drawImage(im, 0, 0, canvas.width / (devicePixelRatio || 1), canvas.height / (devicePixelRatio || 1)); KL.sig.restored = true; }; im.src = sigKeep; KL.sig.isEmpty = () => false; }
  } else KL.sig = null;
  if (boardX && $('.board')) $('.board').scrollLeft = boardX;
  if (typeof applyPlanFilter === 'function' && F('pl-q', '')) applyPlanFilter();
  loadAuthImages();
  translate(app);
  const hooks = KL.afterRender.splice(0);
  for (const h of hooks) { try { h(); } catch (err) { console.error(err); } }
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
      if (document.body.classList.contains('has-drawer')) { const r = route(); location.hash = `#rec/${String(r.arg).split('/')[0]}`; return; }
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
    const queued = await Outbox.all().catch(() => []);
    KL.outboxCount = queued.length;
    KL.outboxItems = queued.map((x) => ({ id: x.id, label: x.label, path: x.path, createdAt: x.createdAt }));
    render();
    Outbox.flush();
  }
  setInterval(() => { for (const el of $$('[data-since]')) el.textContent = duration(el.dataset.since); }, 30000);
  DutyWatch.start();
  setInterval(async () => { if (document.visibilityState === 'visible' && KL.token) { const before = `${KL.me?.unread}/${KL.me?.pendingApprovals}`; await refreshMe(); if (`${KL.me?.unread}/${KL.me?.pendingApprovals}` !== before) { invalidate('inbox', 'planner', 'm-approvals'); render(); } } }, 30000);
})();
