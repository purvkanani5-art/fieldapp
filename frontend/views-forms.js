/* Quick ways to add things (2026-11-19): the office "+ New" picker, one page for a whole employee (job, personal,
   employment, IDs and bank, documents) and one page for a site with its geofence on a map. */

/* ---------------------------------------------------------------- "+ New" for director, HR and managers */
/** What this person may add, in the order people need it most. */
function newTiles() {
  const hrRole = ['admin', 'hr'].includes(KL.user.role);
  return [
    can('users.add') && { icon: 'user', label: 'Employee', href: '#empnew' },
    can('sites.edit') && { icon: 'pin', label: 'Site', href: '#sitenew' },
    { icon: 'kanban', label: 'Task', href: '#planner' },
    can('planner.plans') && { icon: 'list', label: 'Plan', action: 'planEdit' },
    can('hr.notices') && { icon: 'bell', label: 'Notice', href: '#noticenew' },
    can('hr.surveys') && { icon: 'chart', label: 'Survey', href: '#surveynew' },
    hrRole && { icon: 'calendar', label: 'Holiday', href: '#rec/holiday/new' },
    hasFarmerSite() && { icon: 'sprout', label: 'Farmer', href: '#farmers', action: 'farmerAdd' },
    { icon: 'bike', label: KL.me?.openTrip ? 'End trip' : 'Travel', href: '#trips' },
    { icon: 'receipt', label: 'Expense', href: '#rec/expense/new' },
    { icon: 'sun', label: 'Leave', href: '#leaves' },
    { icon: 'alert', label: 'Incident', href: '#rec/incident/new' },
    { icon: 'flag', label: 'Escalation', href: '#escalate' },
  ].filter(Boolean);
}
const newTile = (x) => `<button type="button" class="fa-tile" data-action="newGo" ${x.href ? `data-href="${esc(x.href)}"` : ''} ${x.action ? `data-act="${esc(x.action)}"` : ''}>${ic(x.icon)}<span>${esc(x.label)}</span></button>`;
Actions.newOpen = () => {
  data('m:kinds', () => api('/api/m/kinds')); // for "More…"
  modal({ title: 'Add new', html: `<div class="fa-tiles">${newTiles().map(newTile).join('')}</div>`, noButtons: true });
};
Actions.newGo = (el) => {
  KL.closeModal?.(null);
  const act = el.dataset.act;
  if (act === 'farmerAdd' && el.dataset.href) { location.hash = el.dataset.href; setTimeout(() => Actions.farmerAdd?.({ dataset: {} }), 400); return; }
  if (act) { setTimeout(() => Actions[act]?.({ dataset: {} }), 50); return; }
  if (el.dataset.href?.startsWith('#rec/')) { const k = el.dataset.href.split('/')[1]; clearRecForm(k); KL.ui.recInit = null; }
  location.hash = el.dataset.href;
};
/** Every record type this person may make, grouped like the Records tabs. */
Actions.newMore = () => {
  const kd = KL.cache['m:kinds'];
  if (!kd || kd.error) { location.hash = '#hub/ops'; return; }
  const groups = { hr: 'People', money: 'Money', ops: 'Safety & equipment', carbon: 'Production & carbon', supply: 'Purchasing & supply' };
  const list = Object.values(kd.kinds).filter((k) => k.canCreate && !k.hidden && k.key !== 'profile' && k.key !== 'policy_ack' && k.key !== 'checklist_run');
  const html = Object.entries(groups).map(([g, label]) => {
    const ks = list.filter((k) => k.group === g);
    return ks.length ? `<div class="label" style="margin:10px 0 6px">${esc(label)}</div><div class="fa-tiles">${ks.map((k) => newTile({ icon: k.icon || 'doc', label: k.one, href: `#rec/${k.key}/new` })).join('')}</div>` : '';
  }).join('');
  modal({ title: 'Add a record', html, noButtons: true });
};

/* ---------------------------------------------------------------- one page for an employee */
const EMP_SECTIONS = [
  ['personal', 'Personal', ['dob', 'gender', 'blood_group', 'address', 'emergency_name', 'emergency_phone']],
  ['employment', 'Employment', ['joining_date', 'employment', 'opening_casual', 'opening_sick', 'opening_earned']],
  ['ids', 'IDs and bank', ['pan', 'aadhaar_last4', 'uan', 'esic', 'bank_name', 'bank_account', 'bank_ifsc']],
];
const DOC_KINDS = [['Aadhaar card (masked)', 'ID proof'], ['PAN card', 'ID proof'], ['Photo', 'Photo'], ['Offer letter', 'Offer letter'], ['Bank passbook or cheque', 'Bank'], ['Other document', 'Other']];
const ef = (k) => `ef-${k}`;
/** A captioned block for chips, radio buttons or several controls (a <label> would click the first one). */
function fieldGroup(label, control, { help = '' } = {}) {
  return `<div class="field" role="group" aria-label="${esc(label)}"><span>${esc(label)}</span>${control}${help ? `<small class="help">${esc(help)}</small>` : ''}</div>`;
}
function empField(f) {
  const id = ef(f.key);
  const hint = { aadhaar_last4: 'Only the last 4 digits. Never the full number.', pan: 'e.g. ABCDE1234F', bank_ifsc: 'e.g. SBIN0001234', opening_casual: 'Days already earned before the app' }[f.key] || '';
  const ctl = f.type === 'textarea' ? textarea(id, F(id, ''))
    : f.type === 'select' ? select(id, F(id, ''), f.options, { blank: 'Choose' })
      : input(id, F(id, ''), { type: f.type === 'date' ? 'date' : ['money', 'number'].includes(f.type) ? 'number' : 'text', inputmode: ['money', 'number'].includes(f.type) || ['aadhaar_last4', 'bank_account', 'emergency_phone'].includes(f.key) ? 'numeric' : '' });
  return field(f.label, ctl, { help: hint });
}
function empDocsBox(uid) {
  const pending = KL.ui.empDocs || [];
  const have = uid ? data(`hr:docs:${uid}`, () => api(`/api/hr/documents?userId=${encodeURIComponent(uid)}`)) : null;
  const existing = have && !have.error ? have.rows : [];
  return `<div class="card stack">
    <p class="hint">Aadhaar: upload a masked copy (only the last 4 digits showing). Anyone can download one free from the UIDAI website (myaadhaar.uidai.gov.in → Download Aadhaar → Masked).</p>
    ${existing.length ? `<div class="card flush">${existing.map((d) => `<div class="lrow-static row"><span class="icon">${ic('doc')}</span><span class="tx" style="flex:1"><b>${esc(d.title)}</b><span class="muted" style="font-size:13px;display:block">${esc(d.category)} · ${esc(fmtDate(d.created_at, false))}</span></span>${tag('saved', 'ok')}</div>`).join('')}</div>` : ''}
    ${pending.length ? `<div class="card flush">${pending.map((d, i) => `<div class="lrow-static row"><span class="icon amber">${ic('upload')}</span><span class="tx" style="flex:1"><b>${esc(d.title)}</b><span class="muted" style="font-size:13px;display:block">${esc(d.file.name)} · ${Math.max(1, Math.round(d.file.size / 1024))} KB · uploads when you save</span></span><button type="button" class="btn ghost icon-only" data-action="empDocDel" data-i="${i}" aria-label="Remove ${esc(d.title)}">${ic('trash')}</button></div>`).join('')}</div>` : ''}
    <div class="chips">${DOC_KINDS.map(([t, c]) => `<button type="button" data-action="empDocAdd" data-title="${esc(t)}" data-cat="${esc(c)}">${ic('plus')} ${esc(t)}</button>`).join('')}</div>
  </div>`;
}
Actions.empDocAdd = (el) => pickFile('image/*,application/pdf', (file) => {
  if (file.size > 15 * 1024 * 1024) return toast('That file is over 15 MB', 'error');
  (KL.ui.empDocs ||= []).push({ title: el.dataset.title.replace(' (masked)', ''), category: el.dataset.cat, file });
  render();
});
Actions.empDocDel = (el) => { (KL.ui.empDocs || []).splice(Number(el.dataset.i), 1); render(); };

/** The employee code the form will make, e.g. AGR05001 (asked from the server as project and office change). */
function empCodePreview(proj, office) {
  if (!proj || !office) return '';
  const d = data(`empcode:${proj}:${office}`, () => api(`/api/admin/next-employee-code?project=${encodeURIComponent(proj)}&office=${encodeURIComponent(office)}`));
  return d && !d.error ? d.employeeId : '';
}
function sitePicker(prefix) {
  const chosen = new Set(String(F(`${prefix}-sites`, '')).split(',').filter(Boolean));
  const groups = siteGroups(KL.boot.sites.filter((s) => s.active !== 0)).flatMap((g) => g.parts.map(([sub, list]) => [sub ? `${g.meta.name} · ${sub}` : g.meta.name, list]));
  if (!groups.length) return '<p class="hint">No sites yet. Add a site first, or save now and add the person to a site later.</p>';
  return `${groups.map(([label, list]) => `<div class="label" style="margin:8px 0 4px">${esc(label)}</div><div class="chips">${list.map((s) => `<button type="button" data-action="pickSite" data-prefix="${prefix}" data-id="${esc(s.id)}" aria-pressed="${chosen.has(s.id)}">${esc(s.name)}</button>`).join('')}</div>`).join('')}
    <p class="hint" style="margin-top:6px">${chosen.size ? `${chosen.size} site${chosen.size === 1 ? '' : 's'} chosen.` : 'No site chosen: the person can use HR, tasks and requests, but cannot check in at a site.'}</p>`;
}
Actions.pickSite = (el) => {
  const key = `${el.dataset.prefix}-sites`;
  const s = new Set(String(F(key, '')).split(',').filter(Boolean));
  if (s.has(el.dataset.id)) s.delete(el.dataset.id); else s.add(el.dataset.id);
  setF(key, [...s].join(',')); render();
};

function empForm(uid) {
  const editing = Boolean(uid);
  const kd = kinds();
  const p = editing ? data(`hr:profile:${uid}`, () => api(`/api/hr/profile/${uid}`)) : null;
  const back = editing ? `#person/${uid}` : '#people';
  const title = editing ? 'Edit employee' : 'New employee';
  if (!(editing ? can('users.edit') : can('users.add'))) return `${topbar(title, back)}<div class="card"><p class="empty">Your designation may not ${editing ? 'edit' : 'add'} employees.</p></div>`;
  if (kd?.error) return `${topbar(title, back)}${errorBox(kd.error)}`;
  if (!kd || (editing && !p)) return `${topbar(title, back)}${spinner()}`;
  if (p?.error) return `${topbar(title, back)}${errorBox(p.error)}`;
  if (editing && p.user.role === 'admin' && !isAdmin()) return `${topbar(title, back)}<div class="card"><p class="empty">Only the director edits a director.</p></div>`;
  const initKey = uid || 'new';
  if (KL.ui.efInit !== initKey) {
    KL.ui.efInit = initKey; KL.ui.empDocs = [];
    for (const k of Object.keys(KL.ui.forms)) if (k.startsWith('ef-')) delete KL.ui.forms[k];
    if (editing) {
      const u = p.user;
      for (const f of kd.profileFields) setF(ef(f.key), p.profile[f.key] ?? '');
      setF(ef('name'), u.name); setF(ef('code'), u.employee_id); setF(ef('designation'), u.designation || ''); setF(ef('department'), u.department || '');
      setF(ef('manager'), u.manager_id || ''); setF(ef('phone'), u.phone || ''); setF(ef('email'), u.email || ''); setF(ef('active'), u.active ? 'active' : 'inactive');
      setF(ef('sites'), (u.sites || []).join(','));
    } else {
      setF(ef('pin'), String(1000 + Math.floor(Math.random() * 9000)));
    }
  }
  const projs = (KL.boot.projectList || []).filter((x) => x.key !== 'management' || isAdmin());
  const offices = KL.boot.offices || [];
  const proj = F(ef('project'), projs[0]?.key || '');
  const office = F(ef('office'), offices[0]?.code || '');
  const code = editing ? F(ef('code')) : empCodePreview(proj, office);
  const roles = (KL.boot.roles || []).filter((r) => r.level !== 'admin' || isAdmin());
  if (F(ef('designation'), '') && !roles.some((r) => r.name === F(ef('designation')))) roles.push({ name: F(ef('designation')), level: '' }); // an old title not in the list
  const levelName = (k) => (KL.boot.levels || []).find((l) => l.key === k)?.name || k;
  const desig = F(ef('designation'), '');
  const desigLevel = roles.find((r) => r.name === desig)?.level;
  const depts = KL.boot.departments || [];
  const people = KL.boot.people.filter((x) => x.id !== uid);
  const canRole = !editing || can('users.role');
  const canSites = !editing || can('users.assign');
  const byKey = Object.fromEntries(kd.profileFields.map((f) => [f.key, f]));
  const job = `<div class="card stack">
    ${editing ? '' : `<div class="grid2">${field('Project', select(ef('project'), proj, projs.map((x) => [x.key, `${x.name} (${x.code})`])), { required: true })}
      ${field('Reporting office', `<div class="row" style="gap:6px">${select(ef('office'), office, offices.map((o) => [o.code, `${o.code} · ${o.name}`]))}${canListsHR() ? `<button type="button" class="btn ghost icon-only" data-action="efNewOffice" aria-label="New office" title="New office">${ic('plus')}</button>` : ''}</div>`, { required: true })}</div>
      ${code ? `<div class="banner info">${ic('user')}<div><b>Employee code: <span class="notr">${esc(code)}</span></b><p>Made from the project and office. It is their sign-in ID.</p></div></div>` : ''}`}
    ${editing ? field('Employee code', input(ef('code'), F(ef('code'))), { help: 'Their sign-in ID. Change only to correct a mistake.' }) : ''}
    ${field('Full name', input(ef('name'), F(ef('name')), { placeholder: 'e.g. Jagdish Chauhan' }), { required: true })}
    <div class="grid2">
      ${field('Designation', canRole ? `<div class="row" style="gap:6px">${select(ef('designation'), desig, roles.map((r) => [r.name, r.name]), { blank: 'Choose' })}${canListsHR() ? `<button type="button" class="btn ghost icon-only" data-action="efNewRole" aria-label="New designation" title="New designation">${ic('plus')}</button>` : ''}</div>` : `<input class="input" value="${esc(desig)}" disabled />`, { required: true, help: desigLevel ? `Access: ${levelName(desigLevel)}` : '' })}
      ${field('Department', select(ef('department'), F(ef('department'), ''), depts.map((d) => [d.key, d.name]), { blank: editing ? '(none)' : 'From the project' }))}
    </div>
    ${field('Reports to', select(ef('manager'), F(ef('manager'), ''), people.map((x) => [x.id, `${x.name} · ${x.designation || ''}`]), { blank: 'Nobody (top of the company)' }), { help: 'Their leave, travel and requests go to this person first.' })}
    <div class="grid2">${field('Mobile', input(ef('phone'), F(ef('phone')), { type: 'tel', inputmode: 'tel', placeholder: '10-digit mobile' }))}${field('Email (if any)', input(ef('email'), F(ef('email')), { type: 'email' }))}</div>
    ${canSites ? fieldGroup('Sites they work at', sitePicker('ef')) : ''}
    ${editing ? (can('users.deactivate') ? field('Status', select(ef('active'), F(ef('active'), 'active'), [['active', 'Active'], ['inactive', 'Left / inactive']])) : '')
      : field('Starting PIN', input(ef('pin'), F(ef('pin')), { inputmode: 'numeric' }), { help: '4 to 6 digits. They choose their own at the first sign-in.' })}
  </div>`;
  const sections = EMP_SECTIONS.map(([k, label, keys]) => group(label, `<div class="card stack"><div class="grid2">${keys.filter((x) => byKey[x] && x !== 'address').map((x) => empField(byKey[x])).join('')}</div>${keys.includes('address') && byKey.address ? empField(byKey.address) : ''}</div>`)).join('');
  const docs = can('hr.documents') ? group('Documents', empDocsBox(uid)) : '';
  return `${topbar(title, back)}
    ${group(editing ? 'Login and job' : 'Login and job', job)}
    ${sections}
    ${docs}
    ${editing ? field('Reason for the change (kept in the change log)', input(ef('reason'), F(ef('reason')), { placeholder: 'optional, e.g. promoted from 1 Dec' })) : ''}
    <div class="btns" style="margin:16px 0 30px"><a class="btn" href="${back}">Cancel</a><button type="button" class="btn primary" data-action="empSave" data-id="${esc(uid || '')}">${editing ? 'Save changes' : 'Create employee'}</button></div>`;
}
const canListsHR = () => isAdmin() || can('settings.lists');
Views.empnew = () => empForm(null);
Views.empedit = (id) => empForm(id);

Actions.efNewOffice = async () => {
  const v = await modal({ title: 'New reporting office', fields: [{ key: 'name', label: 'Office name', placeholder: 'e.g. Banaskantha' }, { key: 'code', label: 'Office number (2 digits, the middle of the employee code)', value: nextFreeOffice(), inputmode: 'numeric' }], confirmText: 'Add office' });
  if (!v) return;
  try { await api('/api/admin/lists/offices/add', { json: { value: v.code, name: v.name } }); await reloadBoot(); setF(ef('office'), String(v.code).padStart(2, '0')); invalidate('admin:lists'); toast('Office added'); render(); } catch (e) { toast(e.message, 'error'); }
};
function nextFreeOffice() {
  const used = new Set((KL.boot.offices || []).map((o) => o.code));
  for (let n = 1; n < 100; n++) { const c = String(n).padStart(2, '0'); if (!used.has(c)) return c; }
  return '';
}
Actions.efNewRole = async () => {
  const lv = (KL.boot.levels || []).filter((l) => l.key !== 'admin' || isAdmin());
  const v = await modal({ title: 'New designation', fields: [{ key: 'name', label: 'Designation', placeholder: 'e.g. District Coordinator' }, { key: 'level', label: 'Access level', type: 'select', options: lv.map((l) => l.name), value: lv.find((l) => l.key === 'field')?.name }], confirmText: 'Add designation' });
  if (!v) return;
  const level = lv.find((l) => l.name === v.level)?.key || 'field';
  try { await api('/api/admin/lists/roles/add', { json: { value: v.name, level } }); await reloadBoot(); setF(ef('designation'), v.name.trim()); invalidate('admin:lists', 'admin:perms'); toast('Designation added'); render(); } catch (e) { toast(e.message, 'error'); }
};

Actions.empSave = async (el) => {
  const uid = el.dataset.id || null;
  const kd = KL.cache['m:kinds'];
  if (!kd || kd.error) return toast('Still loading the form. Try again in a moment.', 'error');
  const v = (k) => String(F(ef(k), '')).trim();
  if (v('name').length < 2) return toast('Type the full name', 'error');
  if (!v('designation')) return toast('Choose the designation', 'error');
  const profile = {};
  for (const f of kd.profileFields) profile[f.key] = String(F(ef(f.key), '') ?? '').trim();
  if (profile.pan && !/^[A-Z]{5}\d{4}[A-Z]$/i.test(profile.pan) && !profile.pan.startsWith('••••')) return toast('PAN looks wrong: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F)', 'error');
  if (profile.aadhaar_last4 && !/^\d{4}$/.test(profile.aadhaar_last4) && !profile.aadhaar_last4.startsWith('••••')) return toast('Aadhaar: only the last 4 digits', 'error');
  if (profile.bank_ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(profile.bank_ifsc)) return toast('IFSC looks wrong: 11 characters, e.g. SBIN0001234', 'error');
  if (profile.pan) profile.pan = profile.pan.toUpperCase();
  if (profile.bank_ifsc) profile.bank_ifsc = profile.bank_ifsc.toUpperCase();
  if (!uid && !/^\d{4,6}$/.test(v('pin'))) return toast('Starting PIN: 4 to 6 digits', 'error');
  const sites = String(F(ef('sites'), '')).split(',').filter(Boolean);
  el.disabled = true;
  let id = uid, code = v('code');
  try {
    const job = { name: v('name'), roleName: v('designation'), department: v('department'), phone: v('phone'), email: v('email'), sites };
    if (uid) {
      const prev = KL.cache[`hr:profile:${uid}`]?.user || {};
      Object.assign(job, { id: uid, employee_id: v('code'), active: (F(ef('active'), prev.active ? 'active' : 'inactive')) === 'active' });
      if (!can('users.assign')) job.sites = prev.sites || [];
      if (!can('users.role')) { delete job.roleName; Object.assign(job, { role: prev.role, designation: prev.designation }); }
    } else Object.assign(job, { project: F(ef('project'), (KL.boot.projectList || [])[0]?.key), office: F(ef('office'), (KL.boot.offices || [])[0]?.code), pin: v('pin') });
    const r = await api('/api/admin/users', { json: job });
    id = r.id; code = r.employeeId;
  } catch (e) { el.disabled = false; return toast(e.message, 'error'); }
  const problems = [];
  try { await api(`/api/hr/profile/${id}`, { json: { profile, managerId: F(ef('manager'), ''), reason: v('reason') } }); } catch (e) { problems.push(`details: ${e.message}`); }
  for (const d of KL.ui.empDocs || []) {
    const form = new FormData();
    form.append('userId', id); form.append('title', d.title); form.append('category', d.category); form.append('file', d.file, d.file.name);
    try { await api('/api/hr/documents', { form }); } catch (e) { problems.push(`${d.title}: ${e.message}`); }
  }
  el.disabled = false;
  KL.ui.efInit = null; KL.ui.empDocs = [];
  invalidate('admin:users', 'hr', 'people', 'empcode'); await reloadBoot();
  if (id === KL.user.id) await refreshMe();
  if (problems.length) toast(`Saved, but: ${problems.join('; ')}`, 'error');
  if (uid) { if (!problems.length) toast('Saved'); location.hash = `#person/${id}`; return; }
  const pin = v('pin');
  const msg = `Kshetralekha sign-in\nEmployee code: ${code}\nStarting PIN: ${pin}\nOpen ${location.origin}${location.pathname} and sign in; the app asks you to choose your own PIN.`;
  const go = await modal({ title: `${v('name')} is added`, message: `Employee code ${code} · starting PIN ${pin}. Give both to them; the app asks for a new PIN at the first sign-in.`,
    html: `<div class="btns" style="flex-wrap:wrap"><button type="button" class="btn" data-action="copyText" data-text="${esc(msg)}">${ic('clip')} Copy</button><a class="btn" target="_blank" rel="noopener" href="https://wa.me/${esc((v('phone').replace(/\D/g, '').length === 10 ? '91' : '') + v('phone').replace(/\D/g, ''))}?text=${encodeURIComponent(msg)}">${ic('chat')} Share on WhatsApp</a></div>`,
    confirmText: 'Add another', cancelText: 'Open their record' });
  for (const k of Object.keys(KL.ui.forms)) if (k.startsWith('ef-') && !['ef-project', 'ef-office'].includes(k)) delete KL.ui.forms[k];
  KL.ui.efInit = null;
  if (go) { location.hash = '#empnew'; render(); } else location.hash = `#person/${id}`;
};
Actions.copyText = async (el) => { try { await navigator.clipboard.writeText(el.dataset.text); toast('Copied'); } catch { toast('Could not copy on this browser', 'error'); } };

/* ---------------------------------------------------------------- one page for a site, with its geofence */
const SITE_RULES = [['0', 'Allow exceptions', 'Outside the circle, people give a reason and the manager decides'], ['1', 'Enforce at check-in', 'Check-in only inside the circle; check-out may be an exception'], ['2', 'Enforce at check-in and check-out', 'Both only inside the circle']];
const sf = (k) => `sf-${k}`;
/** Owner 2026-11-20: Farmer-land and Retro agroforestry have no fixed site; an office may have only people working from home. */
const noFixedPlace = (project, subtype) => project === 'office' || (project === 'agroforestry' && ['farmer', 'retro'].includes(subtype));
const SITE_AREA = ['locality', 'village', 'taluka', 'district', 'state'];
/** The plus code of the site's centre, under the coordinates. */
function sfPlusLine() {
  const lat = Number(F(sf('lat'))), lng = Number(F(sf('lng')));
  if (!F(sf('lat')) || !Number.isFinite(lat) || !Number.isFinite(lng)) return 'Plus code: set the centre first';
  const code = olcEncode(lat, lng);
  return `Plus code <b class="notr mono">${esc(code)}</b> <button type="button" class="btn small ghost" data-action="copyText" data-text="${esc(code)}">${ic('clip')} Copy</button>`;
}
/** After the centre moves: the plus code at once, the village / taluka / district / state from the map a moment later. */
let sfAreaTimer = null;
function sfCentreMoved(lat, lng) {
  const p = $('#sf-plus');
  if (p) p.innerHTML = sfPlusLine();
  clearTimeout(sfAreaTimer);
  const note = (t) => { KL.ui.sfAreaNote = t; const n = $('#sf-area-note'); if (n) n.textContent = t; };
  note('Looking up the area…');
  const key = KL.ui.sfInit;
  sfAreaTimer = setTimeout(async () => {
    try {
      const r = await placeArea(lat, lng);
      if (KL.ui.sfInit !== key) return;
      for (const k of SITE_AREA) { setF(sf(k), r.area[k] || ''); const el = $(`#${sf(k)}`); if (el) el.value = r.area[k] || ''; }
      note(r.area.taluka ? 'Filled in from the map. Correct anything that is wrong.' : 'Filled in from the map; the taluka was not found for this spot, so type it.');
    } catch (e) { note(`Could not look up the area (${e.message}). Type it.`); }
  }, 700);
}
function siteForm(id) {
  const all = id && !KL.boot.sites.some((x) => x.id === id) ? data('admin:sites', () => api('/api/admin/sites')) : null; // closed sites are not in boot
  if (id && all === null && !KL.boot.sites.some((x) => x.id === id)) return `${topbar('Site', '#admin/sites')}${spinner()}`;
  const s = id ? KL.boot.sites.find((x) => x.id === id) || (all && !all.error ? all.rows.find((x) => x.id === id) : null) : null;
  const title = s ? `Edit ${s.name}` : 'New site';
  const back = s ? `#site/${s.id}` : '#sites';
  if (!can('sites.edit')) return `${topbar(title, back)}<div class="card"><p class="empty">Your designation may not add or edit sites.</p></div>`;
  if (id && !s) return `${topbar(title, '#sites')}<div class="card"><p class="empty">Site not found.</p></div>`;
  const initKey = id || 'new';
  if (KL.ui.sfInit !== initKey) {
    KL.ui.sfInit = initKey;
    for (const k of Object.keys(KL.ui.forms)) if (k.startsWith('sf-')) delete KL.ui.forms[k];
    if (s) { setF(sf('name'), s.name); setF(sf('project'), s.project_type); setF(sf('subtype'), s.subtype || ''); setF(sf('address'), s.address || ''); for (const k of SITE_AREA) setF(sf(k), s[k] || ''); setF(sf('lat'), String(s.lat)); setF(sf('lng'), String(s.lng)); setF(sf('radius'), String(s.radius_m)); setF(sf('rule'), String(s.strict || 0)); setF(sf('active'), s.active === 0 ? 'inactive' : 'active'); }
    else { setF(sf('project'), KL.ui.sfProject || (KL.boot.projectList || [])[0]?.key || 'biochar'); setF(sf('radius'), '200'); setF(sf('rule'), '0'); }
    KL.ui.sfTeam0 = s ? null : ''; // null: the team is still loading (nothing about it is sent until it has)
    if (s && can('users.assign')) loadSiteTeam(s.id);
  }
  const projs = (KL.boot.projectList || []).filter((p) => p.key !== 'management');
  const proj = F(sf('project'));
  const rule = F(sf('rule'), '0');
  KL.afterRender.push(drawSiteMap);
  bindMapSearch('sfm', { near: () => (siteMap ? siteMap.map.getCenter() : null), pick: (p) => { setSiteCentre(p.lat, p.lng); toast(p.exact ? `Centre set: ${p.label}` : `Centre set at ${p.name}. Drag the pin onto the exact spot.`); } });
  const people = KL.boot.people;
  const team = new Set(String(F(sf('team'), '')).split(',').filter(Boolean));
  return `${topbar(title, back)}
    <div class="card stack">
      ${field('Site name', input(sf('name'), F(sf('name')), { placeholder: 'e.g. Deesa plantation, Banaskantha' }), { required: true })}
      <div class="grid2">${field('Project', select(sf('project'), proj, [...projs.map((p) => [p.key, p.name]), ['office', 'Office']]), { required: true })}
        ${subgroupsOf(proj).length ? field('Sub-group', select(sf('subtype'), F(sf('subtype'), ''), subgroupsOf(proj).map((g) => [g.key, g.name]), { blank: 'Choose' }), { required: true }) : field('Address or landmark', input(sf('address'), F(sf('address')), { placeholder: 'optional' }))}</div>
      ${subgroupsOf(proj).length ? field('Address or landmark', input(sf('address'), F(sf('address')), { placeholder: 'optional' })) : ''}
    </div>
    ${group(noFixedPlace(proj, F(sf('subtype'), '')) ? 'Location (optional)' : 'Geofence', `<div class="card stack">
      ${noFixedPlace(proj, F(sf('subtype'), '')) ? `<div class="banner info">${ic('compass')}<div><b>${proj === 'office' ? 'An office can be without an address' : 'No fixed site needed'}</b><p>${proj === 'office' ? 'Leave the location empty for staff working from home: they check in from anywhere, marked "Work from home".' : 'Farmer-land and Retro work happens on farmers\' fields: leave the location empty and staff check in from where they are (their GPS is recorded).'} Set a location only if there is a real place to check in at.</p></div></div>` : ''}
      <p class="hint">Search, paste a Google Maps link or a plus code, tap the map, or stand at the middle of the site and use your location. The circle is where check-in counts.</p>
      ${mapSearchBar('sfm')}
      <div class="btns" style="flex-wrap:wrap"><button type="button" class="btn" data-action="sfHere">${ic('compass')} Use where I am standing</button></div>
      <div id="sf-map" class="map-box" style="height:320px"></div>
      <div class="grid2">${field('Latitude', `<input id="sf-lat" class="input notr" inputmode="decimal" value="${esc(F(sf('lat')))}" data-input="sfCoord" data-key="sf-lat" placeholder="e.g. 24.25810" />`)}${field('Longitude', `<input id="sf-lng" class="input notr" inputmode="decimal" value="${esc(F(sf('lng')))}" data-input="sfCoord" data-key="sf-lng" placeholder="e.g. 72.19230" />`)}</div>
      <p class="hint sf-plus" id="sf-plus">${sfPlusLine()}</p>
      ${fieldGroup('Area', `<div class="grid2">${field('Locality', input(sf('locality'), F(sf('locality')), { placeholder: 'area, hamlet (if any)' }))}${field('Village / town', input(sf('village'), F(sf('village'))))}${field('Taluka', input(sf('taluka'), F(sf('taluka'))))}${field('District', input(sf('district'), F(sf('district'))))}${field('State', input(sf('state'), F(sf('state'))))}</div><p class="hint" id="sf-area-note">${esc(KL.ui.sfAreaNote || 'Filled in from the map when the centre is set. Correct anything that is wrong.')}</p>`)}
      ${fieldGroup('Allowed radius', `<div class="row" style="gap:10px;align-items:center"><input type="range" id="sf-radius-range" min="25" max="2000" step="25" value="${esc(F(sf('radius'), '200'))}" data-input="sfRadius" style="flex:1" aria-label="Radius" /><input id="sf-radius" class="input lc-short notr" inputmode="numeric" value="${esc(F(sf('radius'), '200'))}" data-input="sfRadius" aria-label="Radius in metres" style="width:90px" /><span>m</span></div>`, { help: '150–300 m suits most sites; more for big plantations.' })}
      ${fieldGroup('Check-in rule', `<div class="stack" style="gap:6px" role="radiogroup">${SITE_RULES.map(([v, l, h]) => `<label class="radio-row"><input type="radio" name="sf-rule" value="${v}" ${rule === v ? 'checked' : ''} data-change="sfRule" /><span><b>${esc(l)}</b><small class="muted" style="display:block">${esc(h)}</small></span></label>`).join('')}</div>`)}
    </div>`)}
    ${can('users.assign') ? group('Team', `<div class="card stack"><p class="hint">People who work at this site. They can check in here and see its records.</p>${KL.ui.sfTeam0 === null ? (KL.ui.sfTeamError ? '<p class="hint">Could not load the team. The rest of the site can still be saved; change the team from each person\'s record.</p>' : spinner('Loading the team…')) : `<div class="chips">${people.filter((p) => p.role !== 'admin').map((p) => `<button type="button" data-action="sfTeam" data-id="${esc(p.id)}" aria-pressed="${team.has(p.id)}">${esc(p.name)}</button>`).join('')}</div>`}</div>`) : ''}
    ${s ? field('Status', select(sf('active'), F(sf('active'), 'active'), [['active', 'Active'], ['inactive', 'Closed / inactive']])) : ''}
    <div class="btns" style="margin:16px 0 30px"><a class="btn" href="${back}">Cancel</a><button type="button" class="btn primary" data-action="siteSave" data-id="${esc(id || '')}">${s ? 'Save changes' : 'Create site'}</button></div>`;
}
/** The site's current team, so the form starts with it ticked. */
async function loadSiteTeam(sid) {
  try {
    const u = await api('/api/admin/users');
    const ids = u.rows.filter((x) => (x.sites || []).includes(sid)).map((x) => x.id);
    if (KL.ui.sfInit === sid) { setF(sf('team'), ids.join(',')); KL.ui.sfTeam0 = ids.join(','); render(); }
  } catch { if (KL.ui.sfInit === sid) { KL.ui.sfTeamError = true; render(); } }
}
Views.sitenew = () => siteForm(null);
/** "+" on a project panel: a new site with that project already chosen. */
Actions.siteNewFor = (el) => { KL.ui.sfInit = null; KL.ui.sfProject = el.dataset.project || ''; location.hash = '#sitenew'; render(); };
Views.siteedit = (id) => siteForm(id);

let siteMap = null;
async function drawSiteMap() {
  const box = $('#sf-map');
  if (!box || box.dataset.drawn) return;
  box.dataset.drawn = '1';
  try { await loadLeaflet(); } catch (e) { box.innerHTML = `<p class="hint" style="padding:12px">${esc(e.message)}. Type the latitude and longitude below instead.</p>`; return; }
  if (!document.body.contains(box)) return;
  const kept = siteMap && siteMap.key === KL.ui.sfInit ? { c: siteMap.map.getCenter(), z: siteMap.map.getZoom() } : null;
  if (siteMap) { try { siteMap.map.remove(); } catch { /* already gone with the old page */ } siteMap = null; }
  const lat = Number(F(sf('lat'))), lng = Number(F(sf('lng')));
  const has = Number.isFinite(lat) && Number.isFinite(lng) && (lat || lng);
  const map = L.map(box, { zoomControl: true });
  addBaseLayers(map);
  const others = KL.boot.sites.filter((x) => x.id !== KL.ui.sfInit);
  for (const o of others) L.circle([o.lat, o.lng], { radius: o.radius_m, color: '#888', weight: 1, fillOpacity: 0.05 }).addTo(map).bindTooltip(esc(o.name));
  const centre = has ? [lat, lng] : others.length ? [others[0].lat, others[0].lng] : [23.0, 72.0];
  const marker = L.marker(centre, { draggable: true, opacity: has ? 1 : 0.4 }).addTo(map);
  const circle = L.circle(centre, { radius: Number(F(sf('radius'), '200')) || 200, color: '#1e7a4c', weight: 2, fillOpacity: 0.15 }).addTo(map);
  if (kept) map.setView(kept.c, kept.z); else map.setView(centre, has ? 16 : 8);
  const place = (ll) => { marker.setLatLng(ll); marker.setOpacity(1); circle.setLatLng(ll); setSiteCentre(ll.lat, ll.lng, false); };
  map.on('click', (e) => place(e.latlng));
  marker.on('dragend', () => place(marker.getLatLng()));
  siteMap = { map, marker, circle, key: KL.ui.sfInit };
}
function setSiteCentre(lat, lng, move = true) {
  setF(sf('lat'), lat.toFixed(6)); setF(sf('lng'), lng.toFixed(6));
  sfCentreMoved(lat, lng);
  const a = $('#sf-lat'), b = $('#sf-lng');
  if (a) a.value = lat.toFixed(6);
  if (b) b.value = lng.toFixed(6);
  if (move && siteMap && document.body.contains(siteMap.map.getContainer())) { siteMap.marker.setLatLng([lat, lng]); siteMap.marker.setOpacity(1); siteMap.circle.setLatLng([lat, lng]); siteMap.map.setView([lat, lng], 17); }
}
Inputs.sfCoord = (el) => {
  setF(el.dataset.key, el.value);
  const lat = Number(F(sf('lat'))), lng = Number(F(sf('lng')));
  if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat || lng)) {
    if (siteMap) { siteMap.marker.setLatLng([lat, lng]); siteMap.circle.setLatLng([lat, lng]); siteMap.map.setView([lat, lng], 16); }
    sfCentreMoved(lat, lng);
  }
};
Inputs.sfRadius = (el) => {
  const r = Math.max(10, Math.min(20000, Number(el.value) || 0));
  setF(sf('radius'), String(el.value));
  const other = el.id === 'sf-radius' ? $('#sf-radius-range') : $('#sf-radius');
  if (other) other.value = el.value;
  if (siteMap && r) siteMap.circle.setRadius(r);
};
Changes.sfRule = (el) => setF(sf('rule'), el.value);
Actions.sfTeam = (el) => {
  const s = new Set(String(F(sf('team'), '')).split(',').filter(Boolean));
  if (s.has(el.dataset.id)) s.delete(el.dataset.id); else s.add(el.dataset.id);
  setF(sf('team'), [...s].join(','));
  el.setAttribute('aria-pressed', String(s.has(el.dataset.id))); // no redraw: the map stays as it is
};
Actions.sfHere = async (el) => {
  el.disabled = true;
  toast('Taking a careful GPS reading. Stand still in the open (up to 30 seconds)…');
  const fix = await measureHere();
  el.disabled = false;
  if (!fix) return toast('Could not get a location. Allow location for this app and try again in the open.', 'error');
  if (fix.accuracy > 25 && !(await modal({ title: `GPS is only ±${Math.round(fix.accuracy)} m here`, message: 'The centre could be off by that much. Use it anyway, or cancel and try again in the open, away from roofs and walls.', confirmText: 'Use it' }))) return;
  setSiteCentre(fix.lat, fix.lng);
  toast(`Centre set at ±${Math.round(fix.accuracy)} m`);
};
Actions.siteSave = async (el) => {
  const id = el.dataset.id || null;
  const v = (k) => String(F(sf(k), '')).trim();
  if (v('name').length < 2) return toast('Type the site name', 'error');
  const lat = Number(v('lat')), lng = Number(v('lng'));
  const placeless = noFixedPlace(v('project'), v('subtype'));
  if (!placeless && (!v('lat') || !v('lng') || !Number.isFinite(lat) || !Number.isFinite(lng))) return toast('Set the centre: tap the map, use your location or type the coordinates', 'error');
  if (!v('subtype') && subgroupsOf(v('project')).length) return toast('Choose the sub-group', 'error');
  const radius = Number(v('radius'));
  if (!(radius >= 10 && radius <= 20000)) return toast('Radius must be between 10 m and 20 km', 'error');
  const body = { id, name: v('name'), project_type: v('project'), subtype: subgroupsOf(v('project')).length ? v('subtype') : '', address: v('address'), ...Object.fromEntries(SITE_AREA.map((k) => [k, v(k)])), lat: placeless && !v('lat') ? '' : lat, lng: placeless && !v('lng') ? '' : lng, radius_m: Math.round(radius), strict: Number(v('rule') || 0), active: id ? v('active') !== 'inactive' : true };
  if (can('users.assign') && KL.ui.sfTeam0 !== null) {
    const was = new Set(String(KL.ui.sfTeam0 || '').split(',').filter(Boolean)), now = new Set(String(F(sf('team'), '')).split(',').filter(Boolean));
    body.teamAdd = [...now].filter((x) => !was.has(x)); body.teamRemove = [...was].filter((x) => !now.has(x));
  }
  el.disabled = true;
  try {
    const r = await api('/api/admin/sites', { json: body });
    await reloadBoot(); invalidate('admin:users', 'admin:sites', 'map', 'site');
    KL.ui.sfInit = null; siteMap = null;
    for (const k of Object.keys(KL.ui.forms)) if (k.startsWith('sf-')) delete KL.ui.forms[k];
    if (id) { toast('Site saved'); location.hash = (KL.boot.mySites || []).some((x) => x.id === id) ? `#site/${id}` : '#admin/sites'; return; }
    const n = body.teamAdd?.length || 0;
    const another = await modal({ title: `${body.name} is added`, message: n ? `${n} people can check in here now.` : 'Add people to it here or from each person\'s record.', confirmText: 'Add another site', cancelText: 'Open the site' });
    const mine = (KL.boot.mySites || []).some((x) => x.id === r.id); // a manager who is not on the new site sees it in Administration
    location.hash = another ? '#sitenew' : mine ? `#site/${r.id}` : '#admin/sites';
    if (another) render();
  } catch (e) { toast(e.message, 'error'); } finally { el.disabled = false; }
};
