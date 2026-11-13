/* Planner, in the manner of Microsoft Planner: plans hold buckets, buckets hold task cards.
   Managers create plans and tasks and assign people (who are told in their inbox). Workers move their tasks
   along, tick the checklist, comment and complete them, with a photo when the manager asks for proof; the
   manager is told when a task is done. Board (grouped by bucket, progress, due date, person or priority, with
   drag and drop on a computer), grid and charts views, as in Planner. */

const PRIO = { urgent: ['Urgent', '!!'], important: ['Important', '!'], medium: ['Medium', ''], low: ['Low', '↓'] };
const PROG = { not_started: 'Not started', in_progress: 'In progress', completed: 'Completed' };
const PLAN_COLORS = ['leaf', 'earth', 'blue', 'violet', 'amber', 'red'];

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const isLate = (t) => t.progress !== 'completed' && t.due_date && t.due_date < todayISO();
const canWork = (t) => isStaff() || (t.assignees || []).includes(KL.user.id);
function dueInfo(t) {
  if (!t.due_date) return null;
  const today = todayISO();
  if (t.progress === 'completed') return { cls: 'done', text: fmtDate(t.due_date, false) };
  if (t.due_date < today) return { cls: 'late', text: fmtDate(t.due_date, false) };
  if (t.due_date === today) return { cls: 'soon', text: 'Today' };
  if (t.due_date === addDays(today, 1)) return { cls: 'soon', text: 'Tomorrow' };
  return { cls: t.due_date <= addDays(today, 3) ? 'soon' : '', text: fmtDate(t.due_date, false) };
}
const byDue = (a, b) => (a.due_date || '9999') .localeCompare(b.due_date || '9999') || a.sort - b.sort;
function dueGroup(t) {
  if (t.progress === 'completed') return 'completed';
  if (!t.due_date) return 'none';
  const today = todayISO();
  if (t.due_date < today) return 'late';
  if (t.due_date === today) return 'today';
  if (t.due_date <= addDays(today, 7)) return 'week';
  return 'later';
}
const DUE_GROUPS = [['late', 'Late'], ['today', 'Today'], ['week', 'Next 7 days'], ['later', 'Later'], ['none', 'No date'], ['completed', 'Completed']];

function planLabels(planId) {
  const pl = KL.cache['planner:plans'];
  const fromList = pl && !pl.error ? pl.plans.find((p) => p.id === planId)?.labels : null;
  const one = KL.cache[`planner:plan:${planId}`];
  return fromList || (one && !one.error ? one.plan.labels : []) || [];
}
function labelChip(planId, color) {
  if (KL.cache['planner:plans'] === undefined) data('planner:plans', () => api('/api/planner/plans')); // label names
  const lb = planLabels(planId).find((l) => l.color === color);
  return `<span class="lbl ${esc(color)}">${esc(lb?.name || color)}</span>`;
}
const tickbox = (t) => `<span class="tickbox ${t.progress === 'completed' ? 'full' : t.progress === 'in_progress' ? 'half' : ''}"></span>`;

/** One task card, as on a Planner board. */
function taskCard(t, { draggable = false, showPlan = false } = {}) {
  const due = dueInfo(t);
  const ticked = t.checklist.filter((c) => c.done).length;
  const people = t.assignees.map(personById).filter(Boolean);
  return `<div class="tcard ${t.progress === 'completed' ? 'done' : ''}" role="button" tabindex="0" data-action="openTask" data-id="${esc(t.id)}" data-task="${esc(t.id)}" data-title="${esc(t.title.toLowerCase())}" ${draggable ? 'draggable="true"' : ''}>
    ${t.labels.length ? `<div class="labels">${t.labels.map((c) => labelChip(t.plan_id, c)).join('')}</div>` : ''}
    <div class="title">${canWork(t) ? `<button type="button" class="tickbox-btn" data-action="taskTick" data-id="${esc(t.id)}" aria-label="${t.progress === 'completed' ? 'Mark not done' : 'Mark complete'}">${tickbox(t)}</button>` : tickbox(t)}<span>${esc(t.title)}</span></div>
    ${showPlan ? `<div class="from">${esc(t.plan_name || '')}</div>` : ''}
    <div class="meta">${t.priority !== 'medium' ? `<span class="prio ${t.priority}" title="${PRIO[t.priority][0]}">${PRIO[t.priority][1]}</span>` : ''}${due ? `<span class="m due ${due.cls}">${ic('calendar')}${esc(due.text)}</span>` : ''}${t.checklist.length ? `<span class="m">${ic('checklist')}${ticked}/${t.checklist.length}</span>` : ''}${t.comments ? `<span class="m">${ic('chat')}${t.comments}</span>` : ''}${t.photo_required ? `<span class="m" title="Photo proof needed">${ic('camera')}</span>` : ''}${people.length ? `<span class="avatars">${people.slice(0, 3).map((p) => avatar(p.name, 'sm')).join('')}</span>` : ''}</div>
    ${t.checklist.length && t.progress !== 'completed' ? `<div class="bar"><i style="width:${Math.round((ticked / t.checklist.length) * 100)}%"></i></div>` : ''}
  </div>`;
}

/* ---------------------------------------------------------------- hub: plans and my tasks */
Views.planner = (arg) => (arg ? planView(arg) : plannerHub());
Views.tasks = (arg) => (arg ? planView(arg) : plannerHub());

function plannerHub() {
  const staff = isStaff();
  const pl = data('planner:plans', () => api('/api/planner/plans'));
  const my = data('planner:my', () => api('/api/planner/my'));
  const plans = pl && !pl.error ? pl.plans : [];
  const tasks = my && !my.error ? my.tasks : [];
  const open = tasks.filter((t) => t.progress !== 'completed');
  const late = open.filter(isLate).length;
  const planCards = pl === null ? spinner() : pl.error ? errorBox(pl.error) : plans.length ? `<div class="plan-grid">${plans.map(planCard).join('')}</div>`
    : emptyState('kanban', 'No plans yet', staff ? 'Make a plan for a site or project, then add tasks and assign people.' : 'Plans for your sites appear here.');
  return `<h1 class="large">${staff ? 'Planner' : 'My tasks'}</h1>
    <p class="sub">${staff ? 'Plans for every site and project. Assign tasks and see them through to done.' : `${open.length} open${late ? ` · <b style="color:var(--red)">${late} late</b>` : ''} · tasks your manager assigned to you`}</p>
    ${staff ? '' : myTasksBlock(my)}
    ${group(staff ? 'Plans' : 'Plans you are in', planCards, '', staff ? '<button type="button" class="btn small primary" data-action="planEdit">' + ic('plus') + ' New plan</button>' : '')}
    ${staff ? group('Assigned to me', myTasksBlock(my, true)) : ''}
    ${staff ? `<button type="button" class="fab" data-action="planEdit" aria-label="New plan">${ic('plus')}</button>` : ''}`;
}
function planCard(p) {
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  return `<a class="card hover plan-card" href="#${isStaff() ? 'planner' : 'tasks'}/${esc(p.id)}">
    <div class="top"><span class="pmark pm-${esc(p.color)}">${esc(initials(p.name))}</span><span style="flex:1;min-width:0"><b>${esc(p.name)}</b><small>${esc(p.site_name || 'All sites')}</small></span><span class="chev">${ic('chevron')}</span></div>
    <div class="progress" style="margin-top:14px"><i style="width:${pct}%"></i></div>
    <div class="stats"><span><b>${p.done}</b>/${p.total} done</span><span><b>${p.doing}</b> in progress</span>${p.late ? `<span style="color:var(--red)"><b style="color:var(--red)">${p.late}</b> late</span>` : ''}<span style="margin-left:auto">${pct}%</span></div>
  </a>`;
}
function myTasksBlock(my, compact = false) {
  if (my === null) return spinner();
  if (my.error) return errorBox(my.error);
  const tasks = my.tasks.slice().sort(byDue);
  if (!tasks.length) return emptyState('check', 'Nothing assigned to you', compact ? 'Tasks you assign to yourself appear here.' : 'When your manager assigns a task, it appears here and in your inbox.');
  const groups = DUE_GROUPS.map(([k, label]) => [k, label, tasks.filter((t) => dueGroup(t) === k)]).filter(([, , list]) => list.length);
  return groups.map(([k, label, list]) => {
    const body = `<div class="task-grid">${list.slice(0, k === 'completed' ? 6 : 50).map((t) => taskCard(t, { showPlan: true })).join('')}</div>`;
    if (k === 'completed') return `<details class="fold done-fold"><summary>${ic('check')} Completed (${list.length})</summary>${body}</details>`;
    return `<div class="due-head ${k}"><span>${esc(label)}</span><span class="count">${list.length}</span></div>${body}`;
  }).join('');
}

/* ---------------------------------------------------------------- one plan: board, grid, charts */
function planView(arg) {
  const [planId, mode = 'board'] = arg.split('/');
  const base = isStaff() ? 'planner' : 'tasks';
  const d = data(`planner:plan:${planId}`, () => api(`/api/planner/plans/${planId}`));
  if (d === null) return `${topbar('Plan', `#${base}`)}${spinner()}`;
  if (d.error) return `${topbar('Plan', `#${base}`)}${errorBox(d.error)}`;
  data('planner:plans', () => api('/api/planner/plans')); // label names
  const { plan, buckets, tasks } = d;
  const mine = F('pl-mine', '') === '1';
  const list = tasks.filter((t) => !mine || t.assignees.includes(KL.user.id));
  const done = tasks.filter((t) => t.progress === 'completed').length;
  const staff = isStaff();
  const views = [['board', 'kanban', 'Board'], ['grid', 'list', 'Grid'], ['charts', 'pie', 'Charts']];
  const groupBy = F('pl-group', 'bucket');
  const tools = `<div class="pl-tools">
      <div class="seg">${views.map(([k, icon, l]) => `<button type="button" data-action="planMode" data-href="#${base}/${esc(planId)}/${k}" aria-pressed="${mode === k}">${ic(icon)}<span>${l}</span></button>`).join('')}</div>
      ${mode !== 'charts' ? `<input class="input search" placeholder="Filter tasks" value="${esc(F('pl-q', ''))}" data-input="planFilter" aria-label="Filter tasks" />` : ''}
      <div class="chips"><button type="button" data-action="planMine" aria-pressed="${mine}">${ic('user')} Just mine</button></div>
      ${mode === 'board' ? `<label class="groupby"><span>Group by</span>${select('pl-group', groupBy, [['bucket', 'Bucket'], ['progress', 'Progress'], ['due', 'Due date'], ['people', 'Assigned to'], ['priority', 'Priority'], ['labels', 'Labels']])}</label>` : ''}
    </div>`;
  const body = mode === 'grid' ? planGrid(plan, buckets, list) : mode === 'charts' ? planCharts(plan, buckets, list) : planBoard(plan, buckets, list, groupBy);
  return `${topbar(plan.name, `#${base}`, staff ? `<button type="button" class="btn icon-only" data-action="planEdit" data-id="${esc(plan.id)}" aria-label="Plan settings">${ic('cog')}</button>` : '')}
    <div class="plan-head"><span class="pmark pm-${esc(plan.color)}">${esc(initials(plan.name))}</span><span class="tx"><b>${esc(plan.site_id ? siteName(plan.site_id) : 'All sites')}</b><small>${tasks.length} tasks · ${done} done${tasks.filter(isLate).length ? ` · ${tasks.filter(isLate).length} late` : ''}</small></span><div class="progress" style="flex:0 0 120px"><i style="width:${tasks.length ? Math.round((done / tasks.length) * 100) : 0}%"></i></div></div>
    ${tools}
    ${body}
    ${staff && mode !== 'charts' ? `<button type="button" class="fab" data-action="taskAdd" data-plan="${esc(plan.id)}" aria-label="New task">${ic('plus')}</button>` : ''}`;
}

function boardColumns(plan, buckets, list, groupBy) {
  const today = todayISO();
  if (groupBy === 'progress') return Object.entries(PROG).map(([k, l]) => ({ key: k, name: l, drop: 'progress', tasks: list.filter((t) => t.progress === k) }));
  if (groupBy === 'due') return DUE_GROUPS.map(([k, l]) => ({ key: k, name: l, tasks: list.filter((t) => dueGroup(t) === k), tone: k === 'late' ? 'late' : '' })).filter((c) => c.tasks.length || ['today', 'week'].includes(c.key));
  if (groupBy === 'priority') return Object.entries(PRIO).map(([k, [l]]) => ({ key: k, name: l, drop: isStaff() ? 'priority' : '', tasks: list.filter((t) => t.priority === k) }));
  if (groupBy === 'people') {
    const ids = [...new Set(list.flatMap((t) => t.assignees))];
    const cols = ids.map((id) => ({ key: id, name: personById(id)?.name || 'Someone', person: personById(id), tasks: list.filter((t) => t.assignees.includes(id)) }));
    cols.sort((a, b) => a.name.localeCompare(b.name));
    const none = list.filter((t) => !t.assignees.length);
    return none.length ? [{ key: 'none', name: 'Unassigned', tasks: none }, ...cols] : cols;
  }
  if (groupBy === 'labels') {
    const cols = planLabels(plan.id).map((lb) => ({ key: lb.color, name: lb.name || lb.color, label: lb.color, tasks: list.filter((t) => t.labels.includes(lb.color)) })).filter((c) => c.tasks.length);
    const none = list.filter((t) => !t.labels.length);
    return none.length ? [...cols, { key: 'none', name: 'No label', tasks: none }] : cols;
  }
  void today;
  return buckets.map((b) => ({ key: b.id, name: b.name, drop: 'bucket', bucket: b, tasks: list.filter((t) => t.bucket_id === b.id) }));
}
function planBoard(plan, buckets, list, groupBy) {
  const staff = isStaff();
  const cols = boardColumns(plan, buckets, list, groupBy);
  const draggableIn = (col) => Boolean(col.drop);
  return `<div class="board">${cols.map((col) => {
    const openT = col.tasks.filter((t) => t.progress !== 'completed').sort((a, b) => (groupBy === 'bucket' ? a.sort - b.sort : byDue(a, b)));
    const doneT = groupBy === 'progress' ? [] : col.tasks.filter((t) => t.progress === 'completed');
    const cards = (groupBy === 'progress' ? col.tasks.slice().sort(byDue) : openT).map((t) => taskCard(t, { draggable: draggableIn(col) && canWork(t) })).join('');
    const head = `<div class="bh">${col.person ? avatar(col.person.name, 'sm') : col.label ? `<span class="lbl ${esc(col.label)}" style="padding:2px 6px">&nbsp;</span>` : ''}<b class="${col.tone === 'late' ? 'late' : ''}">${esc(col.name)}</b><span class="count">${col.tasks.length}</span>${staff && col.bucket ? `<button type="button" class="btn ghost icon-only small" data-action="bucketEdit" data-id="${esc(col.bucket.id)}" data-name="${esc(col.bucket.name)}" data-empty="${col.tasks.length ? '' : '1'}" aria-label="Rename bucket">${ic('more')}</button>` : ''}</div>`;
    return `<section class="bucket" ${col.drop ? `data-drop="${col.drop}" data-value="${esc(col.key)}"` : ''}>${head}
      ${staff && col.bucket ? `<button type="button" class="add" data-action="taskAdd" data-plan="${esc(plan.id)}" data-bucket="${esc(col.bucket.id)}">${ic('plus')} Add task</button>` : ''}
      <div class="cards">${cards || '<p class="col-empty">No tasks</p>'}</div>
      ${doneT.length ? `<details class="fold done-fold"><summary>Completed (${doneT.length})</summary><div class="cards">${doneT.map((t) => taskCard(t, { draggable: draggableIn(col) && canWork(t) })).join('')}</div></details>` : ''}
    </section>`;
  }).join('')}${staff && groupBy === 'bucket' ? `<button type="button" class="bucket add-col" data-action="bucketAdd" data-plan="${esc(plan.id)}">${ic('plus')} Add new bucket</button>` : ''}</div>
  ${groupBy === 'bucket' || groupBy === 'progress' ? `<p class="hint board-hint">${ic('swap')} On a computer, drag cards between columns. On a phone, open a task to move it.</p>` : ''}`;
}
function planGrid(plan, buckets, list) {
  if (!list.length) return emptyState('list', 'No tasks', isStaff() ? 'Tap + to add the first task.' : '');
  const order = Object.fromEntries(buckets.map((b, i) => [b.id, i]));
  const rows = list.slice().sort((a, b) => (a.progress === 'completed') - (b.progress === 'completed') || order[a.bucket_id] - order[b.bucket_id] || byDue(a, b));
  return `<div class="card flush grid-list">${rows.map((t) => {
    const due = dueInfo(t);
    const b = buckets.find((x) => x.id === t.bucket_id);
    const people = t.assignees.map(personById).filter(Boolean);
    return `<div class="gr" role="button" tabindex="0" data-action="openTask" data-id="${esc(t.id)}" data-title="${esc(t.title.toLowerCase())}">${canWork(t) ? `<button type="button" class="tickbox-btn" data-action="taskTick" data-id="${esc(t.id)}" aria-label="Toggle complete">${tickbox(t)}</button>` : tickbox(t)}
      <span class="t"><b style="${t.progress === 'completed' ? 'text-decoration:line-through;color:var(--muted)' : ''}">${esc(t.title)}</b><small>${esc(b?.name || '')}${due ? ` · <span class="${due.cls === 'late' ? 'late-text' : ''}">${esc(due.text)}</span>` : ''}${people.length ? ` · ${people.map((p) => esc(firstName(p.name))).join(', ')}` : ''}</small></span>
      <span class="row" style="gap:6px">${t.priority !== 'medium' ? `<span class="prio ${t.priority}">${PRIO[t.priority][1]}</span>` : ''}${t.labels.slice(0, 2).map((c) => labelChip(t.plan_id, c)).join('')}</span></div>`;
  }).join('')}</div>`;
}
function hbar(parts, total) {
  return `<div class="hbar">${parts.filter(([n]) => n).map(([n, color, title]) => `<i style="width:${(n / Math.max(total, 1)) * 100}%;background:${color}" title="${esc(title)}: ${n}"></i>`).join('')}</div>`;
}
function planCharts(plan, buckets, list) {
  const late = list.filter(isLate).length;
  const ns = list.filter((t) => t.progress === 'not_started' && !isLate(t)).length;
  const ip = list.filter((t) => t.progress === 'in_progress' && !isLate(t)).length;
  const done = list.filter((t) => t.progress === 'completed').length;
  const total = list.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const C = { ns: 'var(--line-2)', ip: 'var(--blue)', late: 'var(--red)', done: 'var(--brand)' };
  const split = (ts) => [[ts.filter((t) => t.progress === 'not_started' && !isLate(t)).length, C.ns, 'Not started'], [ts.filter((t) => t.progress === 'in_progress' && !isLate(t)).length, C.ip, 'In progress'], [ts.filter(isLate).length, C.late, 'Late'], [ts.filter((t) => t.progress === 'completed').length, C.done, 'Completed']];
  const people = [...new Set(list.flatMap((t) => t.assignees))].map((id) => ({ p: personById(id), ts: list.filter((t) => t.assignees.includes(id)) })).filter((x) => x.p).sort((a, b) => b.ts.length - a.ts.length);
  const unassigned = list.filter((t) => !t.assignees.length);
  return `<div class="tiles four">
      <div class="tile"><div class="ti" style="background:var(--chip);color:var(--muted)">${ic('dot')}</div><b>${num(ns, 'c-ns')}</b><span>Not started</span></div>
      <div class="tile blue"><div class="ti">${ic('play')}</div><b>${num(ip, 'c-ip')}</b><span>In progress</span></div>
      <div class="tile bad"><div class="ti">${ic('alert')}</div><b>${num(late, 'c-late')}</b><span>Late</span></div>
      <div class="tile ok"><div class="ti">${ic('check')}</div><b>${num(done, 'c-done')}</b><span>Completed</span></div>
    </div>
    <div class="cols" style="margin-top:14px">
      <div class="card"><b class="card-title">Status</b><div class="row" style="gap:22px;margin-top:12px;flex-wrap:wrap"><div class="donut" style="--p:${pct};background:conic-gradient(var(--brand) 0 ${pct}%, var(--blue) ${pct}% ${pct + (total ? Math.round((ip / total) * 100) : 0)}%, var(--red) 0 ${pct + (total ? Math.round(((ip + late) / total) * 100) : 0)}%, var(--chip) 0)" data-label="${pct}%"></div>
        <div class="legend-list"><span><i style="background:${C.done}"></i>${done} completed</span><span><i style="background:${C.ip}"></i>${ip} in progress</span><span><i style="background:${C.late}"></i>${late} late</span><span><i style="background:${C.ns}"></i>${ns} not started</span></div></div></div>
      <div class="card"><b class="card-title">Buckets</b><div class="stack" style="margin-top:12px">${buckets.map((b) => { const ts = list.filter((t) => t.bucket_id === b.id); return `<div><div class="row between" style="font-size:14px;font-weight:700;margin-bottom:6px"><span>${esc(b.name)}</span><span class="muted">${ts.length}</span></div>${hbar(split(ts), ts.length)}</div>`; }).join('')}</div></div>
    </div>
    <div class="card" style="margin-top:14px"><b class="card-title">Members</b><div class="stack" style="margin-top:12px">${people.map(({ p, ts }) => `<div class="row" style="gap:12px">${avatar(p.name)}<div style="flex:1;min-width:0"><div class="row between" style="font-size:14px;font-weight:700;margin-bottom:6px"><span>${esc(p.name)}</span><span class="muted">${ts.filter((t) => t.progress === 'completed').length}/${ts.length} done</span></div>${hbar(split(ts), ts.length)}</div></div>`).join('')}${unassigned.length ? `<div class="row" style="gap:12px"><span class="avatar" style="background:var(--chip);color:var(--muted)">?</span><div style="flex:1"><div class="row between" style="font-size:14px;font-weight:700;margin-bottom:6px"><span>Unassigned</span><span class="muted">${unassigned.length}</span></div>${hbar(split(unassigned), unassigned.length)}</div></div>` : ''}${!people.length && !unassigned.length ? '<p class="empty">No tasks.</p>' : ''}</div>
      <div class="legend-list" style="display:flex;gap:16px;flex-wrap:wrap;margin-top:14px;font-size:12.5px"><span><i style="background:${C.ns}"></i>Not started</span><span><i style="background:${C.ip}"></i>In progress</span><span><i style="background:${C.late}"></i>Late</span><span><i style="background:${C.done}"></i>Completed</span></div></div>
    <div class="card" style="margin-top:14px"><b class="card-title">Priority</b><div class="tiles four" style="margin-top:12px">${Object.entries(PRIO).map(([k, [l, mark]]) => { const n = list.filter((t) => t.priority === k && t.progress !== 'completed').length; return `<div class="pri-stat"><span class="prio ${k}" style="display:inline-grid">${mark || '•'}</span><b>${n}</b><span>${l}</span></div>`; }).join('')}</div><p class="hint" style="margin-top:8px">Open tasks only.</p></div>`;
}

Actions.planMode = (el) => { location.hash = el.dataset.href; };
Actions.planMine = () => { setF('pl-mine', F('pl-mine', '') === '1' ? '' : '1'); render(); };
/** Filter as you type, without re-rendering (decision 10). */
Inputs.planFilter = (el) => {
  setF('pl-q', el.value);
  applyPlanFilter();
};
function applyPlanFilter() {
  const q = F('pl-q', '').trim().toLowerCase();
  for (const c of $$('[data-title]')) c.hidden = Boolean(q) && !c.dataset.title.includes(q);
}

/* ---------------------------------------------------------------- plans and buckets (managers) */
Actions.planEdit = async (el) => {
  const id = el.dataset.id;
  const pl = id ? KL.cache[`planner:plan:${id}`]?.plan : null;
  const sites = KL.boot.sites;
  const v = await modal({ title: pl ? 'Plan settings' : 'New plan', message: pl ? '' : 'A plan is a board for one site or project, with buckets of tasks.', fields: [
    { key: 'name', label: 'Plan name', value: pl?.name || '', placeholder: 'e.g. Biochar Site, Rajkot · December' },
    { key: 'site', label: 'Site (people on this site can see the plan)', type: 'select', options: ['All sites', ...sites.map((s) => s.name)], value: pl?.site_id ? siteName(pl.site_id) : 'All sites' },
    { key: 'color', label: 'Colour', type: 'select', options: PLAN_COLORS, value: pl?.color || 'leaf' },
  ], confirmText: pl ? 'Save' : 'Create plan' });
  if (!v) return;
  try {
    const site = sites.find((s) => s.name === v.site);
    const r = await api('/api/planner/plans', { json: { id: pl?.id, name: v.name, siteId: site?.id || '', color: v.color } });
    invalidate('planner');
    toast(pl ? 'Plan saved' : 'Plan created with buckets To do, This week and Later');
    if (!pl) location.hash = `#planner/${r.id}`; else render();
  } catch (e) { toast(e.message, 'error'); }
};
Actions.bucketAdd = async (el) => {
  const v = await modal({ title: 'New bucket', message: 'Buckets are the columns of the board, such as stages of work or weeks.', fields: [{ key: 'name', label: 'Bucket name', placeholder: 'e.g. Waiting for parts' }], confirmText: 'Add bucket' });
  if (!v || !v.name) return;
  try { await api('/api/planner/buckets', { json: { planId: el.dataset.plan, name: v.name } }); invalidate('planner'); render(); } catch (e) { toast(e.message, 'error'); }
};
Actions.bucketEdit = async (el) => {
  const v = await modal({ title: 'Bucket', fields: [{ key: 'name', label: 'Name', value: el.dataset.name }, ...(el.dataset.empty ? [{ key: 'delete', label: 'Delete this empty bucket?', type: 'select', options: ['Keep', 'Delete'], value: 'Keep' }] : [])], confirmText: 'Save' });
  if (!v) return;
  try {
    if (v.delete === 'Delete') await api(`/api/planner/buckets/${el.dataset.id}/delete`, { json: {} });
    else await api('/api/planner/buckets', { json: { id: el.dataset.id, name: v.name } });
    invalidate('planner'); render();
  } catch (e) { toast(e.message, 'error'); }
};

/* ---------------------------------------------------------------- tasks */
function peopleOptions() {
  return KL.boot.people.slice().sort((a, b) => (a.role === 'field' ? 0 : 1) - (b.role === 'field' ? 0 : 1) || a.name.localeCompare(b.name));
}
Actions.taskAdd = async (el) => {
  const people = peopleOptions();
  const plan = KL.cache[`planner:plan:${el.dataset.plan}`];
  const buckets = plan && !plan.error ? plan.buckets : [];
  const v = await modal({ title: 'New task', fields: [
    { key: 'title', label: 'Task', placeholder: 'e.g. Weigh and photograph the kiln output' },
    ...(el.dataset.bucket ? [] : [{ key: 'bucket', label: 'Bucket', type: 'select', options: buckets.map((b) => b.name), value: buckets[0]?.name }]),
    { key: 'who', label: 'Assign to', type: 'select', options: ['Nobody yet', ...people.map((p) => `${p.name} · ${ROLE_TEXT[p.role] || p.role}`)], value: 'Nobody yet' },
    { key: 'due', label: 'Due date', type: 'date', value: addDays(todayISO(), 3) },
    { key: 'priority', label: 'Priority', type: 'select', options: ['Medium', 'Important', 'Urgent', 'Low'], value: 'Medium' },
  ], confirmText: 'Add task' });
  if (!v) return;
  const who = people.find((p) => `${p.name} · ${ROLE_TEXT[p.role] || p.role}` === v.who);
  const bucketId = el.dataset.bucket || buckets.find((b) => b.name === v.bucket)?.id || '';
  try {
    const r = await api('/api/planner/tasks', { json: { planId: el.dataset.plan, bucketId, title: v.title, assignees: who ? [who.id] : [], dueDate: v.due, priority: v.priority.toLowerCase() } });
    invalidate('planner');
    toast(who ? `Task added · ${firstName(who.name)} is notified` : 'Task added');
    openTaskSheet(r.id);
  } catch (e) { toast(e.message, 'error'); }
};
function findTask(id) {
  const t = KL.cache[`planner:task:${id}`];
  if (t && !t.error) return t;
  for (const [k, v] of Object.entries(KL.cache)) {
    if (!v || v.error) continue;
    if (k.startsWith('planner:plan:') && v.tasks) { const x = v.tasks.find((y) => y.id === id); if (x) return x; }
    if (k === 'planner:my') { const x = v.tasks.find((y) => y.id === id); if (x) return x; }
  }
  return null;
}
/** Change a cached task everywhere it is shown, so the screen answers at once. */
function patchCached(id, patch) {
  for (const [k, v] of Object.entries(KL.cache)) {
    if (!v || v.error) continue;
    if (k === `planner:task:${id}`) Object.assign(v, patch);
    if ((k.startsWith('planner:plan:') || k === 'planner:my') && v.tasks) { const x = v.tasks.find((y) => y.id === id); if (x) Object.assign(x, patch); }
  }
}
function openTaskSheet(id) {
  KL.ui.sheetTask = id;
  KL.ui.completing = null;
  clearF('tc-text', 'tc-note', 'tc-item');
  invalidate(`planner:task:${id}`);
  locate(); // for the GPS on a completion photo
  renderTaskSheet();
}
Actions.openTask = (el) => openTaskSheet(el.dataset.id);
Actions.taskClose = () => {
  KL.ui.sheetTask = null;
  KL.ui.completing = null;
  renderTaskSheet();
  if (route().name === 'task') location.hash = isStaff() ? '#planner' : '#tasks';
  else render();
};
async function setProgress(t, progress, { note = '', slot = '' } = {}) {
  const before = { progress: t.progress, completed_at: t.completed_at };
  patchCached(t.id, { progress, completed_at: progress === 'completed' ? new Date().toISOString() : null, completed_by: progress === 'completed' ? KL.user.id : null });
  render();
  const g = KL.ui.gps;
  try {
    const r = await submitEvidence(`/api/planner/tasks/${t.id}/progress`, { progress, note, lat: g ? g.lat : '', lng: g ? g.lng : '' }, slot ? photoFile(slot, 'task-proof.jpg') : [], 'Task update');
    invalidate('planner', 'dashboard');
    return r;
  } catch (e) {
    patchCached(t.id, before);
    render();
    throw e;
  }
}
/** The round tick on a card: complete (or reopen) in one tap; tasks needing photo proof open the completion form. */
Actions.taskTick = async (el) => {
  const t = findTask(el.dataset.id);
  if (!t) return;
  if (t.progress === 'completed') {
    try { await setProgress(t, 'in_progress'); toast('Task reopened'); render(); } catch (e) { toast(e.message, 'error'); }
    return;
  }
  if (t.photo_required) { openTaskSheet(t.id); KL.ui.completing = t.id; renderTaskSheet(); return; }
  try {
    const r = await setProgress(t, 'completed');
    if (!r.queued) toast(isStaff() ? 'Task completed' : 'Task completed · your manager is notified');
    render();
  } catch (e) { toast(e.message, 'error'); }
};

/* ---------------------------------------------------------------- the task sheet */
function renderTaskSheet() {
  const box = $('#sheet');
  if (!box) return;
  const id = KL.ui.sheetTask;
  if (!id || !KL.token) {
    if (!box.hidden) { box.hidden = true; box.innerHTML = ''; }
    return;
  }
  const t = data(`planner:task:${id}`, () => api(`/api/planner/tasks/${id}`));
  const old = box.querySelector('.sheet');
  const keep = old ? old.scrollTop : 0;
  const focused = document.activeElement && box.contains(document.activeElement) ? document.activeElement.id : '';
  box.hidden = false;
  box.innerHTML = `<div class="sheet wide tsheet ${old ? 'still' : ''}" role="dialog" aria-modal="true" aria-label="Task">${t === null ? `<div class="grab"></div>${spinner()}` : t.error ? `<div class="grab"></div>${errorBox(t.error)}<div class="actions"><button type="button" class="btn" data-action="taskClose">Close</button></div>` : taskSheetBody(t)}</div>`;
  const sh = box.querySelector('.sheet');
  if (keep) sh.scrollTop = keep;
  if (focused) $(`#${focused}`, box)?.focus();
  loadAuthImages();
}
function taskSheetBody(t) {
  const staff = isStaff();
  const mayWork = canWork(t);
  const plan = KL.cache[`planner:plan:${t.plan_id}`] || data(`planner:plan:${t.plan_id}`, () => api(`/api/planner/plans/${t.plan_id}`));
  const buckets = plan && !plan.error ? plan.buckets : [];
  data('planner:plans', () => api('/api/planner/plans'));
  const labels = planLabels(t.plan_id);
  const due = dueInfo(t);
  const people = t.assignees.map(personById).filter(Boolean);
  const creator = personById(t.created_by);
  const ticked = t.checklist.filter((c) => c.done).length;

  const head = `<div class="grab"></div><div class="row between" style="gap:8px"><span class="tag">${ic('kanban')} ${esc(t.plan_name)} · ${esc(t.bucket_name || buckets.find((b) => b.id === t.bucket_id)?.name || '')}</span><span class="row" style="gap:6px">${staff ? `<button type="button" class="btn icon-only danger" data-action="taskDelete" data-id="${esc(t.id)}" aria-label="Delete task">${ic('trash')}</button>` : ''}<button type="button" class="btn icon-only" data-action="taskClose" aria-label="Close">${ic('x')}</button></span></div>`;
  const title = staff
    ? `<input id="te-title" class="input tt-input" value="${esc(t.title)}" data-change="taskField" data-field="title" aria-label="Task title" />`
    : `<div class="tt">${esc(t.title)}</div>`;
  const labelRow = staff
    ? `<div class="chips" style="margin-top:10px">${labels.map((lb) => `<button type="button" data-action="taskLabel" data-color="${esc(lb.color)}" aria-pressed="${t.labels.includes(lb.color)}"><span class="lbl ${esc(lb.color)}">${esc(lb.name)}</span></button>`).join('')}</div>`
    : t.labels.length ? `<div class="chips" style="margin-top:8px">${t.labels.map((c) => labelChip(t.plan_id, c)).join('')}</div>` : '';

  const progress = `<div class="prog-pick" style="margin-top:16px">${Object.entries(PROG).map(([k, l]) => `<button type="button" ${mayWork ? `data-action="taskProgress" data-p="${k}"` : 'disabled'} aria-pressed="${t.progress === k}">${tickbox({ progress: k })}${l}</button>`).join('')}</div>`;

  const complete = KL.ui.completing === t.id && t.progress !== 'completed' ? `<div class="card complete-card stack" style="margin-top:14px">
      <div class="row" style="gap:12px"><span class="icon green">${ic('check')}</span><div><b>Complete this task</b><p class="hint">${t.photo_required ? 'Your manager asked for a photo as proof.' : 'A photo and a note are optional.'} ${creator ? esc(firstName(creator.name)) : 'Your manager'} is told when you finish.</p></div></div>
      ${demoRibbon()}
      ${photoBox(`task-${t.id}`, t.photo_required ? 'Take the proof photo' : 'Add a photo (optional)', 'environment', [`${KL.user.name} · task done`, t.title.slice(0, 60)])}
      ${field('Note for your manager (optional)', `<textarea id="tc-note" class="input" placeholder="e.g. 3 bags short, rest delivered" data-input="form" data-key="tc-note">${esc(F('tc-note'))}</textarea>`)}
      <div class="btns"><button type="button" class="btn" data-action="taskCompleteCancel">Not yet</button><button type="button" class="btn primary" data-action="taskComplete" data-id="${esc(t.id)}" ${t.photo_required && !KL.ui.photos[`task-${t.id}`] ? 'disabled' : ''}>${ic('check')} Mark complete</button></div>
    </div>` : '';

  const doneBox = t.progress === 'completed' ? `<div class="banner" style="margin-top:14px">${ic('check')}<div><b>Completed${t.completed_by ? ` by ${esc(personById(t.completed_by)?.name || '')}` : ''}${t.completed_at ? ` · ${esc(fmtDate(t.completed_at))}` : ''}</b>${t.completion_note ? `<p>${esc(t.completion_note)}</p>` : ''}</div></div>${t.completion_file ? `<div style="margin-top:10px">${authImg(t.completion_file, 'thumb lg')}</div>` : ''}` : '';

  const prioSel = staff ? `<select class="select" data-change="taskField" data-field="priority">${Object.entries(PRIO).map(([k, [l]]) => `<option value="${k}" ${t.priority === k ? 'selected' : ''}>${l}</option>`).join('')}</select>` : `<b>${t.priority !== 'medium' ? `<span class="prio ${t.priority}">${PRIO[t.priority][1]}</span>` : ''}${PRIO[t.priority][0]}</b>`;
  const dateIn = (fieldName, value) => (staff ? `<input class="input" type="date" value="${esc(value || '')}" data-change="taskField" data-field="${fieldName}" />` : `<b>${value ? esc(fmtDate(value, false)) : '–'}</b>`);
  const bucketSel = mayWork && buckets.length ? `<select class="select" data-change="taskMove">${buckets.map((b) => `<option value="${esc(b.id)}" ${b.id === t.bucket_id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>` : `<b>${esc(t.bucket_name || '')}</b>`;
  const props = `<div class="props">
      <div class="prop"><small>Priority</small>${prioSel}</div>
      <div class="prop"><small>Bucket</small>${bucketSel}</div>
      <div class="prop"><small>Start</small>${dateIn('start_date', t.start_date)}</div>
      <div class="prop ${due?.cls === 'late' ? 'late' : ''}"><small>Due${due?.cls === 'late' ? ' · late' : ''}</small>${dateIn('due_date', t.due_date)}</div>
    </div>`;

  const assigned = staff
    ? `<div class="people-chips">${peopleOptions().map((p) => `<button type="button" data-action="taskAssign" data-user="${esc(p.id)}" aria-pressed="${t.assignees.includes(p.id)}">${avatar(p.name, 'sm')}<span>${esc(p.name)}</span><small>${esc(ROLE_TEXT[p.role] || p.role)}</small></button>`).join('')}</div>`
    : people.length ? `<div class="stack" style="gap:8px">${people.map((p) => `<div class="row" style="gap:10px">${avatar(p.name)}<span><b>${esc(p.name)}</b><br><small class="muted">${esc(p.designation || ROLE_TEXT[p.role] || '')}</small></span></div>`).join('')}</div>` : '<p class="hint">Nobody yet.</p>';

  const notes = staff
    ? `<textarea id="te-notes" class="input" placeholder="Add details, where to go, what to bring" data-change="taskField" data-field="notes">${esc(t.notes || '')}</textarea>`
    : t.notes ? `<p style="white-space:pre-wrap;margin:0">${esc(t.notes)}</p>` : '<p class="hint">No notes.</p>';

  const checklist = `<div class="checklist">${t.checklist.map((c, i) => `<div class="ci-row"><button type="button" class="ci ${c.done ? 'done' : ''}" ${mayWork ? `data-action="taskCheck" data-i="${i}"` : 'disabled'}>${tickbox({ progress: c.done ? 'completed' : 'not_started' })}<span>${esc(c.text)}</span></button>${staff ? `<button type="button" class="btn ghost icon-only small" data-action="taskCheckDel" data-i="${i}" aria-label="Remove item">${ic('x')}</button>` : ''}</div>`).join('')}</div>
    ${staff ? `<div class="row" style="margin-top:8px"><input id="tc-item" class="input" placeholder="Add an item" value="${esc(F('tc-item'))}" data-input="form" data-key="tc-item" /><button type="button" class="btn icon-only" data-action="taskCheckAdd" aria-label="Add item">${ic('plus')}</button></div>` : ''}`;

  const comments = `${(t.comment_list || []).map((c) => `<div class="comment">${avatar(c.user_name, 'sm')}<div class="bubble"><small>${esc(c.user_name)} · ${esc(timeAgo(c.created_at))}</small><div style="white-space:pre-wrap">${esc(c.text)}</div></div></div>`).join('') || '<p class="hint">No comments yet.</p>'}
    <div class="row" style="margin-top:8px"><input id="tc-text" class="input" placeholder="Write a comment" value="${esc(F('tc-text'))}" data-input="form" data-key="tc-text" /><button type="button" class="btn primary icon-only" data-action="taskComment" aria-label="Send comment">${ic('send')}</button></div>`;

  return `${head}${title}${labelRow}${progress}${complete}${doneBox}${props}
    ${staff ? `<label class="check" style="margin-top:4px"><input type="checkbox" ${t.photo_required ? 'checked' : ''} data-change="taskPhotoReq" /> <span>${ic('camera')} Ask for a photo as proof when completed</span></label>` : t.photo_required && t.progress !== 'completed' ? `<div class="banner info" style="margin-top:4px">${ic('camera')}<div><b>Photo proof needed</b><p>Take a photo when you complete this task.</p></div></div>` : ''}
    <div class="sec"><h3>${ic('users')} Assigned to</h3>${assigned}</div>
    <div class="sec"><h3>${ic('note')} Notes</h3>${notes}</div>
    <div class="sec"><h3>${ic('checklist')} Checklist <span class="muted" style="font-weight:600">${t.checklist.length ? `${ticked}/${t.checklist.length}` : ''}</span></h3>${t.checklist.length || staff ? checklist : '<p class="hint">No checklist.</p>'}</div>
    <div class="sec"><h3>${ic('chat')} Comments</h3>${comments}</div>
    <p class="hint" style="margin-top:14px">Created${creator ? ` by ${esc(creator.name)}` : ''} ${esc(timeAgo(t.created_at))}${t.updated_at ? ` · updated ${esc(timeAgo(t.updated_at))}` : ''}</p>`;
}

/** Managers edit a task in place, as in Planner: every change saves at once. */
async function saveTask(t, patch) {
  const next = { ...t, ...patch };
  patchCached(t.id, patch);
  renderTaskSheet();
  try {
    await api('/api/planner/tasks', { json: { id: t.id, title: next.title, notes: next.notes, priority: next.priority, startDate: next.start_date || '', dueDate: next.due_date || '', labels: next.labels, checklist: next.checklist, assignees: next.assignees, photoRequired: next.photo_required } });
    invalidate('planner:plan', 'planner:my', 'planner:plans');
    render();
  } catch (e) {
    toast(e.message, 'error');
    invalidate('planner');
    render();
  }
}
const sheetTask = () => findTask(KL.ui.sheetTask);
Changes.taskField = (el) => {
  const t = sheetTask();
  if (!t) return;
  const f = el.dataset.field;
  const v = el.value;
  if (f === 'title' && v.trim().length < 2) { toast('Give the task a title', 'error'); el.value = t.title; return; }
  if (String(t[f] ?? '') === v) return;
  saveTask(t, { [f]: v });
};
Changes.taskPhotoReq = (el) => { const t = sheetTask(); if (t) saveTask(t, { photo_required: el.checked }); };
Changes.taskMove = async (el) => {
  const t = sheetTask();
  if (!t) return;
  const plan = KL.cache[`planner:plan:${t.plan_id}`];
  const top = plan && !plan.error ? Math.min(0, ...plan.tasks.filter((x) => x.bucket_id === el.value).map((x) => x.sort)) - 1 : 0;
  patchCached(t.id, { bucket_id: el.value, sort: top, bucket_name: el.selectedOptions[0]?.textContent || '' });
  render();
  try { await api(`/api/planner/tasks/${t.id}/move`, { json: { bucketId: el.value, sort: top } }); toast(`Moved to ${el.selectedOptions[0]?.textContent}`); invalidate('planner:my'); } catch (e) { toast(e.message, 'error'); invalidate('planner'); render(); }
};
Actions.taskLabel = (el) => {
  const t = sheetTask();
  if (!t) return;
  const c = el.dataset.color;
  saveTask(t, { labels: t.labels.includes(c) ? t.labels.filter((x) => x !== c) : [...t.labels, c] });
};
Actions.taskAssign = (el) => {
  const t = sheetTask();
  if (!t) return;
  const u = el.dataset.user;
  const adding = !t.assignees.includes(u);
  saveTask(t, { assignees: adding ? [...t.assignees, u] : t.assignees.filter((x) => x !== u) });
  if (adding && u !== KL.user.id) toast(`${firstName(personById(u)?.name)} is notified`);
};
Actions.taskCheckAdd = () => {
  const t = sheetTask();
  const text = F('tc-item', '').trim();
  if (!t || !text) return;
  clearF('tc-item');
  saveTask(t, { checklist: [...t.checklist, { text, done: false }] });
  setTimeout(() => $('#tc-item')?.focus(), 30);
};
Actions.taskCheckDel = (el) => {
  const t = sheetTask();
  if (!t) return;
  saveTask(t, { checklist: t.checklist.filter((_, i) => i !== Number(el.dataset.i)) });
};
Actions.taskCheck = async (el) => {
  const t = sheetTask();
  if (!t) return;
  const i = Number(el.dataset.i);
  const items = t.checklist.map((c, j) => (j === i ? { ...c, done: !c.done } : c));
  patchCached(t.id, { checklist: items, progress: t.progress === 'not_started' && items[i].done ? 'in_progress' : t.progress });
  renderTaskSheet(); render();
  try { await api(`/api/planner/tasks/${t.id}/checklist`, { json: { index: i, done: items[i].done } }); invalidate('planner:plans'); } catch (e) { toast(e.message, 'error'); invalidate('planner'); render(); }
};
Actions.taskProgress = async (el) => {
  const t = sheetTask();
  if (!t || t.progress === el.dataset.p) return;
  if (el.dataset.p === 'completed') { KL.ui.completing = t.id; renderTaskSheet(); return; }
  try { await setProgress(t, el.dataset.p); KL.ui.completing = null; render(); } catch (e) { toast(e.message, 'error'); }
};
Actions.taskCompleteCancel = () => { KL.ui.completing = null; renderTaskSheet(); };
Actions.taskComplete = async (el) => {
  const t = findTask(el.dataset.id);
  if (!t) return;
  const slot = `task-${t.id}`;
  if (t.photo_required && !KL.ui.photos[slot]) return toast('Take the proof photo first', 'error');
  el.classList.add('busy');
  try {
    const r = await setProgress(t, 'completed', { note: F('tc-note', '').trim(), slot: KL.ui.photos[slot] ? slot : '' });
    clearPhotos(slot); clearF('tc-note');
    KL.ui.completing = null;
    const creator = personById(t.created_by);
    KL.ui.sheetTask = null;
    renderTaskSheet();
    if (route().name === 'task') location.hash = isStaff() ? '#planner' : '#tasks';
    render();
    await refreshMe();
    if (r.queued) return;
    await celebrate('Task complete', creator && creator.id !== KL.user.id ? `${firstName(creator.name)} and the site manager are notified.` : 'Marked done on the plan.');
    render();
  } catch (e) { el.classList.remove('busy'); toast(e.message, 'error'); }
};
Actions.taskComment = async () => {
  const t = sheetTask();
  const text = F('tc-text', '').trim();
  if (!t || !text) return;
  try {
    await api(`/api/planner/tasks/${t.id}/comments`, { json: { text } });
    clearF('tc-text');
    invalidate(`planner:task:${t.id}`, 'planner:plan', 'planner:my');
    render();
    setTimeout(() => { const sh = $('#sheet .sheet'); if (sh) sh.scrollTop = sh.scrollHeight; }, 250);
  } catch (e) { toast(e.status === 0 ? 'Comments need a connection.' : e.message, 'error'); }
};
Actions.taskDelete = async (el) => {
  if (!(await modal({ title: 'Delete this task?', message: 'The task, its checklist and comments are removed for everyone.', confirmText: 'Delete', danger: true }))) return;
  try {
    await api(`/api/planner/tasks/${el.dataset.id}/delete`, { json: {} });
    KL.ui.sheetTask = null;
    invalidate('planner');
    renderTaskSheet();
    toast('Task deleted');
    if (route().name === 'task') location.hash = isStaff() ? '#planner' : '#tasks'; else render();
  } catch (e) { toast(e.message, 'error'); }
};

/* ---------------------------------------------------------------- drag and drop between columns (computers) */
async function plannerDrop(id, kind, value) {
  const t = findTask(id);
  if (!t) return;
  if (kind === 'bucket') {
    if (t.bucket_id === value) return;
    const plan = KL.cache[`planner:plan:${t.plan_id}`];
    const top = plan && !plan.error ? Math.min(0, ...plan.tasks.filter((x) => x.bucket_id === value).map((x) => x.sort)) - 1 : 0;
    patchCached(id, { bucket_id: value, sort: top });
    render();
    try { await api(`/api/planner/tasks/${id}/move`, { json: { bucketId: value, sort: top } }); } catch (e) { toast(e.message, 'error'); invalidate('planner'); render(); }
  } else if (kind === 'progress') {
    if (t.progress === value) return;
    if (value === 'completed' && t.photo_required) { openTaskSheet(id); KL.ui.completing = id; renderTaskSheet(); return; }
    try { await setProgress(t, value); if (value === 'completed') toast('Task completed'); render(); } catch (e) { toast(e.message, 'error'); }
  } else if (kind === 'priority') {
    if (t.priority === value) return;
    saveTask(t, { priority: value });
  }
}
document.addEventListener('dragstart', (e) => {
  const c = e.target.closest && e.target.closest('.tcard[draggable="true"]');
  if (!c) return;
  KL.drag = c.dataset.task;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', c.dataset.task);
  requestAnimationFrame(() => c.classList.add('dragging'));
});
document.addEventListener('dragend', () => {
  for (const x of $$('.tcard.dragging')) x.classList.remove('dragging');
  for (const x of $$('.bucket.drop')) x.classList.remove('drop');
  KL.drag = null;
});
document.addEventListener('dragover', (e) => {
  const b = e.target.closest && e.target.closest('[data-drop]');
  if (!b || !KL.drag) return;
  e.preventDefault();
  for (const x of $$('.bucket.drop')) if (x !== b) x.classList.remove('drop');
  b.classList.add('drop');
});
document.addEventListener('drop', (e) => {
  const b = e.target.closest && e.target.closest('[data-drop]');
  if (!b || !KL.drag) return;
  e.preventDefault();
  const id = KL.drag;
  KL.drag = null;
  b.classList.remove('drop');
  plannerDrop(id, b.dataset.drop, b.dataset.value);
});
