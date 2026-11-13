/* Projects and sites. Navigation is Project (vertical) → Site → a few tabs that fit the kind of site:
   Biochar (low-tech kilns or high-tech plant), Gasifier, Agroforestry. People see only the sites they work at;
   project managers see the projects they manage; the director and HR see everything. General HR lives under People. */

const SITE_TABS = {
  biochar: (s) => [['overview', 'home', 'Overview'], ['stock', 'box', 'Stock'], ['production', 'flame', s.subtype === 'plant' ? 'Plant runs' : 'Kiln batches'], ['farmers', 'sprout', 'Farmers'], ['safety', 'shield', 'Safety'], ['team', 'users', 'Team']],
  gasifier: () => [['overview', 'home', 'Overview'], ['stock', 'box', 'Stock'], ['generation', 'sun', 'Generation'], ['equipment', 'cog', 'Equipment'], ['safety', 'shield', 'Safety'], ['team', 'users', 'Team']],
  agroforestry: () => [['overview', 'home', 'Overview'], ['nursery', 'sprout', 'Nursery'], ['plantation', 'tree', 'Plantation'], ['farmers', 'users', 'Farmers'], ['team', 'users', 'Team']],
};
const projectsMeta = () => KL.boot?.projects || {};
const mySites = () => (KL.boot?.mySites || []).filter((s) => s.project_type !== 'office');
const subtypeText = (s) => (s.project_type === 'biochar' ? projectsMeta().biochar?.subtypes?.[s.subtype] || '' : '');

/* ---------------------------------------------------------------- all my projects and sites */
Views.sites = () => {
  const sites = mySites();
  if (!sites.length) return `<h1 class="large">Sites</h1>${emptyState('pin', 'No site assigned to you', 'You can use HR, the Planner and your inbox. HR adds you to a site or project when you work at one.')}`;
  const groups = Object.entries(projectsMeta()).map(([key, p]) => [key, p, sites.filter((s) => s.project_type === key)]).filter(([, , list]) => list.length);
  return `<h1 class="large">Sites</h1><p class="sub">${KL.user.all_sites ? 'Every project and site' : KL.user.projects?.length ? `Projects you manage: ${KL.user.projects.map((p) => esc(projectsMeta()[p]?.name || p)).join(', ')}` : 'The sites you work at'}</p>
    ${groups.map(([key, p, list]) => `<section class="project-block">
      <div class="project-head pj-${esc(key)}"><span class="pj-ic">${ic(p.icon)}</span><div><b>${esc(p.name)}</b><small>${esc(p.blurb)}</small></div><span class="count">${list.length} site${list.length === 1 ? '' : 's'}</span></div>
      <div class="site-list">${list.map((s) => `<a class="site-card" href="#site/${esc(s.id)}"><span class="tx"><b>${esc(s.name)}</b><small>${esc([subtypeText(s), s.address].filter(Boolean).join(' · '))}</small></span>${s.strict ? tag('strict', 'bad') : ''}<span class="chev">${ic('chevron')}</span></a>`).join('')}</div>
    </section>`).join('')}
    <a class="btn wide" style="margin-top:16px" href="#map">${ic('map')} See them on the map</a>`;
};
/* Field staff: the Site tab opens their site straight away when they have only one. */
Views.mysite = () => { const s = mySites(); if (s.length === 1) { setTimeout(() => location.replace(`#site/${s[0].id}`), 0); return spinner(); } return Views.sites(); };

/* ---------------------------------------------------------------- one site, in tabs */
Views.site = (arg) => {
  const [id, tab0] = (arg || '').split('/');
  const s = (KL.boot?.mySites || []).find((x) => x.id === id);
  const back = mySites().length > 1 || isStaff() ? '#sites' : '#home';
  if (!s) return `${topbar('Site', back)}${emptyState('pin', 'Site not found or not yours')}`;
  const tabs = (SITE_TABS[s.project_type] || SITE_TABS.agroforestry)(s);
  const tab = tabs.some(([k]) => k === tab0) ? tab0 : 'overview';
  KL.ui.siteBack = `#site/${id}/${tab}`;
  const sum = data(`site:${id}`, () => api(`/api/sites/${id}/summary`));
  const p = projectsMeta()[s.project_type] || {};
  const head = `<div class="site-head pj-${esc(s.project_type)}"><span class="pj-ic">${ic(p.icon || 'pin')}</span><div class="tx"><b>${esc(p.name || '')}${subtypeText(s) ? ` · ${esc(subtypeText(s))}` : ''}</b><small>${esc(s.address || '')} · ${s.radius_m} m fence${s.strict ? ' · strict' : ''}</small></div>
    ${sum && !sum.error && sum.onSite.length ? `<span class="avatars" title="On site now">${sum.onSite.slice(0, 4).map((x) => avatar(x.name, 'sm')).join('')}</span>` : ''}</div>`;
  const bar = `<nav class="site-tabs">${tabs.map(([k, icon, label]) => `<a href="#site/${esc(id)}/${k}" class="${tab === k ? 'on' : ''}">${ic(icon)}<span>${esc(label)}</span></a>`).join('')}</nav>`;
  let body;
  if (sum === null) body = spinner();
  else if (sum.error) body = errorBox(sum.error);
  else body = (SITE_BODY[tab] || SITE_BODY.overview)(s, sum);
  return `${topbar(s.name, back)}${head}${bar}<div class="site-body">${body}</div>`;
};

/* compact list of one register's records at this site, with a New button */
function recMini(kind, s, { limit = 6, title = '', siteKey = 'site', empty = '', newLabel = '' } = {}) {
  const k = kindDef(kind);
  const list = data(`m:${kind}:site:${s.id}`, () => api(`/api/m/${kind}?siteId=${s.id}`));
  kinds();
  const head = title || k?.label || kind;
  const btn = k && k.canCreate ? `<a class="btn small" href="#rec/${esc(kind)}/new" data-action="siteNew" data-kind="${esc(kind)}" data-key="${esc(siteKey)}" data-site="${esc(s.id)}">${ic('plus')} ${esc(newLabel || 'New')}</a>` : '';
  if (list === null || !k) return group(head, spinner(), '', btn);
  if (list.error) return group(head, errorBox(list.error), '', btn);
  const rows = list.rows.slice(0, limit);
  return group(head, rows.length ? `<div class="card flush">${rows.map((r) => recRow(k, r, true)).join('')}${list.rows.length > limit ? `<a class="lrow more-row" href="#rec/${esc(kind)}"><span class="tx"><b>See all ${list.rows.length}</b></span><span class="chev">${ic('chevron')}</span></a>` : ''}</div>` : `<div class="card"><p class="hint">${esc(empty || `Nothing recorded yet.`)}</p></div>`, '', btn);
}
Actions.siteNew = (el) => {
  clearRecForm(el.dataset.kind); KL.ui.recInit = null;
  setF(`rf-${el.dataset.kind}-${el.dataset.key}`, el.dataset.site);
  location.hash = `#rec/${el.dataset.kind}/new`;
};
const tileRow = (tiles) => `<div class="tiles site-tiles">${tiles.map(([v, label, tone, icon, key, fmt]) => `<div class="tile ${tone || ''}"><div class="ti">${ic(icon)}</div><b>${v === null || v === undefined ? '–' : key ? num(v, key, fmt || '') : esc(v)}</b><span>${esc(label)}</span></div>`).join('')}</div>`;
const actionsGrid = (items) => `<div class="qa site-qa">${items.map(([href, icon, tone, label, act]) => `<a href="${href}" ${act || ''}><span class="qi ${tone}">${ic(icon)}</span>${esc(label)}</a>`).join('')}</div>`;
const newAct = (kind, key, s) => `data-action="siteNew" data-kind="${kind}" data-key="${key}" data-site="${esc(s.id)}"`;
const itemBal = (sum, like) => { const it = sum.items.find((i) => like.some((w) => i.name.toLowerCase().includes(w))); return it ? it.balance : null; };

const SITE_BODY = {
  overview(s, sum) {
    const st = sum.stats || {};
    const me = KL.me?.openAttendance;
    const here = me && me.site_id === s.id;
    let acts;
    let tiles;
    if (s.project_type === 'biochar') {
      acts = [['#attendance', 'pin', '', here ? 'Check out' : 'Check in'], ['#rec/batch/new', 'flame', 'earth', s.subtype === 'plant' ? 'Plant run' : 'Kiln batch', newAct('batch', 'site', s)], [`#site/${s.id}/stock`, 'box', 'amber', 'Stock entry'], [`#site/${s.id}/safety`, 'checklist', 'green', 'Daily check']];
      tiles = [[itemBal(sum, ['biochar']), 'kg biochar in stock', 'ok', 'flame', `ov-bc-${s.id}`], [itemBal(sum, ['biomass', 'feed']), 'kg biomass in stock', '', 'leaf', `ov-bm-${s.id}`], [itemBal(sum, ['diesel']), 'L diesel', 'warn', 'fuel', `ov-dz-${s.id}`],
        [st.output, `kg made this month · ${st.batches || 0} ${s.subtype === 'plant' ? 'runs' : 'batches'}`, 'blue', 'chart', `ov-out-${s.id}`], [st.applied, 'kg applied on farms', 'violet', 'sprout', `ov-ap-${s.id}`], [st.untested, 'batches waiting for the lab', st.untested ? 'warn' : '', 'scale', `ov-un-${s.id}`]];
    } else if (s.project_type === 'gasifier') {
      acts = [['#attendance', 'pin', '', here ? 'Check out' : 'Check in'], ['#rec/gas_run/new', 'sun', 'blue', 'Log a run', newAct('gas_run', 'site', s)], [`#site/${s.id}/stock`, 'box', 'amber', 'Stock entry'], [`#site/${s.id}/safety`, 'checklist', 'green', 'Daily check']];
      tiles = [[st.kwh, `kWh this month · ${st.runs || 0} runs`, 'ok', 'sun', `ov-kwh-${s.id}`], [st.hours, 'run hours this month', 'blue', 'clock', `ov-h-${s.id}`], [itemBal(sum, ['feed']), 'kg feedstock in stock', '', 'leaf', `ov-fs-${s.id}`],
        [itemBal(sum, ['diesel']), 'L diesel', 'warn', 'fuel', `ov-dz-${s.id}`], [st.down, 'equipment needing attention', st.down ? 'bad' : '', 'cog', `ov-dn-${s.id}`], [st.openIncidents, 'open incidents', st.openIncidents ? 'bad' : '', 'alert', `ov-in-${s.id}`]];
    } else {
      acts = [['#attendance', 'pin', '', here ? 'Check out' : 'Check in'], ['#rec/nursery/new', 'sprout', 'green', 'Nursery entry', newAct('nursery', 'site', s)], ['#rec/sapling/new', 'tree', 'earth', 'Plant saplings', newAct('sapling', 'site', s)], [`#site/${s.id}/farmers`, 'users', 'blue', 'Farmers']];
      tiles = [[st.inNursery, 'saplings in the nursery', 'ok', 'sprout', `ov-nu-${s.id}`], [st.planted, 'planted on farms', 'blue', 'tree', `ov-pl-${s.id}`], [st.survival === null || st.survival === undefined ? null : `${st.survival}%`, 'average survival', st.survival !== null && st.survival < 80 ? 'warn' : 'ok', 'leaf'],
        [st.farmers, 'farmers', 'violet', 'users', `ov-fa-${s.id}`]];
    }
    return `${actionsGrid(acts)}${tileRow(tiles)}
      ${group('On site now', sum.onSite.length ? `<div class="card flush">${sum.onSite.map((x) => `<div class="lrow-static row">${avatar(x.name)}<span class="tx" style="flex:1"><b>${esc(x.name)}</b><span class="muted" style="font-size:13px;display:block">since ${esc(fmtDate(x.checkin_at).split(', ')[1] || '')} · <span data-since="${esc(x.checkin_at)}">${esc(duration(x.checkin_at))}</span></span></span>${tag('on site', 'ok')}</div>`).join('')}</div>` : '<div class="card"><p class="hint">Nobody is checked in right now.</p></div>')}
      ${group('Open tasks here', sum.tasks.length ? `<div class="card flush">${sum.tasks.map((t) => lrow({ action: 'openTask', data: { id: t.id }, icon: 'kanban', tone: t.due_date && t.due_date < todayISO() ? 'red' : 'violet', title: t.title, sub: t.due_date ? `due ${esc(fmtDate(t.due_date, false))}` : 'no date' })).join('')}</div>` : '<div class="card"><p class="hint">No open tasks for this site.</p></div>', '', '<a href="#planner">Planner</a>')}
      ${group('Latest activity', sum.recent.length ? `<div class="card flush">${sum.recent.map((x) => lrow({ href: `#rec/${x.kind}/${x.id}`, icon: x.icon, title: `${x.label}: ${x.title}`, sub: `${esc(x.user_name)} · ${esc(timeAgo(x.created_at))}`, right: kindDef(x.kind)?.approval || (kindDef(x.kind)?.statuses || []).length ? stag(x.status) : '' })).join('')}</div>` : '<div class="card"><p class="hint">Nothing yet.</p></div>')}`;
  },
  stock(s, sum) {
    const items = sum.items;
    return `${group('Registers', items.length ? `<div class="card flush">${items.map((it) => lrow({ href: `#registers/${s.id}/${it.id}`, icon: it.kind === 'product' ? 'box' : 'fuel', tone: it.low_stock && it.kind === 'input' && it.balance < it.low_stock ? 'red' : it.kind === 'product' ? 'green' : 'amber', title: it.name, sub: it.kind === 'product' ? 'Made here' : 'Used here', right: `<span class="right"><b class="mono">${fmtNum(it.balance, 1)}</b> <span class="muted" style="font-size:12px">${esc(it.unit)}</span>${it.low_stock && it.kind === 'input' && it.balance < it.low_stock ? `<br>${tag('low', 'bad')}` : ''}</span>` })).join('')}</div><p class="hint" style="margin-top:8px">Tap a register to record stock in, out or a physical count with a photo.</p>` : '<div class="card"><p class="hint">No registers at this site.</p></div>')}
      ${recMini('purchase_request', s, { title: 'Purchase requests', limit: 4 })}
      ${recMini('transfer', s, { title: 'Transfers to other sites', limit: 3, siteKey: 'from_site' })}
      ${s.project_type === 'biochar' ? recMini('dispatch', s, { title: 'Dispatch (sales)', limit: 3 }) : ''}
      ${isStaff() ? `<a class="btn small" href="/api/export/site/${esc(s.id)}?token=${encodeURIComponent(KL.token)}">${ic('download')} Audit CSV of every entry</a>` : ''}`;
  },
  production(s) {
    const unit = s.subtype === 'plant' ? 'Plant run' : 'Kiln batch';
    return `<div class="banner info" style="margin-bottom:4px">${ic('flame')}<div><b>${s.subtype === 'plant' ? 'Industrial plant' : 'Kon-Tiki kilns'}</b><p>Each ${unit.toLowerCase()} takes biomass out of stock and puts biochar in. Send a sample to the lab, then record where the biochar is applied.</p></div></div>
      ${recMini('batch', s, { title: s.subtype === 'plant' ? 'Plant runs' : 'Kiln batches', limit: 8, newLabel: unit })}
      ${recMini('lab_result', s, { title: 'Lab results', limit: 4 })}
      ${recMini('equipment', s, { title: s.subtype === 'plant' ? 'Plant equipment' : 'Kilns and machines', limit: 6 })}
      <a class="btn wide" href="#carbon">${ic('leaf')} Carbon chain of custody (all batches)</a>`;
  },
  generation(s) {
    return `${recMini('gas_run', s, { title: 'Gasifier runs', limit: 10, newLabel: 'Log a run' })}<p class="hint">Each run takes feedstock and start-up diesel out of stock and adds power and ash.</p>`;
  },
  equipment(s) {
    return `${recMini('equipment', s, { title: 'Equipment', limit: 10 })}${recMini('maintenance', s, { title: 'Maintenance and breakdowns', limit: 6 })}`;
  },
  safety(s) {
    return `${group('Daily checks', siteChecklists(s))}${recMini('incident', s, { title: 'Incidents', limit: 4, newLabel: 'Report' })}
      ${s.project_type === 'biochar' ? recMini('maintenance', s, { title: 'Maintenance', limit: 4 }) : ''}`;
  },
  farmers(s) {
    const fl = data('farmers', () => api('/api/farmers'));
    const rows = fl && !fl.error ? fl.rows.filter((f) => f.site_id === s.id) : [];
    const list = fl === null ? spinner() : fl.error ? errorBox(fl.error) : rows.length ? `<div class="card flush">${rows.map((f) => lrow({ href: `#farmers/${f.id}`, icon: 'sprout', tone: 'green', title: f.name, sub: `${esc([f.village, f.taluka].filter(Boolean).join(', '))} · ${f.docs} signed, ${f.plots} plot${f.plots === 1 ? '' : 's'}` })).join('')}</div>` : '<div class="card"><p class="hint">No farmers yet.</p></div>';
    return `${group(`Farmers (${rows.length})`, list, '', `<button type="button" class="btn small" data-action="farmerAdd" data-site="${esc(s.id)}">${ic('plus')} Add farmer</button>`)}
      <p class="hint">Open a farmer to sign a document on the phone, upload a KML plot boundary or land record.</p>
      ${s.project_type === 'biochar' ? recMini('application', s, { title: 'Biochar applied on farms', limit: 5 }) : ''}
      ${isStaff() ? recMini('farmer_payment', s, { title: 'Farmer payments', limit: 4 }) : ''}`;
  },
  nursery(s, sum) {
    const n = sum.stats.nursery || {};
    const entries = Object.entries(n);
    return `${group('In the nursery now', entries.length ? `<div class="card"><div class="kv">${entries.map(([sp, q]) => `<span>${esc(sp)}</span><span style="${q < 0 ? 'color:var(--red)' : ''}">${fmtNum(q)} plants</span>`).join('')}</div><p class="hint" style="margin-top:8px">Sown and received, less died and planted out (planting comes from the Plantation tab).</p></div>` : '<div class="card"><p class="hint">Nothing in the nursery yet.</p></div>')}
      ${recMini('nursery', s, { title: 'Nursery register', limit: 8, newLabel: 'Entry' })}`;
  },
  plantation(s) {
    return `${recMini('sapling', s, { title: 'Saplings planted on farms', limit: 6, newLabel: 'Plant' })}${recMini('survival', s, { title: 'Survival checks', limit: 6, newLabel: 'Check' })}`;
  },
  team(s, sum) {
    const hr = ['admin', 'hr'].includes(KL.user.role);
    const ids = new Set(sum.members.map((m) => m.id));
    const addable = KL.boot.people.filter((p) => !ids.has(p.id));
    return `${group('People', `<div class="card flush">${sum.members.map((m) => `<div class="lrow-static row">${avatar(m.name)}<span class="tx" style="flex:1;min-width:0"><b>${esc(m.name)}</b><span class="muted" style="font-size:13px;display:block">${esc(m.designation || ROLE_TEXT[m.role])} · ${esc(m.how)}</span></span>${sum.onSite.some((o) => o.user_id === m.id) ? tag('on site', 'ok') : ''}${hr && m.how === 'works here' ? `<button type="button" class="btn ghost icon-only small" data-action="siteMember" data-user="${esc(m.id)}" data-site="${esc(s.id)}" aria-label="Remove from site">${ic('x')}</button>` : ''}</div>`).join('') || '<p class="empty">Nobody yet.</p>'}</div>`)}
      ${hr ? group('Add an employee to this site', `<div class="card stack">${field('Employee', select('sm-user', F('sm-user', ''), addable.map((p) => [p.id, `${p.name} · ${p.designation || ROLE_TEXT[p.role]}`]), { blank: 'Choose' }))}<button type="button" class="btn primary wide" data-action="siteMember" data-site="${esc(s.id)}" data-add="1">${ic('plus')} Add to ${esc(s.name)}</button><p class="hint">They see this site in their app at once. Managers of a whole project are set on their employee record.</p></div>`) : ''}
      ${isStaff() ? recMini('labour', s, { title: 'Contract labour this month', limit: 6 }) : ''}`;
  },
};
function siteChecklists(s) {
  const t = data('m:checklist_template', () => api('/api/m/checklist_template'));
  if (!t || t.error) return spinner();
  const mine = t.rows.filter((x) => x.site_id === s.id);
  return mine.length ? `<div class="card flush">${mine.map((x) => `<div class="lrow-static row"><span class="icon green">${ic('checklist')}</span><span class="tx" style="flex:1"><b>${esc(x.title)}</b><span class="muted" style="font-size:13px;display:block">${esc(x.data.frequency || '')} · ${String(x.data.items || '').split('\n').filter(Boolean).length} items</span></span><a class="btn small primary" href="#rec/checklist_run/new" data-action="startChecklist" data-id="${esc(x.id)}">Start</a></div>`).join('')}</div>` : `<div class="card"><p class="hint">No checklist for this site.</p>${isStaff() ? `<a class="btn small" style="margin-top:8px" href="#rec/checklist_template/new" data-action="siteNew" data-kind="checklist_template" data-key="site" data-site="${esc(s.id)}">${ic('plus')} Make one</a>` : ''}</div>`;
}
Actions.siteMember = async (el) => {
  const add = Boolean(el.dataset.add);
  const userId = add ? F('sm-user', '') : el.dataset.user;
  if (!userId) return toast('Choose the employee', 'error');
  try {
    await api('/api/hr/site-member', { json: { userId, siteId: el.dataset.site, add } });
    clearF('sm-user'); invalidate(`site:${el.dataset.site}`, 'hr'); toast(add ? 'Added to the site' : 'Removed from the site'); render();
  } catch (e) { toast(e.message, 'error'); }
};

/* ---------------------------------------------------------------- HR: where a person works */
Views.assign = (uid) => {
  const p = data(`hr:profile:${uid}`, () => api(`/api/hr/profile/${uid}`));
  if (p === null) return `${topbar('Works at', `#person/${uid}`)}${spinner()}`;
  if (p.error) return `${topbar('Works at', `#person/${uid}`)}${errorBox(p.error)}`;
  const u = p.user;
  if (KL.ui.asInit !== uid) { KL.ui.asInit = uid; setF('as-sites', [...u.sites]); setF('as-projects', [...u.projects]); }
  const sites = F('as-sites', []);
  const projects = F('as-projects', []);
  const manager = u.role !== 'field';
  const groups = Object.entries(projectsMeta()).map(([key, pm]) => [key, pm, KL.boot.sites.filter((s) => s.project_type === key)]);
  const office = KL.boot.sites.filter((s) => s.project_type === 'office');
  return `${topbar(`Where ${firstName(u.name)} works`, `#person/${uid}`)}
    <p class="sub">${esc(u.name)} sees only what is ticked here. Leave everything empty for someone who only uses HR and the Planner.</p>
    ${manager ? group('Manages whole projects', `<div class="chips">${groups.map(([key, pm]) => `<button type="button" data-action="asToggle" data-list="as-projects" data-id="${key}" aria-pressed="${projects.includes(key)}">${ic(pm.icon)} ${esc(pm.name)}</button>`).join('')}</div><p class="hint" style="margin-top:6px">A project manager sees every site of the project, including new ones.</p>`) : ''}
    ${groups.map(([key, pm, list]) => group(pm.name, `<div class="chips">${list.map((s) => `<button type="button" data-action="asToggle" data-list="as-sites" data-id="${esc(s.id)}" aria-pressed="${sites.includes(s.id) || projects.includes(key)}" ${projects.includes(key) ? 'disabled' : ''}>${esc(s.name)}</button>`).join('')}</div>`)).join('')}
    ${office.length ? group('Office', `<div class="chips">${office.map((s) => `<button type="button" data-action="asToggle" data-list="as-sites" data-id="${esc(s.id)}" aria-pressed="${sites.includes(s.id)}">${esc(s.name)}</button>`).join('')}</div>`) : ''}
    <button type="button" class="btn primary wide" style="margin-top:16px" data-action="asSave" data-id="${esc(uid)}">Save</button>`;
};
Actions.asToggle = (el) => {
  const list = [...F(el.dataset.list, [])];
  const i = list.indexOf(el.dataset.id);
  if (i >= 0) list.splice(i, 1); else list.push(el.dataset.id);
  setF(el.dataset.list, list); render();
};
Actions.asSave = async (el) => {
  try {
    await api('/api/hr/assign', { json: { userId: el.dataset.id, sites: F('as-sites', []), projects: F('as-projects', []) } });
    KL.ui.asInit = null; invalidate('hr', 'site'); toast('Saved. They see the change next time the app refreshes.'); location.hash = `#person/${el.dataset.id}`;
  } catch (e) { toast(e.message, 'error'); }
};
function worksAt(u) {
  const names = (u.sites || []).map((id) => siteName(id));
  const pj = (u.projects || []).map((p) => `${projectsMeta()[p]?.name || p} (whole project)`);
  const all = [...pj, ...names];
  return `<div class="card"><div class="chips">${all.length ? all.map((n) => `<span class="pill">${ic('pin')} ${esc(n)}</span>`).join('') : '<span class="hint">No site: HR and Planner only</span>'}</div>${u.canAssign ? `<a class="btn small" style="margin-top:10px" href="#assign/${esc(u.id)}">${ic('pen')} Change</a>` : ''}</div>`;
}

Views.work = () => Views.mysite();
