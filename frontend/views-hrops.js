/* HR operations (pay itself is in Zoho Payroll): month end with approve-and-lock and the Zoho export, the muster roll and
   leave register, the change log, crew muster by a supervisor, complaints with tracking codes and the POSH notice,
   the notice board with read receipts, and surveys with eNPS. Backend: backend/hrops.py. */

const monthName = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
function prevMonth() { const d = new Date(); const y = d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear(); const m = d.getMonth() === 0 ? 12 : d.getMonth(); return `${y}-${String(m).padStart(2, '0')}`; }
const hrRoleNow = () => ['admin', 'hr'].includes(KL.user.role);
const apiLink = (path, text, icon = 'download') => `<a class="btn small" href="${esc(path)}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(KL.token)}" download>${ic(icon)} ${esc(text)}</a>`;

/* ---------------------------------------------------------------- home banners: notices to accept, open surveys, month end, crew */
function hrBanners() {
  const w = data('hr:waiting', () => api('/api/hr/waiting'));
  if (!w || w.error) return '';
  const out = [];
  for (const n of w.important) out.push(`<a class="banner warn link-banner" href="#notice/${esc(n.id)}">${ic('bell')}<div><b>Please read: ${esc(n.title)}</b><p>Important notice · tap to read and confirm</p></div></a>`);
  for (const s of w.surveys) out.push(`<a class="banner info link-banner" href="#survey/${esc(s.id)}">${ic('chart')}<div><b>Survey: ${esc(s.title)}</b><p>Two minutes, anonymous</p></div></a>`);
  const lm = w.lastMonth;
  if (lm && !lm.locked && KL.user.role === 'manager' && !lm.reviewed) out.push(`<a class="banner info link-banner" href="#monthend/${esc(lm.month)}">${ic('calendar')}<div><b>Confirm ${esc(lm.label)} attendance for your team</b><p>HR locks the month and sends it to Zoho Payroll</p></div></a>`);
  if (lm && !lm.locked && hrRoleNow()) out.push(`<a class="banner info link-banner" href="#monthend/${esc(lm.month)}">${ic('lock')}<div><b>${esc(lm.label)} is not locked yet</b><p>Approve and lock it, then download the Zoho Payroll file</p></div></a>`);
  if (w.supervisor && !isStaff()) {
    const sites = (KL.boot?.mySites || []).filter((s) => s.project_type !== 'office');
    for (const s of sites) out.push(`<a class="banner link-banner" href="#muster/${esc(s.id)}">${ic('users')}<div><b>Crew attendance · ${esc(s.name)}</b><p>Mark the crew without phones: present, half day, absent, overtime</p></div></a>`);
  }
  return out.length ? `<div class="stack" style="margin-top:14px">${out.join('')}</div>` : '';
}

/* ---------------------------------------------------------------- month end */
Views.monthend = (arg) => {
  const month = /^\d{4}-\d{2}$/.test(arg || '') ? arg : prevMonth();
  const m = data(`hr:month:${month}`, () => api(`/api/hr/month/${month}`));
  const head = `${topbar('Month end', '#hr')}<p class="sub">Attendance and leave are approved and locked here once a month, then sent to Zoho Payroll (pay, PF, ESI, PT, LWF, TDS, Form 16 and salary payment are done in Zoho).</p>
    <div class="row" style="margin:6px 0 12px;flex-wrap:wrap"><input class="input" type="month" value="${esc(month)}" data-change="meMonth" style="max-width:220px" /></div>`;
  if (m === null) return `${head}${spinner()}`;
  if (m.error) return `${head}${errorBox(m.error)}`;
  const locked = m.status === 'locked';
  const status = locked
    ? `<div class="banner ok">${ic('lock')}<div><b>${esc(m.label)} is approved and locked</b><p>By ${esc(m.locked_by)} on ${esc(fmtDate(m.locked_at))}. Corrections, leave and muster for this month are blocked. The export below is the frozen copy.</p></div></div>`
    : m.over ? `<div class="banner warn">${ic('calendar')}<div><b>${esc(m.label)} is open</b><p>Sort out the items below, managers confirm their teams, then HR approves and locks.${m.unlock_reason ? ` Unlocked by ${esc(m.unlocked_by)}: ${esc(m.unlock_reason)}` : ''}</p></div></div>`
      : `<div class="banner info">${ic('clock')}<div><b>${esc(m.label)} is still running</b><p>Figures are a draft until the month is over and locked.</p></div></div>`;
  const checks = m.checks.length ? `<div class="card flush">${m.checks.map((c) => lrow({ href: c.link, icon: c.tone === 'bad' ? 'alert' : c.tone === 'warn' ? 'clock' : 'dot', tone: c.tone === 'bad' ? 'red' : c.tone === 'warn' ? 'amber' : '', title: c.text, sub: c.hint })).join('')}</div>`
    : `<div class="card"><p class="hint">${locked ? 'Locked.' : 'Nothing to sort out.'}</p></div>`;
  const mgrs = `<div class="card flush">${m.managers.map((x) => `<div class="lrow-static row">${avatar(x.name, 'sm')}<span class="tx" style="flex:1"><b>${esc(x.name)}</b><span class="muted" style="font-size:13px;display:block">${esc(x.designation || '')}${x.note ? ` · ${esc(x.note)}` : ''}</span></span>${x.reviewed_at ? tag(`confirmed ${fmtDate(x.reviewed_at, false)}`, 'ok') : tag('not yet', 'warn')}</div>`).join('')}</div>`;
  const myBtn = KL.user.role === 'manager' && !locked && m.over ? (m.iReviewed ? `<p class="hint" style="margin-top:8px">${ic('check')} You confirmed your team's month.</p>` : `<button type="button" class="btn primary wide" style="margin-top:10px" data-action="meReview" data-month="${esc(month)}">${ic('check')} My team's attendance is correct</button>`) : '';
  const lockBtn = m.canLock && !locked ? (m.over ? `<button type="button" class="btn primary wide" style="margin-top:12px" data-action="meLock" data-month="${esc(month)}">${ic('lock')} Approve and lock ${esc(m.label)}</button>` : '<p class="hint" style="margin-top:10px">The month can be locked once it is over.</p>') : '';
  const unlockBtn = locked && m.canUnlock ? `<button type="button" class="btn ghost wide" style="margin-top:8px" data-action="meUnlock" data-month="${esc(month)}">Unlock (director only, with a reason)</button>` : '';
  const sum = (k) => m.rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const downloads = `<div class="card stack">
      ${m.canLock ? `<div class="dl-list">${apiLink(`/api/hr/month/${month}/zoho.csv`, 'Zoho Payroll attendance (CSV)')}${apiLink(`/api/hr/month/${month}/zoho-lop.csv`, 'LOP days only (CSV)')}${apiLink(`/api/hr/month/${month}/export.json`, 'JSON for an API pull')}</div>
      <p class="hint">${locked ? '' : '<b>Draft:</b> the file says "No (draft)" until the month is locked. '}In Zoho Payroll, import the CSV into the pay run and match the columns once (Employee ID, Paid Days, LOP Days, Overtime Hours, leave). Advance recovery is an amount for Zoho to deduct.</p>` : ''}
      <div class="dl-list">${apiLink(`/api/hr/registers/muster/${month}.pdf`, 'Muster roll (PDF)')}${apiLink(`/api/hr/registers/muster/${month}.csv`, 'Muster roll (CSV)')}</div>
    </div>`;
  const table = `<div class="card flush att-grid-wrap"><table class="pay-table"><thead><tr><th>Employee</th><th>Paid days</th><th>LOP</th><th>Present</th><th>Half</th><th>Leave C/S/E/U</th><th>OT h</th><th>Late</th><th>Advance</th></tr></thead><tbody>${m.rows.map((r) => `<tr><td><a href="#attsum/${esc(r.user_id)}"><b>${esc(r.name)}</b></a><br><small class="muted">${esc(r.employee_id)}${r.by_supervisor ? ' · crew muster' : ''}${r.missed_checkout ? ` · ${r.missed_checkout} MC` : ''}</small></td><td><b>${fmtNum(r.paid_days, 1)}</b>/${r.days}</td><td>${r.lop_days ? `<b class="bad-text">${fmtNum(r.lop_days, 1)}</b>` : '0'}</td><td>${r.present}</td><td>${r.half_days}</td><td>${['Casual', 'Sick', 'Earned', 'Unpaid'].map((t) => fmtNum(r.leave[t], 1)).join(' / ')}</td><td>${fmtNum(r.ot_hours, 1)}</td><td>${r.late}</td><td>${r.advance_recovery ? rupees(r.advance_recovery) : '–'}</td></tr>`).join('')}</tbody></table></div>`;
  return `${head}${status}
    <div class="tiles auto" style="margin-top:14px"><div class="tile feature"><b>${num(m.rows.length, `me-n-${month}`)}</b><span>employees</span></div><div class="tile ok"><b>${fmtNum(sum('paid_days'), 1)}</b><span>paid days</span></div><div class="tile ${sum('lop_days') ? 'bad' : ''}"><b>${fmtNum(sum('lop_days'), 1)}</b><span>loss-of-pay days</span></div><div class="tile blue"><b>${fmtNum(sum('ot_hours'), 1)}</b><span>overtime hours</span></div></div>
    ${group('1 · Sort out before locking', checks)}
    ${group('2 · Managers confirm their teams', `${mgrs}${myBtn}`)}
    ${group('3 · HR approves and locks', `<div class="card"><p class="hint">Locking keeps a copy of every number below. After that nobody can change attendance or leave for ${esc(m.label)} until the director unlocks it with a reason; both are in the change log.</p>${lockBtn}${unlockBtn}${locked ? `<p class="hint" style="margin-top:8px">${ic('lock')} Locked.</p>` : ''}</div>`)}
    ${group('Downloads', downloads)}
    ${group(locked ? 'Locked figures' : 'Figures so far', table, '', `<a href="#changes">Change log</a>`)}`;
};
Changes.meMonth = (el) => { if (el.value) location.hash = `#monthend/${el.value}`; };
Actions.meReview = async (el) => {
  const v = await modal({ title: 'Confirm your team', message: 'You have checked the attendance of your people for this month (corrections and leave decided).', fields: [{ key: 'note', label: 'Note (optional)', placeholder: 'e.g. checked with site supervisors' }], confirmText: 'Confirm' });
  if (!v) return;
  try { await api(`/api/hr/month/${el.dataset.month}/review`, { json: v }); invalidate('hr:month', 'hr:waiting'); toast('Confirmed. HR is told.'); render(); } catch (e) { toast(e.message, 'error'); }
};
Actions.meLock = async (el) => {
  if (!(await modal({ title: `Approve and lock ${monthName(el.dataset.month)}?`, message: 'The figures are frozen and the Zoho Payroll file is final. Attendance and leave for the month can no longer be changed unless the director unlocks it.', confirmText: 'Approve and lock' }))) return;
  el.classList.add('busy');
  try { const r = await api(`/api/hr/month/${el.dataset.month}/lock`, { json: {} }); invalidate('hr:month', 'hr:waiting', 'hr:changes'); await celebrate('Month locked', `${r.count} employees. Download the file for Zoho Payroll.`); render(); } catch (e) { el.classList.remove('busy'); toast(e.message, 'error'); }
};
Actions.meUnlock = async (el) => {
  const v = await modal({ title: 'Unlock the month?', message: 'Managers will have to confirm again and HR lock again. If Zoho Payroll already ran, correct it there too.', fields: [{ key: 'reason', label: 'Why', type: 'textarea' }], confirmText: 'Unlock', danger: true });
  if (!v) return;
  try { await api(`/api/hr/month/${el.dataset.month}/unlock`, { json: v }); invalidate('hr:month', 'hr:changes'); toast('Unlocked'); render(); } catch (e) { toast(e.message, 'error'); }
};

/* ---------------------------------------------------------------- registers */
Views.hrreg = () => {
  const month = F('rg-month', prevMonth());
  const year = F('rg-year', String(new Date().getFullYear()));
  const site = F('rg-site', '');
  const sites = (KL.boot?.mySites || []).filter((s) => s.project_type !== 'office');
  const q = site ? `?siteId=${site}` : '';
  return `${topbar('Registers', '#hr')}<p class="sub">To print or download for inspections, audits and disputes.</p>
    ${group('Muster roll (monthly attendance register)', `<div class="card stack"><div class="grid2">${field('Month', `<input class="input" type="month" value="${esc(month)}" data-change="form" data-key="rg-month" />`)}${field('Site', select('rg-site', site, sites.map((s) => [s.id, s.name]), { blank: 'All my sites and staff' }))}</div>
      <div class="btns" style="flex-wrap:wrap">${apiLink(`/api/hr/registers/muster/${month}.pdf${q}`, 'PDF to print')}${apiLink(`/api/hr/registers/muster/${month}.csv${q}`, 'CSV (Excel)')}</div>
      <p class="hint">Every employee, every day: P, H, L, A, WO, HO, MC, with paid days, loss-of-pay days and overtime. Crew marked by a supervisor and contract workers on the crew muster are included.</p></div>`)}
    ${group('Leave register', `<div class="card stack">${field('Year', input('rg-year', year, { type: 'number', inputmode: 'numeric' }))}
      <div class="btns" style="flex-wrap:wrap">${apiLink(`/api/hr/registers/leave/${year}.pdf`, 'PDF to print')}${apiLink(`/api/hr/registers/leave/${year}.csv`, 'CSV (Excel)')}</div>
      <p class="hint">Per employee and leave type: opening, accrued, taken, pending and balance, with every leave and its status.</p></div>`)}
    ${group('Also', `<div class="card flush">${lrow({ href: '#rec/labour', icon: 'users', title: 'Contract labour register', sub: 'Workers, contractor, days and wages' })}${lrow({ href: '#changes', icon: 'clock', title: 'Change log', sub: 'Who changed attendance, leave or balances, old and new value' })}${lrow({ href: '#monthend', icon: 'lock', title: 'Month end', sub: 'Approve, lock and export to Zoho Payroll' })}</div>`)}`;
};

/* ---------------------------------------------------------------- change log */
const CH_ENTITY = { '': 'Everything', attendance: 'Attendance', leave: 'Leave', leave_balance: 'Leave balances', regularisation: 'Corrections', attendance_month: 'Month end', employee: 'Employee record', assignment: 'Sites', settings: 'Settings' };
Views.changes = (arg) => {
  const subject = arg || (isStaff() ? '' : 'me');
  const ent = F('ch-ent', '');
  const c = data(`hr:changes:${subject}:${ent}`, () => api(`/api/hr/changes?subject=${encodeURIComponent(subject)}&entity=${ent}`));
  const who = subject && subject !== 'me' ? personName(subject) : subject === 'me' ? 'Changes to my records' : 'Change log';
  const head = `${topbar(subject && subject !== 'me' ? `Changes · ${who}` : who, subject === 'me' ? '#me' : subject ? `#person/${subject}` : '#hr', hrRoleNow() ? apiLink(`/api/hr/changes.csv?subject=${encodeURIComponent(subject === 'me' ? KL.user.id : subject)}&entity=${ent}`, 'CSV') : '')}
    <p class="sub">Every change to attendance, leave, balances, corrections, assignments and HR settings: who, when, the old and new value and the reason. Nothing here can be edited or deleted.</p>
    <div class="chips" style="margin:8px 0 12px">${Object.entries(CH_ENTITY).map(([k, l]) => `<button type="button" data-action="chEnt" data-ent="${k}" aria-pressed="${ent === k}">${esc(l)}</button>`).join('')}</div>`;
  if (c === null) return `${head}${spinner()}`;
  if (c.error) return `${head}${errorBox(c.error)}`;
  if (!c.rows.length) return `${head}${emptyState('clock', 'No changes yet')}`;
  return `${head}<div class="card flush">${c.rows.map((x) => `<div class="lrow-static change-row"><div class="row between" style="gap:8px"><b>${esc(x.field || x.entity)}</b><small class="muted">${esc(fmtDate(x.at))}</small></div>
    <div class="change-vals">${x.old ? `<span class="old">${esc(x.old)}</span>${ic('chevron')}` : ''}<span class="new">${esc(x.new || '(empty)')}</span></div>
    <small class="muted">${esc(CH_ENTITY[x.entity] || x.entity)}${x.subject_name && !arg ? ` · ${esc(x.subject_name)}` : ''} · by ${esc(x.by_name || 'system')}${x.reason ? ` · “${esc(x.reason)}”` : ''}</small></div>`).join('')}</div>`;
};
Actions.chEnt = (el) => { setF('ch-ent', el.dataset.ent); render(); };

/* ---------------------------------------------------------------- crew muster (supervisor marks people without phones) */
Views.muster = (sid) => {
  const day = F('mu-day', todayISO());
  const site = siteById(sid);
  const back = `#site/${sid}/team`;
  const m = data(`muster:${sid}:${day}`, () => api(`/api/muster/${sid}?day=${day}`));
  const head = `${topbar('Crew attendance', back)}<p class="sub">${esc(site?.name || '')} · for the crew without phones. People who check in on their own phone are shown, not marked.</p>
    <div class="row" style="margin:6px 0 12px"><input class="input" type="date" value="${esc(day)}" max="${esc(todayISO())}" data-change="muDay" style="max-width:200px" /></div>`;
  if (m === null) return `${head}${spinner()}`;
  if (m.error) return `${head}${errorBox(m.error)}`;
  const key = `${sid}:${day}`;
  if (KL.ui.muKey !== key) {
    KL.ui.muKey = key;
    KL.ui.mu = { codes: Object.fromEntries(m.people.filter((p) => !p.locked).map((p) => [p.id, p.code || ''])), ot: Object.fromEntries(m.people.map((p) => [p.id, p.ot || 0])), workers: m.workers.map((w) => ({ ...w })) };
    clearPhotos('muster');
  }
  const mu = KL.ui.mu;
  const seg = (id, cur, act = 'muCode') => `<div class="seg mu-seg">${[['P', 'Present'], ['H', 'Half'], ['A', 'Absent']].map(([c, l]) => `<button type="button" data-action="${act}" data-id="${esc(id)}" data-code="${c}" aria-pressed="${cur === c}" class="mu-${c}">${l}</button>`).join('')}</div>`;
  const marked = Object.values(mu.codes).filter(Boolean).length + mu.workers.filter((w) => w.code).length;
  const total = Object.keys(mu.codes).length + mu.workers.length;
  if (m.locked) return `${head}<div class="banner ok">${ic('lock')}<div><b>${esc(monthName(day.slice(0, 7)))} is locked</b><p>Attendance for this day was sent to Zoho Payroll. Ask HR to unlock it to change anything.</p></div></div>`;
  return `${head}
    ${m.sheet ? `<div class="banner info">${ic('check')}<div><b>Marked by ${esc(m.sheet.by)}</b><p>${esc(fmtDate(m.sheet.at))}. Changing it is recorded in the change log.</p></div></div>` : ''}
    ${group('Crew photo at the site', `${m.sheet?.file_id && !KL.ui.photos.muster ? `<div class="photo has">${authImg(m.sheet.file_id, '')}</div><button type="button" class="btn small" style="margin-top:8px" data-action="photo" data-slot="muster" data-facing="environment" data-kind="field" data-stamp="[]">${ic('camera')} Retake</button>` : photoBox('muster', 'One photo of the crew at the site', 'environment', [site?.name || '', 'Crew muster'])}`)}
    ${group(`Employees (${m.people.length})`, `<div class="card flush">${m.people.map((p) => `<div class="lrow-static mu-row"><div class="row" style="gap:10px">${avatar(p.name, 'sm')}<span class="tx" style="flex:1;min-width:0"><b>${esc(p.name)}</b><span class="muted" style="font-size:13px;display:block">${esc(p.designation || '')}${p.app_access ? '' : ' · no phone'}</span></span></div>
      ${p.locked ? `<div class="mu-locked">${tag(p.lockText, p.locked === 'own' ? 'ok' : p.locked === 'phone' ? '' : 'info')}</div>` : `<div class="row mu-ctl">${seg(p.id, mu.codes[p.id])}<label class="mu-ot">OT <input class="input" type="number" inputmode="decimal" min="0" max="12" step="0.5" value="${esc(mu.ot[p.id] || '')}" data-input="muOt" data-id="${esc(p.id)}" /></label></div>`}</div>`).join('') || '<p class="empty">Nobody works at this site.</p>'}</div>
      <button type="button" class="btn small" style="margin-top:8px" data-action="muAll">${ic('check')} Mark everyone not yet marked present</button>`)}
    ${group(`Contract workers (${mu.workers.length})`, `<div class="card flush">${mu.workers.map((w, i) => `<div class="lrow-static mu-row"><div class="row between"><span class="tx"><b>${esc(w.name)}</b><span class="muted" style="font-size:13px;display:block">${esc(w.contractor || 'no contractor')}</span></span><button type="button" class="btn ghost icon-only small" data-action="muWorkerDel" data-i="${i}" aria-label="Remove">${ic('x')}</button></div><div class="row mu-ctl">${seg(String(i), w.code, 'muWorker')}</div></div>`).join('') || '<p class="empty" style="padding:12px">None today.</p>'}</div>
      <div class="grid2" style="margin-top:8px">${field('Name', input('mu-wname', F('mu-wname'), { placeholder: 'Worker name' }))}${field('Contractor', input('mu-wcon', F('mu-wcon', mu.workers[0]?.contractor || ''), { placeholder: 'Labour contractor' }))}</div>
      <button type="button" class="btn small" data-action="muWorkerAdd">${ic('plus')} Add contract worker</button>`)}
    <button type="button" class="btn primary wide" style="margin-top:16px" data-action="muSave" data-site="${esc(sid)}">${ic('check')} Save crew attendance · ${marked} of ${total} marked</button>
    ${group('Recent days', m.recent.length ? `<div class="card flush">${m.recent.map((r) => `<div class="lrow-static row"><span class="tx" style="flex:1"><b>${esc(fmtDate(r.date, false))}</b><span class="muted" style="font-size:13px;display:block">by ${esc(r.by_name || '')}</span></span>${tag(`${r.present} present`, 'ok')}</div>`).join('')}</div>` : '<div class="card"><p class="hint">Nothing marked yet.</p></div>')}`;
};
Changes.muDay = (el) => { setF('mu-day', el.value || todayISO()); render(); };
Actions.muCode = (el) => { KL.ui.mu.codes[el.dataset.id] = el.dataset.code; render(); };
Actions.muWorker = (el) => { KL.ui.mu.workers[Number(el.dataset.id)].code = el.dataset.code; render(); };
Actions.muWorkerDel = (el) => { KL.ui.mu.workers.splice(Number(el.dataset.i), 1); render(); };
Actions.muWorkerAdd = () => {
  const name = F('mu-wname', '').trim();
  if (!name) return toast('Type the worker name', 'error');
  KL.ui.mu.workers.push({ name, contractor: F('mu-wcon', '').trim(), code: 'P', ot: 0 }); clearF('mu-wname'); render();
};
Actions.muAll = () => { for (const k of Object.keys(KL.ui.mu.codes)) if (!KL.ui.mu.codes[k]) KL.ui.mu.codes[k] = 'P'; for (const w of KL.ui.mu.workers) if (!w.code) w.code = 'P'; render(); };
Inputs.muOt = (el) => { KL.ui.mu.ot[el.dataset.id] = el.value; };
Actions.muSave = async (el) => {
  const mu = KL.ui.mu;
  const missing = Object.values(mu.codes).filter((c) => !c).length + mu.workers.filter((w) => !w.code).length;
  if (missing) return toast(`${missing} not marked yet: choose Present, Half or Absent`, 'error');
  const day = F('mu-day', todayISO());
  const m = KL.cache[`muster:${el.dataset.site}:${day}`];
  let reason = '';
  if (m?.sheet) { const v = await modal({ title: 'Change a marked day?', message: 'The old and new marks go in the change log.', fields: [{ key: 'reason', label: 'Why is it changing?' }], confirmText: 'Save' }); if (!v) return; reason = v.reason; }
  const g = KL.ui.gps;
  el.classList.add('busy');
  try {
    const r = await submitEvidence(`/api/muster/${el.dataset.site}`, { date: day, lines: JSON.stringify(Object.entries(mu.codes).map(([user_id, code]) => ({ user_id, code, ot: mu.ot[user_id] || 0 }))), workers: JSON.stringify(mu.workers), lat: g ? g.lat : '', lng: g ? g.lng : '', reason },
      photoFile('muster', 'crew photo.jpg'), 'Crew attendance');
    KL.ui.muKey = null; clearPhotos('muster'); invalidate('muster', 'hr:attsum', 'hr:month');
    if (!r.queued) await celebrate('Crew attendance saved', `${r.count} people marked. It counts in the month summary and the Zoho export.`);
    render();
  } catch (e) { el.classList.remove('busy'); toast(e.message, 'error'); }
};

/* ---------------------------------------------------------------- notice board */
const audienceOptions = () => {
  const opts = [];
  if (hrRoleNow()) opts.push(['all:', 'Everyone']);
  for (const [k, p] of Object.entries(projectsMeta())) if (hrRoleNow() || (KL.user.projects || []).includes(k)) opts.push([`project:${k}`, `${p.name} (whole project)`]);
  for (const s of (KL.boot?.mySites || []).filter((x) => x.project_type !== 'office')) opts.push([`site:${s.id}`, s.name]);
  return opts;
};
const parseAud = (v) => { const [type, value] = String(v || 'all:').split(':'); return value ? { type, value } : { type: 'all' }; };
Views.notices = () => {
  const n = data('notices', () => api('/api/notices'));
  const back = isStaff() ? '#hr' : '#me';
  if (n === null) return `${topbar('Notice board', back)}${spinner()}`;
  if (n.error) return `${topbar('Notice board', back)}${errorBox(n.error)}`;
  return `${topbar('Notice board', back, n.canPost ? `<a class="btn small primary" href="#noticenew">${ic('plus')} New</a>` : '')}
    <p class="sub">Company and site announcements. Important ones ask you to confirm you have read them.</p>
    ${n.rows.length ? `<div class="stack">${n.rows.map((x) => `<a class="card notice-card ${x.read ? '' : 'unread'}" href="#notice/${esc(x.id)}"><div class="row between" style="gap:8px"><b>${x.pinned ? `${ic('flag')} ` : ''}${esc(x.title)}</b>${x.important ? tag(x.acked ? 'confirmed' : 'important', x.acked ? 'ok' : 'warn') : x.read ? '' : tag('new', 'info')}</div><p class="hint clamp2">${esc(x.body)}</p><small class="muted">${esc(x.audienceText)} · ${esc(x.by)} · ${esc(timeAgo(x.created_at))}${x.total !== undefined ? ` · read ${x.readCount}/${x.total}` : ''}</small></a>`).join('')}</div>` : emptyState('bell', 'No notices', 'Announcements from HR and managers appear here.')}`;
};
Views.notice = (id) => {
  const n = data(`notice:${id}`, () => api(`/api/notices/${id}`).then((r) => { invalidate('notices', 'hr:waiting'); refreshMe(); return r; }));
  if (n === null) return `${topbar('Notice', '#notices')}${spinner()}`;
  if (n.error) return `${topbar('Notice', '#notices')}${errorBox(n.error)}`;
  const rc = n.receipts;
  return `${topbar('Notice', '#notices', n.canManage ? `<button type="button" class="btn small ghost" data-action="noticeDel" data-id="${esc(id)}">${ic('trash')}</button>` : '')}
    <div class="card stack"><div class="row between" style="gap:8px"><h2 style="margin:0">${esc(n.title)}</h2>${n.important ? tag('important', 'warn') : ''}</div>
      <p style="white-space:pre-wrap;margin:0">${esc(n.body)}</p><small class="muted">${esc(n.audienceText)} · ${esc(n.by)} · ${esc(fmtDate(n.created_at))}</small>
      ${n.important && n.forMe ? (n.acked ? `<div class="banner ok">${ic('check')}<div><b>You confirmed you have read this</b></div></div>` : `<button type="button" class="btn primary wide" data-action="noticeAck" data-id="${esc(id)}">${ic('check')} I have read and understood this</button>`) : ''}
    </div>
    ${rc ? group(`Read receipts · ${n.readCount} of ${n.total} read${n.important ? `, ${n.ackCount} confirmed` : ''}`, `<div class="progress" style="margin-bottom:10px"><i style="width:${n.total ? (n.readCount / n.total) * 100 : 0}%"></i></div>
      <div class="card flush">${rc.map((r) => `<div class="lrow-static row">${avatar(r.name, 'sm')}<span class="tx" style="flex:1;min-width:0"><b>${esc(r.name)}</b><span class="muted" style="font-size:13px;display:block">${esc(r.designation || '')}</span></span>${r.ack_at ? tag(`confirmed ${timeAgo(r.ack_at)}`, 'ok') : r.read_at ? tag(`read ${timeAgo(r.read_at)}`, n.important ? 'warn' : 'ok') : tag('not read', 'bad')}</div>`).join('')}</div>
      ${n.canManage && rc.some((r) => !r.read_at || (n.important && !r.ack_at)) ? `<button type="button" class="btn wide" style="margin-top:10px" data-action="noticeRemind" data-id="${esc(id)}">${ic('bell')} Remind those who have not ${n.important ? 'confirmed' : 'read it'}</button>` : ''}`) : ''}`;
};
Views.noticenew = () => `${topbar('New notice', '#notices')}
  <div class="card stack">
    ${field('Title', input('nt-title', F('nt-title'), { placeholder: 'e.g. Site closed on Saturday' }))}
    ${field('Notice', textarea('nt-body', F('nt-body'), 'What everyone needs to know'))}
    ${field('Who sees it', select('nt-aud', F('nt-aud', audienceOptions()[0]?.[0] || ''), audienceOptions()))}
    <label class="check"><input type="checkbox" ${F('nt-imp') ? 'checked' : ''} data-change="ntFlag" data-key="nt-imp" /> <span>Important: everyone must confirm they have read it</span></label>
    <label class="check"><input type="checkbox" ${F('nt-pin') ? 'checked' : ''} data-change="ntFlag" data-key="nt-pin" /> <span>Pin to the top</span></label>
    ${field('Show until (optional)', `<input class="input" type="date" value="${esc(F('nt-exp'))}" data-change="form" data-key="nt-exp" />`)}
    <button type="button" class="btn primary wide" data-action="noticePost">${ic('send')} Post and notify</button>
    <p class="hint">Everyone in the audience gets it in their inbox (and on WhatsApp in the live app). You see who has read it.</p>
  </div>`;
Changes.ntFlag = (el) => setF(el.dataset.key, el.checked);
Actions.noticePost = async () => {
  try {
    const r = await api('/api/notices', { json: { title: F('nt-title', ''), body: F('nt-body', ''), audience: parseAud(F('nt-aud', audienceOptions()[0]?.[0])), important: Boolean(F('nt-imp')), pinned: Boolean(F('nt-pin')), expires_on: F('nt-exp', '') } });
    clearF('nt-title', 'nt-body', 'nt-imp', 'nt-pin', 'nt-exp'); invalidate('notices'); toast('Posted'); location.hash = `#notice/${r.id}`;
  } catch (e) { toast(e.message, 'error'); }
};
Actions.noticeAck = async (el) => { try { await api(`/api/notices/${el.dataset.id}/ack`, { json: {} }); invalidate('notice', 'notices', 'hr:waiting'); toast('Thank you'); render(); } catch (e) { toast(e.message, 'error'); } };
Actions.noticeRemind = async (el) => { try { const r = await api(`/api/notices/${el.dataset.id}/remind`, { json: {} }); toast(`${r.count} reminded`); } catch (e) { toast(e.message, 'error'); } };
Actions.noticeDel = async (el) => {
  if (!(await modal({ title: 'Delete this notice?', confirmText: 'Delete', danger: true }))) return;
  try { await api(`/api/notices/${el.dataset.id}/delete`, { json: {} }); invalidate('notices'); location.hash = '#notices'; } catch (e) { toast(e.message, 'error'); }
};

/* ---------------------------------------------------------------- surveys and eNPS */
Views.surveys = () => {
  const s = data('surveys', () => api('/api/surveys'));
  const back = isStaff() ? '#hr' : '#me';
  if (s === null) return `${topbar('Surveys', back)}${spinner()}`;
  if (s.error) return `${topbar('Surveys', back)}${errorBox(s.error)}`;
  return `${topbar('Surveys', back, s.canCreate ? `<a class="btn small primary" href="#surveynew">${ic('plus')} New</a>` : '')}
    <p class="sub">Short surveys from HR, including eNPS: how likely you are to recommend working here. Answers are anonymous unless the survey says otherwise.</p>
    ${s.rows.length ? `<div class="card flush">${s.rows.map((x) => lrow({ href: `#survey/${x.id}`, icon: x.questions.some((q) => q.type === 'enps') ? 'chart' : 'list', tone: x.mine && !x.done && !x.closed ? 'amber' : '', title: x.title,
      sub: `${x.closed ? 'Closed' : x.closes_on ? `Open until ${fmtDate(x.closes_on, false)}` : 'Open'} · ${x.anonymous ? 'anonymous' : 'named'}${x.responses !== undefined ? ` · ${x.responses} of ${x.invited} answered` : ''}`,
      right: x.done ? tag('answered', 'ok') : x.mine && !x.closed ? tag('to do', 'warn') : '' })).join('')}</div>` : emptyState('chart', 'No surveys yet')}`;
};
function enpsGauge(e) {
  if (!e || e.score === null) return '<p class="hint">No answers.</p>';
  const tone = e.score >= 30 ? 'ok' : e.score >= 0 ? 'warn' : 'bad';
  const top = Math.max(1, ...e.dist);
  return `<div class="enps"><div class="enps-score ${tone}"><b>${e.score > 0 ? '+' : ''}${e.score}</b><span>eNPS</span></div><div class="enps-split"><span class="ok-text">${e.promoters} promoters (9–10)</span><span class="muted">${e.passives} passive (7–8)</span><span class="bad-text">${e.detractors} detractors (0–6)</span></div></div>
    <div class="chart enps-dist">${e.dist.map((v, i) => `<div class="bar ${i >= 9 ? 'pro' : i <= 6 ? 'det' : ''}" title="${i}: ${v}"><i style="height:${(v / top) * 100}%"></i><small>${i}</small></div>`).join('')}</div>`;
}
Views.survey = (id) => {
  const s = data(`survey:${id}`, () => api(`/api/surveys/${id}`));
  if (s === null) return `${topbar('Survey', '#surveys')}${spinner()}`;
  if (s.error) return `${topbar('Survey', '#surveys')}${errorBox(s.error)}`;
  const canAnswer = s.mine && !s.done && !s.closed;
  const answers = F(`sv-${id}`, {});
  const form = canAnswer ? `<div class="stack">${s.questions.map((q, i) => `<div class="card stack"><b>${i + 1}. ${esc(q.text)}</b>${q.type === 'enps'
    ? `<div class="scale11">${Array.from({ length: 11 }, (_, k) => `<button type="button" data-action="svAns" data-id="${esc(id)}" data-q="${i}" data-v="${k}" aria-pressed="${String(answers[i]) === String(k)}" class="${k >= 9 ? 'pro' : k <= 6 ? 'det' : ''}">${k}</button>`).join('')}</div><div class="row between"><small class="muted">Not at all likely</small><small class="muted">Very likely</small></div>`
    : q.type === 'rating' ? `<div class="seg">${[1, 2, 3, 4, 5].map((k) => `<button type="button" data-action="svAns" data-id="${esc(id)}" data-q="${i}" data-v="${k}" aria-pressed="${String(answers[i]) === String(k)}">${k}</button>`).join('')}</div><div class="row between"><small class="muted">Disagree</small><small class="muted">Agree</small></div>`
      : q.type === 'choice' ? `<div class="chips">${q.options.map((o) => `<button type="button" data-action="svAns" data-id="${esc(id)}" data-q="${i}" data-v="${esc(o)}" aria-pressed="${answers[i] === o}">${esc(o)}</button>`).join('')}</div>`
        : `<textarea class="input" data-input="svText" data-id="${esc(id)}" data-q="${i}" placeholder="Optional">${esc(answers[i] || '')}</textarea>`}</div>`).join('')}
    <button type="button" class="btn primary wide" data-action="svSend" data-id="${esc(id)}">${ic('send')} Send answers</button></div>` : '';
  const res = s.results;
  const results = res ? (res.hidden ? `<div class="card"><p class="hint">${res.n} answer${res.n === 1 ? '' : 's'} so far. Results show from ${s.minResponses} answers so nobody can be identified.</p></div>`
    : `<div class="stack">${res.questions.map((r, i) => `<div class="card"><b class="card-title">${i + 1}. ${esc(r.q.text)}</b>${r.q.type === 'enps' ? `${enpsGauge(r.enps)}${Object.keys(r.byProject || {}).length ? `<div class="kv" style="margin-top:10px">${Object.entries(r.byProject).map(([p, v]) => `<span>${esc(p)}</span><span>${v > 0 ? '+' : ''}${v}</span>`).join('')}</div>` : ''}`
      : r.q.type === 'rating' ? `<div class="row" style="gap:14px;margin-top:8px"><b style="font-size:28px;font-family:var(--font)">${fmtNum(r.avg, 1)}</b><span class="hint">average of 5 · ${r.n} answers</span></div><div class="stack" style="margin-top:8px;gap:6px">${r.dist.map((v, k) => `<div class="row" style="gap:8px"><small style="width:12px">${k + 1}</small><div class="progress" style="flex:1"><i style="width:${r.n ? (v / r.n) * 100 : 0}%"></i></div><small class="muted" style="width:20px">${v}</small></div>`).join('')}</div>`
        : r.q.type === 'choice' ? `<div class="stack" style="margin-top:8px;gap:6px">${Object.entries(r.counts).map(([o, v]) => `<div><div class="row between" style="font-size:14px;font-weight:700"><span>${esc(o)}</span><span>${v}</span></div><div class="progress"><i style="width:${r.n ? (v / r.n) * 100 : 0}%"></i></div></div>`).join('')}</div>`
          : r.comments.filter(Boolean).length ? `<div class="stack" style="margin-top:8px;gap:6px">${r.comments.filter(Boolean).map((c) => `<p class="quote">${esc(c)}</p>`).join('')}</div>` : '<p class="hint">No comments.</p>'}</div>`).join('')}</div>`) : '';
  return `${topbar(s.title, '#surveys', s.canManage && !s.closed ? `<button type="button" class="btn small" data-action="svClose" data-id="${esc(id)}">Close</button>` : '')}
    <p class="sub">${esc(s.intro || '')}</p>
    <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:12px">${tag(s.anonymous ? 'anonymous' : 'named', s.anonymous ? 'ok' : 'warn')}${tag(s.audienceText)}${tag(s.closed ? 'closed' : s.closes_on ? `open until ${fmtDate(s.closes_on, false)}` : 'open', s.closed ? '' : 'info')}${s.responses !== undefined ? tag(`${s.responses} of ${s.invited} answered`) : ''}</div>
    ${s.done ? `<div class="banner ok">${ic('check')}<div><b>Thank you, your answers are in</b><p>${s.anonymous ? 'They are kept without your name.' : ''}</p></div></div>` : ''}
    ${!s.mine && !s.canManage ? '' : form}
    ${res ? group('Results', results) : ''}`;
};
Actions.svAns = (el) => { const k = `sv-${el.dataset.id}`; setF(k, { ...F(k, {}), [el.dataset.q]: el.dataset.v }); render(); };
Inputs.svText = (el) => { const k = `sv-${el.dataset.id}`; KL.ui.forms[k] = { ...F(k, {}), [el.dataset.q]: el.value }; };
Actions.svSend = async (el) => {
  try { await api(`/api/surveys/${el.dataset.id}/respond`, { json: { answers: F(`sv-${el.dataset.id}`, {}) } }); clearF(`sv-${el.dataset.id}`); invalidate('survey', 'surveys', 'hr:waiting'); await celebrate('Thank you', 'Your answers are in.'); render(); } catch (e) { toast(e.message, 'error'); }
};
Actions.svClose = async (el) => { try { await api(`/api/surveys/${el.dataset.id}/close`, { json: {} }); invalidate('survey', 'surveys'); render(); } catch (e) { toast(e.message, 'error'); } };
const SURVEY_TEMPLATES = {
  enps: { title: 'eNPS', intro: 'Anonymous. HR sees only totals, and only when at least 3 people have answered.', questions: 'enps | How likely are you to recommend working here to a friend?\nrating | I have what I need to do my job safely\nrating | My manager listens when I raise a problem\ntext | One thing we should change' },
  site: { title: 'Site facilities pulse', intro: 'Quick questions about your site. Anonymous.', questions: 'rating | Drinking water and shade at my site are enough\nrating | Toilets at my site are clean\nchoice | Safety kit is | Complete and good; Some items missing; Worn out\ntext | Anything else about your site' },
};
Views.surveynew = () => `${topbar('New survey', '#surveys')}
  <div class="card stack">
    <div class="row" style="gap:6px;flex-wrap:wrap"><span class="hint">Start from:</span>${Object.entries(SURVEY_TEMPLATES).map(([k, t]) => `<button type="button" class="btn small" data-action="svTpl" data-k="${k}">${esc(t.title)}</button>`).join('')}</div>
    ${field('Title', input('sn-title', F('sn-title')))}
    ${field('Introduction', textarea('sn-intro', F('sn-intro')))}
    ${field('Questions, one per line: type | question (| options; separated; by semicolons for choice). Types: enps, rating, choice, text', textarea('sn-q', F('sn-q'), 'enps | How likely are you to recommend working here to a friend?'))}
    <div class="grid2">${field('Who answers', select('sn-aud', F('sn-aud', 'all:'), audienceOptions()))}${field('Closes on', `<input class="input" type="date" value="${esc(F('sn-close'))}" data-change="form" data-key="sn-close" />`)}</div>
    <label class="check"><input type="checkbox" ${F('sn-anon', true) ? 'checked' : ''} data-change="ntFlag" data-key="sn-anon" /> <span>Anonymous (recommended): answers are kept without names; results show from 3 answers</span></label>
    <button type="button" class="btn primary wide" data-action="svCreate">${ic('send')} Send the survey</button>
  </div>`;
Actions.svTpl = (el) => { const t = SURVEY_TEMPLATES[el.dataset.k]; setF('sn-title', `${t.title} · ${monthName(todayISO().slice(0, 7))}`); setF('sn-intro', t.intro); setF('sn-q', t.questions); render(); };
Actions.svCreate = async () => {
  const questions = F('sn-q', '').split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((p) => p[0] && p[1]).map(([type, text, opts]) => ({ type, text, options: (opts || '').split(';').map((o) => o.trim()).filter(Boolean) }));
  try {
    const r = await api('/api/surveys', { json: { title: F('sn-title', ''), intro: F('sn-intro', ''), questions, anonymous: Boolean(F('sn-anon', true)), audience: parseAud(F('sn-aud', 'all:')), closes_on: F('sn-close', '') } });
    clearF('sn-title', 'sn-intro', 'sn-q', 'sn-close'); invalidate('surveys'); toast('Survey sent'); location.hash = `#survey/${r.id}`;
  } catch (e) { toast(e.message, 'error'); }
};

/* ---------------------------------------------------------------- complaints, tracking codes, POSH */
function poshCard(p, open = false) {
  if (!p || p.error) return '';
  const ic_ = (p.committee || []).map((m) => `<div class="row" style="gap:10px">${avatar(m.name, 'sm')}<span class="tx"><b style="font-size:14px">${esc(m.name)}</b><span class="muted" style="font-size:12.5px;display:block">${esc(m.role)}${m.phone ? ` · ${esc(m.phone)}` : ''}</span></span></div>`).join('');
  return `<details class="card posh-card" ${open ? 'open' : ''}><summary><span class="icon violet">${ic('shield')}</span><span><b>Prevention of sexual harassment (POSH)</b><small class="muted" style="display:block">The Internal Committee, how to complain, your protection</small></span></summary>
    <div class="stack" style="margin-top:10px">
      <p>Sexual harassment at work is not allowed. Under the Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013, the company has an <b>Internal Committee (IC)</b>.</p>
      <ul class="posh-list">
        <li><b>Where it applies:</b> the office, every site, company vehicles, farm visits and work trips.</li>
        <li><b>How to complain:</b> in writing to the IC within 3 months of the incident (the IC can allow 3 more months). Choose "Sexual harassment (POSH)" above, or contact a member directly${p.email ? ` or write to <b>${esc(p.email)}</b>` : ''}.</li>
        <li><b>What happens:</b> conciliation only if you ask for it; otherwise the IC inquires and finishes within 90 days. You can ask for relief while it inquires, such as a transfer or leave.</li>
        <li><b>Confidential:</b> your name and the details stay with the IC. Nobody may be punished for complaining or for being a witness.</li>
        <li><b>Against the employer:</b> ${esc(p.local_committee || 'the Local Committee of the district')}.</li>
      </ul>
      <b style="font-size:14px">Internal Committee</b>${ic_ || '<p class="hint">HR has not named the committee yet.</p>'}
    </div></details>`;
}
function fbThread(rows) {
  return rows && rows.length ? `<div class="thread">${rows.map((m) => `<div class="msg ${m.from_hr ? 'hr' : 'me'}"><small>${m.from_hr ? esc(m.by_name || 'HR') : 'Sender'} · ${esc(timeAgo(m.at))}</small><p>${esc(m.text)}</p></div>`).join('')}</div>` : '';
}
Views.feedback = () => {
  const list = data('feedback:mine', () => api('/api/feedback'));
  const posh = data('hr:posh', () => api('/api/hr/posh'));
  const type = F('fb-type', 'suggestion');
  const cat = F('fb-cat', '');
  const cats = posh && !posh.error ? Object.entries(posh.categories) : [];
  const anon = Boolean(F('fb-anon'));
  const tr = KL.ui.track;
  const mine = list && !list.error ? list.rows.filter((r) => !r.category || r.category !== 'posh' || r.user_id === KL.user.id) : [];
  return `${topbar('Complaints & suggestions', '#me')}
    <div class="card stack">
      <div class="seg"><button type="button" data-action="fbType" data-type="suggestion" aria-pressed="${type === 'suggestion'}">Suggestion</button><button type="button" data-action="fbType" data-type="complaint" aria-pressed="${type === 'complaint'}">Complaint</button></div>
      ${type === 'complaint' ? field('What is it about', select('fb-cat', cat, cats, { blank: 'Choose' })) : ''}
      ${type === 'complaint' && cat === 'posh' ? `<div class="banner violet">${ic('shield')}<div><b>Goes only to the Internal Committee</b><p>HR staff outside the committee and your manager do not see it.${anon ? ' The committee can act on an anonymous message as information, but a formal inquiry under the Act needs a named, written complaint.' : ''}</p></div></div>` : ''}
      ${textarea('fb-text', F('fb-text'), type === 'complaint' ? 'What happened, when and where. HR reads every complaint.' : 'What would make work better?')}
      <label class="check"><input type="checkbox" id="fb-anon" ${anon ? 'checked' : ''} data-change="fbAnon" /> <span>Send anonymously. Nobody sees your name; you get a tracking code to read the reply and write back.</span></label>
      <button type="button" class="btn primary wide" data-action="fbSend">${cat === 'posh' && type === 'complaint' ? 'Send to the Internal Committee' : 'Send to HR'}</button>
    </div>
    ${type === 'complaint' && cat === 'posh' ? poshCard(posh, true) : ''}
    ${group('Track an anonymous complaint', `<div class="card stack">
      <div class="row" style="gap:8px">${input('fb-code', F('fb-code'), { placeholder: 'KL-XXXX-XXXX' })}<button type="button" class="btn" data-action="fbTrack">Open</button></div>
      ${KL.boot?.demo ? `<div class="demo-ribbon">${ic('sparkle')}<span>Prototype: try <b class="mono">KL-DEMO-2026</b></span></div>` : ''}
      ${tr ? `<div class="stack"><div class="row between"><b>${esc(tr.type === 'complaint' ? 'Complaint' : 'Suggestion')} · ${esc(fmtDate(tr.created_at, false))}</b>${statusTag(tr.status)}</div><p class="hint" style="white-space:pre-wrap">${esc(tr.text)}</p>${fbThread(tr.thread) || '<p class="hint">No reply yet.</p>'}
        ${textarea('fb-reply', F('fb-reply'), 'Write back (still anonymous)')}<button type="button" class="btn small primary" data-action="fbTrackReply">${ic('send')} Send</button></div>` : ''}
    </div>`)}
    ${group('Sent by me', list === null ? spinner() : list.error ? errorBox(list.error) : mine.length ? `<div class="card flush">${mine.map((r) => `<div class="lrow-static"><div class="row between"><b>${esc(r.type === 'complaint' ? 'Complaint' : 'Suggestion')} · ${esc(fmtDate(r.created_at, false))}</b>${statusTag(r.status)}</div><p class="hint" style="white-space:pre-wrap;margin-top:2px">${esc(r.text)}</p>${fbThread(r.thread) || (r.response ? `<div class="banner info" style="margin-top:6px"><b>HR replied</b><p>${esc(r.response)}</p></div>` : '')}</div>`).join('')}</div>` : '<div class="card"><p class="empty">Nothing yet. Anonymous items are not listed here; use the tracking code.</p></div>')}
    ${type === 'complaint' && cat === 'posh' ? '' : group('Sexual harassment at work', poshCard(posh))}`;
};
Actions.fbType = (el) => { setF('fb-type', el.dataset.type); render(); };
Changes.fbAnon = (el) => { setF('fb-anon', el.checked); render(); };
Actions.fbSend = async () => {
  try {
    const r = await api('/api/feedback', { json: { type: F('fb-type', 'suggestion'), category: F('fb-cat', ''), text: F('fb-text', ''), anonymous: Boolean(F('fb-anon')) } });
    clearF('fb-text', 'fb-anon', 'fb-cat'); invalidate('feedback');
    if (r.code) {
      await modal({ title: 'Keep this tracking code', html: `<div class="code-big mono">${esc(r.code)}</div><p class="hint">Write it down or take a screenshot. It is the only way to read the reply and write back; it is not stored with your name, so it cannot be sent again.</p>`, confirmText: 'I have saved it', cancelText: 'Close' });
      setF('fb-code', r.code);
    } else toast('Sent');
    render();
  } catch (e) { toast(e.message, 'error'); }
};
Actions.fbTrack = async () => {
  try { KL.ui.track = await api(`/api/feedback/track?code=${encodeURIComponent(F('fb-code', ''))}`); KL.ui.trackCode = F('fb-code', ''); render(); } catch (e) { KL.ui.track = null; toast(e.message, 'error'); render(); }
};
Actions.fbTrackReply = async () => {
  try { await api('/api/feedback/track', { json: { code: KL.ui.trackCode, text: F('fb-reply', '') } }); clearF('fb-reply'); await Actions.fbTrack(); toast('Sent, still anonymous'); } catch (e) { toast(e.message, 'error'); }
};
/** HR desk / Internal Committee desk: complaints with their conversation. */
function complaintsDesk(fb, onlyPosh = false) {
  if (fb === null) return spinner();
  if (fb.error) return errorBox(fb.error);
  const cats = KL.cache['hr:posh']?.categories || {};
  const rows = fb.rows.filter((r) => (onlyPosh ? r.category === 'posh' : r.category !== 'posh'));
  if (!rows.length) return `<div class="card"><p class="empty">${onlyPosh ? 'No POSH complaints.' : 'Nothing yet.'}</p></div>`;
  const ageDays = (r) => Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000);
  return dataTable({ id: onlyPosh ? 'posh' : 'tickets', rows, pageSize: 15, placeholder: 'Search tickets', search: (r) => `${r.text} ${r.user_name || ''} ${cats[r.category] || ''}`,
    filters: [{ key: 'st', label: 'Status', options: [['open', 'Open'], ['in_progress', 'In progress'], ['closed', 'Closed']], match: (r, v) => r.status === v },
      ...(onlyPosh ? [] : [{ key: 'ty', label: 'Type', options: [['complaint', 'Complaints'], ['suggestion', 'Suggestions']], match: (r, v) => r.type === v }])],
    columns: [{ key: 'text', label: 'Ticket', render: (r) => `<b>${esc(r.type === 'complaint' ? 'Complaint' : 'Suggestion')}</b> <span class="muted">${esc(String(r.text).slice(0, 80))}${String(r.text).length > 80 ? '…' : ''}</span>` },
      { key: 'user_name', label: 'From', render: (r) => esc(r.user_name || 'Anonymous') },
      { key: 'category', label: 'Category', phone: false, render: (r) => esc(cats[r.category] || '–') },
      { key: 'age', label: 'Age', align: 'right', value: (r) => ageDays(r), render: (r) => `${ageDays(r)} d` },
      { key: 'status', label: 'Status', render: (r) => statusTag(r.status) }],
    actions: (r) => `<button type="button" class="btn small" data-action="fbOpen" data-id="${esc(r.id)}">Open</button>`,
    phoneRow: (r) => `<div class="lrow-static"><div class="row between"><b>${esc(r.type === 'complaint' ? 'Complaint' : 'Suggestion')} · ${esc(r.user_name || 'Anonymous')}</b>${statusTag(r.status)}</div><p class="hint" style="margin:4px 0 8px">${esc(String(r.text).slice(0, 140))}</p><button type="button" class="btn small" data-action="fbOpen" data-id="${esc(r.id)}">Open</button></div>` });
}
/** A ticket: the full text, the conversation, then reply. */
Actions.fbOpen = async (el) => {
  const all = KL.cache['feedback:all'];
  const r = all && !all.error ? all.rows.find((x) => x.id === el.dataset.id) : null;
  if (!r) return;
  const cats = KL.cache['hr:posh']?.categories || {};
  const ok = await modal({ title: `${r.type === 'complaint' ? 'Complaint' : 'Suggestion'} · ${r.user_name || 'Anonymous'}`, wide: true, confirmText: r.thread.length ? 'Reply again' : 'Reply', cancelText: 'Close',
    html: `<p class="hint">${esc(cats[r.category] || '')}${r.category ? ' · ' : ''}${esc(fmtDate(r.created_at))}${r.tracked ? ' · the sender has a tracking code' : ''} · ${statusTag(r.status)}</p><p style="white-space:pre-wrap">${esc(r.text)}</p>${fbThread(r.thread) || '<p class="hint">No reply yet.</p>'}` });
  if (ok) Actions.fbRespond(el);
};
Actions.fbRespond = async (el) => {
  const v = await modal({ title: 'Reply', fields: [{ key: 'response', label: 'Your reply (the sender sees it, also when anonymous through the tracking code)', type: 'textarea' }, { key: 'status', label: 'Status', type: 'select', options: ['in_progress', 'closed'], value: 'in_progress' }], confirmText: 'Send' });
  if (!v) return;
  try { await api(`/api/feedback/${el.dataset.id}/respond`, { json: v }); invalidate('feedback'); toast('Replied'); render(); } catch (e) { toast(e.message, 'error'); }
};
Views.poshdesk = () => {
  const fb = data('feedback:all', () => api('/api/feedback'));
  data('hr:posh', () => api('/api/hr/posh'));
  return `${topbar('Internal Committee', isStaff() ? '#hr' : '#me')}<p class="sub">Confidential. Only members of the Internal Committee (POSH) see these complaints.</p>${complaintsDesk(fb, true)}`;
};

/* ---------------------------------------------------------------- employee flags (HR): uses the app, crew supervisor */
function personFlags(u) {
  if (!hrRoleNow()) return u.app_access ? '' : `<div class="card"><p class="hint">${ic('users')} No phone: attendance is marked by the site supervisor.</p></div>`;
  return `<div class="card flush">
    <label class="lrow-static row check" style="gap:12px"><input type="checkbox" ${u.app_access ? 'checked' : ''} data-change="personFlag" data-id="${esc(u.id)}" data-flag="appAccess" /><span class="tx"><b>Uses the app</b><span class="muted" style="font-size:13px;display:block">Off for crew without a phone: the site supervisor marks their attendance</span></span></label>
    ${u.role === 'field' ? `<label class="lrow-static row check" style="gap:12px"><input type="checkbox" ${u.supervisor ? 'checked' : ''} data-change="personFlag" data-id="${esc(u.id)}" data-flag="supervisor" /><span class="tx"><b>Crew supervisor</b><span class="muted" style="font-size:13px;display:block">Marks crew attendance at their own sites</span></span></label>` : ''}
  </div>`;
}
Changes.personFlag = async (el) => {
  try { await api(`/api/hr/flags/${el.dataset.id}`, { json: { [el.dataset.flag]: el.checked } }); invalidate('hr'); toast('Saved'); render(); } catch (e) { toast(e.message, 'error'); }
};
