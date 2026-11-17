/* Settings > Lists: every dropdown the company can change (roles, offices, projects, leave types, vehicles and the
   record forms' options). One card per list: rows with a bin to delete (greyed when in use), an Add row at the foot. */

const canLists = () => ['admin', 'hr'].includes(KL.user?.role);
const LIST_GROUP_TITLE = { people: 'People', money: 'Money', ops: 'Operations' };

/** Tabs at the top of Settings for the director and HR: General · Lists. */
function settingsTabs(active) {
  if (!canLists()) return '';
  return `<nav class="tabs" aria-label="Settings">${[['settings', 'General'], ['settings/lists', 'Lists']].map(([h, l]) => `<a href="#${h}" class="${h === active ? 'on' : ''}" ${h === active ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>`;
}

function listRowText(L, it) {
  if (L.key === 'roles') return `<b>${esc(it.value)}</b><small>${esc(KL.cache['admin:lists']?.levels?.[it.level] || it.level)}</small>`;
  if (L.key === 'offices') return `<b class="notr">${esc(it.value)}</b><span>${esc(it.name)}</span>`;
  if (L.key === 'projects') return `${ic(it.icon || 'pin')}<b>${esc(it.name)}</b><small class="notr">${esc(it.code)}</small>`;
  if (L.key === 'vehicles') return `<b>${esc(it.value)}</b><small>₹${esc(String(it.rate))} / km</small>`;
  return `<b>${esc(it.value)}</b>`;
}

function listCard(L, extra) {
  const rows = L.items.map((it) => {
    const name = it.name || it.value;
    const right = it.builtin ? tag('built in', '')
      : it.used ? `<span class="lc-used" title="In use, so it cannot be deleted">${tag(`in use · ${it.used}`, '')}</span>`
        : `<button type="button" class="btn ghost icon-only lc-del" data-action="listDel" data-list="${esc(L.key)}" data-value="${esc(it.value)}" data-name="${esc(name)}" aria-label="Delete ${esc(name)}" title="Delete">${ic('trash')}</button>`;
    return `<div class="lc-row"><span class="lc-name">${listRowText(L, it)}</span>${right}</div>`;
  }).join('');
  const id = (f) => `la-${L.key}-${f}`;
  const levels = extra.levels || {};
  const inputs = L.key === 'roles' ? `<input class="input" id="${id('value')}" placeholder="New role, e.g. Kiln operator" /><select class="input" id="${id('level')}">${Object.entries(levels).filter(([k]) => k !== 'admin' || KL.user.role === 'admin').map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>`
    : L.key === 'offices' ? `<input class="input lc-short notr" id="${id('value')}" inputmode="numeric" maxlength="2" placeholder="${esc(nextOfficeNo(L))}" value="${esc(nextOfficeNo(L))}" aria-label="Office number" /><input class="input" id="${id('name')}" placeholder="Office name, e.g. Rajkot" />`
      : L.key === 'projects' ? `<input class="input lc-short notr" id="${id('code')}" maxlength="3" placeholder="SOL" aria-label="3-letter code" style="text-transform:uppercase" /><input class="input" id="${id('value')}" placeholder="Project name, e.g. Solar" /><select class="input lc-icon" id="${id('icon')}" aria-label="Icon">${(extra.icons || []).map((i) => `<option value="${i}">${i[0].toUpperCase()}${i.slice(1)}</option>`).join('')}</select>`
        : L.key === 'vehicles' ? `<input class="input" id="${id('value')}" placeholder="Vehicle, e.g. Tractor" /><input class="input lc-short" id="${id('rate')}" inputmode="decimal" placeholder="₹ / km" aria-label="Rate per km" />`
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
    ${groups.map(([g, ls]) => group(LIST_GROUP_TITLE[g] || g, `<div class="lc-grid">${ls.map((L) => listCard(L, d)).join('')}</div>`)).join('')}`;
}

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
    return settingsGeneral().replace(/(<\/header>)/, `$1${settingsTabs('settings')}`);
  };
}
