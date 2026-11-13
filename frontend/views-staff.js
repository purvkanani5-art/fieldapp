/* Managers, HR and admin: dashboard, approvals, team, HR desk, administration. */

Views.manage = () => {
  const pend = KL.me?.pendingApprovals || 0;
  const rows = [
    lrow({ href: '#dashboard', icon: 'chart', tone: 'green', title: 'Dashboard', sub: 'Who is on site, stock, travel spend, farmers' }),
    lrow({ href: '#approvals', icon: 'check', tone: pend ? 'amber' : '', title: 'Approvals', sub: 'Trips, check-in exceptions, leave', right: pend ? tag(String(pend), 'warn') : '' }),
    lrow({ href: '#team', icon: 'users', tone: 'blue', title: 'Team activity', sub: 'Attendance, trips and daily updates of everyone' }),
    ['admin', 'hr'].includes(KL.user.role) ? lrow({ href: '#hrdesk', icon: 'folder', tone: 'amber', title: 'HR desk', sub: 'Complaints, suggestions, employee documents' }) : '',
    ['admin', 'manager', 'hr'].includes(KL.user.role) ? lrow({ href: '#admin', icon: 'cog', title: 'Administration', sub: 'Users, sites, registers, templates, company' }) : '',
  ].join('');
  return `<h1 class="large">Manage</h1><p class="sub">${esc(KL.user.designation || KL.user.role)}</p><div class="card flush">${rows}</div>`;
};

/* ---------------------------------------------------------------- Dashboard */
Views.dashboardBody = () => {
  const d = data('dashboard', () => api('/api/dashboard'));
  if (d === null) return spinner();
  if (d.error) return errorBox(d.error);
  const low = d.stock.filter((s) => s.low);
  return `
    <div class="tiles">
      <div class="tile ok"><b>${d.onSite.length}</b><span>on site now</span></div>
      <div class="tile"><b>${d.todayAttendance}/${d.fieldTotal}</b><span>field staff checked in today</span></div>
      <div class="tile ${KL.me?.pendingApprovals ? 'warn' : ''}"><b>${KL.me?.pendingApprovals || 0}</b><span>awaiting approval</span></div>
      <div class="tile ${low.length ? 'bad' : ''}"><b>${low.length}</b><span>low-stock items</span></div>
      <div class="tile"><b>${esc(rupees(d.travelMonth.amt))}</b><span>travel approved this month (${fmtNum(d.travelMonth.km)} km)</span></div>
      <div class="tile"><b>${d.farmers}</b><span>farmers · ${d.docsWeek} signed this week</span></div>
    </div>
    ${d.onSite.length ? `<div class="card flush" style="margin-top:10px">${d.onSite.map((a) => `<div class="lrow-static row"><span class="icon green">${ic('pin')}</span><span class="tx" style="flex:1"><b>${esc(a.user_name)}</b><span class="muted" style="font-size:13px;display:block">${esc(a.site_name)} · since ${esc(fmtDate(a.checkin_at).split(', ')[1] || fmtDate(a.checkin_at))} · ${esc(duration(a.checkin_at))}</span></span>${a.status === 'pending' ? tag('exception', 'warn') : ''}</div>`).join('')}</div>` : ''}
    ${low.length ? `<div class="banner bad" style="margin-top:10px"><b>Low stock</b><p>${low.map((s) => `${esc(s.item)} at ${esc(s.site)}: ${fmtNum(s.balance, 1)} ${esc(s.unit)}`).join(' · ')}</p></div>` : ''}
    <p class="hint" style="margin-top:8px">${d.updatesToday} daily update${d.updatesToday === 1 ? '' : 's'} today · ${d.openFeedback} open complaint${d.openFeedback === 1 ? '' : 's'}/suggestion${d.openFeedback === 1 ? '' : 's'} · <a href="#approvals">Approvals</a> · <a href="#team">Team</a></p>`;
};
Views.dashboard = () => {
  const d = KL.cache.dashboard;
  const stock = d && !d.error ? d.stock : [];
  const bySite = {};
  for (const s of stock) (bySite[s.site] ||= []).push(s);
  return `${topbar('Dashboard', '#manage', '<button type="button" class="btn small ghost" data-action="refreshDash">↻</button>')}${Views.dashboardBody()}
    ${Object.keys(bySite).length ? group('Stock by site', Object.entries(bySite).map(([site, items]) => `<div class="card" style="margin-top:8px"><b>${esc(site)}</b><div class="kv" style="margin-top:6px">${items.map((i) => `<span>${esc(i.item)}</span><span class="${i.low ? 'muted' : ''}" style="${i.low ? 'color:var(--red)' : ''}">${fmtNum(i.balance, 1)} ${esc(i.unit)}${i.low ? ' · low' : ''}</span>`).join('')}</div></div>`).join('')) : ''}`;
};
Actions.refreshDash = () => { invalidate('dashboard'); refreshMe().then(render); render(); };

/* ---------------------------------------------------------------- Approvals */
Views.approvals = () => {
  const a = data('approvals', () => api('/api/approvals'));
  if (a === null) return `${topbar('Approvals', '#manage')}${spinner()}`;
  if (a.error) return `${topbar('Approvals', '#manage')}${errorBox(a.error)}`;
  const trips = a.trips.map((t) => `<div class="card stack">
      <div class="row between"><div><b>${esc(t.user_name)}</b><p class="hint">${esc(t.vehicle)} · ${esc(fmtDate(t.start_at))} → ${esc(fmtDate(t.end_at))}${t.site_name ? ` · ${esc(t.site_name)}` : ''}${t.purpose ? ` · ${esc(t.purpose)}` : ''}</p></div><b class="big mono">${esc(rupees(t.amount))}</b></div>
      <div class="kv"><span>Odometer</span><span>${fmtNum(t.start_reading)} → ${fmtNum(t.end_reading)} km</span><span>Claimed</span><span>${fmtNum(t.km_claimed, 1)} km × ${esc(KL.boot.travel.currency)}${t.rate_per_km}</span><span>Straight line between GPS points</span><span>${t.km_straight !== null ? `${fmtNum(t.km_straight, 1)} km${t.km_straight && t.km_claimed / Math.max(t.km_straight, 0.1) > 3 ? ' ⚠' : ''}` : '–'}</span></div>
      <div class="grid2">${authImg(t.start_file, 'thumb lg')}${authImg(t.end_file, 'thumb lg')}</div>
      <div class="btns"><button type="button" class="btn danger" data-action="decide" data-kind="trips" data-id="${esc(t.id)}" data-decision="rejected">Reject</button><button type="button" class="btn primary" data-action="decide" data-kind="trips" data-id="${esc(t.id)}" data-decision="approved">Approve</button></div>
    </div>`);
  const att = a.attendance.map((x) => `<div class="card stack">
      <div class="row between"><div><b>${esc(x.user_name)}</b><p class="hint">${esc(x.site_name)} · ${esc(fmtDate(x.checkin_at))}${x.checkout_at ? ` → ${esc(fmtDate(x.checkout_at).split(', ')[1] || '')}` : ''}</p></div>${tag(`${fmtNum(x.checkin_dist)} m away`, 'warn')}</div>
      <p class="hint">Allowed ${x.radius_m} m. Reason: <b>${esc(x.override_reason || '–')}</b></p>
      <div class="grid2">${authImg(x.checkin_file, 'thumb lg')}${x.checkout_file ? authImg(x.checkout_file, 'thumb lg') : ''}</div>
      <div class="btns"><button type="button" class="btn danger" data-action="decide" data-kind="attendance" data-id="${esc(x.id)}" data-decision="rejected">Reject</button><button type="button" class="btn primary" data-action="decide" data-kind="attendance" data-id="${esc(x.id)}" data-decision="ok">Accept</button></div>
    </div>`);
  const lv = a.leaves.map((l) => `<div class="card stack">
      <div class="row between"><div><b>${esc(l.user_name)}</b><p class="hint">${esc(l.type)} · ${esc(fmtDate(l.from_date, false))}${l.to_date !== l.from_date ? ` to ${esc(fmtDate(l.to_date, false))}` : ''}${l.reason ? ` · ${esc(l.reason)}` : ''}</p></div></div>
      <div class="btns"><button type="button" class="btn danger" data-action="decide" data-kind="leaves" data-id="${esc(l.id)}" data-decision="rejected">Reject</button><button type="button" class="btn primary" data-action="decide" data-kind="leaves" data-id="${esc(l.id)}" data-decision="approved">Approve</button></div>
    </div>`);
  const empty = '<div class="card"><p class="empty">Nothing waiting.</p></div>';
  return `${topbar('Approvals', '#manage')}
    ${group('Travel claims', trips.length ? `<div class="stack">${trips.join('')}</div>` : empty, String(trips.length))}
    ${group('Check-in exceptions', att.length ? `<div class="stack">${att.join('')}</div>` : empty, String(att.length))}
    ${group('Leave requests', lv.length ? `<div class="stack">${lv.join('')}</div>` : empty, String(lv.length))}`;
};
Actions.decide = async (el) => {
  const { kind, id, decision } = el.dataset;
  const reject = decision === 'rejected';
  const v = await modal({ title: reject ? 'Reject with a reason' : 'Approve', fields: [{ key: 'note', label: reject ? 'Reason (the employee sees this)' : 'Note (optional)', type: 'textarea' }], confirmText: reject ? 'Reject' : 'Approve', danger: reject });
  if (!v) return;
  if (reject && !v.note) return toast('Give a reason for rejecting', 'error');
  try {
    await api(`/api/${kind}/${id}/decide`, { json: { decision, note: v.note } });
    invalidate('approvals', 'dashboard', 'trips', 'attendance', 'leaves'); await refreshMe(); toast(reject ? 'Rejected' : 'Approved'); render();
  } catch (e) { toast(e.message, 'error'); }
};

/* ---------------------------------------------------------------- Team */
Views.team = () => {
  const tab = F('team-tab', 'attendance');
  const att = tab === 'attendance' ? data('attendance:team', () => api('/api/attendance?scope=team&days=7')) : null;
  const trips = tab === 'trips' ? data('trips:team', () => api('/api/trips?scope=team')) : null;
  const upd = tab === 'updates' ? data('updates:team', () => api('/api/updates?scope=team&days=7')) : null;
  let body = '';
  if (tab === 'attendance') body = att === null ? spinner() : att.error ? errorBox(att.error) : att.rows.length ? `<div class="card flush">${att.rows.map((a) => attRow(a, true)).join('')}</div>` : '<div class="card"><p class="empty">No check-ins in 7 days.</p></div>';
  if (tab === 'trips') body = trips === null ? spinner() : trips.error ? errorBox(trips.error) : trips.rows.length ? `<div class="card flush">${trips.rows.filter((t) => t.status !== 'open').map((t) => tripRow(t, true)).join('')}</div>` : '<div class="card"><p class="empty">No trips yet.</p></div>';
  if (tab === 'updates') body = upd === null ? spinner() : upd.error ? errorBox(upd.error) : upd.rows.length ? `<div class="card flush">${upd.rows.map((r) => `<div class="lrow-static"><b>${esc(r.user_name)} · ${esc(fmtDate(r.date, false))}${r.hours ? ` · ${r.hours} h` : ''}${r.site_name ? ` · ${esc(r.site_name)}` : ''}</b><p class="hint" style="white-space:pre-wrap;margin-top:2px">${esc(r.summary)}</p>${r.blockers ? `<p class="hint" style="color:var(--amber)">Blocker: ${esc(r.blockers)}</p>` : ''}</div>`).join('')}</div>` : '<div class="card"><p class="empty">No updates in 7 days.</p></div>';
  return `${topbar('Team activity', '#manage')}
    <div class="seg">${[['attendance', 'Attendance'], ['trips', 'Trips'], ['updates', 'Updates']].map(([k, l]) => `<button type="button" data-action="teamTab" data-tab="${k}" aria-pressed="${tab === k}">${l}</button>`).join('')}</div>
    <div style="margin-top:10px">${body}</div>`;
};
Actions.teamTab = (el) => { setF('team-tab', el.dataset.tab); render(); };

/* ---------------------------------------------------------------- HR desk */
Views.hrdesk = () => {
  const fb = data('feedback:all', () => api('/api/feedback'));
  const lv = data('leaves:team', () => api('/api/leaves?scope=team'));
  const users = data('admin:users', () => api('/api/admin/users'));
  return `${topbar('HR desk', '#manage')}
    ${group('Employee documents', `<div class="card stack"><p class="hint">Upload a payslip, letter or ID document; the employee sees it under Me → My documents and gets a notification.</p>
      ${users === null ? spinner() : users.error ? errorBox(users.error) : field('Employee', select('hr-user', F('hr-user', ''), users.rows.filter((u) => u.active).map((u) => [u.id, `${u.employee_id} · ${u.name}`]), { blank: 'Choose' }))}
      <div class="grid2">${field('Title', input('hr-title', F('hr-title'), { placeholder: 'e.g. Payslip October 2026' }))}${field('Category', select('hr-cat', F('hr-cat', 'Payslip'), ['Payslip', 'Offer letter', 'Appointment letter', 'ID card', 'Policy', 'Form 16', 'Other']))}</div>
      <button type="button" class="btn primary wide" data-action="hrUpload">Choose file and upload</button></div>`)}
    ${group('Complaints & suggestions', fb === null ? spinner() : fb.error ? errorBox(fb.error) : fb.rows.length ? `<div class="stack">${fb.rows.map((r) => `<div class="card"><div class="row between"><b>${ic(r.type === 'complaint' ? 'alert' : 'bulb')} ${esc(r.type === 'complaint' ? 'Complaint' : 'Suggestion')} · ${esc(r.user_name || 'Anonymous')}</b>${statusTag(r.status)}</div><p class="hint" style="white-space:pre-wrap;margin:4px 0">${esc(r.text)}</p><p class="hint">${esc(fmtDate(r.created_at))}</p>${r.response ? `<div class="banner info"><b>Reply</b><p>${esc(r.response)}</p></div>` : `<button type="button" class="btn small" data-action="fbRespond" data-id="${esc(r.id)}" style="margin-top:6px">Reply & close</button>`}</div>`).join('')}</div>` : '<div class="card"><p class="empty">Nothing received.</p></div>', fb && !fb.error ? `${fb.rows.filter((r) => r.status === 'open').length} open` : '')}
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
Actions.fbRespond = async (el) => {
  const v = await modal({ title: 'Reply', fields: [{ key: 'response', label: 'Your reply (the employee sees it unless anonymous)', type: 'textarea' }, { key: 'status', label: 'Status', type: 'select', options: ['closed', 'in_progress'], value: 'closed' }], confirmText: 'Send' });
  if (!v) return;
  try { await api(`/api/feedback/${el.dataset.id}/respond`, { json: v }); invalidate('feedback'); toast('Replied'); render(); } catch (e) { toast(e.message, 'error'); }
};

/* ---------------------------------------------------------------- Admin */
Views.admin = (arg) => {
  if (arg === 'users') return adminUsers();
  if (arg === 'sites') return adminSites();
  if (arg === 'items') return adminItems();
  if (arg === 'templates') return adminTemplates();
  if (arg === 'company') return adminCompany();
  if (arg === 'audit') return adminAudit();
  const admin = isAdmin(), hr = KL.user.role === 'hr', mgr = KL.user.role === 'manager';
  return `${topbar('Administration', '#manage')}<div class="card flush">
    ${admin || hr ? lrow({ href: '#admin/users', icon: 'user', tone: 'green', title: 'Users & PINs', sub: 'Add staff, roles, sites, reset a PIN' }) : ''}
    ${admin || mgr ? lrow({ href: '#admin/sites', icon: 'pin', tone: 'blue', title: 'Sites & geofences', sub: 'Location, allowed radius' }) : ''}
    ${admin || mgr ? lrow({ href: '#admin/items', icon: 'box', tone: 'amber', title: 'Register items', sub: 'Diesel, biomass, outputs per site, low-stock alerts' }) : ''}
    ${admin || mgr ? lrow({ href: '#admin/templates', icon: 'doc', title: 'Document templates', sub: 'Text and fields of the documents farmers sign' }) : ''}
    ${admin ? lrow({ href: '#admin/company', icon: 'building', title: 'Company & rates', sub: 'Name, address, travel rates, authorised signature' }) : ''}
    ${admin ? lrow({ href: '#admin/audit', icon: 'receipt', title: 'Audit log', sub: 'Who did what, when' }) : ''}
  </div>`;
};
function adminUsers() {
  const users = data('admin:users', () => api('/api/admin/users'));
  return `${topbar('Users & PINs', '#admin', '<button type="button" class="btn small primary" data-action="userEdit">+ Add</button>')}
    ${users === null ? spinner() : users.error ? errorBox(users.error) : `<div class="card flush">${users.rows.map((u) => lrow({ action: 'userEdit', data: { id: u.id }, icon: { admin: 'shield', manager: 'compass', hr: 'folder', field: 'sprout' }[u.role] || 'user', tone: u.active ? '' : 'red', title: `${u.name}${u.active ? '' : ' (inactive)'}`, sub: `${esc(u.employee_id)} · ${esc(u.role)}${u.designation ? ` · ${esc(u.designation)}` : ''} · ${u.sites.map(siteName).map(esc).join(', ') || 'all sites'}${u.must_change_pin ? ' · starting PIN' : ''}` })).join('')}</div>`}`;
}
Actions.userEdit = async (el) => {
  const users = KL.cache['admin:users'];
  const u = el.dataset.id ? users.rows.find((x) => x.id === el.dataset.id) : null;
  const siteOpts = KL.boot.sites.map((s) => s.name);
  const v = await modal({ title: u ? `Edit ${u.name}` : 'New employee', fields: [
    { key: 'employee_id', label: 'Employee ID', value: u?.employee_id || '', placeholder: 'EMP104' }, { key: 'name', label: 'Full name', value: u?.name || '' },
    { key: 'role', label: 'Role', type: 'select', options: isAdmin() ? ['field', 'manager', 'hr', 'admin'] : ['field', 'manager', 'hr'], value: u?.role || 'field' },
    { key: 'designation', label: 'Designation', value: u?.designation || '' }, { key: 'phone', label: 'Mobile', type: 'tel', value: u?.phone || '' }, { key: 'email', label: 'Email (if any, for Microsoft sign-in later)', type: 'email', value: u?.email || '' },
    { key: 'sites', label: 'Sites (comma-separated names, blank = all)', value: (u?.sites || []).map(siteName).join(', '), placeholder: siteOpts.join(', ') },
    ...(u ? [{ key: 'active', label: 'Status', type: 'select', options: ['active', 'inactive'], value: u.active ? 'active' : 'inactive' }] : [{ key: 'pin', label: 'Starting PIN (4–6 digits, employee changes it)', value: '1234', inputmode: 'numeric' }]),
  ], confirmText: u ? 'Save' : 'Create' });
  if (!v) return;
  const sites = v.sites ? v.sites.split(',').map((n) => KL.boot.sites.find((s) => s.name.toLowerCase() === n.trim().toLowerCase())?.id).filter(Boolean) : [];
  try {
    await api('/api/admin/users', { json: { ...v, id: u?.id, sites, active: u ? v.active === 'active' : true } });
    invalidate('admin:users'); toast(u ? 'Saved' : `Created. Starting PIN ${v.pin}`); render();
    if (u && (await modal({ title: 'Reset PIN too?', message: 'Signs the employee out of every phone and sets a new starting PIN.', confirmText: 'Reset PIN', cancelText: 'No' }))) {
      const p = await modal({ title: 'New starting PIN', fields: [{ key: 'pin', label: 'PIN (4–6 digits)', value: '1234', inputmode: 'numeric' }], confirmText: 'Reset' });
      if (p) { await api(`/api/admin/users/${u.id}/reset-pin`, { json: { pin: p.pin } }); toast('PIN reset'); }
    }
  } catch (e) { toast(e.message, 'error'); }
};
function adminSites() {
  return `${topbar('Sites & geofences', '#admin', '<button type="button" class="btn small primary" data-action="siteEdit">+ Add</button>')}
    <div class="card flush">${KL.boot.sites.map((s) => lrow({ action: 'siteEdit', data: { id: s.id }, icon: PROJECT_ICON[s.project_type] || 'pin', title: s.name, sub: `${esc(s.project_type)} · ${s.lat.toFixed(5)}, ${s.lng.toFixed(5)} · radius ${s.radius_m} m${s.address ? ` · ${esc(s.address)}` : ''}` })).join('')}</div>
    <p class="hint" style="margin-top:8px">Stand at the centre of the site and tap "Use my location" in the form to set the coordinates. Radius is how far from the centre a check-in still counts.</p>`;
}
Actions.siteEdit = async (el) => {
  const s = el.dataset.id ? KL.boot.sites.find((x) => x.id === el.dataset.id) : null;
  const g = KL.ui.gps;
  const v = await modal({ title: s ? `Edit ${s.name}` : 'New site', fields: [
    { key: 'name', label: 'Name', value: s?.name || '' }, { key: 'project_type', label: 'Project type', type: 'select', options: ['biochar', 'agroforestry', 'gasifier', 'office', 'other'], value: s?.project_type || 'biochar' },
    { key: 'lat', label: `Latitude${g ? ' (your location is ' + g.lat.toFixed(5) + ')' : ''}`, value: s?.lat ?? g?.lat?.toFixed(6) ?? '', inputmode: 'decimal' }, { key: 'lng', label: 'Longitude', value: s?.lng ?? g?.lng?.toFixed(6) ?? '', inputmode: 'decimal' },
    { key: 'radius_m', label: 'Allowed radius (m)', value: s?.radius_m ?? 150, inputmode: 'numeric' }, { key: 'address', label: 'Address', value: s?.address || '' },
    ...(s ? [{ key: 'active', label: 'Status', type: 'select', options: ['active', 'inactive'], value: s.active ? 'active' : 'inactive' }] : []),
  ], confirmText: 'Save' });
  if (!v) return;
  try { await api('/api/admin/sites', { json: { ...v, id: s?.id, active: s ? v.active === 'active' : true } }); await reloadBoot(); toast('Saved'); render(); } catch (e) { toast(e.message, 'error'); }
};
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
      ${field('Travel rates per km, one per line: Vehicle | rate', textarea('co-rates', F('co-rates', Object.entries(tr.vehicles).map(([k, v]) => `${k} | ${v}`).join('\n'))))}
      ${field('Leave types, comma-separated', input('co-leave', F('co-leave', (KL.boot.leaveTypes || []).join(', '))))}
      <button type="button" class="btn primary wide" data-action="companySave">Save</button>
    </div>
    <div class="card stack" style="margin-top:10px"><b>Authorised signature</b><p class="hint">A PNG of the director's signature with a transparent or white background. It is placed in the company's box on every farmer document.</p><button type="button" class="btn" data-action="companySig">Upload signature image</button></div>`;
}
Actions.companySave = async () => {
  const c = KL.boot.company, tr = KL.boot.travel;
  const ratesDefault = Object.entries(tr.vehicles).map(([k, v]) => `${k} | ${v}`).join('\n');
  const vehicles = {};
  for (const line of F('co-rates', ratesDefault).split('\n')) { const [k, v] = line.split('|').map((x) => x && x.trim()); if (k && v !== undefined && !Number.isNaN(Number(v))) vehicles[k] = Number(v); }
  try {
    await api('/api/admin/settings', { json: { company: { name: F('co-name', c.name), short: F('co-short', c.short || ''), address: F('co-address', c.address || '') }, travel: { ...tr, vehicles }, leave_types: F('co-leave', (KL.boot.leaveTypes || []).join(', ')).split(',').map((x) => x.trim()).filter(Boolean) } });
    await reloadBoot(); toast('Saved'); render();
  } catch (e) { toast(e.message, 'error'); }
};
Actions.companySig = () => pickFile('image/png,image/jpeg', async (file) => { const form = new FormData(); form.append('file', file, file.name); try { await api('/api/admin/company-signature', { form }); toast('Signature updated'); } catch (e) { toast(e.message, 'error'); } });
function adminAudit() {
  const a = data('admin:audit', () => api('/api/admin/audit'));
  return `${topbar('Audit log', '#admin')}${a === null ? spinner() : a.error ? errorBox(a.error) : `<div class="card flush">${a.rows.map((r) => `<div class="lrow-static"><b>${esc(r.action)}</b> <span class="muted">${esc(r.entity)}${r.detail ? ` · ${esc(r.detail)}` : ''}</span><br/><span class="hint">${esc(r.user_name || 'system')} · ${esc(fmtDate(r.at))}</span></div>`).join('')}</div>`}`;
}
async function reloadBoot() { try { KL.boot = await api('/api/bootstrap'); } catch { /* keep */ } }
