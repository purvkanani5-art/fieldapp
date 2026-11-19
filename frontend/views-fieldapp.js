/* Field-staff app (approved mockup, 2026-11-14): Today · Site · + · Requests · Me, a bell for messages, bigger type.
   Managers, HR and the director keep their screens. Every action opens an existing route or form; no new API. */

const isField = () => KL.user && KL.user.role === 'field';
/** "19 Nov" this year, "19 Nov 2025" otherwise (short dates for field screens). */
const sd = (iso) => { const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`); return d.toLocaleDateString(appLocale(), { day: 'numeric', month: 'short', ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) }); };
const fieldSites = () => (KL.boot?.mySites || []).filter((s) => s.project_type !== 'office');

/* ---------------------------------------------------------------- app bar (top of each field tab) */
function fieldBar(title = '', sub = '') {
  const unread = KL.me?.unread || 0;
  const waiting = KL.outboxCount || 0;
  const status = !navigator.onLine ? `<div class="fa-status bad" role="status">${ic('alert')}<span>Offline${waiting ? ` · ${waiting} saved on this phone, sent when the signal is back` : ''}</span></div>`
    : waiting ? `<button type="button" class="fa-status warn" data-action="flushOutbox" role="status">${ic('upload')}<span>${waiting} saved on this phone · tap to send now</span></button>` : '';
  return `<header class="dash-head hello fa-hello"><div class="hello-tx">${sub ? `<p class="meta">${esc(sub)}</p>` : ''}<h1>${esc(title || 'Kshetralekha')}</h1></div>
    <div class="hello-btns"><a class="round-btn" href="#inbox" aria-label="Messages${unread ? `, ${unread} new` : ''}">${ic('bell')}${unread ? `<span class="badge">${unread > 99 ? '99+' : unread}</span>` : ''}</a><a href="#me" aria-label="Me" class="hello-me">${avatar(KL.user.name, 'lg')}</a></div></header>${status}`;
}

/* ---------------------------------------------------------------- Today */
function fieldToday() {
  const me = KL.me || {};
  const att = me.openAttendance;
  const sites = fieldSites();
  const now = new Date();
  const greet = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening';
  const site = att ? { name: att.site_name } : sites[0];
  const g = KL.ui.gps;
  const near = !att && site && g && site.lat ? `· ${insideSite(site) ? 'you are inside' : 'you are away'}, ${fmtNum(distanceM(g.lat, g.lng, site.lat, site.lng))} m from the centre` : '';
  const kd = kinds();
  const starts = kd && !kd.error ? kd.workHours?.start : '';
  const gpsLine = g && site && site.lat ? `<div class="ci-gps ${insideSite(site) ? 'ok' : 'bad'}">${ic(insideSite(site) ? 'check' : 'alert')}<span>${insideSite(site) ? 'Inside the site' : `${fmtNum(distanceM(g.lat, g.lng, site.lat, site.lng))} m from the site`} · GPS ±${Math.round(g.accuracy)} m</span></div>` : '';
  const hero = att
    ? `<section class="ci-card" aria-label="Attendance"><div class="row"><span class="icon green">${ic('pin')}</span><div class="tx"><b>Checked in · ${esc((fmtDate(att.checkin_at).split(', ')[1]) || '')}</b><span>${esc(att.site_name)} · on site <span data-since="${esc(att.checkin_at)}">${esc(duration(att.checkin_at))}</span>${att.status === 'pending' ? ' · exception pending' : ''}</span></div></div>
        ${gpsLine}<a class="btn wide xl redline" href="#attendance">Check out</a></section>`
    : `<section class="ci-card" aria-label="Attendance"><div class="row"><span class="icon amber">${ic('pin')}</span><div class="tx"><b>Not checked in yet</b><span>${site ? esc(site.name) : 'No site yet'}${starts ? ` · work starts ${esc(starts)}` : ''}</span></div></div>
        ${gpsLine}<a class="btn wide xl primary" href="#attendance">${ic('camera')}<span>Check in with selfie</span></a></section>`;
  const trip = KL.me?.openTrip;
  const tiles = [
    { href: '#trips', icon: 'bike', tone: 'blue', label: 'Travel', sub: trip ? 'End the trip' : 'Start a trip' },
    { href: '#leaves', icon: 'sun', tone: 'violet', label: 'Leave', sub: 'Full or half day' },
    { href: '#rec/expense/new', icon: 'receipt', tone: 'amber', label: 'Expense', sub: 'Photo of the bill' },
    { href: '#updates', icon: 'note', tone: 'teal', label: 'Daily update', sub: 'What you did' },
  ];
  const todo = fieldTodo();
  const tasksAll = todo.tasksOpen;
  return `${fieldBar(`${greet}, ${firstName(KL.user.name)}`, now.toLocaleDateString(appLocale(), { weekday: 'long', day: 'numeric', month: 'long' }))}
    ${hero}
    ${trip ? `<a class="banner info" href="#trips" style="margin-top:12px;text-decoration:none;color:inherit">${ic('bike')}<div><b>On a trip by ${esc(trip.vehicle)}</b><p>Tap to end it and send the claim</p></div></a>` : ''}
    <div class="hub-tiles" style="margin-top:14px">${tiles.map(hubTile).join('')}</div>
    <div class="fa-h2"><h2>To do</h2>${todo.loading ? '' : `<span>${todo.items.length} ${todo.items.length === 1 ? 'thing' : 'things'}</span>`}</div>
    ${todo.loading && !todo.items.length ? spinner() : todo.items.length ? `<div class="fa-list">${todo.items.slice(0, 4).map(faRow).join('')}</div>` : `<div class="fa-list"><p class="fa-empty">All done for now.</p></div>`}
    ${todo.items.length > 4 || tasksAll ? `<a class="fa-more" href="#tasks">${tasksAll ? `See all ${tasksAll} task${tasksAll === 1 ? '' : 's'}` : 'See everything'}</a>` : ''}`;
}
/** The To do list: tasks that are late or due soon, notices to confirm, crew attendance not marked, open surveys, today's update. */
function fieldTodo() {
  const my = data('planner:my', () => api('/api/planner/my'));
  const w = data('hr:waiting', () => api('/api/hr/waiting'));
  const upd = data('updates:mine', () => api('/api/updates?days=1'));
  const items = [];
  const pend = KL.me?.pendingApprovals || 0;
  if (pend) items.push({ href: '#approvals', icon: 'check', tone: 'amber', title: pend === 1 ? '1 request to approve' : `${pend} requests to approve`, sub: 'The approval rules send these to you' });
  const today = todayISO();
  const soon = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const open = my && !my.error ? my.tasks.filter((t) => t.progress !== 'completed').sort(byDue) : [];
  for (const t of open.filter((x) => x.due_date && x.due_date <= soon).slice(0, 3)) {
    const late = isLate(t);
    items.push({ href: `#task/${t.id}`, icon: 'kanban', tone: late ? 'red' : '', title: t.title, sub: `Task · ${late ? `was due ${sd(t.due_date)}` : t.due_date === today ? 'due today' : `due ${sd(t.due_date)}`}`, chip: late ? ['Late', 'bad'] : null });
  }
  if (w && !w.error) {
    for (const n of w.important) items.push({ href: `#notice/${n.id}`, icon: 'bell', tone: 'amber', title: `Read: ${n.title}`, sub: 'Notice · tap to read and confirm' });
    if (w.supervisor) {
      for (const s of fieldSites()) {
        const m = data(`muster:${s.id}:${today}`, () => api(`/api/muster/${s.id}?day=${today}`));
        if (m && !m.error && !m.sheet) {
          const crew = m.people.filter((p) => !p.app_access).length + m.workers.length;
          if (crew) items.push({ href: `#muster/${s.id}`, icon: 'users', tone: 'green', title: 'Mark crew attendance', sub: `${crew} ${crew === 1 ? 'person' : 'people'} without phones · ${s.name}` });
        }
      }
    }
    for (const s of w.surveys) items.push({ href: `#survey/${s.id}`, icon: 'chart', tone: 'blue', title: s.title, sub: 'Survey · two minutes, anonymous' });
  }
  if (KL.me?.openAttendance && upd && !upd.error && !upd.rows.some((r) => r.date === today)) items.push({ href: '#updates', icon: 'note', tone: '', title: "Write today's update", sub: 'A few lines on what you did' });
  const rank = (x) => (x.chip ? 0 : x.icon === 'users' ? 1 : x.icon === 'bell' ? 2 : x.sub?.includes('due today') ? 3 : x.icon === 'kanban' ? 4 : x.icon === 'chart' ? 5 : 6);
  items.sort((a, b) => rank(a) - rank(b));
  return { items, tasksOpen: open.length, loading: my === null || w === null };
}
function faRow(x) {
  return `<a class="fa-row" href="${esc(x.href)}"><span class="fa-ic ${x.tone || ''}">${ic(x.icon)}</span><span class="fa-tx"><b>${esc(x.title)}</b>${x.sub ? `<span>${esc(x.sub)}</span>` : ''}${refLine(x)}</span>${x.chip ? `<span class="tag status ${x.chip[1]}">${esc(x.chip[0])}</span>` : x.right || `<span class="chev">${ic('chevron')}</span>`}</a>`;
}

/* ---------------------------------------------------------------- the big "+" and the site "Add entry" sheet */
/** Tiles for things a field worker can add at one site; differ by project (biochar kiln or plant, gasifier, agroforestry). */
function siteAddTiles(s) {
  const sup = Boolean(KL.user.supervisor);
  const rec = (kind, icon, label) => ({ icon, label, kind, site: s.id });
  const go = (href, icon, label, extra = {}) => ({ icon, label, href, ...extra });
  const t = [];
  if (s.project_type === 'biochar') t.push(go(`#site/${s.id}/stock`, 'box', 'Stock in or out'), rec('batch', 'flame', s.subtype === 'plant' ? 'Plant run' : 'Kiln batch'), go('', 'checklist', 'Daily safety check', { check: s.id }), go('#farmers', 'sprout', 'Farmer or signing'));
  else if (s.project_type === 'gasifier') t.push(go(`#site/${s.id}/stock`, 'box', 'Stock in or out'), rec('gas_run', 'sun', 'Generation run'), rec('maintenance', 'cog', 'Equipment service'), go('', 'checklist', 'Daily safety check', { check: s.id }));
  else if (s.project_type === 'agroforestry') t.push(rec('nursery', 'sprout', 'Nursery entry'), rec('sapling', 'tree', 'Saplings planted'), rec('survival', 'leaf', 'Survival check'), go('#farmers', 'users', 'Farmer or signing'));
  else t.push(go(`#site/${s.id}/stock`, 'box', 'Stock in or out'), go('', 'checklist', 'Daily safety check', { check: s.id }), go('#updates', 'note', 'Daily update')); // a project added in Settings > Lists
  if (sup) t.push(go(`#muster/${s.id}`, 'users', 'Crew attendance'));
  if (s.project_type !== 'agroforestry') t.push(rec('incident', 'alert', 'Report incident'));
  return t;
}
function tileBtn(x) {
  const attrs = [`data-action="faGo"`, x.href ? `data-href="${esc(x.href)}"` : '', x.kind ? `data-kind="${esc(x.kind)}" data-key="site" data-site="${esc(x.site)}"` : '', x.check ? `data-check="${esc(x.check)}"` : ''].join(' ');
  return `<button type="button" class="fa-tile" ${attrs}>${ic(x.icon)}<span>${esc(x.label)}</span></button>`;
}
Actions.plusOpen = () => {
  const att = KL.me?.openAttendance;
  const s = fieldSites().find((x) => x.id === att?.site_id) || fieldSites()[0];
  // personal things only: everything done at a site is inside the site ("Site work" opens it)
  const tiles = [{ icon: 'pin', label: att ? 'Check out' : 'Check in', href: '#attendance' }, { icon: 'bike', label: KL.me?.openTrip ? 'End trip' : 'Travel', href: '#trips' }, { icon: 'sun', label: 'Leave', href: '#leaves' },
    { icon: 'receipt', label: 'Expense', kind: 'expense', site: s?.id || '' }, { icon: 'receipt', label: 'Advance', kind: 'advance', site: '' }, { icon: 'note', label: 'Daily update', href: '#updates' },
    { icon: 'chat', label: 'Complaint or suggestion', href: '#feedback' }, ...(s ? [{ icon: 'flame', label: 'Site work', href: `#mysite/${s.id}` }] : [])];
  data('m:checklist_template', () => api('/api/m/checklist_template')); // so "Daily safety check" opens the checklist itself
  modal({ title: 'Add new', html: `<div class="fa-tiles">${tiles.map(tileBtn).join('')}</div>`, noButtons: true });
};
Actions.siteAdd = (el) => {
  const s = fieldSites().find((x) => x.id === el.dataset.site) || siteById(el.dataset.site);
  if (!s) return;
  data('m:checklist_template', () => api('/api/m/checklist_template'));
  modal({ title: `Add at ${s.name}`, html: `<div class="fa-tiles">${siteAddTiles(s).map(tileBtn).join('')}</div>`, noButtons: true });
};
Actions.faGo = (el) => {
  KL.closeModal?.(null);
  if (el.dataset.kind) {
    clearRecForm(el.dataset.kind); KL.ui.recInit = null;
    if (el.dataset.site) setF(`rf-${el.dataset.kind}-${el.dataset.key || 'site'}`, el.dataset.site);
    KL.ui.siteBack = null;
    location.hash = `#rec/${el.dataset.kind}/new`;
    return;
  }
  if (el.dataset.check) {
    const t = KL.cache['m:checklist_template'];
    // this site's checklist, else a company-wide one (no site)
    const tpl = t && !t.error ? (t.rows.find((x) => x.site_id === el.dataset.check) || t.rows.find((x) => !x.site_id)) : null;
    if (tpl) return Actions.startChecklist({ dataset: { id: tpl.id } });
    location.hash = '#rec/checklist_template';
    return;
  }
  location.hash = el.dataset.href;
};

/* ---------------------------------------------------------------- Site (simple; full records one tap away) */
function fieldSiteList(sites) {
  return `${fieldBar('Your sites', 'Choose a site')}${projectGroups(sites, (s) => `#mysite/${s.id}`)}`;
}
function fieldSite(s) { return siteHub(s, { field: true, back: fieldSites().length > 1 ? '#mysite' : '' }); }
/** Projects as panels with their sites listed inside (used by everyone's Sites page and the field site picker). */
function projectGroups(sites, hrefFor = (s) => `#site/${s.id}`) {
  const groups = Object.entries(projectsMeta()).map(([key, p]) => [key, p, sites.filter((s) => s.project_type === key)]).filter(([, , list]) => list.length);
  return groups.map(([key, p, list]) => `<section class="pj-panel pj-${esc(key)}" aria-label="${esc(p.name)}">
      <header class="pj-panel-head"><span class="pj-ic">${ic(p.icon)}</span><b>${esc(p.name)}</b><span class="pj-count">${list.length} site${list.length === 1 ? '' : 's'}</span>${isStaff() && can('sites.edit') ? `<a class="btn small ghost icon-only" href="#sitenew" data-action="siteNewFor" data-project="${esc(key)}" aria-label="Add a ${esc(p.name)} site" title="Add a ${esc(p.name)} site">${ic('plus')}</a>` : ''}</header>
      ${list.map((s) => `<a class="site-card" href="${esc(hrefFor(s))}"><span class="tx"><b>${esc(s.name)}</b><small>${esc([subtypeText(s), s.address].filter(Boolean).join(' · '))}</small></span>${s.strict ? tag(s.strict >= 2 ? 'Fence in & out' : 'Fence at check-in', 'bad') : ''}<span class="chev">${ic('chevron')}</span></a>`).join('')}
    </section>`).join('');
}

/* ---------------------------------------------------------------- Requests */
Views.requests = () => {
  const lv = data('leaves:mine', () => api('/api/leaves'));
  const kinds_ = ['expense', 'advance', 'regularisation'];
  const recs = kinds_.map((k) => data(`m:${k}`, () => api(`/api/m/${k}`)));
  const bal = data('hr:balances', () => api('/api/hr/leave-balances'));
  const tr = data('trips:mine', () => api('/api/trips'));
  kinds();
  const tab = F('rq-tab', 'open');
  const rows = [];
  if (tr && !tr.error) for (const t of tr.rows.filter((x) => x.status !== 'open')) rows.push({ ref: t.ref, open: t.status === 'submitted', href: '#trips', icon: 'bike', tone: t.status === 'submitted' ? 'blue' : t.status === 'approved' ? 'green' : 'red', title: `Travel, ${fmtNum(t.km_claimed, 1)} km · ${rupees(t.amount)}`, sub: t.status === 'submitted' ? (t.waiting ? `With ${t.waiting}` : sd(t.end_at)) : t.status === 'approved' ? 'Approved' : t.status === 'withdrawn' ? 'Withdrawn' : 'Rejected', status: t.status === 'submitted' ? 'pending' : t.status, at: t.end_at });
  if (lv && !lv.error) for (const l of lv.rows) rows.push({ ref: l.ref, open: l.status === 'pending', href: '#leaves', icon: 'sun', tone: l.status === 'pending' ? 'amber' : l.status === 'approved' ? 'green' : 'red', title: `${l.type} leave, ${sd(l.from_date)}${l.to_date !== l.from_date ? ` to ${sd(l.to_date)}` : ''}`, sub: l.status === 'pending' ? (l.waiting ? `With ${l.waiting}` : `${fmtNum(l.days || 0, 1)} day${l.days === 1 ? '' : 's'}`) : l.decision_note || (l.status === 'approved' ? 'Approved' : 'Rejected'), status: l.status, at: l.created_at });
  recs.forEach((r, i) => {
    if (!r || r.error) return;
    const k = kindDef(kinds_[i]);
    for (const x of r.rows.filter((y) => y.user_id === KL.user.id || y.created_by === KL.user.id)) {
      const amt = k?.amount && x.data[k.amount] ? `, ${rupees(x.data[k.amount])}` : '';
      rows.push({ ref: x.ref, open: x.status === 'pending', href: `#rec/${kinds_[i]}/${x.id}`, icon: kinds_[i] === 'expense' ? 'receipt' : kinds_[i] === 'advance' ? 'receipt' : 'clock', tone: x.status === 'pending' ? 'amber' : x.status === 'approved' ? 'green' : 'red',
        title: `${k?.one || 'Request'}${amt}${kinds_[i] === 'regularisation' && x.data.date ? `, ${sd(x.data.date)}` : ''}`, sub: x.status === 'pending' ? (x.waiting ? `With ${x.waiting}` : sd(x.created_at)) : x.status === 'approved' ? 'Approved' : 'Rejected', status: x.status, at: x.created_at });
    }
  });
  rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const open = rows.filter((r) => r.open), done = rows.filter((r) => !r.open);
  const list = tab === 'open' ? open : done;
  const loading = lv === null || tr === null || recs.some((r) => r === null);
  const s0 = fieldSites()[0];
  const newBtns = [{ href: '#leaves', icon: 'sun', tone: 'violet', label: 'Leave' }, { href: '#trips', icon: 'bike', tone: 'blue', label: KL.me?.openTrip ? 'End trip' : 'Travel' },
    { href: '#rec/expense/new', icon: 'receipt', tone: 'amber', label: 'Expense', kind: 'expense', site: s0?.id || '' }, { href: '#rec/advance/new', icon: 'receipt', tone: 'teal', label: 'Advance', kind: 'advance', site: '' },
    { href: '#rec/regularisation/new', icon: 'clock', tone: 'green', label: 'Correction', kind: 'regularisation', site: s0?.id || '' }, { href: '#feedback', icon: 'chat', tone: 'red', label: 'Complaint or idea' }];
  return `${fieldBar('Requests')}
    ${bal && !bal.error ? `<div class="fa-bal">${bal.rows.filter((b) => b.available !== null).slice(0, 3).map((b, i) => `<div><b class="bal-${i}">${fmtNum(b.available, 1)}</b><span>${esc(b.type)} left</span></div>`).join('')}</div>` : ''}
    <div class="req-btns">${newBtns.map((b) => (b.kind ? `<a class="btn req-btn" href="${b.href}" data-action="siteNew" data-kind="${b.kind}" data-key="site" data-site="${esc(b.site)}"><span class="icon ${b.tone}">${ic(b.icon)}</span><span>${esc(b.label)}</span></a>` : `<a class="btn req-btn" href="${b.href}"><span class="icon ${b.tone}">${ic(b.icon)}</span><span>${esc(b.label)}</span></a>`)).join('')}</div>
    <div class="seg fa-seg" role="group" aria-label="Show"><button type="button" data-action="rqTab" data-tab="open" aria-pressed="${tab === 'open'}">Waiting (${open.length})</button><button type="button" data-action="rqTab" data-tab="done" aria-pressed="${tab === 'done'}">Decided (${done.length})</button></div>
    ${loading && !rows.length ? spinner() : list.length ? `<div class="fa-list">${list.map((r) => faRow({ ...r, right: statusTag(r.status) })).join('')}</div>` : `<div class="fa-list"><p class="fa-empty">${tab === 'open' ? 'Nothing waiting.' : 'No decided requests yet.'}</p></div>`}`;
};
Actions.rqTab = (el) => { setF('rq-tab', el.dataset.tab); render(); };
Actions.rqNew = () => {
  const s = fieldSites()[0];
  const tiles = [{ icon: 'sun', label: 'Leave', href: '#leaves' }, { icon: 'receipt', label: 'Expense', kind: 'expense', site: s?.id || '' }, { icon: 'receipt', label: 'Advance', kind: 'advance', site: '' }, { icon: 'clock', label: 'Attendance correction', kind: 'regularisation', site: s?.id || '' }];
  modal({ title: 'New request', html: `<div class="fa-tiles">${tiles.map(tileBtn).join('')}</div>`, noButtons: true });
};

/* ---------------------------------------------------------------- Me and Settings */
const ME_TONE = { inbox: 'red', user: 'blue', calendar: 'green', doc: 'blue', bell: 'amber', chat: 'red', shield: 'violet', cog: '' };
function fieldMe() {
  const cmt = data('committees', () => api('/api/committees'));
  const u = KL.user;
  const w = data('hr:waiting', () => api('/api/hr/waiting'));
  const posh = data('hr:posh', () => api('/api/hr/posh'));
  const att = data(`hr:attsum:me:${todayISO().slice(0, 7)}`, () => api(`/api/hr/attendance-summary?month=${todayISO().slice(0, 7)}`));
  const newN = w && !w.error ? (w.unreadNotices || 0) + w.surveys.length : 0;
  const row = (href, icon, title, sub = '', right = '', action = '') => `<${action ? 'button type="button"' : 'a'} class="fa-row" ${action ? `data-action="${action}"` : `href="${href}"`}><span class="fa-ic ${ME_TONE[icon] || ''}">${ic(icon)}</span><span class="fa-tx"><b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</span>${right || `<span class="chev">${ic('chevron')}</span>`}</${action ? 'button' : 'a'}>`;
  return `${fieldBar('Me')}
    <div class="fa-me-head card">${avatar(u.name, 'xl')}<div><b>${esc(u.name)}</b><span>${esc(u.designation || 'Field staff')} · ${esc(u.employee_id)}</span>${u.manager_id ? `<span>Reports to ${esc(personName(u.manager_id))}</span>` : ''}</div></div>
    <div class="fa-list">
      ${row('#person/me', 'user', 'My details')}
      ${row('#attsum', 'calendar', 'My attendance', att && !att.error && att.totals ? `${att.totals.P} present this month` : '')}
      ${row('', 'doc', 'Payslips and documents', '', '', 'meDocs')}
      ${row('#notices', 'bell', 'Notices and surveys', '', newN ? `<span class="fa-new">${newN} new</span>` : '')}
      ${row('#feedback', 'chat', 'Complaints & suggestions', 'With your name or without')}
      ${row('#committees', 'shield', 'Committees', 'Who looks after complaints and ideas')}
      ${cmt && !cmt.error && cmt.rows.some((c) => c.openCases !== undefined) ? row('#cases', 'inbox', 'Committee cases', 'Confidential, for your committees') : ''}
      ${row('#settings', 'cog', 'Settings', 'Language, PIN, privacy')}
    </div>`;
}
Actions.meDocs = () => { setF('pf-tab', 'documents'); location.hash = '#person/me'; };
Views.settings = () => {
  let theme = 'auto';
  try { theme = localStorage.getItem('kl.theme') || 'auto'; } catch { /* private */ }
  const u = KL.user;
  return `${topbar('Settings', isStaff() ? '#home' : '#me')}
    ${group('Language', `<div class="seg fa-seg">${[['en', 'English'], ['gu', 'ગુજરાતી'], ['hi', 'हिन्दी']].map(([k, l]) => `<button type="button" data-action="lang" data-lang="${k}" aria-pressed="${lang() === k}">${l}</button>`).join('')}</div>`)}
    ${group('Appearance', `<div class="seg fa-seg">${[['auto', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) => `<button type="button" data-action="theme" data-theme="${k}" aria-pressed="${theme === k}">${l}</button>`).join('')}</div>`)}
    ${group('Account', `<div class="fa-list">
      <button type="button" class="fa-row" data-action="changePin"><span class="fa-ic">${ic('lock')}</span><span class="fa-tx"><b>Change PIN</b><span>6 digits, known only to you</span></span></button>
      <a class="fa-row" href="#privacy"><span class="fa-ic">${ic('shield')}</span><span class="fa-tx"><b>Privacy and my data</b></span><span class="chev">${ic('chevron')}</span></a>
      <button type="button" class="fa-row" data-action="flushOutbox"><span class="fa-ic">${ic('upload')}</span><span class="fa-tx"><b>Send saved items now</b><span>${KL.outboxCount ? `${KL.outboxCount} waiting` : 'Nothing waiting'}</span></span></button>
      <button type="button" class="fa-row" data-action="logout"><span class="fa-ic red">${ic('logout')}</span><span class="fa-tx"><b>Sign out</b><span>On this phone</span></span></button>
    </div>`)}
    ${isStaff() ? group('Administration', `<div class="fa-list">
      <a class="fa-row" href="#security"><span class="fa-ic">${ic('shield')}</span><span class="fa-tx"><b>Two-step sign-in</b><span>Authenticator code after the PIN</span></span><span class="chev">${ic('chevron')}</span></a>
      <a class="fa-row" href="#admin"><span class="fa-ic">${ic('cog')}</span><span class="fa-tx"><b>Administration</b><span>Users, sites, registers, templates, company</span></span><span class="chev">${ic('chevron')}</span></a>
      ${['admin', 'hr'].includes(u.role) ? `<a class="fa-row" href="#hrsettings"><span class="fa-ic">${ic('cog')}</span><span class="fa-tx"><b>HR settings</b><span>Leave policy, work hours</span></span><span class="chev">${ic('chevron')}</span></a>` : ''}
    </div>`) : ''}
    ${failedItems()}
    ${group('For reviewers', reviewerNote())}`;
};

/* ---------------------------------------------------------------- wire into the existing views */
{
  const homeStaff = Views.home;
  Views.home = () => (isField() ? fieldToday() : homeStaff());
  const meStaff = Views.me;
  Views.me = () => (isField() ? fieldMe() : meStaff());
  Views.mysite = (arg) => {
    if (!isField()) { const s = mySites(); if (s.length === 1) { setTimeout(() => location.replace(`#site/${s[0].id}`), 0); return spinner(); } return Views.sites(); }
    const sites = fieldSites();
    if (!sites.length) return `${fieldBar('Site')}${emptyState('pin', 'No site assigned to you', 'You can use Today, Requests and Me. HR adds you to a site when you work at one.')}`;
    const one = arg ? sites.find((s) => s.id === arg) : sites.length === 1 ? sites[0] : null;
    return one ? fieldSite(one) : fieldSiteList(sites);
  };
}
