/* Field modules: Home, site check-in / check-out, travel (odometer), site registers, farmers and signed documents. */

/* ---------------------------------------------------------------- Home */
Views.home = () => (isStaff() ? staffHome() : fieldHome());

function heroTop(extra = '') {
  const u = KL.user;
  const now = new Date();
  const greet = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening';
  return `<div class="brandline"><img class="mark" src="./icon.svg" alt="" /><span>Kshetralekha</span><a class="who" href="#me" aria-label="Me">${avatar(u.name)}</a></div>
    <h1>${esc(greet)}, ${esc(firstName(u.name))}</h1>
    <div class="meta">${esc(now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }))} · ${esc(u.designation || ROLE_TEXT[u.role] || u.role)}</div>${extra}`;
}
function quickActions(items) {
  return `<div class="qa">${items.map(([href, icon, tone, label, badge]) => `<a href="${href}"><span class="qi ${tone}">${ic(icon)}</span>${esc(label)}${badge ? `<span class="tag bad" style="padding:1px 7px;margin-top:-4px">${badge}</span>` : ''}</a>`).join('')}</div>`;
}
function fieldHome() {
  const me = KL.me || {};
  const att = me.openAttendance;
  const trip = me.openTrip;
  const upd = data('updates:mine', () => api('/api/updates?days=1'));
  const doneToday = upd && !upd.error && upd.rows.some((r) => r.date === todayISO());
  const my = data('planner:my', () => api('/api/planner/my'));
  const open = my && !my.error ? my.tasks.filter((t) => t.progress !== 'completed').sort(byDue) : [];
  const late = open.filter(isLate).length;
  const now = att
    ? `<div class="now"><div class="tx"><b>At ${esc(att.site_name)}</b><span>Since ${esc(fmtDate(att.checkin_at).split(', ')[1] || '')}${att.status === 'pending' ? ' · exception awaiting approval' : ''}</span></div><span class="timer" data-since="${esc(att.checkin_at)}">${esc(duration(att.checkin_at))}</span><a class="btn small lime" href="#attendance">Check out</a></div>`
    : `<div class="now"><div class="tx"><b>Not checked in</b><span>Take a selfie at the site to start your day</span></div><a class="btn small lime" href="#attendance">${ic('pin')} Check in</a></div>`;
  const pills = [trip ? `${ic('bike')} trip running` : '', open.length ? `${ic('kanban')} ${open.length} open task${open.length === 1 ? '' : 's'}` : '', me.unread ? `${ic('bell')} ${me.unread} new` : ''].filter(Boolean);
  const tasksBody = my === null ? spinner() : my.error ? errorBox(my.error) : open.length ? `<div class="task-grid">${open.slice(0, 4).map((t) => taskCard(t, { showPlan: true })).join('')}</div>` : emptyState('check', 'All caught up', 'No open tasks. New ones from your manager appear here.');
  return `
    <div class="hero">${heroTop(pills.length ? `<div class="pills">${pills.map((p) => `<span class="pill">${p}</span>`).join('')}</div>` : '')}${now}</div>
    ${KL.outboxCount ? `<div class="offline-bar">${KL.outboxCount} item${KL.outboxCount === 1 ? '' : 's'} saved on this phone, waiting for signal</div>` : ''}
    ${mySiteCards()}
    ${hrBanners()}
    ${quickActions([['#attendance', 'pin', '', att ? 'Check out' : 'Check in'], ['#trips', 'bike', 'blue', trip ? 'End trip' : 'Start trip'], ['#updates', 'note', '', 'Daily update'], ['#leaves', 'sun', 'amber', 'Leave'], ['#tasks', 'kanban', 'violet', 'My tasks', late || '']].slice(0, 4))}
    <div class="cols">
      ${group('My tasks', tasksBody, '', '<a href="#tasks">See all</a>')}
      ${group('Today', `<div class="stack">
        <div class="card status-card">${trip
          ? `<div class="big-ic blue">${ic('bike')}</div><div class="tx"><b>Trip in progress</b><span>${esc(trip.vehicle)} · from ${esc(fmtNum(trip.start_reading))} km · <span data-since="${esc(trip.start_at)}">${esc(duration(trip.start_at))}</span></span></div><a class="btn small primary" href="#trips">End trip</a>`
          : `<div class="big-ic off">${ic('bike')}</div><div class="tx"><b>No trip running</b><span>Photograph the odometer before you ride</span></div><a class="btn small" href="#trips">Start</a>`}</div>
        <div class="card status-card">${doneToday
          ? `<div class="big-ic">${ic('check')}</div><div class="tx"><b>Today's update sent</b><span>Your manager can see it</span></div><a class="btn small" href="#updates">Edit</a>`
          : `<div class="big-ic amber">${ic('note')}</div><div class="tx"><b>Daily work update</b><span>A few lines on what you did today</span></div><a class="btn small" href="#updates">Write</a>`}</div>
      </div>`)}
    </div>`;
}
function mySiteCards() {
  const list = (KL.boot?.mySites || []).filter((s) => s.project_type !== 'office');
  if (!list.length) return `<div class="card status-card" style="margin-top:16px"><div class="big-ic off">${ic('pin')}</div><div class="tx"><b>No site assigned</b><span>You can use HR, tasks and your inbox. HR adds you to a site when you work at one.</span></div></div>`;
  const pm = KL.boot.projects || {};
  return `<div class="my-sites">${list.map((s) => { const p = pm[s.project_type] || {}; const tabs = (SITE_TABS[s.project_type] || SITE_TABS.agroforestry)(s).slice(1, 4); return `<div class="my-site pj-${esc(s.project_type)}"><a class="ms-head" href="#site/${esc(s.id)}"><span class="pj-ic">${ic(p.icon || 'pin')}</span><span class="tx"><b>${esc(s.name)}</b><small>${esc(p.name || '')}${subtypeText(s) ? ` · ${esc(subtypeText(s))}` : ''}</small></span><span class="chev">${ic('chevron')}</span></a><div class="ms-tabs">${tabs.map(([k, icon, label]) => `<a href="#site/${esc(s.id)}/${k}">${ic(icon)}${esc(label)}</a>`).join('')}</div></div>`; }).join('')}</div>`;
}
function staffHome() {
  const me = KL.me || {};
  const d = data('dashboard', () => api('/api/dashboard'));
  const pend = me.pendingApprovals || 0;
  const ok = d && !d.error;
  const now = pend
    ? `<div class="now"><div class="tx"><b>${pend} waiting for you</b><span>Travel claims, check-in exceptions and leave</span></div><a class="btn small lime" href="#approvals">Review</a></div>`
    : `<div class="now"><div class="tx"><b>No approvals waiting</b><span>${ok ? `${d.todayAttendance} of ${d.fieldTotal} field staff checked in today` : 'Everything is up to date'}</span></div><a class="btn small lime" href="#planner">${ic('kanban')} Planner</a></div>`;
  const pills = ok ? [`${ic('pin')} ${d.onSite.length} on site now`, `${ic('kanban')} ${d.tasks.total - d.tasks.done} open tasks`, d.tasks.late ? `${ic('alert')} ${d.tasks.late} late` : ''].filter(Boolean) : [];
  return `
    <div class="hero">${heroTop(pills.length ? `<div class="pills">${pills.map((p) => `<span class="pill">${p}</span>`).join('')}</div>` : '')}${now}</div>
    ${hrBanners()}
    ${quickActions([['#sites', 'pin', 'green', 'Sites'], ['#approvals', 'check', 'amber', 'Approvals', pend || ''], ['#hr', 'users', 'blue', 'People'], ['#planner', 'kanban', 'violet', 'Planner'], ['#team', 'clock', '', 'Team today'], ['#reports', 'chart', 'earth', 'Reports'], ['#map', 'map', 'green', 'Map'], ['#admin', 'cog', '', 'Admin']])}
    ${Views.dashboardBody()}`;
}

function workRows() {
  const sites = KL.boot ? KL.boot.mySites : [];
  const hasItems = KL.boot && sites.some((s) => KL.boot.items.some((i) => i.site_id === s.id));
  const unread = KL.me ? KL.me.unread : 0;
  return [
    lrow({ href: '#attendance', icon: 'pin', tone: 'green', title: 'Site check-in', sub: 'Selfie at the site, in and out' }),
    lrow({ href: isStaff() ? '#planner' : '#tasks', icon: 'kanban', tone: 'violet', title: isStaff() ? 'Planner' : 'My tasks', sub: 'Tasks assigned to you, checklists, photo proof' }),
    lrow({ href: '#trips', icon: 'bike', tone: 'blue', title: 'Travel allowance', sub: 'Odometer photos, start and end of trip' }),
    hasItems || isStaff() ? lrow({ href: '#registers', icon: 'box', tone: 'amber', title: 'Site registers', sub: 'Diesel, biomass, biochar, feedstock, output' }) : '',
    lrow({ href: '#farmers', icon: 'sprout', tone: 'green', title: 'Farmers & documents', sub: 'Agreements signed on the phone, KML, land records' }),
    lrow({ href: '#updates', icon: 'note', title: 'Daily work update', sub: 'What you did, what is next, blockers' }),
    lrow({ href: '#inbox', icon: 'bell', title: 'Inbox', sub: 'Approvals, replies and alerts', right: unread ? tag(String(unread), 'bad') : '' }),
  ].join('');
}
Views.work = () => `<h1 class="large">Work</h1><p class="sub">Everything you record in the field, with photo, time and GPS as proof</p><div class="card flush">${workRows()}</div>
  ${group('Record now', `<div class="qa">${[['#rec/batch/new', 'flame', 'earth', 'Kiln batch'], ['#rec/checklist_template', 'checklist', 'green', 'Checklist'], ['#rec/incident/new', 'alert', 'red', 'Incident'], ['#rec/maintenance/new', 'cog', 'blue', 'Maintenance'], ['#rec/application/new', 'sprout', 'violet', 'Biochar on farm'], ['#rec/survival/new', 'leaf', '', 'Tree survival'], ['#rec/expense/new', 'receipt', 'amber', 'Expense'], ['#rec/purchase_request/new', 'box', 'earth', 'Purchase']].map(([h, i, t, l]) => `<a href="${h}"><span class="qi ${t}">${ic(i)}</span>${esc(l)}</a>`).join('')}</div>`)}
  ${group('All registers', `<div class="card flush">${[['hr', 'users', 'blue', 'People', 'My record, attendance, leave, assets, training, policies'], ['money', 'receipt', 'violet', 'Money', 'Expense claims and advances'], ['ops', 'shield', 'red', 'Safety & equipment', 'Checklists, incidents, maintenance'], ['carbon', 'flame', 'earth', 'Production & carbon', 'Batches, farm applications, saplings, survival'], ['supply', 'box', 'amber', 'Purchasing & supply', 'Purchase requests, transfers, dispatch']].map(([g, icon, tone, title, sub]) => lrow({ href: `#hub/${g}`, icon, tone, title, sub })).join('')}${lrow({ href: '#map', icon: 'map', tone: 'green', title: 'Map', sub: 'My sites and farm plots' })}</div>`)}`;

/* ---------------------------------------------------------------- Attendance */
Views.attendance = () => {
  const me = KL.me || {};
  const att = me.openAttendance;
  const sites = KL.boot ? KL.boot.mySites : [];
  const hist = data('attendance:mine', () => api('/api/attendance'));
  let main;
  if (att) {
    const site = siteById(att.site_id) || { name: att.site_name, lat: att.checkin_lat, lng: att.checkin_lng, radius_m: 150 };
    const inside = insideSite(site);
    const stamp = [`${KL.user.name} · ${site.name}`, 'Check-out'];
    main = `<div class="card stack">
      <div class="row between"><div><b>${esc(site.name)}</b><p class="hint">Checked in ${esc(fmtDate(att.checkin_at))} · on site <span data-since="${esc(att.checkin_at)}">${esc(duration(att.checkin_at))}</span></p></div>${statusTag(att.status, 'attendance')}</div>
      ${demoRibbon()}
      ${geoCard(siteById(att.site_id))}
      ${gpsLine(site)}
      ${photoBox('checkout', 'Take check-out selfie', 'user', stamp)}
      ${!inside && KL.ui.gps ? field('Why are you checking out from here?', textarea('att-reason', F('att-reason'), 'e.g. Left early for the next site, GPS weak inside the shed')) : ''}
      <button type="button" class="btn primary wide" data-action="checkout" ${KL.ui.photos.checkout && KL.ui.gps ? '' : 'disabled'}>${inside || !KL.ui.gps ? 'Check out' : 'Check out with exception'}</button>
      <p class="hint">Location, time and the photo are recorded together. Check-out is allowed at the site; from elsewhere it goes to your manager as an exception.</p>
    </div>`;
  } else {
    const chosen = F('att-site', sites.length === 1 ? sites[0].id : '');
    const site = siteById(chosen);
    const inside = insideSite(site);
    const stamp = [`${KL.user.name} · ${site ? site.name : 'Site'}`, 'Check-in'];
    main = `<div class="card stack">
      ${field('Site', select('att-site', chosen, sites.map((s) => [s.id, s.name]), { blank: sites.length === 1 ? '' : 'Choose the site' }))}
      ${site ? `${demoRibbon()}${geoCard(site)}${gpsLine(site)}` : `<p class="hint">Choose the site you have reached.</p>`}
      ${site ? photoBox('checkin', 'Take check-in selfie', 'user', stamp) : ''}
      ${site && site.strict && KL.ui.gps && !inside ? `<div class="banner bad">${ic('lock')}<div><b>Strict site: check-in only inside the boundary</b><p>${esc(site.name)} does not allow exceptions. Move inside the ${site.radius_m} m circle.</p></div></div>` : ''}
      ${site && !site.strict && KL.ui.gps && !inside ? field('Request an exception: why are you not inside the site boundary?', textarea('att-reason', F('att-reason'), 'e.g. Working at the far plot, boundary needs widening')) : ''}
      ${site ? `<button type="button" class="btn primary wide" data-action="checkin" ${KL.ui.photos.checkin && KL.ui.gps && (inside || !site.strict) ? '' : 'disabled'}>${inside ? 'Check in' : KL.ui.gps && !site.strict ? 'Request check-in exception' : 'Check in'}</button>` : ''}
      ${site && site.strict ? `<p class="hint">${ic('lock')} Strict site. While you are checked in, the app tells your manager if you leave the boundary.</p>` : ''}
      <p class="hint">Check-in is allowed only within ${site ? site.radius_m : '…'} m of the site. GPS accuracy up to 50 m is allowed on top. The selfie is taken live, not from the gallery.</p>
    </div>`;
  }
  const rows = hist && !hist.error ? hist.rows : [];
  return `${topbar('Site check-in')}
    ${main}
    ${group('My attendance', hist === null ? spinner() : hist.error ? errorBox(hist.error) : rows.length ? `<div class="card flush">${rows.map((a) => attRow(a)).join('')}</div>` : `<div class="card"><p class="empty">No check-ins yet.</p></div>`, hist && !hist.error ? `${rows.length} in 31 days` : '')}`;
};
function attRow(a, showUser = false) {
  const hours = a.checkout_at ? duration(a.checkin_at, a.checkout_at) : 'on site now';
  return `<div class="lrow-static row">${authImg(a.checkin_file)}<span class="tx" style="flex:1;min-width:0"><b>${esc(showUser ? a.user_name : a.site_name)}</b><span class="muted" style="font-size:13px;display:block">${esc(showUser ? a.site_name + ' · ' : '')}${esc(fmtDate(a.checkin_at))} → ${esc(a.checkout_at ? fmtDate(a.checkout_at).split(', ')[1] || fmtDate(a.checkout_at) : '…')} · ${esc(hours)}${a.checkin_dist > 0 ? ` · ${fmtNum(a.checkin_dist)} m` : ''}</span>${a.override_reason ? `<span class="muted" style="font-size:12px;display:block">${esc(a.override_reason)}</span>` : ''}</span>${statusTag(a.status, 'attendance')}</div>`;
}
Actions.locate = () => locate(true);
Actions.photo = (el) => openCamera(el.dataset.slot, { facing: el.dataset.facing, kind: el.dataset.kind, stamp: JSON.parse(el.dataset.stamp || '[]') });
Actions.checkin = async () => {
  const siteId = F('att-site', KL.boot.mySites.length === 1 ? KL.boot.mySites[0].id : '');
  const site = siteById(siteId);
  const p = KL.ui.photos.checkin;
  const g = KL.ui.gps;
  if (!site || !p || !g) return toast('Pick the site, wait for location and take the selfie', 'error');
  const inside = insideSite(site);
  const reason = F('att-reason', '').trim();
  if (!inside && !reason) return toast('Write why you are checking in from outside the boundary', 'error');
  try {
    const r = await submitEvidence('/api/attendance/checkin', { siteId, lat: g.lat, lng: g.lng, accuracy: g.accuracy, takenAt: p.at, override: inside ? '' : reason }, photoFile('checkin', 'checkin.jpg'), 'Check-in');
    clearPhotos('checkin'); clearF('att-reason');
    await refreshMe(); invalidate('attendance', 'dashboard', 'site'); render();
    if (!r.queued) {
      if (r.status === 'pending') toast('Check-in recorded as an exception, sent to your manager');
      else await celebrate('Checked in', `${site.name} · ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`);
    }
  } catch (e) { toast(e.message, 'error'); }
};
Actions.checkout = async () => {
  const att = KL.me?.openAttendance;
  const p = KL.ui.photos.checkout;
  const g = KL.ui.gps;
  if (!att || !p || !g) return toast('Wait for location and take the selfie', 'error');
  const site = siteById(att.site_id);
  const inside = insideSite(site);
  const reason = F('att-reason', '').trim();
  if (!inside && !reason) return toast('Write why you are checking out from here', 'error');
  try {
    const r = await submitEvidence('/api/attendance/checkout', { lat: g.lat, lng: g.lng, accuracy: g.accuracy, takenAt: p.at, override: inside ? '' : reason }, photoFile('checkout', 'checkout.jpg'), 'Check-out');
    clearPhotos('checkout'); clearF('att-reason');
    await refreshMe(); invalidate('attendance', 'dashboard'); render();
    if (!r.queued) await celebrate('Checked out', `${duration(att.checkin_at)} at ${att.site_name}. See you tomorrow.`);
  } catch (e) { toast(e.message, 'error'); }
};

/* ---------------------------------------------------------------- Trips */
Views.trips = () => {
  const trip = KL.me?.openTrip;
  const travel = KL.boot?.travel || { vehicles: {} };
  const list = data('trips:mine', () => api('/api/trips'));
  let main;
  if (trip) {
    const stamp = [`${KL.user.name} · trip end`, `${trip.vehicle} · start ${fmtNum(trip.start_reading)} km`];
    KL.ui.previewFn = () => {
      const reading = Number(F('trip-end-reading'));
      const km = reading && reading >= trip.start_reading ? reading - trip.start_reading : null;
      return km !== null ? `<div class="banner info"><b>${fmtNum(km, 1)} km this trip</b><p>${esc(rupees(km * (trip.rate_per_km || 0)))} at ${esc(KL.boot.travel.currency)}${trip.rate_per_km}/km, subject to approval</p></div>` : '';
    };
    main = `<div class="card stack">
      <div class="status-card"><div class="big-ic blue">${ic('bike')}</div><div class="tx"><b>${esc(trip.vehicle)} · on the road <span data-since="${esc(trip.start_at)}">${esc(duration(trip.start_at))}</span></b><span>Started ${esc(fmtDate(trip.start_at))} at ${esc(fmtNum(trip.start_reading))} km${trip.purpose ? ` · ${esc(trip.purpose)}` : ''}${trip.site_id ? ` · ${esc(siteName(trip.site_id))}` : ''}</span></div></div>
      ${demoRibbon()}
      ${gpsLine()}
      ${field('Odometer reading now (km)', input('trip-end-reading', F('trip-end-reading'), { type: 'number', inputmode: 'decimal', placeholder: String(Math.round(trip.start_reading)), step: '0.1', min: trip.start_reading }))}
      <div id="preview">${KL.ui.previewFn()}</div>
      ${photoBox('tripEnd', 'Photograph the odometer', 'environment', stamp)}
      <button type="button" class="btn primary wide" data-action="tripEnd" ${KL.ui.photos.tripEnd && KL.ui.gps ? '' : 'disabled'}>End trip and submit</button>
    </div>`;
  } else {
    const vehicle = F('trip-vehicle', Object.keys(travel.vehicles)[0] || '');
    const stamp = [`${KL.user.name} · trip start`, vehicle];
    main = `<div class="card stack">
      ${field('Vehicle', select('trip-vehicle', vehicle, Object.entries(travel.vehicles).map(([v, r]) => [v, `${v} · ${travel.currency}${r}/km`])))}
      <div class="grid2">${field('Odometer reading (km)', input('trip-reading', F('trip-reading'), { type: 'number', inputmode: 'decimal', placeholder: 'e.g. 48213', step: '0.1' }))}
      ${field('Site (optional)', select('trip-site', F('trip-site'), (KL.boot?.mySites || []).map((s) => [s.id, s.name]), { blank: 'None' }))}</div>
      ${field('Purpose', input('trip-purpose', F('trip-purpose'), { placeholder: 'e.g. Farmer visits, Vanthali cluster' }))}
      ${demoRibbon()}
      ${gpsLine()}
      ${photoBox('tripStart', 'Photograph the odometer', 'environment', stamp)}
      <button type="button" class="btn primary wide" data-action="tripStart" ${KL.ui.photos.tripStart && KL.ui.gps ? '' : 'disabled'}>Start trip</button>
      <p class="hint">The start and end photos, readings and GPS points go to your manager. The app also shows them the straight-line distance between the two points.</p>
    </div>`;
  }
  const rows = list && !list.error ? list.rows.filter((t) => t.status !== 'open') : [];
  const month = rows.filter((t) => t.status === 'approved' && (t.end_at || '').slice(0, 7) === todayISO().slice(0, 7));
  const sum = (k) => month.reduce((a, t) => a + (t[k] || 0), 0);
  return `${topbar('Travel allowance')}
    ${main}
    ${rows.length ? `<div class="tiles" style="margin-top:14px"><div class="tile blue"><div class="ti">${ic('bike')}</div><b>${num(sum('km_claimed'), 'trip-km')}</b><span>km approved this month</span></div><div class="tile ok"><div class="ti">${ic('receipt')}</div><b>${num(sum('amount'), 'trip-amt', 'rupee')}</b><span>approved this month</span></div><div class="tile warn"><div class="ti">${ic('clock')}</div><b>${rows.filter((t) => t.status === 'submitted').length}</b><span>awaiting approval</span></div></div>` : ''}
    ${group('My trips', list === null ? spinner() : list.error ? errorBox(list.error) : rows.length ? `<div class="card flush">${rows.map((t) => tripRow(t)).join('')}</div>` : `<div class="card"><p class="empty">No trips yet.</p></div>`)}`;
};
function tripRow(t, showUser = false) {
  return `<div class="lrow-static row">${authImg(t.start_file)}<span class="tx" style="flex:1;min-width:0"><b>${esc(showUser ? t.user_name : `${fmtNum(t.km_claimed, 1)} km · ${t.vehicle}`)}</b><span class="muted" style="font-size:13px;display:block">${esc(showUser ? `${fmtNum(t.km_claimed, 1)} km · ${t.vehicle} · ` : '')}${esc(fmtDate(t.start_at))}${t.purpose ? ` · ${esc(t.purpose)}` : ''}${t.km_straight !== null && t.km_straight !== undefined ? ` · straight line ${fmtNum(t.km_straight, 1)} km` : ''}</span>${t.decision_note ? `<span class="muted" style="font-size:12px;display:block">${esc(t.decision_note)}</span>` : ''}</span><span class="right"><b class="mono">${esc(rupees(t.amount))}</b><br/>${statusTag(t.status)}</span></div>`;
}
Actions.tripStart = async () => {
  const g = KL.ui.gps, p = KL.ui.photos.tripStart;
  const reading = F('trip-reading');
  if (!g || !p || !reading) return toast('Reading, location and the odometer photo are needed', 'error');
  try {
    const r = await submitEvidence('/api/trips/start', { vehicle: F('trip-vehicle', Object.keys(KL.boot.travel.vehicles)[0]), reading, purpose: F('trip-purpose', ''), siteId: F('trip-site', ''), lat: g.lat, lng: g.lng, takenAt: p.at }, photoFile('tripStart', 'odometer-start.jpg'), 'Trip start');
    clearPhotos('tripStart'); clearF('trip-reading', 'trip-purpose');
    await refreshMe(); invalidate('trips'); render();
    if (!r.queued) await celebrate('Trip started', 'Ride safe. Photograph the odometer again when you arrive.');
  } catch (e) { toast(e.message, 'error'); }
};
Actions.tripEnd = async () => {
  const trip = KL.me?.openTrip, g = KL.ui.gps, p = KL.ui.photos.tripEnd;
  const reading = F('trip-end-reading');
  if (!trip || !g || !p || !reading) return toast('Reading, location and the odometer photo are needed', 'error');
  try {
    const r = await submitEvidence(`/api/trips/${trip.id}/end`, { reading, lat: g.lat, lng: g.lng, takenAt: p.at }, photoFile('tripEnd', 'odometer-end.jpg'), 'Trip end');
    clearPhotos('tripEnd'); clearF('trip-end-reading');
    await refreshMe(); invalidate('trips', 'dashboard'); render();
    if (!r.queued) await celebrate(`${fmtNum(r.km, 1)} km claimed`, `${rupees(r.amount ?? 0)} sent to your manager for approval.`);
  } catch (e) { toast(e.message, 'error'); }
};

/* ---------------------------------------------------------------- Registers */
Views.registers = (arg) => {
  const [siteArg, itemId] = (arg || '').split('/');
  const sites = (isStaff() ? KL.boot.sites : KL.boot.mySites).filter((s) => KL.boot.items.some((i) => i.site_id === s.id));
  const siteId = siteArg || (sites.length === 1 ? sites[0].id : F('reg-site', ''));
  if (itemId) return registerItemView(siteId, itemId);
  if (siteArg && siteById(siteArg)) { setTimeout(() => location.replace(`#site/${siteArg}/stock`), 0); return spinner(); }
  const site = siteById(siteId);
  const reg = siteId ? data(`registers:${siteId}`, () => api(`/api/registers?siteId=${siteId}`)) : null;
  const picker = sites.length > 1 ? `<div class="card">${field('Site', select('reg-site', siteId, sites.map((s) => [s.id, s.name]), { blank: 'Choose a site' }))}</div>` : '';
  let body = '';
  if (site) {
    body = reg === null ? spinner() : reg.error ? errorBox(reg.error) : `<div class="card flush">${reg.items
      .map((it) => lrow({ href: `#registers/${siteId}/${it.id}`, icon: it.kind === 'product' ? 'box' : 'fuel', tone: it.low ? 'red' : it.kind === 'product' ? 'green' : 'amber', title: it.name,
        sub: `${it.kind === 'product' ? 'Finished product' : 'Input'}${it.last ? ` · last ${it.last.type} ${fmtNum(it.last.qty, 2)} ${esc(it.unit)}, ${esc(timeAgo(it.last.at))}` : ' · nothing recorded yet'}`,
        right: `<span class="right"><b class="mono">${fmtNum(it.balance, 2)}</b> <span class="muted" style="font-size:12px">${esc(it.unit)}</span>${it.low ? `<br/>${tag('Low stock', 'bad')}` : ''}</span>` }))
      .join('')}</div>
      <p class="hint" style="margin-top:8px">Stock is never typed in: it is the sum of every in, out and physical count, each with a geotagged photo. ${isStaff() ? `<a href="/api/export/site/${esc(siteId)}?token=${encodeURIComponent(KL.token)}">Download the audit CSV</a>.` : ''}</p>`;
  }
  return `${topbar('Site registers')}${picker}${site ? group(site.name, body) : sites.length ? '' : '<div class="card"><p class="empty">No registers on your sites yet.</p></div>'}`;
};
function registerItemView(siteId, itemId) {
  const item = KL.boot.items.find((i) => i.id === itemId);
  if (!item) return `${topbar('Register', `#site/${siteId}/stock`)}<div class="card"><p class="empty">Item not found.</p></div>`;
  const site = siteById(siteId);
  const reg = data(`registers:${siteId}`, () => api(`/api/registers?siteId=${siteId}`));
  const bal = reg && !reg.error ? reg.items.find((i) => i.id === itemId)?.balance : null;
  const movs = data(`movements:${itemId}`, () => api(`/api/registers/movements?siteId=${siteId}&itemId=${itemId}&limit=60`));
  const type = F('mov-type', 'in');
  const qty = Number(F('mov-qty'));
  const labels = { in: item.kind === 'product' ? 'Produced / added' : 'Received (in)', out: item.kind === 'product' ? 'Dispatched / sold (out)' : 'Consumed (out)', count: 'Physical count' };
  KL.ui.previewFn = () => {
    const q = Number(F('mov-qty'));
    if (!(q > 0) || bal === null || bal === undefined) return '';
    const after = type === 'in' ? bal + q : type === 'out' ? bal - q : q;
    return `<div class="banner ${after < 0 ? 'bad' : type === 'count' && Math.abs(after - bal) > 0 ? 'warn' : 'info'}"><b>Stock after: ${fmtNum(after, 2)} ${esc(item.unit)}</b>${type === 'count' ? `<p>Variance ${after - bal >= 0 ? '+' : ''}${fmtNum(after - bal, 2)} ${esc(item.unit)} against the book figure</p>` : after < 0 ? '<p>Not enough in stock. Record what came in first.</p>' : ''}</div>`;
  };
  const stamp = [`${site?.name || ''} · ${item.name}`, `${labels[type]} ${qty || ''} ${item.unit}`.trim(), KL.user.name];
  return `${topbar(item.name, `#site/${siteId}/stock`)}
    <p class="sub">${esc(site?.name || '')} · ${item.kind === 'product' ? 'finished product' : 'input'} · ${bal === null || bal === undefined ? '…' : `<b>${fmtNum(bal, 2)} ${esc(item.unit)}</b> in stock`}</p>
    <div class="card stack">
      <div class="seg">${['in', 'out', 'count'].map((t) => `<button type="button" data-action="movType" data-type="${t}" aria-pressed="${type === t}">${t === 'in' ? 'In' : t === 'out' ? 'Out' : 'Count'}</button>`).join('')}</div>
      <p class="hint">${esc(labels[type])}${type === 'count' ? ': the quantity you physically see now; any difference from the book figure is recorded as a variance.' : '.'}</p>
      <div class="grid2">${field(`Quantity (${item.unit})`, input('mov-qty', F('mov-qty'), { type: 'number', inputmode: 'decimal', placeholder: '0', step: '0.01', min: 0 }))}
      ${field('Batch / vehicle / ref (optional)', input('mov-batch', F('mov-batch'), { placeholder: type === 'in' ? 'e.g. Truck GJ03 AB 1234' : 'e.g. Kiln run K-27' }))}</div>
      ${field('Note (optional)', input('mov-note', F('mov-note'), { placeholder: 'Supplier, quality, who took it…' }))}
      <div id="preview">${KL.ui.previewFn()}</div>
      ${demoRibbon()}
      ${gpsLine()}
      ${photoBox('mov', 'Photograph the stock / delivery', 'environment', stamp)}
      <button type="button" class="btn primary wide" data-action="movSave" data-item="${esc(itemId)}" data-site="${esc(siteId)}" ${KL.ui.photos.mov && KL.ui.gps ? '' : 'disabled'}>Save ${esc(type === 'count' ? 'count' : type)}</button>
    </div>
    ${group('Recent entries', movs === null ? spinner() : movs.error ? errorBox(movs.error) : movs.rows.length ? `<div class="card flush">${movs.rows.map(movRow).join('')}</div>` : '<div class="card"><p class="empty">Nothing recorded yet.</p></div>')}`;
}
function movRow(m) {
  const sign = m.type === 'in' ? '+' : m.type === 'out' ? '−' : '=';
  const tone = m.type === 'in' ? 'ok' : m.type === 'out' ? 'warn' : 'info';
  return `<div class="lrow-static row">${authImg(m.file_id)}<span class="tx" style="flex:1;min-width:0"><b>${sign}${fmtNum(m.qty, 2)} ${esc(m.unit)} ${tag(m.type === 'count' ? 'count' : m.type, tone)}</b><span class="muted" style="font-size:13px;display:block">${esc(fmtDate(m.at))} · ${esc(m.user_name)}${m.batch ? ` · ${esc(m.batch)}` : ''}${m.note ? ` · ${esc(m.note)}` : ''}${m.variance !== null && m.variance !== undefined && Math.abs(m.variance) > 0 ? ` · variance ${m.variance > 0 ? '+' : ''}${fmtNum(m.variance, 2)}` : ''}</span></span><span class="right"><span class="muted" style="font-size:11px">balance</span><br/><b class="mono">${fmtNum(m.balance_after, 2)}</b></span></div>`;
}
Actions.movType = (el) => { setF('mov-type', el.dataset.type); render(); };
Actions.movSave = async (el) => {
  const g = KL.ui.gps, p = KL.ui.photos.mov;
  const item = KL.boot.items.find((i) => i.id === el.dataset.item);
  if (!g || !p) return toast('Location and a photo are needed', 'error');
  const type = F('mov-type', 'in');
  if (F('mov-qty', '') === '' || Number(F('mov-qty')) < 0 || (type !== 'count' && !(Number(F('mov-qty')) > 0))) return toast('Enter the quantity', 'error');
  try {
    const r = await submitEvidence('/api/registers/movements', { itemId: el.dataset.item, type, qty: F('mov-qty'), batch: F('mov-batch', ''), note: F('mov-note', ''), lat: g.lat, lng: g.lng, accuracy: g.accuracy, takenAt: p.at }, photoFile('mov', `${item.name}-${type}.jpg`), `${item.name} ${type}`);
    clearPhotos('mov'); clearF('mov-qty', 'mov-batch', 'mov-note');
    if (!r.queued) toast(r.variance !== null && r.variance !== undefined ? `Count saved · variance ${r.variance > 0 ? '+' : ''}${fmtNum(r.variance, 2)}` : `Saved · stock now ${fmtNum(r.balance, 2)} ${item.unit}`);
    invalidate('registers', 'movements', 'dashboard', 'site'); render();
  } catch (e) { toast(e.message, 'error'); }
};

/* ---------------------------------------------------------------- Farmers */
Views.farmers = (arg) => {
  if (arg) return farmerDetail(arg);
  const q = F('farmer-q', '');
  const list = data('farmers', () => api('/api/farmers'));
  const rows = list && !list.error ? list.rows.filter((f) => !q || `${f.name} ${f.village} ${f.phone}`.toLowerCase().includes(q.toLowerCase())) : [];
  return `${topbar('Farmers', isStaff() ? '#sites' : '#mysite', `<button type="button" class="btn small primary" data-action="farmerAdd">${ic('plus')} Add</button>`)}
    <input class="input" placeholder="Search by name, village or phone" value="${esc(q)}" data-input="farmerSearch" />
    ${list === null ? spinner() : list.error ? errorBox(list.error) : `<div class="card flush" style="margin-top:10px">${rows.length ? rows.map((f) => lrow({ href: `#farmers/${f.id}`, icon: 'sprout', tone: 'green', title: f.name, sub: `${esc([f.village, f.taluka].filter(Boolean).join(', '))}${f.phone ? ` · ${esc(f.phone)}` : ''} · ${f.docs} document${f.docs === 1 ? '' : 's'}, ${f.plots} plot${f.plots === 1 ? '' : 's'}` })).join('') : '<p class="empty">No farmers yet. Tap + Add.</p>'}</div>`}`;
};
Inputs.farmerSearch = (el) => { setF('farmer-q', el.value); const list = KL.cache.farmers; if (list && !list.error) { const q = el.value.toLowerCase(); const wrap = $('.card.flush'); if (wrap) wrap.innerHTML = list.rows.filter((f) => !q || `${f.name} ${f.village} ${f.phone}`.toLowerCase().includes(q)).map((f) => lrow({ href: `#farmers/${f.id}`, icon: 'sprout', tone: 'green', title: f.name, sub: `${esc([f.village, f.taluka].filter(Boolean).join(', '))} · ${f.docs} documents, ${f.plots} plots` })).join('') || '<p class="empty">No match.</p>'; } };
Actions.farmerAdd = async (el) => {
  const sites = KL.boot.mySites.filter((s) => s.project_type !== 'office' && s.project_type !== 'gasifier');
  const pre = el?.dataset?.site ? siteById(el.dataset.site) : null;
  const v = await modal({ title: 'New farmer', fields: [
    { key: 'name', label: 'Full name', placeholder: 'e.g. Ramesh Bhai Patel' }, { key: 'father_name', label: "Father's / husband's name" }, { key: 'village', label: 'Village' }, { key: 'taluka', label: 'Taluka' }, { key: 'district', label: 'District' },
    { key: 'phone', label: 'Mobile', type: 'tel', inputmode: 'tel' }, { key: 'id_last4', label: 'Aadhaar last 4 digits', inputmode: 'numeric' }, { key: 'site', label: 'Site', type: 'select', options: sites.map((s) => s.name), value: pre?.name || sites[0]?.name },
  ], confirmText: 'Add farmer' });
  if (!v) return;
  try {
    const site = sites.find((s) => s.name === v.site);
    const r = await api('/api/farmers', { json: { ...v, site_id: site?.id } });
    invalidate('farmers', 'site'); toast('Farmer added'); location.hash = `#farmers/${r.id}`;
  } catch (e) { toast(e.message, 'error'); }
};
function farmerDetail(id) {
  const f = data(`farmer:${id}`, () => api(`/api/farmers/${id}`));
  if (f === null) return `${topbar('Farmer', KL.ui.siteBack || '#farmers')}${spinner()}`;
  if (f.error) return `${topbar('Farmer', KL.ui.siteBack || '#farmers')}${errorBox(f.error)}`;
  const kinds = { kml: 'KML plot boundary', land_record: 'Land record (7/12, 8A)', id_proof: 'ID proof', photo: 'Photo', other: 'Other' };
  return `${topbar(f.name, f.site_id ? `#site/${f.site_id}/farmers` : '#farmers')}
    <p class="sub">${esc([f.father_name && `s/o ${f.father_name}`, f.village, f.taluka, f.district].filter(Boolean).join(' · '))}${f.phone ? ` · ${esc(f.phone)}` : ''}${f.site_name ? ` · ${esc(f.site_name)}` : ''}</p>
    <div class="btns"><a class="btn primary" href="#sign/${esc(id)}">${ic('pen')} Sign a document</a><button type="button" class="btn" data-action="farmerUpload" data-id="${esc(id)}">${ic('upload')} Upload file</button></div>
    ${group('Plots', f.plots.length ? `<div class="card flush">${f.plots.map((p) => `<div class="lrow-static"><b>Survey ${esc(p.survey_no || '–')}</b><div class="kv" style="margin-top:4px"><span>Declared area</span><span>${p.area_ha_declared ? `${fmtNum(p.area_ha_declared, 2)} ha` : '–'}</span><span>From KML</span><span>${p.area_ha_kml ? `${fmtNum(p.area_ha_kml, 2)} ha` : '–'}</span>${p.area_ha_declared && p.area_ha_kml ? `<span>Difference</span><span class="${Math.abs(p.area_ha_kml - p.area_ha_declared) / p.area_ha_declared > 0.1 ? 'muted' : ''}">${fmtNum(((p.area_ha_kml - p.area_ha_declared) / p.area_ha_declared) * 100, 0)}%</span>` : ''}</div><div class="btns" style="margin-top:6px">${p.kml_file ? fileLink(p.kml_file, 'KML') : ''}${p.land_record_file ? fileLink(p.land_record_file, 'Land record') : ''}</div></div>`).join('')}</div>` : '<div class="card"><p class="empty">No plot yet. Upload a KML or land record to create one.</p></div>')}
    ${group('Signed documents', f.documents.length ? `<div class="card flush">${f.documents.map((d) => `<div class="lrow-static row"><span class="icon green">${ic('doc')}</span><span class="tx" style="flex:1"><b>${esc(d.template_name)}</b><span class="muted" style="font-size:13px;display:block">${esc(d.doc_no)} · ${esc(fmtDate(d.created_at))} · ${esc(d.user_name)}</span></span>${fileLink(d.pdf_file, 'PDF')}</div>`).join('')}</div>` : '<div class="card"><p class="empty">Nothing signed yet.</p></div>', `${f.documents.length}`)}
    ${group('Files', f.files.length ? `<div class="card flush">${f.files.map((x) => `<div class="lrow-static row"><span class="icon">${ic(x.kind === 'kml' ? 'map' : x.mime.startsWith('image/') ? 'image' : 'clip')}</span><span class="tx" style="flex:1"><b>${esc(kinds[x.kind] || x.kind)}</b><span class="muted" style="font-size:13px;display:block">${esc(x.name)} · ${fmtNum(x.size / 1024)} KB · ${esc(fmtDate(x.created_at))}</span></span>${fileLink(x.file_id)}</div>`).join('')}</div>` : '<div class="card"><p class="empty">No files yet.</p></div>')}`;
}
Actions.farmerUpload = async (el) => {
  const id = el.dataset.id;
  const v = await modal({ title: 'Upload a file', fields: [
    { key: 'kind', label: 'What is it?', type: 'select', options: ['KML plot boundary', 'Land record (7/12, 8A)', 'ID proof', 'Photo', 'Other'], value: 'KML plot boundary' },
    { key: 'surveyNo', label: 'Survey number (for KML / land record)' }, { key: 'areaDeclared', label: 'Area as per record (hectares)', type: 'number', inputmode: 'decimal' },
  ], confirmText: 'Choose file' });
  if (!v) return;
  const kind = { 'KML plot boundary': 'kml', 'Land record (7/12, 8A)': 'land_record', 'ID proof': 'id_proof', Photo: 'photo', Other: 'other' }[v.kind];
  pickFile(kind === 'kml' ? '.kml,.kmz,application/vnd.google-earth.kml+xml' : kind === 'photo' ? 'image/*' : '*/*', async (file) => {
    try {
      const g = KL.ui.gps;
      const r = await submitEvidence(`/api/farmers/${id}/files`, { kind, surveyNo: v.surveyNo, areaDeclared: v.areaDeclared, lat: g?.lat, lng: g?.lng }, [{ field: 'file', blob: file, name: file.name }], 'Farmer file');
      if (!r.queued) toast(r.kml ? `KML saved: ${r.kml.polygons} polygon${r.kml.polygons === 1 ? '' : 's'}, ${fmtNum(r.kml.area_ha, 2)} ha` : 'File saved');
      invalidate('farmer', 'farmers'); render();
    } catch (e) { toast(e.message, 'error'); }
  });
};

/* ---------------------------------------------------------------- Sign a document */
Views.sign = (farmerId) => {
  if (!farmerId) { setTimeout(() => location.replace('#farmers'), 0); return spinner(); }
  const f = data(`farmer:${farmerId}`, () => api(`/api/farmers/${farmerId}`));
  if (f === null) return `${topbar('Sign a document', `#farmers/${farmerId}`)}${spinner()}`;
  if (f.error) return `${topbar('Sign a document', `#farmers/${farmerId}`)}${errorBox(f.error)}`;
  const proj = siteById(f.site_id)?.project_type;
  const templates = KL.boot.templates.filter((x) => !proj || x.project_type === proj || x.project_type === 'other').length ? KL.boot.templates.filter((x) => !proj || x.project_type === proj || x.project_type === 'other') : KL.boot.templates;
  const tid = F('sign-template', templates[0]?.id || '');
  const t = templates.find((x) => x.id === tid);
  const plot = f.plots[0];
  const defaults = { survey_no: plot?.survey_no, area_ha: plot?.area_ha_kml || plot?.area_ha_declared };
  for (const [k, v] of Object.entries(defaults)) if (KL.ui.forms[`sf-${k}`] === undefined && v !== undefined && v !== null && v !== '') setF(`sf-${k}`, String(v));
  const done = KL.ui.signed;
  if (done && done.farmerId === farmerId) {
    return `${topbar('Signed', `#farmers/${farmerId}`)}<div class="card stack" style="text-align:center"><div class="big-ic" style="margin:0 auto;width:64px;height:64px;border-radius:22px;background:var(--tint);color:var(--brand);display:grid;place-items:center">${ic('check')}</div><b>${esc(done.docNo)}</b><p class="hint">Saved to the farmer's folder with the signature, GPS and time. The company's authorised signature is already on it.</p>${fileLink(done.pdfFile, 'Open the PDF')}<a class="btn primary" href="#farmers/${esc(farmerId)}" data-action="signDone">Back to ${esc(f.name)}</a></div>`;
  }
  return `${topbar('Sign a document', `#farmers/${farmerId}`)}
    <p class="sub">${esc(f.name)}${f.village ? `, ${esc(f.village)}` : ''}</p>
    <div class="card stack">
      ${field('Document', select('sign-template', tid, templates.map((x) => [x.id, x.name])))}
      ${t ? t.fields.map((fl) => field(fl.label + (fl.required ? '' : ' (optional)'), input(`sf-${fl.key}`, F(`sf-${fl.key}`, defaults[fl.key] ?? ''), { type: fl.type === 'number' ? 'number' : 'text', inputmode: fl.type === 'number' ? 'decimal' : '', step: 'any' }))).join('') : ''}
      <details class="fold"><summary>Read the document text ▸</summary><p class="hint" style="white-space:pre-wrap">${esc(previewBody(t, f))}</p></details>
    </div>
    <div class="card stack" style="margin-top:10px">
      <div class="row between"><b>Farmer's signature</b><button type="button" class="btn small ghost" data-action="sigClear">Clear</button></div>
      <div class="sig-wrap"><canvas id="sig" class="sig" aria-label="Signature pad"></canvas><div class="line"></div></div>
      <p class="hint">Read the document to the farmer in their language, then hand them the phone to sign in the box. The field officer's name, GPS and time are printed on the PDF.</p>
      ${gpsLine()}
      <button type="button" class="btn primary wide" data-action="signSubmit" data-farmer="${esc(farmerId)}">Save signed document</button>
    </div>`;
};
function previewBody(t, f) {
  if (!t) return '';
  const vals = { ...f, company: KL.boot.company.name };
  for (const fl of t.fields) vals[fl.key] = F(`sf-${fl.key}`, '') || `[${fl.label}]`;
  const body = (KL.cache[`template-body:${t.id}`]) || null;
  return body ? body.replace(/{{\s*(\w+)\s*}}/g, (m, k) => vals[k] ?? '____') : `${t.name}: ${t.fields.map((x) => x.label).join(', ')}. (Full text is printed in the PDF.)`;
}
Actions.sigClear = () => KL.sig && KL.sig.clear();
Actions.signSubmit = async (el) => {
  const farmerId = el.dataset.farmer;
  const fr = KL.cache[`farmer:${farmerId}`];
  const proj = fr && !fr.error ? siteById(fr.site_id)?.project_type : null;
  const pool = KL.boot.templates.filter((x) => !proj || x.project_type === proj || x.project_type === 'other');
  const t = KL.boot.templates.find((x) => x.id === F('sign-template', (pool[0] || KL.boot.templates[0])?.id));
  if (!t) return toast('Choose a document', 'error');
  if (!KL.sig || KL.sig.isEmpty()) return toast('The farmer has not signed yet', 'error');
  const fields = {};
  for (const fl of t.fields) fields[fl.key] = F(`sf-${fl.key}`, '');
  const missing = t.fields.filter((fl) => fl.required && !String(fields[fl.key] || '').trim());
  if (missing.length) return toast('Fill: ' + missing.map((m) => m.label).join(', '), 'error');
  const g = KL.ui.gps;
  try {
    const r = await api(`/api/farmers/${farmerId}/documents`, { json: { templateId: t.id, fields, signature: KL.sig.dataUrl(), lat: g?.lat, lng: g?.lng } });
    KL.ui.signed = { farmerId, docNo: r.docNo, pdfFile: r.pdfFile };
    KL.sig = null;
    for (const fl of t.fields) clearF(`sf-${fl.key}`);
    invalidate('farmer', 'farmers', 'dashboard');
    render();
    celebrate('Document signed', `${r.docNo} is saved to the farmer's folder.`);
  } catch (e) { toast(e.status === 0 ? 'Signing needs a connection (the PDF is made on the server). Try again when online.' : e.message, 'error'); }
};
Actions.signDone = () => { KL.ui.signed = null; };
