/* Office home (2026-11-19 redesign, prototype: claude.ai/artifact/FPnhQbPP7SRumKQacV9yF7): a greeting with the
   message bell and your photo, the green "requests to approve" card, Today (on site, late, on leave, travel waiting),
   the sites with their state, then a little per role (manager: who is not in; HR: month end, joining and leaving;
   director: six-month trends). Adding things is the "+" in the bottom bar. */

Views.home = () => (KL.user.role === 'manager' ? managerDash() : KL.user.role === 'hr' ? hrDash() : directorDash());

function dashHead() {
  const u = KL.user;
  const now = new Date();
  const greet = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening';
  const unread = KL.me?.unread || 0;
  return `<header class="dash-head hello"><div class="hello-tx"><p class="meta">${esc(now.toLocaleDateString(appLocale(), { weekday: 'long', day: 'numeric', month: 'long' }))} · ${esc(u.designation || ROLE_TEXT[u.role] || u.role)}</p><h1>${esc(greet)}, ${esc(firstName(u.name))}</h1></div>
    <div class="hello-btns"><a class="round-btn" href="#inbox" aria-label="Messages${unread ? `, ${unread} new` : ''}">${ic('bell')}${unread ? `<span class="badge">${unread}</span>` : ''}</a><a href="#me" aria-label="Me and my things" class="hello-me">${avatar(u.name, 'lg')}</a></div></header>`;
}
const lastMonth = () => prevMonth();

/** The top every office person sees: what waits for them, today in numbers, and the sites. */
function officeTop() {
  const items = approvalItems();
  const d = can('reports.view') ? data('dashboard', () => api('/api/dashboard')) : null;
  const n = items && !items.error ? items.length : 0;
  const kinds_ = items && !items.error ? [...new Set(items.map((x) => (AP_TYPES[x.type] || 'Request').toLowerCase()))] : [];
  const needs = n ? `<a class="needs-card" href="#approvals"><span class="nc-ic">${ic('check')}</span><span class="nc-tx"><b>${n} request${n === 1 ? '' : 's'} to approve</b><span>${esc(kinds_.join(', '))}</span></span><span class="nc-btn">Review now</span></a>` : '';
  if (!can('reports.view')) return needs;
  if (d === null) return `${needs}${spinner()}`;
  if (d.error) return `${needs}${errorBox(d.error)}`;
  const names = (xs) => xs.slice(0, 3).map((x) => firstName(x.name)).join(', ') + (xs.length > 3 ? ` +${xs.length - 3}` : '');
  const tile = (href, label, value, sub, tone) => `<a class="today-tile ${tone || ''}" href="${href}"><span class="tt-lbl">${esc(label)}</span><b>${value}</b>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</a>`;
  const PJ = { biochar: ['flame', 'earth'], gasifier: ['cog', 'blue'], agroforestry: ['tree', 'green'] };
  const sites = (d.sitesToday || []).map((s) => {
    const [icon, tone] = PJ[s.project] || ['pin', ''];
    const state = s.incidents ? tag(`${s.incidents} incident${s.incidents === 1 ? '' : 's'}`, 'bad') : s.low.length ? tag(`${s.low[0]} low`, 'warn') : tag('Running', 'ok');
    return lrow({ href: `#site/${s.id}`, icon, tone, title: s.name, sub: `${projectsMeta()[s.project]?.name || s.project} · ${s.onSite} on site`, right: state });
  }).join('');
  return `${needs}
    ${group('Today', `<div class="today-tiles">
      ${tile('#attsum', 'On site now', `${d.onSite.length}<small> / ${d.fieldTotal}</small>`, '', 'ok')}
      ${tile('#attsum', 'Late', String(d.late.length), d.late.length ? names(d.late) : 'Nobody', d.late.length ? 'warn' : '')}
      ${tile('#attsum', 'On leave', String(d.onLeave.length), d.onLeave.length ? names(d.onLeave) : 'Nobody', 'info')}
      ${tile('#approvals', 'Travel to approve', rupees(d.travelPending), '', '')}
    </div>`)}
    ${sites ? group('Sites', `<div class="card flush">${sites}</div>`, '', '<a href="#sites">All sites</a>') : ''}`;
}

/* ---------------------------------------------------------------- manager */
function managerDash() {
  const att = data('attendance:today', () => api('/api/attendance?scope=team&days=1'));
  const ppl = data('hr:people', () => api('/api/hr/people'));
  const todayRows = att && !att.error ? att.rows.filter((a) => a.checkin_at && new Date(a.checkin_at).toDateString() === new Date().toDateString()) : [];
  const inIds = new Set(todayRows.map((a) => a.user_id));
  const crew = ppl && !ppl.error ? ppl.rows.filter((u) => u.active && u.role === 'field') : [];
  const notIn = crew.filter((u) => !inIds.has(u.id) && u.app_access);
  return `${dashHead()}
    ${officeTop()}
    ${hrBanners()}
    ${group('Not checked in yet', att === null || ppl === null ? spinner() : notIn.length ? `<div class="card flush">${notIn.slice(0, 8).map((u) => `<div class="lrow-static row">${avatar(u.name, 'lg')}<span class="tx" style="flex:1"><b>${esc(u.name)}</b><span class="muted" style="font-size:14px;display:block">${esc(u.designation || '')}</span></span>${tag('Not in', 'bad')}</div>`).join('')}</div>` : '<div class="card"><p class="empty">Everyone with the app has checked in.</p></div>', '', '<a href="#team">Team activity</a>')}`;
}

/* ---------------------------------------------------------------- HR */
function hrDash() {
  const lm = lastMonth();
  const mon = data(`hr:month:${lm}`, () => api(`/api/hr/month/${lm}`));
  const onb = data('m:onboarding', () => api('/api/m/onboarding'));
  const ex = data('m:exit', () => api('/api/m/exit'));
  const inProg = [...(onb && !onb.error ? onb.rows.filter((r) => r.status !== 'done').map((r) => ({ ...r, k: 'onboarding', w: 'Joining' })) : []), ...(ex && !ex.error ? ex.rows.filter((r) => r.status !== 'settled').map((r) => ({ ...r, k: 'exit', w: 'Leaving' })) : [])];
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
    ${officeTop()}
    ${hrBanners()}
    ${group('Month end', monthCard, '', '<a href="#monthend">Open</a>')}
    ${group('Joining and leaving', inProg.length ? `<div class="card flush">${inProg.map((r) => lrow({ href: `#rec/${r.k}/${r.id}`, icon: r.k === 'exit' ? 'logout' : 'users', tone: r.k === 'exit' ? 'red' : 'green', title: r.title, sub: `${r.w}${r.data.joining_date ? ` · joins ${esc(fmtDate(r.data.joining_date, false))}` : r.data.last_day ? ` · last day ${esc(fmtDate(r.data.last_day, false))}` : ''}`, right: statusTag(r.status) })).join('')}</div>` : '<div class="card"><p class="empty">Nobody joining or leaving.</p></div>', '', '<a href="#rec/onboarding">All</a>')}`;
}

/* ---------------------------------------------------------------- director */
function directorDash() {
  const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - (5 - i)); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; });
  const reps = can('reports.view') ? months.map((m) => data(`reports:${m}`, () => api(`/api/reports/summary?month=${m}`))) : [];
  const ready = reps.length && reps.every((r) => r && !r.error);
  const attPct = (r) => { const t = r.attendance.reduce((a, x) => ({ p: a.p + x.P + x.H * 0.5, d: a.d + x.P + x.H + x.A }), { p: 0, d: 0 }); return t.d ? Math.round((t.p / t.d) * 100) : 0; };
  const series = (fn) => (ready ? reps.map(fn) : null);
  const last = ready ? reps[reps.length - 1] : null;
  const k = !reps.length ? '' : ready
    ? `<div class="kpis">
      ${kpi({ label: 'Headcount', value: fmtNum((KL.boot?.people || []).length), sub: 'everyone in the app', href: '#people' })}
      ${kpi({ label: 'Attendance', value: `${attPct(last)}%`, sub: 'present days, field staff', spark: series(attPct), href: '#attsum' })}
      ${kpi({ label: 'Biochar made', value: `${fmtNum(last.production.output)} kg`, sub: `${last.production.batches} batches`, spark: series((r) => r.production.output), href: '#carbon' })}
      ${kpi({ label: 'Expense claims', value: rupees(last.expenses.total), sub: `${rupees(last.expenses.approved)} approved`, spark: series((r) => r.expenses.total), href: '#rec/expense' })}
      ${kpi({ label: 'Open incidents', value: fmtNum(last.incidents.open), tone: last.incidents.open ? 'bad' : 'ok', sub: `${last.incidents.total} this month`, spark: series((r) => r.incidents.total), href: '#rec/incident' })}
    </div><p class="hint" style="margin-top:8px">Lines show the last six months.</p>`
    : reps.some((r) => r && r.error) ? errorBox(reps.find((r) => r && r.error).error) : spinner();
  return `${dashHead()}
    ${officeTop()}
    ${hrBanners()}
    ${k ? group('This month', k, '', '<a href="#dashboard">Dashboard</a>') : ''}`;
}

/* ---------------------------------------------------------------- unified approvals queue */
const AP_TYPES = { leave: 'Leave', trip: 'Travel', checkin: 'Check-in', expense: 'Expense', advance: 'Advance', purchase_request: 'Purchase', regularisation: 'Correction', farmer_payment: 'Farmer payment' };
/** Every request waiting for the signed-in person, normalised: { key, type, who, title, facts[], when, amount, image, decide: {action, kind, id, ok}, safe }. */
function approvalItems() {
  const a = data('approvals', () => api('/api/approvals'));
  const m = data('m-approvals', () => api('/api/m-approvals'));
  kinds();
  if (a === null || m === null) return null;
  if (a.error || m.error) return { error: (a.error || m.error) };
  const out = [];
  for (const t of a.trips) out.push({ ref: t.ref, key: `trips:${t.id}`, type: 'trip', who: t.user_name, title: `${t.vehicle} · ${fmtNum(t.km_claimed, 1)} km`, amount: t.amount, when: t.end_at,
    facts: [['Odometer', `${fmtNum(t.start_reading)} → ${fmtNum(t.end_reading)} km`], ['Straight line', t.km_straight !== null ? `${fmtNum(t.km_straight, 1)} km` : '–'], ['Purpose', t.purpose || '–']],
    images: [t.start_file, t.end_file], decide: { action: 'decide', kind: 'trips', id: t.id, ok: 'approved', okText: 'Approve' }, safe: true });
  for (const it of out) if (it.type === 'trip') { const t = a.trips.find((x) => `trips:${x.id}` === it.key); if ((t?.steps || []).length > 1) it.facts.push(['Chain', chainLine(t.steps)]); }
  for (const x of a.attendance) out.push({ ref: x.ref, key: `attendance:${x.id}`, type: 'checkin', who: x.user_name, title: `${x.site_name} · ${fmtNum(x.checkin_dist)} m outside`, when: x.checkin_at,
    facts: [['Allowed', `${x.radius_m} m`], ['Reason', x.override_reason || '–']], images: [x.checkin_file, x.checkout_file], decide: { action: 'decide', kind: 'attendance', id: x.id, ok: 'ok', okText: 'Accept' }, safe: true });
  for (const l of a.leaves) out.push({ ref: l.ref, key: `leaves:${l.id}`, type: 'leave', who: l.user_name, title: `${l.type} · ${fmtDate(l.from_date, false)}${l.to_date !== l.from_date ? ` to ${fmtDate(l.to_date, false)}` : ''}`, when: l.created_at,
    facts: [['Days', l.half ? `½ (${l.half === 'first' ? 'first half' : 'second half'})` : fmtNum(l.days || 0, 1)], ['Balance', l.balance && l.balance.available !== null ? `${fmtNum(l.balance.available, 1)} left` : '–'], ['Reason', l.reason || '–'], ...((l.steps || []).length > 1 ? [['Chain', chainLine(l.steps)]] : [])],
    decide: { action: 'decide', kind: 'leaves', id: l.id, ok: 'approved', okText: 'Approve' }, safe: (l.days || 0) <= 1 && (!l.balance || l.balance.available === null || l.balance.available >= (l.days || 0)) });
  for (const { step, kind, record: r } of m.rows) {
    const k = kindDef(kind);
    if (!k) continue;
    const amt = k.amount ? Number(r.data[k.amount]) || 0 : null;
    out.push({ ref: r.ref, key: `${kind}:${r.id}`, type: AP_TYPES[kind] ? kind : 'other', who: r.user_name, title: `${k.one}${r.title ? ` · ${r.title}` : ''}`, amount: amt, when: r.created_at,
      facts: [['Details', recSub(k, r)], ['Step', `${step.step} of ${(r.steps || []).length}`], ...k.fields.filter((f) => f.type === 'textarea' && r.data[f.key]).slice(0, 1).map((f) => [f.label, r.data[f.key]])],
      images: [r.file_id], open: `#rec/${kind}/${r.id}`, decide: { action: 'recDecide', kind, id: r.id, ok: 'approved', okText: 'Approve' }, safe: kind === 'regularisation' });
  }
  return out.sort((x, y) => String(x.when || '').localeCompare(String(y.when || '')));
}
const chainLine = (steps) => steps.map((s) => `${s.role_label || ROLE_TEXT[s.role] || s.role}${s.status === 'approved' ? ' ✓' : s.status === 'waiting' ? ' (now)' : ''}`).join(' → ');
function apCard(it, { select = false } = {}) {
  const d = it.decide;
  const sel = select && it.safe ? `<input type="checkbox" class="ap-sel" data-change="apSel" data-key="${esc(it.key)}" ${KL.ui.apSel?.has(it.key) ? 'checked' : ''} aria-label="Select for bulk approval" />` : '';
  return `<div class="card ap-card"><div class="ap-top">${sel}${avatar(it.who)}<div class="tx"><b>${esc(it.who)}</b><small>${tag(AP_TYPES[it.type] || 'Request', 'info')} ${esc(it.title)}</small>${refLine(it)}</div>${it.amount !== null && it.amount !== undefined ? `<b class="mono" style="font-size:16px">${esc(rupees(it.amount))}</b>` : ''}</div>
    <details class="ap-more"><summary>Details${it.when ? ` · ${esc(timeAgo(it.when))}` : ''}</summary><div class="ap-facts">${it.facts.filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `<span>${esc(k)}: <b>${String(v).includes('<') ? v : esc(v)}</b></span>`).join('')}</div></details>
    ${(it.images || []).filter(Boolean).length ? `<div class="row" style="gap:8px">${it.images.filter(Boolean).map((f) => authImg(f)).join('')}</div>` : ''}
    <div class="ap-act">${it.open ? `<a class="btn small" href="${esc(it.open)}">Open</a>` : ''}<button type="button" class="btn small" data-action="${d.action}" data-kind="${esc(d.kind)}" data-id="${esc(d.id)}" data-decision="rejected">Reject</button><button type="button" class="btn small primary" data-action="${d.action}" data-kind="${esc(d.kind)}" data-id="${esc(d.id)}" data-decision="${esc(d.ok)}">${esc(d.okText)}</button></div></div>`;
}
Views.approvals = () => {
  const items = approvalItems();
  const head = topbar('Approvals', isStaff() ? '#hr' : '#home');
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
    <p class="sub">Oldest first. Small, safe requests can be approved together; money requests one by one.</p>
    <div class="chips" role="group" aria-label="Filter by type"><button type="button" data-action="apType" data-type="" aria-pressed="${!type}">All · ${items.length}</button>${Object.entries(counts).map(([t, c]) => `<button type="button" data-action="apType" data-type="${esc(t)}" aria-pressed="${type === t}">${esc(AP_TYPES[t] || 'Other')} · ${c}</button>`).join('')}</div>
    ${safe.length ? `<div class="row" style="margin-top:12px;gap:8px;flex-wrap:wrap"><button type="button" class="btn small" data-action="apSelAll">${ic('check')} Select the safe ones (${safe.length})</button>${n ? `<button type="button" class="btn small ghost" data-action="apSelNone">Clear selection</button>` : ''}</div>` : ''}
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
