/* Field-staff app (approved mockup, 2026-11-14): Today · Site · + · Requests · Me, a bell for messages, bigger type.
   Managers, HR and the director keep their screens. Every action opens an existing route or form; no new API. */

const isField = () => KL.user && KL.user.role === 'field';
/** "19 Nov" this year, "19 Nov 2025" otherwise (short dates for field screens). */
const sd = (iso) => { const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`); return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) }); };
const fieldSites = () => (KL.boot?.mySites || []).filter((s) => s.project_type !== 'office');

/* ---------------------------------------------------------------- app bar (top of each field tab) */
function fieldBar() {
  const unread = KL.me?.unread || 0;
  const waiting = KL.outboxCount || 0;
  const status = !navigator.onLine ? `<div class="fa-status bad" role="status">${ic('alert')}<span>Offline${waiting ? ` · ${waiting} saved on this phone, sent when the signal is back` : ''}</span></div>`
    : waiting ? `<button type="button" class="fa-status warn" data-action="flushOutbox" role="status">${ic('upload')}<span>${waiting} saved on this phone · tap to send now</span></button>` : '';
  return `<header class="fa-bar"><a class="fa-logo" href="#home" aria-label="Today"><img src="./icon.svg" alt="" /></a><b class="fa-title">Kshetralekha</b>
    <a class="fa-icon" href="#inbox" aria-label="Messages${unread ? `, ${unread} new` : ''}">${ic('bell')}${unread ? `<span class="fa-badge">${unread > 99 ? '99+' : unread}</span>` : ''}</a>
    <a class="fa-icon" href="#me" aria-label="Me">${avatar(KL.user.name)}</a></header>${status}`;
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
  const hero = att
    ? `<section class="fa-hero today" aria-label="Attendance"><div class="fa-where">${ic('pin')}<span>Checked in at ${esc(att.site_name)} · ${esc((fmtDate(att.checkin_at).split(', ')[1]) || '')}${att.status === 'pending' ? ' · exception pending' : ''}</span></div>
        <div class="fa-timer" data-since="${esc(att.checkin_at)}">${esc(duration(att.checkin_at))}</div>
        <a class="fa-big" href="#attendance">${ic('pin')}<span>Check out</span></a></section>`
    : `<section class="fa-hero today" aria-label="Attendance">${site ? `<div class="fa-where">${ic('pin')}<span>${esc(site.name)} ${esc(near)}</span></div>` : ''}
        <div class="fa-state">You have not checked in</div>
        <a class="fa-big" href="#attendance">${ic('pin')}<span>Check in</span></a>
        <p class="fa-meta">A selfie is taken when you check in. Time and place are recorded.</p></section>`;
  const todo = fieldTodo();
  const tasksAll = todo.tasksOpen;
  return `${fieldBar()}
    <h1 class="fa-h1">${esc(greet)}, ${esc(firstName(KL.user.name))}</h1>
    <p class="fa-date">${esc(now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }))}</p>
    ${hero}
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
  return `<a class="fa-row" href="${esc(x.href)}"><span class="fa-ic ${x.tone || ''}">${ic(x.icon)}</span><span class="fa-tx"><b>${esc(x.title)}</b>${x.sub ? `<span>${esc(x.sub)}</span>` : ''}</span>${x.chip ? `<span class="tag status ${x.chip[1]}">${esc(x.chip[0])}</span>` : x.right || `<span class="chev">${ic('chevron')}</span>`}</a>`;
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
  const common = [{ icon: 'pin', label: att ? 'Check out' : 'Check in', href: '#attendance' }, { icon: 'note', label: 'Daily update', href: '#updates' }, { icon: 'sun', label: 'Leave', href: '#leaves' },
    { icon: 'receipt', label: 'Expense', kind: 'expense', site: s?.id || '' }];
  const site = s ? siteAddTiles(s).filter((x) => x.label !== 'Farmer or signing' && x.label !== 'Equipment service' && x.label !== 'Survival check').slice(0, 3) : [];
  const tail = [{ icon: 'chat', label: 'Complaint or idea', href: '#feedback' }];
  const tiles = [...common, ...site, ...tail].slice(0, 8);
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
    const tpl = t && !t.error ? t.rows.find((x) => x.site_id === el.dataset.check) : null;
    if (tpl) return Actions.startChecklist({ dataset: { id: tpl.id } });
    location.hash = '#rec/checklist_template';
    return;
  }
  location.hash = el.dataset.href;
};

/* ---------------------------------------------------------------- Site (simple; full records one tap away) */
function fieldSiteList(sites) {
  return `${fieldBar()}<h1 class="fa-h1">Your sites</h1><p class="fa-date">Choose a site</p>${projectGroups(sites, (s) => `#mysite/${s.id}`)}`;
}
function fieldSite(s) {
  const sum = data(`site:${s.id}`, () => api(`/api/sites/${s.id}/summary`));
  const p = projectsMeta()[s.project_type] || {};
  data('m:checklist_template', () => api('/api/m/checklist_template'));
  const back = fieldSites().length > 1 ? `<a class="fa-back" href="#mysite">${ic('back')}<span>All my sites</span></a>` : '';
  if (sum === null) return `${fieldBar()}${back}${spinner()}`;
  if (sum.error) return `${fieldBar()}${back}${errorBox(sum.error)}`;
  const st = sum.stats || {};
  const bal = (re) => sum.items.find((i) => re.test(i.name));
  const item = (i, label) => (i ? { v: fmtNum(i.balance), l: `${i.unit} ${label}`, low: i.kind === 'input' && i.low_stock && i.balance < i.low_stock } : null);
  let stats = [];
  if (s.project_type === 'biochar') stats = [item(bal(/biochar|char/i), 'biochar'), item(bal(/biomass|feed/i), 'biomass'), item(bal(/diesel/i), 'diesel')];
  else if (s.project_type === 'gasifier') stats = [{ v: fmtNum(st.kwh), l: 'kWh this month' }, { v: fmtNum(st.hours, 1), l: 'run hours' }, item(bal(/feed|biomass|wood/i), 'feedstock')];
  else stats = [{ v: fmtNum(st.inNursery), l: 'in nursery' }, { v: fmtNum(st.planted), l: 'planted' }, { v: fmtNum(st.farmers), l: 'farmers' }];
  stats = stats.filter(Boolean);
  const today = [];
  const t = KL.cache['m:checklist_template'];
  const tpl = t && !t.error ? t.rows.find((x) => x.site_id === s.id) : null;
  if (KL.user.supervisor) today.push({ href: `#muster/${s.id}`, icon: 'users', tone: 'green', title: 'Crew attendance', sub: 'People without phones' });
  if (tpl) today.push({ href: '#rec/checklist_run/new', icon: 'checklist', tone: 'amber', title: tpl.title, sub: `${tpl.data.frequency || 'Daily'} check`, start: tpl.id });
  const last = (sum.recent || []).find((r) => ['batch', 'gas_run', 'nursery', 'sapling'].includes(r.kind));
  if (last) today.push({ href: `#rec/${last.kind}/${last.id}`, icon: last.icon || 'doc', tone: '', title: `Last ${last.label.toLowerCase()}`, sub: `${last.title || ''} · ${timeAgo(last.created_at)}` });
  if ((sum.tasks || []).length) today.push({ href: '#tasks', icon: 'kanban', tone: '', title: `${sum.tasks.length} open task${sum.tasks.length === 1 ? '' : 's'} here`, sub: sum.tasks.slice(0, 2).map((x) => x.title).join(' · ') });
  return `${fieldBar()}${back}
    <div class="fa-site-head"><span class="fa-ic big">${ic(p.icon || 'pin')}</span><div><h1 class="fa-h1" style="margin:0">${esc(s.name)}</h1><span>${esc(p.name || '')}${subtypeText(s) ? ` · ${esc(subtypeText(s))}` : ''}</span></div></div>
    ${stats.length ? `<div class="fa-stats">${stats.map((x) => `<div class="fa-stat ${x.low ? 'low' : ''}"><b>${esc(x.v)}</b><span>${esc(x.l)}${x.low ? ' · low' : ''}</span></div>`).join('')}</div>` : ''}
    <button type="button" class="fa-primary" data-action="siteAdd" data-site="${esc(s.id)}">${ic('plus')}<span>Add entry</span></button>
    ${today.length ? `<div class="fa-h2"><h2>Today at the site</h2></div><div class="fa-list">${today.map((x) => (x.start ? `<button type="button" class="fa-row" data-action="startChecklist" data-id="${esc(x.start)}"><span class="fa-ic ${x.tone}">${ic(x.icon)}</span><span class="fa-tx"><b>${esc(x.title)}</b><span>${esc(x.sub)}</span></span><span class="chev">${ic('chevron')}</span></button>` : faRow(x))).join('')}</div>` : ''}
    <a class="fa-more" href="#site/${esc(s.id)}/overview">All site records: stock, ${s.project_type === 'agroforestry' ? 'nursery, plantation, farmers' : s.project_type === 'gasifier' ? 'generation, equipment, safety' : 'batches, farmers, safety'}</a>`;
}
/** Projects as panels with their sites listed inside (used by everyone's Sites page and the field site picker). */
function projectGroups(sites, hrefFor = (s) => `#site/${s.id}`) {
  const groups = Object.entries(projectsMeta()).map(([key, p]) => [key, p, sites.filter((s) => s.project_type === key)]).filter(([, , list]) => list.length);
  return groups.map(([key, p, list]) => `<section class="pj-panel pj-${esc(key)}" aria-label="${esc(p.name)}">
      <header class="pj-panel-head"><span class="pj-ic">${ic(p.icon)}</span><b>${esc(p.name)}</b><span class="pj-count">${list.length} site${list.length === 1 ? '' : 's'}</span></header>
      ${list.map((s) => `<a class="site-card" href="${esc(hrefFor(s))}"><span class="tx"><b>${esc(s.name)}</b><small>${esc([subtypeText(s), s.address].filter(Boolean).join(' · '))}</small></span>${s.strict ? tag('Strict', 'bad') : ''}<span class="chev">${ic('chevron')}</span></a>`).join('')}
    </section>`).join('');
}

/* ---------------------------------------------------------------- Requests */
Views.requests = () => {
  const lv = data('leaves:mine', () => api('/api/leaves'));
  const kinds_ = ['expense', 'advance', 'regularisation'];
  const recs = kinds_.map((k) => data(`m:${k}`, () => api(`/api/m/${k}`)));
  const bal = data('hr:balances', () => api('/api/hr/leave-balances'));
  kinds();
  const tab = F('rq-tab', 'open');
  const rows = [];
  if (lv && !lv.error) for (const l of lv.rows) rows.push({ open: l.status === 'pending', href: '#leaves', icon: 'sun', tone: l.status === 'pending' ? 'amber' : l.status === 'approved' ? 'green' : 'red', title: `${l.type} leave, ${sd(l.from_date)}${l.to_date !== l.from_date ? ` to ${sd(l.to_date)}` : ''}`, sub: l.status === 'pending' ? (l.waiting ? `With ${l.waiting}` : `${fmtNum(l.days || 0, 1)} day${l.days === 1 ? '' : 's'}`) : l.decision_note || (l.status === 'approved' ? 'Approved' : 'Rejected'), status: l.status, at: l.created_at });
  recs.forEach((r, i) => {
    if (!r || r.error) return;
    const k = kindDef(kinds_[i]);
    for (const x of r.rows.filter((y) => y.user_id === KL.user.id || y.created_by === KL.user.id)) {
      const amt = k?.amount && x.data[k.amount] ? `, ${rupees(x.data[k.amount])}` : '';
      rows.push({ open: x.status === 'pending', href: `#rec/${kinds_[i]}/${x.id}`, icon: kinds_[i] === 'expense' ? 'receipt' : kinds_[i] === 'advance' ? 'receipt' : 'clock', tone: x.status === 'pending' ? 'amber' : x.status === 'approved' ? 'green' : 'red',
        title: `${k?.one || 'Request'}${amt}${kinds_[i] === 'regularisation' && x.data.date ? `, ${sd(x.data.date)}` : ''}`, sub: x.status === 'pending' ? (x.waiting ? `With ${x.waiting}` : sd(x.created_at)) : x.status === 'approved' ? 'Approved' : 'Rejected', status: x.status, at: x.created_at });
    }
  });
  rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const open = rows.filter((r) => r.open), done = rows.filter((r) => !r.open);
  const list = tab === 'open' ? open : done;
  const loading = lv === null || recs.some((r) => r === null);
  return `${fieldBar()}<h1 class="fa-h1">Requests</h1><p class="fa-date">Leave, expenses, advances and attendance corrections</p>
    ${bal && !bal.error ? `<div class="fa-bal">${bal.rows.filter((b) => b.available !== null).slice(0, 3).map((b) => `<div><b>${fmtNum(b.available, 1)}</b><span>${esc(b.type)} left</span></div>`).join('')}</div>` : ''}
    <div class="seg fa-seg" role="group" aria-label="Show"><button type="button" data-action="rqTab" data-tab="open" aria-pressed="${tab === 'open'}">Waiting (${open.length})</button><button type="button" data-action="rqTab" data-tab="done" aria-pressed="${tab === 'done'}">Decided (${done.length})</button></div>
    ${loading && !rows.length ? spinner() : list.length ? `<div class="fa-list">${list.map((r) => faRow({ ...r, right: statusTag(r.status) })).join('')}</div>` : `<div class="fa-list"><p class="fa-empty">${tab === 'open' ? 'Nothing waiting.' : 'No decided requests yet.'}</p></div>`}
    <button type="button" class="fa-primary" data-action="rqNew">${ic('plus')}<span>New request</span></button>`;
};
Actions.rqTab = (el) => { setF('rq-tab', el.dataset.tab); render(); };
Actions.rqNew = () => {
  const s = fieldSites()[0];
  const tiles = [{ icon: 'sun', label: 'Leave', href: '#leaves' }, { icon: 'receipt', label: 'Expense', kind: 'expense', site: s?.id || '' }, { icon: 'receipt', label: 'Advance', kind: 'advance', site: '' }, { icon: 'clock', label: 'Attendance correction', kind: 'regularisation', site: s?.id || '' }];
  modal({ title: 'New request', html: `<div class="fa-tiles">${tiles.map(tileBtn).join('')}</div>`, noButtons: true });
};

/* ---------------------------------------------------------------- Me and Settings */
function fieldMe() {
  const u = KL.user;
  const w = data('hr:waiting', () => api('/api/hr/waiting'));
  const posh = data('hr:posh', () => api('/api/hr/posh'));
  const att = data(`hr:attsum:me:${todayISO().slice(0, 7)}`, () => api(`/api/hr/attendance-summary?month=${todayISO().slice(0, 7)}`));
  const newN = w && !w.error ? (w.unreadNotices || 0) + w.surveys.length : 0;
  const row = (href, icon, title, sub = '', right = '', action = '') => `<${action ? 'button type="button"' : 'a'} class="fa-row" ${action ? `data-action="${action}"` : `href="${href}"`}><span class="fa-ic">${ic(icon)}</span><span class="fa-tx"><b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</span>${right || `<span class="chev">${ic('chevron')}</span>`}</${action ? 'button' : 'a'}>`;
  return `${fieldBar()}
    <div class="fa-me-head">${avatar(u.name, 'xl')}<div><b>${esc(u.name)}</b><span>${esc(u.designation || 'Field staff')} · ${esc(u.employee_id)}</span>${u.manager_id ? `<span>Reports to ${esc(personName(u.manager_id))}</span>` : ''}</div></div>
    <div class="fa-list">
      ${row('#person/me', 'user', 'My details')}
      ${row('#attsum', 'calendar', 'My attendance', att && !att.error && att.totals ? `${att.totals.P} present this month` : '')}
      ${row('', 'doc', 'Payslips and documents', '', '', 'meDocs')}
      ${row('#notices', 'bell', 'Notices and surveys', '', newN ? `<span class="fa-new">${newN} new</span>` : '')}
      ${row('#feedback', 'chat', 'Help and complaints')}
      ${posh && !posh.error && posh.onCommittee ? row('#poshdesk', 'shield', 'Internal Committee (POSH)', 'Confidential complaints') : ''}
      ${row('#settings', 'cog', 'Settings', 'Language, PIN, privacy')}
    </div>`;
}
Actions.meDocs = () => { setF('pf-tab', 'documents'); location.hash = '#person/me'; };
Views.settings = () => {
  let theme = 'auto';
  try { theme = localStorage.getItem('kl.theme') || 'auto'; } catch { /* private */ }
  return `${topbar('Settings', '#me')}
    ${group('Language', `<div class="seg fa-seg">${[['en', 'English'], ['gu', 'ગુજરાતી'], ['hi', 'हिन्दी']].map(([k, l]) => `<button type="button" data-action="lang" data-lang="${k}" aria-pressed="${lang() === k}">${l}</button>`).join('')}</div>`)}
    ${group('Appearance', `<div class="seg fa-seg">${[['auto', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) => `<button type="button" data-action="theme" data-theme="${k}" aria-pressed="${theme === k}">${l}</button>`).join('')}</div>`)}
    ${group('Account', `<div class="fa-list">
      <button type="button" class="fa-row" data-action="changePin"><span class="fa-ic">${ic('lock')}</span><span class="fa-tx"><b>Change PIN</b><span>6 digits, known only to you</span></span></button>
      <a class="fa-row" href="#privacy"><span class="fa-ic">${ic('shield')}</span><span class="fa-tx"><b>Privacy and my data</b></span><span class="chev">${ic('chevron')}</span></a>
      <button type="button" class="fa-row" data-action="flushOutbox"><span class="fa-ic">${ic('upload')}</span><span class="fa-tx"><b>Send saved items now</b><span>${KL.outboxCount ? `${KL.outboxCount} waiting` : 'Nothing waiting'}</span></span></button>
      <button type="button" class="fa-row" data-action="logout"><span class="fa-ic red">${ic('logout')}</span><span class="fa-tx"><b>Sign out</b><span>On this phone</span></span></button>
    </div>`)}
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
    if (!sites.length) return `${fieldBar()}${emptyState('pin', 'No site assigned to you', 'You can use Today, Requests and Me. HR adds you to a site when you work at one.')}`;
    const one = arg ? sites.find((s) => s.id === arg) : sites.length === 1 ? sites[0] : null;
    return one ? fieldSite(one) : fieldSiteList(sites);
  };
}
