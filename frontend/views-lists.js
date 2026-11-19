/* Settings > Lists: every dropdown the company can change (roles, offices, projects, leave types, vehicles and the
   record forms' options). One card per list: rows with a bin to delete (greyed when in use), an Add row at the foot. */

const canLists = () => isAdmin() || can('settings.lists');
const LIST_GROUP_TITLE = { people: 'People', money: 'Money', ops: 'Operations' };
const RENAMABLE = new Set(['roles', 'offices', 'departments']);

/** Tabs at the top of Settings: General · Lists (director, designations with "Edit lists") · Designations & access (director). */
function settingsTabs(active) {
  const tabs = [['settings', 'General'], ...(canLists() ? [['settings/lists', 'Lists']] : []), ...(isAdmin() ? [['settings/roles', 'Designations & access']] : [])];
  if (tabs.length < 2) return '';
  return `<nav class="tabs" aria-label="Settings">${tabs.map(([h, l]) => `<a href="#${h}" class="${h === active ? 'on' : ''}" ${h === active ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>`;
}

function listRowText(L, it) {
  if (L.key === 'roles') return `<b>${esc(it.value)}</b><small>${esc(KL.cache['admin:lists']?.levels?.[it.level] || it.level)}</small>`;
  if (L.key === 'offices') return `<b class="notr">${esc(it.value)}</b><span>${esc(it.name)}</span>`;
  if (L.key === 'projects') return `${ic(it.icon || 'pin')}<b>${esc(it.name)}</b><small class="notr">${esc(it.code)}</small>`;
  if (L.key === 'departments') {
    const projs = KL.boot.projectList || [];
    return `<b>${esc(it.name)}</b><span class="pm-chips">${projs.map((p) => `<button type="button" class="pm-chip notr" data-action="deptProj" data-value="${esc(it.value)}" data-project="${esc(p.key)}" aria-pressed="${it.projects.includes(p.key)}" title="${esc(p.name)}">${esc(p.code)}</button>`).join('')}</span>`;
  }
  if (L.key === 'vehicles') return `<b>${esc(it.value)}</b><small>₹${esc(String(it.rate))} / km</small>`;
  return `<b>${esc(it.value)}</b>`;
}

function listCard(L, extra) {
  const rows = L.items.map((it) => {
    const name = it.name || it.value;
    const del = it.builtin ? tag('built in', '')
      : it.used ? `<span class="lc-used" title="In use, so it cannot be deleted">${tag(`in use · ${it.used}`, '')}</span>`
        : `<button type="button" class="btn ghost icon-only lc-del" data-action="listDel" data-list="${esc(L.key)}" data-value="${esc(it.value)}" data-name="${esc(name)}" aria-label="Delete ${esc(name)}" title="Delete">${ic('trash')}</button>`;
    const ren = RENAMABLE.has(L.key) ? `<button type="button" class="btn ghost icon-only" data-action="listRename" data-list="${esc(L.key)}" data-value="${esc(it.value)}" data-name="${esc(name)}" aria-label="Rename ${esc(name)}" title="Rename">${ic('pen')}</button>` : '';
    return `<div class="lc-row"><span class="lc-name">${listRowText(L, it)}</span><span class="row" style="gap:4px;flex:none">${ren}${del}</span></div>`;
  }).join('');
  const id = (f) => `la-${L.key}-${f}`;
  const levels = extra.levels || {};
  const inputs = L.key === 'roles' ? `<input class="input" id="${id('value')}" placeholder="New designation, e.g. District Coordinator" /><select class="input" id="${id('level')}">${Object.entries(levels).filter(([k]) => k !== 'admin' || KL.user.role === 'admin').map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>`
    : L.key === 'offices' ? `<input class="input lc-short notr" id="${id('value')}" inputmode="numeric" maxlength="2" placeholder="${esc(nextOfficeNo(L))}" value="${esc(nextOfficeNo(L))}" aria-label="Office number" /><input class="input" id="${id('name')}" placeholder="Office name, e.g. Rajkot" />`
      : L.key === 'projects' ? `<input class="input lc-short notr" id="${id('code')}" maxlength="3" placeholder="SOL" aria-label="3-letter code" style="text-transform:uppercase" /><input class="input" id="${id('value')}" placeholder="Project name, e.g. Solar" /><select class="input lc-icon" id="${id('icon')}" aria-label="Icon">${(extra.icons || []).map((i) => `<option value="${i}">${i[0].toUpperCase()}${i.slice(1)}</option>`).join('')}</select>`
        : L.key === 'vehicles' ? `<input class="input" id="${id('value')}" placeholder="Vehicle, e.g. Tractor" /><input class="input lc-short" id="${id('rate')}" inputmode="decimal" placeholder="₹ / km" aria-label="Rate per km" />`
          : L.key === 'departments' ? `<input class="input" id="${id('value')}" placeholder="New department, e.g. Solar. Tap project codes to put projects in it" />`
            : `<input class="input" id="${id('value')}" placeholder="Add to ${esc(L.label.toLowerCase())}" />`;
  return `<div class="card lc" id="lc-${esc(L.key)}">
    <div class="lc-head"><b>${esc(L.label)}</b>${L.hint ? `<span class="hint">${esc(L.hint)}</span>` : ''}</div>
    <div class="lc-rows">${rows}</div>
    <div class="lc-add"><div class="lc-inputs">${inputs}</div>
      <details class="lc-tr"><summary>Gujarati and Hindi names (optional)</summary><div class="lc-inputs"><input class="input" id="${id('gu')}" placeholder="ગુજરાતી" lang="gu" /><input class="input" id="${id('hi')}" placeholder="हिन्दी" lang="hi" /></div></details>
      <button type="button" class="btn primary" data-action="listAdd" data-list="${esc(L.key)}">${ic('plus')}<span>Add</span></button></div>
  </div>`;
}
function nextOfficeNo(L) {
  const used = new Set(L.items.map((i) => i.value));
  for (let n = 1; n < 100; n++) { const c = String(n).padStart(2, '0'); if (!used.has(c)) return c; }
  return '';
}

function listsView() {
  const d = data('admin:lists', () => api('/api/admin/lists'));
  const head = `${topbar('Settings', '#home')}${settingsTabs('settings/lists')}`;
  if (d === null) return `${head}${spinner()}`;
  if (d.error) return `${head}${errorBox(d.error)}`;
  const groups = Object.keys(d.groups).map((g) => [g, d.lists.filter((L) => L.group === g)]).filter(([, ls]) => ls.length);
  return `${head}<p class="sub">Every dropdown in the app. Add with the Add button; delete with the bin. Items already used in a record stay.</p>
    ${groups.map(([g, ls]) => group(LIST_GROUP_TITLE[g] || g, `<div class="lc-grid">${ls.map((L) => listCard(L, d)).join('')}</div>`)).join('')}
    ${can('sites.edit') ? group('Site sub-groups', subgroupCard()) : ''}`;
}
/** Sub-groups inside each project (e.g. Biochar: low-tech, high-tech). Sites are grouped by them. */
function subgroupCard() {
  const keys = [...Object.keys(KL.boot?.projects || {}), 'office'];
  return `<div class="card stack"><p class="hint">Sites are listed by project and then by these sub-groups. Rename with the pen; a removed sub-group's sites show as "Sub-group not set" until edited.</p>
    ${keys.map((k) => `<div class="sg-row"><b>${esc(projMeta(k).name || k)}</b><div class="chips">${subgroupsOf(k).map((g) => `<span class="sg-chip"><span>${esc(g.name)}</span><button type="button" class="x" aria-label="Rename ${esc(g.name)}" data-action="sgRename" data-project="${esc(k)}" data-key="${esc(g.key)}" data-name="${esc(g.name)}">${ic('pen')}</button>${['kiln', 'plant'].includes(g.key) && k === 'biochar' ? '' : `<button type="button" class="x" aria-label="Remove ${esc(g.name)}" data-action="sgDelete" data-project="${esc(k)}" data-key="${esc(g.key)}" data-name="${esc(g.name)}">${ic('trash')}</button>`}</span>`).join('')}<button type="button" class="btn small" data-action="sgAdd" data-project="${esc(k)}">${ic('plus')} Add</button></div></div>`).join('')}</div>`;
}
const sgDone = async (msg) => { await reloadBoot(); invalidate('admin:lists'); toast(msg); render(); };
Actions.sgAdd = async (el) => {
  const v = await modal({ title: `New sub-group in ${projMeta(el.dataset.project).name || el.dataset.project}`, fields: [{ key: 'name', label: 'Name', placeholder: 'e.g. Trust land' }], confirmText: 'Add' });
  if (!v) return;
  try { await api('/api/admin/lists/subgroups', { json: { project: el.dataset.project, name: v.name } }); await sgDone('Added'); } catch (e) { toast(e.message, 'error'); }
};
Actions.sgRename = async (el) => {
  const v = await modal({ title: 'Rename sub-group', fields: [{ key: 'name', label: 'Name', value: el.dataset.name }], confirmText: 'Save' });
  if (!v) return;
  try { await api('/api/admin/lists/subgroups', { json: { project: el.dataset.project, key: el.dataset.key, name: v.name } }); await sgDone('Renamed'); } catch (e) { toast(e.message, 'error'); }
};
Actions.sgDelete = async (el) => {
  if (!(await modal({ title: `Remove ${el.dataset.name}?`, message: 'Its sites stay; they show as "Sub-group not set" until you edit them.', confirmText: 'Remove' }))) return;
  try { await api('/api/admin/lists/subgroups/remove', { json: { project: el.dataset.project, key: el.dataset.key } }); await sgDone('Removed'); } catch (e) { toast(e.message, 'error'); }
};

Actions.listAdd = async (el) => {
  const key = el.dataset.list;
  const val = (f) => document.getElementById(`la-${key}-${f}`)?.value?.trim() || '';
  const body = { value: val('value'), name: val('name'), code: val('code').toUpperCase(), icon: val('icon'), level: val('level'), rate: val('rate'), gu: val('gu'), hi: val('hi') };
  if (!body.value) { toast('Type a name first', 'error'); document.getElementById(`la-${key}-value`)?.focus(); return; }
  try {
    await api(`/api/admin/lists/${key}/add`, { json: body });
    invalidate('admin:lists'); invalidate('m:kinds'); await reloadBoot(); toast('Added'); render();
    setTimeout(() => document.getElementById(`la-${key}-value`)?.focus(), 50);
  } catch (e) { toast(e.message, 'error'); }
};
Actions.deptProj = async (el) => {
  const on = el.getAttribute('aria-pressed') !== 'true';
  try {
    await api('/api/admin/lists/departments/project', { json: { value: el.dataset.value, project: el.dataset.project, on } });
    invalidate('admin:lists'); await reloadBoot(); toast(on ? 'Added to the department' : 'Taken out'); render();
  } catch (e) { toast(e.message, 'error'); }
};
Actions.listRename = async (el) => {
  const what = { roles: 'Everyone with this designation, its ticks and its approval steps follow the new name.', offices: 'The office number (and so every employee code) stays the same.', departments: 'Its people, projects and approval rules stay linked.' }[el.dataset.list] || '';
  const v = await modal({ title: `Rename ${el.dataset.name}`, message: what, fields: [{ key: 'name', label: 'New name', value: el.dataset.name }], confirmText: 'Rename' });
  if (!v || !v.name || v.name === el.dataset.name) return;
  try {
    await api(`/api/admin/lists/${el.dataset.list}/rename`, { json: { value: el.dataset.value, name: v.name } });
    invalidate('admin:lists', 'admin:perms', 'admin:users', 'hr'); await reloadBoot(); await refreshMe(); toast('Renamed'); render();
  } catch (e) { toast(e.message, 'error'); }
};
Actions.listDel = async (el) => {
  if (!(await modal({ title: `Delete ${el.dataset.name}?`, message: 'It disappears from the dropdown. You can add it again later.', confirmText: 'Delete', danger: true }))) return;
  try {
    await api(`/api/admin/lists/${el.dataset.list}/delete`, { json: { value: el.dataset.value } });
    invalidate('admin:lists'); invalidate('m:kinds'); await reloadBoot(); toast('Deleted'); render();
  } catch (e) { toast(e.message, 'error'); }
};

{
  const settingsGeneral = Views.settings;
  Views.settings = (arg) => {
    if (arg === 'lists' && canLists()) return listsView();
    if (arg === 'roles' && isAdmin()) return permsView();
    return settingsGeneral().replace(/(<\/header>)/, `$1${settingsTabs('settings')}`);
  };
}
