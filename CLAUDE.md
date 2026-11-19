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
    force-pushes that to the `gh-pages` branch. BUT Pages on this repo is set to serve `main` (root), and changing
    that setting via the API was refused, so the live site is `main` itself: root `index.html` redirects to
    `frontend/`, `.nojekyll`, and `frontend/local/manifest.json` (written by build_pages.py) has backendBase
    `../../backend/`. Push to main = publish. Owner can switch Pages to gh-pages in Settings if wanted. On *.github.io (or `?local=1`) `frontend/local/pyhost.js` starts
    `local/pyworker.js` (a **module** worker: classic importScripts from the CDN failed) which loads Pyodide 314.0.7
    from jsDelivr (packages fastapi, pillow, micropip, charset-normalizer; wheels for reportlab and
    python-multipart in `frontend/local/wheels`), mounts IDBFS at /kl/data and calls the ASGI app directly.
    `window.fetch` is patched for `/api/*`; links to `/api/*` (PDFs, CSV) are fetched and opened as blobs.
    Browser-only settings: KL_JOURNAL=DELETE (no WAL), KL_PBKDF2_ITER=3000 (no OpenSSL there; `auth._pbkdf2_sha256`
    is the pure fallback, checked equal to hashlib). anyio.to_thread.run_sync is replaced by an inline call (no
    threads). JS null arrives in Python as JsNull: pass `undefined`. Test: `.cache\kl-pages-test.mjs` (10 checks).

17. **v0.3.0 modules (2026-11-14)**: owner: "prepare it as just prototype, all in one go, with demo data and an
    option to add data". `backend/modules.py`: KINDS registry (fields, create = all/staff/hr, scope =
    own/site/all/staff, approval chain key, statuses, photo, geo) over one `records` table (JSON data) with generic
    endpoints `/api/m/{kind}` (list, get, multipart save, status, check, delete), `/api/m-export/{kind}.csv`,
    `/api/m-approvals`, `/api/m-steps/{kind}/{id}/decide`, `/api/m-ack/{policy}`. Approval chains in
    `approval_steps` (settings `approval_chains`; role `manager` = users.manager_id); leave uses the same chain.
    Special logic: leave balances, attendance_month, close_missed_checkouts (called from /api/me), (payroll removed in v0.5), TOTP for office accounts (login returns 401 {need2fa}), stock postings for batch /
    application / transfer / dispatch / PO received (`modules.post`), incident and checklist follow-up tasks in the
    "Safety & maintenance actions" plan, carbon_chain + PDF, map data, left-site alert, consent, my-data export,
    simulated WhatsApp log (Db.notify is wrapped). Migrations add users.manager_id/consent_at, sites.strict,
    attendance.flag. `demo_modules.seed` fills every kind. Front end `views-modules.js` (generic list/detail/form +
    people, attsum, carbon, map with Leaflet from cdnjs, reports, hrsettings, messages, privacy, security,
    I18N text-node translation gu/hi, DutyWatch). Owner: native-only parts (push, background location) are NOT
    built; a "For reviewers" note (reviewerNote()) explains them.

18. **Projects and sites (2026-11-14)**: owner: divide by project; field staff see only their site, middle managers
    only the projects/sites they manage, management everything; HR assigns; site screens as simple tabs per type;
    planner may be general (no site); a person with no site uses HR + Planner only. Model: sites.project_type
    (biochar, gasifier, agroforestry, office) + sites.subtype (biochar: kiln | plant); `user_sites` (works at) +
    `user_projects` (manages whole project). `app.resolve_access` sets user.sites / all_sites (admin, hr) /
    projects; `site_allowed` no longer treats "no sites" as all. `modules.team_ids` scopes team lists (attendance,
    trips, updates, leave, approvals, dashboard, people, records). Planner: managers see plans of their sites,
    General plans, their own. Endpoints `/api/hr/assign`, `/api/hr/site-member`, `/api/sites/{id}/summary`. New kinds
    `gas_run` (posts feedstock/diesel out, power/ash in) and `nursery` (balance = sown + received − died − planted).
    Front end `views-sites.js` (SITE_TABS, recMini, Views.sites/site/mysite/assign, worksAt); tabs: field Home ·
    My site · Tasks · Inbox · Me, staff Home · Sites · Planner · People (Views.hr) · Inbox. KL.ui.siteBack returns
    record screens to the site tab. Demo: 7 sites (Lodhika, Viramgam, Balaji, Nava, Deesa, Salariya, Head Office),
    users EMP005/106/107 added. Tests: `kl_access_check.py` (16), `kl-e2e4.mjs` (13).

19. **Pay is in Zoho (2026-11-14, v0.5.0)**: owner: "remove payroll. i have payroll in my zoho ERP" (Zoho does payroll,
    PF, ESI, PT, LWF, TDS, Form 16, salary payment). Payroll screens, payslips, bank file, Tally voucher, salary and
    bank fields removed. New `backend/hrops.py` (+ `frontend/views-hrops.js`): month end (`att_periods` with a JSON
    snapshot, `att_reviews` per manager; lock only after the month; admin-only unlock with reason;
    `hrops.assert_open` guards regularisation save/decide, leave apply/decide, check-in exception decide, muster);
    Zoho export `/api/hr/month/{m}/zoho.csv|zoho-lop.csv|export.json` (LOP = A + unpaid leave + ½ H; MC counts
    as present); `change_log` (log_change, written by profile save, assign, site-member, HR settings, decisions,
    muster re-marks, lock/unlock, user save); muster roll / leave register PDF+CSV; crew muster (`muster_sheets`,
    `muster_lines`; users.app_access=0 cannot sign in, users.supervisor marks own sites; only app_access=0 people
    are markable; attendance_month reads muster P/H); complaints moved from app.py to hrops (tracking code stored
    as SHA-256 `feedback.track_hash`, `feedback_msgs` thread, category `posh` visible only to IC members in setting
    `posh`, desk `#poshdesk`); `notices` + `notice_reads` (audience all/project/site; managers only their own);
    `surveys`/`survey_done`/`survey_answers` (anonymous answers carry no user and only the day; results from 3).
    Demo: crew EMP201-205 (Lodhika, Deesa), supervisors Jignesh and Asha, last month locked, code KL-DEMO-2026.
    Tests: `kl_hrops_api.py` (50), `kl-e2e5.mjs` (21); `kl-e2e3.mjs` step 6 now checks month end.

20. **UI redesign (2026-11-14, branch `ui-redesign`)**: owner asked for an enterprise HCM look (Workday/Keka class:
    calm, structured), UI only. Design system in `design-system/MASTER.md` (tokens at the top of styles.css: one
    accent #1C6B45, neutrals, status colours, IBM Plex Sans + Noto Gujarati/Devanagari, AA contrast). Shared
    pieces in core.js: `topbar` (breadcrumb + `syncChip`), `dataTable`, `kpi` + `sparkline`, `timeline`,
    `drawerShell`, `STATUS` chip vocabulary, `field(..., {help, required})`, quiet `celebrate` (still `.success`).
    Shell in app.js: `navGroups()` sidebar (collapsible, `kl.side`), record drawer on desktop for `#rec/kind/id`.
    Role homes and the unified approvals queue in `views-home.js`. Summary: `docs/ui-redesign/README.md`.
    Test `kl-e2e6.mjs` (27). Old colour names (--brand, --forest, --lime ...) are gone; use the new tokens.

21. **Field-staff app (2026-11-14)**: owner found the redesign too busy for field staff; approved a clickable mockup
    (claude.ai artifact WrEWQNVckuGH7TG7YzbWQR) and asked to build it for all field staff and all three projects,
    and to put sites inside each project. `views-fieldapp.js`: tabs Today · Site · big + · Requests · Me (app.js
    TABS_FIELD_ALL, FIELD_TAB, body.field-ui = 17 px type, 52-60 px buttons); app bar with bell (#inbox) and avatar.
    Today = green attendance card + To do (late tasks, crew muster, notices, due tasks, surveys, update; max 4).
    Site = 3 numbers per project, Add entry sheet with project tiles (`siteAddTiles`), "All site records" → the
    old tabs. Requests (#requests) = leave + expense + advance + correction with status. Me = 6 rows; #settings
    holds language, theme, PIN, privacy, reviewer note. `projectGroups()` = project panel with its sites inside,
    used by everyone's Sites page and the sidebar tree. Managers/HR/director screens unchanged. Test: kl-e2e7 (18).

22. **Fixed-word translation (2026-11-16)**: owner: "just have fixed words translation everywhere" (live machine
   translation of typed text skipped for now). `frontend/i18n.js` translates every text node and placeholder /
   aria-label / title through a MutationObserver, so screens need no changes; dictionaries `i18n.gu.js` and
   `i18n.hi.js` (~1,960 texts each) are generated, with `{n}` (number) and `{x}` (any text) placeholders, `{1}` `{2}`
   to reorder. Owner: "keep numbers and other normal generic stuff in english": digits 0-9, dates, times, units,
   codes and brand names stay English (`appLocale()` is always en-IN). People's typed data is never translated.
   Review sheet: `docs/translations.csv`. To add texts: run the collectors in D:\PersonalBooks\.cache
   (kl-strings.mjs, then the scratchpad extract/build/clean scripts), translate the new keys, rebuild; quick fixes
   go in `D:\PersonalBooks\.cache\kl-tr\overrides.json`. Too-loose patterns (`{x} to {x}`) are excluded so typed
   text is not half-translated.
23. **Release plan (2026-11-16)**: for now only the owner uses the live app; staff get it in versions once it is free of
   bugs. The owner will rework the UI and tab grouping later (idea only, not started). Security items wait until the
   field-staff release: one phone per account with HR approval for a new phone, hardening (image rebuilds, session
   expiry, sign out everywhere, rate limits, headers, upload checks), Microsoft sign-in for office staff.

24. **Simple navigation for office roles (2026-11-16)**: owner (director) found the app confusing: language hard to find,
   the same links in several places (Administration in the sidebar and in People). Now five sections, each screen in
   exactly one: Home · Inbox (Approvals, Messages) · Operations (Sites, Planner, Records, Carbon, Map) · People
   (Directory, Attendance, Activity, Month end, Records, Notices, Surveys, HR desk) · Reports (Reports, Dashboard), as
   tabs on the section page (SECTIONS in app.js). Settings (gear) holds language, appearance, account, two-step,
   Administration, HR settings; your own items are under your name (#me). Language button on every screen (phone top
   bar, sidebar foot). Old link-list pages (#hr, #manage, hub/*) redirect. Field-staff app unchanged.

25. **Employee codes (2026-11-17)**: owner chose project code + 2-digit reporting office + running number, e.g.
   BIO01001 (BIO biochar, GAS gasifier, AGR agroforestry, ADM management). Generated by the server when HR adds
   someone (`next_employee_code` in app.py; HR picks project and office, cannot type a code for new people); per
   project+office series, never reused, never changed by a transfer. Offices live in the `offices` setting
   (Administration > Company; demo 01-05, production starts with 01 Ahmedabad). Existing codes (EMP001, demo EMP…)
   unchanged. Test: .cache/kl_empcode_check.py (16).

26. **Settings > Lists (2026-11-17)**: owner: every dropdown editable in a new Settings tab, "adding new as a role and
   deleting it with a dustbin icon ... i dont want a paragraph based one"; an item in use cannot be deleted.
   `backend/lists.py` owns them: roles (name + access level field/manager/hr/admin; picking a role sets users.role and
   users.designation), reporting offices, projects (built-ins BIO/GAS/AGR + ADM management stay; added projects get
   the general site screens Overview/Stock/Safety/Team and general + tiles), leave types, travel vehicles with rate,
   employment types and the record forms' option lists (FORM_LISTS). Saved in settings (`roles`, `offices`,
   `projects_custom`, `lists`, `leave_types`, `travel`); `lists.sync()` copies them into KINDS / PROJECTS at start-up,
   after a change and after a demo reset. Optional Gujarati/Hindi names per item (`list_tr`, merged in i18n.js).
   HR edits People lists; the director edits all. Company page lost its paragraph boxes. Production start-up renames
   the director's EMP001 to ADM01001 once (`migrate_admin_code`, owner asked "change mine too").
   Tests: .cache/kl_lists_check.py (31), kl-lists-ui.mjs, kl-mecard.mjs (card shows designation, refreshes on save).

27. **Bug sweep (2026-11-17)**: owner asked for a field-employee bug sweep A to Z with a report. 45 bugs fixed, report in
   docs/bug-sweep-2026-11-17.md. Key rules now: token secret in settings.token_secret (live disk is temporary);
   device row must exist for a token (PIN reset signs out); must_change_pin blocks saves until changed; outbox items
   carry userId/seq/clientId, are sent in order, kept with a reason when refused (Settings > Could not send);
   X-Client-Id middleware returns the first reply to a resend (client_requests table); taken_time() trusts the phone
   clock only within 10 min live / 7 days queued; one open check-in/trip re-checked before insert; stock balance by
   rowid; notify_role honours user_projects; planner edits send only changed fields, ticks match by text, completion
   idempotent. Tests: .cache/kl_bugsweep_check.py (36), kl-bugsweep-ui.mjs (12).
28. **Roles & permissions (2026-11-18)**: owner asked for role-based permissions with approval limits ("leave upto x
   days and more than x days"), travel approved by the reporting manager AND the accounts & finance team, and
   departments (GAS + BIO one department, AGR one). No per-person exceptions for now. Built: backend/perms.py +
   frontend/views-perms.js, Settings > Roles & permissions (director only): access level per role (moves its people),
   tick grid for Manager/HR-level roles (field-level roles get no office tools), approval rules per request type
   (steps in order, first always decides, later steps join when amount > `over`; old rules with `min` still read).
   A role = users.designation; never-ticked roles get their level's defaults (= behaviour before). Approvers can be
   the reporting manager, a role, a department's team (anyone in it, never the requester; director if nobody else),
   HR or the director. Trips now go through approval_steps (kind 'travel'); trips/leaves made before keep the old
   single decision. Departments: setting `departments`, users.department, else from the employee-code project;
   editable in Settings > Lists. Visibility (sites, people) still follows the access level. Demo adds EMP004
   Accounts Executive. Tests: .cache/kl_perms_check.py (48), kl-perms-ui.mjs (18).

29. **Half-day leave, withdraw, GPS that waits (2026-11-18)**, for the field trial. Half day: leaves.half
   ('' / first / second), one date only, 0.5 day in balances, approval amounts, register and Zoho export; two halves
   of one day are allowed, overlaps refused. attendance_month: paid half leave + any work = P, unpaid half + work = H,
   half leave and no work = H (paid half) or A (unpaid); each day carries leave_days / leave_type (export counts
   them). Withdraw (status 'withdrawn', record kept, open steps closed, approvers and the manager told): own leave
   while pending or approved before its first day; own travel claim while submitted; own approval records
   (expense, advance, purchase, farmer payment, attendance correction) while pending. GPS: phones give a tower /
   Wi-Fi guess first, so locate() keeps a watchPosition open up to 30 s, keeps the best reading, stops at ±15 m;
   check-in, check-out and trips wait for ±work_hours.gps_accuracy_m (default 50, HR settings) and after 30 s allow
   a weak reading (button and record say "weak GPS"); readings over 2 min old are refreshed before saving; ±1 km+
   shows how to turn on precise location. Only the GPS parts repaint while the reading improves (data-gps), so
   typing and taps are not lost. Site editor: "Set to where I am standing now" takes a careful 30 s reading.
   Fake-GPS detection needs the native Android app (later). Tests: kl_halfday_check.py, kl-halfday-ui.mjs.

30. **Easy workflows (2026-11-19)**: owner: "make it simple", "+" everywhere, every employee detail at creation,
   geofence for every project, fewer steps for HR / director / co-founder. frontend/views-forms.js:
   office "+ New" (centre of the phone tab bar, top of the sidebar; tiles filtered by permission, "More…" lists
   every record kind), quickAdd() row on the three home dashboards, "+" on Sites (and each project panel), both
   Records hubs, Directory (straight to the form) and Map. One-page employee form #empnew / #empedit/<id>
   (personedit redirects): job (code preview, designation and office can be added inline, reports to, site chips),
   personal, employment, IDs and bank (bank_name / bank_account / bank_ifsc in PROFILE_FIELDS; bank_account is
   SENSITIVE), documents (uploaded after save to /api/hr/documents; masked Aadhaar only). Saves = /api/admin/users,
   then /api/hr/profile (users.add may write a first profile), then documents. Masked values ("•••• 42") are never
   saved back. One-page site form #sitenew / #siteedit/<id> with a Leaflet map (tap / drag / "where I am standing"),
   radius slider, check-in rule sites.strict 0 exceptions / 1 check-in only inside / 2 check-in and check-out only
   inside (checkout enforces 2), team chips (payload `team`, needs users.assign). Circle only (polygon later).
   "Role" is now "Designation" in every screen (the list key stays `roles`; users.designation). Custom access levels
   (setting access_levels [{key lv_*, name, app office|field, sees team|company, perms}]): users.role holds the base
   (office -> manager, field -> field), users.level the custom key; all_sites when sees = company; a never-ticked
   designation starts from the level's perms. Settings > Designations & access has an Access levels card.
   POST /api/admin/lists/{roles|offices|departments}/rename (designation rename moves users, role_perms, rules and
   open approval steps). Note: an employee with no site cannot check in anywhere (blank is NOT "all sites").
   Tests: kl_workflows_check.py, kl-workflows-ui.mjs (36).
   Sweep (same day, owner: "flawless"): site team is saved as teamAdd / teamRemove (a team that never loaded can
   no longer empty a site; permission checked before any write); GET /api/admin/sites lists closed sites so they
   can be reopened; a custom office level is NOT a line manager (month-end list and confirm, manager approval steps
   and fallback approver, legacy decisions, notify_role all require COALESCE(level,'')=''); users.add may write
   only the first profile of someone they added in the last 2 hours; ID / bank numbers are written only by HR,
   the director or that first profile; both halves of one day keep their own types (leave_parts per day, the
   Zoho export counts parts); a half-day leave does not lock the muster; withdraw / approve / final status use
   conditional UPDATEs (Db.change) so a second tap or a race does nothing; HR cannot rename a director-level
   designation; employee save validates sites (must exist, list), name (80) and starting PIN (4–6 digits);
   service worker no longer answers failed cross-origin files (Leaflet, tiles) with index.html; GPS: no
   restart loop when location is blocked, a finished weak reading stays usable, skipped repaints happen on
   focusout; site map is removed before redrawing and its tooltip escaped; captions of chip / radio groups are
   not <label>s (fieldGroup). Tests: kl_sweep_probe.py, kl-sweep-ui.mjs (38).
31. **Redesign + committees (2026-11-19)**: owner approved the prototype (claude.ai/artifact/FPnhQbPP7SRumKQacV9yF7)
   and "build this into the real app". One app, two faces. Look: Plus Jakarta Sans (frontend/fonts, OFL), pastel
   round icons, soft shadows, pill tabs, 50 px buttons, a CSS layer at the end of styles.css over the old tokens.
   Office Home: hello header (bell + photo), "needs you" card (#approvals), Today tiles (on site / late / on leave /
   travel, from dashboard() late, onLeave, travelPending) and a Sites list (sitesToday). Field app: no app header
   (body.field-ui .apphead hidden), fieldBar(title, sub) is the hello header; Today = check-in card (GPS line) + 4
   tiles (Travel, Leave, Expense, Daily update) + to-do; "+" holds personal things only plus "Site work"; Requests
   has six new-request buttons and lists travel claims too; leave length and type are pills (core.js pills()).
   Inside a site (views-hub.js siteHub): "What do you want to do here?" tiles by project (stock, safety check from
   /api/sites/{id}/summary .safety, batch / run / nursery / saplings / survival, farmers, report a problem, team,
   crew attendance); office staff also get "Site records" (the old tabbed #site/<id>/<tab>). #site/<id> with no tab
   and #mysite/<id> both show the hub. People > Daily updates (#dailyupd, admin / hr / manager): sent / not sent,
   "Need any help?" (work_updates.blockers), Remind (/api/updates/remind), Message (/api/updates/reply), Make it a
   task (planner); Activity keeps attendance and trips only. Approvals are compact cards with Details folded.
   Committees (backend/committees.py; tables committees, committee_members; feedback gains committee_id, policy,
   against, excluded, outcome, closed_at, mail_status, named_at): POSH Internal Committee posh@, Workplace Health &
   Safety safety@, Grievance grievance@, Suggestions suggestion@ (sajeevan.co.in; each its own mailbox). Created without
   members (HR adds them at #committee/<id>); the old "posh" setting's committee is imported once. Routing: POSH
   switch -> POSH; suggestion -> Suggestions; else the committee whose policies list the chosen policy ("Not sure"
   -> Grievance). Visible: members + HR + director, except POSH (members only; HR / director only while it has no
   members). Names in "Against whom" are matched to employees (first + last name, or employee ID) and stored in
   feedback.excluded: they never see the case, are not notified, cannot act. A case is closed only with an outcome.
   Old feedback rows are routed once (route_old_cases). Anonymous: user_id NULL + hashed tracking code (as before);
   the phone keeps the codes in localStorage kl-anon:<user id> so "Sent by you" lists them on that phone only;
   "Add my name" (/api/feedback/track/name). Anonymous "Report a problem" (incident): records.user_id / created_by,
   files.uploaded_by and the audit line are NULL, photo stamp says "Anonymous report", a photo taken before the
   switch is dropped. Email: committees.mail_case() sends with Graph /users/{mailbox}/sendMail from the mailbox to
   itself, in a thread, only when KL_MAIL=on (needs the app registration's Mail.Send APPLICATION permission with
   admin consent; result in feedback.mail_status). Screens: #feedback (branched form), #committees (everyone),
   #cases (inbox), #case/<id> or #case/<KL-code>, #committee/<id|new>; #poshdesk opens #cases on POSH.
   Tests: kl_cases_check.py, kl-cases-ui.mjs.
   Reference numbers (owner, same day: "a tracking id by year to everything"): TYPE-FY-NNNN, e.g. LV-2026-27-0014;
   financial year April-March; one counter per type (table ref_counters, code + fy, UPDATE ... RETURNING so two
   phones never share a number); numbers are never reused (withdrawn / deleted keep theirs). Db.insert numbers rows
   of work_updates DU, leaves LV, trips TR, tasks TK, feedback CP / SG (POSH is CP too), attendance CE (only
   exceptions; a check-out exception numbers it then), records by kind (db.REF_RECORD_CODES; lists such as
   suppliers, holidays, policies get none; batches keep their B- code). db.ensure_refs() adds the column and numbers
   old rows oldest first; it runs after every init (app start, demo reset). Shown as refLine() on approval cards,
   Requests, record lists (searchable) and details, leave, trips, check-ins, daily updates, tasks, cases, the
   committee email and the record CSV ("reference" column). Tests: kl_refs_check.py.
   Email status 2026-11-19: owner granted Mail.Send (application) and an access policy for the four shared
   mailboxes (mail-enabled security group "Kshetralekha Mail", RestrictAccess; checked Granted / Denied); KL_MAIL=on;
   all four test emails received, also after the lock-down. A new committee mailbox must be added to that group.
32. **Sub-groups, offices, photos, policies; registers switched off (2026-11-19)**. Sites list by project then
   sub-group (lists.subgroups(), setting "subgroups", defaults Biochar kiln "Low-tech (kilns)" / plant "High-tech
   (industrial plant)" (keys fixed: they drive tabs; rename only), Agroforestry trust / farmer / retro; editable in
   Settings > Lists > Site sub-groups, POST /api/admin/lists/subgroups and /subgroups/remove; any project or
   office may have them). Site form asks the sub-group when the project has some; the server fills "kiln" for an old
   client's biochar site and leaves others "Sub-group not set". Offices are their own group in Operations > Sites
   (core.js siteGroups(), projMeta('office')); an office hub has no stock / kiln tiles. Profile card fix (old
   ".profile span {display:block}" broke the avatar and the tag row). Employee photos: users.photo_id, POST
   /api/people/{id}/photo (+ /remove), self or users.edit; client crops to a 384 px square JPEG; filed in HR/<code>
   <name>/; avatar() finds the photo by name from boot people. Tab rows keep their sideways scroll (keepTabRow).
   Switched off by the owner ("deactivate means hide"): training, goal, review, farmer_payment, gas_run
   (KINDS off + hidden; boot offKinds; isOff(); server refuses new ones; old data stays). "More…" removed from the
   office "+". Company policies (backend/policies.py, views-policies.js): HR uploads PDF (en, optional gu / hi),
   version, audience (notice audiences), must accept or reading only; anyone with an unaccepted required policy
   (current version) sees only "Before you start" (app.js gate; HR / director can still open #policies): open each
   PDF, tick, sign the declaration (setting policy_declaration) -> pdfgen.render_declaration PDF in HR documents
   (category "Policy declaration") + policy_ack {policy, version, declaration}; a new version asks again; HR sees
   accepted / not, Remind, Archive; onboarding checklist item "Policies accepted and declaration signed" is ticked
   by name. Crew without phones: HR uploads a paper declaration ("Policy declaration (paper)"). Demo users have
   accepted the demo policies. Tests: kl-tabrow.mjs, kl-photos-ui.mjs, kl-policies-ui.mjs.
   Storage (owner asked 2026-11-19): database = container disk + Litestream to Azure Storage (7 days, continuous) +
   nightly gzip copy to the SharePoint "Backups" library (30 kept); files = SharePoint only (no separate backup yet;
   offered a nightly copy to Azure Storage, not built).
33. **Who signs which policy (2026-11-19, v0.6.1)**. Owner: "upload everything. there are some policies meant for
   everyone. there are some only for biochar project workers, office workers, field workers in agroforestry, etc. so,
   allow me a option to assign who has to sign it or it is a general policy in the settings", and upload as reading
   only first. A policy's audience is Everyone or {"type": "groups", "items": [...]} of projects (Office counts),
   sub-groups ("project:key") and sites (policies.clean_audience / in_audience / audience_text; old single
   audiences still read). Someone is in a project / sub-group when they work at one of its sites or are assigned to
   the whole project. Signing: "General, for reading only" or "Must accept and sign"; new policies start as reading
   only. POST /api/policies/bulk (multipart files + version): each PDF a reading-only policy for everyone, titled from
   the file name without "(EN-GU-HI)" / "revised"; same name already there = skipped. POST /api/policies/{id}/who
   {audience, must_ack} changes it in place (asks the people when it becomes must-sign). Screens: Policies list
   grouped Must sign / General / Archived, "Upload several" (#policybulk), "Who and how" card on each policy,
   Settings > Administration > Company policies. The owner's 32 policies (Word, EN-GU-HI in one file) were turned
   into PDFs in OneDrive "Company Policies\PDF 2026.1" (older "PDF" folder left as it was; "Gender Equality ...
   Copy.docx" skipped as a duplicate); the owner uploads them on live. Test: kl-policies2-ui.mjs.

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
34. **Logo kit "Rooted Flame" (2026-11-19, v0.6.2)**. The owner's kit is kept in brand/ (SVGs + README; PNGs made by
   D:/PersonalBooks/.cache/kl-brand-render.mjs into brand/png). frontend/icon.svg = rounded icon; icon-192/512 (any),
   icon-maskable-192/512 (full-bleed square), apple-touch-icon (square, 180), favicon.ico; logo-h(-dark).svg in the
   phone header, sidebar (icon when collapsed) and sign-in; logo-stacked(-dark).svg + tagline "Every acre. Every
   batch. On record." on the splash; brandLogo() picks light / dark by theme in CSS. Install background #F4F1E8.
   PDF letterheads carry the circle mark (backend/brand_mark.py, PNG as base64 so the in-browser demo has it too).
   The Sajeevan company logo (logo.png) stays as "An app of" and in the Me footer. App colours and fonts unchanged.
   Owner: "it is a fully functional app now": the Me footer reads "Kshetralekha v<version> · <company>"; "For
   reviewers" shows only in the demo; HR settings no longer say "prototype".
35. **Sheets close with a pull down; no twin employees (2026-11-20, v0.6.3)**. Owner: the "+" sheet "can't close it with
   swipe down without choosing anything": core.js sheetSwipe() on every modal sheet (starts at the sheet's top, follows
   the finger, closes past 90 px or on a flick, else springs back) plus a close button on sheets without Cancel / OK.
   Adding employees is serialised (_NEW_USER_LOCK) and the same name added again by the same person within 60 s returns
   the first one (three quick taps made two employees). Test: kl-swipe-ui.mjs. The owner's own code change to
   ADM05001 is done by them in People > Edit (works; not done by Claude: live database access was refused).
36. **Map search, plus codes, area of a site (2026-11-20, v0.6.4)**. Owner: "google maps like search ... with plus codes",
   "it opens the coordinates or location from google maps link", "it gets taluka, district and state from the location
   link", "auto identify what enters box". Free services now; the owner moves to Google Maps (key, Places, Geocoding)
   with the Android app, so keep the seam: frontend/places.js (placeFind, placeArea, addBaseLayers, mapSearchBar /
   bindMapSearch) is the only place that talks to a map service. One box works out: Google Maps link (short
   maps.app.goo.gl opened by POST /api/geo/link, Google hosts only; full links read on the phone: !3d!4d pin, q= /
   query= / ll=, /place/ text, @ centre, consent page), coordinates (decimal or DMS), full plus code, short plus code
   with a town (OSM search) or near the map's view, else an OpenStreetMap place search (choices). Plus codes: Open
   Location Code in places.js (olcEncode/olcDecode/olcRecover; matches Google's example 8FVC9G8F+6X). Server
   backend/mapsearch.py (NOT geo.py, which is the geofence maths): /api/geo/search and /reverse via Nominatim (1 req/s,
   named User-Agent, cached); the in-browser demo asks Nominatim itself. Sites gained village, taluka, district, state
   (filled when the centre moves, editable; " Taluka" suffix dropped). Map / Satellite switch (Esri World Imagery,
   remembered per phone) on both maps; site form shows the plus code with Copy; site page shows area, plus code, Copy,
   Open in Google Maps; Map page search drops a pin with "Make a site here". Test: kl-maps-ui.mjs (uses the internet).
37. **Case timeline, no edits after sending, direct escalation (2026-11-20, v0.6.5)**. Owner: track every incident,
   complaint and suggestion "when it was opened, who investigated it ... what was the conclusion ... what was the action
   taken when marked closed ... if decision by committee, it should show under committee review and not any individual",
   "no option to edit once submitted", and an "important person's contact list for direct escalation ... money, safety,
   compliance violation, commitment to client". backend/casetrack.py: case_events (stages opened / investigation / note /
   closed / reopened; actor stored; by_reporter), one view of the three kinds (load / can_handle / can_view / timeline),
   /api/track/{incident|feedback|escalation}/{id} (+ /start with investigators, /note, /close needing conclusion AND
   action, /reopen needing a reason), GET /api/track = cases open 7+ days (HR desk banner, committee cases); nightly
   remind_overdue (7, 14, 21... days). Committee cases show "Committee review · <committee>"; only the director sees the
   member's name (owner chose). Investigators' notes are internal; the reporter sees stages, conclusion, action and their
   own notes. Incidents: edit, delete and direct status changes are refused (409); investigators can open them.
   Complaints: the old /respond still works but needs conclusion + action to close and logs the events; a reply after
   closing no longer reopens it. Escalations: table escalations (ref ES-), setting escalation_contacts (name, role, phone,
   WhatsApp, email, linked user, matters), /api/escalation (+ /contacts HR/director, POST to record: optional, goes to
   the contact and the director). Screens: views-track.js (caseTrack on incident records, cases, escalations; #escalate,
   #esc/<id>, #esccontacts); entries in Me, field Me, both "+" sheets, Settings. Tests: kl-track-ui.mjs.
38. **Place on photo stamps; scroll kept everywhere; no flicker on site tabs (2026-11-20, v0.6.5)**. Photo stamps add
   "Locality, Village · Taluka · District · State" (places.js stampPlace: the site's saved area when within 1 km or its
   circle, works offline; else a 2.5 s map lookup when online; else nothing). Sites gained a locality field. app.js:
   rememberScroll / restoreScroll keep every inner scroll position (sideways rows, drawers) across any redraw; the
   chosen tab is brought into view only when a screen is opened, never on a redraw; a tab inside the same page
   (site/<id>/<tab>) has no fade and keeps the page scroll; the loading placeholder shows after 0.25 s. Tests:
   kl-scroll-ui.mjs, kl-small-ui.mjs (every screen at 320 px for four roles: no overflow, no errors).
