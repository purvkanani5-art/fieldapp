/* Settings > Designations & access (director only): access levels (built in, plus your own such as Finance &
   Accounts), the access level of each designation, a tick grid of what each office designation may do, and the
   approval rules (who approves which request, up to which limit). The server checks every tick; the screens only
   hide what a designation cannot use. */

function permsView() {
  const d = data('admin:perms', () => api('/api/admin/permissions'));
  const head = `${topbar('Settings', '#home')}${settingsTabs('settings/roles')}`;
  if (d === null) return `${head}${spinner()}`;
  if (d.error) return `${head}${errorBox(d.error)}`;
  const office = d.roles.filter((r) => !r.field && r.level !== 'admin');
  const field = d.roles.filter((r) => r.field);
  const levels = Object.entries(d.levels);
  const levelRows = d.roles.map((r) => `<div class="lc-row"><span class="lc-name"><b>${esc(r.name)}</b><small>${r.people === 1 ? '1 person' : `${r.people} people`}</small></span>
    <select class="input pm-level" data-change="permLevel" data-role="${esc(r.name)}" data-people="${r.people}" aria-label="Access level of ${esc(r.name)}">${levels.map(([k, l]) => `<option value="${k}" ${k === r.level ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`).join('');
  const groups = Object.entries(d.groups).map(([g, label]) => [label, d.perms.filter((p) => p.group === g)]).filter(([, ps]) => ps.length);
  const grid = office.length ? `<div class="pm-scroll"><table class="pm-grid">
    <thead><tr><th scope="col">Permission</th>${office.map((r) => `<th scope="col"><span>${esc(r.name)}</span><small>${esc(d.levels[r.level])}</small></th>`).join('')}<th scope="col"><span>Director</span><small>always</small></th></tr></thead>
    <tbody>${groups.map(([label, ps]) => `<tr class="pm-group"><th scope="rowgroup" colspan="${office.length + 2}">${esc(label)}</th></tr>${ps.map((p) => `<tr><th scope="row">${esc(p.label)}</th>${office.map((r) => `<td><input type="checkbox" ${r.perms.includes(p.key) ? 'checked' : ''} data-change="permTick" data-role="${esc(r.name)}" data-perm="${esc(p.key)}" aria-label="${esc(r.name)}: ${esc(p.label)}" /></td>`).join('')}<td><input type="checkbox" checked disabled aria-label="Director: ${esc(p.label)}" /></td></tr>`).join('')}`).join('')}</tbody>
  </table></div>` : '<p class="empty">No office designations yet. Give a designation an office access level above.</p>';
  return `${head}<p class="sub">Access levels, what each designation may do and who approves what. Only you (the director) can change this page; every change is in the audit log.</p>
    ${group('Access levels', levelsCard(d), '', `<button type="button" class="btn small primary" data-action="lvAdd">${ic('plus')} New access level</button>`)}
    ${group('Access level of each designation', `<div class="card lc"><div class="lc-head"><span class="hint">The level decides what a person sees: Field staff use the simple phone app; Managers see their sites and team; HR and the Director see everyone; your own levels as you set them. Everyone with the designation moves with it.</span></div><div class="lc-rows">${levelRows}</div></div>`)}
    ${group('Who can do what', `<div class="card">${grid}${field.length ? `<p class="hint" style="margin-top:10px">Field-app designations (${field.map((r) => esc(r.name)).join(', ')}) use the simple phone app and have no office tools. They can still approve requests when an approval rule names their designation or department.</p>` : ''}</div>`)}
    ${group('Approval rules', `<p class="hint" style="margin:-4px 0 10px">Steps run in order. The first approver decides every request; a later step joins only when the request is more than its limit. Changes apply to new requests.</p><div class="lc-grid">${d.rules.map((x) => ruleCard(x, d)).join('')}</div>`)}`;
}

/** Built-in and custom access levels: what app they use, what they see, their starting ticks (custom ones). */
function levelsCard(d) {
  const lvs = d.levelInfo || [];
  return `<div class="card lc"><div class="lc-head"><span class="hint">A level is a starting point for designations: the app, how far the person sees, and the ticks a designation starts with. Director, HR, Manager and Field staff are built in.</span></div><div class="lc-rows">${lvs.map((l) => `<div class="lc-row pm-lv"><span class="lc-name"><b>${esc(l.name)}</b><small>${l.app === 'field' ? 'Field app' : 'Office app'} · ${l.sees === 'company' ? 'sees the whole company' : 'sees their sites and team'} · ${l.roles === 1 ? '1 designation' : `${l.roles} designations`}</small>
      ${!l.builtin && l.app === 'office' ? `<span class="pm-chips pm-lv-ticks">${d.perms.map((p) => `<button type="button" class="pm-chip" data-action="lvTick" data-key="${esc(l.key)}" data-perm="${esc(p.key)}" aria-pressed="${(l.defaults || []).includes(p.key)}" title="${esc(p.label)}">${esc(p.label)}</button>`).join('')}</span>` : ''}</span>
      ${l.builtin ? tag('built in', '') : `<span class="row" style="gap:4px"><button type="button" class="btn ghost icon-only" data-action="lvEdit" data-key="${esc(l.key)}" aria-label="Change ${esc(l.name)}" title="Change">${ic('pen')}</button>${l.roles ? '' : `<button type="button" class="btn ghost icon-only lc-del" data-action="lvDel" data-key="${esc(l.key)}" data-name="${esc(l.name)}" aria-label="Delete ${esc(l.name)}" title="Delete">${ic('trash')}</button>`}</span>`}</div>`).join('')}</div></div>`;
}
const LV_APP = [['office', 'Office app'], ['field', 'Simple field app']];
const LV_SEES = [['team', 'Their sites and team'], ['company', 'The whole company']];
async function lvModal(l) {
  const v = await modal({ title: l ? `Change ${l.name}` : 'New access level', message: l ? '' : 'e.g. Finance & Accounts: office app, sees the whole company. Then tick its starting permissions on its row, and give designations this level.', fields: [
    { key: 'name', label: 'Name', value: l?.name || '', placeholder: 'e.g. Finance & Accounts' },
    { key: 'app', label: 'App', type: 'select', options: LV_APP.map(([, x]) => x), value: LV_APP.find(([k]) => k === (l?.app || 'office'))[1] },
    { key: 'sees', label: 'Sees', type: 'select', options: LV_SEES.map(([, x]) => x), value: LV_SEES.find(([k]) => k === (l?.sees || 'team'))[1] },
  ], confirmText: l ? 'Save' : 'Add level' });
  if (!v) return null;
  return { name: v.name, app: LV_APP.find(([, x]) => x === v.app)?.[0] || 'office', sees: LV_SEES.find(([, x]) => x === v.sees)?.[0] || 'team' };
}
const lvDone = async (msg) => { invalidate('admin:perms', 'admin:lists'); await reloadBoot(); toast(msg); render(); };
Actions.lvAdd = async () => {
  const v = await lvModal(null);
  if (!v) return;
  try { await api('/api/admin/permissions/levels/add', { json: v }); await lvDone('Access level added'); } catch (e) { toast(e.message, 'error'); }
};
Actions.lvEdit = async (el) => {
  const l = permsData()?.levelInfo?.find((x) => x.key === el.dataset.key);
  if (!l) return;
  const v = await lvModal(l);
  if (!v) return;
  try { await api('/api/admin/permissions/levels/edit', { json: { key: l.key, ...v, perms: l.defaults } }); await lvDone('Saved'); } catch (e) { toast(e.message, 'error'); }
};
Actions.lvTick = async (el) => {
  const l = permsData()?.levelInfo?.find((x) => x.key === el.dataset.key);
  if (!l) return;
  const on = el.getAttribute('aria-pressed') !== 'true';
  const perms = on ? [...new Set([...(l.defaults || []), el.dataset.perm])] : (l.defaults || []).filter((k) => k !== el.dataset.perm);
  try { await api('/api/admin/permissions/levels/edit', { json: { key: l.key, perms } }); await lvDone(on ? 'Added to the starting ticks' : 'Taken out'); } catch (e) { toast(e.message, 'error'); }
};
Actions.lvDel = async (el) => {
  if (!(await modal({ title: `Delete ${el.dataset.name}?`, message: 'No designation uses it. You can add it again later.', confirmText: 'Delete', danger: true }))) return;
  try { await api('/api/admin/permissions/levels/delete', { json: { key: el.dataset.key } }); await lvDone('Deleted'); } catch (e) { toast(e.message, 'error'); }
};

/** The page's data: the fresh copy, or while it reloads after a save, the copy on screen (KL.stale). */
const permsData = () => KL.cache['admin:perms'] || KL.stale?.['admin:perms'] || null;

function ruleState(kind) {
  KL.ui.rules = KL.ui.rules || {};
  if (!KL.ui.rules[kind]) {
    const r = permsData()?.rules?.find((x) => x.kind === kind);
    if (!r) return [];
    KL.ui.rules[kind] = r.steps.map((s) => ({ approver: s.approver, over: s.over === null || s.over === undefined ? '' : String(s.over) }));
  }
  return KL.ui.rules[kind];
}

function ruleCard(x, d) {
  const steps = ruleState(x.kind);
  const unitWord = x.unit === 'days' ? 'days' : x.unit;
  const dirty = JSON.stringify(steps) !== JSON.stringify(x.steps.map((s) => ({ approver: s.approver, over: s.over === null || s.over === undefined ? '' : String(s.over) })));
  const opts = (cur) => d.approvers.map((a) => `<option value="${esc(a.value)}" ${a.value === cur ? 'selected' : ''}>${esc(a.label)}</option>`).join('')
    + (d.approvers.some((a) => a.value === cur) ? '' : `<option value="${esc(cur)}" selected>${esc(cur === 'hr' ? 'HR' : cur)}</option>`);
  const rows = steps.map((s, i) => `<div class="pm-step"><span class="pm-n">${i + 1}</span>
    <select class="input" data-change="ruleSet" data-kind="${esc(x.kind)}" data-i="${i}" data-f="approver" aria-label="Step ${i + 1} approver">${opts(s.approver)}</select>
    ${i === 0 ? '<span class="pm-when">decides every request</span>'
      : x.unit ? `<span class="pm-when">when more than</span><input class="input pm-over notr" inputmode="decimal" value="${esc(s.over)}" placeholder="always" data-change="ruleSet" data-kind="${esc(x.kind)}" data-i="${i}" data-f="over" aria-label="Step ${i + 1} limit" /><span class="pm-when">${esc(unitWord === '₹' ? '₹' : unitWord)}</span>`
        : '<span class="pm-when">always</span>'}
    ${i === 0 ? '' : `<button type="button" class="btn ghost icon-only lc-del" data-action="ruleDel" data-kind="${esc(x.kind)}" data-i="${i}" aria-label="Remove step ${i + 1}" title="Remove">${ic('trash')}</button>`}</div>`).join('');
  return `<div class="card lc"><div class="lc-head"><b>${esc(x.label)}</b><span class="hint">${esc(ruleSummary(x, steps, d))}</span></div>
    <div class="pm-steps">${rows}</div>
    <div class="lc-add"><div class="row" style="gap:8px;flex-wrap:wrap"><button type="button" class="btn" data-action="ruleAdd" data-kind="${esc(x.kind)}">${ic('plus')}<span>Add a step</span></button>
      ${dirty ? `<button type="button" class="btn primary" data-action="ruleSave" data-kind="${esc(x.kind)}">Save</button><button type="button" class="btn ghost" data-action="ruleUndo" data-kind="${esc(x.kind)}">Undo</button>` : ''}</div></div></div>`;
}

/** "Up to 2 days: Reporting manager. More than 2: + HR Executive." in plain words. */
function ruleSummary(x, steps, d) {
  const name = (v) => d.approvers.find((a) => a.value === v)?.label || (v === 'hr' ? 'HR' : v);
  const amt = (n) => (x.unit === '₹' ? rupees(Number(n)) : `${n} ${x.unit}`);
  const always = steps.filter((s, i) => i === 0 || s.over === '' || !x.unit).map((s) => name(s.approver));
  const lims = [...new Set(steps.slice(1).filter((s) => s.over !== '' && x.unit).map((s) => Number(s.over)))].sort((a, b) => a - b);
  if (!lims.length) return `${always.join(', then ')}.`;
  const parts = [`Up to ${amt(lims[0])}: ${always.join(', then ')}.`];
  for (const l of lims) parts.push(`More than ${amt(l)}: + ${steps.filter((s) => s.over !== '' && Number(s.over) === l).map((s) => name(s.approver)).join(', ')}.`);
  return parts.join(' ');
}

Changes.permTick = async (el) => {
  const on = el.checked;
  el.disabled = true;
  try {
    await api('/api/admin/permissions/role', { json: { role: el.dataset.role, perm: el.dataset.perm, on } });
    const r = permsData()?.roles?.find((x) => x.name === el.dataset.role);
    if (r) r.perms = on ? [...new Set([...r.perms, el.dataset.perm])] : r.perms.filter((k) => k !== el.dataset.perm);
    toast(on ? 'Allowed' : 'Removed');
  } catch (e) { el.checked = !on; toast(e.message, 'error'); }
  el.disabled = false;
};
Changes.permLevel = async (el) => {
  const d = permsData();
  const r = d?.roles?.find((x) => x.name === el.dataset.role);
  if (!r) return;
  const label = d.levels[el.value];
  const n = Number(el.dataset.people) || 0;
  if (n && !(await modal({ title: `Make ${r.name} ${label}?`, message: `${n === 1 ? '1 person' : `${n} people`} with this designation move to ${label} and get its starting permissions. They see it the next time the app refreshes.`, confirmText: 'Change' }))) { el.value = r.level; return; }
  try {
    await api('/api/admin/permissions/level', { json: { role: r.name, level: el.value } });
    invalidate('admin:perms', 'admin:users', 'admin:lists'); await reloadBoot(); toast('Access level changed'); render();
  } catch (e) { el.value = r.level; toast(e.message, 'error'); }
};
Changes.ruleSet = (el) => {
  if (!permsData()?.rules) return;
  const st = ruleState(el.dataset.kind)[Number(el.dataset.i)];
  if (st) { st[el.dataset.f] = el.value.trim(); render(); }
};
Actions.ruleAdd = (el) => { ruleState(el.dataset.kind).push({ approver: 'admin', over: '' }); render(); };
Actions.ruleDel = (el) => { ruleState(el.dataset.kind).splice(Number(el.dataset.i), 1); render(); };
Actions.ruleUndo = (el) => { delete KL.ui.rules[el.dataset.kind]; render(); };
Actions.ruleSave = async (el) => {
  const kind = el.dataset.kind;
  document.activeElement?.blur?.(); // a limit still being typed is taken in first
  const steps = ruleState(kind).map((s, i) => ({ approver: s.approver, over: i === 0 ? '' : s.over }));
  try {
    await api('/api/admin/permissions/rules', { json: { kind, steps } });
    delete KL.ui.rules[kind]; invalidate('admin:perms', 'm:kinds'); toast('Approval rule saved'); render();
  } catch (e) { toast(e.message, 'error'); }
};
