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
| EMP002 | Meera Shah | manager (all sites) |
| EMP003 | Ravi Patel | HR |
| EMP101 | Jignesh Rathod | field, biochar site |
| EMP102 | Kiran Vaghela | field, agroforestry cluster |
| EMP103 | Suresh Makwana | field, gasifier plant |

On the phone: open `https://<PC IP>:8788`, accept the certificate warning once, Share → Add to Home Screen.
Camera and location only work over HTTPS, which is why the script makes a self-signed certificate.

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
