/* Inside a site (2026-11-19 redesign): everything done at a site lives here, as big tiles that fit the kind of
   site, for field staff (Site tab) and office staff (Operations > Sites > a site) alike. Office staff also get crew
   attendance, every record of the site (the full tabbed view) and its settings. Prototype:
   claude.ai/artifact/FPnhQbPP7SRumKQacV9yF7 */

const HUB_TONE = { biochar: 'earth', gasifier: 'blue', agroforestry: 'green' };
const fenceText = (s) => `${s.radius_m} m fence · ${['exceptions allowed', 'check-in inside only', 'check-in and check-out inside only'][Number(s.strict) || 0]}`;

/** One tile: a link, a "new record here" (site filled in), or the site's checklist. */
function hubTile(t) {
  const inner = `<span class="icon ${t.tone || ''}">${ic(t.icon)}</span><span class="ht-tx"><b>${esc(t.label)}</b>${t.sub ? `<span class="${t.warn ? 'warn' : t.ok ? 'ok' : ''}">${esc(t.sub)}</span>` : ''}</span>`;
  if (t.kind) return `<a class="hub-tile" href="#rec/${esc(t.kind)}/new" data-action="siteNew" data-kind="${esc(t.kind)}" data-key="${esc(t.key || 'site')}" data-site="${esc(t.site)}">${inner}</a>`;
  if (t.check) return `<button type="button" class="hub-tile" data-action="startChecklist" data-id="${esc(t.check)}">${inner}</button>`;
  return `<a class="hub-tile" href="${esc(t.href)}">${inner}</a>`;
}

function siteHub(s, { back = '', field = false } = {}) {
  const sum = data(`site:${s.id}`, () => api(`/api/sites/${s.id}/summary`));
  const p = projMeta(s.project_type);
  const tone = HUB_TONE[s.project_type] || '';
  const office = !field;
  const head = field ? fieldBar(s.name)
    : topbar(s.name, back || '#sites', can('sites.edit') ? `<a class="btn small" href="#siteedit/${esc(s.id)}">${ic('pen')} Edit</a>` : '');
  const kicker = `<div class="hub-head">${field && back ? `<a class="fa-back" href="${back}">${ic('back')}<span>All my sites</span></a>` : ''}<span class="tag ${tone === 'earth' ? 'violet' : ''} hub-kick hk-${tone}">${esc(p.name || s.project_type)}${subtypeText(s) ? ` · ${esc(subtypeText(s))}` : ''}</span><p class="sub">${esc(fenceText(s))}</p>${office ? siteWhere(s) : ''}</div>`;
  if (sum === null) return `${head}${kicker}${spinner()}`;
  if (sum.error) return `${head}${kicker}${errorBox(sum.error)}`;
  const st = sum.stats || {};
  const low = sum.items.filter((i) => i.kind === 'input' && i.low_stock && i.balance < i.low_stock);
  const main = sum.items.find((i) => /biomass|feed/i.test(i.name)) || sum.items[0];
  const sf = sum.safety || {};
  const safetyTile = { icon: 'shield', tone: 'green', label: 'Safety check', sub: sf.doneToday ? `Done today${sf.problems ? ` · ${sf.problems} problem${sf.problems === 1 ? '' : 's'}` : ''}` : 'Not done today', ok: sf.doneToday && !sf.problems, warn: !sf.doneToday || sf.problems, ...(sf.template ? { check: sf.template } : { href: '#rec/checklist_template' }) };
  const stockTile = { icon: 'box', tone: 'amber', label: 'Stock register', sub: low.length ? `${low[0].name} is low` : 'In, out, count', warn: low.length > 0, href: `#site/${s.id}/stock` };
  const rec = (kind, icon, tone_, label, sub) => ({ kind, icon, tone: tone_, label, sub, site: s.id });
  let tiles;
  if (s.project_type === 'agroforestry') {
    tiles = [{ icon: 'users', tone: 'green', label: 'Farmers & documents', sub: `${st.farmers || 0} farmers`, href: `#site/${s.id}/farmers` }, rec('nursery', 'sprout', 'teal', 'Nursery entry', `${fmtNum(st.inNursery || 0)} in the nursery`),
      rec('sapling', 'tree', 'green', 'Plant saplings', `${fmtNum(st.planted || 0)} planted`), rec('survival', 'leaf', 'violet', 'Survival check', st.survival !== null && st.survival !== undefined ? `${st.survival}% alive` : 'Count living trees')];
    if (sum.items.length) tiles.push(stockTile);
  } else if (s.project_type === 'gasifier') {
    tiles = [stockTile, safetyTile, ...(isOff('gas_run') ? [] : [rec('gas_run', 'sun', 'blue', 'Log a run', `${fmtNum(st.kwh || 0)} kWh this month`)]), rec('maintenance', 'cog', 'violet', 'Equipment service', st.down ? `${st.down} not working` : 'All working')];
  } else if (s.project_type === 'office') {
    tiles = []; // an office: its people, problems and records; no kilns or stock
  } else {
    tiles = [stockTile, safetyTile, rec('batch', 'flame', 'orange', s.subtype === 'plant' ? 'Plant run' : 'Kiln batch', `${st.batches || 0} this month · ${fmtNum(st.output || 0)} kg`)];
    if (s.project_type === 'biochar') tiles.push({ icon: 'sprout', tone: 'green', label: 'Farmers', sub: `${st.farmers || 0} farmers`, href: `#site/${s.id}/farmers` });
  }
  tiles.push(rec('incident', 'alert', 'red', 'Report a problem', st.openIncidents ? `${st.openIncidents} open` : 'Injury, fire, breakdown'));
  tiles.push({ icon: 'users', tone: 'blue', label: 'Team', sub: `${sum.onSite.length} on site now`, href: `#site/${s.id}/team` });
  if (office || KL.user.supervisor) tiles.push({ icon: 'checklist', tone: 'violet', label: 'Crew attendance', sub: 'Workers without phones', href: `#muster/${s.id}` });
  if (office) tiles.push({ icon: 'list', tone: 'teal', label: 'Site records', sub: 'Everything logged here', href: `#site/${s.id}/overview` });
  const stat = (href, label, value, cls) => `<a class="today-tile ${cls || ''}" href="${href}"><span class="tt-lbl">${esc(label)}</span><b>${value}</b></a>`;
  const second = s.project_type === 'office' ? '' : s.project_type === 'agroforestry' ? stat(`#site/${s.id}/nursery`, 'In the nursery', fmtNum(st.inNursery || 0)) : s.project_type === 'gasifier' && !isOff('gas_run') ? stat(`#site/${s.id}/generation`, 'Power this month', `${fmtNum(st.kwh || 0)}<small> kWh</small>`)
    : main ? stat(`#site/${s.id}/stock`, main.name, `${fmtNum(main.balance)}<small> ${esc(main.unit)}</small>`, low.includes(main) ? 'warn' : '') : '';
  const recent = (sum.recent || []).slice(0, 6);
  return `${head}${kicker}
    <div class="today-tiles" style="margin-top:4px">${stat(`#site/${s.id}/team`, 'On site now', String(sum.onSite.length), 'ok')}${second}</div>
    ${group('What do you want to do here?', `<div class="hub-tiles">${tiles.map(hubTile).join('')}</div>`)}
    ${recent.length ? group('Recently here', `<div class="card flush">${recent.map((r) => lrow({ href: `#rec/${r.kind}/${r.id}`, icon: r.icon || 'doc', title: `${r.label}${r.title ? `: ${r.title}` : ''}`, sub: esc(`${r.user_name || (r.kind === 'incident' ? 'Anonymous' : 'Someone')} · ${timeAgo(r.created_at)}`) })).join('')}</div>`) : ''}
    ${(sum.tasks || []).length ? group('Open tasks here', `<div class="card flush">${sum.tasks.map((t) => lrow({ href: `#task/${t.id}`, icon: 'kanban', tone: 'violet', title: t.title, sub: esc(t.due_date ? `Due ${fmtDate(t.due_date, false)}` : 'No due date') })).join('')}</div>`) : ''}`;
}
