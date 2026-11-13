# Kshetralekha — working notes for Claude

Owner: Purv Kanani (director). Private HR + operations app for the company's field teams (biochar, agroforestry,
syngas gasifier projects in Gujarat). Prototype built 2026-11-09 in one session. Read README.md for what it does.

## Owner's requirements (2026-11-09, verbatim intent)
- Odometer photo at start and end of a trip for travel allowance.
- Selfie check-in at a site with location recorded; allowed only at the location; same for check-out. "Always on"
  location was asked; decided against background tracking (battery, iOS limits) — location is captured with every
  action instead, and the on-site status is visible to managers.
- Field documents: farmer name, a company-signed template, farmer signs in a box, saved to a folder; KML, land
  records uploaded alongside.
- Biochar: diesel, biomass in/out and finished biochar registers with stock per site; every movement needs a
  geotagged, time-stamped photo. Similar for syngas gasifier.
- Employees get HR documents, daily work update, complaints and suggestions.
- "Comprehensive"; company uses Microsoft 365 Business, but **field staff have no M365/email/Teams** — only
  middle managers and office staff do.

## Decisions
1. **Stack**: vanilla PWA (no build) + FastAPI + SQLite + files on disk, like the owner's other apps. Python venv
   at `.venv` (made with `D:\PersonalBooks\tools\uv\uv.exe`). Run with `scripts\serve.ps1` (HTTPS, self-signed cert
   via Git's openssl) or `-Http` for localhost. Dev tests use port 8788 (8765 is Kuberlekha's).
2. **Two sign-in doors**: Employee ID + PIN (PBKDF2, device token, 5 wrong PINs = 15 min lock) for everyone now;
   Microsoft Entra sign-in for office staff later (`users.entra_oid` reserved). Roles: admin, manager, hr, field.
   Field staff see only their assigned sites (`user_sites`; none assigned = all).
3. **Evidence model**: client burns a stamp (who/what, date-time, GPS ± accuracy) into every photo (≤1280 px JPEG);
   server stores SHA-256, GPS, time, uploader for every file (`files` table). Files go to `data/files/<tree>` via
   `storage.LocalStore`; the tree mirrors the future SharePoint library (`SharePointStore` stub documents the Graph
   calls). Camera is opened with `capture=` so photos are live, not from the gallery.
4. **Geofence**: inside = distance ≤ site radius + min(GPS accuracy, 50 m). Outside → only "request exception"
   with a reason → `attendance.status='pending'` → manager accepts/rejects. Check-out same.
5. **Trips**: start/end reading + photo + GPS; km = difference; amount = km × rate per vehicle (settings.travel);
   straight-line distance between GPS points shown to the approver; >1,500 km or end < start refused.
6. **Registers**: `register_items` per site (input/product, unit, low-stock); `movements` in/out/count with
   `balance_after` computed server-side; out > stock refused; count stores `variance`; low-stock and variance
   notify managers; CSV audit export per site with photo hashes.
7. **Farmers**: registry + plots (declared vs KML area; KML parsed with stdlib, equirectangular shoelace) +
   files (kml, land_record, id_proof, photo, other). **Documents**: template body with `{{placeholders}}` + fields
   JSON; farmer signs on a canvas; server renders the PDF (reportlab) with the company's authorised signature
   (Admin upload; placeholder PNG seeded), farmer signature, recorder, GPS, time, signature SHA; doc no
   `KL/<year>/<00001>`. Signing requires a connection.
8. **HR self-service**: hr_documents (HR/admin upload per employee), work_updates (one per day, editable),
   leaves (pending → manager/HR), feedback (complaint/suggestion, optional anonymous → user_id NULL), inbox
   (`notifications`, badge on tab), change PIN. Managers: dashboard, approvals, team, HR desk, admin pages.
9. **Offline**: service worker caches the shell; multipart submissions that fail with a network error go to an
   IndexedDB outbox (`Outbox`) and flush on `online`/visibility/sign-in; 4xx replies drop the item with a toast.
10. **UI rules**: typing never re-renders (a re-render steals the next tap); live figures go in `#preview` via
    `KL.ui.previewFn`; buttons are disabled only on photo/GPS state, typed fields are validated on tap. Form
    values live in `KL.ui.forms` (`F/setF/clearF`); when a view shows a default with `F(key, default)`, the save
    must use the same default (bug fixed twice this session).
11. **Not built yet / parked**: Microsoft sign-in, SharePoint storage, Teams/email notifications, WhatsApp/SMS,
    Power BI, vehicle/asset register, expense claims with bills, multilingual labels, push notifications, PDF
    templates uploaded as files (templates are text + fields for now), map view of sites/plots.

12. **Brand / UI (2026-11-12)**: owner rejected the first UI ("make it modern, sustainability startup"). Now: Sajeevan
    logo (`frontend/logo.png`, white made transparent by `scripts/logo-alpha.py`), palette from the logo (leaf
    #58a870 / deep #2e7a4b, earth #684828, cream/sand background), Plus Jakarta Sans (superseded by decision 13),
    line SVG icons (`ICONS` + `ic(name)` in core.js; no emoji), hero greeting card on Home, floating pill tab bar,
    soft shadowed cards, pill buttons, dark mode. Company seeded as Sajeevan Life Pvt Ltd; PDF letterhead in brand green
    with an earth rule. `scripts/deemoji.py` was the one-off emoji → icon migration.

13. **Redesign v0.2.0 (2026-11-14)**: owner: "feel like a real modern app ... fonts, colour, animations, logo, branding".
    Own mark `frontend/icon.svg` (forest tile, lime sprout over cream field rows; PNG icons rendered from it).
    Bricolage Grotesque (headings) + Plus Jakarta Sans (text), self-hosted in `frontend/fonts` (OFL) so offline looks
    the same. Tokens on `:root` in styles.css (forest #0e3b2a / brand #1e7a4c / lime #c6e86a on paper #f5f3ec),
    light/dark/auto (Me → Appearance). Motion: route-enter stagger only on route change (`main.view.enter`), sheets
    slide up, skeleton loaders, count-up numbers (`num(n, key)` + `countUp`, once per key per route), success overlay
    (`celebrate`). Phones: floating tab bar; ≥1040 px: sidebar. `data()` is stale-while-revalidate (`KL.stale`) so
    screens never flash after `invalidate`.
14. **Planner (MS Planner model)**: `backend/planner.py` (plans → buckets → tasks; priority urgent/important/medium/low;
    progress not_started/in_progress/completed; labels by colour named per plan; checklist; assignees; comments;
    photo_required). Managers/HR/admin create and edit (every field saves at once, as in Planner); assignees move,
    tick, comment and complete. Assigning notifies the person; completing notifies the creator, the managers of the
    plan's site and admins (inbox link `#task/{id}` opens the task sheet). Front end `views-planner.js`: hub (plans
    + my tasks by due group), plan Board (group by bucket/progress/due/person/priority/labels; HTML5 drag and drop
    between bucket, progress and priority columns), Grid, Charts. Task sheet lives in `#sheet` (prompts use `#modal`
    above it). Field tabs: Home, Work, Tasks, Inbox, Me; staff: Home, Planner, Manage, Inbox, Me.
15. **Prototype aids (KL_DEMO=1, default)**: `backend/demo.py` seeds two weeks of realistic activity (attendance,
    trips, stock, farmers with KML and signed PDFs, leave, updates, 3 plans / ~17 tasks) and `POST /api/demo/reset`
    rebuilds it (Admin → Reset the demo). Sign-in shows one-tap people (`GET /api/demo`); a "View as" pill (phone)
    or sidebar button switches person without a PIN (`POST /api/demo/switch`). Demo location (`DemoLoc`, ribbon on
    GPS screens: At site / Away / Real GPS) so check-in works on a PC. In-app camera (`openCamera`, getUserMedia)
    with file fallback and, in demo only, drawn sample photos stamped "DEMO SAMPLE PHOTO". Set KL_DEMO=0 for real use.

16. **GitHub Pages build (2026-11-14)**: owner wanted it on the phone without a server. `scripts/build_pages.py`
    copies frontend/ plus backend/*.py (into `local/backend/`) and `local/manifest.json`; `scripts/publish-pages.ps1`
    force-pushes that to the `gh-pages` branch. On *.github.io (or `?local=1`) `frontend/local/pyhost.js` starts
    `local/pyworker.js` (a **module** worker: classic importScripts from the CDN failed) which loads Pyodide 314.0.7
    from jsDelivr (packages fastapi, pillow, micropip, charset-normalizer; wheels for reportlab and
    python-multipart in `frontend/local/wheels`), mounts IDBFS at /kl/data and calls the ASGI app directly.
    `window.fetch` is patched for `/api/*`; links to `/api/*` (PDFs, CSV) are fetched and opened as blobs.
    Browser-only settings: KL_JOURNAL=DELETE (no WAL), KL_PBKDF2_ITER=3000 (no OpenSSL there; `auth._pbkdf2_sha256`
    is the pure fallback, checked equal to hashlib). anyio.to_thread.run_sync is replaced by an inline call (no
    threads). JS null arrives in Python as JsNull: pass `undefined`. Test: `.cache\kl-pages-test.mjs` (10 checks).

## Testing
- `D:\PersonalBooks\.cache\kl-e2e.mjs` (2026-11-14): resets the demo, then manager assigns a photo-proof task →
  worker gets inbox item, ticks checklist, completes with sample photo → manager inbox "Task done" with note and
  proof → field check-in with demo location → desktop drag between buckets (18 checks). `kl-tour.mjs <prefix>`
  screenshots every screen (phone + desktop) into `.cache\kl-shots`. Run node from `D:\PersonalBooks\tools\node`
  with PLAYWRIGHT_BROWSERS_PATH=D:\PersonalBooks\.cache\playwright.
- `scratchpad/kl-reset.sh` (session 31b0f6ef) kills the dev server on 8788, deletes `data/*.sqlite` + `data/files`,
  restarts; `kl-e2e.cjs` is the Playwright suite (Edge, mocked GPS at the Rajkot site; ~40 checks): field day →
  manager approvals → HR desk → field inbox. `kl-sign-debug.cjs`, `kl-debug.cjs` are focused repros.
- Playwright gotchas found: scroll the signature canvas into view before drawing (mouse events need the element
  inside the viewport); wait for `#modal` hidden with `waitForFunction`, not a hidden-element selector; the
  browser caches GPS for 10 s unless `fresh` (locate(true) passes maximumAge 0).
- Bash heredocs in this environment mangle backslashes: write patch scripts with the Write tool, or use the Edit tool.
