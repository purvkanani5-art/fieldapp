/* Role home dashboards (field staff, manager, HR, director) and the unified approvals queue.
   Uses the existing APIs only; see docs/ui-redesign-plan.md §5. */

Views.home = () => (KL.user.role === 'field' ? fieldDash() : KL.user.role === 'manager' ? managerDash() : KL.user.role === 'hr' ? hrDash() : directorDash());

function dashHead(sub = '') {
  const u = KL.user;
  const now = new Date();
  const greet = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening';
  return `<header class="dash-head topbar hero"><div class="ph-crumbs"><nav class="crumbs" aria-label="Breadcrumb"><span aria-current="page">Home</span></nav>${syncChip()}</div>
    <div><h1>${esc(greet)}, ${esc(firstName(u.name))}</h1><p class="meta">${esc(now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))} · ${esc(u.designation || ROLE_TEXT[u.role] || u.role)}${sub ? ` · ${sub}` : ''}</p></div></header>`;
}
const lastMonth = () => prevMonth();

/* ---------------------------------------------------------------- field staff */
function fieldDash() {
  const me = KL.me || {};
  const att = me.openAttendance;
  const trip = me.openTrip;
  const upd = data('updates:mine', () => api('/api/updates?days=1'));
  const doneToday = upd && !upd.error && upd.rows.some((r) => r.date === todayISO());
  const my = data('planner:my', () => api('/api/planner/my'));
  const open = my && !my.error ? my.tasks.filter((t) => t.progress !== 'completed').sort(byDue) : [];
  const late = open.filter(isLate).length;
  const leaves = data('leaves:mine', () => api('/api/leaves'));
  const pendLeave = leaves && !leaves.error ? leaves.rows.filter((l) => l.status === 'pending') : [];
  const today = att
    ? `<div class="today"><span class="big-ic" aria-hidden="true">${ic('pin')}</span><div class="t-state"><b>Checked in at ${esc(att.site_name)}</b><span>Since ${esc((fmtDate(att.checkin_at).split(', ')[1]) || '')}${att.status === 'pending' ? ' · exception pending' : ''}</span></div><span class="timer" data-since="${esc(att.checkin_at)}">${esc(duration(att.checkin_at))}</span><a class="btn primary" href="#attendance">${ic('pin')} Check out</a></div>`
    : `<div class="today"><div class="t-state"><b>Not checked in</b><span>Take a selfie at the site to start your day.</span></div><a class="btn primary" href="#attendance">${ic('pin')} Check in</a></div>`;
  const pending = [
    ...pendLeave.map((l) => ({ title: `Leave ${fmtDate(l.from_date, false)}${l.to_date !== l.from_date ? ` to ${fmtDate(l.to_date, false)}` : ''}`, sub: `${esc(l.type)} · waiting for approval`, tone: 'warn', href: '#leaves' })),
    ...(trip ? [{ title: 'Trip running', sub: `${esc(trip.vehicle)} · from ${fmtNum(trip.start_reading)} km`, tone: 'info', href: '#trips' }] : []),
    ...(doneToday ? [] : [{ title: 'Daily update not written yet', sub: 'A few lines on what you did today', tone: 'neutral', href: '#updates' }]),
  ];
  const tasksBody = my === null ? spinner() : my.error ? errorBox(my.error) : open.length ? `<div class="task-grid">${open.slice(0, 4).map((t) => taskCard(t, { showPlan: true })).join('')}</div>` : emptyState('check', 'No open tasks', 'New tasks from your manager appear here.');
  return `${dashHead()}
    <section class="card" aria-label="Today">${today}</section>
    ${KL.outboxCount ? `<div class="banner warn" style="margin-top:12px">${ic('upload')}<div><b>${KL.outboxCount} saved on this phone</b><p>They are sent automatically when the signal is back.</p></div></div>` : ''}
    ${quickActions([['#attendance', 'pin', '', att ? 'Check out' : 'Check in'], ['#updates', 'note', '', 'Daily update'], ['#leaves', 'sun', '', 'Leave'], ['#rec/expense', 'receipt', '', 'Expense'], ['#trips', 'bike', '', trip ? 'End trip' : 'Travel'], ['#tasks', 'kanban', '', 'My tasks', late || '']])}
    ${hrBanners()}
    ${mySiteCards()}
    <div class="cols">
      ${group('Today\'s tasks', tasksBody, '', '<a href="#tasks">All tasks</a>')}
      ${group('Pending', pending.length ? `<div class="card flush">${timeline(pending)}</div>` : '<div class="card"><p class="empty">Nothing waiting on you.</p></div>')}
    </div>`;
}

/* ---------------------------------------------------------------- manager */
function managerDash() {
  const d = data('dashboard', () => api('/api/dashboard'));
  const items = approvalItems();
  const att = data('attendance:today', () => api('/api/attendance?scope=team&days=1'));
  const ppl = data('hr:people', () => api('/api/hr/people'));
  const kd = kinds();
  const startMin = (() => { const w = kd && !kd.error ? kd.workHours : null; const [h, m] = String(w?.start || '09:00').split(':').map(Number); return h * 60 + m + Number(w?.grace_min ?? 15); })();
  const todayRows = att && !att.error ? att.rows.filter((a) => a.checkin_at && new Date(a.checkin_at).toDateString() === new Date().toDateString()) : [];
  const inIds = new Set(todayRows.map((a) => a.user_id));
  const lateRows = todayRows.filter((a) => { const t = new Date(a.checkin_at); return t.getHours() * 60 + t.getMinutes() > startMin; });
  const crew = ppl && !ppl.error ? ppl.rows.filter((u) => u.active && u.role === 'field') : [];
  const notIn = crew.filter((u) => !inIds.has(u.id) && u.app_access);
  const ok = d && !d.error;
  const queue = items === null ? spinner() : items.error ? errorBox(items.error) : items.length ? `<div class="stack">${items.slice(0, 5).map(apCard).join('')}</div>${items.length > 5 ? `<a class="btn wide" style="margin-top:10px" href="#approvals">See all ${items.length}</a>` : ''}` : '<div class="card"><p class="empty">Nothing waiting for you.</p></div>';
  return `${dashHead()}
    <div class="kpis">${kpi({ label: 'Waiting for you', value: items && !items.error ? items.length : '–', tone: items && items.length ? 'warn' : '', href: '#approvals' })}${kpi({ label: 'Checked in today', value: ok ? `${d.todayAttendance}<span class="muted" style="font-size:16px"> / ${d.fieldTotal}</span>` : '–', href: '#team' })}${kpi({ label: 'On site now', value: ok ? d.onSite.length : '–', href: '#team' })}${kpi({ label: 'Overdue tasks', value: ok ? d.tasks.late : '–', tone: ok && d.tasks.late ? 'bad' : '', href: '#planner' })}</div>
    ${hrBanners()}
    <div class="cols">
      ${group(`Approvals${items && items.length ? ` · ${items.length}` : ''}`, queue, '', '<a href="#approvals">Open queue</a>')}
      <div>
        ${group('Team today', att === null || ppl === null ? spinner() : `<div class="card flush">
          ${lateRows.length ? lateRows.map((a) => `<div class="lrow-static row">${avatar(a.user_name, 'sm')}<span class="tx" style="flex:1"><b>${esc(a.user_name)}</b><span class="muted" style="font-size:14px;display:block">${esc(a.site_name || '')} · in at ${esc((fmtDate(a.checkin_at).split(', ')[1]) || '')}</span></span>${tag('Late', 'warn')}</div>`).join('') : ''}
          ${notIn.slice(0, 8).map((u) => `<div class="lrow-static row">${avatar(u.name, 'sm')}<span class="tx" style="flex:1"><b>${esc(u.name)}</b><span class="muted" style="font-size:14px;display:block">${esc(u.designation || '')}</span></span>${tag('Not checked in', 'bad')}</div>`).join('')}
          ${!lateRows.length && !notIn.length ? '<p class="empty">Everyone with the app has checked in on time.</p>' : ''}
        </div>`, '', '<a href="#team">Team activity</a>')}
        ${ok ? group('On site now', d.onSite.length ? `<div class="card flush">${timeline(d.onSite.slice(0, 6).map((a) => ({ title: a.user_name, sub: `${esc(a.site_name)}${a.status === 'pending' ? ' · exception pending' : ''}`, time: (fmtDate(a.checkin_at).split(', ')[1]) || '', tone: a.status === 'pending' ? 'warn' : '' })))}</div>` : '<div class="card"><p class="empty">Nobody is checked in right now.</p></div>') : ''}
      </div>
    </div>`;
}

/* ---------------------------------------------------------------- HR */
function hrDash() {
  const items = approvalItems();
  const lm = lastMonth();
  const mon = data(`hr:month:${lm}`, () => api(`/api/hr/month/${lm}`));
  const fb = data('feedback:all', () => api('/api/feedback'));
  const pol = data('m:policy', () => api('/api/m/policy'));
  const onb = data('m:onboarding', () => api('/api/m/onboarding'));
  const ex = data('m:exit', () => api('/api/m/exit'));
  const a = data('approvals', () => api('/api/approvals'));
  const people = (KL.boot?.people || []).length;
  const mustAck = pol && !pol.error ? pol.rows.filter((p) => p.data.must_ack === 'Yes') : [];
  const ackDetail = mustAck.map((p) => data(`m:policy:${p.id}`, () => api(`/api/m/policy/${p.id}`)));
  const outstanding = ackDetail.every((x) => x && !x.error) ? ackDetail.reduce((s, x) => s + Math.max(0, people - (x.acks || []).length), 0) : null;
  const openFb = fb && !fb.error ? fb.rows.filter((r) => r.status !== 'closed') : [];
  const inProg = [...(onb && !onb.error ? onb.rows.filter((r) => r.status !== 'done').map((r) => ({ ...r, k: 'onboarding', w: 'Joining' })) : []), ...(ex && !ex.error ? ex.rows.filter((r) => r.status !== 'settled').map((r) => ({ ...r, k: 'exit', w: 'Leaving' })) : [])];
  const leaveReq = a && !a.error ? a.leaves : [];
  let monthCard = spinner();
  if (mon && !mon.error) {
    const reviewed = mon.managers.filter((x) => x.reviewed_at).length;
    const locked = mon.status === 'locked';
    const step = locked ? 3 : reviewed === mon.managers.length && mon.managers.length ? 2 : 1;
    monthCard = `<a class="card month-card" href="#monthend/${esc(lm)}" style="display:block;text-decoration:none;color:inherit"><div class="row between"><b>${esc(mon.label)}</b>${locked ? statusTag('locked') : tag('Open', 'warn')}</div>
      <p class="hint" style="margin-top:4px">${locked ? `Locked by ${esc(mon.locked_by)}. The Zoho Payroll file is ready.` : `${reviewed} of ${mon.managers.length} managers confirmed${mon.checks.length ? ` · ${mon.checks.length} item${mon.checks.length === 1 ? '' : 's'} to sort out` : ''}. Next: ${step === 1 ? 'managers confirm' : 'approve and lock'}.`}</p>
      <div class="month-state"><div class="steps" style="flex:1" aria-label="Step ${step} of 3">${[1, 2, 3].map((n) => `<i class="${n <= step ? 'on' : ''}"></i>`).join('')}</div></div></a>`;
  } else if (mon && mon.error) monthCard = errorBox(mon.error);
  return `${dashHead()}
    <div class="kpis">${kpi({ label: 'Waiting for you', value: items && !items.error ? items.length : '–', tone: items && items.length ? 'warn' : '', href: '#approvals' })}${kpi({ label: 'Leave requests', value: a && !a.error ? leaveReq.length : '–', href: '#approvals' })}${kpi({ label: 'HR desk open', value: fb && !fb.error ? openFb.length : '–', tone: openFb.length ? 'warn' : '', href: '#hrdesk' })}${kpi({ label: 'Policy acceptances due', value: outstanding === null ? '–' : outstanding, sub: mustAck.length ? `${mustAck.length} polic${mustAck.length === 1 ? 'y' : 'ies'} to accept` : '', href: '#rec/policy' })}</div>
    ${hrBanners()}
    <div class="cols">
      <div>
        ${group('Attendance month', monthCard, '', '<a href="#monthend">Month end</a>')}
        ${group('Approvals', items === null ? spinner() : items.error ? errorBox(items.error) : items.length ? `<div class="stack">${items.slice(0, 4).map(apCard).join('')}</div>` : '<div class="card"><p class="empty">Nothing waiting for you.</p></div>', '', '<a href="#approvals">Open queue</a>')}
      </div>
      <div>
        ${group('HR desk', fb === null ? spinner() : openFb.length ? `<div class="card flush">${timeline(openFb.slice(0, 5).map((r) => ({ title: `${r.type === 'complaint' ? 'Complaint' : 'Suggestion'} · ${r.user_name || 'Anonymous'}`, sub: esc(String(r.text).slice(0, 90)), time: timeAgo(r.created_at), tone: r.type === 'complaint' ? 'warn' : 'info', href: '#hrdesk' })))}</div>` : '<div class="card"><p class="empty">No open tickets.</p></div>', '', '<a href="#hrdesk">HR desk</a>')}
        ${group('Joining and leaving', inProg.length ? `<div class="card flush">${inProg.map((r) => lrow({ href: `#rec/${r.k}/${r.id}`, icon: r.k === 'exit' ? 'logout' : 'users', title: r.title, sub: `${r.w}${r.data.joining_date ? ` · joins ${esc(fmtDate(r.data.joining_date, false))}` : r.data.last_day ? ` · last day ${esc(fmtDate(r.data.last_day, false))}` : ''}`, right: statusTag(r.status) })).join('')}</div>` : '<div class="card"><p class="empty">Nobody joining or leaving.</p></div>', '', '<a href="#rec/onboarding">All</a>')}
      </div>
    </div>`;
}

/* ---------------------------------------------------------------- director */
function directorDash() {
  const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - (5 - i)); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; });
  const reps = months.map((m) => data(`reports:${m}`, () => api(`/api/reports/summary?month=${m}`)));
  const ready = reps.every((r) => r && !r.error);
  const d = data('dashboard', () => api('/api/dashboard'));
  const items = approvalItems();
  const attPct = (r) => { const t = r.attendance.reduce((a, x) => ({ p: a.p + x.P + x.H * 0.5, d: a.d + x.P + x.H + x.A }), { p: 0, d: 0 }); return t.d ? Math.round((t.p / t.d) * 100) : 0; };
  const series = (fn) => (ready ? reps.map(fn) : null);
  const last = ready ? reps[reps.length - 1] : null;
  const headcount = (KL.boot?.people || []).length;
  const ok = d && !d.error;
  const k = ready
    ? `<div class="kpis">
      ${kpi({ label: 'Headcount', value: fmtNum(headcount), sub: `${ok ? d.fieldTotal : '–'} field staff`, href: '#people' })}
      ${kpi({ label: 'Attendance this month', value: `${attPct(last)}%`, sub: 'present days of working days, field staff', spark: series(attPct), href: '#attsum' })}
      ${kpi({ label: 'Biochar produced', value: `${fmtNum(last.production.output)} kg`, sub: `${last.production.batches} batches this month`, spark: series((r) => r.production.output), href: '#carbon' })}
      ${kpi({ label: 'Expense claims', value: rupees(last.expenses.total), sub: `${rupees(last.expenses.approved)} approved`, spark: series((r) => r.expenses.total), href: '#rec/expense' })}
      ${kpi({ label: 'Open incidents', value: fmtNum(last.incidents.open), tone: last.incidents.open ? 'bad' : 'ok', sub: `${last.incidents.total} reported this month`, spark: series((r) => r.incidents.total), href: '#rec/incident' })}
    </div><p class="hint" style="margin-top:6px">Trend lines show the last six months (${esc(monthName(months[0]))} to ${esc(monthName(months[5]))}).</p>`
    : reps.some((r) => r && r.error) ? errorBox(reps.find((r) => r && r.error).error) : spinner();
  return `${dashHead()}
    ${k}
    ${hrBanners()}
    <div class="cols">
      ${group(`Approvals${items && items.length ? ` · ${items.length}` : ''}`, items === null ? spinner() : items.error ? errorBox(items.error) : items.length ? `<div class="stack">${items.slice(0, 4).map(apCard).join('')}</div>` : '<div class="card"><p class="empty">Nothing waiting for you.</p></div>', '', '<a href="#approvals">Open queue</a>')}
      ${group('Operations today', ok ? `<div class="card"><div class="split-num"><div><b>${d.onSite.length}</b><span>on site now</span></div><div><b>${d.todayAttendance}/${d.fieldTotal}</b><span>checked in</span></div><div><b>${d.ops ? d.ops.equipmentDown : 0}</b><span>equipment down</span></div><div><b>${d.stock.filter((s) => s.low).length}</b><span>low-stock items</span></div></div></div>` : spinner(), '', '<a href="#dashboard">Dashboard</a>')}
    </div>
    ${Views.dashboardBody()}`;
}

/* ---------------------------------------------------------------- unified approvals queue */
const AP_TYPES = { leave: 'Leave', trip: 'Travel', checkin: 'Check-in', expense: 'Expense', advance: 'Advance', purchase_request: 'Purchase', regularisation: 'Correction', farmer_payment: 'Farmer payment' };
/** Every request waiting for the signed-in person, normalised: { key, type, who, title, facts[], when, amount, image, decide: {action, kind, id, ok}, safe }. */
function approvalItems() {
  if (!isStaff()) return [];
  const a = data('approvals', () => api('/api/approvals'));
  const m = data('m-approvals', () => api('/api/m-approvals'));
  kinds();
  if (a === null || m === null) return null;
  if (a.error || m.error) return { error: (a.error || m.error) };
  const out = [];
  for (const t of a.trips) out.push({ key: `trips:${t.id}`, type: 'trip', who: t.user_name, title: `${t.vehicle} · ${fmtNum(t.km_claimed, 1)} km`, amount: t.amount, when: t.end_at,
    facts: [['Odometer', `${fmtNum(t.start_reading)} → ${fmtNum(t.end_reading)} km`], ['Straight line', t.km_straight !== null ? `${fmtNum(t.km_straight, 1)} km` : '–'], ['Purpose', t.purpose || '–']],
    images: [t.start_file, t.end_file], decide: { action: 'decide', kind: 'trips', id: t.id, ok: 'approved', okText: 'Approve' }, safe: true });
  for (const x of a.attendance) out.push({ key: `attendance:${x.id}`, type: 'checkin', who: x.user_name, title: `${x.site_name} · ${fmtNum(x.checkin_dist)} m outside`, when: x.checkin_at,
    facts: [['Allowed', `${x.radius_m} m`], ['Reason', x.override_reason || '–']], images: [x.checkin_file, x.checkout_file], decide: { action: 'decide', kind: 'attendance', id: x.id, ok: 'ok', okText: 'Accept' }, safe: true });
  for (const l of a.leaves) out.push({ key: `leaves:${l.id}`, type: 'leave', who: l.user_name, title: `${l.type} · ${fmtDate(l.from_date, false)}${l.to_date !== l.from_date ? ` to ${fmtDate(l.to_date, false)}` : ''}`, when: l.created_at,
    facts: [['Days', fmtNum(l.days || 0, 1)], ['Balance', l.balance && l.balance.available !== null ? `${fmtNum(l.balance.available, 1)} left` : '–'], ['Reason', l.reason || '–'], ...((l.steps || []).length > 1 ? [['Chain', l.steps.map((s) => `${ROLE_TEXT[s.role] || s.role}${s.status === 'approved' ? ' ✓' : s.status === 'waiting' ? ' (now)' : ''}`).join(' → ')]] : [])],
    decide: { action: 'decide', kind: 'leaves', id: l.id, ok: 'approved', okText: 'Approve' }, safe: (l.days || 0) <= 1 && (!l.balance || l.balance.available === null || l.balance.available >= (l.days || 0)) });
  for (const { step, kind, record: r } of m.rows) {
    const k = kindDef(kind);
    if (!k) continue;
    const amt = k.amount ? Number(r.data[k.amount]) || 0 : null;
    out.push({ key: `${kind}:${r.id}`, type: AP_TYPES[kind] ? kind : 'other', who: r.user_name, title: `${k.one}${r.title ? ` · ${r.title}` : ''}`, amount: amt, when: r.created_at,
      facts: [['Details', recSub(k, r)], ['Step', `${step.step} of ${(r.steps || []).length}`], ...k.fields.filter((f) => f.type === 'textarea' && r.data[f.key]).slice(0, 1).map((f) => [f.label, r.data[f.key]])],
      images: [r.file_id], open: `#rec/${kind}/${r.id}`, decide: { action: 'recDecide', kind, id: r.id, ok: 'approved', okText: 'Approve' }, safe: kind === 'regularisation' });
  }
  return out.sort((x, y) => String(x.when || '').localeCompare(String(y.when || '')));
}
function apCard(it, { select = false } = {}) {
  const d = it.decide;
  const sel = select && it.safe ? `<input type="checkbox" class="ap-sel" data-change="apSel" data-key="${esc(it.key)}" ${KL.ui.apSel?.has(it.key) ? 'checked' : ''} aria-label="Select for bulk approval" />` : '';
  return `<div class="card ap-card"><div class="ap-top">${sel}${avatar(it.who)}<div class="tx"><b>${esc(it.who)}</b><small>${tag(AP_TYPES[it.type] || 'Request', 'info')} ${esc(it.title)}</small></div>${it.amount !== null && it.amount !== undefined ? `<b class="mono" style="font-size:16px">${esc(rupees(it.amount))}</b>` : ''}</div>
    <div class="ap-facts">${it.facts.filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `<span>${esc(k)}: <b>${String(v).includes('<') ? v : esc(v)}</b></span>`).join('')}${it.when ? `<span>${esc(timeAgo(it.when))}</span>` : ''}</div>
    ${(it.images || []).filter(Boolean).length ? `<div class="row" style="gap:8px">${it.images.filter(Boolean).map((f) => authImg(f)).join('')}</div>` : ''}
    <div class="ap-act">${it.open ? `<a class="btn small" href="${esc(it.open)}">Open</a>` : ''}<button type="button" class="btn small" data-action="${d.action}" data-kind="${esc(d.kind)}" data-id="${esc(d.id)}" data-decision="rejected">Reject</button><button type="button" class="btn small primary" data-action="${d.action}" data-kind="${esc(d.kind)}" data-id="${esc(d.id)}" data-decision="${esc(d.ok)}">${esc(d.okText)}</button></div></div>`;
}
Views.approvals = () => {
  const items = approvalItems();
  const head = topbar('Approvals', '#hr');
  if (items === null) return `${head}${spinner()}`;
  if (items.error) return `${head}${errorBox(items.error)}`;
  const type = F('ap-type', '');
  const counts = items.reduce((c, it) => ({ ...c, [it.type]: (c[it.type] || 0) + 1 }), {});
  const shown = items.filter((it) => !type || it.type === type);
  KL.ui.apSel = KL.ui.apSel || new Set();
  for (const k of [...KL.ui.apSel]) if (!items.some((it) => it.key === k && it.safe)) KL.ui.apSel.delete(k);
  const safe = shown.filter((it) => it.safe);
  const n = KL.ui.apSel.size;
  return `${head}
    <p class="sub">Everything waiting for your decision, oldest first. Travel claims, check-in exceptions, attendance corrections and one-day leave within balance can be approved together; money requests are decided one by one.</p>
    <div class="chips" role="group" aria-label="Filter by type"><button type="button" data-action="apType" data-type="" aria-pressed="${!type}">All · ${items.length}</button>${Object.entries(counts).map(([t, c]) => `<button type="button" data-action="apType" data-type="${esc(t)}" aria-pressed="${type === t}">${esc(AP_TYPES[t] || 'Other')} · ${c}</button>`).join('')}</div>
    ${safe.length ? `<div class="row" style="margin-top:12px;gap:8px;flex-wrap:wrap"><button type="button" class="btn small" data-action="apSelAll">${ic('check')} Select all that can be approved together (${safe.length})</button>${n ? `<button type="button" class="btn small ghost" data-action="apSelNone">Clear selection</button>` : ''}</div>` : ''}
    <div style="margin-top:12px">${shown.length ? shown.map((it) => apCard(it, { select: true })).join('') : emptyState('check', 'Nothing waiting', 'New requests from your team appear here.')}</div>
    ${n ? `<div class="bulk-bar" role="region" aria-label="Bulk approval"><span>${n} selected</span><button type="button" class="btn small primary" data-action="apBulk">Approve ${n}</button></div>` : ''}`;
};
Actions.apType = (el) => { setF('ap-type', el.dataset.type); render(); };
Changes.apSel = (el) => { KL.ui.apSel = KL.ui.apSel || new Set(); if (el.checked) KL.ui.apSel.add(el.dataset.key); else KL.ui.apSel.delete(el.dataset.key); render(); };
Actions.apSelAll = () => { const items = approvalItems(); const type = F('ap-type', ''); KL.ui.apSel = new Set((items || []).filter((it) => it.safe && (!type || it.type === type)).map((it) => it.key)); render(); };
Actions.apSelNone = () => { KL.ui.apSel = new Set(); render(); };
Actions.apBulk = async (el) => {
  const items = (approvalItems() || []).filter((it) => KL.ui.apSel.has(it.key) && it.safe);
  if (!items.length) return;
  if (!(await modal({ title: `Approve ${items.length} request${items.length === 1 ? '' : 's'}?`, message: items.map((it) => `${it.who}: ${AP_TYPES[it.type] || 'Request'}`).join(' · '), confirmText: `Approve ${items.length}` }))) return;
  el.classList.add('busy');
  let done = 0;
  const failed = [];
  for (const it of items) {
    const d = it.decide;
    try {
      if (d.action === 'recDecide') await api(`/api/m-steps/${d.kind}/${d.id}/decide`, { json: { decision: 'approved', note: '' } });
      else await api(`/api/${d.kind}/${d.id}/decide`, { json: { decision: d.ok, note: '' } });
      done += 1;
    } catch (e) { failed.push(`${it.who}: ${e.message}`); }
  }
  KL.ui.apSel = new Set();
  invalidate('approvals', 'm-approvals', 'dashboard', 'trips', 'attendance', 'leaves'); await refreshMe();
  if (failed.length) toast(`${done} approved; ${failed.length} not: ${failed[0]}`, 'error'); else await celebrate(`${done} approved`, 'The people are told in their inbox.');
  render();
};
