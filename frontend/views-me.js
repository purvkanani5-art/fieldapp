/* Me (HR self-service), Inbox, daily updates, leave, complaints & suggestions, PIN. */

Views.me = () => {
  const u = KL.user;
  const docs = data('hrdocs:mine', () => api('/api/hr/documents'));
  const leaves = data('leaves:mine', () => api('/api/leaves'));
  const pendingLeaves = leaves && !leaves.error ? leaves.rows.filter((l) => l.status === 'pending').length : 0;
  return `<h1 class="large">Me</h1><p class="sub">${esc(u.name)} · ${esc(u.employee_id)} · ${esc(u.designation || u.role)}</p>
    ${u.must_change_pin ? `<div class="banner warn"><b>Change your PIN</b><p>HR gave you a starting PIN. Set your own 6-digit PIN now.</p><button type="button" class="btn small" data-action="changePin" style="margin-top:8px">Change PIN</button></div>` : ''}
    ${group('My documents', docs === null ? spinner() : docs.error ? errorBox(docs.error) : docs.rows.length ? `<div class="card flush">${docs.rows.map((d) => `<div class="lrow-static row"><span class="icon blue">${ic('doc')}</span><span class="tx" style="flex:1"><b>${esc(d.title)}</b><span class="muted" style="font-size:13px;display:block">${esc(d.category)} · ${esc(fmtDate(d.created_at, false))}</span></span>${fileLink(d.file_id)}</div>`).join('')}</div>` : '<div class="card"><p class="empty">Payslips, letters and ID documents appear here when HR uploads them.</p></div>', 'From HR')}
    ${group('Requests & forms', `<div class="card flush">
      ${lrow({ href: '#updates', icon: 'note', title: 'Daily work update', sub: 'Today and the last two weeks' })}
      ${lrow({ href: '#leaves', icon: 'sun', tone: 'blue', title: 'Leave', sub: pendingLeaves ? `${pendingLeaves} request${pendingLeaves === 1 ? '' : 's'} pending` : 'Apply and see past leave' })}
      ${lrow({ href: '#feedback', icon: 'chat', tone: 'amber', title: 'Complaints & suggestions', sub: 'To HR, with your name or anonymously' })}
      ${lrow({ href: '#attendance', icon: 'pin', tone: 'green', title: 'My attendance', sub: 'Check-ins of the last 31 days' })}
      ${lrow({ href: '#trips', icon: 'bike', title: 'My travel claims', sub: 'Approved, pending and rejected' })}
    </div>`)}
    ${group('Account', `<div class="card flush">
      ${lrow({ action: 'changePin', icon: 'lock', title: 'Change PIN', sub: '6 digits, known only to you' })}
      ${lrow({ action: 'flushOutbox', icon: 'upload', title: 'Send saved items now', sub: KL.outboxCount ? `${KL.outboxCount} waiting` : 'Nothing waiting' })}
      ${lrow({ action: 'logout', icon: 'logout', tone: 'red', title: 'Sign out', sub: 'On this phone' })}
    </div>
    <p class="hint" style="margin-top:10px;text-align:center">Kshetralekha prototype v${esc(KL.me?.version || '')} · ${esc(KL.boot?.company?.name || '')}</p>`)}`;
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
Views.inbox = () => {
  const box = data('inbox', () => api('/api/inbox'));
  if (box && !box.error && box.rows.some((n) => !n.read)) {
    api('/api/inbox/read', { json: {} }).then(() => { if (KL.me) KL.me.unread = 0; const tab = $('.tabbar .badge'); if (tab) tab.remove(); }).catch(() => {});
  }
  return `<h1 class="large">Inbox</h1><p class="sub">Approvals, replies and alerts</p>
    ${box === null ? spinner() : box.error ? errorBox(box.error) : box.rows.length ? `<div class="card flush">${box.rows.map((n) => lrow({ href: n.link || '#home', icon: n.read ? '•' : 'bell', tone: n.read ? '' : 'green', title: n.title, sub: `${esc(n.body)}${n.body ? ' · ' : ''}${esc(timeAgo(n.created_at))}`, chev: Boolean(n.link) })).join('')}</div>` : '<div class="card"><p class="empty">Nothing yet.</p></div>'}`;
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
    ${group('Last two weeks', list === null ? spinner() : list.error ? errorBox(list.error) : list.rows.length ? `<div class="card flush">${list.rows.map((r) => `<div class="lrow-static"><b>${esc(fmtDate(r.date, false))}${r.hours ? ` · ${r.hours} h` : ''}${r.site_name ? ` · ${esc(r.site_name)}` : ''}</b><p class="hint" style="white-space:pre-wrap;margin-top:2px">${esc(r.summary)}</p>${r.blockers ? `<p class="hint" style="color:var(--amber)">Blocker: ${esc(r.blockers)}</p>` : ''}</div>`).join('')}</div>` : '<div class="card"><p class="empty">No updates yet.</p></div>')}`;
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
  return `${topbar('Leave', '#me')}
    <div class="card stack">
      <div class="grid2">${field('From', input('lv-from', F('lv-from', todayISO()), { type: 'date' }))}${field('To', input('lv-to', F('lv-to', todayISO()), { type: 'date' }))}</div>
      <div class="grid2">${field('Type', select('lv-type', F('lv-type', types[0]), types))}${field('Reason', input('lv-reason', F('lv-reason'), { placeholder: 'optional' }))}</div>
      <button type="button" class="btn primary wide" data-action="leaveApply">Apply</button>
    </div>
    ${group('My leave', list === null ? spinner() : list.error ? errorBox(list.error) : list.rows.length ? `<div class="card flush">${list.rows.map((l) => `<div class="lrow-static row"><span class="tx" style="flex:1"><b>${esc(l.type)} · ${esc(fmtDate(l.from_date, false))}${l.to_date !== l.from_date ? ` to ${esc(fmtDate(l.to_date, false))}` : ''}</b><span class="muted" style="font-size:13px;display:block">${esc(l.reason || '')}${l.decision_note ? ` · ${esc(l.decision_note)}` : ''}</span></span>${statusTag(l.status)}</div>`).join('')}</div>` : '<div class="card"><p class="empty">No leave requests yet.</p></div>')}`;
};
Actions.leaveApply = async () => {
  try {
    await api('/api/leaves', { json: { from: F('lv-from', todayISO()), to: F('lv-to', todayISO()), type: F('lv-type', KL.boot.leaveTypes[0]), reason: F('lv-reason', '') } });
    clearF('lv-reason'); invalidate('leaves'); toast('Leave request sent'); render();
  } catch (e) { toast(e.message, 'error'); }
};

/* ---------------------------------------------------------------- Complaints & suggestions */
Views.feedback = () => {
  const list = data('feedback:mine', () => api('/api/feedback'));
  const type = F('fb-type', 'suggestion');
  return `${topbar('Complaints & suggestions', '#me')}
    <div class="card stack">
      <div class="seg"><button type="button" data-action="fbType" data-type="suggestion" aria-pressed="${type === 'suggestion'}">Suggestion</button><button type="button" data-action="fbType" data-type="complaint" aria-pressed="${type === 'complaint'}">Complaint</button></div>
      ${textarea('fb-text', F('fb-text'), type === 'complaint' ? 'Describe what happened, when and where. HR reads every complaint.' : 'What would make work better?')}
      <label class="check"><input type="checkbox" id="fb-anon" ${F('fb-anon') ? 'checked' : ''} data-change="fbAnon" /> <span>Send anonymously (HR will not see your name and cannot reply to you)</span></label>
      <button type="button" class="btn primary wide" data-action="fbSend">Send to HR</button>
    </div>
    ${group('Sent by me', list === null ? spinner() : list.error ? errorBox(list.error) : list.rows.length ? `<div class="card flush">${list.rows.map((r) => `<div class="lrow-static"><div class="row between"><b>${esc(r.type === 'complaint' ? 'Complaint' : 'Suggestion')} · ${esc(fmtDate(r.created_at, false))}</b>${statusTag(r.status)}</div><p class="hint" style="white-space:pre-wrap;margin-top:2px">${esc(r.text)}</p>${r.response ? `<div class="banner info" style="margin-top:6px"><b>HR replied</b><p>${esc(r.response)}</p></div>` : ''}</div>`).join('')}</div>` : '<div class="card"><p class="empty">Anonymous items are not listed here.</p></div>')}`;
};
Actions.fbType = (el) => { setF('fb-type', el.dataset.type); render(); };
Changes.fbAnon = (el) => setF('fb-anon', el.checked);
Actions.fbSend = async () => {
  try {
    await api('/api/feedback', { json: { type: F('fb-type', 'suggestion'), text: F('fb-text', ''), anonymous: Boolean(F('fb-anon')) } });
    clearF('fb-text', 'fb-anon'); invalidate('feedback'); toast('Sent to HR'); render();
  } catch (e) { toast(e.message, 'error'); }
};
