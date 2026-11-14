# Kshetralekha (क्षेत्रलेखा, "the field record")

HR and operations app for the company's field teams: site check-in with a live selfie and GPS, travel allowance
from odometer photos, site registers (diesel, biomass, biochar, gasifier feedstock and output) with geotagged
photo evidence, farmer documents signed on the phone, and HR self-service (documents, daily update, leave,
complaints and suggestions). Managers approve, HR responds, admins configure, everything is audited.

This is the **working prototype**: one folder, Python backend, SQLite, files on disk. The same code moves to Azure
with Microsoft 365 sign-in and SharePoint storage without changing the app's screens (see "Going live").

## Run it

```powershell
cd D:\Projects\kshetralekha
.\scripts\serve.ps1          # HTTPS on every network interface, port 8788 (phones on the same Wi-Fi)
.\scripts\serve.ps1 -Http    # plain HTTP on 127.0.0.1:8788 for the PC browser
```

First run creates `data\kshetralekha.sqlite` with demo data. Sign in with PIN **1234**:

| Employee ID | Who | Role |
|---|---|---|
| EMP001 | Purv Kanani | admin |
| EMP002 | Meera Shah | manager, Biochar and Gasifier projects |
| EMP003 | Ravi Patel | HR |
| EMP005 | Nidhi Trivedi | manager, Agroforestry project |
| EMP101 | Jignesh Rathod | field, Lodhika Kiln Site |
| EMP106 | Mehul Prajapati | field, Viramgam Biochar Plant |
| EMP102 | Kiran Vaghela | field, Nava Agroforestry Site |
| EMP107 | Asha Rabari | field, Deesa and Salariya |
| EMP103 | Suresh Makwana | field, Balaji Gasifier Site |

On the phone: open `https://<PC IP>:8788`, accept the certificate warning once, Share → Add to Home Screen.
Camera and location only work over HTTPS, which is why the script makes a self-signed certificate.

### Online demo (GitHub Pages)

**https://purvkanani5-art.github.io/fieldapp/** opens on any phone. Pages has no server, so the page starts the
same Python backend inside the browser (Pyodide, a WebAssembly Python, from the jsDelivr CDN) and keeps the data
in the browser's storage. The first visit downloads about 15 MB and builds the sample data (10 to 30 s); later
visits open in a few seconds. Each phone has its own private copy; nothing is shared between devices.
Pages serves the `main` branch: the root `index.html` opens `frontend/`, and the phone loads the Python files
from `backend/`, so pushing to `main` publishes. After changing backend files run `python scripts/build_pages.py`
(it refreshes `frontend/local/manifest.json`). `scripts/publish-pages.ps1` builds a self-contained copy for a
`gh-pages` branch instead, if Pages is ever switched to that branch.

### Trying the prototype

- The sign-in screen lists every demo person: tap one to sign in (PIN 1234 also works).
- The **View as** pill (bottom left on a phone, sidebar on a computer) switches person without a PIN, so you can
  assign a task as Meera (manager) and complete it as Jignesh (field), then switch back and see the notification.
- On screens that need GPS a **Prototype location** switch pretends you are *At site* or *Away*, or uses the
  *Real GPS*. Check-in, trips and registers therefore work on a PC.
- Where there is no camera, the camera screen offers **Use a sample photo** (stamped "DEMO SAMPLE PHOTO").
- Admin → **Reset the demo** wipes everything and rebuilds two weeks of sample activity.
- For real use start the server with `KL_DEMO=0`: no demo people, switch, pretend location or sample photos.

## What is in it

**Projects and sites.** The app is organised by project (vertical) and site:

| Project | Demo sites | Tabs on each site |
|---|---|---|
| Biochar, low-tech (kilns) | Lodhika Kiln Site | Overview · Stock (diesel, biomass, biochar) · Kiln batches (+ lab) · Farmers (signing, applications) · Safety · Team |
| Biochar, high-tech (plant) | Viramgam Biochar Plant | the same, with Plant runs |
| Gasifier | Balaji Gasifier Site | Overview · Stock · Generation (runs, kWh) · Equipment · Safety · Team |
| Agroforestry | Nava, Deesa, Salariya | Overview · Nursery (sapling register) · Plantation (planting, survival) · Farmers · Team |

Who sees what: field staff see only the sites they work at; a project manager sees every site of the projects
they manage (Meera: Biochar and Gasifier, Nidhi: Agroforestry); the director and HR see everything. HR sets this
on the employee record ("Works at") or from a site's Team tab. Someone with no site uses only HR, the Planner and
the inbox. Planner plans can be for a site or General (no site) for work anywhere. General HR (approvals, leave,
claims, month end, policies, notices, surveys) is in People for managers and in Me for everyone.


- **Site check-in / out**: pick the site, the app shows your distance to it, take a live selfie (camera only, no
  gallery), Check in. Allowed within the site radius plus up to 50 m GPS accuracy. From outside you can only
  *request an exception* with a reason; it goes to the manager. Check-out works the same way.
- **Travel allowance**: Start trip = vehicle, odometer reading, purpose, odometer photo, GPS. End trip = reading
  and photo. The claim is km × rate (Admin → Company & rates). Managers see both photos, claimed km and the
  straight-line distance between the two GPS points.
- **Site registers**: items per site (Admin → Register items). Every entry is In, Out or Count with quantity,
  batch, note and a geotagged, time-stamped photo. Stock is computed, never typed; Out cannot exceed stock; Count
  records a variance. Low-stock alerts go to managers. Audit CSV export per site lists every entry with its
  photo's SHA-256.
- **Farmers & documents**: farmer registry; upload KML (area in hectares is computed and compared with the
  declared area), land records, ID proof; **Sign a document** fills a template, the farmer signs on screen, and
  a PDF is generated with the company's authorised signature, the farmer's signature, the field officer's name,
  GPS, time and the signature hash. Templates are editable in Admin.
- **HR self-service** (Me): documents uploaded by HR, daily work update, leave requests, complaints and
  suggestions (optionally anonymous), change PIN.
- **Planner** (like Microsoft Planner): a plan per site or project, buckets as columns, task cards with labels,
  priority, start and due dates, checklist, assignees, comments and an optional "photo as proof". Board grouped
  by bucket, progress, due date, person, priority or label (drag cards on a computer), Grid and Charts views.
  Managers assign; the person is told in the inbox; when they complete it (with photo and note) the manager is
  told. Field staff see it as **Tasks**.
- **Inbox**: new tasks, completed tasks, approvals, replies, alerts; badge on the tab.
- **People (HR)**: employee records (personal, bank, PAN, UAN, ESIC, salary; sensitive fields only for HR and
  the person), reporting lines and org chart, holiday calendar and shifts, leave policy with balances and monthly
  accrual (checked when applying), monthly attendance summary (present, half day, late, absent, overtime, missed
  check-outs closed automatically), attendance corrections, assets issued, training and certificates with expiry,
  goals and reviews, policies to accept, onboarding and exit checklists, contract labour register.
- **Approval chains**: every request goes to the person's own manager, then HR or the director when the amount or
  number of days is above a limit (HR settings). Leave, expense claims, advances, farmer payments, purchase
  requests and attendance corrections all use it.
- **Money**: expense claims with receipt photos, advances and loans (monthly recovery goes to Zoho), farmer
  payments. Pay is not in this app: Zoho Payroll does payroll, PF, ESI, PT, LWF, TDS, Form 16 and salary payment.
- **Month end for Zoho Payroll**: managers confirm their team's month, HR approves and locks it (a frozen copy is
  kept; corrections, leave, exceptions and muster for that month are refused until the director unlocks it with
  a reason). Export per employee: paid days, loss-of-pay days, half days, overtime, leave taken by type, late
  marks, advance recovery (CSV, an LOP-only CSV, JSON for an API pull).
- **Registers and change log**: monthly muster roll and leave register as PDF or CSV; a change log of every change
  to attendance, leave, balances, corrections, assignments and HR settings with who, when, old value, new value
  and reason (employees see changes to their own records).
- **Crew muster**: a site supervisor (or manager) marks crew without phones present, half day or absent, with
  overtime and one geotagged crew photo; contract workers too. It counts in the summary and the Zoho export.
- **Complaints, POSH, notices, surveys**: anonymous complaints get a tracking code to read HR's reply and write
  back; a POSH category goes only to the Internal Committee, and the POSH notice (committee, time limits,
  confidentiality, Local Committee) is on the complaint screen; a notice board with read receipts, "I have read
  this" for important notices and reminders; anonymous surveys with eNPS (results from 3 answers).
- **Safety & equipment**: recurring checklists (items not OK raise Planner tasks), incident reports (medium and
  above raise a follow-up task), equipment with service due dates, maintenance and breakdown log.
- **Production & carbon**: kiln batches that post feedstock out and biochar in to the stock register, lab results,
  biochar applied to farms (GPS, photo, stock out), sapling distribution and survival checks, and a chain of
  custody per batch with checks, an illustrative CO2e figure and a PDF.
- **Purchasing & supply**: suppliers, purchase requests (approve, order with a PO number, receive into stock),
  transfers between sites, dispatch notes.
- **Map, reports, settings**: map of sites, farm plots, applications and incidents; monthly report with charts and
  CSV downloads; strict sites (no check-in exceptions) and an on-duty leave-site alert while the app is open;
  Gujarati and Hindi labels; two-step sign-in for office accounts; a data-protection notice and "download my
  data"; WhatsApp/SMS messages are simulated (logged).
- **Left for the phone app or the live system** (noted in the app under Me → For reviewers): push notifications,
  background location, Microsoft sign-in and SharePoint, real WhatsApp/SMS sending, a live Zoho Payroll push (needs Zoho API access), hosting.
- **Manage** (managers, HR, admin): dashboard (on site now, stock, travel spend, farmers), approvals (trips,
  check-in exceptions, leave), team activity, HR desk (reply to complaints, upload employee documents), admin
  (users and PIN resets, sites and geofences, register items, templates, company and rates, audit log).
- **Offline**: the app shell is cached; check-ins, trips, register entries and file uploads made with no signal
  are kept on the phone and sent automatically when back online. Signing a document needs a connection (the PDF
  is made on the server).

Every photo carries a burnt-in stamp (who, what, date-time, GPS) and the server stores its SHA-256, so an auditor
can confirm a file is the original.

## Layout

```
backend/   app.py (API + serves the front end), db.py (SQLite schema), auth.py (PIN + tokens), planner.py, demo.py,
           modules.py (HR, money, operations, carbon), demo_modules.py,
           storage.py (file store, SharePoint stub), geo.py (geofence, KML area), pdfgen.py, seed.py
frontend/  index.html, styles.css, core.js (API, outbox, GPS, camera, signature), views-*.js (field, me, staff,
           planner), app.js, sw.js, icon.svg + PNG icons, fonts/ (self-hosted, OFL)
data/      kshetralekha.sqlite, files/ (mirrors the future SharePoint folder tree), secret.key, cert/
scripts/   serve.ps1
```

API docs: `/api/docs` while running.

## Going live (plan)

1. **Sign-in**: keep Employee ID + PIN for field staff; add "Sign in with Microsoft" (Entra ID) for office staff.
   The `users` row gets `entra_oid`; tokens and roles stay as they are.
2. **Storage**: `storage.SharePointStore` writes the same folder tree into a SharePoint library through
   Microsoft Graph (app registration with `Sites.Selected` on one site). Managers browse files in SharePoint.
3. **Hosting**: Azure Static Web Apps (front end) + Azure Functions or a small App Service (this FastAPI app) +
   Azure SQL or Postgres. `db.py` uses text ids and ISO timestamps so the schema ports directly.
4. **Notifications**: Teams messages and email for managers via Graph; in-app inbox stays the channel for field
   staff; WhatsApp/SMS optional later.
5. **Power BI** on the SQL database for finance and operations reporting.
