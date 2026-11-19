/* Case timeline for incidents, complaints / suggestions and escalations, and Direct escalation (owner 2026-11-20).
   Opened -> Investigation (who: people assigned, or "Committee review - <committee>") -> Closed (conclusion and action
   taken). A report is never edited: corrections are dated notes. After closing only "Reopen" with a reason. */

const TRK_STATUS = { open: ['Open', 'warn'], investigating: ['Under investigation', 'info'], closed: ['Closed', 'ok'] };
const TRK_STAGE = { opened: ['Opened', 'violet', 'flag'], investigation: ['Investigation', 'amber', 'search'], note: ['Note', '', 'note'],
  closed: ['Closed', '', 'check'], reopened: ['Reopened', 'red', 'refresh'] };

/** The timeline block for a case (fetched); `ro` = a ready timeline object (the anonymous sender's view). */
function caseTrack(ck, id, ro = null) {
  // fresh each time the page is opened: others start, note and close it
  if (!ro && KL.ui.trkOpen !== `${location.hash}|${ck}:${id}`) { KL.ui.trkOpen = `${location.hash}|${ck}:${id}`; delete KL.cache[`track:${ck}:${id}`]; }
  const t = ro || data(`track:${ck}:${id}`, () => api(`/api/track/${ck}/${id}`));
  if (t === null) return group('Timeline', spinner());
  if (t.error) return group('Timeline', errorBox(t.error));
  const [stLabel, stTone] = TRK_STATUS[t.status] || [t.status, ''];
  const head = `<div class="row between" style="gap:8px;flex-wrap:wrap">${tag(stLabel, stTone)}<span class="hint" style="margin:0">${t.ref ? `<b class="mono">${esc(t.ref)}</b> · ` : ''}${t.status === 'closed' ? `closed after ${t.days} day${t.days === 1 ? '' : 's'}` : `open ${t.days} day${t.days === 1 ? '' : 's'}`}${t.overdue ? ' · <b style="color:var(--danger)">overdue</b>' : ''}</span></div>
    ${t.investigatedBy ? `<p class="hint" style="margin:0">Investigated by: <b>${esc(t.investigatedBy)}</b></p>` : ''}`;
  const evs = t.items.map((e) => {
    const [label, tone] = TRK_STAGE[e.stage] || [e.stage, ''];
    const title = e.stage === 'note' && e.fromReporter ? 'Note from the reporter' : label;
    return `<div class="ev ${tone}"><b>${esc(title)}</b><small>${esc(e.by)}${e.actual ? ` <span class="mono">(${esc(e.actual)}, seen only by you)</span>` : ''}${e.at ? ` · ${esc(fmtDate(e.at))}` : ''}</small>${e.text ? `<p class="trk-text">${esc(e.text)}</p>` : ''}</div>`;
  }).join('');
  const closed = t.status === 'closed' && (t.conclusion || t.action) ? `<div class="trk-closed"><div><small>Conclusion</small><p>${esc(t.conclusion || '—')}</p></div><div><small>Action taken</small><p>${esc(t.action || '—')}</p></div></div>` : '';
  let btns = '';
  if (!ro && t.canHandle) {
    const a = (act, icon, label, cls = '') => `<button type="button" class="btn ${cls}" data-action="${act}" data-ck="${esc(ck)}" data-id="${esc(id)}" data-committee="${esc(t.committee || '')}">${ic(icon)} ${esc(label)}</button>`;
    btns = t.status === 'open' ? a('trkStart', 'play', t.committee ? 'Start committee review' : 'Start investigation', 'primary')
      : t.status === 'investigating' ? `${a('trkNote', 'note', 'Add a note')}${a('trkClose', 'check', 'Close with conclusion', 'primary')}`
        : a('trkReopen', 'refresh', 'Reopen with a reason');
  } else if (!ro && t.canNote) btns = `<button type="button" class="btn" data-action="trkNote" data-ck="${esc(ck)}" data-id="${esc(id)}">${ic('note')} Add a note or correction</button>`;
  return group('Timeline', `<div class="card stack">${head}<div class="tl">${evs}</div>${closed}${btns ? `<div class="btns" style="flex-wrap:wrap">${btns}</div>` : ''}
    ${t.locked ? '<p class="hint" style="margin:0">Closed: the conclusion and action are locked. Reopening needs a reason and is kept on the timeline.</p>' : ''}</div>`);
}
const trkDone = (ck, msg) => { invalidate('track', `m:${ck}`, 'case', 'feedback', 'esc', 'registers', 'dashboard', 'hr'); toast(msg); render(); };

Actions.trkStart = async (el) => {
  const { ck, id } = el.dataset;
  let investigators = [];
  if (el.dataset.committee) {
    if (!(await modal({ title: 'Start the committee review?', message: `The timeline shows "Committee review · ${el.dataset.committee}", not any one person.`, confirmText: 'Start' }))) return;
  } else {
    KL.ui.trkInv = new Set();
    const people = (KL.boot.people || []).filter((p) => p.role !== 'field' || p.id === KL.user.id).concat((KL.boot.people || []).filter((p) => p.role === 'field' && p.id !== KL.user.id));
    const ok = await modal({ title: 'Who investigates it?', message: 'Choose one or more. They are told, can open it and add notes, and their names are on the timeline.', wide: true, confirmText: 'Start investigation',
      html: `<div class="trk-pick">${people.map((p) => `<label class="check"><input type="checkbox" data-change="trkInv" data-id="${esc(p.id)}" /> <span>${esc(p.name)}<small class="muted"> · ${esc(p.designation || ROLE_TEXT[p.role] || '')}</small></span></label>`).join('')}</div>` });
    if (!ok) return;
    investigators = [...KL.ui.trkInv];
    if (!investigators.length) return toast('Choose who investigates it', 'error');
  }
  try { await api(`/api/track/${ck}/${id}/start`, { json: { investigators } }); trkDone(ck, 'Investigation started. They are told.'); } catch (e) { toast(e.message, 'error'); }
};
Changes.trkInv = (el) => { KL.ui.trkInv = KL.ui.trkInv || new Set(); if (el.checked) KL.ui.trkInv.add(el.dataset.id); else KL.ui.trkInv.delete(el.dataset.id); };
Actions.trkNote = async (el) => {
  const v = await modal({ title: 'Add a note', message: 'Dated and kept on the timeline. The report itself stays as it was sent.', fields: [{ key: 'text', label: 'Note', type: 'textarea' }], confirmText: 'Add note' });
  if (!v) return;
  try { await api(`/api/track/${el.dataset.ck}/${el.dataset.id}/note`, { json: { text: v.text } }); trkDone(el.dataset.ck, 'Note added'); } catch (e) { toast(e.message, 'error'); }
};
Actions.trkClose = async (el) => {
  const v = await modal({ title: 'Close with the conclusion', message: 'Both are required and are locked once closed. The person who reported it sees them.',
    fields: [{ key: 'conclusion', label: 'Conclusion: what was found (the root cause)', type: 'textarea' }, { key: 'action', label: 'Action taken', type: 'textarea' }], confirmText: 'Close it' });
  if (!v) return;
  try { await api(`/api/track/${el.dataset.ck}/${el.dataset.id}/close`, { json: v }); trkDone(el.dataset.ck, 'Closed'); } catch (e) { toast(e.message, 'error'); }
};
Actions.trkReopen = async (el) => {
  const v = await modal({ title: 'Reopen with a reason', message: 'The reason is kept on the timeline; the earlier conclusion stays on record.', fields: [{ key: 'reason', label: 'Why reopen it', type: 'textarea' }], confirmText: 'Reopen', danger: true });
  if (!v) return;
  try { await api(`/api/track/${el.dataset.ck}/${el.dataset.id}/reopen`, { json: v }); trkDone(el.dataset.ck, 'Reopened'); } catch (e) { toast(e.message, 'error'); }
};

/** Cases open 7 days or more that this person handles (HR desk, committee cases). */
function overdueBanner() {
  const o = data('track:overdue', () => api('/api/track'));
  if (!o || o.error || !o.rows.length) return '';
  const href = (x) => ({ incident: `#rec/incident/${x.id}`, feedback: `#case/${x.id}`, escalation: `#esc/${x.id}` }[x.kind]);
  return `<div class="banner bad" style="margin-bottom:12px">${ic('clock')}<div><b>${o.rows.length} open ${OVERDUE_DAYS_TXT}</b><p>${o.rows.slice(0, 5).map((x) => `<a href="${href(x)}">${esc(x.ref || x.title)}</a> · ${x.days} days`).join('<br>')}${o.rows.length > 5 ? '<br>…' : ''}</p></div></div>`;
}
const OVERDUE_DAYS_TXT = 'for 7 days or more';

/* ------------------------------------------------ Direct escalation */
const waLink = (p) => `https://wa.me/${String(p).replace(/\D/g, '').replace(/^0+/, '').replace(/^(\d{10})$/, '91$1')}`;
Views.escalate = () => {
  const d = data('esc:page', () => api('/api/escalation'));
  const head = topbar('Direct escalation', isStaff() ? '#home' : '#me', d && !d.error && d.canEdit ? `<a class="btn small" href="#esccontacts">${ic('pen')} Contacts</a>` : '');
  if (d === null) return `${head}${spinner()}`;
  if (d.error) return `${head}${errorBox(d.error)}`;
  const card = (c) => `<div class="card stack esc-card"><div><b style="font-size:17px">${esc(c.name)}</b>${c.role ? `<p class="hint" style="margin:2px 0 0">${esc(c.role)}</p>` : ''}</div>
    ${c.matters?.length ? `<div class="chips">${c.matters.map((m) => tag(m, 'warn')).join('')}</div>` : ''}
    <div class="btns" style="flex-wrap:wrap">${c.phone ? `<a class="btn primary" href="tel:${esc(c.phone)}">${ic('bell')} Call</a>` : ''}${c.phone && c.whatsapp ? `<a class="btn" href="${esc(waLink(c.phone))}" target="_blank" rel="noopener">${ic('chat')} WhatsApp</a>` : ''}${c.email ? `<a class="btn" href="mailto:${esc(c.email)}">${ic('send')} Email</a>` : ''}</div></div>`;
  const row = (e, hrefMine) => lrow({ href: `#esc/${e.id}`, icon: 'alert', tone: e.status === 'closed' ? 'green' : 'red', title: `${e.matter}${hrefMine ? '' : ` · from ${e.by}`}`,
    sub: esc(`${e.ref || ''} · to ${e.to} · ${TRK_STATUS[e.status]?.[0] || e.status} · ${e.days} day${e.days === 1 ? '' : 's'}`) });
  if (!F('esc-contact')) setF('esc-contact', d.contacts[0]?.id || '');
  return `${head}<div class="banner warn">${ic('alert')}<div><b>For serious matters only</b><p>Money or fraud, safety, a compliance violation, a commitment to a client, or anything as serious. Go straight to these people, outside the usual chain.</p></div></div>
    ${d.contacts.length ? `<div class="stack" style="margin-top:12px">${d.contacts.map(card).join('')}</div>` : `<div style="margin-top:12px">${emptyState('users', 'No contacts yet', d.canEdit ? 'Add them with Contacts at the top.' : 'HR adds them.')}</div>`}
    ${d.contacts.length ? group('Record it in the app (optional)', `<div class="card stack"><p class="hint" style="margin:0">It goes straight to that person and the director, gets a reference number and a timeline, and you can follow it here.</p>
      ${pills('What is it about', 'esc-matter', F('esc-matter', ''), d.matters.map((m) => [m, m]))}
      ${field('Goes to', select('esc-contact', F('esc-contact'), d.contacts.map((c) => [c.id, `${c.name}${c.role ? ` · ${c.role}` : ''}`])))}
      ${field('What happened', textarea('esc-text', F('esc-text'), 'Facts: what, where, when, who, how much'))}
      <button type="button" class="btn primary wide" data-action="escSend">${ic('send')} Send the escalation</button></div>`) : ''}
    ${d.forMe.length ? group(`Sent to me · ${d.forMe.length}`, `<div class="card flush">${d.forMe.map((e) => row(e, false)).join('')}</div>`) : ''}
    ${d.mine.length ? group('My escalations', `<div class="card flush">${d.mine.map((e) => row(e, true)).join('')}</div>`) : ''}`;
};
Actions.escSend = async (el) => {
  if (!F('esc-matter')) return toast('Choose what it is about', 'error');
  try {
    const r = await api('/api/escalation', { json: { matter: F('esc-matter'), contact: F('esc-contact'), text: F('esc-text', '') } });
    clearF('esc-matter', 'esc-text'); invalidate('esc'); toast(`Sent · ${r.ref || ''}`); location.hash = `#esc/${r.id}`;
  } catch (e) { el.classList.remove('busy'); toast(e.message, 'error'); }
};
Views.esc = (id) => {
  const e = data(`esc:${id}`, () => api(`/api/escalation/${id}`));
  const head = topbar('Escalation', '#escalate');
  if (e === null) return `${head}${spinner()}`;
  if (e.error) return `${head}${errorBox(e.error)}`;
  return `${head}<div class="card stack"><div class="row between"><b style="font-size:18px">${esc(e.matter)}</b>${tag((TRK_STATUS[e.status] || [e.status])[0], (TRK_STATUS[e.status] || [])[1])}</div>
      <p class="case-text">${esc(e.text)}</p>
      <div class="case-facts"><span>Reference: <b>${esc(e.ref || '')}</b></span><span>From: <b>${esc(e.by)}</b></span><span>To: <b>${esc(e.to)}</b></span><span>Sent: <b>${esc(fmtDate(e.created_at))}</b></span></div>
      ${e.contact ? `<div class="btns" style="flex-wrap:wrap">${e.contact.phone ? `<a class="btn" href="tel:${esc(e.contact.phone)}">${ic('bell')} Call ${esc(firstName(e.contact.name))}</a>` : ''}${e.contact.phone && e.contact.whatsapp ? `<a class="btn" href="${esc(waLink(e.contact.phone))}" target="_blank" rel="noopener">${ic('chat')} WhatsApp</a>` : ''}</div>` : ''}</div>
    ${caseTrack('escalation', id)}`;
};

/* ------------------------------------------------ Settings: escalation contacts (HR, director) */
Views.esccontacts = () => {
  const d = data('esc:page', () => api('/api/escalation'));
  const head = topbar('Escalation contacts', '#escalate');
  if (d === null) return `${head}${spinner()}`;
  if (d.error) return `${head}${errorBox(d.error)}`;
  if (!d.canEdit) return `${head}<div class="card"><p class="empty">HR and the director keep this list.</p></div>`;
  if (!KL.ui.escEdit) KL.ui.escEdit = d.contacts.map((c) => ({ ...c, matters: [...(c.matters || [])] }));
  const list = KL.ui.escEdit;
  const people = KL.boot.people || [];
  const box = (c, i) => `<div class="card stack"><div class="row between"><b>Contact ${i + 1}</b><button type="button" class="btn small ghost" data-action="escDel" data-i="${i}">${ic('trash')} Remove</button></div>
    <div class="grid2">${field('Name', `<input class="input" value="${esc(c.name || '')}" data-input="escField" data-i="${i}" data-k="name" />`)}${field('Role', `<input class="input" value="${esc(c.role || '')}" data-input="escField" data-i="${i}" data-k="role" placeholder="e.g. Director, Finance head" />`)}
    ${field('Phone', `<input class="input" inputmode="tel" value="${esc(c.phone || '')}" data-input="escField" data-i="${i}" data-k="phone" placeholder="+91 98250 00000" />`)}${field('Email', `<input class="input" inputmode="email" value="${esc(c.email || '')}" data-input="escField" data-i="${i}" data-k="email" />`)}</div>
    <label class="check"><input type="checkbox" ${c.whatsapp !== false ? 'checked' : ''} data-change="escWa" data-i="${i}" /> <span>Show a WhatsApp button</span></label>
    ${field('Their account in the app (optional)', `<select class="select" data-change="escUser" data-i="${i}"><option value="">Not in the app</option>${people.map((p) => `<option value="${esc(p.id)}" ${p.id === c.user_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`, { help: 'Escalations recorded in the app reach them here too.' })}
    <div class="field"><span>Matters they handle</span><div class="chips pills">${d.matters.map((m) => `<button type="button" data-action="escMatter" data-i="${i}" data-m="${esc(m)}" aria-pressed="${(c.matters || []).includes(m)}">${esc(m)}</button>`).join('')}</div></div></div>`;
  return `${head}<p class="sub">Important people anyone can call or message directly when a matter is severe. Everyone sees this list under Me › Direct escalation.</p>
    <div class="stack">${list.map(box).join('')}</div>
    <div class="btns" style="margin:14px 0 30px"><button type="button" class="btn" data-action="escAdd">${ic('plus')} Add a contact</button><button type="button" class="btn primary" data-action="escSave">Save the list</button></div>`;
};
Inputs.escField = (el) => { KL.ui.escEdit[Number(el.dataset.i)][el.dataset.k] = el.value; };
Changes.escWa = (el) => { KL.ui.escEdit[Number(el.dataset.i)].whatsapp = el.checked; };
Changes.escUser = (el) => { KL.ui.escEdit[Number(el.dataset.i)].user_id = el.value || null; };
Actions.escMatter = (el) => { const c = KL.ui.escEdit[Number(el.dataset.i)]; const s = new Set(c.matters || []); if (s.has(el.dataset.m)) s.delete(el.dataset.m); else s.add(el.dataset.m); c.matters = [...s]; render(); };
Actions.escAdd = () => { KL.ui.escEdit.push({ name: '', role: '', phone: '', email: '', whatsapp: true, matters: [] }); render(); };
Actions.escDel = (el) => { KL.ui.escEdit.splice(Number(el.dataset.i), 1); render(); };
Actions.escSave = async (el) => {
  try { await api('/api/escalation/contacts', { json: { contacts: KL.ui.escEdit } }); KL.ui.escEdit = null; invalidate('esc'); toast('Saved'); location.hash = '#escalate'; } catch (e) { el.classList.remove('busy'); toast(e.message, 'error'); }
};
