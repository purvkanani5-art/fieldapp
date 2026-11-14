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
    <div class="card profile" style="margin-top:14px">${avatar(u.name, 'xl')}<div style="min-width:0"><b>${esc(u.name)}</b><span>${esc(u.designation || ROLE_TEXT[u.role] || u.role)}</span><span class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">${tag(u.employee_id, 'info')}${tag(ROLE_TEXT[u.role] || u.role, 'ok')}${(u.sites || []).slice(0, 2).map((id) => tag(siteName(id))).join('')}</span></div></div>
    ${u.must_change_pin ? `<div class="banner warn"><b>Change your PIN</b><p>HR gave you a starting PIN. Set your own 6-digit PIN now.</p><button type="button" class="btn small" data-action="changePin" style="margin-top:8px">Change PIN</button></div>` : ''}
    ${group('My documents', docs === null ? spinner() : docs.error ? errorBox(docs.error) : docs.rows.length ? `<div class="card flush">${docs.rows.map((d) => `<div class="lrow-static row"><span class="icon blue">${ic('doc')}</span><span class="tx" style="flex:1"><b>${esc(d.title)}</b><span class="muted" style="font-size:13px;display:block">${esc(d.category)} · ${esc(fmtDate(d.created_at, false))}</span></span>${fileLink(d.file_id)}</div>`).join('')}</div>` : '<div class="card"><p class="empty">Payslips, letters and ID documents appear here when HR uploads them.</p></div>', 'From HR')}
    ${(() => { const pol = data('m:policy', () => api('/api/m/policy')); const todo = pol && !pol.error ? pol.rows.filter((p) => p.data.must_ack === 'Yes' && !p.acked) : []; return todo.length ? `<div class="banner warn" style="margin-top:14px">${ic('doc')}<div><b>${todo.length} polic${todo.length === 1 ? 'y' : 'ies'} to read and accept</b><p>${todo.map((p) => `<a href="#rec/policy/${esc(p.id)}">${esc(p.title)}</a>`).join(' · ')}</p></div></div>` : ''; })()}
    ${group('My HR', `<div class="card flush">
      ${lrow({ href: '#person/me', icon: 'user', tone: 'blue', title: 'My employee record', sub: 'Details, bank and statutory numbers, leave balance, assets, training, goals' })}
      ${lrow({ href: '#attsum', icon: 'calendar', tone: 'green', title: 'Attendance summary', sub: 'This month: present, late, absent, overtime' })}
      ${lrow({ href: '#rec/regularisation', icon: 'clock', tone: 'amber', title: 'Attendance corrections', sub: 'Fix a missed check-out; your manager approves' })}
      ${lrow({ href: '#rec/expense', icon: 'receipt', tone: 'violet', title: 'Expense claims', sub: 'Bills with receipt photos; manager, then HR above ₹2,000' })}
      ${lrow({ href: '#rec/advance', icon: 'receipt', title: 'Advances & loans', sub: 'Recovered by Zoho Payroll in monthly parts' })}
      ${lrow({ href: '#rec/asset_issue', icon: 'box', title: 'My assets', sub: 'Phone, tools and safety kit issued to me' })}
      ${lrow({ href: '#rec/training', icon: 'shield', tone: 'green', title: 'Training & certificates', sub: 'With expiry dates' })}
      ${lrow({ href: '#rec/goal', icon: 'target', title: 'Goals & reviews', sub: 'Targets set by my manager' })}
      ${lrow({ href: '#rec/policy', icon: 'doc', title: 'Policies', sub: 'Read and accept' })}
    </div>`)}
    ${group('Requests & forms', `<div class="card flush">
      ${lrow({ href: '#notices', icon: 'bell', tone: 'amber', title: 'Notice board', sub: 'Company and site announcements' })}
      ${lrow({ href: '#surveys', icon: 'chart', tone: 'blue', title: 'Surveys', sub: 'Short and anonymous' })}
      ${lrow({ href: '#updates', icon: 'note', title: 'Daily work update', sub: 'Today and the last two weeks' })}
      ${lrow({ href: '#leaves', icon: 'sun', tone: 'blue', title: 'Leave', sub: pendingLeaves ? `${pendingLeaves} request${pendingLeaves === 1 ? '' : 's'} pending` : 'Apply and see past leave' })}
      ${lrow({ href: '#feedback', icon: 'chat', tone: 'amber', title: 'Complaints & suggestions', sub: 'To HR or the POSH committee, named or anonymous with a tracking code' })}
      ${KL.cache['hr:posh']?.onCommittee ? lrow({ href: '#poshdesk', icon: 'shield', tone: 'violet', title: 'Internal Committee (POSH)', sub: 'Confidential complaints for the committee' }) : ''}
      ${lrow({ href: '#changes/me', icon: 'clock', title: 'Changes to my records', sub: 'Attendance, leave and balance changes, with who and why' })}
      ${lrow({ href: '#attendance', icon: 'pin', tone: 'green', title: 'My attendance', sub: 'Check-ins of the last 31 days' })}
      ${lrow({ href: '#trips', icon: 'bike', title: 'My travel claims', sub: 'Approved, pending and rejected' })}
    </div>`)}
    ${group('Language', `<div class="card"><div class="seg">${[['en', 'English'], ['gu', 'ગુજરાતી'], ['hi', 'हिन्दी']].map(([k, l]) => `<button type="button" data-action="lang" data-lang="${k}" aria-pressed="${lang() === k}">${l}</button>`).join('')}</div><p class="hint" style="margin-top:8px">Prototype: menus, buttons and common words are translated.</p></div>`)}
    ${group('Security & privacy', `<div class="card flush">${['admin', 'hr', 'manager'].includes(u.role) ? lrow({ href: '#security', icon: 'shield', tone: 'green', title: 'Two-step sign-in', sub: 'Authenticator code after the PIN' }) : ''}${lrow({ href: '#privacy', icon: 'lock', title: 'Privacy & my data', sub: 'What is recorded, for how long, download my data' })}</div>`)}
    ${group('For reviewers', reviewerNote())}
    ${group('Appearance', `<div class="card"><div class="seg">${[['auto', 'sun', 'Automatic'], ['light', 'sun', 'Light'], ['dark', 'moon', 'Dark']].map(([k, icon, l]) => `<button type="button" data-action="theme" data-theme="${k}" aria-pressed="${theme === k}">${ic(icon)}${l}</button>`).join('')}</div></div>`)}
    ${group('Account', `<div class="card flush">
      ${lrow({ action: 'changePin', icon: 'lock', title: 'Change PIN', sub: '6 digits, known only to you' })}
      ${lrow({ action: 'flushOutbox', icon: 'upload', title: 'Send saved items now', sub: KL.outboxCount ? `${KL.outboxCount} waiting` : 'Nothing waiting' })}
      ${lrow({ action: 'logout', icon: 'logout', tone: 'red', title: 'Sign out', sub: 'On this phone' })}
    </div>
    <div class="foot"><img src="./logo.png" alt="Sajeevan" />Kshetralekha prototype v${esc(KL.me?.version || '')} · ${esc(KL.boot?.company?.name || '')}</div>`)}`;
};
Actions.changePin = async () => {
  const v = await modal({ title: 'Change PIN', fields: [{ key: 'old', label: 'Current PIN', type: 'password', inputmode: 'numeric' }, { key: 'new', label: 'New PIN (6 digits)', type: 'password', inputmode: 'numeric' }, { key: 'again', label: 'New PIN again', type: 'password', inputmode: 'numeric' }], confirmText: 'Change' });
  if (!v) return;
  if (v.new !== v.again) return toast('The two new PINs differ', 'error');
  try { await api('/api/auth/pin', { json: { old: v.old, new: v.new } }); toast('PIN changed'); await refreshMe(); render(); } catch (e) { toast(e.message, 'error'); }
};
Actions.logout = async () => { if (await modal({ title: 'Sign out?', message: 'Saved items waiting for signal stay on the phone until you sign in again.', confirmText: 'Sign out', danger: true })) logout(); };
Actions.flushOutbox = async () => { await Outbox.flush(); toast(KL.outboxCount ? `${KL.outboxCount} still waiting` : 'Everything sent'); render(); };

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
      <b>${esc(new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }))}${today ? ' · already sent, you can edit' : ''}</b>
      ${prompts.length ? `<p class="hint">${prompts.map(esc).join(' · ')}</p>` : ''}
      ${field('What did you do today?', textarea('upd-summary', F('upd-summary', today?.summary || ''), 'e.g. Visited 6 farmers in Vanthali, 4 agreements signed, 2 KMLs uploaded. Tomorrow: Mendarda cluster.'))}
      <div class="grid2">${field('Hours worked', input('upd-hours', F('upd-hours', today?.hours ?? ''), { type: 'number', inputmode: 'decimal', step: '0.5', min: 0 }))}
      ${field('Site', select('upd-site', F('upd-site', today?.site_id || KL.me?.openAttendance?.site_id || ''), sites.map((s) => [s.id, s.name]), { blank: 'None / office' }))}</div>
      ${field('Blockers or help needed (optional)', input('upd-blockers', F('upd-blockers', today?.blockers || ''), { placeholder: 'e.g. Need more saplings at Junagadh' }))}
      <button type="button" class="btn primary wide" data-action="updateSave">${today ? 'Update' : 'Send update'}</button>
    </div>
    ${group('Last two weeks', list === null ? spinner() : list.error ? errorBox(list.error) : list.rows.length ? `<div class="card flush">${timeline(list.rows.map((r) => ({ title: `${fmtDate(r.date, false)}${r.hours ? ` · ${r.hours} h` : ''}${r.site_name ? ` · ${r.site_name}` : ''}`, sub: `${esc(r.summary)}${r.blockers ? `<br><b class="bad-text">Blocker:</b> ${esc(r.blockers)}` : ''}`, tone: r.blockers ? 'warn' : '' })))}</div>` : emptyState('note', 'No updates yet', 'Write a few lines at the end of each day.'))}`;
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
  return `${topbar('Leave', '#me')}
    ${bal && !bal.error ? `<div class="tiles four" style="margin-bottom:14px">${bal.rows.map((b) => `<div class="tile ${b.available === null ? '' : b.available <= 1 ? 'warn' : 'ok'}"><b>${b.available === null ? '∞' : fmtNum(b.available, 1)}</b><span>${esc(b.type)} left${b.available === null ? ' (unpaid)' : ` · ${fmtNum(b.accrued + b.opening, 1)} credited, ${fmtNum(b.used, 1)} used${b.pending ? `, ${fmtNum(b.pending, 1)} pending` : ''}`}</span></div>`).join('')}</div>` : ''}
    ${group('Apply for leave', `<div class="card stack">
      <div class="grid2">${field('From', input('lv-from', F('lv-from', todayISO()), { type: 'date' }), { required: true })}${field('To', input('lv-to', F('lv-to', todayISO()), { type: 'date' }), { required: true })}</div>
      <div class="grid2">${field('Type', select('lv-type', F('lv-type', types[0]), types), { required: true })}${field('Reason', input('lv-reason', F('lv-reason'), { placeholder: 'Optional' }), { help: 'Your manager sees this.' })}</div>
      <button type="button" class="btn primary wide" data-action="leaveApply">Apply</button>
    </div>`)}
    ${group('My leave', list === null ? spinner() : list.error ? errorBox(list.error) : list.rows.length ? dataTable({ id: 'my-leave', rows: list.rows, pageSize: 10,
      filters: [{ key: 'st', label: 'Status', options: [['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected']], match: (l, v) => l.status === v }],
      columns: [{ key: 'from_date', label: 'Dates', render: (l) => `${esc(fmtDate(l.from_date, false))}${l.to_date !== l.from_date ? ` to ${esc(fmtDate(l.to_date, false))}` : ''}` },
        { key: 'type', label: 'Type' }, { key: 'days', label: 'Days', align: 'right', value: (l) => l.days || 0, render: (l) => fmtNum(l.days || 0, 1) },
        { key: 'reason', label: 'Note', phone: false, render: (l) => esc([l.reason, l.decision_note, l.status === 'pending' && l.waiting ? `with ${l.waiting}` : ''].filter(Boolean).join(' · ') || '–') },
        { key: 'status', label: 'Status', render: (l) => statusTag(l.status) }],
      phoneRow: (l) => `<div class="lrow-static row"><span class="tx" style="flex:1"><b>${esc(l.type)} · ${esc(fmtDate(l.from_date, false))}${l.to_date !== l.from_date ? ` to ${esc(fmtDate(l.to_date, false))}` : ''}</b><span class="muted" style="font-size:14px;display:block">${fmtNum(l.days || 0, 1)} working day${l.days === 1 ? '' : 's'}${l.reason ? ` · ${esc(l.reason)}` : ''}${l.decision_note ? ` · ${esc(l.decision_note)}` : ''}${l.status === 'pending' && l.waiting ? ` · with ${esc(l.waiting)}` : ''}</span></span>${statusTag(l.status)}</div>` })
      : emptyState('sun', 'No leave requests yet', 'Apply above; your manager is told at once.'))}`;
};
Actions.leaveApply = async () => {
  try {
    await api('/api/leaves', { json: { from: F('lv-from', todayISO()), to: F('lv-to', todayISO()), type: F('lv-type', KL.boot.leaveTypes[0]), reason: F('lv-reason', '') } });
    clearF('lv-reason'); invalidate('leaves', 'hr:balances'); toast('Leave request sent to your manager'); render();
  } catch (e) { toast(e.message, 'error'); }
};
