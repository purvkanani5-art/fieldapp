/* Finding a place on the map (owner 2026-11-20): one box that works out what was typed or pasted:
   a Google Maps link (short maps.app.goo.gl ones are opened by the server), coordinates (decimal or degrees-minutes-
   seconds), a plus code (full "7JCMQ7XC+2V", or short "Q7XC+2V Surat" / "Q7XC+2V" near the map's view), or a place
   name (OpenStreetMap search). Also the plus code of a point, the area of a point (village, taluka, district, state),
   the Map / Satellite switch and "Open in Google Maps". Free services for now; Google Maps comes with the Android app. */

/* ---------------------------------------------------------------- plus codes (Open Location Code, the open method Google uses) */
const OLC_ABC = '23456789CFGHJMPQRVWX';
const OLC_RES = [20, 1, 0.05, 0.0025, 0.000125];
/** The 10-character plus code of a point (about 14 m square), e.g. 7JCMQ7XC+2V. */
function olcEncode(lat, lng) {
  lat = Math.min(90, Math.max(-90, lat)); lng = ((((lng + 180) % 360) + 360) % 360) - 180;
  if (lat === 90) lat -= OLC_RES[4] / 2;
  let la = Math.floor(Math.round((lat + 90) * 8000 * 1e6) / 1e6), ln = Math.floor(Math.round((lng + 180) * 8000 * 1e6) / 1e6);
  let code = '';
  for (let i = 0; i < 5; i++) { code = OLC_ABC[la % 20] + OLC_ABC[ln % 20] + code; la = Math.floor(la / 20); ln = Math.floor(ln / 20); }
  return `${code.slice(0, 8)}+${code.slice(8)}`;
}
/** Centre of a full plus code (8 to 11+ digits), or null. */
function olcDecode(code) {
  const c = String(code).toUpperCase().replace('+', '').replace(/0+$/, '');
  if (c.length < 2 || c.length % 2 && c.length < 11 || /[^23456789CFGHJMPQRVWX]/.test(c)) return null;
  let lat = -90, lng = -180, hLat = 0, hLng = 0;
  for (let i = 0; i < Math.min(c.length, 10); i += 2) {
    const r = OLC_RES[i / 2];
    lat += OLC_ABC.indexOf(c[i]) * r; lng += OLC_ABC.indexOf(c[i + 1]) * r; hLat = r; hLng = r;
  }
  for (let i = 10; i < c.length; i++) { // grid refinement: 5 rows x 4 columns
    const d = OLC_ABC.indexOf(c[i]); hLat /= 5; hLng /= 4;
    lat += Math.floor(d / 4) * hLat; lng += (d % 4) * hLng;
  }
  return { lat: lat + hLat / 2, lng: lng + hLng / 2 };
}
/** A short code ("Q7XC+2V", 4 to 6 digits before the +) made full with a nearby point. */
function olcRecover(short, refLat, refLng) {
  const s = String(short).toUpperCase();
  const pad = 8 - s.indexOf('+');
  const res = 20 ** (2 - pad / 2), half = res / 2;
  const p = olcDecode(olcEncode(refLat, refLng).replace('+', '').slice(0, pad) + s.replace('+', ''));
  if (!p) return null;
  let { lat, lng } = p;
  if (refLat + half < lat && lat - res >= -90) lat -= res; else if (refLat - half > lat && lat + res <= 90) lat += res;
  if (refLng + half < lng) lng -= res; else if (refLng - half > lng) lng += res;
  return { lat, lng };
}
const OLC_FULL = /\b([23456789CFGHJMPQRVWX]{8}\+[23456789CFGHJMPQRVWX]{2,3})\b/i;
const OLC_SHORT = /(?:^|\s)([23456789CFGHJMPQRVWX]{4,6}\+[23456789CFGHJMPQRVWX]{2,3})(?=$|[\s,])/i;

/* ---------------------------------------------------------------- what was typed */
/** "21.1702, 72.8311", "21.1702 72.8311", "21°10'12.7"N 72°49'52.0"E" -> {lat, lng}, else null. */
function parseCoords(text) {
  const t = String(text).trim();
  let m = t.match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (m) { const lat = Number(m[1]), lng = Number(m[2]); return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null; }
  const dms = /(\d{1,3})\s*[°º]\s*(?:(\d{1,2})\s*['′]\s*)?(?:(\d{1,2}(?:\.\d+)?)\s*["″]\s*)?([NSEW])/gi;
  const parts = [...t.matchAll(dms)];
  if (parts.length === 2) {
    const val = (p) => (Number(p[1]) + Number(p[2] || 0) / 60 + Number(p[3] || 0) / 3600) * (/[SW]/i.test(p[4]) ? -1 : 1);
    const a = parts.find((p) => /[NS]/i.test(p[4])), b = parts.find((p) => /[EW]/i.test(p[4]));
    if (a && b) return { lat: val(a), lng: val(b) };
  }
  return null;
}
/** Read a full Google Maps link: the pinned place first, then a query, then the view's centre. */
function parseMapsLink(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.hostname === 'consent.google.com' && u.searchParams.get('continue')) return parseMapsLink(u.searchParams.get('continue'));
  const s = decodeURIComponent(u.href.replace(/\+/g, ' '));
  let m = s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };
  for (const k of ['q', 'query', 'll', 'daddr', 'destination', 'center']) {
    const v = u.searchParams.get(k);
    if (!v) continue;
    const c = parseCoords(v.replace(/^loc:/, ''));
    if (c) return c;
    return { text: v };
  }
  m = s.match(/\/(?:place|search)\/([^/@?]+)/);
  if (m) { const c = parseCoords(m[1]); if (c) return c; const at = s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/); return { text: m[1].trim(), near: at ? { lat: Number(at[1]), lng: Number(at[2]) } : null }; }
  m = s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };
  return null;
}

/* ---------------------------------------------------------------- search and area (server; the in-browser demo asks OpenStreetMap itself) */
async function geoGet(path, params) {
  const q = new URLSearchParams(params).toString();
  if (!window.KL_LOCAL) return api(`/api/geo/${path}?${q}`);
  const nm = path === 'search'
    ? `https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q: params.q, format: 'jsonv2', addressdetails: 1, limit: 8, countrycodes: 'in' })}`
    : `https://nominatim.openstreetmap.org/reverse?${new URLSearchParams({ lat: params.lat, lon: params.lng, format: 'jsonv2', addressdetails: 1, zoom: 16 })}`;
  const r = await fetch(nm, { headers: { 'Accept-Language': 'en' } }).then((x) => x.json()).catch(() => { throw new Error('Map search is not reachable right now'); });
  const area = (a = {}) => ({ village: a.village || a.hamlet || a.town || a.city || a.suburb || '', taluka: (a.county || a.subdistrict || '').replace(/\s+(taluka|taluk|tehsil|tahsil)$/i, ''), district: a.state_district || a.district || '', state: a.state || '' });
  if (path === 'reverse') return { area: area(r.address), label: r.display_name || '' };
  return { rows: (r || []).map((x) => ({ name: x.name || x.display_name.split(',')[0], label: x.display_name.split(',').slice(0, 4).join(','), lat: Number(x.lat), lng: Number(x.lon), area: area(x.address) })) };
}
/** Village, taluka, district and state of a point. */
const placeArea = (lat, lng) => geoGet('reverse', { lat: lat.toFixed(6), lng: lng.toFixed(6) });

/**
 * Work out what was typed and where it is: {point: {lat, lng, label, exact}} or {choices: [...]}. `near` is the map's
 * centre, used for short plus codes without a place and to prefer nearby search results.
 */
async function placeFind(raw, near) {
  const text = String(raw || '').trim();
  if (!text) throw new Error('Type a place, a plus code or coordinates, or paste a Google Maps link');
  const c = parseCoords(text);
  if (c) return { point: { ...c, label: 'Coordinates', exact: true } };
  if (/^https?:\/\//i.test(text) || /^(maps\.app\.goo\.gl|goo\.gl|google\.[a-z.]+\/maps)/i.test(text)) {
    let url = /^https?:/i.test(text) ? text : `https://${text}`;
    if (/\/\/(maps\.app\.goo\.gl|goo\.gl|g\.co)\//i.test(url)) {
      if (window.KL_LOCAL) throw new Error('Short links open only in the real app. Open the link, then copy the plus code or the full link.');
      url = (await api('/api/geo/link', { json: { url } })).url;
    }
    const got = parseMapsLink(url);
    if (!got) throw new Error('Could not read a place from that link. Copy the plus code from Google Maps instead.');
    if (got.lat !== undefined) return { point: { lat: got.lat, lng: got.lng, label: 'From the Google Maps link', exact: true } };
    return placeFind(got.text, got.near || near);
  }
  const full = text.match(OLC_FULL);
  if (full) { const p = olcDecode(full[1]); if (p) return { point: { ...p, label: `Plus code ${full[1].toUpperCase()}`, exact: true } }; }
  const short = text.match(OLC_SHORT);
  if (short) {
    const where = text.replace(short[1], '').replace(/^[\s,]+|[\s,]+$/g, '');
    let ref = near;
    if (where) { const r = await geoGet('search', { q: where }); if (r.rows?.length) ref = r.rows[0]; else throw new Error(`Could not find "${where}" to place the plus code. Try the full plus code.`); }
    if (!ref) throw new Error('Add the town after a short plus code, e.g. Q7XC+2V Surat');
    const p = olcRecover(short[1], ref.lat, ref.lng);
    if (p) return { point: { ...p, label: `Plus code ${short[1].toUpperCase()}${where ? ` ${where}` : ''}`, exact: true } };
  }
  const r = await geoGet('search', { q: text, ...(near ? { near: `${near.lat},${near.lng}` } : {}) });
  if (!r.rows?.length) throw new Error(`Nothing found for "${text}". Try the plus code or paste the Google Maps link.`);
  if (r.rows.length === 1) return { point: { ...r.rows[0], exact: false } };
  return { choices: r.rows };
}

/* ---------------------------------------------------------------- the search box above a map */
KL.mapFinders = KL.mapFinders || {};
/** A search box for the map `id`; `bindMapSearch` says where the map is and what to do with the place. */
const mapSearchBar = (id, placeholder = 'Search a place, plus code or coordinates, or paste a Google Maps link') =>
  `<div class="map-find"><div class="row" style="gap:8px"><input id="${id}-q" class="input" value="${esc(F(`${id}-q`, ''))}" placeholder="${esc(placeholder)}" data-input="mapFindText" data-key="${id}-q" data-mapfind="${id}" enterkeyhint="search" autocomplete="off" />
    <button type="button" class="btn" data-action="mapFind" data-map="${id}" aria-label="Search">${ic('search')}</button></div><div id="${id}-res" class="map-find-res" role="listbox"></div></div>`;
function bindMapSearch(id, { near, pick }) { KL.mapFinders[id] = { near, pick }; }
Inputs.mapFindText = (el) => setF(el.dataset.key, el.value);
Actions.mapFind = async (el) => {
  const id = el.dataset.map, f = KL.mapFinders[id], res = $(`#${id}-res`), q = $(`#${id}-q`);
  if (!res || !q) return;
  if (!f) { res.innerHTML = '<p class="hint">The map is still loading. Try again in a moment.</p>'; return; }
  res.innerHTML = `<p class="hint">Finding…</p>`;
  try {
    const r = await placeFind(q.value, f.near?.());
    if (r.point) { res.innerHTML = ''; f.pick(r.point); return; }
    KL.mapChoices = r.choices;
    res.innerHTML = r.choices.map((x, i) => `<button type="button" class="map-find-row" data-action="mapChoose" data-map="${id}" data-i="${i}"><b>${esc(x.name)}</b><span>${esc(x.label)}</span></button>`).join('');
  } catch (e) { res.innerHTML = `<p class="hint err">${esc(e.message)}</p>`; }
};
Actions.mapChoose = (el) => {
  const f = KL.mapFinders[el.dataset.map], x = (KL.mapChoices || [])[Number(el.dataset.i)];
  const res = $(`#${el.dataset.map}-res`);
  if (res) res.innerHTML = '';
  if (f && x) f.pick({ ...x, exact: false });
};
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target?.dataset?.mapfind) { e.preventDefault(); Actions.mapFind({ dataset: { map: e.target.dataset.mapfind } }); }
});

/* ---------------------------------------------------------------- Map / Satellite */
/** The street map and the satellite photos, with a switch on the map; the last choice is remembered on this phone. */
function addBaseLayers(map) {
  const street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });
  const sat = L.layerGroup([
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, maxNativeZoom: 18, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' }),
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, maxNativeZoom: 18 }),
  ]);
  let mode = 'map';
  try { mode = localStorage.getItem('kl.mapLayer') || 'map'; } catch { /* private window */ }
  (mode === 'sat' ? sat : street).addTo(map);
  const Ctl = L.Control.extend({
    onAdd() {
      const b = L.DomUtil.create('button', 'map-layer-btn');
      b.type = 'button';
      const label = () => { b.textContent = mode === 'sat' ? 'Map' : 'Satellite'; b.setAttribute('aria-label', `Show ${b.textContent.toLowerCase()}`); };
      label();
      L.DomEvent.disableClickPropagation(b);
      L.DomEvent.on(b, 'click', () => {
        if (mode === 'sat') { map.removeLayer(sat); street.addTo(map); mode = 'map'; } else { map.removeLayer(street); sat.addTo(map); mode = 'sat'; }
        try { localStorage.setItem('kl.mapLayer', mode); } catch { /* private window */ }
        label();
      });
      return b;
    },
  });
  new Ctl({ position: 'topright' }).addTo(map);
}

/* ---------------------------------------------------------------- a site's place: area line, plus code, Google Maps */
const areaText = (s) => [s.village, s.taluka ? (/taluk|tehsil|tahsil/i.test(s.taluka) ? s.taluka : `${s.taluka} taluka`) : '', s.district, s.state].filter(Boolean).join(' · ');
const googleMapsUrl = (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
/** The location strip on a site's page. */
function siteWhere(s) {
  if (!Number.isFinite(Number(s.lat)) || !(Number(s.lat) || Number(s.lng))) return '';
  const code = olcEncode(Number(s.lat), Number(s.lng));
  return `<div class="site-where">${areaText(s) ? `<span class="sw-area">${ic('pin')} ${esc(areaText(s))}</span>` : ''}
    <span class="sw-code">Plus code <b class="notr mono">${esc(code)}</b></span>
    <span class="sw-btns"><button type="button" class="btn small ghost" data-action="copyText" data-text="${esc(code)}">${ic('clip')} Copy</button>
    <a class="btn small" href="${esc(googleMapsUrl(s.lat, s.lng))}" target="_blank" rel="noopener" data-action="openOut">${ic('map')} Open in Google Maps</a></span></div>`;
}
Actions.openOut = (el) => window.open(el.getAttribute('href'), '_blank', 'noopener'); // the tap handler does not follow links that carry an action
