# Kshetralekha UI redesign: plan

Branch `ui-redesign` (from `main` at v0.5.0, a51d0e6). Visual and UX change only: no changes to business logic,
data, storage, offline sync, hash routes, API calls or calculations. Before screenshots: `docs/ui-redesign/before/`
(47 shots: field, manager, HR and director at 360 px and 1440 px).

## 1. What is there now

**Stack.** Vanilla PWA with no build step and no framework. Screens are template-literal functions
(`Views.<route>(arg) → HTML string`) re-rendered into `#app` by `render()` in `app.js`. Events go through
`data-action` / `data-change` / `data-input` attributes, handled by `Actions`, `Changes` and `Inputs`. Form values
live in `KL.ui.forms` (`F` / `setF`), so typing never re-renders. Data comes from `data(key, loader)`, a
stale-while-revalidate cache with `invalidate()`. In the GitHub Pages build, `fetch('/api/…')` is answered by the
FastAPI backend running in the browser under Pyodide; on a PC it is answered by uvicorn.

| File | Holds |
|---|---|
| `frontend/styles.css` (~2,000 lines) | All styling. Tokens on `:root` with a dark theme, then components and screens. |
| `frontend/core.js` | Helpers (`topbar`, `group`, `lrow`, `tag`, `field`, `input`, `select`, `modal`, `toast`, `photoBox`, camera, GPS, outbox, the icon set, `celebrate`, `countUp`). |
| `frontend/app.js` | Routing (`route()`, `tabOf`, role guards), tab bar, sidebar, sign-in, person switch, event wiring. |
| `views-field.js`, `views-me.js`, `views-staff.js`, `views-planner.js`, `views-modules.js`, `views-sites.js`, `views-hrops.js` | Screens. |

**Routing.** Hash URLs such as `#home`, `#site/{id}/stock`, `#rec/{kind}/{id}`, `#monthend/2026-10` and
`#task/{id}`. These stay exactly as they are.

**Languages.** `translate(root)` in `views-modules.js` swaps exact text nodes using the `I18N.gu` and `I18N.hi`
dictionaries after each render. Today that covers navigation and common words, not every sentence. New labels
are added to both dictionaries. Complete Gujarati and Hindi coverage is a separate translation job, outside this
redesign.

**What the redesign changes.** The current look, from v0.2, is a brand-forward consumer style:
- Bricolage display type, a forest-and-lime palette and a cream background.
- A gradient hero card, a large "Good morning" header and coloured project blocks.
- A confetti-style success overlay (`celebrate`), counting-up numbers and staggered page entrances.
- Rounded cards for everything.

On desktop it is the phone layout stretched: the directory is a list of big rows, not a table.

## 2. Screens and who sees them

Roles in the demo: Director = admin (EMP001), Manager (EMP002, EMP005), HR (EMP003), Field staff (EMP101 …).
"Staff" below means Director, Manager and HR.

| Area | Routes | Field | Manager | HR | Director |
|---|---|:-:|:-:|:-:|:-:|
| Sign-in, person switch | login, consent | ✓ | ✓ | ✓ | ✓ |
| Home | `home` (field home / staff home with dashboard) | ✓ | ✓ | ✓ | ✓ |
| Check-in | `attendance` | ✓ | ✓ | ✓ | ✓ |
| Travel | `trips` | ✓ | ✓ | ✓ | ✓ |
| Daily update | `updates` | ✓ | ✓ | ✓ | ✓ |
| Leave | `leaves` | ✓ | ✓ | ✓ | ✓ |
| Tasks / Planner | `tasks`, `planner`, `task/{id}` (sheet) | tasks | ✓ | ✓ | ✓ |
| Inbox | `inbox` | ✓ | ✓ | ✓ | ✓ |
| Me | `me`, `person/me`, `privacy`, `security`, `changes/me` | ✓ | ✓ | ✓ | ✓ |
| Complaints | `feedback` (+ tracking code, POSH) | ✓ | ✓ | ✓ | ✓ |
| Notices, surveys | `notices`, `notice/{id}`, `surveys`, `survey/{id}` | ✓ | ✓ | ✓ | ✓ |
| Sites | `sites`, `mysite`, `site/{id}/{tab}`, `muster/{id}` | own sites | own projects | all | all |
| Site records | `registers`, `farmers`, `sign`, `rec/{kind}[/{id}]`, `carbon`, `map` | own sites | ✓ | ✓ | ✓ |
| Approvals | `approvals` | – | ✓ | ✓ | ✓ |
| Team activity | `team`, `dashboard` | – | ✓ | ✓ | ✓ |
| People hub | `hr`, `hub/{group}` | (via Me) | ✓ | ✓ | ✓ |
| Directory, profile | `people`, `person/{id}`, `personedit/{id}`, `assign/{id}` | – | team | ✓ (edit) | ✓ |
| Attendance summary | `attsum[/{id}]` | own | team | all | all |
| Month end | `monthend/{m}`, `hrreg`, `changes` | – | confirm | lock | unlock |
| HR desk, IC desk | `hrdesk`, `poshdesk` | IC members | IC | ✓ | – |
| Notices, surveys (create) | `noticenew`, `surveynew` | – | notices | ✓ | ✓ |
| Reports | `reports` | – | ✓ | ✓ | ✓ |
| Admin, settings | `admin/{section}`, `hrsettings`, `messages` | – | partly | ✓ | ✓ |

There are 53 view functions in all. Every one keeps working. The redesign goes through the shared helpers first,
so most screens change without being rewritten.

## 3. Design direction

Generator output (ui-ux-pro-max): "Minimalism & Swiss style", recommended for enterprise apps, dashboards and
professional tools. Its first suggestion was a dark marketing-site theme with a code font. Its second used a
light slate base with a blue accent and Inter. I keep the structure (light neutral base, grid, high contrast, low
motion) but not the blue: your brief asks for Sajeevan green as the only accent.

**The idea:** a calm, light work surface, like a well-kept register book. Most of the screen is neutral. Green
appears only where the person can act or where something is confirmed. The memorable element is the
**attendance and status language**: a single, consistent set of status chips and coloured day cells that reads
the same on every screen (month grid, approvals, muster, change log). Everything else stays quiet.

### Tokens (one place: the top of `styles.css`; I will check every pair against WCAG AA before use)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F5F6F5` | `#101513` | Page |
| `--surface` | `#FFFFFF` | `#171D1A` | Panels, tables |
| `--surface-2` | `#F0F2F1` | `#1E2622` | Table header, hover, inputs |
| `--border` | `#DDE2DF` | `#2C3632` | 1 px lines |
| `--text` | `#18211D` | `#E8EDEA` | Body |
| `--text-2` | `#4A5550` | `#AEB8B3` | Secondary |
| `--muted` | `#66716C` | `#8E9A94` | Labels, captions (≥ 4.5:1 on surface) |
| `--accent` | `#1C6B45` (deep Sajeevan green) | `#5BBF8C` | Primary buttons, links, selection |
| `--accent-tint` | `#E6F1EB` | `#183427` | Selected rows, active nav |
| `--success` / `--warning` / `--danger` / `--info` | `#1C7A47` / `#A15C07` / `#B42318` / `#1F5FBF` | lighter equivalents | Status only, each with a tint |

- **Type:** **IBM Plex Sans**, self-hosted (400, 500, 600). It has tabular figures, is built for enterprise
  software, and is less of a default than Inter. Fallbacks: **Noto Sans Gujarati** and **Noto Sans Devanagari**,
  loaded with `unicode-range` so they download only when Gujarati or Hindi is on screen.
  - Scale: 12 / 14 / 16 / 20 / 24 / 32; body 16 on phone, 14 in desktop tables.
  - Headings in sentence case. No all-caps labels.
  - `font-variant-numeric: tabular-nums` on every number, table and tile.
- **Shape:**
  - 4 / 8 px spacing grid; 6 px radius on controls, 8 px on panels; 1 px borders.
  - Shadows only on things that float (drawer, modal, menus).
  - No gradients, glows, hero blocks or confetti.
- **Icons:** keep the existing in-house outline set: one set, 24 px grid, already used everywhere. I will even out
  stroke widths and give every icon-only button an `aria-label`. No new icon library.
- **Motion:** 150–200 ms opacity/transform for drawer, modal, toast and menus only. No page-entrance stagger and
  no count-up numbers. Everything off under `prefers-reduced-motion`.
- **Project identity** (Biochar, Gasifier, Agroforestry): a small neutral icon plus the name. No coloured blocks.

## 4. Components (built once in `core.js` + `styles.css`, used everywhere)

These are mostly the existing helpers, restyled, so screens pick them up without changes. The new ones are
**bold**.

| Component | From |
|---|---|
| App shell, top bar, desktop sidebar, mobile bottom nav | `app.js` `sideNav`, `tabBar`, `topbar` |
| **Page header** (breadcrumb, title, primary action) | replaces `topbar` |
| Card / panel, KPI tile, **sparkline** (inline SVG, no library) | `group`, `.tile` |
| **Data table**: sticky header, sort, filter bar, pagination, empty state, row actions, density toggle; on phones the same data as compact list rows | new `dataTable({...})`; client-side over data already loaded |
| Form field (label above, helper text, required marker, inline error), buttons (primary, secondary, ghost, danger) | `field`, `input`, `select`, `.btn` |
| **Status chip** (Approved, Pending, Rejected, Late, Absent, On leave, Offline, Saved on phone, Synced, Locked) | `tag`, `statusTag` |
| Tabs | `.seg`, `.site-tabs` |
| **Drawer**: record details on desktop, full screen on phone | generalises the planner's `#sheet` |
| Modal, toast, skeleton loader, empty state with one action | `modal`, `toast`, `spinner`, `emptyState` |
| **Timeline / activity list** | change log, approval steps, team activity |
| **Approval card** (Approve / Reject, with the facts needed to decide) | approvals screen |

`celebrate()` keeps its name and callers but becomes a quiet confirmation (toast plus inline success line).
`num()` / `countUp` stop animating.

## 5. Layout and navigation

Hash routes are unchanged; only how navigation is drawn changes.

- **Phone (below 1024 px):**
  - Bottom nav with at most 5 items, 44 px minimum touch targets, one primary action per screen, kept within
    thumb reach.
  - Field: Home · My site · Tasks · Inbox · Me.
  - Staff: Home · Sites · Planner · People · Inbox.
- **Desktop and tablet (1024 px and up):** collapsible left sidebar grouped as you asked:
  - **Home**
  - **My work**: tasks/planner, inbox, check-in, daily update, leave, travel, expenses
  - **Team**: approvals, team activity, attendance summary
  - **People & HR**: directory, month end, registers, change log, HR desk, notices, surveys, policies,
    onboarding/exits
  - **Operations**: sites under Biochar / Gasifier / Agroforestry, map, carbon, purchasing
  - **Reports**
  - **Admin**: administration, HR settings

  Each group shows only what the role may open (the same guards as now). The content area has a page header, a
  filter bar and tables.
- **Sync state is always visible.** A top-bar chip shows "Synced 2 min ago", "3 saved on phone · will sync" or
  "Offline", using the existing outbox. Items waiting to upload get a "Saved on phone" chip where they appear.

### Role home dashboards (same `#home` route, chosen by role)

- **Field staff:**
  - Today card: checked in or not, site, time, and the one button that matters (Check in / Check out).
  - Today's tasks.
  - Quick actions: Check in, Daily update, Leave, Expense.
  - Pending items: own requests waiting, notices to confirm, surveys.
  - Crew attendance for supervisors.
- **Manager:**
  - Approvals queue first (top 5 with Approve / Reject).
  - Team attendance today (on site, late, absent, on leave).
  - Overdue tasks.
- **HR:**
  - Approvals.
  - Attendance month status (open / confirmed / locked) with the next step.
  - Leave requests.
  - HR desk tickets.
  - Policy acknowledgements outstanding.
  - Onboarding and exits in progress.
- **Director:**
  - KPI tiles with 6-month sparklines: headcount, attendance %, biochar produced, expenses, open incidents.
  - The trend comes from calling the existing reports endpoint once per month. No new API.

## 6. Screens, in your order

| # | Screen | Main changes |
|---|---|---|
| 1 | Sign-in / person picker | Plain panel; people grouped by role as a list; PIN pad. |
| 2 | Home (4 roles) | As above. |
| 3 | Site check-in | Status first ("Inside Lodhika · 42 m from centre"); geofence card; selfie; offline chips; last-synced time. |
| 4 | Approvals | One queue with type filter chips (Leave, Travel, Check-in, Expense, Advance, Purchase, Correction, Farmer payment); desktop table + drawer; **bulk approve only where safe** (proposal: travel claims, check-in exceptions, attendance corrections, 1-day leave within balance; money requests stay one by one). |
| 5 | Attendance month grid | Sticky name column and header; legend; colour-coded cells with letters, so colour is never the only signal; totals; month lock banner. |
| 6 | Leave | Balance tiles; apply form; history table. |
| 7 | Directory and profile | Directory as a sortable, filterable table (role, site, project, employment). Profile tabs: Overview, Job, Documents, Attendance, Leave, Assets, Training, Goals. The documents API already accepts an employee ID for HR, so no API change is needed. |
| 8 | HR desk | Tickets table (type, category, status, age) with a drawer holding the conversation; documents section. |
| 9 | Daily updates, team activity | Timeline list. |
| 10 | Reports | KPI row, charts, downloads grouped. |
| 11 | Settings / admin | Sectioned forms. |
| – | Everything else | Picks up the shared components: sites and site tabs, stock registers, batches, farmers and signing, trips, records, planner, notices, surveys, month end, muster, map, carbon. |

Every screen gets loading (skeleton), empty, error and offline states.
- Numbers right-aligned with tabular figures.
- Dates as "14 Nov 2026".
- Money as ₹4,23,718 (`en-IN` grouping; most of this already exists).
- Destructive actions confirmed, with undo where the API allows it.
- Visible focus rings.

## 7. Phases (one commit each on `ui-redesign`)

1. **Design system:** `design-system/MASTER.md` (tokens, type, rules), new tokens and fonts in `styles.css`; old
   palette removed. Screens still use their old markup but already look calmer.
2. **Components:** page header, buttons, forms, chips, tables, drawer, tiles, sparkline, empty, skeleton, toast,
   modal, timeline, approval card.
3. **Shell and navigation:** grouped collapsible sidebar, bottom nav, sync chip.
4. **Sign-in and the four home dashboards.**
5. **Key screens 3–11.**
6. **All remaining screens.**
7. **Review:**
   - ui-ux-pro-max pre-delivery checklist on each screen.
   - Screenshots at 360, 768 and 1440 px, light and dark, English, Gujarati and Hindi, into
     `docs/ui-redesign/after/`.
   - All test suites green.
   - Summary of what changed and what is left.

## 8. How I keep it working

- The existing suites run after every phase:
  - `kl-e2e.mjs` (18 checks), `kl-e2e3.mjs` (17), `kl-e2e4.mjs` (13), `kl-e2e5.mjs` (21)
  - `kl_hrops_api.py` (50), `kl_access_check.py` (16)
  - `kl-pages-test.mjs` (10) for the in-browser build
- `data-action` names, element ids and routes stay the same. Where a test relies on a class name that changes, I
  update the selector, never the assertion.
- I'll add flows the brief lists that no test covers yet: offline check-in (outbox then sync), attendance
  correction, expense claim, named complaint.
- Bundle stays lean: no framework, no UI library, no chart library. Fonts are about 120 KB for Latin, with Indic
  fonts only when used.

## 9. Decisions for you

1. **Typeface:** IBM Plex Sans (my pick) or Inter (the generator's pick, very common)?
2. **Accent:** deep green `#1C6B45` as the only accent. The lime and earth colours are retired, including the
   coloured project blocks. OK?
3. **Bulk approve:** limit it to travel claims, check-in exceptions, attendance corrections and 1-day leave within
   balance?
4. **Success moments:** the celebration overlay becomes a quiet toast everywhere. OK, or keep it for check-in only?
5. **Live demo:** the redesign stays on the `ui-redesign` branch until you approve, so the GitHub Pages demo keeps
   showing the current design. Do you want a separate preview link for the branch?
