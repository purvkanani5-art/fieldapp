/* Committees, complaints and suggestions (2026-11-19). Everyone sees the committees: what each does, why it exists,
   how to reach it and who is on it. A complaint is branched: anonymous or not, POSH or not, then three questions
   (what happened, which policy it breaks, against whom). The server routes it to a committee, keeps anyone named out
   of it, tells the members and emails the committee's mailbox. Anonymous senders are never stored on the server: they
   keep a tracking code, which this phone also remembers for them (only on this phone). */

const CM_LOOK = { posh: ['shield', 'violet'], safety: ['alert', 'green'], grievance: ['users', 'blue'], ideas: ['sparkle', 'amber'], custom: ['users', 'teal'] };
const POSH_TEXT = 'Sexual harassment means unwelcome behaviour of a sexual nature: touching or physical contact, sexual remarks or jokes, showing sexual pictures or messages, asking for sexual favours, or promising a benefit or threatening harm at work in return. It applies at the office, every site, in company vehicles and on work trips. It goes only to the POSH Internal Committee; HR and your manager do not see it.';

/** An on/off switch row (a real checkbox, styled). */
function switchRow(id, on, title, sub, change) {
  return `<label class="sw-row"><span class="tx"><b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</span><input type="checkbox" class="sw" id="${esc(id)}" ${on ? 'checked' : ''} data-change="${esc(change)}" /></label>`;
}

/* ------------------------------------------------ anonymous codes kept on this phone, for this person only */
const anonKey = () => `kl-anon:${KL.user?.id || ''}`;
function anonCodes() { try { return JSON.parse(localStorage.getItem(anonKey()) || '[]'); } catch { return []; } }
function rememberCode(item) { try { localStorage.setItem(anonKey(), JSON.stringify([item, ...anonCodes().filter((x) => x.code !== item.code)].slice(0, 30))); } catch { /* private mode: the code on screen is enough */ } }
function forgetCode(code) { try { localStorage.setItem(anonKey(), JSON.stringify(anonCodes().filter((x) => x.code !== code))); } catch { /* ignore */ } }

/** Where a complaint will go, worked out the same way as the server (for the line above the Send button). */
function fbDestination(cm, type, posh, policy) {
  if (!cm || cm.error) return null;
  const byKey = (k) => cm.rows.find((c) => c.key === k);
  if (type === 'suggestion') return byKey('ideas');
  if (posh) return byKey('posh');
  const hit = cm.policies.find((p) => p.policy === policy);
  return hit ? cm.rows.find((c) => c.id === hit.committee_id) : null;
}

Views.feedback = () => {
  const cm = data('committees', () => api('/api/committees'));
  const fb = data('feedback:all', () => api('/api/feedback'));
  const head = topbar('Complaints & suggestions', '#me');
  const done = KL.ui.fbDone;
  if (done) {
    return `${head}<div class="card stack done-card"><span class="icon green big">${ic('check')}</span><h2>Sent to the ${esc(done.committee)}</h2>${done.ref ? `<p class="sub">Reference <b class="mono">${esc(done.ref)}</b></p>` : ''}
      <p class="sub">${done.mailbox ? `It is in the committee's inbox in the app and was emailed to <b>${esc(done.mailbox)}</b>.` : 'It is in the committee\'s inbox in the app.'} The members have been told.</p>
      ${done.code ? `<div class="banner violet">${ic('shield')}<div><b>Your tracking code</b><p>Nobody knows you sent this. Use this code to read replies and write back. This phone remembers it for you, but also write it down.</p></div></div><div class="code-big mono">${esc(done.code)}</div>` : '<p class="sub">You will get a notification when the committee replies or closes it.</p>'}
      <div class="btns"><a class="btn wide" href="${done.code ? `#case/${esc(done.code)}` : `#case/${esc(done.id)}`}">Open it</a><button type="button" class="btn primary wide" data-action="fbAgain">Done</button></div></div>`;
  }
  const type = F('fb-type', 'complaint');
  const anon = Boolean(F('fb-anon'));
  const posh = type === 'complaint' && Boolean(F('fb-posh'));
  const policy = F('fb-policy', '');
  const dest = fbDestination(cm, type, posh, policy);
  const pols = cm && !cm.error ? cm.policies : [];
  const groups = [...new Set(pols.map((p) => p.committee))];
  const polSelect = `<select class="select" id="fb-policy" data-change="fbPolicy"><option value="">Choose</option>${groups.map((g) => `<optgroup label="${esc(g)}">${pols.filter((p) => p.committee === g).map((p) => `<option ${p.policy === policy ? 'selected' : ''}>${esc(p.policy)}</option>`).join('')}</optgroup>`).join('')}</select>`;
  const form = `<div class="card stack">
      <div class="chips pills" role="group" aria-label="Complaint or suggestion"><button type="button" data-action="fbType" data-type="complaint" aria-pressed="${type === 'complaint'}">Complaint</button><button type="button" data-action="fbType" data-type="suggestion" aria-pressed="${type === 'suggestion'}">Suggestion</button></div>
      ${switchRow('fb-anon', anon, 'Send without my name', 'Nobody can see who sent it, not even HR or the director. You get a code to follow it up.', 'fbAnon')}
      ${type === 'complaint' ? `${switchRow('fb-posh', posh, 'This is a POSH complaint', 'Sexual harassment at work. Only the POSH committee sees it.', 'fbPosh')}
      <details class="posh-what" ${posh ? 'open' : ''}><summary>What comes under POSH?</summary><p>${esc(POSH_TEXT)}</p></details>` : ''}
      ${field(type === 'complaint' ? 'What is your complaint?' : 'What is your suggestion?', textarea('fb-text', F('fb-text'), type === 'complaint' ? 'What happened, when and where' : 'What would make work better, safer or cheaper?'), { required: true })}
      ${type === 'complaint' && !posh ? field('Which policy does this break?', polSelect, { required: true }) : ''}
      ${type === 'complaint' ? `${field('Against whom do you want action, or who should read it? (optional)', input('fb-against', F('fb-against'), { placeholder: 'A name, a role, or leave blank' }))}<p class="hint" style="margin-top:-6px">Anyone you name here is kept out of the case, even if they are on the committee.</p>` : ''}
      ${dest ? `<div class="dest-line">${ic('send')}<span>Goes to the <b>${esc(dest.name)}</b>${dest.mailbox ? ` · ${esc(dest.mailbox)}` : ''}</span></div>` : ''}
      <button type="button" class="btn primary wide xl" data-action="fbSend">${anon ? 'Send without my name' : 'Send'}</button>
    </div>`;
  const mine = fb && !fb.error ? fb.mine : [];
  const codes = anonCodes();
  const rows = [...mine.map((r) => ({ href: `#case/${r.id}`, title: `${r.type === 'complaint' ? 'Complaint' : 'Suggestion'} · ${r.committee}`, sub: `${r.ref ? `${r.ref} · ` : ''}${String(r.text).slice(0, 70)}`, status: r.status, at: r.created_at })),
    ...codes.map((c) => ({ href: `#case/${c.code}`, title: `${c.type === 'complaint' ? 'Complaint' : 'Suggestion'} · without your name`, sub: `${c.ref ? `${c.ref} · ` : ''}${c.committee || ''} · code ${c.code}`, status: '', at: c.at }))]
    .sort((x, y) => String(y.at).localeCompare(String(x.at)));
  return `${head}
    <p class="sub">Every complaint and suggestion goes to a committee. <a href="#committees">See who is on each committee</a></p>
    ${form}
    ${group('Sent by you', fb === null ? spinner() : rows.length ? `<div class="card flush">${rows.map((r) => lrow({ href: r.href, icon: 'chat', tone: r.status === 'closed' ? 'green' : 'amber', title: r.title, sub: esc(r.sub), right: r.status ? statusTag(r.status) : tag('Anonymous', 'violet') })).join('')}</div>` : '<div class="card"><p class="empty">Nothing yet.</p></div>')}
    ${group('Follow up with a code', `<div class="card stack"><div class="row" style="gap:8px">${input('fb-code', F('fb-code'), { placeholder: 'KL-XXXX-XXXX' })}<button type="button" class="btn" data-action="fbTrack">Open</button></div>
      ${KL.boot?.demo ? `<div class="demo-ribbon">${ic('sparkle')}<span>Prototype: try <b class="mono">KL-DEMO-2026</b></span></div>` : ''}</div>`)}`;
};
Actions.fbType = (el) => { setF('fb-type', el.dataset.type); render(); };
Changes.fbAnon = (el) => { setF('fb-anon', el.checked); render(); };
Changes.fbPosh = (el) => { setF('fb-posh', el.checked); render(); };
Changes.fbPolicy = (el) => { setF('fb-policy', el.value); render(); };
Actions.fbAgain = () => { KL.ui.fbDone = null; render(); };
Actions.fbSend = async (el) => {
  const type = F('fb-type', 'complaint');
  const posh = type === 'complaint' && Boolean(F('fb-posh'));
  const body = { type, text: F('fb-text', ''), anonymous: Boolean(F('fb-anon')), posh, policy: posh ? '' : F('fb-policy', ''), against: type === 'complaint' ? F('fb-against', '') : '' };
  if (String(body.text).trim().length < 5) return toast(type === 'complaint' ? 'Write what happened' : 'Write your suggestion', 'error');
  if (type === 'complaint' && !posh && !body.policy) return toast('Choose which policy this breaks (or Not sure)', 'error');
  el.classList.add('busy');
  try {
    const r = await api('/api/feedback', { json: body });
    if (r.code) rememberCode({ code: r.code, ref: r.ref, at: new Date().toISOString(), type, committee: r.committee });
    KL.ui.fbDone = { ...r };
    clearF('fb-text', 'fb-anon', 'fb-posh', 'fb-policy', 'fb-against');
    invalidate('feedback', 'committees');
    render();
  } catch (e) { el.classList.remove('busy'); toast(e.message, 'error'); }
};
Actions.fbTrack = () => {
  const code = F('fb-code', '').trim().toUpperCase();
  if (!code) return toast('Type the code', 'error');
  location.hash = `#case/${code}`;
};

/* ------------------------------------------------ one case: the committee's view, the sender's view, or by code */
const caseStatus = (s) => ({ open: 'New', in_progress: 'Under review', closed: 'Closed' }[s] || s);
function caseThread(rows, handler) {
  return rows && rows.length ? `<div class="thread">${rows.map((m) => `<div class="msg ${m.from_hr ? 'hr' : 'me'}"><small>${m.from_hr ? esc(m.by_name || 'Committee') : handler ? 'Sender' : 'You'} · ${esc(timeAgo(m.at))}</small><p>${esc(m.text)}</p></div>`).join('')}</div>` : '';
}
Views.case = (arg) => {
  const code = /^KL-/i.test(arg || '');
  const back = code || !KL.ui.caseBack ? '#feedback' : KL.ui.caseBack;
  const ckey = code ? `track:${arg.toUpperCase()}` : `case:${arg}`;
  if (KL.ui.caseOpen !== location.hash) { KL.ui.caseOpen = location.hash; delete KL.cache[ckey]; } // fresh every time it is opened: replies and outcomes arrive from others
  const c = code ? data(`track:${arg.toUpperCase()}`, () => api(`/api/feedback/track?code=${encodeURIComponent(arg)}`)) : data(`case:${arg}`, () => api(`/api/cases/${arg}`));
  const head = topbar(code ? 'Your report' : 'Case', back);
  if (c === null) return `${head}${spinner()}`;
  if (c.error) return `${head}${errorBox(c.error)}${code ? `<button type="button" class="btn wide" data-action="fbForget" data-code="${esc(arg)}" style="margin-top:12px">Remove this code from this phone</button>` : ''}`;
  const kind = c.type === 'complaint' ? (c.category === 'posh' ? 'POSH complaint' : 'Complaint') : 'Suggestion';
  const handler = Boolean(c.canHandle);
  const facts = [['Reference', c.ref], ['Committee', c.committee], ['Sent', fmtDate(c.created_at)], ...(handler ? [['From', c.user_name || 'Anonymous']] : []), ['Policy', c.policy], ['Against whom / who should read it', c.against]].filter(([, v]) => v);
  const info = `<div class="card stack"><div class="row between"><b style="font-size:18px">${esc(kind)}</b>${tag(caseStatus(c.status), c.status === 'closed' ? 'ok' : c.status === 'in_progress' ? 'info' : 'warn')}</div>
    <p class="case-text">${esc(c.text)}</p>
    <div class="case-facts">${facts.map(([k, v]) => `<span>${esc(k)}: <b>${esc(v)}</b></span>`).join('')}</div>
    ${handler && c.keptOut && c.keptOut.length ? `<div class="banner warn">${ic('shield')}<div><b>Kept out of this case</b><p>${esc(c.keptOut.join(', '))}: named in it, so they cannot see it. Do not share it with them.</p></div></div>` : ''}
    ${handler && c.mail_status ? `<p class="hint">Email to the committee: ${esc(c.mail_status)}</p>` : ''}
    ${c.status === 'closed' && c.outcome ? `<div class="banner ok">${ic('check')}<div><b>Outcome</b><p>${esc(c.outcome)}</p></div></div>` : ''}</div>`;
  const conv = c.thread && c.thread.length ? group('Messages', `<div class="card">${caseThread(c.thread, handler)}</div>`) : '';
  let act = '';
  if (handler) {
    act = `${c.status === 'open' ? `<button type="button" class="btn primary wide" data-action="caseStatus" data-id="${esc(c.id)}" data-status="in_progress">${ic('play')} Start review</button>` : ''}
      ${group(c.anonymous ? 'Message the sender (they read it with their code)' : `Message ${firstName(c.user_name || 'the sender')}`, `<div class="card stack">${textarea('case-msg', F('case-msg'), 'Ask a question or give an update')}<button type="button" class="btn wide" data-action="caseMsg" data-id="${esc(c.id)}">${ic('send')} Send message</button></div>`)}
      ${c.status !== 'closed' ? group('Close with an outcome', `<div class="card stack">${textarea('case-out', F('case-out'), 'What was decided or done. The sender sees this.')}<button type="button" class="btn wide redline" data-action="caseClose" data-id="${esc(c.id)}">Close the case</button></div>`) : ''}`;
  } else if (code) {
    act = `${group('Write back (still without your name)', `<div class="card stack">${textarea('case-msg', F('case-msg'), 'Your message')}<button type="button" class="btn wide primary" data-action="trackReply" data-code="${esc(arg)}">${ic('send')} Send</button></div>`)}
      ${c.named ? '' : `<div class="card stack" style="margin-top:12px"><b>Add my name</b><p class="hint">The committee may be able to do more if it knows who you are. Only the committee sees your name. This cannot be undone.</p><button type="button" class="btn wide" data-action="trackName" data-code="${esc(arg)}">Add my name to it</button></div>`}`;
  } else {
    act = group('Write back', `<div class="card stack">${textarea('case-msg', F('case-msg'), 'Your message')}<button type="button" class="btn wide primary" data-action="caseReply" data-id="${esc(c.id)}">${ic('send')} Send</button></div>`);
  }
  return `${head}${info}${conv}${act}`;
};
const caseDone = (msg) => { clearF('case-msg', 'case-out'); invalidate('case', 'track', 'feedback', 'committees'); toast(msg); render(); };
Actions.caseStatus = async (el) => { try { await api(`/api/feedback/${el.dataset.id}/respond`, { json: { status: el.dataset.status } }); caseDone('Review started. The sender is told.'); } catch (e) { toast(e.message, 'error'); } };
Actions.caseMsg = async (el) => {
  if (F('case-msg', '').trim().length < 2) return toast('Write the message', 'error');
  try { await api(`/api/feedback/${el.dataset.id}/respond`, { json: { response: F('case-msg', '') } }); caseDone('Sent'); } catch (e) { toast(e.message, 'error'); }
};
Actions.caseClose = async (el) => {
  if (F('case-out', '').trim().length < 3) return toast('Write the outcome first', 'error');
  if (!(await modal({ title: 'Close this case?', message: 'The sender sees the outcome.', confirmText: 'Close the case' }))) return;
  try { await api(`/api/feedback/${el.dataset.id}/respond`, { json: { status: 'closed', outcome: F('case-out', '') } }); caseDone('Closed'); } catch (e) { toast(e.message, 'error'); }
};
Actions.caseReply = async (el) => { try { await api(`/api/feedback/${el.dataset.id}/reply`, { json: { text: F('case-msg', '') } }); caseDone('Sent'); } catch (e) { toast(e.message, 'error'); } };
Actions.trackReply = async (el) => { try { await api('/api/feedback/track', { json: { code: el.dataset.code, text: F('case-msg', '') } }); caseDone('Sent, still without your name'); } catch (e) { toast(e.message, 'error'); } };
Actions.trackName = async (el) => {
  if (!(await modal({ title: 'Add your name?', message: 'The committee will see that you sent it. This cannot be undone.', confirmText: 'Add my name' }))) return;
  try { await api('/api/feedback/track/name', { json: { code: el.dataset.code } }); forgetCode(el.dataset.code); caseDone('Your name is on it now'); } catch (e) { toast(e.message, 'error'); }
};
Actions.fbForget = (el) => { forgetCode(el.dataset.code); location.hash = '#feedback'; };

/* ------------------------------------------------ the case inbox (committee members, HR, the director) */
Views.cases = () => {
  const fb = data('feedback:all', () => api('/api/feedback'));
  const head = topbar('Committee cases', isStaff() ? '#hrdesk' : '#me');
  if (fb === null) return `${head}${spinner()}`;
  if (fb.error) return `${head}${errorBox(fb.error)}`;
  KL.ui.caseBack = '#cases';
  const st = F('cs-st', 'active');
  const cmf = F('cs-cm', '');
  const names = [...new Set(fb.rows.map((r) => r.committee).filter(Boolean))];
  const rows = fb.rows.filter((r) => (!cmf || r.committee === cmf) && (st === 'all' || (st === 'active' ? r.status !== 'closed' : r.status === st)));
  const pill = (key, v, label) => `<button type="button" data-action="csFilter" data-key="${key}" data-value="${esc(v)}" aria-pressed="${F(key, key === 'cs-st' ? 'active' : '') === v}">${esc(label)}</button>`;
  return `${head}<p class="sub">Confidential. Committee members, HR and the director see these; POSH cases only the POSH committee. People named in a case never see it.</p>
    <div class="chips pills">${pill('cs-st', 'active', `Open · ${fb.rows.filter((r) => r.status !== 'closed').length}`)}${pill('cs-st', 'closed', 'Closed')}${pill('cs-st', 'all', 'All')}</div>
    ${names.length > 1 ? `<div class="chips" style="margin-top:8px">${pill('cs-cm', '', 'Every committee')}${names.map((n) => pill('cs-cm', n, n)).join('')}</div>` : ''}
    <div style="margin-top:12px">${rows.length ? `<div class="card flush">${rows.map((r) => lrow({ href: `#case/${r.id}`, icon: r.category === 'posh' ? 'shield' : r.type === 'suggestion' ? 'sparkle' : 'chat', tone: r.category === 'posh' ? 'violet' : r.type === 'suggestion' ? 'amber' : 'red',
      title: `${r.type === 'suggestion' ? 'Suggestion' : r.category === 'posh' ? 'POSH complaint' : 'Complaint'} · ${r.user_name}`, sub: esc(`${r.ref ? `${r.ref} · ` : ''}${r.committee} · ${String(r.text).slice(0, 60)} · ${timeAgo(r.created_at)}`), right: tag(caseStatus(r.status), r.status === 'closed' ? 'ok' : r.status === 'in_progress' ? 'info' : 'warn') })).join('')}</div>` : emptyState('check', 'Nothing here', 'New cases for your committees appear here.')}</div>`;
};
Actions.csFilter = (el) => { setF(el.dataset.key, el.dataset.value); render(); };
Views.poshdesk = () => { setF('cs-cm', 'POSH Internal Committee'); return Views.cases(); };

/* ------------------------------------------------ committees: visible to everyone; HR edits */
Views.committees = () => {
  const cm = data('committees', () => api('/api/committees'));
  const head = topbar('Committees', isStaff() ? '#people' : '#me', cm && cm.canEdit ? `<a class="btn small" href="#committee/new">${ic('plus')} New</a>` : '');
  if (cm === null) return `${head}${spinner()}`;
  if (cm.error) return `${head}${errorBox(cm.error)}`;
  const card = (c) => {
    const [icon, tone] = CM_LOOK[c.key] || CM_LOOK.custom;
    const people = [...c.members.map((m) => `<span class="person-chip">${avatar(m.name, 'sm')}<span>${esc(m.name)}${m.presiding ? ' <small>· presiding</small>' : ''}</span></span>`),
      ...c.external.map((e) => `<span class="person-chip">${avatar(e.name, 'sm')}<span>${esc(e.name)} <small>· ${esc(e.role || 'external')}</small></span></span>`)].join('');
    const raise = c.key === 'ideas' ? ['suggestion', 'Send a suggestion'] : c.key === 'posh' ? ['posh', 'Make a POSH complaint'] : ['complaint', 'Make a complaint'];
    return `<div class="card stack cm-card"><div class="row" style="gap:12px"><span class="icon ${tone}">${ic(icon)}</span><span class="tx" style="flex:1;min-width:0"><b style="font-size:17px">${esc(c.name)}</b>${c.mailbox ? `<a class="muted" style="display:block;font-size:13.5px" href="mailto:${esc(c.mailbox)}">${esc(c.mailbox)}</a>` : ''}</span>${c.openCases !== undefined ? `<a class="tag info" href="#cases" data-action="csOpen" data-name="${esc(c.name)}">${c.openCases} open</a>` : ''}</div>
      <p style="margin:0">${esc(c.purpose)}</p>
      ${c.why ? `<p class="hint" style="margin:0"><b>Why it exists:</b> ${esc(c.why)}</p>` : ''}
      ${c.how ? `<p class="hint" style="margin:0"><b>How to reach it:</b> ${esc(c.how)}</p>` : ''}
      ${c.policies.length && c.key !== 'posh' ? `<div class="chips small">${c.policies.map((p) => `<span class="tag">${esc(p)}</span>`).join('')}</div>` : ''}
      <div><b style="font-size:13.5px">Members</b><div class="people-chips">${people || '<p class="hint" style="margin:4px 0 0">HR has not named the members yet. Until then HR and the director receive its cases.</p>'}</div></div>
      <div class="btns"><button type="button" class="btn primary" data-action="cmRaise" data-kind="${raise[0]}">${esc(raise[1])}</button>${c.mailbox ? `<a class="btn" href="mailto:${esc(c.mailbox)}">${ic('send')} Email</a>` : ''}${cm.canEdit ? `<a class="btn" href="#committee/${esc(c.id)}">${ic('pen')} Edit</a>` : ''}</div></div>`;
  };
  const mineCases = cm.rows.some((c) => c.openCases !== undefined);
  return `${head}<p class="sub">These committees look after complaints and ideas. Anything you send goes to one of them, with your name or without it.</p>
    ${mineCases ? `<a class="needs-card" href="#cases" style="margin-bottom:14px"><span class="nc-ic">${ic('inbox')}</span><span class="nc-tx"><b>Committee cases</b><span>For the committees you are on</span></span><span class="nc-btn">Open</span></a>` : ''}
    <div class="stack">${cm.rows.map(card).join('')}</div>
    ${group('Sexual harassment at work', poshCard(KL.cache['hr:posh'] || data('hr:posh', () => api('/api/hr/posh'))))}`;
};
Actions.cmRaise = (el) => {
  const k = el.dataset.kind;
  KL.ui.fbDone = null;
  setF('fb-type', k === 'suggestion' ? 'suggestion' : 'complaint');
  setF('fb-posh', k === 'posh');
  location.hash = '#feedback';
};
Actions.csOpen = (el) => { setF('cs-cm', el.dataset.name); setF('cs-st', 'active'); };

Views.committee = (id) => {
  const cm = data('committees', () => api('/api/committees'));
  const ppl = data('hr:people', () => api('/api/hr/people'));
  const head = topbar(id === 'new' ? 'New committee' : 'Edit committee', '#committees');
  if (cm === null || ppl === null) return `${head}${spinner()}`;
  if (cm.error || ppl.error) return `${head}${errorBox(cm.error || ppl.error)}`;
  if (!cm.canEdit) return `${head}${emptyState('shield', 'Only HR and the director can change committees')}`;
  const c = cm.rows.find((x) => x.id === id) || { name: '', purpose: '', why: '', how: '', mailbox: '', policies: [], external: [], members: [] };
  const key = `cme:${id}`;
  if (KL.ui.cmInit !== key) {
    KL.ui.cmInit = key;
    for (const f of ['name', 'purpose', 'why', 'how', 'mailbox']) setF(`cm-${f}`, c[f] || '');
    setF('cm-policies', c.policies.join('\n'));
    KL.ui.cmMembers = c.members.map((m) => m.id);
    setF('cm-pres', (c.members.find((m) => m.presiding) || {}).id || '');
    c.external.slice(0, 3).forEach((e, i) => { setF(`cm-ex${i}-name`, e.name); setF(`cm-ex${i}-role`, e.role); setF(`cm-ex${i}-phone`, e.phone); });
    for (let i = c.external.length; i < 3; i += 1) clearF(`cm-ex${i}-name`, `cm-ex${i}-role`, `cm-ex${i}-phone`);
  }
  const active = ppl.rows.filter((u) => u.active);
  const sel = KL.ui.cmMembers || [];
  const chosen = sel.map((uid) => active.find((u) => u.id === uid)).filter(Boolean);
  return `${head}<div class="card stack">
      ${field('Name', input('cm-name', F('cm-name')), { required: true })}
      ${field('What it does', textarea('cm-purpose', F('cm-purpose'), 'One or two lines everyone understands'))}
      ${field('Why it exists', textarea('cm-why', F('cm-why'), 'The law or the reason'))}
      ${field('How to reach it', textarea('cm-how', F('cm-how'), 'How someone raises a complaint or idea'))}
      ${field('Mailbox', input('cm-mailbox', F('cm-mailbox'), { type: 'email', placeholder: 'committee@sajeevan.co.in' }))}
      ${c.key === 'posh' || c.key === 'ideas' ? '' : field('Policies it handles (one per line)', textarea('cm-policies', F('cm-policies'), 'Code of conduct'))}
    </div>
    ${group('Members', `<div class="card stack">${chosen.length ? `<div class="people-chips">${chosen.map((u) => `<span class="person-chip">${avatar(u.name, 'sm')}<span>${esc(u.name)}</span><button type="button" class="x" aria-label="Remove ${esc(u.name)}" data-action="cmDel" data-id="${esc(u.id)}">${ic('x')}</button></span>`).join('')}</div>` : '<p class="hint">No members yet.</p>'}
      ${field('Add a member', `<select class="select" data-change="cmAdd"><option value="">Choose a person</option>${active.filter((u) => !sel.includes(u.id)).map((u) => `<option value="${esc(u.id)}">${esc(u.name)} · ${esc(u.designation || '')}</option>`).join('')}</select>`)}
      ${chosen.length ? field('Presiding member', select('cm-pres', F('cm-pres', ''), chosen.map((u) => [u.id, u.name]), { blank: 'None' })) : ''}
      ${c.key === 'posh' ? '<p class="hint">The law: a senior woman presides, at least half the members are women, and one member is from an NGO or a lawyer (an external member, below).</p>' : ''}</div>`)}
    ${group('External members (optional)', `<div class="card stack">${[0, 1, 2].map((i) => `<div class="grid3">${input(`cm-ex${i}-name`, F(`cm-ex${i}-name`), { placeholder: 'Name' })}${input(`cm-ex${i}-role`, F(`cm-ex${i}-role`), { placeholder: 'Role, e.g. NGO member' })}${input(`cm-ex${i}-phone`, F(`cm-ex${i}-phone`), { placeholder: 'Phone', inputmode: 'tel' })}</div>`).join('')}</div>`)}
    <button type="button" class="btn primary wide xl" data-action="cmSave" data-id="${esc(id === 'new' ? '' : id)}" style="margin-top:14px">Save committee</button>`;
};
Changes.cmAdd = (el) => { if (el.value) { KL.ui.cmMembers = [...(KL.ui.cmMembers || []), el.value]; render(); } };
Actions.cmDel = (el) => { KL.ui.cmMembers = (KL.ui.cmMembers || []).filter((x) => x !== el.dataset.id); if (F('cm-pres') === el.dataset.id) setF('cm-pres', ''); render(); };
Actions.cmSave = async (el) => {
  const body = { id: el.dataset.id, name: F('cm-name', ''), purpose: F('cm-purpose', ''), why: F('cm-why', ''), how: F('cm-how', ''), mailbox: F('cm-mailbox', ''),
    policies: F('cm-policies', ''), members: KL.ui.cmMembers || [], presiding: F('cm-pres', ''),
    external: [0, 1, 2].map((i) => ({ name: F(`cm-ex${i}-name`, ''), role: F(`cm-ex${i}-role`, ''), phone: F(`cm-ex${i}-phone`, '') })) };
  try { await api('/api/committees', { json: body }); KL.ui.cmInit = null; invalidate('committees', 'hr:posh', 'feedback'); toast('Saved'); location.hash = '#committees'; } catch (e) { toast(e.message, 'error'); }
};
