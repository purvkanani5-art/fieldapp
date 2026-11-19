/* Company policies (2026-11-19). HR uploads each policy as a PDF and says who must accept it. Anyone with a required
   policy they have not accepted (in its current version) sees only "Before you start" until they have opened each one,
   ticked it and signed the declaration with their finger. HR and the director can still open Policies from that screen
   to fix or archive a policy. The signed declaration is a PDF in the person's HR documents. */

const POL_LANG = () => (['gu', 'hi'].includes(lang()) ? lang() : 'en');
/** A policy PDF opens in a new tab (the PDF viewer); opening it is what lets the person tick it. */
const polOpen = (fid, id, text = 'Read') => `<a class="btn small" href="/api/files/${esc(fid)}?token=${encodeURIComponent(KL.token)}" target="_blank" rel="noopener" data-action="polRead" data-id="${esc(id)}">${ic('doc')} ${esc(text)}</a>`;

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
  const head = topbar('Policies', '#people', '<a class="btn small primary" href="#policyedit/new">+ New policy</a>');
  if (d === null) return `${head}${spinner()}`;
  if (d.error) return `${head}${errorBox(d.error)}`;
  if (KL.ui.declInit !== d.declaration) { KL.ui.declInit = d.declaration; setF('pol-decl', d.declaration); }
  return `${head}<p class="sub">Upload each policy as a PDF. Everyone it is for must read, accept and sign before using the app; a new version asks again.</p>
    ${d.rows.length ? `<div class="card flush">${d.rows.map((p) => lrow({ href: `#policy/${p.id}`, icon: 'doc', tone: p.status === 'archived' ? '' : p.done >= p.total ? 'green' : 'amber',
      title: `${p.title}${p.version ? ` · v${p.version}` : ''}`, sub: esc(`${p.status === 'archived' ? 'Archived · ' : ''}${p.audienceText}${p.must_ack === 'No' ? ' · for reading only' : ` · ${p.done} of ${p.total} accepted`}`) })).join('')}</div>` : emptyState('doc', 'No policies yet', 'Add the first one with + New policy.')}
    ${group('The declaration people sign', `<div class="card stack">${textarea('pol-decl', F('pol-decl'), '')}<button type="button" class="btn" data-action="polDecl">Save the declaration</button></div>`)}`;
};
Actions.polDecl = async () => { try { await api('/api/policies/declaration/text', { json: { text: F('pol-decl', '') } }); invalidate('policies'); toast('Saved'); render(); } catch (e) { toast(e.message, 'error'); } };

Views.policy = (id) => {
  const p = data(`policies:one:${id}`, () => api(`/api/policies/${id}`));
  const head = topbar('Policy', '#policies', `<a class="btn small" href="#policyedit/${esc(id)}">${ic('pen')} Edit</a>`);
  if (p === null) return `${head}${spinner()}`;
  if (p.error) return `${head}${errorBox(p.error)}`;
  const not = p.people.filter((x) => !x.accepted_at);
  const files = Object.entries(p.files || {}).map(([l, fid]) => polOpen(fid, p.id, { en: 'English', gu: 'ગુજરાતી', hi: 'हिन्दी' }[l] || l)).join('');
  return `${head}<div class="card stack"><b style="font-size:18px">${esc(p.title)}${p.version ? ` <span class="muted mono" style="font-size:13px">v${esc(p.version)}</span>` : ''}</b>
      ${p.summary ? `<p style="margin:0">${esc(p.summary)}</p>` : ''}<p class="hint" style="margin:0">For: ${esc(p.audienceText)}${p.must_ack === 'No' ? ' · reading only' : ' · must accept and sign'}${p.status === 'archived' ? ' · archived' : ''}</p>
      ${files ? `<div class="btns">${files}</div>` : ''}</div>
    ${p.must_ack === 'No' ? '' : group(`Not accepted yet · ${not.length}`, not.length ? `<div class="card flush">${not.map((x) => `<div class="lrow-static row">${avatar(x.name, 'lg')}<span class="tx" style="flex:1"><b>${esc(x.name)}</b><span class="muted" style="font-size:13px;display:block">${esc(x.designation || '')}</span></span></div>`).join('')}</div><button type="button" class="btn wide" style="margin-top:10px" data-action="polRemind" data-id="${esc(p.id)}">${ic('bell')} Remind them</button>` : '<div class="card"><p class="empty">Everyone has accepted.</p></div>')}
    ${p.must_ack === 'No' ? '' : group('Accepted', p.people.filter((x) => x.accepted_at).length ? `<div class="card flush">${p.people.filter((x) => x.accepted_at).map((x) => `<div class="lrow-static row">${avatar(x.name, 'lg')}<span class="tx" style="flex:1"><b>${esc(x.name)}</b><span class="muted" style="font-size:13px;display:block">${esc(fmtDate(x.accepted_at))}</span></span>${x.declaration ? fileLink(x.declaration, 'Declaration') : ''}</div>`).join('')}</div>` : '<div class="card"><p class="empty">Nobody yet.</p></div>')}
    <button type="button" class="btn wide ghost" style="margin-top:14px" data-action="polArchive" data-id="${esc(p.id)}" data-restore="${p.status === 'archived' ? '1' : ''}">${p.status === 'archived' ? 'Bring it back' : 'Archive (no longer required)'}</button>`;
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
    const a = p.audience || { type: 'all' }; setF('pe-aud', a.type === 'all' ? 'all:' : `${a.type}:${a.value}`);
  }
  const fileRow = (l, label) => { const picked = KL.ui.peFiles?.[l]; const has = p.files?.[l]; return `<div class="row between" style="gap:8px"><span><b>${esc(label)}</b><span class="muted" style="display:block;font-size:13px">${picked ? esc(picked.name) : has ? 'Uploaded' : l === 'en' ? 'Required' : 'Optional'}</span></span><button type="button" class="btn small" data-action="pePick" data-lang="${l}">${ic('upload')} ${picked || has ? 'Replace' : 'Choose PDF'}</button></div>`; };
  return `${head}<div class="card stack">
      ${field('Policy name', input('pe-title', F('pe-title'), { placeholder: 'e.g. Code of conduct' }), { required: true })}
      <div class="grid2">${field('Version', input('pe-version', F('pe-version'), { placeholder: 'e.g. 2026.1' }))}${field('Who must accept it', select('pe-aud', F('pe-aud'), audienceOptions()))}</div>
      ${pills('Accepting', 'pe-must', F('pe-must', 'Yes'), [['Yes', 'Must accept and sign'], ['No', 'For reading only']])}
      ${field('Short summary (optional)', textarea('pe-body', F('pe-body'), 'One or two lines on what it covers'))}
    </div>
    ${group('The policy (PDF)', `<div class="card stack">${fileRow('en', 'English')}${fileRow('gu', 'Gujarati')}${fileRow('hi', 'Hindi')}<p class="hint">People see the copy in their language when there is one, otherwise the English one. A new version (or a new file with a new version number) asks everyone to accept again.</p></div>`)}
    <button type="button" class="btn primary wide xl" style="margin-top:14px" data-action="peSave" data-id="${esc(isNew ? '' : id)}">Save policy</button>`;
};
Actions.pePick = (el) => pickFile('application/pdf', (f) => { KL.ui.peFiles = { ...(KL.ui.peFiles || {}), [el.dataset.lang]: f }; render(); });
Actions.peSave = async (el) => {
  const form = new FormData();
  form.append('id', el.dataset.id || '');
  form.append('data', JSON.stringify({ title: F('pe-title', ''), version: F('pe-version', ''), body: F('pe-body', ''), must_ack: F('pe-must', 'Yes'), audience: parseAud(F('pe-aud', 'all:')) }));
  for (const [l, f] of Object.entries(KL.ui.peFiles || {})) form.append(`file_${l}`, f, f.name);
  el.classList.add('busy');
  try {
    const r = await api('/api/policies', { form });
    KL.ui.peInit = null; KL.ui.peFiles = {}; invalidate('policies'); await refreshMe();
    toast('Saved. Everyone it is for is asked to accept it.'); location.hash = `#policy/${r.id}`;
  } catch (e) { el.classList.remove('busy'); toast(e.message, 'error'); }
};
