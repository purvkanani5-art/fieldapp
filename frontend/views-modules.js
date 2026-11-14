/* Prototype modules: people (HR), money, safety & equipment, production & carbon, purchasing & supply.
   Most screens are generic: the server describes each record kind (fields, who may add, approval chain) and this
   file draws its list (#rec/kind), detail (#rec/kind/id) and form (#rec/kind/new, #rec/kind/id/edit). The parts
   with real logic have their own screens: people and employee records, attendance summary, carbon chain,
   map, reports, HR settings. */

const KDESC = {
  holiday: 'Company holiday calendar', shift: 'Shift timings and weekly offs', regularisation: 'Fix a missed or wrong check-in, approved by your manager',
  asset_issue: 'Phones, tools and safety kit issued to staff', training: 'Courses and certificates with expiry', goal: 'Targets and progress',
  review: 'Half-yearly ratings', policy: 'Policies everyone reads and accepts', onboarding: 'Joining checklists', exit: 'Exit checklist and final settlement',
  labour: 'Contract workers, days and wages (statutory register)', expense: 'Bills other than travel, with receipt', advance: 'Salary advances and loans; the monthly recovery goes to Zoho Payroll',
  farmer_payment: 'Incentives and carbon share paid to farmers', checklist_template: 'Daily and weekly checks to run', incident: 'Injuries, near misses, fires and spills',
  equipment: 'Kilns, gasifiers, loaders and service due dates', maintenance: 'Services and breakdown repairs', batch: 'Kiln runs: feedstock in, biochar out, yield',
  lab_result: 'Carbon content, H/Corg and pass or fail', application: 'Biochar spread on farms, with GPS and photo', sapling: 'Saplings given to farmers',
  survival: 'How many trees are alive', supplier: 'Who supplies what', purchase_request: 'Request, approve, order and receive', transfer: 'Move stock between sites',
  dispatch: 'Biochar sold and sent out',
};
const STATUS_TONE = { pending: 'warn', approved: 'ok', rejected: 'bad', open: 'warn', investigating: 'info', closed: 'ok', working: 'ok', 'needs service': 'warn', breakdown: 'bad',
  produced: 'info', tested: 'violet', applied: 'ok', issued: 'info', returned: 'ok', lost: 'bad', 'on track': 'ok', 'at risk': 'warn', done: 'ok', 'in progress': 'info',
  settled: 'ok', ordered: 'info', received: 'ok', processed: 'ok' };
const stag = (s) => tag(s === 'pending' ? 'awaiting approval' : s, STATUS_TONE[s] || '');
const kinds = () => data('m:kinds', () => api('/api/m/kinds'));
const kindDef = (k) => { const d = KL.cache['m:kinds']; return d && !d.error ? d.kinds[k] : null; };
const fmtVal = (f, v) => {
  if (v === undefined || v === null || v === '') return '–';
  if (f.type === 'money') return rupees(v);
  if (f.type === 'date') return fmtDate(String(v), false);
  if (f.type === 'datetime') return fmtDate(String(v).length === 16 ? `${v}:00` : String(v));
  if (f.type === 'user') return personById(v)?.name || '–';
  if (f.type === 'site') return siteName(v);
  if (f.type === 'farmer') { const fl = KL.cache.farmers; return (fl && !fl.error && fl.rows.find((x) => x.id === v)?.name) || 'Farmer'; }
  if (f.type === 'ref') { const r = KL.cache[`m:${f.ref}`]; return (r && !r.error && r.rows.find((x) => x.id === v)?.title) || '…'; }
  if (f.type === 'number') return fmtNum(v, 2);
  return String(v);
};
function recSub(k, r, inSite = false) {
  const parts = [];
  const want = ['action', 'date', 'amount', 'qty', 'qty_kg', 'output_kg', 'power_kwh', 'severity', 'site', 'person', 'farmer', 'category', 'type', 'species', 'count', 'due', 'valid_until', 'customer'];
  for (const key of want) {
    if (key === k.title || (inSite && key === 'site')) continue;
    const f = k.fields.find((x) => x.key === key);
    if (f && r.data[key] !== undefined && r.data[key] !== '') parts.push(fmtVal(f, r.data[key]));
    if (parts.length >= 3) break;
  }
  if (r.user_name && !k.fields.some((f) => f.key === 'person') && k.scope === 'own') parts.unshift(r.user_name);
  return parts.map(esc).join(' · ');
}

/* ---------------------------------------------------------------- hubs */
const HUB = {
  hr: { title: 'People', icon: 'users', tone: 'blue', extra: () => [
    isStaff() ? ['#people', 'users', 'blue', 'Employee directory', 'Records, reporting lines, sites'] : ['#person/me', 'user', 'blue', 'My employee record', 'Details, leave, assets, training'],
    ['#attsum', 'calendar', 'green', 'Attendance summary', 'Month by month: present, late, absent, overtime'],
    ['#leaves', 'sun', 'amber', 'Leave balances', 'Accrual, used, pending and what is left'],
    ...(isStaff() ? [['#monthend', 'lock', 'violet', 'Month end', 'Approve and lock attendance, export to Zoho Payroll'], ['#hrreg', 'list', '', 'Registers', 'Muster roll and leave register']] : []),
    ...(['admin', 'hr'].includes(KL.user.role) ? [['#hrsettings', 'cog', '', 'HR settings', 'Approval chains, leave policy, work hours']] : []),
  ] },
  money: { title: 'Money', icon: 'receipt', tone: 'violet', extra: () => [] },
  ops: { title: 'Safety & equipment', icon: 'shield', tone: 'red', extra: () => [['#map', 'map', 'green', 'Map', 'Sites, plots, incidents and people on site']] },
  carbon: { title: 'Production & carbon', icon: 'flame', tone: 'earth', extra: () => [['#carbon', 'leaf', 'green', 'Carbon chain of custody', 'Every batch from feedstock to farm, with checks'], ['#map', 'map', 'blue', 'Map', 'Farm plots and where biochar went']] },
  supply: { title: 'Purchasing & supply', icon: 'box', tone: 'amber', extra: () => [['#registers', 'box', 'amber', 'Site registers', 'Stock balances move with every batch, transfer and dispatch']] },
};
/* People: the staff tab for everything that is not tied to one site. */
Views.hr = () => {
  const pend = KL.me?.pendingApprovals || 0;
  const hrRole = ['admin', 'hr'].includes(KL.user.role);
  const row = (href, icon, tone, title, sub, right = '') => lrow({ href, icon, tone, title, sub, right });
  return `<h1 class="large">People</h1><p class="sub">Approvals, your team and HR for ${KL.user.all_sites ? 'everyone' : 'your projects'}</p>
    <div class="card flush">${row('#me', 'user', 'blue', `${KL.user.name}`, 'My record, leave, claims, settings')}</div>
    ${group('Today', `<div class="card flush">${row('#approvals', 'check', pend ? 'amber' : '', 'Approvals', 'Leave, claims, purchases, trips, check-in exceptions', pend ? tag(String(pend), 'warn') : '')}${row('#team', 'clock', 'green', 'Team activity', 'Attendance, trips and daily updates')}${row('#attsum', 'calendar', 'green', 'Attendance summary', 'Month grid: present, late, absent, overtime')}</div>`)}
    ${group('Month end', `<div class="card flush">${row('#monthend', 'lock', 'violet', 'Approve, lock and export', 'Managers confirm, HR locks; file for Zoho Payroll (paid days, LOP, OT, leave)')}${row('#hrreg', 'list', '', 'Registers', 'Muster roll and leave register, PDF or Excel')}${row('#changes', 'clock', '', 'Change log', 'Who changed attendance, leave or balances: old and new value')}</div>`)}
    ${group('Employees', `<div class="card flush">${row('#people', 'users', 'blue', 'Employee directory', hrRole ? 'Records, sites and projects, reporting lines' : 'Your team')}${row('#rec/expense', 'receipt', 'amber', 'Expense claims', 'With receipt photos')}${row('#rec/advance', 'receipt', '', 'Advances & loans', 'Recovery sent to Zoho Payroll')}${row('#rec/asset_issue', 'box', '', 'Assets issued', 'Phones, tools, safety kit')}${row('#rec/training', 'shield', 'green', 'Training & certificates', 'With expiry')}${row('#rec/goal', 'target', '', 'Goals', 'Targets and progress')}${row('#rec/review', 'chart', '', 'Reviews', 'Half-yearly ratings')}${row('#rec/regularisation', 'clock', '', 'Attendance corrections', 'Approved by managers')}</div>`)}
    ${group('Company', `<div class="card flush">${row('#notices', 'bell', 'amber', 'Notice board', 'Announcements with read receipts')}${row('#surveys', 'chart', 'blue', 'Surveys & eNPS', 'Anonymous pulse surveys')}${row('#rec/policy', 'doc', '', 'Policies', 'Everyone reads and accepts')}${row('#rec/holiday', 'calendar', 'violet', 'Holidays & shifts', 'Calendar used for leave and attendance')}${hrRole ? row('#rec/onboarding', 'users', 'blue', 'Onboarding & exits', 'Joining and leaving checklists') : ''}${hrRole ? row('#hrdesk', 'folder', 'amber', 'HR desk', 'Complaints, suggestions, employee documents') : ''}${KL.cache['hr:posh']?.onCommittee ? row('#poshdesk', 'shield', 'violet', 'Internal Committee (POSH)', 'Confidential complaints') : ''}${row('#reports', 'chart', 'earth', 'Reports', 'Month summary and CSV downloads')}${row('#admin', 'cog', '', 'Administration', 'Users and PINs, sites, registers, templates')}${hrRole ? row('#hrsettings', 'cog', '', 'HR settings & integrations', 'Approval chains, leave policy, WhatsApp, Zoho Payroll') : ''}</div>`)}`;
};
Views.hub = (group) => {
  const kd = kinds();
  const h = HUB[group] || HUB.hr;
  if (kd === null) return `${topbar(h.title, isStaff() ? '#manage' : '#work')}${spinner()}`;
  if (kd.error) return `${topbar(h.title)}${errorBox(kd.error)}`;
  const list = Object.values(kd.kinds).filter((k) => k.group === group && !k.hidden);
  const rows = [...h.extra().map(([href, icon, tone, title, sub]) => lrow({ href, icon, tone, title, sub })),
    ...list.map((k) => lrow({ href: `#rec/${k.key}`, icon: k.icon, tone: k.approval ? 'amber' : '', title: k.label, sub: `${KDESC[k.key] || ''}${k.approval ? ' · needs approval' : ''}`, right: k.canCreate ? '' : tag('view', '') }))];
  return `${topbar(h.title, isStaff() ? '#manage' : '#work')}<p class="sub">${esc(kd.groups[group] || '')}: ${list.length} registers, all with demo data. Open one to see it, or add your own.</p><div class="card flush">${rows.join('')}</div>`;
};

/* ---------------------------------------------------------------- records: list, detail, form */
Views.rec = (arg) => {
  const [kind, id, mode] = (arg || '').split('/');
  const kd = kinds();
  if (kd === null) return `${topbar('Loading', '#home')}${spinner()}`;
  if (kd.error) return `${topbar('Records', '#home')}${errorBox(kd.error)}`;
  const k = kd.kinds[kind];
  if (!k) return `${topbar('Not found', '#home')}${emptyState('alert', 'Unknown register')}`;
  if (id === 'new') return recForm(k, null);
  if (id && mode === 'edit') return recForm(k, id);
  if (id) return recDetail(k, id);
  return recList(k);
};
function preload(k) {
  for (const f of k.fields) {
    if (f.type === 'farmer') data('farmers', () => api('/api/farmers'));
    if (f.type === 'ref') data(`m:${f.ref}`, () => api(`/api/m/${f.ref}`));
  }
}
function recList(k) {
  preload(k);
  KL.ui.siteBack = null;
  const list = data(`m:${k.key}`, () => api(`/api/m/${k.key}`));
  const st = F(`rl-${k.key}-status`, '');
  const statuses = k.approval ? ['pending', 'approved', 'rejected'] : (k.statuses || []);
  const rows = list && !list.error ? list.rows.filter((r) => !st || r.status === st) : [];
  const back = ['hr', 'money'].includes(k.group) ? (isStaff() ? '#hr' : '#me') : (isStaff() ? '#sites' : '#mysite');
  const right = `${isStaff() ? `<a class="btn icon-only" href="/api/m-export/${esc(k.key)}.csv?token=${encodeURIComponent(KL.token)}" aria-label="Download CSV">${ic('download')}</a>` : ''}${k.canCreate ? `<a class="btn small primary" href="#rec/${esc(k.key)}/new">${ic('plus')} New</a>` : ''}`;
  const filter = statuses.length ? `<div class="chips" style="margin-bottom:12px"><button type="button" data-action="recFilter" data-kind="${esc(k.key)}" data-status="" aria-pressed="${!st}">All</button>${statuses.map((s) => `<button type="button" data-action="recFilter" data-kind="${esc(k.key)}" data-status="${esc(s)}" aria-pressed="${st === s}">${esc(s === 'pending' ? 'awaiting approval' : s)}</button>`).join('')}</div>` : '';
  const hasStatus = k.approval || (k.statuses || []).length || ['batch', 'survival', 'policy', 'equipment', 'training'].includes(k.key);
  const body = list === null ? spinner() : list.error ? errorBox(list.error) : rows.length ? dataTable({ id: `rec-${k.key}`, rows, rowHref: (r) => `#rec/${k.key}/${r.id}`, pageSize: 25,
    placeholder: `Search ${k.label.toLowerCase()}`, search: (r) => `${r.title} ${r.user_name || ''} ${Object.values(r.data || {}).join(' ')}`,
    columns: [{ key: 'title', label: k.one, render: (r) => `<span class="dt-cell-main">${r.file_id ? authImg(r.file_id, 'thumb sm') : ''}<span>${esc(r.title || k.one)}</span></span>` },
      { key: 'sub', label: 'Details', sort: false, render: (r) => recSub(k, r) || '–' },
      { key: 'user_name', label: 'Person', phone: false, render: (r) => esc(r.user_name || r.created_name || '–') },
      { key: 'created_at', label: 'Added', align: 'right', value: (r) => r.created_at, render: (r) => esc(fmtDate(r.created_at, false)) },
      ...(hasStatus ? [{ key: 'status', label: 'Status', value: (r) => r.status, render: (r) => recRight(k, r) || '–' }] : [])],
    phoneRow: (r) => recRow(k, r) })
    : emptyState(k.icon, `No ${k.label.toLowerCase()} yet`, k.canCreate ? 'Add the first one.' : '', k.canCreate ? `<a class="btn primary" href="#rec/${esc(k.key)}/new">${ic('plus')} New ${esc(k.one.toLowerCase())}</a>` : '');
  const ck = k.key === 'checklist_template' ? checklistToday() : ['', ''];
  return `${topbar(k.label, back, right)}<p class="sub">${esc(KDESC[k.key] || '')}</p>${ck[0]}${filter}${body}${ck[1]}`;
}
/** The status / key figure shown at the right of a record row (and in the Status column of the table). */
function recRight(k, r) {
  let right = k.approval || (k.statuses || []).length ? stag(r.status) : '';
  if (k.key === 'batch') right = `<span class="right"><b class="mono">${fmtNum(r.data.output_kg)} kg</b><br>${r.yield !== null ? tag(`${r.yield}% yield`, 'info') : ''}</span>`;
  if (k.key === 'survival' && r.survival !== null) right = tag(`${r.survival}% alive`, r.survival >= 80 ? 'ok' : 'warn');
  if (k.key === 'policy') right = r.acked ? tag('accepted', 'ok') : r.data.must_ack === 'Yes' ? tag('to accept', 'warn') : '';
  if (k.key === 'equipment' && r.service_overdue) right = `${stag(r.status)} ${tag('service due', 'bad')}`;
  if (k.key === 'training' && r.data.valid_until && r.data.valid_until < todayISO()) right = tag('expired', 'bad');
  if (k.approval && r.status === 'pending' && r.waiting) right = `<span class="right">${stag('pending')}<br><small class="muted">with ${esc(firstName(r.waiting))}</small></span>`;
  return right;
}
function recRow(k, r, inSite = false) {
  const right = recRight(k, r);
  return lrow({ href: `#rec/${k.key}/${r.id}`, icon: r.file_id ? `${authImg(r.file_id)}` : k.icon, tone: '', title: r.title || k.one, sub: `${recSub(k, r, inSite)}${recSub(k, r, inSite) ? ' · ' : ''}${esc(timeAgo(r.created_at))}`, right });
}
Actions.recFilter = (el) => { setF(`rl-${el.dataset.kind}-status`, el.dataset.status); render(); };
function checklistToday() {
  const runs = data('m:checklist_run', () => api('/api/m/checklist_run'));
  if (!runs || runs.error) return ['', ''];
  const today = runs.rows.filter((r) => fmtDate(r.created_at, false) === fmtDate(new Date().toISOString(), false));
  return [`<div class="banner ${today.length ? '' : 'warn'}" style="margin-bottom:12px">${ic('checklist')}<div><b>${today.length ? `${today.length} checklist${today.length === 1 ? '' : 's'} done today` : 'No checklist done today yet'}</b><p>Open a checklist and tap Start to record today's check. Items marked not OK raise a task for the manager.</p></div></div>`,
    `${runs.rows.length ? group('Recent checks', `<div class="card flush">${runs.rows.slice(0, 5).map((r) => { const bad = (r.data.answers || []).filter((a) => a.ok === false).length; return lrow({ href: `#rec/checklist_run/${r.id}`, icon: 'checklist', tone: bad ? 'red' : 'green', title: r.title, sub: `${esc(r.user_name)} · ${esc(fmtDate(r.created_at))}`, right: bad ? tag(`${bad} not OK`, 'bad') : tag('all OK', 'ok') }); }).join('')}</div>`) : ''}`];
}

function recDetail(k, id) {
  preload(k);
  const r = data(`m:${k.key}:${id}`, () => api(`/api/m/${k.key}/${id}`));
  const back = KL.ui.siteBack || `#rec/${k.key}`;
  if (r === null) return `${topbar(k.one, back)}${spinner()}`;
  if (r.error) return `${topbar(k.one, back)}${errorBox(r.error)}`;
  const mayEdit = isStaff() || (r.created_by === KL.user.id && !(k.approval && ['approved', 'rejected'].includes(r.status)));
  const right = `${mayEdit && !['batch', 'application', 'transfer', 'dispatch', 'checklist_run'].includes(k.key) ? `<a class="btn small" href="#rec/${esc(k.key)}/${esc(id)}/edit">${ic('pen')} Edit</a>` : ''}`;
  const kv = k.fields.filter((f) => !['checklist', 'answers', 'textarea'].includes(f.type)).map((f) => `<span>${esc(f.label)}</span><span>${esc(fmtVal(f, r.data[f.key]))}</span>`).join('');
  const long = k.fields.filter((f) => f.type === 'textarea' && r.data[f.key]).map((f) => `<div class="sec-text"><small>${esc(f.label)}</small><p>${esc(r.data[f.key])}</p></div>`).join('');
  let extra = '';
  if (k.key === 'batch') extra = batchChain(r);
  if (k.key === 'policy') extra = `<div class="card stack" style="margin-top:12px">${r.acked ? `<div class="banner">${ic('check')}<div><b>You accepted this policy</b></div></div>` : `<button type="button" class="btn primary wide" data-action="policyAck" data-id="${esc(id)}">${ic('check')} I have read and accept</button>`}${isStaff() && r.acks ? `<p class="hint">Accepted by ${r.acks.length}: ${r.acks.map((a) => esc(a.name)).join(', ') || 'nobody yet'}</p>` : ''}</div>`;
  if (['onboarding', 'exit'].includes(k.key)) {
    const items = String(r.data.checklist || '').split('\n').filter((x) => x.trim());
    const done = new Set(r.data.done || []);
    extra = group(`Checklist ${done.size}/${items.length}`, `<div class="card"><div class="tsheet"><div class="checklist">${items.map((it) => `<button type="button" class="ci ${done.has(it) ? 'done' : ''}" ${isStaff() ? `data-action="recCheck" data-kind="${esc(k.key)}" data-id="${esc(id)}" data-item="${esc(it)}" data-done="${done.has(it) ? '' : '1'}"` : 'disabled'}>${tickbox({ progress: done.has(it) ? 'completed' : 'not_started' })}<span>${esc(it)}</span></button>`).join('')}</div></div></div>`);
  }
  if (k.key === 'checklist_template') extra = `<a class="btn primary wide" style="margin-top:12px" href="#rec/checklist_run/new" data-action="startChecklist" data-id="${esc(id)}">${ic('play')} Start today's checklist</a>`;
  if (k.key === 'checklist_run') extra = group('Answers', `<div class="card flush">${(r.data.answers || []).map((a) => `<div class="lrow-static row"><span class="icon ${a.ok ? 'green' : 'red'}">${ic(a.ok ? 'check' : 'alert')}</span><span class="tx" style="flex:1"><b>${esc(a.item)}</b>${a.note ? `<span class="muted" style="font-size:13px;display:block">${esc(a.note)}</span>` : ''}</span>${tag(a.ok ? 'OK' : 'not OK', a.ok ? 'ok' : 'bad')}</div>`).join('')}</div>`);
  if (k.key === 'equipment') extra = equipmentHistory(r);
  const statusBtns = (k.statuses || []).length && !k.approval && !['batch', 'purchase_request'].includes(k.key) && (isStaff() || r.created_by === KL.user.id) ? `<div class="chips" style="margin-top:12px">${k.statuses.map((s) => `<button type="button" data-action="recStatus" data-kind="${esc(k.key)}" data-id="${esc(id)}" data-status="${esc(s)}" aria-pressed="${r.status === s}">${esc(s)}</button>`).join('')}</div>` : '';
  const prBtns = k.key === 'purchase_request' && isStaff() && ['approved', 'ordered'].includes(r.status) ? `<div class="btns" style="margin-top:12px">${r.status === 'approved' ? `<button type="button" class="btn primary" data-action="recStatus" data-kind="purchase_request" data-id="${esc(id)}" data-status="ordered">${ic('send')} Place order</button>` : `<button type="button" class="btn primary" data-action="recStatus" data-kind="purchase_request" data-id="${esc(id)}" data-status="received">${ic('box')} Mark received (adds to stock)</button>`}</div>` : '';
  return `${topbar(r.title || k.one, back, right)}
    <div class="card stack">
      <div class="row between"><div class="row" style="gap:12px">${avatar(r.user_name || r.created_name)}<div><b>${esc(k.one)}</b><p class="hint">${esc(r.created_name)} · ${esc(fmtDate(r.created_at))}${r.data.po_number ? ` · ${esc(r.data.po_number)}` : ''}</p></div></div>${stag(r.status)}</div>
      ${r.file_id ? authImg(r.file_id, 'thumb lg') : ''}
      <div class="kv">${kv}${k.key === 'survival' && r.survival !== null ? `<span>Survival</span><span>${r.survival}%</span>` : ''}${r.service_due ? `<span>Next service</span><span style="${r.service_overdue ? 'color:var(--danger)' : ''}">${esc(fmtDate(r.service_due, false))}</span>` : ''}${r.lat ? `<span>GPS</span><span>${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}</span>` : ''}</div>
      ${long}
      ${statusBtns}${prBtns}
    </div>
    ${r.steps && r.steps.length ? stepsBox(k, r) : ''}
    ${extra}
    ${isStaff() && !['batch', 'application', 'transfer', 'dispatch'].includes(k.key) ? `<button type="button" class="btn ghost" style="margin-top:14px;color:var(--danger)" data-action="recDelete" data-kind="${esc(k.key)}" data-id="${esc(id)}">${ic('trash')} Delete</button>` : ''}`;
}
function stepsBox(k, r) {
  const me = KL.user;
  const cur = r.steps.find((s) => s.status === 'waiting');
  const mine = cur && r.status === 'pending' && (me.role === 'admin' || cur.approver_id === me.id || (!cur.approver_id && me.role === cur.role));
  return group('Approval', `<div class="card"><div class="tl">${r.steps.map((s) => `<div class="ev ${s.status === 'approved' ? '' : s.status === 'waiting' ? 'amber' : s.status === 'rejected' ? 'red' : 'violet'}"><b>Step ${s.step}: ${esc(ROLE_TEXT[s.role] || s.role)}${s.approver_name ? ` · ${esc(s.approver_name)}` : ''}</b><span>${s.status === 'waiting' ? 'Waiting for a decision' : s.status === 'queued' ? 'Next, after the step above' : s.status === 'skipped' ? 'Not needed' : `${esc(s.status)} by ${esc(s.decided_name || '')} · ${esc(fmtDate(s.decided_at))}${s.note ? ` · “${esc(s.note)}”` : ''}`}</span></div>`).join('')}</div>
    ${mine ? `<div class="btns" style="margin-top:6px"><button type="button" class="btn danger" data-action="recDecide" data-kind="${esc(k.key)}" data-id="${esc(r.id)}" data-decision="rejected">Reject</button><button type="button" class="btn primary" data-action="recDecide" data-kind="${esc(k.key)}" data-id="${esc(r.id)}" data-decision="approved">Approve</button></div>` : ''}</div>`, r.status === 'pending' && cur ? `with ${esc(cur.approver_name || cur.role)}` : '');
}
function batchChain(r) {
  const ch = r.chain;
  if (!ch) return '';
  const d = r.data;
  return `${group('Chain of custody', `<div class="card stack">
      <div class="tiles"><div class="tile"><b>${fmtNum(d.output_kg)}</b><span>kg biochar</span></div><div class="tile ok"><b>${fmtNum(ch.applied)}</b><span>kg applied on farms</span></div><div class="tile violet"><b>${ch.co2e_t}</b><span>t CO₂e (illustrative)</span></div></div>
      <div class="legend-list">${ch.checks.map((c) => `<span><i style="background:${c.ok ? 'var(--accent)' : 'var(--border-strong)'}"></i>${c.ok ? '' : '<b style="color:var(--warning)">Missing:</b> '}${esc(c.label)}</span>`).join('')}</div>
      <a class="btn primary wide" href="/api/carbon/batch/${esc(r.id)}/report.pdf?token=${encodeURIComponent(KL.token)}" target="_blank" rel="noopener">${ic('doc')} Chain-of-custody PDF</a>
    </div>`, `yield ${r.yield}%`)}
    ${group('Stock movements', `<div class="card flush">${ch.movements.map((m) => `<div class="lrow-static row"><span class="icon ${m.type === 'in' ? 'green' : 'amber'}">${ic(m.type === 'in' ? 'download' : 'upload')}</span><span class="tx" style="flex:1"><b>${m.type === 'in' ? '+' : '−'}${fmtNum(m.qty, 1)} ${esc(m.unit)} ${esc(m.item_name)}</b><span class="muted" style="font-size:13px;display:block">${esc(m.note)} · ${esc(fmtDate(m.at))}</span></span><span class="mono muted">${fmtNum(m.balance_after, 1)}</span></div>`).join('') || '<p class="empty">None</p>'}</div>`)}
    ${group('Laboratory', ch.labs.length ? `<div class="card flush">${ch.labs.map((x) => `<a class="lrow" href="#rec/lab_result/${esc(x.id)}"><span class="icon violet">${ic('scale')}</span><span class="tx"><b>${esc(x.data.lab)}</b><span>C ${esc(x.data.carbon)}% · H/Corg ${esc(x.data.h_corg ?? '–')} · ash ${esc(x.data.ash ?? '–')}%</span></span>${tag(x.data.result, x.data.result === 'Pass' ? 'ok' : 'bad')}</a>`).join('')}</div>` : `<div class="card"><p class="hint">No lab result yet.</p>${isStaff() ? `<a class="btn small" style="margin-top:8px" href="#rec/lab_result/new" data-action="prefill" data-kind="lab_result" data-key="batch" data-value="${esc(r.id)}">${ic('plus')} Add lab result</a>` : ''}</div>`)}
    ${group('Applied on farms', `${ch.applications.length ? `<div class="card flush">${ch.applications.map((a) => `<a class="lrow" href="#rec/application/${esc(a.id)}">${authImg(a.file_id) || `<span class="icon green">${ic('sprout')}</span>`}<span class="tx"><b>${esc(a.farmer.name || '')}</b><span>${esc(a.farmer.village || '')} · survey ${esc(a.data.plot || '–')} · ${esc(a.data.method || '')}</span></span><b class="mono">${fmtNum(a.data.qty_kg)} kg</b></a>`).join('')}</div>` : '<div class="card"><p class="hint">Not applied yet.</p></div>'}
      <a class="btn small" style="margin-top:10px" href="#rec/application/new" data-action="prefill" data-kind="application" data-key="batch" data-value="${esc(r.id)}">${ic('plus')} Record an application</a>`, `${fmtNum(ch.remaining)} kg left`)}`;
}
function equipmentHistory(r) {
  const m = data(`m:maintenance:for:${r.id}`, () => api(`/api/m/maintenance?ref=${encodeURIComponent(r.id)}`));
  return group('Maintenance history', `${m === null ? spinner() : m.error ? errorBox(m.error) : m.rows.length ? `<div class="card flush">${m.rows.map((x) => lrow({ href: `#rec/maintenance/${x.id}`, icon: 'cog', tone: x.data.type === 'Breakdown repair' ? 'red' : 'green', title: x.data.type, sub: `${esc(fmtDate(x.data.date, false))} · ${esc(x.data.description)}${x.data.cost ? ` · ${esc(rupees(x.data.cost))}` : ''}` })).join('')}</div>` : '<div class="card"><p class="hint">No entries yet.</p></div>'}
    <a class="btn small" style="margin-top:10px" href="#rec/maintenance/new" data-action="prefill" data-kind="maintenance" data-key="equipment" data-value="${esc(r.id)}">${ic('plus')} Log maintenance</a>`);
}
Actions.prefill = (el) => { setF(`rf-${el.dataset.kind}-${el.dataset.key}`, el.dataset.value); KL.ui.recInit = null; location.hash = `#rec/${el.dataset.kind}/new`; };
Actions.startChecklist = (el) => {
  clearRecForm('checklist_run'); KL.ui.recInit = null;
  setF('rf-checklist_run-template', el.dataset.id);
  const t = KL.cache[`m:checklist_template:${el.dataset.id}`];
  if (t && !t.error && t.site_id) setF('rf-checklist_run-site', t.site_id);
  location.hash = '#rec/checklist_run/new';
};
Actions.policyAck = async (el) => {
  try { await api(`/api/m-ack/${el.dataset.id}`, { json: {} }); invalidate('m:policy'); await celebrate('Policy accepted', 'Recorded with the date and time.'); render(); } catch (e) { toast(e.message, 'error'); }
};
Actions.recCheck = async (el) => {
  try { await api(`/api/m/${el.dataset.kind}/${el.dataset.id}/check`, { json: { item: el.dataset.item, done: Boolean(el.dataset.done) } }); invalidate(`m:${el.dataset.kind}`); render(); } catch (e) { toast(e.message, 'error'); }
};
Actions.recStatus = async (el) => {
  try { await api(`/api/m/${el.dataset.kind}/${el.dataset.id}/status`, { json: { status: el.dataset.status } }); invalidate(`m:${el.dataset.kind}`, 'registers', 'dashboard'); toast(`Marked ${el.dataset.status}`); render(); } catch (e) { toast(e.message, 'error'); }
};
Actions.recDecide = async (el) => {
  const reject = el.dataset.decision === 'rejected';
  const v = await modal({ title: reject ? 'Reject with a reason' : 'Approve', fields: [{ key: 'note', label: reject ? 'Reason (the person sees this)' : 'Note (optional)', type: 'textarea' }], confirmText: reject ? 'Reject' : 'Approve', danger: reject });
  if (!v) return;
  if (reject && !v.note) return toast('Give a reason', 'error');
  try {
    const r = await api(`/api/m-steps/${el.dataset.kind}/${el.dataset.id}/decide`, { json: { decision: el.dataset.decision, note: v.note } });
    invalidate(`m:${el.dataset.kind}`, 'm-approvals', 'approvals'); await refreshMe();
    toast(r.status === 'pending' ? 'Approved; sent to the next approver' : r.status === 'approved' ? 'Approved' : 'Rejected'); render();
  } catch (e) { toast(e.message, 'error'); }
};
Actions.recDelete = async (el) => {
  if (!(await modal({ title: 'Delete this record?', message: 'It is removed for everyone. The audit log keeps a note of it.', confirmText: 'Delete', danger: true }))) return;
  try { await api(`/api/m/${el.dataset.kind}/${el.dataset.id}/delete`, { json: {} }); invalidate(`m:${el.dataset.kind}`); toast('Deleted'); location.hash = `#rec/${el.dataset.kind}`; } catch (e) { toast(e.message, 'error'); }
};

/* ---------------------------------------------------------------- the form */
const rk = (kind, key) => `rf-${kind}-${key}`;
function clearRecForm(kind) { for (const key of Object.keys(KL.ui.forms)) if (key.startsWith(`rf-${kind}-`)) delete KL.ui.forms[key]; clearPhotos(`rec-${kind}`); }
function fieldOptions(k, f) {
  if (f.type === 'select') return f.options.map((o) => [o, o]);
  if (f.type === 'user') return KL.boot.people.map((p) => [p.id, `${p.name} · ${ROLE_TEXT[p.role] || p.role}`]);
  if (f.type === 'site') return (f.key === 'to_site' ? KL.boot.sites : KL.boot.mySites).filter((s) => s.project_type !== 'office' || ['labour', 'shift', 'onboarding'].includes(k.key)).map((s) => [s.id, s.name]);
  if (f.type === 'farmer') { const fl = data('farmers', () => api('/api/farmers')); return fl && !fl.error ? fl.rows.map((x) => [x.id, `${x.name} · ${x.village || ''}`]) : []; }
  if (f.type === 'ref') {
    const rr = data(`m:${f.ref}`, () => api(`/api/m/${f.ref}`));
    const site = F(rk(k.key, 'site'), '');
    return rr && !rr.error ? rr.rows.filter((x) => !site || !x.site_id || x.site_id === site || ['supplier'].includes(f.ref)).map((x) => [x.id, x.title + (f.ref === 'batch' ? ` · ${fmtNum(x.data.output_kg)} kg` : '')]) : [];
  }
  if (f.type === 'item') {
    const site = F(rk(k.key, 'site'), '') || F(rk(k.key, 'from_site'), '');
    const names = [...new Set(KL.boot.items.filter((i) => !site || i.site_id === site).map((i) => i.name))];
    return names.map((n) => [n, n]);
  }
  return [];
}
function defaultFor(k, f) {
  if (f.default !== undefined) return f.default;
  if (f.type === 'date') return todayISO();
  if (f.type === 'datetime') { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); }
  if (f.type === 'site' && (KL.boot.mySites.length === 1)) return KL.boot.mySites[0].id;
  if (f.type === 'user' && f.key === 'person' && !isStaff()) return KL.user.id;
  return '';
}
function recForm(k, id) {
  preload(k);
  const editing = Boolean(id);
  const r = editing ? data(`m:${k.key}:${id}`, () => api(`/api/m/${k.key}/${id}`)) : null;
  const back = editing ? `#rec/${k.key}/${id}` : KL.ui.siteBack || `#rec/${k.key}`;
  if (editing && r === null) return `${topbar(`Edit ${k.one}`, back)}${spinner()}`;
  if (editing && r.error) return `${topbar(`Edit ${k.one}`, back)}${errorBox(r.error)}`;
  const initKey = `${k.key}:${id || 'new'}`;
  if (KL.ui.recInit !== initKey) {
    KL.ui.recInit = initKey;
    for (const f of k.fields) {
      const cur = KL.ui.forms[rk(k.key, f.key)];
      if (editing) setF(rk(k.key, f.key), r.data[f.key] ?? '');
      else if (cur === undefined) { const dv = defaultFor(k, f); if (dv !== '') setF(rk(k.key, f.key), String(dv)); }
    }
  }
  const needGps = k.geo || k.photo;
  if (needGps) locate();
  const ctl = (f) => {
    const id_ = rk(k.key, f.key);
    const v = F(id_, '');
    if (f.type === 'textarea' || f.type === 'checklist') return textarea(id_, v, f.placeholder || '');
    if (['select', 'user', 'site', 'farmer', 'ref', 'item'].includes(f.type)) return select(id_, v, fieldOptions(k, f), { blank: 'Choose' });
    const type = { number: 'number', money: 'number', date: 'date', datetime: 'datetime-local', time: 'time' }[f.type] || 'text';
    return input(id_, v, { type, inputmode: ['number', 'money'].includes(f.type) ? 'decimal' : '', placeholder: f.placeholder || '', step: ['number', 'money'].includes(f.type) ? 'any' : '' });
  };
  const fields = k.fields.filter((f) => f.type !== 'answers').map((f) => field(f.label + (f.required ? '' : ' (optional)'), ctl(f))).join('');
  const answers = k.key === 'checklist_run' ? checklistAnswers(k) : '';
  KL.ui.previewFn = () => recPreview(k);
  const stampLines = [`${KL.user.name} · ${k.one}`];
  return `${topbar(editing ? `Edit ${k.one}` : `New ${k.one.toLowerCase()}`, back)}
    ${k.approval && !editing ? `<div class="banner info" style="margin-bottom:12px">${ic('users')}<div><b>Goes for approval</b><p>${esc(chainText(k.approval))}</p></div></div>` : ''}
    <div class="card stack">
      ${fields}${answers}
      <div id="preview">${KL.ui.previewFn()}</div>
      ${k.photo ? `${needGps ? `${demoRibbon()}${gpsLine()}` : ''}${photoBox(`rec-${k.key}`, editing ? `Replace the ${k.photo.toLowerCase()} (optional)` : `${k.photo}${k.key === 'expense' ? ' (needed over ₹500)' : ''}`, 'environment', stampLines)}` : ''}
      <button type="button" class="btn primary wide" data-action="recSave" data-kind="${esc(k.key)}" data-id="${esc(id || '')}">${editing ? 'Save changes' : k.approval ? 'Submit for approval' : 'Save'}</button>
    </div>`;
}
function chainText(key) {
  const kd = KL.cache['m:kinds'];
  const chain = kd && !kd.error ? kd.chains[key] || [] : [];
  return chain.map((s, i) => `${i + 1}. ${ROLE_TEXT[s.role] || s.role}${s.role === 'manager' ? ' (your reporting manager)' : ''}${s.min ? ` when ${key === 'leave' ? `more than ${s.min} days` : `${rupees(s.min)} or more`}` : ''}`).join(' → ') || 'Your manager';
}
function recPreview(k) {
  const v = (key) => Number(F(rk(k.key, key), '')) || 0;
  if (k.key === 'batch' && v('feedstock_kg') && v('output_kg')) {
    const y = (v('output_kg') / v('feedstock_kg')) * 100;
    return `<div class="banner ${y < 15 || y > 40 ? 'warn' : 'info'}">${ic('flame')}<div><b>Yield ${fmtNum(y, 1)}%</b><p>${y < 15 ? 'Low: check the kiln and moisture.' : y > 40 ? 'Unusually high: check the weights.' : 'Typical for a flame-curtain kiln is 20–30%.'} Saving posts ${fmtNum(v('feedstock_kg'))} kg out of feedstock and ${fmtNum(v('output_kg'))} kg into biochar stock.</p></div></div>`;
  }
  if (k.key === 'survival' && v('planted')) return `<div class="banner ${v('alive') / v('planted') < 0.8 ? 'warn' : 'info'}">${ic('leaf')}<div><b>${fmtNum((v('alive') / v('planted')) * 100, 0)}% alive</b><p>Below 80% usually needs gap filling.</p></div></div>`;
  if (k.key === 'advance' && v('amount')) return `<div class="banner info">${ic('receipt')}<div><b>${rupees(v('amount') / Math.max(1, v('recover_months') || 1))} a month</b><p>Recovered from salary in payroll.</p></div></div>`;
  return '';
}
function checklistAnswers(k) {
  const tid = F(rk(k.key, 'template'), '');
  const tl = KL.cache['m:checklist_template'];
  const t = tl && !tl.error ? tl.rows.find((x) => x.id === tid) : null;
  if (!t) return '<p class="hint">Choose the checklist above.</p>';
  const items = String(t.data.items || '').split('\n').filter((x) => x.trim());
  let ans = [];
  try { ans = JSON.parse(F(rk(k.key, 'answers'), '[]')); } catch { ans = []; }
  return `<div class="stack" style="gap:8px">${items.map((it, i) => {
    const a = ans[i] || {};
    return `<div class="card" style="padding:12px;box-shadow:none;background:var(--surface-2)"><b style="font-size:14.5px">${esc(it)}</b><div class="seg" style="margin-top:8px"><button type="button" data-action="ckAns" data-i="${i}" data-item="${esc(it)}" data-ok="1" aria-pressed="${a.ok === true}">${ic('check')} OK</button><button type="button" data-action="ckAns" data-i="${i}" data-item="${esc(it)}" data-ok="0" aria-pressed="${a.ok === false}">${ic('alert')} Not OK</button></div>${a.ok === false ? `<input class="input" style="margin-top:8px" placeholder="What is wrong?" value="${esc(a.note || '')}" data-input="ckNote" data-i="${i}" />` : ''}</div>`;
  }).join('')}</div>`;
}
Actions.ckAns = (el) => {
  const key = rk('checklist_run', 'answers');
  let ans = [];
  try { ans = JSON.parse(F(key, '[]')); } catch { ans = []; }
  ans[Number(el.dataset.i)] = { ...(ans[Number(el.dataset.i)] || {}), item: el.dataset.item, ok: el.dataset.ok === '1' };
  setF(key, JSON.stringify(ans)); render();
};
Inputs.ckNote = (el) => {
  const key = rk('checklist_run', 'answers');
  const ans = JSON.parse(F(key, '[]'));
  ans[Number(el.dataset.i)] = { ...(ans[Number(el.dataset.i)] || {}), note: el.value };
  setF(key, JSON.stringify(ans));
};
Actions.recSave = async (el) => {
  const k = kindDef(el.dataset.kind);
  const id = el.dataset.id;
  const d = {};
  for (const f of k.fields) {
    const v = F(rk(k.key, f.key), '');
    if (f.type === 'answers') { try { d[f.key] = JSON.parse(v || '[]'); } catch { d[f.key] = []; } continue; }
    d[f.key] = typeof v === 'string' ? v.trim() : v;
    if (f.required && !String(d[f.key]).trim()) return toast(`${f.label} is required`, 'error');
  }
  if (k.key === 'checklist_run') {
    const tl = KL.cache['m:checklist_template'];
    const t = tl && !tl.error ? tl.rows.find((x) => x.id === d.template) : null;
    const items = t ? String(t.data.items || '').split('\n').filter((x) => x.trim()) : [];
    d.answers = items.map((it, i) => ({ item: it, ok: d.answers[i]?.ok ?? null, note: d.answers[i]?.note || '' }));
    if (d.answers.some((a) => a.ok === null)) return toast('Answer every item: OK or not OK', 'error');
  }
  if (id) {
    const old = KL.cache[`m:${k.key}:${id}`];
    if (old && !old.error) for (const [kk, vv] of Object.entries(old.data)) if (!(kk in d)) d[kk] = vv;
  }
  const g = KL.ui.gps;
  el.classList.add('busy');
  try {
    const r = await submitEvidence(`/api/m/${k.key}`, { data: JSON.stringify(d), id: id || '', lat: g ? g.lat : '', lng: g ? g.lng : '' }, photoFile(`rec-${k.key}`, `${k.one}.jpg`), k.one);
    clearRecForm(k.key); KL.ui.recInit = null;
    invalidate(`m:${k.key}`, 'm:batch', 'registers', 'dashboard', 'm-approvals', 'planner', 'site'); await refreshMe();
    if (r.queued) { location.hash = KL.ui.siteBack || `#rec/${k.key}`; return; }
    location.hash = KL.ui.siteBack && !id ? KL.ui.siteBack : `#rec/${k.key}/${r.id}`;
    const msg = { batch: ['Batch recorded', 'Stock registers updated: feedstock out, biochar in.'], incident: ['Incident reported', 'Managers are told; a follow-up task is raised for medium and above.'],
      checklist_run: ['Checklist saved', 'Items not OK have been sent to the manager as tasks.'], application: ['Application recorded', 'Biochar stock reduced and the farm added to the batch chain.'] }[k.key];
    if (!id && msg) await celebrate(msg[0], msg[1]);
    else toast(id ? 'Saved' : k.approval ? 'Submitted for approval' : 'Saved');
  } catch (e) { el.classList.remove('busy'); toast(e.message, 'error'); }
};

/* ---------------------------------------------------------------- approvals: requests from every register */
function requestApprovals() {
  const a = data('m-approvals', () => api('/api/m-approvals'));
  kinds();
  if (a === null) return spinner();
  if (a.error) return errorBox(a.error);
  if (!a.rows.length) return '<div class="card"><p class="empty">Nothing waiting for you.</p></div>';
  return `<div class="stack">${a.rows.map(({ step, kind, record: r }) => {
    const k = kindDef(kind);
    if (!k) return '';
    return `<div class="card stack"><div class="row between"><div class="row" style="gap:12px">${avatar(r.user_name)}<div><b>${esc(k.one)} · ${esc(r.user_name)}</b><p class="hint">${recSub(k, r)} · step ${step.step} of ${(r.steps || []).length}</p></div></div>${r.file_id ? authImg(r.file_id) : ''}</div>
      ${k.fields.filter((f) => f.type === 'textarea' && r.data[f.key]).map((f) => `<p class="hint" style="margin:0">${esc(r.data[f.key])}</p>`).join('')}
      <div class="btns"><a class="btn" href="#rec/${esc(kind)}/${esc(r.id)}">Open</a><button type="button" class="btn danger" data-action="recDecide" data-kind="${esc(kind)}" data-id="${esc(r.id)}" data-decision="rejected">Reject</button><button type="button" class="btn primary" data-action="recDecide" data-kind="${esc(kind)}" data-id="${esc(r.id)}" data-decision="approved">Approve</button></div></div>`;
  }).join('')}</div>`;
}

/* ---------------------------------------------------------------- people */
Views.people = () => {
  const p = data('hr:people', () => api('/api/hr/people'));
  const head = topbar('Employee directory', '#hr', ['admin', 'hr'].includes(KL.user.role) ? `<a class="btn small primary" href="#admin/users">${ic('plus')} Add employee</a>` : '');
  if (p === null) return `${head}${spinner()}`;
  if (p.error) return `${head}${errorBox(p.error)}`;
  const siteNames = (u) => (u.sites || []).map(siteName).filter((n) => n !== 'Unassigned');
  const employments = [...new Set(p.rows.map((u) => u.employment).filter(Boolean))];
  return `${head}
    ${dataTable({ id: 'people', rows: p.rows, placeholder: 'Search name, ID, role or site', search: (u) => `${u.name} ${u.employee_id} ${u.designation} ${siteNames(u).join(' ')}`,
      rowHref: (u) => `#person/${u.id}`, pageSize: 25,
      filters: [{ key: 'role', label: 'Role', options: Object.entries(ROLE_TEXT), match: (u, v) => u.role === v },
        { key: 'project', label: 'Project', options: Object.entries({ biochar: 'Biochar', gasifier: 'Gasifier', agroforestry: 'Agroforestry' }), match: (u, v) => (u.projects || []).includes(v) || (u.sites || []).some((sid) => siteById(sid)?.project_type === v) },
        { key: 'emp', label: 'Employment', options: employments.map((e) => [e, e]), match: (u, v) => u.employment === v },
        { key: 'status', label: 'Status', options: [['active', 'Active'], ['left', 'Left']], match: (u, v) => (v === 'active' ? u.active : !u.active) }],
      columns: [
        { key: 'name', label: 'Name', render: (u) => `<span class="dt-cell-main">${avatar(u.name, 'sm')}<span>${esc(u.name)}${u.active ? '' : ' (left)'}<small>${esc(u.employee_id)}</small></span></span>` },
        { key: 'designation', label: 'Role', render: (u) => `${esc(u.designation || ROLE_TEXT[u.role])}${u.app_access ? '' : ` ${tag('No phone')}`}` },
        { key: 'sites', label: 'Works at', phone: false, value: (u) => siteNames(u).join(', '), render: (u) => esc(siteNames(u).join(', ') || '–') },
        { key: 'manager_name', label: 'Reports to', phone: false, render: (u) => esc(u.manager_name || '–') },
        { key: 'employment', label: 'Employment', phone: false, render: (u) => esc(u.employment || '–') },
        { key: 'complete', label: 'Record', align: 'right', value: (u) => u.complete, render: (u) => tag(`${u.complete}%`, u.complete >= 80 ? 'ok' : 'warn') }],
      phoneRow: (u) => lrow({ href: `#person/${u.id}`, icon: avatar(u.name), title: `${u.name}${u.active ? '' : ' (left)'}`, sub: `${esc(u.employee_id)} · ${esc(u.designation || ROLE_TEXT[u.role])}`, right: tag(`${u.complete}%`, u.complete >= 80 ? 'ok' : 'warn') }) })}
    ${group('Reporting lines', orgChart())}`;
};
function orgChart() {
  const o = data('hr:org', () => api('/api/hr/org'));
  if (!o || o.error) return spinner();
  const kids = (id) => o.rows.filter((u) => u.manager_id === id);
  const node = (u, depth) => `<div class="org-node" style="margin-left:${depth * 22}px">${avatar(u.name, 'sm')}<b>${esc(u.name)}</b><span class="muted">${esc(u.designation || '')}</span></div>${kids(u.id).map((c) => node(c, depth + 1)).join('')}`;
  const roots = o.rows.filter((u) => !u.manager_id || !o.rows.some((x) => x.id === u.manager_id));
  return `<div class="card">${roots.map((u) => node(u, 0)).join('')}</div>`;
}
Views.person = (id) => {
  const p = data(`hr:profile:${id}`, () => api(`/api/hr/profile/${id}`));
  const back = isStaff() && id !== 'me' ? '#people' : '#me';
  if (p === null) return `${topbar('Employee', back)}${spinner()}`;
  if (p.error) return `${topbar('Employee', back)}${errorBox(p.error)}`;
  const kd = kinds();
  const u = p.user;
  const pf = kd && !kd.error ? kd.profileFields : [];
  const keys = (list) => pf.filter((f) => list.includes(f.key));
  const sections = [['Personal', pf.filter((f) => !['pan', 'aadhaar_last4', 'uan', 'esic'].includes(f.key) && !f.key.startsWith('opening_'))], ['Statutory numbers (pay is in Zoho Payroll)', keys(['pan', 'aadhaar_last4', 'uan', 'esic'])], ['Opening leave', pf.filter((f) => f.key.startsWith('opening_'))]];
  const tab = PF_TABS.some(([k]) => k === F('pf-tab')) ? F('pf-tab') : 'overview';
  const uid = id === 'me' ? KL.user.id : u.id;
  const canDocs = id === 'me' || uid === KL.user.id || hrRoleNow();
  const docs = tab === 'documents' && canDocs ? data(`hrdocs:${uid}`, () => api(uid === KL.user.id ? '/api/hr/documents' : `/api/hr/documents?userId=${uid}`)) : null;
  const month = todayISO().slice(0, 7);
  const att = tab === 'attendance' ? data(`hr:attsum:${uid}:${month}`, () => api(`/api/hr/attendance-summary?month=${month}${uid === KL.user.id && !isStaff() ? '' : `&userId=${uid}`}`)) : null;
  const panes = {
    overview: `${group('Works at', worksAt(u))}
    ${hrRoleNow() || !u.app_access ? group('App and attendance', personFlags(u)) : ''}
    ${group('Leave balance', `<div class="tiles">${p.balances.filter((b) => b.available !== null).map((b) => `<div class="tile ${b.available <= 1 ? 'warn' : 'ok'}"><b>${fmtNum(b.available, 1)}</b><span>${esc(b.type)} left · ${fmtNum(b.used, 1)} used${b.pending ? `, ${fmtNum(b.pending, 1)} pending` : ''}</span></div>`).join('')}</div>`, '', '<a href="#leaves">Apply</a>')}
    <div class="btns" style="margin-top:14px"><a class="btn" href="#attsum/${esc(u.id)}">${ic('calendar')} Attendance</a>${isStaff() || id === 'me' ? `<a class="btn" href="#changes/${id === 'me' ? 'me' : esc(u.id)}">${ic('clock')} Change history</a>` : ''}${id === 'me' || u.id === KL.user.id ? `<a class="btn" href="/api/me/export?token=${encodeURIComponent(KL.token)}">${ic('download')} My data</a>` : ''}</div>`,
    job: `${sections.map(([title, fs]) => group(title, `<div class="card"><div class="kv">${fs.map((f) => `<span>${esc(f.label)}</span><span>${esc(f.type === 'money' && p.profile[f.key] && !String(p.profile[f.key]).startsWith('•') ? rupees(p.profile[f.key]) : f.type === 'date' && p.profile[f.key] ? fmtDate(p.profile[f.key], false) : p.profile[f.key] || '–')}</span>`).join('')}</div></div>`)).join('')}`,
    documents: !canDocs ? '<div class="card"><p class="empty">Only HR and the employee see personal documents.</p></div>' : docs === null ? spinner() : docs.error ? errorBox(docs.error) : docs.rows.length ? dataTable({ id: 'pf-docs', rows: docs.rows, search: (d) => `${d.title} ${d.category}`, placeholder: 'Search documents',
      columns: [{ key: 'title', label: 'Document', render: (d) => `<b>${esc(d.title)}</b>` }, { key: 'category', label: 'Category' }, { key: 'created_at', label: 'Added', render: (d) => esc(fmtDate(d.created_at, false)), value: (d) => d.created_at }, { key: 'open', label: '', sort: false, render: (d) => fileLink(d.file_id) }],
      phoneRow: (d) => `<div class="lrow-static row"><span class="icon">${ic('doc')}</span><span class="tx" style="flex:1"><b>${esc(d.title)}</b><span class="muted" style="font-size:14px;display:block">${esc(d.category)} · ${esc(fmtDate(d.created_at, false))}</span></span>${fileLink(d.file_id)}</div>` }) : emptyState('doc', 'No documents yet', 'Payslips from Zoho Payroll, letters and ID copies that HR uploads appear here.'),
    attendance: att === null ? spinner() : att.error ? errorBox(att.error) : `<div class="tiles four">${[['P', 'present', 'ok'], ['A', 'absent', 'bad'], ['late', 'late', 'warn'], ['ot_hours', 'overtime hours', '']].map(([k, l, t]) => `<div class="tile ${t}"><b>${fmtNum(att.totals[k], 1)}</b><span>${l} this month</span></div>`).join('')}</div><a class="btn" style="margin-top:12px" href="#attsum/${esc(uid)}">${ic('calendar')} Month calendar</a> <a class="btn" style="margin-top:12px" href="#changes/${id === 'me' ? 'me' : esc(uid)}">${ic('clock')} Change history</a>`,
    leave: `${group('Leave balance', `<div class="tiles">${p.balances.filter((b) => b.available !== null).map((b) => `<div class="tile ${b.available <= 1 ? 'warn' : 'ok'}"><b>${fmtNum(b.available, 1)}</b><span>${esc(b.type)} left · ${fmtNum(b.used, 1)} used${b.pending ? `, ${fmtNum(b.pending, 1)} pending` : ''}</span></div>`).join('')}</div>`, '', '<a href="#leaves">Apply</a>')}<a class="btn" style="margin-top:12px" href="#leaves">${ic('sun')} ${id === 'me' || uid === KL.user.id ? 'Apply for leave' : 'Leave requests'}</a>`,
    assets: `${group('Assets', p.assets.length ? `<div class="card flush">${p.assets.map((a) => lrow({ href: `#rec/asset_issue/${a.id}`, icon: 'box', title: a.data.asset, sub: `${esc(a.data.category || '')} · ${esc(a.data.serial || '')}`, right: stag(a.status) })).join('')}</div>` : '<div class="card"><p class="hint">None issued.</p></div>')}`,
    training: `${group('Training & certificates', p.trainings.length ? `<div class="card flush">${p.trainings.map((a) => lrow({ href: `#rec/training/${a.id}`, icon: 'shield', tone: 'green', title: a.data.title, sub: `${esc(a.data.provider || '')}${a.data.valid_until ? ` · valid to ${esc(fmtDate(a.data.valid_until, false))}` : ''}`, right: a.data.valid_until && a.data.valid_until < todayISO() ? tag('expired', 'bad') : '' })).join('')}</div>` : '<div class="card"><p class="hint">None yet.</p></div>')}`,
    goals: `${group('Goals', p.goals.length ? `<div class="card stack">${p.goals.map((g) => `<a href="#rec/goal/${esc(g.id)}" style="text-decoration:none;color:inherit"><div class="row between"><b>${esc(g.data.title)}</b>${stag(g.status)}</div><div class="progress" style="margin-top:8px"><i style="width:${Number(g.data.progress) || 0}%"></i></div><small class="muted">${esc(g.data.progress || 0)}% · due ${esc(fmtDate(g.data.due, false))}</small></a>`).join('')}</div>` : '<div class="card"><p class="hint">No goals set.</p></div>')}`,
  };
  return `${topbar(u.name, back, p.canEdit ? `<a class="btn small" href="#personedit/${esc(u.id)}">${ic('pen')} Edit</a>` : '')}
    <div class="card profile">${avatar(u.name, 'xl')}<div style="min-width:0"><b>${esc(u.name)}</b><span>${esc(u.designation || '')} · ${esc(u.employee_id)}</span><span class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">${tag(ROLE_TEXT[u.role] || u.role, 'ok')}${u.manager_name ? tag(`reports to ${u.manager_name}`, 'info') : ''}${p.profile.employment ? tag(p.profile.employment) : ''}</span></div></div>
    ${u.reports.length ? `<p class="hint" style="margin:10px 4px 0">Team: ${u.reports.map((x) => esc(x.name)).join(', ')}</p>` : ''}
    <nav class="tabs" role="tablist" aria-label="Employee record">${PF_TABS.map(([k, l]) => `<button type="button" role="tab" data-action="pfTab" data-tab="${k}" aria-selected="${tab === k}">${l}</button>`).join('')}</nav>
    <div role="tabpanel">${panes[tab]}</div>`;
};
const PF_TABS = [['overview', 'Overview'], ['job', 'Job'], ['documents', 'Documents'], ['attendance', 'Attendance'], ['leave', 'Leave'], ['assets', 'Assets'], ['training', 'Training'], ['goals', 'Goals']];
Actions.pfTab = (el) => { setF('pf-tab', el.dataset.tab); render(); };
Views.personedit = (id) => {
  const p = data(`hr:profile:${id}`, () => api(`/api/hr/profile/${id}`));
  const kd = kinds();
  if (!p || !kd) return `${topbar('Edit', `#person/${id}`)}${spinner()}`;
  if (p.error) return `${topbar('Edit', `#person/${id}`)}${errorBox(p.error)}`;
  if (KL.ui.peInit !== id) { KL.ui.peInit = id; for (const f of kd.profileFields) setF(`pe-${f.key}`, p.profile[f.key] ?? ''); setF('pe-manager', p.user.manager_id || ''); }
  return `${topbar(`Edit ${p.user.name}`, `#person/${id}`)}
    <div class="card stack">
      ${field('Reports to', select('pe-manager', F('pe-manager', ''), KL.boot.people.filter((x) => x.id !== id).map((x) => [x.id, `${x.name} · ${x.designation || ''}`]), { blank: 'Nobody (top of the company)' }))}
      ${kd.profileFields.map((f) => field(f.label, f.type === 'textarea' ? textarea(`pe-${f.key}`, F(`pe-${f.key}`, '')) : f.type === 'select' ? select(`pe-${f.key}`, F(`pe-${f.key}`, ''), f.options, { blank: 'Choose' }) : input(`pe-${f.key}`, F(`pe-${f.key}`, ''), { type: f.type === 'date' ? 'date' : ['money', 'number'].includes(f.type) ? 'number' : 'text', inputmode: ['money', 'number'].includes(f.type) ? 'decimal' : '' }))).join('')}
      ${field('Reason for the change (kept in the change log)', input('pe-reason', F('pe-reason'), { placeholder: 'e.g. leave carried forward as per letter' }))}
      <button type="button" class="btn primary wide" data-action="personSave" data-id="${esc(id)}">Save</button>
    </div>`;
};
Actions.personSave = async (el) => {
  const kd = KL.cache['m:kinds'];
  const profile = {};
  for (const f of kd.profileFields) profile[f.key] = F(`pe-${f.key}`, '');
  try { await api(`/api/hr/profile/${el.dataset.id}`, { json: { profile, managerId: F('pe-manager', ''), reason: F('pe-reason', '') } }); clearF('pe-reason'); invalidate('hr'); KL.ui.peInit = null; await reloadBoot(); toast('Saved'); location.hash = `#person/${el.dataset.id}`; } catch (e) { toast(e.message, 'error'); }
};

/* ---------------------------------------------------------------- attendance summary */
const CODE_TONE = { P: 'ok', H: 'warn', L: 'info', A: 'bad', WO: '', HO: 'violet', MC: 'warn', '--': '' };
Views.attsum = (uid) => {
  const month = F('as-month', todayISO().slice(0, 7));
  const team = isStaff() && !uid;
  const s = data(`hr:attsum:${uid || (team ? 'team' : 'me')}:${month}`, () => api(`/api/hr/attendance-summary?month=${month}${uid ? `&userId=${uid}` : ''}`));
  const legend = [['P', 'Present'], ['H', 'Half day'], ['L', 'Leave'], ['A', 'Absent'], ['WO', 'Weekly off'], ['HO', 'Holiday'], ['MC', 'Missed check-out']].map(([c, l]) => `<span class="lg"><i class="c-${c}">${c}</i>${l}</span>`).join('');
  const lock = isStaff() ? data(`hr:month:${month}`, () => api(`/api/hr/month/${month}`)) : null;
  const lockBanner = lock && !lock.error ? (lock.status === 'locked' ? `<div class="banner" style="margin-bottom:12px">${ic('lock')}<div><b>${esc(lock.label)} is approved and locked</b><p>By ${esc(lock.locked_by)}. Changes to this month are blocked; the Zoho Payroll file is final.</p></div></div>` : lock.over ? `<div class="banner warn" style="margin-bottom:12px">${ic('calendar')}<div><b>${esc(lock.label)} is open</b><p>Managers confirm, then HR approves and locks it. <a href="#monthend/${esc(month)}">Month end</a></p></div></div>` : '') : '';
  const pick = `<div class="row" style="margin-bottom:12px;flex-wrap:wrap;gap:12px"><label class="field" style="max-width:220px"><span>Month</span><input class="input" type="month" value="${esc(month)}" data-change="form" data-key="as-month" /></label></div>${lockBanner}<div class="att-legend" aria-label="Legend">${legend}</div>`;
  const back = uid ? (isStaff() ? `#person/${uid}` : '#me') : (isStaff() ? '#hub/hr' : '#me');
  if (s === null) return `${topbar('Attendance summary', back)}${pick}${spinner()}`;
  if (s.error) return `${topbar('Attendance summary', back)}${pick}${errorBox(s.error)}`;
  if (s.rows) {
    const days = s.rows[0]?.codes.length || 0;
    return `${topbar('Attendance summary', back)}${pick}
      <div class="card flush att-grid-wrap"><table class="att-grid"><thead><tr><th>Person</th>${Array.from({ length: days }, (_, i) => `<th>${i + 1}</th>`).join('')}<th>P</th><th>A</th><th>Late</th><th>OT h</th></tr></thead>
      <tbody>${s.rows.map((r) => `<tr><td><a href="#attsum/${esc(r.id)}">${esc(r.name)}</a></td>${r.codes.map((c) => `<td class="c c-${esc(c.replace('--', 'F'))}">${c === '--' ? '' : esc(c)}</td>`).join('')}<td><b>${r.totals.P + r.totals.H * 0.5}</b></td><td>${r.totals.A}</td><td>${r.totals.late}</td><td>${fmtNum(r.totals.ot_hours, 1)}</td></tr>`).join('')}</tbody></table></div>
      <div class="btns" style="margin-top:12px"><a class="btn" href="#monthend/${esc(month)}">${ic('lock')} Month end and Zoho export</a><a class="btn" href="#hrreg">${ic('list')} Registers</a></div>
      <p class="hint" style="margin-top:8px">Late means checked in after ${esc(KL.cache['m:kinds']?.workHours?.start || '09:00')} plus the grace minutes. Missed check-outs are closed at the end of the shift and flagged; the person can ask for a correction.</p>`;
  }
  const t = s.totals;
  return `${topbar(`Attendance · ${s.user.name}`, back)}${pick}
    <div class="tiles four"><div class="tile ok"><b>${t.P}</b><span>present</span></div><div class="tile bad"><b>${t.A}</b><span>absent</span></div><div class="tile warn"><b>${t.late}</b><span>late</span></div><div class="tile blue"><b>${fmtNum(t.ot_hours, 1)}</b><span>overtime hours</span></div></div>
    <div class="cal">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<div class="cal-h">${d}</div>`).join('')}${Array.from({ length: (new Date(`${s.days[0].date}T00:00:00`).getDay() + 6) % 7 }, () => '<div></div>').join('')}${s.days.map((d) => `<div class="cal-d c-${esc(d.code.replace('--', 'F'))}" title="${esc(d.note)}"><small>${Number(d.date.slice(8))}</small><b>${d.code === '--' ? '' : esc(d.code)}</b>${d.in ? `<span>${esc(d.in)}${d.out ? `–${esc(d.out)}` : ''}</span>` : ''}${d.late ? '<i class="late-dot"></i>' : ''}</div>`).join('')}</div>
    ${!isStaff() || uid === KL.user.id ? `<a class="btn wide" style="margin-top:14px" href="#rec/regularisation/new">${ic('clock')} Ask for an attendance correction</a>` : ''}
    <a class="btn ghost wide" style="margin-top:8px" href="#changes/${!uid || uid === KL.user.id ? 'me' : esc(uid)}">${ic('clock')} History of changes</a>`;
};

const fileLinkApi = (path, text) => `<a class="btn small" href="${esc(path)}?token=${encodeURIComponent(KL.token)}" download>${esc(text)}</a>`;
/* ---------------------------------------------------------------- carbon */
Views.carbon = () => {
  const b = data('m:batch', () => api('/api/m/batch'));
  const rows = b && !b.error ? b.rows : [];
  const tot = (k) => rows.reduce((a, r) => a + (Number(r.data[k]) || 0), 0);
  const applied = rows.reduce((a, r) => a + (r.applied || 0), 0);
  return `${topbar('Carbon chain of custody', '#hub/carbon', `<a class="btn small primary" href="#rec/batch/new">${ic('plus')} Batch</a>`)}
    <p class="sub">Feedstock → kiln → lab → farm. Each step carries a photo, GPS, time and a SHA-256 hash, so a verifier can follow any batch.</p>
    ${b === null ? spinner() : b.error ? errorBox(b.error) : `
    <div class="tiles auto"><div class="tile feature"><b>${num(tot('output_kg'), 'c-out')}</b><span>kg biochar produced</span></div><div class="tile"><b>${num(tot('feedstock_kg'), 'c-in')}</b><span>kg feedstock used</span></div><div class="tile ok"><b>${num(applied, 'c-app')}</b><span>kg applied on farms</span></div>
      <div class="tile violet"><b>${rows.filter((r) => r.lab && r.lab.result === 'Pass').length}/${rows.length}</b><span>batches lab-tested</span></div><div class="tile blue"><b>${tot('feedstock_kg') ? fmtNum((tot('output_kg') / tot('feedstock_kg')) * 100, 1) : 0}%</b><span>average yield</span></div><div class="tile warn"><b>${rows.filter((r) => r.status !== 'applied').length}</b><span>batches not yet applied</span></div></div>
    ${group('Batches', `<div class="card flush">${rows.map((r) => `<a class="lrow" href="#rec/batch/${esc(r.id)}"><span class="icon earth">${ic('flame')}</span><span class="tx"><b>${esc(r.title)}</b><span>${esc(siteName(r.site_id))} · ${esc(r.data.feedstock_type || '')} ${fmtNum(r.data.feedstock_kg)} → ${fmtNum(r.data.output_kg)} kg · ${r.yield}%</span></span><span class="right">${stag(r.status)}<br><small class="muted">${fmtNum(r.applied)} kg applied</small></span></a>`).join('')}</div>`)}`}`;
};

/* ---------------------------------------------------------------- map */
let leafletLoading = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (leafletLoading) return leafletLoading;
  leafletLoading = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
    s.onload = resolve; s.onerror = () => reject(new Error('Map library did not load (needs internet)'));
    document.head.appendChild(s);
  });
  return leafletLoading;
}
Views.map = () => {
  const m = data('map', () => api('/api/map'));
  if (m && !m.error) KL.afterRender.push(() => drawMap(m));
  const n = m && !m.error ? m : { sites: [], plots: [], pins: [], people: [] };
  return `${topbar('Map', isStaff() ? '#manage' : '#work')}
    <div class="chips" style="margin-bottom:10px">${tag(`${n.sites.length} sites`, 'ok')}${tag(`${n.plots.length} farm plots`, 'info')}${tag(`${n.pins.filter((p) => p.kind === 'application').length} biochar applications`, 'violet')}${tag(`${n.pins.filter((p) => p.kind === 'incident').length} incidents`, 'bad')}${isStaff() ? tag(`${n.people.length} people on site`, 'warn') : ''}</div>
    ${n.sites.length ? `<div class="chips" style="margin-bottom:10px"><button type="button" data-action="mapAll">${ic('map')} All</button>${n.sites.map((x) => `<button type="button" data-action="mapGo" data-lat="${x.lat}" data-lng="${x.lng}" data-zoom="${x.project_type === 'agroforestry' ? 12 : 16}">${esc(x.name.split(',')[0])}</button>`).join('')}</div>` : ''}
    <div id="kl-map" class="map-box">${m === null ? spinner() : m.error ? errorBox(m.error) : ''}</div>
    <p class="hint" style="margin-top:8px">Circles are site boundaries (geofences). Green shapes are farm plots from their KML files. Tap anything for details.</p>`;
};
async function drawMap(m) {
  const box = $('#kl-map');
  if (!box || box.dataset.drawn) return;
  box.dataset.drawn = '1';
  try { await loadLeaflet(); } catch (e) { box.innerHTML = errorBox(e.message); return; }
  if (!document.body.contains(box)) return;
  const map = L.map(box, { zoomControl: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  const bounds = [];
  for (const s of m.sites) {
    L.circle([s.lat, s.lng], { radius: s.radius_m, color: s.project_type === 'biochar' ? '#7a5230' : s.project_type === 'gasifier' ? '#2f64b0' : '#1e7a4c', weight: 2, fillOpacity: 0.15 }).addTo(map).bindPopup(`<b>${esc(s.name)}</b><br>${esc(s.project_type)} · ${s.radius_m} m fence`);
    bounds.push([s.lat, s.lng]);
  }
  for (const p of m.plots) { L.polygon(p.points, { color: '#3fa66b', weight: 2, fillOpacity: 0.35 }).addTo(map).bindPopup(`<b>${esc(p.farmer)}</b><br>${esc(p.village || '')} · survey ${esc(p.survey || '–')}<br>${p.area ? `${p.area} ha` : ''}`); bounds.push(p.points[0]); }
  const colour = { incident: '#c2412e', application: '#6b4fcf', survival: '#3fa66b' };
  for (const p of m.pins) { L.circleMarker([p.lat, p.lng], { radius: 7, color: '#fff', weight: 2, fillColor: colour[p.kind] || '#333', fillOpacity: 1 }).addTo(map).bindPopup(`<b>${esc(p.title)}</b><br>${esc(p.kind)} · ${esc(fmtDate(p.at))}<br><a href="#rec/${esc(p.kind)}/${esc(p.id)}">Open</a>`); bounds.push([p.lat, p.lng]); }
  for (const p of m.people) { if (p.lat) L.circleMarker([p.lat, p.lng], { radius: 9, color: '#fff', weight: 3, fillColor: '#2f64b0', fillOpacity: 1 }).addTo(map).bindPopup(`<b>${esc(p.name)}</b><br>on site at ${esc(p.site)}`); }
  KL.leafletMap = map; KL.leafletBounds = bounds;
  if (bounds.length) map.fitBounds(bounds, { padding: [30, 30] }); else map.setView([22.3, 71.2], 7);
}

/* ---------------------------------------------------------------- reports */
Views.reports = () => {
  const month = F('rp-month', todayISO().slice(0, 7));
  const r = data(`reports:${month}`, () => api(`/api/reports/summary?month=${month}`));
  const head = `${topbar('Reports', '#manage')}<input class="input" type="month" value="${esc(month)}" data-change="form" data-key="rp-month" style="max-width:220px;margin-bottom:12px" />`;
  if (r === null) return `${head}${spinner()}`;
  if (r.error) return `${head}${errorBox(r.error)}`;
  const days = Object.entries(r.production.byDay);
  const top = Math.max(1, ...days.map(([, v]) => v));
  const cats = Object.entries(r.expenses.byCategory);
  const ctop = Math.max(1, ...cats.map(([, v]) => v));
  return `${head}
    <div class="tiles auto"><div class="tile feature"><b>${num(r.production.output, 'r-out')}</b><span>kg biochar · ${r.production.batches} batches</span></div><div class="tile ok"><b>${num(r.applied, 'r-app')}</b><span>kg applied on farms</span></div><div class="tile"><b>${num(r.saplings, 'r-sap')}</b><span>saplings distributed</span></div>
      <div class="tile violet"><b>${num(r.expenses.total, 'r-exp', 'rupee')}</b><span>expense claims · ${rupees(r.expenses.approved)} approved</span></div><div class="tile blue"><b>${rupees(r.travel.amt)}</b><span>travel · ${fmtNum(r.travel.km)} km</span></div><div class="tile ${r.incidents.open ? 'bad' : 'ok'}"><b>${r.incidents.total}</b><span>incidents · ${r.incidents.open} open</span></div></div>
    <div class="cols" style="margin-top:14px">
      <div class="card"><b class="card-title">Biochar produced by day (kg)</b>${days.length ? `<div class="chart">${days.map(([d, v]) => `<div class="bar" title="${esc(d)}: ${fmtNum(v)} kg"><i style="height:${(v / top) * 100}%"></i><small>${esc(d.split(' ')[0])}</small></div>`).join('')}</div>` : '<p class="hint">No batches this month.</p>'}</div>
      <div class="card"><b class="card-title">Expenses by category</b><div class="stack" style="margin-top:12px">${cats.map(([c, v]) => `<div><div class="row between" style="font-size:14px;font-weight:700"><span>${esc(c)}</span><span>${esc(rupees(v))}</span></div><div class="progress"><i style="width:${(v / ctop) * 100}%"></i></div></div>`).join('') || '<p class="hint">No claims.</p>'}</div></div>
    </div>
    ${group('Field attendance', `<div class="card flush att-grid-wrap"><table class="pay-table"><thead><tr><th>Person</th><th>Present</th><th>Half</th><th>Leave</th><th>Absent</th><th>Late</th><th>OT h</th></tr></thead><tbody>${r.attendance.map((a) => `<tr><td><b>${esc(a.name)}</b></td><td>${a.P}</td><td>${a.H}</td><td>${a.L}</td><td>${a.A}</td><td>${a.late}</td><td>${fmtNum(a.ot_hours, 1)}</td></tr>`).join('')}</tbody></table></div>`)}
    ${group('Downloads (CSV, opens in Excel)', `<div class="card"><div class="btns" style="flex-wrap:wrap">${['batch', 'application', 'lab_result', 'expense', 'incident', 'maintenance', 'purchase_request', 'farmer_payment', 'sapling', 'survival', 'labour', 'training'].map((k) => fileLinkApi(`/api/m-export/${k}.csv`, kindDef(k)?.label || k)).join('')}${KL.boot.sites.filter((s) => KL.boot.items.some((i) => i.site_id === s.id)).map((s) => fileLinkApi(`/api/export/site/${s.id}`, `Register · ${s.name.split(',')[0]}`)).join('')}</div></div>`)}`;
};

/* ---------------------------------------------------------------- HR settings and integrations */
Views.hrsettings = () => {
  const kd = kinds();
  if (!kd) return `${topbar('HR settings', '#hub/hr')}${spinner()}`;
  if (KL.ui.hsInit !== true) {
    KL.ui.hsInit = true;
    setF('hs-chains', JSON.stringify(kd.chains, null, 1)); setF('hs-leave', JSON.stringify(kd.leavePolicy, null, 1)); setF('hs-hours', JSON.stringify(kd.workHours, null, 1)); setF('hs-ret', JSON.stringify(kd.retention, null, 1));
  }
  const chainsView = Object.entries(kd.chains).map(([k, steps]) => `<span>${esc(kindDef(k)?.label || (k === 'leave' ? 'Leave' : k))}</span><span>${steps.map((s) => `${ROLE_TEXT[s.role] || s.role}${s.min ? ` (≥ ${k === 'leave' ? `${s.min} d` : rupees(s.min)})` : ''}`).join(' → ')}</span>`).join('');
  return `${topbar('HR settings', '#hub/hr')}
    ${group('Approval chains', `<div class="card stack"><div class="kv">${chainsView}</div><details class="fold"><summary>Edit as text</summary>${textarea('hs-chains', F('hs-chains'))}</details></div>`)}
    ${group('Leave policy and work hours', `<div class="card stack">${field('Leave policy', textarea('hs-leave', F('hs-leave')))}${field('Work hours, grace and weekly off (0 = Monday … 6 = Sunday)', textarea('hs-hours', F('hs-hours')))}${field('Data retention (years)', textarea('hs-ret', F('hs-ret')))}</div>`)}
    <button type="button" class="btn primary wide" style="margin-top:14px" data-action="hsSave">Save settings</button>
    ${group('For reviewers', reviewerNote())}
    ${group('Integrations', `<div class="card flush">
      ${lrow({ href: '#messages', icon: 'chat', tone: 'green', title: 'WhatsApp / SMS alerts', sub: `Simulated in the prototype: ${kd.messaging.whatsapp ? 'WhatsApp on' : 'off'}. See what field staff would receive.` })}
      ${lrow({ href: '#monthend', icon: 'lock', tone: 'violet', title: 'Zoho Payroll', sub: 'Pay, PF, ESI, PT, LWF, TDS, Form 16 and salary payment are in Zoho. Each month HR locks attendance and imports the file (or Zoho pulls the JSON).' })}
      ${lrow({ icon: 'building', title: 'Microsoft 365 sign-in and SharePoint', sub: 'Not connected in the prototype (needs the company tenant)', chev: false })}
    </div>`)}`;
};
Actions.hsSave = async () => {
  try {
    const payload = { approval_chains: JSON.parse(F('hs-chains')), leave_policy: JSON.parse(F('hs-leave')), work_hours: JSON.parse(F('hs-hours')), retention: JSON.parse(F('hs-ret')) };
    await api('/api/hr/settings', { json: payload }); invalidate('m:kinds'); KL.ui.hsInit = false; toast('Settings saved'); render();
  } catch (e) { toast(e instanceof SyntaxError ? 'One of the boxes is not valid JSON' : e.message, 'error'); }
};
Views.messages = () => {
  const m = data('admin:messages', () => api('/api/admin/messages'));
  return `${topbar('WhatsApp / SMS (simulated)', '#hrsettings')}<p class="sub">Field staff have no email or Teams. In the live app these alerts go out on WhatsApp; here they are only logged.</p>
    ${m === null ? spinner() : m.error ? errorBox(m.error) : m.rows.length ? `<div class="stack">${m.rows.map((x) => `<div class="wa-msg"><div class="wa-head">${avatar(x.to_name, 'sm')}<b>${esc(x.to_name)}</b><span class="muted">${esc(x.to_phone)} · ${esc(x.channel)} · ${esc(timeAgo(x.created_at))}</span></div><p>${esc(x.text)}</p></div>`).join('')}</div>` : emptyState('chat', 'No messages yet')}`;
};

/* ---------------------------------------------------------------- privacy, two-step sign-in, phone alerts */
Views.privacy = () => {
  const kd = kinds();
  const ret = kd && !kd.error ? kd.retention : {};
  const u = KL.user;
  return `${topbar('Privacy & my data', '#me')}
    <div class="card stack"><b>What this app records about you</b>
      <p class="hint">Your name, employee ID, phone and the employee record HR keeps; your location only when you check in, start or end a trip or save a record with a photo; the photos you take; your attendance, leave, claims and tasks. It does not track you in the background.</p>
      <p class="hint">Kept for: photos ${esc(ret.photos_years ?? '–')} years (carbon-credit audits need them), attendance ${esc(ret.attendance_years ?? '–')} years, farmer documents ${esc(ret.farmer_documents_years ?? '–')} years. Bank, PAN and salary are visible only to HR and you.</p>
      ${u.consent_at ? `<div class="banner">${ic('check')}<div><b>You accepted this notice</b><p>${esc(fmtDate(u.consent_at))}</p></div></div>` : `<button type="button" class="btn primary wide" data-action="consent">I understand and agree</button>`}
      <a class="btn wide" href="/api/me/export?token=${encodeURIComponent(KL.token)}" download>${ic('download')} Download all my data</a>
    </div>`;
};
function consentView() {
  return `<div class="auth"><div class="panel" style="margin-top:8vh"><div class="card stack">
    <div class="row" style="gap:12px"><img src="./icon.svg" alt="" style="width:48px;border-radius:14px" /><div><b style="font-family:var(--font);font-size:20px">Before you start</b><p class="hint">India's Digital Personal Data Protection Act, 2023</p></div></div>
    <p>Kshetralekha records your location and photos when you check in, travel or save field evidence, and keeps your HR details. It is used for attendance, pay, approvals and carbon-credit audits, nothing else.</p>
    <p class="hint">You can see and download everything about you under Me → Privacy & my data.</p>
    <button type="button" class="btn primary wide" data-action="consent">I understand and agree</button>
    <button type="button" class="btn ghost wide" data-action="logout">Not now (sign out)</button>
  </div></div></div>`;
}
Actions.consent = async () => { try { await api('/api/me/consent', { json: {} }); await refreshMe(); KL.user.consent_at = KL.user.consent_at || new Date().toISOString(); render(); } catch (e) { toast(e.message, 'error'); } };

Views.security = () => {
  const s = data('2fa', () => api('/api/auth/2fa'));
  const setup = KL.ui.tfa;
  const office = ['admin', 'hr', 'manager'].includes(KL.user.role);
  return `${topbar('Two-step sign-in', '#me')}
    <div class="card stack">
      <p class="hint">Office accounts can add a 6-digit code from an authenticator app (Microsoft Authenticator, Google Authenticator) after the PIN.</p>
      ${!office ? '<p class="hint">Field accounts sign in with the PIN only.</p>' : s === null ? spinner() : s.error ? errorBox(s.error) : s.enabled
        ? `<div class="banner">${ic('shield')}<div><b>On</b><p>A code is asked at every sign-in.${s.demoCode ? ` Prototype: the code right now is <b class="mono">${esc(s.demoCode)}</b>.` : ''}</p></div></div><button type="button" class="btn danger wide" data-action="tfaOff">Turn off</button>`
        : setup ? `<p>Add this key to the authenticator app:</p><pre class="code">${esc(setup.secret)}</pre><p class="hint" style="word-break:break-all">${esc(setup.uri)}</p>${setup.demoCode ? `<div class="demo-ribbon">${ic('sparkle')}<span>Prototype: the current code is <b class="mono">${esc(setup.demoCode)}</b></span></div>` : ''}${field('Code from the app', input('tfa-code', F('tfa-code'), { inputmode: 'numeric', placeholder: '123456' }))}<button type="button" class="btn primary wide" data-action="tfaEnable">Turn on</button>`
          : `<button type="button" class="btn primary wide" data-action="tfaSetup">${ic('shield')} Set up two-step sign-in</button>`}
    </div>`;
};
Actions.tfaSetup = async () => { try { KL.ui.tfa = await api('/api/auth/2fa/setup', { json: {} }); render(); } catch (e) { toast(e.message, 'error'); } };
Actions.tfaEnable = async () => { try { await api('/api/auth/2fa/enable', { json: { code: F('tfa-code', '') } }); KL.ui.tfa = null; clearF('tfa-code'); invalidate('2fa'); await celebrate('Two-step sign-in is on', 'You will be asked for a code after your PIN.'); render(); } catch (e) { toast(e.message, 'error'); } };
Actions.tfaOff = async () => { try { await api('/api/auth/2fa/disable', { json: {} }); invalidate('2fa'); toast('Turned off'); render(); } catch (e) { toast(e.message, 'error'); } };

/** What the web prototype leaves out on purpose: things only the installed phone app (or the live servers) can do. */
function reviewerNote() {
  const items = [
    ['bell', 'Push notifications', 'Alerts that arrive when the app is closed need the phone app and a notification server. Here they appear in the Inbox (and in the simulated WhatsApp log).'],
    ['pin', 'Background location', 'The leave-site check runs only while the app is open. Tracking a checked-in worker with the app closed needs the native app.'],
    ['camera', 'Camera and GPS on a PC', 'Use the prototype location switch and Use a sample photo; on a phone the real camera and GPS work.'],
    ['building', 'Microsoft sign-in and SharePoint', 'Needs the company tenant. Files are kept in the same folder layout, ready to move.'],
    ['chat', 'WhatsApp, SMS and Zoho Payroll', 'Messages are logged, not sent. Zoho Payroll gets a CSV to import (or the JSON export); a live push needs the company\'s Zoho API access.'],
    ['shield', 'Hosting, backups and data', 'This demo runs inside your browser with sample data only; each phone has its own copy.'],
  ];
  return `<div class="card note-card"><p class="hint" style="margin-top:0">This is a working prototype in a web browser. These parts are left for the installed phone app or the live system:</p><div class="stack" style="gap:10px">${items.map(([i, t, d]) => `<div class="row" style="align-items:flex-start;gap:12px"><span class="icon">${ic(i)}</span><span><b style="font-size:14.5px">${esc(t)}</b><br><span class="hint">${esc(d)}</span></span></div>`).join('')}</div></div>`;
}

/* ---------------------------------------------------------------- on duty: leave-site watch (while the app is open) */
const DutyWatch = {
  timer: null, outCount: 0, told: null,
  tick() {
    const att = KL.me?.openAttendance;
    if (!att || !KL.token) { this.outCount = 0; return; }
    const site = siteById(att.site_id);
    if (!site) return;
    getFix({ fresh: true }).then((fix) => {
      KL.ui.gps = fix;
      const d = distanceM(fix.lat, fix.lng, site.lat, site.lng);
      if (d > site.radius_m + Math.min(fix.accuracy || 0, 50)) {
        this.outCount += 1;
        if (this.outCount >= 2 && this.told !== att.id) {
          this.told = att.id;
          api('/api/attendance/left-site', { json: { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy } }).catch(() => {});
          toast(`You are ${fmtNum(d)} m outside ${site.name} while checked in. Your manager is told; check out if you have left.`, 'error');
        }
      } else this.outCount = 0;
    }).catch(() => {});
  },
  start() { if (!this.timer) this.timer = setInterval(() => this.tick(), 45000); },
};

/* ---------------------------------------------------------------- languages (prototype: navigation and common words) */
const I18N = {
  gu: { Home: 'હોમ', Work: 'કામ', Tasks: 'કાર્યો', Inbox: 'ઇનબોક્સ', Me: 'હું', Planner: 'પ્લાનર', Manage: 'વ્યવસ્થા', 'Check in': 'ચેક ઇન', 'Check out': 'ચેક આઉટ', 'Start trip': 'મુસાફરી શરૂ', 'End trip': 'મુસાફરી પૂરી',
    'My tasks': 'મારાં કાર્યો', Registers: 'રજિસ્ટર', Farmers: 'ખેડૂતો', 'Daily update': 'દૈનિક અહેવાલ', Leave: 'રજા', Suggest: 'સૂચન', Today: 'આજે', 'See all': 'બધું જુઓ', Save: 'સાચવો', 'Save changes': 'ફેરફાર સાચવો',
    Cancel: 'રદ કરો', New: 'નવું', Approve: 'મંજૂર', Reject: 'નામંજૂર', Approvals: 'મંજૂરીઓ', Team: 'ટીમ', Dashboard: 'ડેશબોર્ડ', 'Site check-in': 'સાઇટ ચેક-ઇન', 'Travel allowance': 'મુસાફરી ભથ્થું',
    'Site registers': 'સાઇટ રજિસ્ટર', 'Farmers & documents': 'ખેડૂતો અને દસ્તાવેજો', 'Daily work update': 'દૈનિક કામનો અહેવાલ', People: 'કર્મચારીઓ', Money: 'નાણાં', 'Safety & equipment': 'સલામતી અને સાધનો',
    'Production & carbon': 'ઉત્પાદન અને કાર્બન', 'Purchasing & supply': 'ખરીદી અને પુરવઠો', Map: 'નકશો', Reports: 'અહેવાલો', 'Expense claims': 'ખર્ચના દાવા', Incidents: 'અકસ્માતો', 'Production batches': 'ઉત્પાદન બેચ',
    'Sapling distribution': 'રોપા વિતરણ', 'Survival checks': 'જીવંત છોડ તપાસ', 'Not checked in': 'ચેક ઇન નથી', 'All caught up': 'બધું પૂરું', Language: 'ભાષા', 'Sign out': 'સાઇન આઉટ', 'Take check-in selfie': 'ચેક-ઇન સેલ્ફી લો',
    'Submit for approval': 'મંજૂરી માટે મોકલો', 'Attendance summary': 'હાજરી સારાંશ', 'Leave balances': 'રજા બાકી', 'Notice board': 'સૂચના બોર્ડ', 'Month end': 'મહિનાનો અંત', 'Crew attendance': 'ટીમ હાજરી', 'My employee record': 'મારી કર્મચારી માહિતી', Policies: 'નીતિઓ', Checklists: 'ચેકલિસ્ટ', Equipment: 'સાધનો' },
  hi: { Home: 'होम', Work: 'काम', Tasks: 'कार्य', Inbox: 'इनबॉक्स', Me: 'मैं', Planner: 'प्लानर', Manage: 'प्रबंधन', 'Check in': 'चेक इन', 'Check out': 'चेक आउट', 'Start trip': 'यात्रा शुरू', 'End trip': 'यात्रा समाप्त',
    'My tasks': 'मेरे कार्य', Registers: 'रजिस्टर', Farmers: 'किसान', 'Daily update': 'दैनिक रिपोर्ट', Leave: 'छुट्टी', Suggest: 'सुझाव', Today: 'आज', 'See all': 'सब देखें', Save: 'सहेजें', 'Save changes': 'बदलाव सहेजें',
    Cancel: 'रद्द करें', New: 'नया', Approve: 'मंज़ूर', Reject: 'अस्वीकार', Approvals: 'मंज़ूरियाँ', Team: 'टीम', Dashboard: 'डैशबोर्ड', 'Site check-in': 'साइट चेक-इन', 'Travel allowance': 'यात्रा भत्ता',
    'Site registers': 'साइट रजिस्टर', 'Farmers & documents': 'किसान और दस्तावेज़', 'Daily work update': 'दैनिक कार्य रिपोर्ट', People: 'कर्मचारी', Money: 'पैसे', 'Safety & equipment': 'सुरक्षा और उपकरण',
    'Production & carbon': 'उत्पादन और कार्बन', 'Purchasing & supply': 'खरीद और आपूर्ति', Map: 'नक्शा', Reports: 'रिपोर्ट', 'Expense claims': 'खर्च दावे', Incidents: 'दुर्घटनाएँ', 'Production batches': 'उत्पादन बैच',
    'Sapling distribution': 'पौधा वितरण', 'Survival checks': 'जीवित पौधे जाँच', 'Not checked in': 'चेक इन नहीं', 'All caught up': 'सब पूरा', Language: 'भाषा', 'Sign out': 'साइन आउट', 'Take check-in selfie': 'चेक-इन सेल्फ़ी लें',
    'Submit for approval': 'मंज़ूरी के लिए भेजें', 'Attendance summary': 'हाज़िरी सारांश', 'Leave balances': 'छुट्टी शेष', 'Notice board': 'सूचना पट्ट', 'Month end': 'महीने का अंत', 'Crew attendance': 'टीम हाज़िरी', 'My employee record': 'मेरा कर्मचारी रिकॉर्ड', Policies: 'नीतियाँ', Checklists: 'चेकलिस्ट', Equipment: 'उपकरण' },
};
/* labels added in the 2026 redesign (navigation groups, dashboards, tables, profile tabs) */
Object.assign(I18N.gu, { Requests: 'અરજીઓ', Site: 'સાઇટ', 'To do': 'કરવાનું', 'Add new': 'નવું ઉમેરો', 'Add entry': 'નોંધ ઉમેરો', 'New request': 'નવી અરજી', 'My details': 'મારી વિગતો',
  'My attendance': 'મારી હાજરી', 'Payslips and documents': 'પગાર સ્લિપ અને દસ્તાવેજો', 'Notices and surveys': 'સૂચનાઓ અને સર્વે', 'Help and complaints': 'મદદ અને ફરિયાદ', Settings: 'સેટિંગ્સ',
  'You have not checked in': 'તમે ચેક ઇન નથી કર્યું', 'Today at the site': 'આજે સાઇટ પર', 'Your sites': 'તમારી સાઇટ્સ', 'Stock in or out': 'સ્ટોક આવક અથવા જાવક', 'Kiln batch': 'ભઠ્ઠી બેચ',
  'Daily safety check': 'દૈનિક સલામતી તપાસ', 'Report incident': 'ઘટનાની જાણ', 'Crew attendance': 'ટીમ હાજરી', 'Nursery entry': 'નર્સરી નોંધ', 'Saplings planted': 'વાવેલા રોપા', 'Generation run': 'વીજ ઉત્પાદન',
  'Complaint or idea': 'ફરિયાદ અથવા સૂચન', 'Attendance correction': 'હાજરી સુધારો', Advance: 'એડવાન્સ', Messages: 'સંદેશા', 'More': 'વધુ' });
Object.assign(I18N.hi, { Requests: 'अर्ज़ियाँ', Site: 'साइट', 'To do': 'करना है', 'Add new': 'नया जोड़ें', 'Add entry': 'एंट्री जोड़ें', 'New request': 'नई अर्ज़ी', 'My details': 'मेरी जानकारी',
  'My attendance': 'मेरी हाज़िरी', 'Payslips and documents': 'वेतन पर्ची और दस्तावेज़', 'Notices and surveys': 'सूचनाएँ और सर्वे', 'Help and complaints': 'मदद और शिकायत', Settings: 'सेटिंग्स',
  'You have not checked in': 'आपने चेक इन नहीं किया', 'Today at the site': 'आज साइट पर', 'Your sites': 'आपकी साइटें', 'Stock in or out': 'स्टॉक आवक या जावक', 'Kiln batch': 'भट्ठी बैच',
  'Daily safety check': 'दैनिक सुरक्षा जाँच', 'Report incident': 'घटना की सूचना', 'Crew attendance': 'टीम हाज़िरी', 'Nursery entry': 'नर्सरी एंट्री', 'Saplings planted': 'लगाए गए पौधे', 'Generation run': 'बिजली उत्पादन',
  'Complaint or idea': 'शिकायत या सुझाव', 'Attendance correction': 'हाज़िरी सुधार', Advance: 'एडवांस', Messages: 'संदेश', 'More': 'और' });
Object.assign(I18N.gu, { 'My work': 'મારું કામ', 'People & HR': 'કર્મચારીઓ અને HR', Operations: 'કામગીરી', Admin: 'વહીવટ', 'Check-in': 'ચેક-ઇન', Expenses: 'ખર્ચ', Expense: 'ખર્ચ',
  Travel: 'મુસાફરી', Directory: 'કર્મચારી યાદી', Registers: 'રજિસ્ટર', 'Change log': 'ફેરફાર નોંધ', 'HR desk': 'HR ડેસ્ક', Notices: 'સૂચનાઓ', Surveys: 'સર્વે', Administration: 'વહીવટ',
  'HR settings': 'HR સેટિંગ્સ', 'Carbon chain': 'કાર્બન સાંકળ', Purchasing: 'ખરીદી', 'Team activity': 'ટીમની પ્રવૃત્તિ', Attendance: 'હાજરી', 'Waiting for you': 'તમારી રાહ જોતું',
  'Checked in today': 'આજે ચેક ઇન', 'On site now': 'હાલ સાઇટ પર', 'Overdue tasks': 'મોડાં કાર્યો', Pending: 'બાકી', "Today's tasks": 'આજનાં કાર્યો', 'All tasks': 'બધાં કાર્યો',
  Open: 'ખોલો', Search: 'શોધો', Previous: 'પાછળ', Next: 'આગળ', Overview: 'સારાંશ', Job: 'નોકરી', Documents: 'દસ્તાવેજો', Assets: 'સાધનો', Training: 'તાલીમ', Goals: 'લક્ષ્યો',
  'Apply for leave': 'રજા માટે અરજી', 'My leave': 'મારી રજા', Status: 'સ્થિતિ', Type: 'પ્રકાર', Days: 'દિવસ', Apply: 'અરજી કરો', 'My site': 'મારી સાઇટ', Sites: 'સાઇટ્સ',
  'Sign in': 'સાઇન ઇન', 'Employee ID': 'કર્મચારી ID', 'Check out': 'ચેક આઉટ', 'Team today': 'આજે ટીમ', 'Late': 'મોડું', 'Approved': 'મંજૂર', 'Rejected': 'નામંજૂર', 'Present': 'હાજર', 'Absent': 'ગેરહાજર' });
Object.assign(I18N.hi, { 'My work': 'मेरा काम', 'People & HR': 'कर्मचारी और HR', Operations: 'संचालन', Admin: 'प्रशासन', 'Check-in': 'चेक-इन', Expenses: 'खर्च', Expense: 'खर्च',
  Travel: 'यात्रा', Directory: 'कर्मचारी सूची', Registers: 'रजिस्टर', 'Change log': 'बदलाव लॉग', 'HR desk': 'HR डेस्क', Notices: 'सूचनाएँ', Surveys: 'सर्वे', Administration: 'प्रशासन',
  'HR settings': 'HR सेटिंग्स', 'Carbon chain': 'कार्बन श्रृंखला', Purchasing: 'खरीद', 'Team activity': 'टीम गतिविधि', Attendance: 'हाज़िरी', 'Waiting for you': 'आपकी प्रतीक्षा में',
  'Checked in today': 'आज चेक इन', 'On site now': 'अभी साइट पर', 'Overdue tasks': 'देर वाले कार्य', Pending: 'लंबित', "Today's tasks": 'आज के कार्य', 'All tasks': 'सभी कार्य',
  Open: 'खोलें', Search: 'खोजें', Previous: 'पिछला', Next: 'अगला', Overview: 'सारांश', Job: 'नौकरी', Documents: 'दस्तावेज़', Assets: 'संपत्ति', Training: 'प्रशिक्षण', Goals: 'लक्ष्य',
  'Apply for leave': 'छुट्टी के लिए आवेदन', 'My leave': 'मेरी छुट्टी', Status: 'स्थिति', Type: 'प्रकार', Days: 'दिन', Apply: 'आवेदन करें', 'My site': 'मेरी साइट', Sites: 'साइटें',
  'Sign in': 'साइन इन', 'Employee ID': 'कर्मचारी ID', 'Check out': 'चेक आउट', 'Team today': 'आज टीम', 'Late': 'देर', 'Approved': 'मंज़ूर', 'Rejected': 'अस्वीकृत', 'Present': 'उपस्थित', 'Absent': 'अनुपस्थित' });
function lang() { try { return localStorage.getItem('kl.lang') || 'en'; } catch { return 'en'; } }
function translate(root) {
  const L_ = I18N[lang()];
  if (!L_) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const todo = [];
  while (walker.nextNode()) { const n = walker.currentNode; const t = n.nodeValue.trim(); if (t && L_[t]) todo.push([n, t]); }
  for (const [n, t] of todo) n.nodeValue = n.nodeValue.replace(t, L_[t]);
}
Actions.lang = (el) => { try { localStorage.setItem('kl.lang', el.dataset.lang); } catch { /* private */ } render(); };
Actions.mapGo = (el) => { if (KL.leafletMap) KL.leafletMap.flyTo([Number(el.dataset.lat), Number(el.dataset.lng)], Number(el.dataset.zoom), { duration: 0.8 }); };
Actions.mapAll = () => { if (KL.leafletMap && KL.leafletBounds.length) KL.leafletMap.flyToBounds(KL.leafletBounds, { padding: [30, 30], duration: 0.8 }); };
