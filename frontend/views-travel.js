/* Travel plans and the fuel check (owner 2026-11-20, "Release 2"). A manager plans a person's day or week (sites in
   order); the trip's odometer km is compared with the planned road km. Odometer and fuel-bill photos are read by the
   server; the number is filled in and the person types it only when the reading is unsure. Over the limit (Settings,
   default 15%): flagged for the approver and the director is told. */

const mayPlanTravel = () => ['admin', 'manager', 'hr'].includes(KL.user?.role);

/* ------------------------------------------------ reading the photo as soon as it is taken */
KL.ui.read = KL.ui.read || {};
async function readPhoto(slot, blob, kind, near) {
  if (!navigator.onLine) { KL.ui.read[slot] = { offline: true }; render(); return null; }
  KL.ui.read[slot] = { busy: true }; render();
  try {
    const form = new FormData();
    form.append('photo', blob, 'photo.jpg'); form.append('kind', kind);
    if (near !== undefined && near !== null) form.append('near', String(near));
    const r = await api('/api/ocr/read', { form, timeout: 30000 });
    KL.ui.read[slot] = r; return r;
  } catch { KL.ui.read[slot] = { failed: true }; return null; } finally { render(); }
}
KL.onPhoto = KL.onPhoto || {};
KL.onPhoto.tripStart = async (blob) => { const r = await readPhoto('tripStart', blob, 'odometer'); if (r?.sure) { setF('trip-reading', String(r.value)); render(); } };
KL.onPhoto.tripEnd = async (blob) => { const r = await readPhoto('tripEnd', blob, 'odometer', KL.me?.openTrip?.start_reading); if (r?.sure) { setF('trip-end-reading', String(r.value)); render(); } };
KL.onPhoto['rec-expense'] = async (blob) => {
  if (F('rf-expense-category', '') !== 'Fuel') return;
  const r = await readPhoto('rec-expense', blob, 'fuel');
  if (r?.sure) { setF('rf-expense-litres', String(r.litres)); setF('rf-expense-rate', String(r.rate)); setF('rf-expense-amount', String(r.amount)); render(); }
};
/** Under a reading: read from the photo (check it), or please type it. */
function readHint(slot) {
  const r = KL.ui.read[slot];
  if (!r) return '<p class="hint" style="margin:0">Take the photo first: the app reads the number for you.</p>';
  if (r.busy) return '<p class="hint" style="margin:0">Reading the photo…</p>';
  if (r.sure) return `<p class="hint ok-text" style="margin:0">${ic('check')} Read from the photo. Check it matches.</p>`;
  return `<p class="hint" style="margin:0">${r.offline ? 'No signal to read the photo:' : 'The photo is hard to read:'} type the number.</p>`;
}

/* ------------------------------------------------ the day's plan, on the Travel screen */
function todayPlanCard() {
  const d = data('tplan:mine', () => api('/api/travelplans'));
  if (!d || d.error) return '';
  const today = todayISO();
  const p = d.rows.find((x) => x.date === today);
  const next = d.rows.filter((x) => x.date > today).slice(0, 3);
  if (!p && !next.length) return '';
  const line = (x) => `<b>${esc(x.route.join(' → '))}</b><span class="muted" style="display:block;font-size:13px">about ${fmtNum(x.planned_km, 1)} km planned${x.done_km !== null && x.done_km !== undefined ? ` · ${fmtNum(x.done_km, 1)} km on the odometer` : ''}${x.note ? ` · ${esc(x.note)}` : ''}</span>`;
  return `<div class="card stack" style="margin-bottom:12px">${p ? `<div><span class="tag info">Today's travel plan</span><p style="margin:6px 0 0">${line(p)}</p></div>` : ''}
    ${next.length ? `<div class="stack" style="gap:6px">${next.map((x) => `<p style="margin:0"><span class="muted">${esc(fmtDate(x.date, false))}:</span> ${esc(x.route.join(' → '))}</p>`).join('')}</div>` : ''}</div>`;
}
const tripFlags = (t) => ((t.flags || []).length ? `<span class="trip-flag">${ic('alert')} ${esc(t.flags.join(' · '))}</span>` : '');

/* ------------------------------------------------ managers: travel plans */
Views.travelplans = () => {
  if (!mayPlanTravel()) return `${topbar('Travel plans', '#home')}<div class="card"><p class="empty">Managers plan travel.</p></div>`;
  const d = data('tplan:team', () => api('/api/travelplans?scope=team'));
  const head = topbar('Travel plans', '#home', '<a class="btn small primary" href="#travelplan">+ Plan</a>');
  if (d === null) return `${head}${spinner()}`;
  if (d.error) return `${head}${errorBox(d.error)}`;
  const days = [...new Set(d.rows.map((x) => x.date))];
  return `${head}<p class="sub">Plan who goes where, for a day or a week. Each trip is compared with its plan: more than ${esc(String(KL.boot?.travelFuel?.limitPct || 15))}% over is flagged and the director is told.</p>
    ${days.length ? days.map((day) => group(fmtDate(day, false), `<div class="card flush">${d.rows.filter((x) => x.date === day).map((x) => `<div class="lrow-static row" style="gap:12px">${avatar(x.user_name)}<span class="tx" style="flex:1;min-width:0"><b>${esc(x.user_name)}</b><span class="muted" style="font-size:13px;display:block">${esc(x.route.join(' → '))} · ${fmtNum(x.planned_km, 1)} km planned${x.done_km !== null && x.done_km !== undefined ? ` · <b>${fmtNum(x.done_km, 1)} km driven</b>` : ''}</span></span><button type="button" class="btn small ghost" data-action="tplanDel" data-id="${esc(x.id)}" aria-label="Remove">${ic('trash')}</button></div>`).join('')}</div>`)).join('')
      : emptyState('bike', 'No travel plans yet', 'Plan a person\'s day or week with + Plan.')}`;
};
Actions.tplanDel = async (el) => {
  if (!(await modal({ title: 'Remove this day\'s plan?', confirmText: 'Remove', danger: true }))) return;
  try { await api(`/api/travelplans/${el.dataset.id}/delete`, { json: {} }); invalidate('tplan'); render(); } catch (e) { toast(e.message, 'error'); }
};
Views.travelplan = () => {
  const head = topbar('New travel plan', '#travelplans');
  if (!mayPlanTravel()) return `${head}<div class="card"><p class="empty">Managers plan travel.</p></div>`;
  const people = (KL.boot.people || []).filter((p) => p.role !== 'admin');
  const sites = (KL.boot.sites || []).filter((s) => s.active !== 0);
  const stops = F('tp-stops', []);
  const est = KL.ui.tpEst;
  const chip = (s) => `<button type="button" data-action="tpStop" data-id="${esc(s.id)}" aria-pressed="${stops.includes(s.id)}">${stops.includes(s.id) ? `${stops.indexOf(s.id) + 1}. ` : ''}${esc(s.name)}${s.fenced === 0 ? ' (no location)' : ''}</button>`;
  return `${head}<div class="card stack">
      ${field('Who travels', select('tp-user', F('tp-user', ''), people.map((p) => [p.id, `${p.name} · ${p.designation || ''}`]), { blank: 'Choose' }))}
      <div class="grid2">${field('From', input('tp-from', F('tp-from', todayISO()), { type: 'date' }))}${field('To (for a week)', input('tp-to', F('tp-to', ''), { type: 'date' }))}</div>
      ${field('Starts from', select('tp-start', F('tp-start', ''), sites.map((s) => [s.id, s.name]), { blank: 'Choose (office or site)' }))}
      <div class="field"><span>Sites to visit, in order (tap in the order they go)</span><div class="chips pills">${sites.map(chip).join('')}</div></div>
      <label class="check"><input type="checkbox" ${F('tp-back', true) ? 'checked' : ''} data-change="tpBack" /> <span>Back to the start at the end of the day</span></label>
      ${field('Note (optional)', input('tp-note', F('tp-note', ''), { placeholder: 'e.g. Collect biomass bills at Deesa' }))}
      <div class="btns"><button type="button" class="btn" data-action="tpEstimate">${ic('map')} Work out the distance</button></div>
      ${est ? `<div class="banner info"><div><b>About ${fmtNum(est.km, 1)} km a day</b><p>${esc(est.how)}</p></div></div>` : ''}
      <button type="button" class="btn primary wide" data-action="tpSave">Save the plan</button>
      <p class="hint" style="margin:0">With a "To" date, every working day in between gets the same plan (up to two weeks). The person is told.</p></div>`;
};
Actions.tpStop = (el) => { const s = [...F('tp-stops', [])]; const i = s.indexOf(el.dataset.id); if (i >= 0) s.splice(i, 1); else s.push(el.dataset.id); setF('tp-stops', s); KL.ui.tpEst = null; render(); };
Changes.tpBack = (el) => { setF('tp-back', el.checked); KL.ui.tpEst = null; };
Actions.tpEstimate = async () => {
  try { KL.ui.tpEst = await api(`/api/travelplans/estimate?stops=${encodeURIComponent(F('tp-stops', []).join(','))}&startSite=${encodeURIComponent(F('tp-start', ''))}&back=${F('tp-back', true) ? 1 : 0}`); render(); } catch (e) { toast(e.message, 'error'); }
};
Actions.tpSave = async (el) => {
  try {
    const r = await api('/api/travelplans', { json: { userId: F('tp-user', ''), from: F('tp-from', todayISO()), to: F('tp-to', '') || F('tp-from', todayISO()), startSite: F('tp-start', ''), stops: F('tp-stops', []), returnToStart: F('tp-back', true), note: F('tp-note', '') } });
    clearF('tp-user', 'tp-to', 'tp-stops', 'tp-note'); KL.ui.tpEst = null; invalidate('tplan');
    toast(`Saved: ${r.ids.length} day${r.ids.length === 1 ? '' : 's'}, about ${fmtNum(r.plannedKm, 1)} km a day`); location.hash = '#travelplans';
  } catch (e) { el.classList.remove('busy'); toast(e.message, 'error'); }
};

/* ------------------------------------------------ Settings: travel & fuel */
Views.travelfuel = () => {
  const d = data('tfuel:settings', () => api('/api/travelfuel/settings'));
  const head = topbar('Travel & fuel', '#settings');
  if (d === null) return `${head}${spinner()}`;
  if (d.error) return `${head}${errorBox(d.error)}`;
  if (!KL.ui.tfInit) { KL.ui.tfInit = true; setF('tf-limit', String(d.limitPct)); d.vehicles.forEach((v, i) => { setF(`tf-fuel-${i}`, v.fuel || ''); setF(`tf-mil-${i}`, v.mileage ? String(v.mileage) : ''); }); }
  return `${head}<p class="sub">Used to check trips against their plans and fuel bills against the distance travelled. Add or rename vehicles in Settings › Lists › Vehicles.</p>
    <div class="card stack">${field('Flag when more than (%) over', input('tf-limit', F('tf-limit'), { type: 'number', inputmode: 'decimal', min: 1 }), { help: 'Odometer km against planned km, and fuel bought against fuel needed. The director is told.' })}</div>
    ${group('Vehicles', `<div class="card stack">${d.vehicles.length ? d.vehicles.map((v, i) => `<div class="grid2 tf-row"><div><b>${esc(v.name)}</b><span class="muted" style="display:block;font-size:13px">${esc(KL.boot?.travel?.currency || '₹')}${esc(String(v.rate))}/km</span></div><div class="grid2">${select(`tf-fuel-${i}`, F(`tf-fuel-${i}`), d.fuels.map((f) => [f, f]), { blank: 'Fuel' })}${input(`tf-mil-${i}`, F(`tf-mil-${i}`), { type: 'number', inputmode: 'decimal', placeholder: 'km per litre' })}</div></div>`).join('') : '<p class="empty">No vehicles yet.</p>'}</div>`)}
    ${d.canEdit ? `<button type="button" class="btn primary wide" style="margin:14px 0 30px" data-action="tfSave">Save</button>` : ''}`;
};
Actions.tfSave = async (el) => {
  const d = KL.cache['tfuel:settings'];
  try {
    await api('/api/travelfuel/settings', { json: { limitPct: Number(F('tf-limit', '15')), vehicles: d.vehicles.map((v, i) => ({ name: v.name, fuel: F(`tf-fuel-${i}`, ''), mileage: Number(F(`tf-mil-${i}`, '0') || 0) })) } });
    KL.ui.tfInit = false; invalidate('tfuel'); await reloadBoot(); toast('Saved'); render();
  } catch (e) { el.classList.remove('busy'); toast(e.message, 'error'); }
};

/* ------------------------------------------------ Fuel check (a month) */
Views.fuelcheck = () => {
  const month = F('fc-month', todayISO().slice(0, 7));
  const d = data(`fuelcheck:${month}`, () => api(`/api/fuelcheck?month=${month}`));
  const head = topbar('Fuel check', isStaff() ? '#home' : '#me');
  const pick = field('Month', input('fc-month', month, { type: 'month' }));
  if (d === null) return `${head}${pick}${spinner()}`;
  if (d.error) return `${head}${pick}${errorBox(d.error)}`;
  return `${head}<div class="card">${pick}</div>
    <p class="sub">Km on the odometer, litres on fuel bills, and the litres that distance should need (each vehicle's mileage). Over ${esc(String(d.limitPct))}% is flagged.</p>
    ${d.rows.length ? `<div class="card flush">${d.rows.map((x) => `<div class="lrow-static row" style="gap:12px;align-items:flex-start">${avatar(x.name)}<span class="tx" style="flex:1;min-width:0"><b>${esc(x.name)}</b>
      <span class="muted" style="font-size:13px;display:block">${fmtNum(x.km, 1)} km driven${x.planned ? ` (plan ${fmtNum(x.planned, 1)})` : ''} · ${fmtNum(x.litres, 1)} L bought${x.expected ? ` · ${fmtNum(x.expected, 1)} L expected` : ''}${x.overPct !== null && x.overPct !== undefined ? ` · <b style="color:${x.overPct > d.limitPct ? 'var(--danger)' : 'inherit'}">${x.overPct > 0 ? '+' : ''}${x.overPct}%</b>` : ''}</span>
      ${x.flags.map((f) => `<a class="trip-flag" href="${f.kind === 'expense' ? `#rec/expense/${esc(f.id)}` : '#trips'}">${ic('alert')} ${esc(fmtDate(f.date, false))}: ${esc(f.text)}</a>`).join('')}</span></div>`).join('')}</div>` : emptyState('fuel', 'Nothing this month', 'Trips and fuel bills appear here.')}`;
};

/* ------------------------------------------------ an expense's fuel check, on the record */
function fuelCheckBox(r) {
  const fc = r.data?.fuel_check;
  if (!fc || r.data?.category !== 'Fuel') return '';
  const rows = [['Vehicle', fc.vehicle ? `${fc.vehicle}${fc.mileage ? ` · ${fc.mileage} km/L` : ' · mileage not set'}` : '—'], ['Since the last fuel bill', fc.since ? `${fmtDate(fc.since, false)} · ${fmtNum(fc.km || 0, 1)} km` : 'first fuel bill'],
    ['Litres expected', fc.expected_litres !== undefined ? `${fmtNum(fc.expected_litres, 1)} L` : '—'], ['Usual rate', fc.usual_rate ? `₹${fc.usual_rate}/L` : '—']];
  return group('Fuel check', `<div class="card stack">${(fc.flags || []).map((f) => `<div class="banner warn">${ic('alert')}<div><b>${esc(f)}</b></div></div>`).join('')}<div class="kv">${rows.map(([a, b]) => `<span>${esc(a)}</span><span>${esc(b)}</span>`).join('')}</div></div>`);
}
