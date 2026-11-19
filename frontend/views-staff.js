/* Managers, HR and admin: dashboard, approvals, team, HR desk, administration. */

Views.manage = () => {
  const pend = KL.me?.pendingApprovals || 0;
  const rows = [
    lrow({ href: '#planner', icon: 'kanban', tone: 'violet', title: 'Planner', sub: 'Plans, buckets and tasks; assign work and track it to done' }),
    lrow({ href: '#approvals', icon: 'check', tone: pend ? 'amber' : '', title: 'Approvals', sub: 'Claims, leave, purchases, corrections, trips, exceptions', right: pend ? tag(String(pend), 'warn') : '' }),
    lrow({ href: '#dashboard', icon: 'chart', tone: 'green', title: 'Dashboard', sub: 'Who is on site, stock, travel spend, farmers' }),
    lrow({ href: '#team', icon: 'users', tone: 'blue', title: 'Team activity', sub: 'Attendance, trips and daily updates of everyone' }),
    ['admin', 'hr'].includes(KL.user.role) ? lrow({ href: '#hrdesk', icon: 'folder', tone: 'amber', title: 'HR desk', sub: 'Committee cases, employee documents' }) : '',
    ['admin', 'manager', 'hr'].includes(KL.user.role) ? lrow({ href: '#admin', icon: 'cog', title: 'Administration', sub: 'Users, sites, registers, templates, company' }) : '',
  ].join('');
  const mods = [['hr', 'users', 'blue', 'People', 'Employee records, attendance, month end for Zoho Payroll, leave, assets, policies'],
    ['money', 'receipt', 'violet', 'Money', 'Expense claims, advances and loans, farmer payments'], ['ops', 'shield', 'red', 'Safety & equipment', 'Checklists, incidents, equipment and maintenance'],
    ['carbon', 'flame', 'earth', 'Production & carbon', 'Kiln batches, lab results, farm applications, saplings, chain of custody'], ['supply', 'box', 'amber', 'Purchasing & supply', 'Suppliers, purchase requests, transfers, dispatch']];
  const ops = mods.map(([g, icon, tone, title, sub]) => lrow({ href: `#hub/${g}`, icon, tone, title, sub })).join('') + lrow({ href: '#map', icon: 'map', tone: 'green', title: 'Map', sub: 'Sites, farm plots, applications, incidents, people on site' }) + lrow({ href: '#reports', icon: 'chart', tone: 'blue', title: 'Reports', sub: 'Month summary and CSV downloads for Excel' });
  return `<h1 class="large">Manage</h1><p class="sub">${esc(KL.user.designation || ROLE_TEXT[KL.user.role] || KL.user.role)}</p><div class="card flush">${rows}</div>${group('Operations', `<div class="card flush">${ops}</div>`)}${['admin', 'hr'].includes(KL.user.role) ? group('HR set-up', `<div class="card flush">${lrow({ href: '#hrsettings', icon: 'cog', title: 'HR settings & integrations', sub: 'Approval chains, leave policy, work hours, WhatsApp, Tally' })}</div>`) : ''}`;
};

/* ---------------------------------------------------------------- Dashboard */
Views.dashboardBody = () => {
  const d = data('dashboard', () => api('/api/dashboard'));
  if (d === null) return spinner();
  if (d.error) return errorBox(d.error);
  const low = d.stock.filter((s) => s.low);
  const pend = KL.me?.pendingApprovals || 0;
  const t = d.tasks || { total: 0, done: 0, doing: 0, late: 0, doneWeek: 0 };
  const pct = t.total ? Math.round((t.done / t.total) * 100) : 0;
  const days = d.days || [];
  const top = Math.max(1, d.fieldTotal || 0, ...days.map((x) => x.present));
  const chart = `<div class="chart">${days.map((x, i) => {
    const dt = new Date(x.date + 'T00:00:00');
    const today = i === days.length - 1;
    return `<div class="bar ${today ? 'today' : ''} ${x.present ? '' : 'zero'}" title="${esc(dt.toLocaleDateString(appLocale(), { weekday: 'short', day: 'numeric', month: 'short' }))}: ${x.present} checked in, ${fmtNum(x.km)} km"><i style="height:${Math.max(4, (x.present / top) * 100)}%;animation-delay:${i * 0.03}s"></i><small>${esc(dt.toLocaleDateString('en-IN', { weekday: 'narrow' }))}</small></div>`;
  }).join('')}</div>`;
  return `
    <div class="tiles auto" style="margin-top:16px">
      <a class="tile feature" href="#team"><div class="ti">${ic('pin')}</div><b>${num(d.onSite.length, 'd-onsite')}</b><span>on site now</span></a>
      <div class="tile"><div class="ti">${ic('users')}</div><b>${num(d.todayAttendance, 'd-att')}<small class="muted" style="font-size:16px">/${d.fieldTotal}</small></b><span>checked in today</span></div>
      <a class="tile ${pend ? 'warn' : ''}" href="#approvals"><div class="ti">${ic('check')}</div><b>${num(pend, 'd-pend')}</b><span>awaiting approval</span></a>
      <a class="tile ${low.length ? 'bad' : ''}" href="#dashboard"><div class="ti">${ic('box')}</div><b>${num(low.length, 'd-low')}</b><span>low-stock items</span></a>
      <div class="tile blue"><div class="ti">${ic('bike')}</div><b>${num(d.travelMonth.amt, 'd-travel', 'rupee')}</b><span>travel approved this month · ${fmtNum(d.travelMonth.km)} km</span></div>
      <a class="tile violet" href="#farmers"><div class="ti">${ic('sprout')}</div><b>${num(d.farmers, 'd-farmers')}</b><span>farmers · ${d.docsWeek} signed this week</span></a>
    </div>
    <div class="cols" style="margin-top:14px">
      <div class="card"><div class="row between"><b class="card-title">Attendance · 14 days</b><span class="muted" style="font-size:13px;font-weight:700">field staff checked in</span></div>${chart}</div>
      <a class="card hover" href="#planner" style="text-decoration:none;color:inherit;display:block"><div class="row between"><b class="card-title">Tasks</b><span class="chev">${ic('chevron')}</span></div>
        <div class="row" style="gap:20px;margin-top:12px;flex-wrap:wrap"><div class="donut" style="background:conic-gradient(var(--accent) 0 ${pct}%, var(--info) ${pct}% ${pct + (t.total ? Math.round((t.doing / t.total) * 100) : 0)}%, var(--surface-2) 0)" data-label="${pct}%"></div>
        <div class="legend-list"><span><i style="background:var(--accent)"></i>${t.done} of ${t.total} done</span><span><i style="background:var(--info)"></i>${t.doing} in progress</span><span><i style="background:var(--danger)"></i>${t.late} late</span><span><i style="background:var(--accent-tint)"></i>${t.doneWeek} finished this week</span></div></div></a>
    </div>
    ${d.ops ? `<div class="tiles auto" style="margin-top:14px"><a class="tile earth" href="#carbon"><div class="ti">${ic('flame')}</div><b>${num(d.ops.biocharMonth, 'd-char')}</b><span>kg biochar this month · ${d.ops.batchesMonth} batches</span></a><a class="tile ok" href="#rec/application"><div class="ti">${ic('sprout')}</div><b>${num(d.ops.appliedMonth, 'd-applied')}</b><span>kg applied on farms</span></a><a class="tile ${d.ops.incidentsOpen ? 'bad' : ''}" href="#rec/incident"><div class="ti">${ic('alert')}</div><b>${num(d.ops.incidentsOpen, 'd-inc')}</b><span>open incidents</span></a><a class="tile ${d.ops.equipmentDown ? 'warn' : ''}" href="#rec/equipment"><div class="ti">${ic('cog')}</div><b>${num(d.ops.equipmentDown, 'd-eq')}</b><span>equipment needing attention</span></a><a class="tile violet" href="#approvals"><div class="ti">${ic('receipt')}</div><b>${num(d.ops.expensesPending, 'd-exp')}</b><span>expense claims waiting</span></a><a class="tile blue" href="#map"><div class="ti">${ic('map')}</div><b>${KL.boot.sites.length}</b><span>sites on the map</span></a></div>` : ''}
    ${low.length ? `<div class="banner bad" style="margin-top:14px">${ic('alert')}<div><b>Low stock</b><p>${low.map((s) => `${esc(s.item)} at ${esc(s.site)}: ${fmtNum(s.balance, 1)} ${esc(s.unit)}`).join(' · ')}</p></div></div>` : ''}
    ${group('On site now', d.onSite.length ? `<div class="card flush">${d.onSite.map((a) => `<div class="lrow-static row">${avatar(a.user_name, 'lg')}<span class="tx" style="flex:1;min-width:0"><b>${esc(a.user_name)}</b><span class="muted" style="font-size:13px;display:block">${esc(a.site_name)} · since ${esc(fmtDate(a.checkin_at).split(', ')[1] || fmtDate(a.checkin_at))} · <span data-since="${esc(a.checkin_at)}">${esc(duration(a.checkin_at))}</span></span></span>${a.status === 'pending' ? tag('exception', 'warn') : tag('on site', 'ok')}</div>`).join('')}</div>` : emptyState('pin', 'Nobody on site right now'), '', '<a href="#team">Team activity</a>')}
    <p class="hint" style="margin-top:12px">${d.updatesToday} daily update${d.updatesToday === 1 ? '' : 's'} today · ${d.openFeedback} open complaint${d.openFeedback === 1 ? '' : 's'} or suggestion${d.openFeedback === 1 ? '' : 's'}</p>`;
};
Views.dashboard = () => {
  const d = KL.cache.dashboard;
  const stock = d && !d.error ? d.stock : [];
  const bySite = {};
  for (const s of stock) (bySite[s.site] ||= []).push(s);
  return `${topbar('Dashboard', '#home', `<button type="button" class="btn icon-only" data-action="refreshDash" aria-label="Refresh">${ic('refresh')}</button>`)}${Views.dashboardBody()}
    ${Object.keys(bySite).length ? group('Stock by site', Object.entries(bySite).map(([site, items]) => `<div class="card" style="margin-top:8px"><b>${esc(site)}</b><div class="kv" style="margin-top:6px">${items.map((i) => `<span>${esc(i.item)}</span><span class="${i.low ? 'muted' : ''}" style="${i.low ? 'color:var(--danger)' : ''}">${fmtNum(i.balance, 1)} ${esc(i.unit)}${i.low ? ' · low' : ''}</span>`).join('')}</div></div>`).join('')) : ''}`;
};
Actions.refreshDash = () => { invalidate('dashboard'); refreshMe().then(render); render(); };

/* ---------------------------------------------------------------- Approvals */
Actions.decide = async (el) => {
  const { kind, id, decision } = el.dataset;
  const reject = decision === 'rejected';
  const v = await modal({ title: reject ? 'Reject with a reason' : 'Approve', fields: [{ key: 'note', label: reject ? 'Reason (the employee sees this)' : 'Note (optional)', type: 'textarea' }], confirmText: reject ? 'Reject' : 'Approve', danger: reject });
  if (!v) return;
  if (reject && !v.note) return toast('Give a reason for rejecting', 'error');
  try {
    await api(`/api/${kind}/${id}/decide`, { json: { decision, note: v.note } });
    invalidate('approvals', 'dashboard', 'trips', 'attendance', 'leaves'); await refreshMe(); toast(reject ? 'Rejected' : kind === 'leaves' ? 'Approved (sent on if HR also needs to approve)' : 'Approved'); render();
  } catch (e) { toast(e.message, 'error'); }
};

/* ---------------------------------------------------------------- Team */
Views.team = () => {
  const tab = F('team-tab', 'attendance') === 'updates' ? 'attendance' : F('team-tab', 'attendance'); // daily updates have their own tab
  const att = tab === 'attendance' ? data('attendance:team', () => api('/api/attendance?scope=team&days=7')) : null;
  const trips = tab === 'trips' ? data('trips:team', () => api('/api/trips?scope=team')) : null;
  const upd = tab === 'updates' ? data('updates:team', () => api('/api/updates?scope=team&days=7')) : null;
  let body = '';
  if (tab === 'attendance') body = att === null ? spinner() : att.error ? errorBox(att.error) : att.rows.length ? `<div class="card flush">${att.rows.map((a) => attRow(a, true)).join('')}</div>` : '<div class="card"><p class="empty">No check-ins in 7 days.</p></div>';
  if (tab === 'trips') body = trips === null ? spinner() : trips.error ? errorBox(trips.error) : trips.rows.length ? `<div class="card flush">${trips.rows.filter((t) => t.status !== 'open').map((t) => tripRow(t, true)).join('')}</div>` : '<div class="card"><p class="empty">No trips yet.</p></div>';
  if (tab === 'updates') body = upd === null ? spinner() : upd.error ? errorBox(upd.error) : upd.rows.length ? `<div class="card flush">${timeline(upd.rows.map((r) => ({ title: `${r.user_name} · ${fmtDate(r.date, false)}${r.hours ? ` · ${r.hours} h` : ''}${r.site_name ? ` · ${r.site_name}` : ''}`, sub: `${esc(r.summary)}${r.blockers ? `<br><b class="bad-text">Blocker:</b> ${esc(r.blockers)}` : ''}`, tone: r.blockers ? 'warn' : '' })))}</div>` : emptyState('note', 'No updates in 7 days');
  return `${topbar('Team activity', '#hr')}
    <div class="seg">${[['attendance', 'Attendance'], ['trips', 'Trips']].map(([k, l]) => `<button type="button" data-action="teamTab" data-tab="${k}" aria-pressed="${tab === k}">${l}</button>`).join('')}</div>
    <div style="margin-top:10px">${body}</div>`;
};
Actions.teamTab = (el) => { setF('team-tab', el.dataset.tab); render(); };

/* ---------------------------------------------------------------- Daily updates (managers, HR, director) */
Views.dailyupd = () => {
  const show = F('du-show', 'today');
  const days = show === 'today' ? 1 : 7;
  const upd = data(`updates:team:${days}`, () => api(`/api/updates?scope=team&days=${days}`));
  const ppl = data('hr:people', () => api('/api/hr/people'));
  const head = `${topbar('Daily updates')}<p class="sub">What the team did, what is next, and who needs help</p>`;
  if (upd === null || ppl === null) return `${head}${spinner()}`;
  if (upd.error || ppl.error) return `${head}${errorBox(upd.error || ppl.error)}`;
  const today = todayISO();
  const field = ppl.rows.filter((u) => u.active && u.role === 'field' && u.app_access);
  const sentToday = new Set(upd.rows.filter((r) => r.date === today).map((r) => r.user_id));
  const help = upd.rows.filter((r) => r.blockers && r.blockers.trim());
  const rows = show === 'help' ? help : show === 'today' ? upd.rows.filter((r) => r.date === today) : upd.rows;
  const missing = field.filter((u) => !sentToday.has(u.id));
  const card = (r) => `<div class="card du-card"><div class="row" style="align-items:flex-start">${avatar(r.user_name, 'lg')}<div class="tx" style="flex:1;min-width:0"><b>${esc(r.user_name)}</b><span class="muted" style="font-size:13px;display:block">${r.ref ? `${esc(r.ref)} · ` : ''}${esc(fmtDate(r.date, false))}${r.hours ? ` · ${fmtNum(r.hours, 1)} h` : ''}${r.site_name ? ` · ${esc(r.site_name)}` : ''}</span></div>${r.blockers && r.blockers.trim() ? tag('Help', 'warn') : ''}</div>
    <p class="du-text">${esc(r.summary)}</p>${r.blockers && r.blockers.trim() ? `<div class="banner warn">${ic('alert')}<div><b>Needs help</b><p>${esc(r.blockers)}</p></div></div>` : ''}
    <div class="btns"><button type="button" class="btn small" data-action="duReply" data-user="${esc(r.user_id)}" data-name="${esc(r.user_name)}">${ic('chat')} Message</button>${r.blockers && r.blockers.trim() && can('planner.plans') ? `<button type="button" class="btn small primary" data-action="duTask" data-user="${esc(r.user_id)}" data-title="${esc(r.blockers)}">${ic('kanban')} Make it a task</button>` : ''}</div></div>`;
  return `${head}
    <div class="today-tiles" style="grid-template-columns:repeat(2,minmax(0,1fr))"><div class="today-tile ok"><span class="tt-lbl">Sent today</span><b>${field.length - missing.length}<small> / ${field.length}</small></b></div><button type="button" class="today-tile warn" data-action="duShow" data-show="help" style="border:0;font:inherit;text-align:left;cursor:pointer"><span class="tt-lbl">Need help</span><b>${help.filter((r) => r.date === today).length}</b></button></div>
    <div class="chips pills" style="margin:14px 0 4px">${[['today', 'Today'], ['help', 'Needs help'], ['week', 'Last 7 days']].map(([k, l]) => `<button type="button" data-action="duShow" data-show="${k}" aria-pressed="${show === k}">${l}</button>`).join('')}</div>
    ${rows.length ? `<div class="stack" style="margin-top:12px">${rows.map(card).join('')}</div>` : `<div class="card" style="margin-top:12px"><p class="empty">${show === 'help' ? 'Nobody asked for help.' : 'No updates yet today.'}</p></div>`}
    ${show === 'today' && missing.length ? group(`Not sent yet · ${missing.length}`, `<div class="card flush">${missing.map((u) => `<div class="lrow-static row">${avatar(u.name, 'lg')}<span class="tx" style="flex:1;min-width:0"><b>${esc(u.name)}</b><span class="muted" style="font-size:13px;display:block">${esc(u.designation || '')}</span></span><button type="button" class="btn small" data-action="duRemind" data-user="${esc(u.id)}" data-name="${esc(u.name)}">Remind</button></div>`).join('')}</div>`) : ''}`;
};
Actions.duShow = (el) => { setF('du-show', el.dataset.show); render(); };
Actions.duRemind = async (el) => {
  try { await api('/api/updates/remind', { json: { userId: el.dataset.user } }); toast(`Reminder sent to ${firstName(el.dataset.name)}`); el.disabled = true; el.textContent = 'Reminded'; } catch (e) { toast(e.message, 'error'); }
};
Actions.duReply = async (el) => {
  const v = await modal({ title: `Message ${firstName(el.dataset.name)}`, fields: [{ key: 'text', label: 'Message', type: 'textarea', value: 'Thanks for the update.' }], confirmText: 'Send' });
  if (!v) return;
  try { await api('/api/updates/reply', { json: { userId: el.dataset.user, text: v.text } }); toast('Sent'); } catch (e) { toast(e.message, 'error'); }
};
Actions.duTask = async (el) => {
  let plans;
  try { plans = (await api('/api/planner/plans')).plans || []; } catch (e) { toast(e.message, 'error'); return; }
  if (!plans.length) { toast('Make a plan in the Planner first', 'error'); return; }
  const v = await modal({ title: 'Make it a task', fields: [{ key: 'title', label: 'Task', value: el.dataset.title }, { key: 'plan', label: 'Plan', type: 'select', options: plans.map((p) => p.name), value: plans[0].name }, { key: 'due', label: 'Due date', type: 'date', value: addDays(todayISO(), 1) }], confirmText: 'Add task' });
  if (!v) return;
  const plan = plans.find((p) => p.name === v.plan) || plans[0];
  try { await api('/api/planner/tasks', { json: { planId: plan.id, title: v.title, assignees: [el.dataset.user], dueDate: v.due, priority: 'important' } }); invalidate('planner'); toast('Task added. They see it on Today.'); } catch (e) { toast(e.message, 'error'); }
};

/* ---------------------------------------------------------------- HR desk */
Views.hrdesk = () => {
  const fb = data('feedback:all', () => api('/api/feedback'));
  data('hr:posh', () => api('/api/hr/posh'));
  const lv = data('leaves:team', () => api('/api/leaves?scope=team'));
  const users = data('admin:users', () => api('/api/admin/users'));
  return `${topbar('HR desk', '#home')}${overdueBanner()}
    ${group('Complaints & suggestions', `<div class="card flush">${lrow({ href: '#cases', icon: 'inbox', tone: 'red', title: 'Committee cases', sub: fb && !fb.error ? esc(`${fb.rows.filter((r) => r.status !== 'closed').length} open`) : '' })}${lrow({ href: '#committees', icon: 'users', tone: 'violet', title: 'Committees', sub: 'Members, mailboxes, policies' })}</div>`)}
    ${group('Employee documents', `<div class="card stack"><p class="hint">Upload a payslip from Zoho Payroll, a letter or an ID document; the employee sees it under Me → My documents and gets a notification.</p>
      ${users === null ? spinner() : users.error ? errorBox(users.error) : field('Employee', select('hr-user', F('hr-user', ''), users.rows.filter((u) => u.active).map((u) => [u.id, `${u.employee_id} · ${u.name}`]), { blank: 'Choose' }))}
      <div class="grid2">${field('Title', input('hr-title', F('hr-title'), { placeholder: 'e.g. Payslip October 2026' }))}${field('Category', select('hr-cat', F('hr-cat', 'Payslip'), ['Payslip', 'Policy declaration (paper)', 'Offer letter', 'Appointment letter', 'ID card', 'Policy', 'Form 16', 'Other']))}</div>
      <button type="button" class="btn primary wide" data-action="hrUpload">Choose file and upload</button></div>`)}
    ${group('Leave register', lv === null ? spinner() : lv.error ? errorBox(lv.error) : lv.rows.length ? `<div class="card flush">${lv.rows.map((l) => `<div class="lrow-static row"><span class="tx" style="flex:1"><b>${esc(l.user_name)} · ${esc(l.type)}</b><span class="muted" style="font-size:13px;display:block">${esc(fmtDate(l.from_date, false))}${l.to_date !== l.from_date ? ` to ${esc(fmtDate(l.to_date, false))}` : ''}${l.reason ? ` · ${esc(l.reason)}` : ''}</span></span>${statusTag(l.status)}</div>`).join('')}</div>` : '<div class="card"><p class="empty">No leave yet.</p></div>')}`;
};
Actions.hrUpload = () => {
  if (!F('hr-user')) return toast('Choose the employee first', 'error');
  if (!F('hr-title', '').trim()) return toast('Give the document a title', 'error');
  pickFile('*/*', async (file) => {
    const form = new FormData();
    form.append('userId', F('hr-user')); form.append('title', F('hr-title')); form.append('category', F('hr-cat', 'Payslip')); form.append('file', file, file.name);
    try { await api('/api/hr/documents', { form }); clearF('hr-title'); toast('Uploaded and the employee notified'); render(); } catch (e) { toast(e.message, 'error'); }
  });
};
/* ---------------------------------------------------------------- Admin */
Views.admin = (arg) => {
  if (arg === 'users') return adminUsers();
  if (arg === 'sites') return adminSites();
  if (arg === 'items') return adminItems();
  if (arg === 'templates') return adminTemplates();
  if (arg === 'company') return adminCompany();
  if (arg === 'audit') return adminAudit();
  const admin = isAdmin(), mgr = KL.user.role === 'manager';
  const people = ['users.add', 'users.edit', 'users.deactivate', 'users.pin', 'users.role'].some(can);
  return `${topbar('Administration', '#settings')}<div class="card flush">
    ${people ? lrow({ href: '#admin/users', icon: 'user', tone: 'green', title: 'Users & PINs', sub: 'Add staff, designations, sites, reset a PIN' }) : ''}
    ${can('sites.edit') ? lrow({ href: '#admin/sites', icon: 'pin', tone: 'blue', title: 'Sites & geofences', sub: 'Location, allowed radius' }) : ''}
    ${can('sites.edit') ? lrow({ href: '#admin/items', icon: 'box', tone: 'amber', title: 'Register items', sub: 'Diesel, biomass, outputs per site, low-stock alerts' }) : ''}
    ${can('sites.edit') ? lrow({ href: '#admin/templates', icon: 'doc', title: 'Document templates', sub: 'Text and fields of the documents farmers sign' }) : ''}
    ${can('settings.company') ? lrow({ href: '#admin/company', icon: 'building', title: 'Company & rates', sub: 'Name, address, travel rates, authorised signature' }) : ''}
    ${can('settings.audit') ? lrow({ href: '#admin/audit', icon: 'receipt', title: 'Audit log', sub: 'Who did what, when' }) : ''}
  </div>
  ${KL.boot.demo && (admin || mgr) ? group('Prototype', `<div class="card flush">${lrow({ action: 'demoReset', icon: 'refresh', tone: 'violet', title: 'Reset the demo', sub: 'Wipe everything and rebuild the sample people, sites, tasks and records' })}</div>`) : ''}`;
};
function adminUsers() {
  const users = data('admin:users', () => api('/api/admin/users'));
  return `${topbar('Users & PINs', '#admin', can('users.add') ? '<button type="button" class="btn small primary" data-action="userEdit">+ Add</button>' : '')}
    ${users === null ? spinner() : users.error ? errorBox(users.error) : `<div class="card flush">${users.rows.map((u) => lrow({ action: 'userEdit', data: { id: u.id }, icon: { admin: 'shield', manager: 'compass', hr: 'folder', field: 'sprout' }[u.role] || 'user', tone: u.active ? '' : 'red', title: `${u.name}${u.active ? '' : ' (inactive)'}`, sub: `${esc(u.employee_id)} · ${esc(u.role)}${u.designation ? ` · ${esc(u.designation)}` : ''}${deptName(u.dept) ? ` · ${esc(deptName(u.dept))}` : ''} · ${u.sites.map(siteName).map(esc).join(', ') || 'all sites'}${u.must_change_pin ? ' · starting PIN' : ''}` })).join('')}</div>`}`;
}
const deptName = (key) => (KL.boot.departments || []).find((d) => d.key === key)?.name || '';
Actions.userEdit = async (el) => {
  // adding and editing use the one-page employee form; without "Edit employee details" only the PIN reset is offered
  if (!el.dataset.id && can('users.add')) { KL.ui.efInit = null; location.hash = '#empnew'; return; }
  if (el.dataset.id && can('users.edit')) { KL.ui.efInit = null; location.hash = `#empedit/${el.dataset.id}`; return; }
  const users = KL.cache['admin:users'];
  const u = el.dataset.id ? users.rows.find((x) => x.id === el.dataset.id) : null;
  if (u && !can('users.edit')) {
    if (can('users.pin') && (await modal({ title: `Reset ${u.name}'s PIN?`, message: 'Signs the employee out of every phone and sets a new starting PIN.', confirmText: 'Reset PIN' }))) await resetPinFlow(u);
    return;
  }
  const depts = KL.boot.departments || [];
  const deptOpts = ['(none)', ...depts.map((d) => d.name)];
  const siteOpts = KL.boot.sites.map((s) => s.name);
  const offices = KL.boot.offices || [];
  const roleOpts = (KL.boot.roles || []).filter((r) => r.level !== 'admin' || isAdmin());
  const projOpts = (KL.boot.projectList || []).map((p) => p.name);
  if (!u && !offices.length) { toast('Add the reporting offices in Administration > Company first', 'error'); return; }
  const v = await modal({ title: u ? `Edit ${u.name}` : 'New employee', message: u ? '' : 'The employee code is made from the project and office, e.g. BIO01001.', fields: [
    ...(u ? [{ key: 'employee_id', label: 'Employee code', value: u.employee_id }]
      : [{ key: 'project', label: 'Project', type: 'select', options: projOpts, value: projOpts[0] },
        { key: 'office', label: 'Reporting office', type: 'select', options: offices.map((o) => `${o.code} · ${o.name}`), value: `${offices[0].code} · ${offices[0].name}` }]),
    { key: 'name', label: 'Full name', value: u?.name || '' },
    { key: 'department', label: u ? 'Department' : 'Department (blank = from the project)', type: 'select', options: u ? deptOpts : ['From the project', ...deptOpts.slice(1)], value: u ? deptName(u.dept) || '(none)' : 'From the project' },
    ...(!u || can('users.role') ? [{ key: 'roleName', label: 'Designation (Settings > Lists > Designations)', type: 'select', options: roleOpts.map((r) => r.name), value: roleOpts.some((r) => r.name === u?.designation) ? u.designation : (roleOpts.find((r) => r.level === (u?.role || 'field')) || roleOpts[0] || {}).name }] : []),
    { key: 'phone', label: 'Mobile', type: 'tel', value: u?.phone || '' }, { key: 'email', label: 'Email (if any, for Microsoft sign-in later)', type: 'email', value: u?.email || '' },
    ...(!u || can('users.assign') ? [{ key: 'sites', label: 'Sites (comma-separated names, blank = all)', value: (u?.sites || []).map(siteName).join(', '), placeholder: siteOpts.join(', ') }] : []),
    ...(u ? (can('users.deactivate') ? [{ key: 'active', label: 'Status', type: 'select', options: ['active', 'inactive'], value: u.active ? 'active' : 'inactive' }] : []) : [{ key: 'pin', label: 'Starting PIN (4–6 digits, employee changes it)', value: '1234', inputmode: 'numeric' }]),
  ], confirmText: u ? 'Save' : 'Create' });
  if (!v) return;
  if (u && v.roleName === undefined) { v.role = u.role; v.designation = u.designation; } // role not editable here: keep it
  if (u && v.active === undefined) v.active = u.active ? 'active' : 'inactive';
  const dept = depts.find((d) => d.name === v.department)?.key || '';
  const sites = v.sites === undefined && u ? u.sites : v.sites ? v.sites.split(',').map((n) => KL.boot.sites.find((s) => s.name.toLowerCase() === n.trim().toLowerCase())?.id).filter(Boolean) : [];
  try {
    const r = await api('/api/admin/users', { json: { ...v, department: dept, id: u?.id, sites, active: u ? v.active === 'active' : true, project: (KL.boot.projectList || []).find((p) => p.name === v.project)?.key || '', office: (v.office || '').split(' · ')[0] } });
    invalidate('admin:users');
    if (u && u.id === KL.user.id) await refreshMe(); // your own name or designation: update the menu card now
    render();
    if (u) toast('Saved');
    else await modal({ title: `Employee code ${r.employeeId}`, message: `${v.name} signs in with ${r.employeeId} and the starting PIN ${v.pin}. Give both to them; the app asks for a new PIN at the first sign-in.`, noButtons: true, html: '<div class="actions"><button type="button" class="btn primary wide" data-modal="confirm">Done</button></div>' });
    if (u && can('users.pin') && (await modal({ title: 'Reset PIN too?', message: 'Signs the employee out of every phone and sets a new starting PIN.', confirmText: 'Reset PIN', cancelText: 'No' }))) await resetPinFlow(u);
  } catch (e) { toast(e.message, 'error'); }
};
async function resetPinFlow(u) {
  const p = await modal({ title: 'New starting PIN', fields: [{ key: 'pin', label: 'PIN (4–6 digits)', value: '1234', inputmode: 'numeric' }], confirmText: 'Reset' });
  if (!p) return;
  try { await api(`/api/admin/users/${u.id}/reset-pin`, { json: { pin: p.pin } }); toast('PIN reset'); } catch (e) { toast(e.message, 'error'); }
}
function adminSites() {
  const all = data('admin:sites', () => api('/api/admin/sites'));
  const list = all && !all.error ? all.rows : KL.boot.sites;
  return `${topbar('Sites & geofences', '#admin', '<button type="button" class="btn small primary" data-action="siteEdit">+ Add</button>')}
    <div class="card flush">${list.map((s) => lrow({ action: 'siteEdit', data: { id: s.id }, icon: PROJECT_ICON[s.project_type] || 'pin', title: s.name, sub: `${s.active === 0 ? 'closed · ' : ''}${esc(s.project_type)} · ${s.lat.toFixed(5)}, ${s.lng.toFixed(5)} · radius ${s.radius_m} m${s.address ? ` · ${esc(s.address)}` : ''}` })).join('')}</div>
    <p class="hint" style="margin-top:8px">Open a site to move its centre on the map, change the radius or the check-in rule, and choose its team. At the site, "Use where I am standing" takes a careful GPS reading.</p>`;
}
/** Sites open the one-page site form (map, geofence, check-in rule, team). */
Actions.siteEdit = (el) => { KL.ui.sfInit = null; KL.ui.sfProject = ''; location.hash = el.dataset.id ? `#siteedit/${el.dataset.id}` : '#sitenew'; };
function adminItems() {
  const bySite = {};
  for (const it of KL.boot.items) (bySite[it.site_id] ||= []).push(it);
  return `${topbar('Register items', '#admin', '<button type="button" class="btn small primary" data-action="itemEdit">+ Add</button>')}
    ${Object.entries(bySite).map(([sid, items]) => group(siteName(sid), `<div class="card flush">${items.map((it) => lrow({ action: 'itemEdit', data: { id: it.id }, icon: it.kind === 'product' ? 'box' : 'fuel', title: it.name, sub: `${esc(it.unit)} · ${it.kind}${it.low_stock ? ` · alert below ${fmtNum(it.low_stock)}` : ''}` })).join('')}</div>`)).join('') || '<div class="card"><p class="empty">No items yet.</p></div>'}`;
}
Actions.itemEdit = async (el) => {
  const it = el.dataset.id ? KL.boot.items.find((x) => x.id === el.dataset.id) : null;
  const v = await modal({ title: it ? `Edit ${it.name}` : 'New register item', fields: [
    { key: 'site', label: 'Site', type: 'select', options: KL.boot.sites.map((s) => s.name), value: it ? siteName(it.site_id) : KL.boot.sites[0]?.name },
    { key: 'name', label: 'Item', value: it?.name || '', placeholder: 'e.g. Diesel' }, { key: 'unit', label: 'Unit', value: it?.unit || 'kg', placeholder: 'kg, L, kWh, bags' },
    { key: 'kind', label: 'Kind', type: 'select', options: ['input', 'product'], value: it?.kind || 'input' }, { key: 'low_stock', label: 'Low-stock alert below (inputs)', value: it?.low_stock ?? 0, inputmode: 'decimal' },
    ...(it ? [{ key: 'active', label: 'Status', type: 'select', options: ['active', 'inactive'], value: it.active ? 'active' : 'inactive' }] : []),
  ], confirmText: 'Save' });
  if (!v) return;
  const site = KL.boot.sites.find((s) => s.name === v.site);
  try { await api('/api/admin/items', { json: { ...v, id: it?.id, site_id: site?.id, active: it ? v.active === 'active' : true } }); await reloadBoot(); invalidate('registers'); toast('Saved'); render(); } catch (e) { toast(e.message, 'error'); }
};
function adminTemplates() {
  const t = data('admin:templates', () => api('/api/admin/templates'));
  return `${topbar('Document templates', '#admin', '<button type="button" class="btn small primary" data-action="templateEdit">+ Add</button>')}
    ${t === null ? spinner() : t.error ? errorBox(t.error) : `<div class="card flush">${t.rows.map((x) => lrow({ action: 'templateEdit', data: { id: x.id }, icon: 'doc', tone: x.active ? '' : 'red', title: x.name, sub: `${esc(x.project_type)} · ${x.fields.length} fields: ${x.fields.map((f) => esc(f.label)).join(', ')}` })).join('')}</div>`}
    <p class="hint" style="margin-top:8px">Write the body with placeholders like {{name}}, {{village}}, {{survey_no}} and any field key. Fields: one per line as <code>key | Label | text or number | required</code>.</p>`;
}
Actions.templateEdit = async (el) => {
  const t = el.dataset.id ? KL.cache['admin:templates'].rows.find((x) => x.id === el.dataset.id) : null;
  const v = await modal({ title: t ? `Edit ${t.name}` : 'New template', fields: [
    { key: 'name', label: 'Name', value: t?.name || '' }, { key: 'project_type', label: 'Project type', type: 'select', options: ['agroforestry', 'biochar', 'gasifier', 'other'], value: t?.project_type || 'agroforestry' },
    { key: 'body', label: 'Body text (use {{name}}, {{village}}, {{company}} and field keys)', type: 'textarea', value: t?.body || '' },
    { key: 'fields', label: 'Fields, one per line: key | Label | text/number | required', type: 'textarea', value: (t?.fields || []).map((f) => `${f.key} | ${f.label} | ${f.type} | ${f.required ? 'required' : ''}`).join('\n') },
    ...(t ? [{ key: 'active', label: 'Status', type: 'select', options: ['active', 'inactive'], value: t.active ? 'active' : 'inactive' }] : []),
  ], confirmText: 'Save' });
  if (!v) return;
  const fields = v.fields.split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((p) => p[0]).map(([key, label, type, req]) => ({ key, label: label || key, type: type === 'number' ? 'number' : 'text', required: /req/i.test(req || '') }));
  try { await api('/api/admin/templates', { json: { ...v, fields, id: t?.id, active: t ? v.active === 'active' : true } }); invalidate('admin:templates'); await reloadBoot(); toast('Saved'); render(); } catch (e) { toast(e.message, 'error'); }
};
function adminCompany() {
  const c = KL.boot.company, tr = KL.boot.travel;
  return `${topbar('Company & rates', '#admin')}
    <div class="card stack">
      ${field('Company name', input('co-name', F('co-name', c.name)))}${field('Short name (shown on Home)', input('co-short', F('co-short', c.short || '')))}${field('Address (on letterhead)', input('co-address', F('co-address', c.address || '')))}
      <p class="hint">Travel rates, leave types and reporting offices are in Settings > Lists.</p>
      <button type="button" class="btn primary wide" data-action="companySave">Save</button>
    </div>
    <div class="card stack" style="margin-top:10px"><b>Authorised signature</b><p class="hint">A PNG of the director's signature with a transparent or white background. It is placed in the company's box on every farmer document.</p><button type="button" class="btn" data-action="companySig">Upload signature image</button></div>`;
}
Actions.companySave = async () => {
  const c = KL.boot.company;
  try {
    await api('/api/admin/settings', { json: { company: { name: F('co-name', c.name), short: F('co-short', c.short || ''), address: F('co-address', c.address || '') } } });
    await reloadBoot(); toast('Saved'); render();
  } catch (e) { toast(e.message, 'error'); }
};
Actions.companySig = () => pickFile('image/png,image/jpeg', async (file) => { const form = new FormData(); form.append('file', file, file.name); try { await api('/api/admin/company-signature', { form }); toast('Signature updated'); } catch (e) { toast(e.message, 'error'); } });
function adminAudit() {
  const a = data('admin:audit', () => api('/api/admin/audit'));
  return `${topbar('Audit log', '#admin')}${a === null ? spinner() : a.error ? errorBox(a.error) : `<div class="card flush">${a.rows.map((r) => `<div class="lrow-static"><b>${esc(r.action)}</b> <span class="muted">${esc(r.entity)}${r.detail ? ` · ${esc(r.detail)}` : ''}</span><br/><span class="hint">${esc(r.user_name || 'system')} · ${esc(fmtDate(r.at))}</span></div>`).join('')}</div>`}`;
}
Actions.demoReset = async () => {
  if (!(await modal({ title: 'Reset the demo?', message: 'Every record, photo and task is deleted and the sample data is built again. You stay signed in as yourself.', confirmText: 'Reset', danger: true }))) return;
  const emp = KL.user.employee_id;
  try {
    await api('/api/demo/reset', { json: {} });
    const r = await api('/api/auth/login', { json: { employeeId: emp, pin: KL.demoInfo?.pin || '1234', device: deviceName() } });
    await Outbox.all().then((items) => Promise.all(items.map((i) => Outbox.remove(i.id)))).catch(() => {});
    KL.outboxCount = 0;
    await signedIn(r);
    toast('Demo data rebuilt');
  } catch (e) { toast(e.message, 'error'); }
};
async function reloadBoot() { try { KL.boot = await api('/api/bootstrap'); } catch { /* keep */ } }
