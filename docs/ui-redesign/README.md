# UI redesign: summary

Branch `ui-redesign`. Plan: `docs/ui-redesign-plan.md`. Design system: `design-system/MASTER.md`.

This is a visual and UX change only. No routes, API calls, data, storage, offline sync or calculations changed;
the backend files are untouched.

**Screenshots**
- `before/`: 47 shots of the main screens (360 and 1440 px).
- `after/`: 174 shots:
  - `phone` (360 px) and `desktop` (1440 px): every main screen
  - `tablet` (768 px)
  - `phone-dark` and `desktop-dark`
  - `phone-gu` (Gujarati) and `phone-hi` (Hindi)

## What changed

| Phase | Change |
|---|---|
| 1 Design system | Neutral base with one accent, Sajeevan green `#1C6B45`, plus status colours. Light and dark themes, every pair checked against WCAG AA. IBM Plex Sans with tabular figures; Noto Sans Gujarati and Devanagari load only when needed. 12–32 px type scale, 6/8 px radius, 1 px borders, shadows only on floating UI. Gradients, glows, confetti, staggered and infinite animations removed. |
| 2 Components | Page header with breadcrumb and sync state. Data table (sticky header, sort, search, filters, pagination, density; list rows on phones). Drawer, KPI tile with sparkline, timeline, one status-chip vocabulary, form helper text and required markers, empty states with one action, error and offline states with retry, quiet confirmations instead of the full-screen celebration, dates as "14 Nov 2026". |
| 3 Shell | Desktop sidebar grouped as Home · My work · Team · People & HR · Operations · Reports · Admin. It shows only what the role may open and collapses to icons. Flat bottom nav on phones (≤ 5 items, 44 px targets). Plain sign-in with demo people grouped by role. Record details open in a drawer beside their list on desktop (Escape closes it). |
| 4 Home | Four role dashboards: **field** (today card with the one action, quick actions, tasks, pending items), **manager** (approvals first, late and not-checked-in people, on site now), **HR** (approvals, attendance month status with next step, leave, HR desk, policy acceptances due, joiners and leavers), **director** (KPIs with 6-month sparklines: headcount, attendance %, biochar, expenses, incidents). |
| 5 Key screens | Unified approvals queue with type filters and bulk approve for safe types only (travel, check-in exceptions, attendance corrections, 1-day leave within balance). Check-in leads with status ("Inside Lodhika · 46 m from the centre") and lists items saved on the phone. Month grid with legend, sticky header and lock state. Leave form and history table. Directory as a filterable, sortable table. Employee profile in tabs (Overview, Job, Documents, Attendance, Leave, Assets, Training, Goals). HR desk as a ticket table with the conversation in a panel. Daily updates and team activity as timelines. Record lists as tables. |
| 6 Other screens | Sites, stock, batches, farmers, trips, planner, notices, surveys, month end, muster, map, carbon, reports and admin use the new components. The site tabs and planner tabs are restyled to match. |
| 7 Review | Pre-delivery checklist below; screenshots; all test suites. |

## Pre-delivery checklist (ui-ux-pro-max), whole app

- [x] No emoji as icons; one outline icon set (in-house, `core.js`)
- [x] Pointer cursor and visible hover/pressed state on everything clickable (150–200 ms)
- [x] Text contrast ≥ 4.5:1 in light and dark; control borders ≥ 3:1 (values in MASTER.md)
- [x] Visible keyboard focus (`:focus-visible` outline; form fields show a 3 px ring). Tested.
- [x] `prefers-reduced-motion` turns animation and transitions off
- [x] Touch targets ≥ 44 px on phones: buttons, bottom nav (tested), chips, segmented controls
- [x] No horizontal page scroll at 360 px. Tested on 11 screens; wide tables scroll inside their panel.
- [x] English, Gujarati and Hindi render without clipping (see `after/phone-gu`, `after/phone-hi`)
- [x] Loading (skeleton), empty (with one action), error (with Try again) and offline states

## Tests (all passing on this branch)

| Suite | Checks | What it covers |
|---|---|---|
| `kl-e2e.mjs` | 18 | Planner proof task round trip, check-in, drag between buckets |
| `kl-e2e3.mjs` | 17 | Expense claim, batch, checklist, incident, leave, month end, policy, strict site, Hindi |
| `kl-e2e4.mjs` | 13 | Project/site navigation and access |
| `kl-e2e5.mjs` | 21 | Crew muster, anonymous complaint, notices, surveys, month lock |
| **`kl-e2e6.mjs`** (new) | 27 | Offline check-in (saved on phone, sent when back online); attendance correction; named complaint; daily update; no sideways scroll at 360 px; 44 px nav; bulk approve; record drawer and Escape; directory sort and search; focus ring |
| `kl_hrops_api.py`, `kl_access_check.py` | 50 + 16 | API |
| `kl-pages-test.mjs` | 10 | The in-browser (GitHub Pages) build, run locally with `?local=1` |

Selectors changed in two older tests because the old home hero is gone (`.hero .now` → `.today`, `.tile` →
`.kpi, .tile`). The assertions are unchanged.

## Not done, or done differently

- **Gujarati and Hindi:** navigation, buttons, dashboard labels and common words are translated, as before plus
  the new labels. Full sentences (hints, descriptions) are still English; that is a translation job, not a
  design one.
- **Tablet (768–1039 px):** uses the phone layout with the bottom nav, plus two-column content. The sidebar starts
  at 1040 px.
- **Drawer:** used for record details (`#rec/…`). Employee profiles stay a full page (with tabs) and planner
  tasks keep their existing sheet.
- **Undo:** destructive actions ask for confirmation, but there is no undo, because the API has no restore for
  deleted records.
- **Bulk approve:** limited to the safe types listed above. Money requests (expenses, advances, purchases,
  farmer payments) are decided one at a time.
- **Planner colours:** plan colour marks stay. They identify plans, the way labels do, and are not decoration.
- **Director sparklines:** they look like steps because the demo data covers only the last few weeks. Real data
  will fill them in.
- **Live demo:** the GitHub Pages demo (from `main`) still shows the old design until this branch is merged.
