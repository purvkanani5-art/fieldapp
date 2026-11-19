/* Company policies (2026-11-19). HR uploads each policy as a PDF and says who must accept it. Anyone with a required
   policy they have not accepted (in its current version) sees only "Before you start" until they have opened each one,
   ticked it and signed the declaration with their finger. HR and the director can still open Policies from that screen
   to fix or archive a policy. The signed declaration is a PDF in the person's HR documents. */

const POL_LANG = () => (['gu', 'hi'].includes(lang()) ? lang() : 'en');
/** A policy PDF opens in a new tab (the PDF viewer); opening it is what lets the person tick it. */
const polOpen = (fid, id, text = 'Read') => `<a class="btn small" href="/api/files/${esc(fid)}?token=${encodeURIComponent(KL.token)}" target="_blank" rel="noopener" data-action="polRead" data-id="${esc(id)}">${ic('doc')} ${esc(text)}</a>`;

/* ------------------------------------------------ who a policy is for: everyone, or any mix of projects, sub-groups, sites */
/** Form value: a list like ['project:biochar', 'subgroup:agroforestry:farmer', 'site:<id>']; empty = everyone. */
const audToF = (a) => (!a || a.type === 'all' ? [] : a.type === 'groups' ? (a.items || []).map((x) => `${x.type}:${x.value}`) : [`${a.type}:${a.value}`]);
const audFromF = (list) => {
  const items = (list || []).map((s) => { const i = s.indexOf(':'); return { type: s.slice(0, i), value: s.slice(i + 1) }; });
  return items.length ? { type: 'groups', items } : { type: 'all' };
};
function audPicker(key) {
  const on = F(key, []);
  const chip = (v, label) => `<button type="button" data-action="audTog" data-key="${esc(key)}" data-value="${esc(v)}" aria-pressed="${on.includes(v)}">${esc(label)}</button>`;
  const projects = [...Object.keys(projectsMeta()), 'office'];
  const sites = (KL.boot?.sites || []).filter((s) => s.active !== 0);
  const picked = on.filter((v) => v.startsWith('site:')).length;
  return `<div class="field aud-pick"><span>Who it is for</span>
    <div class="chips pills"><button type="button" data-action="audAll" data-key="${esc(key)}" aria-pressed="${!on.length}">Everyone</button></div>
    ${projects.map((p) => { const subs = subgroupsOf(p); return `<div class="aud-proj"><div class="chips pills">${chip(`project:${p}`, `${projMeta(p).name || p}${p === 'office' ? '' : ' (all)'}`)}${subs.map((g) => chip(`subgroup:${p}:${g.key}`, g.name)).join('')}</div></div>`; }).join('')}
    ${sites.length ? `<details class="aud-sites" ${picked ? 'open' : ''}><summary>Particular sites${picked ? ` · ${picked} chosen` : ''}</summary><div class="chips pills">${sites.map((s) => chip(`site:${s.id}`, s.name)).join('')}</div></details>` : ''}
    <p class="hint" style="margin:0">Pick one or more. Someone counts when they work at a site in it, or are assigned to the whole project.</p></div>`;
}
Actions.audTog = (el) => { const s = new Set(F(el.dataset.key, [])); if (s.has(el.dataset.value)) s.delete(el.dataset.value); else s.add(el.dataset.value); setF(el.dataset.key, [...s]); render(); };
Actions.audAll = (el) => { setF(el.dataset.key, []); render(); };

/* ------------------------------------------------ the gate: shown instead of the app while something is unsigned */
function policyGateView() {
  const d = data(`policies:pending:${POL_LANG()}`, () => api(`/api/policies/pending?lang=${POL_LANG()}`));
  const lead = ['admin', 'hr'].includes(KL.user.role);
  const top = `<div class="row" style="gap:12px"><img src="./icon.svg" alt="" style="width:48px;border-radius:14px" /><div><b style="font-size:20px">Before you start</b><p class="hint" style="margin:2px 0 0">Read the company policies, accept them and sign. This is needed once, and again when a policy changes.</p></div></div>`;
  const foot = `<div class="btns" style="margin-top:6px">${langBtn()}${lead ? '<a class="btn" href="#policies">Manage policies</a>' : ''}<button type="button" class="btn ghost" data-action="logout">Sign out</button></div>`;
  if (d === null) return `<div class="auth"><div class="panel" style="margin-top:6vh"><div class="card stack">${top}${spinner()}${foot}</div></div></div>`;
  if (d.error) return `<div class="auth"><div class="panel" style="margin-top:6vh"><div class="card stack">${top}${errorBox(d.error)}${foot}</div></div></div>`;
  if (!d.rows.length) { setTimeout(async () => { await refreshMe(); render(); }, 0); return spinner(); }
  KL.ui.polRead = KL.ui.polRead || new Set();
  const ticks = F('pol-ticks', []);
  const all = d.rows.every((p) => ticks.includes(p.id));
  return `<div class="auth"><div class="panel" style="margin-top:4vh;max-width:620px"><div class="card stack">${top}
    <div class="stack">${d.rows.map((p, i) => {
      const read = KL.ui.polRead.has(p.id) || !p.file;
      return `<div class="pol-row"><div class="row between" style="gap:10px;align-items:flex-start"><div style="min-width:0"><b>${i + 1}. ${esc(p.title)}</b>${p.version ? ` <span class="muted mono" style="font-size:12.5px">v${esc(p.version)}</span>` : ''}${p.summary ? `<p class="hint" style="margin:4px 0 0">${esc(p.summary)}</p>` : ''}</div>${p.file ? polOpen(p.file, p.id) : ''}</div>
        <label class="check pol-tick ${read ? '' : 'off'}"><input type="checkbox" ${ticks.includes(p.id) ? 'checked' : ''} ${read ? '' : 'disabled'} data-change="polTick" data-id="${esc(p.id)}" /> <span>${read ? 'I have read this policy and I accept it' : 'Open the policy first'}</span></label></div>`;
    }).join('')}</div>
    <div class="pol-decl"><b>Declaration</b><p>${esc(d.declaration)}</p></div>
    <div class="field"><span>Sign here with your finger</span><div class="sig-wrap"><canvas id="sig" class="sig" aria-label="Signature pad"></canvas><div class="line"></div></div><button type="button" class="btn small ghost" data-action="sigClear" style="justify-self:start">Clear</button></div>
    <button type="button" class="btn primary wide xl" data-action="polSign" ${all ? '' : 'disabled'}>${all ? 'Accept and sign' : `Accept all ${d.rows.length} first`}</button>
    ${foot}</div></div></div>`;
}
Actions.polRead = (el) => {
  window.open(el.getAttribute('href'), '_blank', 'noopener'); // the tap handler does not follow links that carry an action
  KL.ui.polRead = KL.ui.polRead || new Set(); KL.ui.polRead.add(el.dataset.id); setTimeout(render, 300);
};
Changes.polTick = (el) => { const t = new Set(F('pol-ticks', [])); if (el.checked) t.add(el.dataset.id); else t.delete(el.dataset.id); setF('pol-ticks', [...t]); render(); };
Actions.polSign = async (el) => {
  if (!KL.sig || KL.sig.isEmpty()) return toast('Sign in the box first', 'error');
  el.classList.add('busy');
  try {
    await api('/api/policies/sign', { json: { policies: F('pol-ticks', []), signature: KL.sig.dataUrl() } });
    clearF('pol-ticks'); KL.sig = null; invalidate('policies');
    await refreshMe(); await celebrate('Thank you', 'Your signed declaration is saved in your documents.'); render();
  } catch (e) { el.classList.remove('busy'); toast(e.message, 'error'); }
};

/* ------------------------------------------------ Me > Company policies */
Views.mypolicies = () => {
  const d = data(`policies:mine:${POL_LANG()}`, () => api(`/api/policies/mine?lang=${POL_LANG()}`));
  const head = topbar('Company policies', '#me');
  if (d === null) return `${head}${spinner()}`;
  if (d.error) return `${head}${errorBox(d.error)}`;
  return `${head}<p class="sub">The policies you accepted. Your signed declaration is under Me › Payslips and documents.</p>
    ${d.rows.length ? `<div class="card flush">${d.rows.map((p) => `<div class="lrow-static row" style="gap:12px"><span class="icon ${p.accepted_at ? 'green' : 'amber'}">${ic('doc')}</span><span class="tx" style="flex:1;min-width:0"><b>${esc(p.title)}</b><span class="muted" style="font-size:13px;display:block">${p.version ? `v${esc(p.version)} · ` : ''}${p.accepted_at ? `Accepted ${esc(fmtDate(p.accepted_at, false))}` : 'Not accepted yet'}</span></span>${p.file ? polOpen(p.file, p.id, 'Open') : ''}</div>`).join('')}</div>` : emptyState('doc', 'No policies yet', 'When HR adds one for you, you are asked to read and accept it.')}`;
};

/* ------------------------------------------------ HR: Policies */
Views.policies = () => {
  const d = data('policies:all', () => api('/api/policies'));
  const head = topbar('Policies', '#people', '<a class="btn small" href="#policybulk">Upload several</a><a class="btn small primary" href="#policyedit/new">+ New</a>');
  if (d === null) return `${head}${spinner()}`;
  if (d.error) return `${head}${errorBox(d.error)}`;
  if (KL.ui.declInit !== d.declaration) { KL.ui.declInit = d.declaration; setF('pol-decl', d.declaration); }
  const prow = (p) => lrow({ href: `#policy/${p.id}`, icon: 'doc', tone: p.status === 'archived' || p.must_ack === 'No' ? '' : p.done >= p.total ? 'green' : 'amber',
      title: `${p.title}${p.version ? ` · v${p.version}` : ''}`, sub: esc(`${p.status === 'archived' ? 'Archived · ' : ''}${p.audienceText}${p.must_ack === 'No' ? ' · for reading only' : ` · ${p.done} of ${p.total} accepted`}`) });
  const live = d.rows.filter((p) => p.status !== 'archived');
  const must = live.filter((p) => p.must_ack !== 'No'); const read = live.filter((p) => p.must_ack === 'No'); const old = d.rows.filter((p) => p.status === 'archived');
  return `${head}<p class="sub">Tap a policy to choose who it is for and whether they must sign it. Everyone a must-sign policy is for has to read, accept and sign it before using the app; a new version asks again.</p>
    ${d.rows.length ? '' : emptyState('doc', 'No policies yet', 'Upload the PDFs with Upload several, or add one with + New.')}
    ${must.length ? group(`Must accept and sign · ${must.length}`, `<div class="card flush">${must.map(prow).join('')}</div>`) : ''}
    ${read.length ? group(`General · for reading only · ${read.length}`, `<div class="card flush">${read.map(prow).join('')}</div>`) : ''}
    ${old.length ? group(`Archived · ${old.length}`, `<div class="card flush">${old.map(prow).join('')}</div>`) : ''}
    ${group('The declaration people sign', `<div class="card stack">${textarea('pol-decl', F('pol-decl'), '')}<button type="button" class="btn" data-action="polDecl">Save the declaration</button></div>`)}`;
};
Actions.polDecl = async () => { try { await api('/api/policies/declaration/text', { json: { text: F('pol-decl', '') } }); invalidate('policies'); toast('Saved'); render(); } catch (e) { toast(e.message, 'error'); } };

Views.policy = (id) => {
  const p = data(`policies:one:${id}`, () => api(`/api/policies/${id}`));
  const head = topbar('Policy', '#policies', `<a class="btn small" href="#policyedit/${esc(id)}">${ic('pen')} Edit</a>`);
  if (p === null) return `${head}${spinner()}`;
  if (p.error) return `${head}${errorBox(p.error)}`;
  const not = p.people.filter((x) => !x.accepted_at);
  if (KL.ui.pwInit !== `${id}:${p.updated_at}`) { KL.ui.pwInit = `${id}:${p.updated_at}`; setF('pw-must', p.must_ack || 'Yes'); setF('pw-aud', audToF(p.audience)); }
  const files = Object.entries(p.files || {}).map(([l, fid]) => polOpen(fid, p.id, { en: 'English', gu: 'ગુજરાતી', hi: 'हिन्दी' }[l] || l)).join('');
  return `${head}<div class="card stack"><b style="font-size:18px">${esc(p.title)}${p.version ? ` <span class="muted mono" style="font-size:13px">v${esc(p.version)}</span>` : ''}</b>
      ${p.summary ? `<p style="margin:0">${esc(p.summary)}</p>` : ''}<p class="hint" style="margin:0">For: ${esc(p.audienceText)}${p.must_ack === 'No' ? ' · reading only' : ' · must accept and sign'}${p.status === 'archived' ? ' · archived' : ''}</p>
      ${files ? `<div class="btns">${files}</div>` : ''}</div>
    ${group('Who and how', `<div class="card stack">
      ${pills('Signing', 'pw-must', F('pw-must'), [['No', 'General, for reading only'], ['Yes', 'Must accept and sign']])}
      ${audPicker('pw-aud')}
      <button type="button" class="btn primary wide" data-action="polWho" data-id="${esc(p.id)}">Save</button>
      ${F('pw-must') === 'Yes' && p.must_ack === 'No' ? '<p class="hint" style="margin:0">Once saved, everyone it is for must read and sign it before they can use the app.</p>' : ''}</div>`)}
    ${p.must_ack === 'No' ? '' : group(`Not accepted yet · ${not.length}`, not.length ? `<div class="card flush">${not.map((x) => `<div class="lrow-static row">${avatar(x.name, 'lg')}<span class="tx" style="flex:1"><b>${esc(x.name)}</b><span class="muted" style="font-size:13px;display:block">${esc(x.designation || '')}</span></span></div>`).join('')}</div><button type="button" class="btn wide" style="margin-top:10px" data-action="polRemind" data-id="${esc(p.id)}">${ic('bell')} Remind them</button>` : '<div class="card"><p class="empty">Everyone has accepted.</p></div>')}
    ${p.must_ack === 'No' ? '' : group('Accepted', p.people.filter((x) => x.accepted_at).length ? `<div class="card flush">${p.people.filter((x) => x.accepted_at).map((x) => `<div class="lrow-static row">${avatar(x.name, 'lg')}<span class="tx" style="flex:1"><b>${esc(x.name)}</b><span class="muted" style="font-size:13px;display:block">${esc(fmtDate(x.accepted_at))}</span></span>${x.declaration ? fileLink(x.declaration, 'Declaration') : ''}</div>`).join('')}</div>` : '<div class="card"><p class="empty">Nobody yet.</p></div>')}
    <button type="button" class="btn wide ghost" style="margin-top:14px" data-action="polArchive" data-id="${esc(p.id)}" data-restore="${p.status === 'archived' ? '1' : ''}">${p.status === 'archived' ? 'Bring it back' : 'Archive (no longer required)'}</button>`;
};
Actions.polWho = async (el) => {
  const must = F('pw-must', 'Yes');
  if (must === 'Yes') {
    const ok = await modal({ title: 'Ask them to sign?', message: 'Everyone this policy is for will have to open it and sign before they can use the app.', confirmText: 'Save' });
    if (!ok) return;
  }
  el.classList.add('busy');
  try {
    const r = await api(`/api/policies/${el.dataset.id}/who`, { json: { must_ack: must, audience: audFromF(F('pw-aud', [])) } });
    KL.ui.pwInit = null; invalidate('policies'); await refreshMe(); toast(`Saved · ${r.audienceText} (${r.total} ${r.total === 1 ? 'person' : 'people'})`); render();
  } catch (e) { el.classList.remove('busy'); toast(e.message, 'error'); }
};
Actions.polRemind = async (el) => { try { const r = await api(`/api/policies/${el.dataset.id}/remind`, { json: {} }); toast(`Reminded ${r.count}`); } catch (e) { toast(e.message, 'error'); } };
Actions.polArchive = async (el) => {
  try { await api(`/api/policies/${el.dataset.id}/archive`, { json: { restore: Boolean(el.dataset.restore) } }); invalidate('policies'); await refreshMe(); toast('Saved'); render(); } catch (e) { toast(e.message, 'error'); }
};

Views.policyedit = (id) => {
  const isNew = id === 'new';
  const p = isNew ? {} : data(`policies:one:${id}`, () => api(`/api/policies/${id}`));
  const head = topbar(isNew ? 'New policy' : 'Edit policy', isNew ? '#policies' : `#policy/${id}`);
  if (p === null) return `${head}${spinner()}`;
  if (p.error) return `${head}${errorBox(p.error)}`;
  if (KL.ui.peInit !== id) {
    KL.ui.peInit = id; KL.ui.peFiles = {};
    setF('pe-title', p.title || ''); setF('pe-version', p.version || ''); setF('pe-body', p.summary || ''); setF('pe-must', p.must_ack || 'Yes');
    setF('pe-aud', audToF(p.audience)); if (isNew) setF('pe-must', 'No');
  }
  const fileRow = (l, label) => { const picked = KL.ui.peFiles?.[l]; const has = p.files?.[l]; return `<div class="row between" style="gap:8px"><span><b>${esc(label)}</b><span class="muted" style="display:block;font-size:13px">${picked ? esc(picked.name) : has ? 'Uploaded' : l === 'en' ? 'Required' : 'Optional'}</span></span><button type="button" class="btn small" data-action="pePick" data-lang="${l}">${ic('upload')} ${picked || has ? 'Replace' : 'Choose PDF'}</button></div>`; };
  return `${head}<div class="card stack">
      ${field('Policy name', input('pe-title', F('pe-title'), { placeholder: 'e.g. Code of conduct' }), { required: true })}
      ${field('Version', input('pe-version', F('pe-version'), { placeholder: 'e.g. 2026.1' }))}
      ${pills('Signing', 'pe-must', F('pe-must', 'Yes'), [['No', 'General, for reading only'], ['Yes', 'Must accept and sign']])}
      ${audPicker('pe-aud')}
      ${field('Short summary (optional)', textarea('pe-body', F('pe-body'), 'One or two lines on what it covers'))}
    </div>
    ${group('The policy (PDF)', `<div class="card stack">${fileRow('en', 'English')}${fileRow('gu', 'Gujarati')}${fileRow('hi', 'Hindi')}<p class="hint">People see the copy in their language when there is one, otherwise the English one. A new version (or a new file with a new version number) asks everyone to accept again.</p></div>`)}
    <button type="button" class="btn primary wide xl" style="margin-top:14px" data-action="peSave" data-id="${esc(isNew ? '' : id)}">Save policy</button>`;
};
Actions.pePick = (el) => pickFile('application/pdf', (f) => { KL.ui.peFiles = { ...(KL.ui.peFiles || {}), [el.dataset.lang]: f }; render(); });
Actions.peSave = async (el) => {
  const form = new FormData();
  form.append('id', el.dataset.id || '');
  form.append('data', JSON.stringify({ title: F('pe-title', ''), version: F('pe-version', ''), body: F('pe-body', ''), must_ack: F('pe-must', 'Yes'), audience: audFromF(F('pe-aud', [])) }));
  for (const [l, f] of Object.entries(KL.ui.peFiles || {})) form.append(`file_${l}`, f, f.name);
  el.classList.add('busy');
  try {
    const r = await api('/api/policies', { form });
    KL.ui.peInit = null; KL.ui.peFiles = {}; invalidate('policies'); await refreshMe();
    toast(F('pe-must') === 'Yes' ? 'Saved. Everyone it is for is asked to accept it.' : 'Saved'); location.hash = `#policy/${r.id}`;
  } catch (e) { el.classList.remove('busy'); toast(e.message, 'error'); }
};

/* ------------------------------------------------ HR: upload several PDFs at once (each: for everyone, reading only) */
Views.policybulk = () => {
  const files = KL.ui.pbFiles || [];
  const res = KL.ui.pbResult;
  return `${topbar('Upload policies', '#policies')}
    <p class="sub">Choose all the policy PDFs at once. Each one is named after its file (without "(EN-GU-HI)" or "revised") and starts as a general policy for everyone, for reading only, so nobody is locked out. Then tap each one to choose who it is for and whether they must sign it. A policy with the same name already in the app is skipped.</p>
    <div class="card stack">
      ${field('Version for all of them', input('pb-version', F('pb-version', '2026.1'), { placeholder: 'e.g. 2026.1' }))}
      <button type="button" class="btn wide" data-action="pbPick">${ic('upload')} ${files.length ? `Choose again (${files.length} chosen)` : 'Choose PDFs'}</button>
      ${files.length ? `<div class="pb-list">${files.map((f) => `<div class="row between" style="gap:8px"><span>${esc(f.name)}</span><small class="muted">${Math.round(f.size / 1024)} KB</small></div>`).join('')}</div>` : ''}
      <button type="button" class="btn primary wide xl" data-action="pbSend" ${files.length ? '' : 'disabled'}>Upload ${files.length || ''} ${files.length === 1 ? 'policy' : 'policies'}</button>
    </div>
    ${res ? group('Done', `<div class="card stack"><p style="margin:0"><b>${res.added.length} added</b>${res.skipped.length ? `, ${res.skipped.length} skipped` : ''}.</p>${res.skipped.map((x) => `<p class="hint" style="margin:0">${esc(x.name)}: ${esc(x.why)}</p>`).join('')}<a class="btn wide" href="#policies">Go to the policies</a></div>`) : ''}`;
};
Actions.pbPick = () => {
  const input = document.createElement('input');
  input.type = 'file'; input.multiple = true; input.accept = 'application/pdf,.pdf';
  input.onchange = () => { KL.ui.pbFiles = [...(input.files || [])].sort((a, b) => a.name.localeCompare(b.name)); KL.ui.pbResult = null; render(); };
  input.click();
};
Actions.pbSend = async (el) => {
  const files = KL.ui.pbFiles || [];
  if (!files.length) return;
  el.classList.add('busy');
  const res = { added: [], skipped: [] };
  try {
    for (let i = 0; i < files.length; i += 4) { // a few at a time, so a slow phone connection does not time out
      const form = new FormData();
      form.append('version', F('pb-version', '2026.1'));
      for (const f of files.slice(i, i + 4)) form.append('files', f, f.name);
      el.textContent = `Uploading ${Math.min(i + 4, files.length)} of ${files.length}…`;
      const r = await api('/api/policies/bulk', { form });
      res.added.push(...r.added); res.skipped.push(...r.skipped);
    }
    KL.ui.pbFiles = []; KL.ui.pbResult = res; invalidate('policies'); toast(`${res.added.length} uploaded`); render();
  } catch (e) { KL.ui.pbResult = res.added.length ? res : null; el.classList.remove('busy'); toast(e.message, 'error'); render(); }
};
