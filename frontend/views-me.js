/* Me (HR self-service), Inbox, daily updates, leave, complaints & suggestions, PIN. */

Views.me = () => {
  const u = KL.user;
  const docs = data('hrdocs:mine', () => api('/api/hr/documents'));
  data('hr:posh', () => api('/api/hr/posh'));
  const leaves = data('leaves:mine', () => api('/api/leaves'));
  const pendingLeaves = leaves && !leaves.error ? leaves.rows.filter((l) => l.status === 'pending').length : 0;
  let theme = 'auto';
  try { theme = localStorage.getItem('kl.theme') || 'auto'; } catch { /* private mode */ }
  return `<h1 class="large">Me</h1>
    <div class="card profile" style="margin-top:14px">${profilePhoto(u)}<div style="min-width:0"><b>${esc(u.name)}</b><span>${esc(u.designation || ROLE_TEXT[u.role] || u.role)}</span><span class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">${tag(u.employee_id, 'info')}${tag(ROLE_TEXT[u.role] || u.role, 'ok')}${(u.sites || []).slice(0, 2).map((id) => tag(siteName(id))).join('')}</span></div></div>
    ${u.must_change_pin ? `<div class="banner warn"><b>Change your PIN</b><p>HR gave you a starting PIN. Set your own 6-digit PIN now.</p><button type="button" class="btn small" data-action="changePin" style="margin-top:8px">Change PIN</button></div>` : ''}
    ${group('My documents', docs === null ? spinner() : docs.error ? errorBox(docs.error) : docs.rows.length ? `<div class="card flush">${docs.rows.map((d) => `<div class="lrow-static row"><span class="icon blue">${ic('doc')}</span><span class="tx" style="flex:1"><b>${esc(d.title)}</b><span class="muted" style="font-size:13px;display:block">${esc(d.category)} · ${esc(fmtDate(d.created_at, false))}</span></span>${fileLink(d.file_id)}</div>`).join('')}</div>` : '<div class="card"><p class="empty">Payslips, letters and ID documents appear here when HR uploads them.</p></div>', 'From HR')}
    ${group('My HR', `<div class="card flush">
      ${lrow({ href: '#person/me', icon: 'user', tone: 'blue', title: 'My employee record', sub: 'Details, bank and statutory numbers, leave balance, assets' })}
      ${lrow({ href: '#attsum', icon: 'calendar', tone: 'green', title: 'Attendance summary', sub: 'This month: present, late, absent, overtime' })}
      ${lrow({ href: '#rec/regularisation', icon: 'clock', tone: 'amber', title: 'Attendance corrections', sub: 'Fix a missed check-out; your manager approves' })}
      ${lrow({ href: '#rec/expense', icon: 'receipt', tone: 'violet', title: 'Expense claims', sub: 'Bills with receipt photos; manager, then HR above ₹2,000' })}
      ${lrow({ href: '#rec/advance', icon: 'receipt', title: 'Advances & loans', sub: 'Recovered by Zoho Payroll in monthly parts' })}
      ${lrow({ href: '#rec/asset_issue', icon: 'box', title: 'My assets', sub: 'Phone, tools and safety kit issued to me' })}
      ${isOff('training') ? '' : lrow({ href: '#rec/training', icon: 'shield', tone: 'green', title: 'Training & certificates', sub: 'With expiry dates' })}
      ${isOff('goal') ? '' : lrow({ href: '#rec/goal', icon: 'target', title: 'Goals & reviews', sub: 'Targets set by my manager' })}
      ${lrow({ href: '#mypolicies', icon: 'doc', title: 'Company policies', sub: 'What you accepted' })}
    </div>`)}
    ${group('My requests', `<div class="card flush">
      ${lrow({ href: '#updates', icon: 'note', title: 'Daily work update', sub: 'Today and the last two weeks' })}
      ${lrow({ href: '#leaves', icon: 'sun', tone: 'blue', title: 'Leave', sub: pendingLeaves ? `${pendingLeaves} request${pendingLeaves === 1 ? '' : 's'} pending` : 'Apply and see past leave' })}
      ${lrow({ href: '#committees', icon: 'shield', tone: 'violet', title: 'Committees', sub: 'Who looks after complaints and ideas' })}
      ${lrow({ href: '#feedback', icon: 'chat', tone: 'amber', title: 'Complaints & suggestions', sub: 'To a committee, with your name or without, with a tracking code' })}
      ${(KL.cache.committees?.rows || []).some((c) => c.openCases !== undefined) ? lrow({ href: '#cases', icon: 'inbox', tone: 'red', title: 'Committee cases', sub: 'Confidential complaints for the committee' }) : ''}
      ${lrow({ href: '#changes/me', icon: 'clock', title: 'Changes to my records', sub: 'Attendance, leave and balance changes, with who and why' })}
      ${lrow({ href: '#attendance', icon: 'pin', tone: 'green', title: 'My attendance', sub: 'Check-ins of the last 31 days' })}
      ${lrow({ href: '#trips', icon: 'bike', title: 'My travel claims', sub: 'Approved, pending and rejected' })}
    </div>`)}
    ${group('Settings', `<div class="card flush">${lrow({ href: '#settings', icon: 'cog', title: 'Settings', sub: 'Language, appearance, PIN, sign out, administration' })}</div>`)}
    <div class="foot"><img src="./logo.png" alt="Sajeevan" />Kshetralekha v${esc(KL.me?.version || '')} · ${esc(KL.boot?.company?.name || '')}</div>`;
};
Actions.changePin = async () => {
  const v = await modal({ title: 'Change PIN', fields: [{ key: 'old', label: 'Current PIN', type: 'password', inputmode: 'numeric' }, { key: 'new', label: 'New PIN (6 digits)', type: 'password', inputmode: 'numeric' }, { key: 'again', label: 'New PIN again', type: 'password', inputmode: 'numeric' }], confirmText: 'Change' });
  if (!v) return;
  if (v.new !== v.again) return toast('The two new PINs differ', 'error');
  try { await api('/api/auth/pin', { json: { old: v.old, new: v.new } }); toast('PIN changed'); await refreshMe(); render(); } catch (e) { toast(e.message, 'error'); }
};
Actions.logout = async () => { if (await modal({ title: 'Sign out?', message: 'Saved items waiting for signal stay on the phone until you sign in again.', confirmText: 'Sign out', danger: true })) logout(); };
Actions.flushOutbox = async () => { await Outbox.flush(); await Outbox.count(); toast(KL.outboxCount ? `${KL.outboxCount} still waiting` : 'Everything sent'); render(); };
/** Saved items the server refused (e.g. a reading below the start): kept with the reason until the worker decides. */
function failedItems() {
  const bad = (KL.outboxItems || []).filter((x) => x.failed);
  if (!bad.length) return '';
  return group('Could not send', `<div class="card flush">${bad.map((x) => `<div class="lrow-static row"><span class="tx" style="flex:1;min-width:0"><b>${esc(x.label)}</b><span class="muted" style="font-size:13px;display:block">${esc(fmtDate(x.createdAt))} · ${esc(x.failed)}</span></span>
    <button type="button" class="btn small" data-action="outboxRetry" data-id="${esc(x.id)}">Try again</button><button type="button" class="btn small ghost" data-action="outboxDiscard" data-id="${esc(x.id)}" data-label="${esc(x.label)}">Discard</button></div>`).join('')}</div>`,
  'Saved on this phone but refused by the server. Try again after fixing the reason, or discard it and enter it again.');
}
Actions.outboxRetry = async (el) => {
  const it = (await Outbox.all()).find((x) => x.id === el.dataset.id);
  if (!it) return;
  delete it.failed; await Outbox.put(it); await Outbox.flush(); await Outbox.count(); render();
};
Actions.outboxDiscard = async (el) => {
  if (!(await modal({ title: `Discard ${el.dataset.label}?`, message: 'It is removed from this phone, with its photo. Enter it again if it is still needed.', confirmText: 'Discard', danger: true }))) return;
  await Outbox.remove(el.dataset.id); await Outbox.count(); render();
};

/* ---------------------------------------------------------------- Inbox */
function inboxIcon(n) {
  const t = n.title.toLowerCase();
  if (t.startsWith('task done')) return ['check', 'green'];
  if (t.startsWith('approval needed')) return ['check', 'amber'];
  if (t.startsWith('incident')) return ['alert', 'red'];
  if (t.startsWith('batch')) return ['flame', 'earth'];
  if (t.startsWith('payslip')) return ['receipt', 'violet'];
  if (t.startsWith('left site') || t.startsWith('check-out missed')) return ['pin', 'red'];
  if (t.startsWith('please read')) return ['doc', 'amber'];
  if (t.startsWith('checklist') || t.startsWith('equipment')) return ['cog', 'red'];
  if (t.startsWith('new task')) return ['kanban', 'violet'];
  if (t.startsWith('comment')) return ['chat', 'blue'];
  if (t.includes('rejected')) return ['alert', 'red'];
  if (t.includes('approved') || t.includes(' ok')) return ['check', 'green'];
  if (t.includes('trip') || t.includes('travel')) return ['bike', 'blue'];
  if (t.includes('leave')) return ['sun', 'amber'];
  if (t.includes('check-in') || t.includes('exception')) return ['pin', 'amber'];
  if (t.includes('document') || t.includes('payslip')) return ['doc', 'earth'];
  return ['bell', ''];
}
Views.inbox = () => {
  const box = data('inbox', () => api('/api/inbox'));
  if (box && !box.error && box.rows.some((n) => !n.read)) {
    api('/api/inbox/read', { json: {} }).then(() => { if (KL.me) KL.me.unread = 0; for (const b of $$('.tabbar .badge, .side .badge')) if (b.closest('a[href="#inbox"]')) b.remove(); }).catch(() => {});
  }
  const rows = box && !box.error ? box.rows : [];
  return `<h1 class="large">Inbox</h1><p class="sub">Tasks, approvals, replies and alerts</p>
    ${box === null ? spinner() : box.error ? errorBox(box.error) : rows.length ? `<div class="card flush">${rows.map((n) => {
      const [icon, tone] = inboxIcon(n);
      return lrow({ href: n.link || '#inbox', icon, tone, title: n.title, sub: `${esc(n.body)}${n.body ? ' · ' : ''}${esc(timeAgo(n.created_at))}`, right: n.read ? '' : '<span class="unread-dot" aria-label="New"></span>', chev: Boolean(n.link) });
    }).join('')}</div>` : emptyState('inbox', 'Nothing yet', 'Approvals, new tasks and replies arrive here.')}`;
};

/* ---------------------------------------------------------------- Daily update */
Views.updates = () => {
  const list = data('updates:mine', () => api('/api/updates?days=14'));
  const today = list && !list.error ? list.rows.find((r) => r.date === todayISO()) : null;
  const prompts = KL.boot?.updatePrompts || [];
  const sites = KL.boot?.mySites || [];
  return `${topbar('Daily work update', '#me')}
    <div class="card stack">
      <b>${esc(new Date().toLocaleDateString(appLocale(), { weekday: 'long', day: 'numeric', month: 'long' }))}${today ? ' · already sent, you can edit' : ''}</b>
      ${prompts.length ? `<p class="hint">${prompts.map(esc).join(' · ')}</p>` : ''}
      ${field('What did you do today?', textarea('upd-summary', F('upd-summary', today?.summary || ''), 'e.g. Visited 6 farmers in Vanthali, 4 agreements signed, 2 KMLs uploaded. Tomorrow: Mendarda cluster.'))}
      <div class="grid2">${field('Hours worked', input('upd-hours', F('upd-hours', today?.hours ?? ''), { type: 'number', inputmode: 'decimal', step: '0.5', min: 0 }))}
      ${field('Site', select('upd-site', F('upd-site', today?.site_id || KL.me?.openAttendance?.site_id || ''), sites.map((s) => [s.id, s.name]), { blank: 'None / office' }))}</div>
      ${field('Need any help? (optional)', input('upd-blockers', F('upd-blockers', today?.blockers || ''), { placeholder: 'e.g. Need more saplings at Junagadh' }))}
      <button type="button" class="btn primary wide" data-action="updateSave">${today ? 'Update' : 'Send update'}</button>
    </div>
    ${group('Last two weeks', list === null ? spinner() : list.error ? errorBox(list.error) : list.rows.length ? `<div class="card flush">${timeline(list.rows.map((r) => ({ title: `${r.ref ? `${r.ref} · ` : ''}${fmtDate(r.date, false)}${r.hours ? ` · ${r.hours} h` : ''}${r.site_name ? ` · ${r.site_name}` : ''}`, sub: `${esc(r.summary)}${r.blockers ? `<br><b class="bad-text">Blocker:</b> ${esc(r.blockers)}` : ''}`, tone: r.blockers ? 'warn' : '' })))}</div>` : emptyState('note', 'No updates yet', 'Write a few lines at the end of each day.'))}`;
};
Actions.updateSave = async () => {
  try {
    const list = KL.cache['updates:mine'];
    const today = list && !list.error ? list.rows.find((r) => r.date === todayISO()) : null;
    await api('/api/updates', { json: { summary: F('upd-summary', today?.summary || ''), hours: F('upd-hours', today?.hours ?? '') || null, site_id: F('upd-site', today?.site_id || ''), blockers: F('upd-blockers', today?.blockers || ''), date: todayISO() } });
    clearF('upd-summary', 'upd-hours', 'upd-site', 'upd-blockers');
    invalidate('updates'); toast('Update sent'); render();
  } catch (e) { toast(e.status === 0 ? 'No connection. Try again when online.' : e.message, 'error'); }
};

/* ---------------------------------------------------------------- Leave */
Views.leaves = () => {
  const list = data('leaves:mine', () => api('/api/leaves'));
  const types = KL.boot?.leaveTypes || ['Casual'];
  const bal = data('hr:balances', () => api('/api/hr/leave-balances'));
  const half = F('lv-half', '');
  const dates = (l) => `${esc(fmtDate(l.from_date, false))}${l.to_date !== l.from_date ? ` to ${esc(fmtDate(l.to_date, false))}` : ''}${l.half ? ` · ${l.half === 'first' ? 'first half' : 'second half'}` : ''}`;
  const withdrawBtn = (l) => (l.canWithdraw ? `<button type="button" class="btn small ghost" data-action="leaveWithdraw" data-id="${esc(l.id)}" data-approved="${l.status === 'approved' ? '1' : ''}">Withdraw</button>` : '');
  return `${topbar('Leave', '#me')}
    ${bal && !bal.error ? `<div class="tiles four" style="margin-bottom:14px">${bal.rows.map((b) => `<div class="tile ${b.available === null ? '' : b.available <= 1 ? 'warn' : 'ok'}"><b>${b.available === null ? '∞' : fmtNum(b.available, 1)}</b><span>${esc(b.type)} left${b.available === null ? ' (unpaid)' : ` · ${fmtNum(b.accrued + b.opening, 1)} credited, ${fmtNum(b.used, 1)} used${b.pending ? `, ${fmtNum(b.pending, 1)} pending` : ''}`}</span></div>`).join('')}</div>` : ''}
    ${group('Apply for leave', `<div class="card stack">
      ${pills('Length', 'lv-half', half, [['', 'Full day or days'], ['first', 'Half · first half'], ['second', 'Half · second half']])}
      ${pills('Type', 'lv-type', F('lv-type', types[0]), types.map((t) => [t, t]))}
      <div class="grid2">${field(half ? 'Date' : 'From', input('lv-from', F('lv-from', todayISO()), { type: 'date' }), { required: true })}${half ? '' : field('To', input('lv-to', F('lv-to', todayISO()), { type: 'date' }), { required: true })}</div>
      ${field('Reason', input('lv-reason', F('lv-reason'), { placeholder: 'Optional' }), { help: 'Your manager sees this.' })}
      <button type="button" class="btn primary wide" data-action="leaveApply">Apply</button>
    </div>`)}
    ${group('My leave', list === null ? spinner() : list.error ? errorBox(list.error) : list.rows.length ? dataTable({ id: 'my-leave', rows: list.rows, pageSize: 10,
      filters: [{ key: 'st', label: 'Status', options: [['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['withdrawn', 'Withdrawn']], match: (l, v) => l.status === v }],
      columns: [{ key: 'from_date', label: 'Dates', render: (l) => `${dates(l)}${refLine(l)}` },
        { key: 'type', label: 'Type' }, { key: 'days', label: 'Days', align: 'right', value: (l) => l.days || 0, render: (l) => fmtNum(l.days || 0, 1) },
        { key: 'reason', label: 'Note', phone: false, render: (l) => esc([l.reason, l.decision_note, l.status === 'pending' && l.waiting ? `with ${l.waiting}` : ''].filter(Boolean).join(' · ') || '–') },
        { key: 'status', label: 'Status', render: (l) => `${statusTag(l.status)} ${withdrawBtn(l)}` }],
      phoneRow: (l) => `<div class="lrow-static row"><span class="tx" style="flex:1"><b>${esc(l.type)} · ${dates(l)}</b>${refLine(l)}<span class="muted" style="font-size:14px;display:block">${l.half ? 'Half day' : `${fmtNum(l.days || 0, 1)} working day${l.days === 1 ? '' : 's'}`}${l.reason ? ` · ${esc(l.reason)}` : ''}${l.decision_note ? ` · ${esc(l.decision_note)}` : ''}${l.status === 'pending' && l.waiting ? ` · with ${esc(l.waiting)}` : ''}</span></span><span class="right">${statusTag(l.status)}${l.canWithdraw ? `<br/>${withdrawBtn(l)}` : ''}</span></div>` })
      : emptyState('sun', 'No leave requests yet', 'Apply above; your manager is told at once.'))}`;
};
Actions.leaveApply = async () => {
  try {
    const half = F('lv-half', '');
    const from = F('lv-from', todayISO());
    await api('/api/leaves', { json: { from, to: half ? from : F('lv-to', todayISO()), half, type: F('lv-type', KL.boot.leaveTypes[0]), reason: F('lv-reason', '') } });
    clearF('lv-reason', 'lv-half'); invalidate('leaves', 'hr:balances'); toast('Leave request sent to your manager'); render();
  } catch (e) { toast(e.message, 'error'); }
};
Actions.leaveWithdraw = async (el) => {
  const approved = Boolean(el.dataset.approved);
  if (!(await modal({ title: approved ? 'Cancel this approved leave?' : 'Withdraw this leave request?', message: approved ? 'The days go back to your balance and your manager is told. You can apply again if you need to.' : 'It is taken back from your approvers and the days go back to your balance.', confirmText: 'Withdraw', danger: true }))) return;
  try { await api(`/api/leaves/${el.dataset.id}/withdraw`, { json: {} }); invalidate('leaves', 'hr:balances', 'approvals'); await refreshMe(); toast('Leave withdrawn'); render(); } catch (e) { toast(e.message, 'error'); }
};
