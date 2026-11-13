"""Demo data for the HR, money, operations and carbon modules (modules.py), so every screen has something to open.

Runs once, after demo.seed_activity. Photos are a handful of drawn images reused across records (fast in the
browser build). Stock postings go through modules.post so the registers stay consistent.
"""

import json
import random
from datetime import datetime, timedelta

import modules
from db import Db, now_iso
from demo import iso, near, put_file, stock_photo

R = random.Random(7)


def seed(db: Db) -> None:
    if db.one("SELECT 1 FROM records WHERE kind = 'batch' LIMIT 1"):
        return
    users = {u["employee_id"]: u for u in db.all("SELECT * FROM users")}
    sites: dict = {}
    for s_ in db.all("SELECT * FROM sites ORDER BY rowid"):
        sites.setdefault(s_["project_type"], s_)
        sites[s_["name"]] = s_
    if not users or not sites:
        return
    now = datetime.now().astimezone()
    today = now.date()
    admin, mgr, hr = users["EMP001"], users["EMP002"], users["EMP003"]
    f1, f2, f3 = users["EMP101"], users["EMP102"], users["EMP103"]
    f6, f7, mgr_agro = users["EMP106"], users["EMP107"], users["EMP005"]
    bio, agro, gas, office = sites["biochar"], sites["agroforestry"], sites["gasifier"], sites["office"]
    plant, deesa, salariya = sites["Viramgam Biochar Plant"], sites["Deesa Agroforestry Site"], sites["Salariya Agroforestry Site"]

    def ago(days: float, h: int = 11) -> datetime:
        return (now - timedelta(days=days)).replace(hour=h, minute=R.randint(0, 59), second=0, microsecond=0)

    def rec(kind: str, data: dict, by: dict, *, site: dict | None = None, person: dict | None = None, status: str | None = None, days: float = 0,
            file_id: str | None = None, lat: float | None = None, lng: float | None = None) -> str:
        k = modules.KINDS[kind]
        when = iso(ago(days))
        title = data.get("code") or ""
        if not title:
            t = data.get(k.get("title", ""), "")
            f = next((x for x in k["fields"] if x["key"] == k.get("title")), None)
            if f and f["type"] == "user":
                t = db.one("SELECT name FROM users WHERE id = ?", t)["name"]
            elif f and f["type"] == "farmer":
                t = db.one("SELECT name FROM farmers WHERE id = ?", t)["name"]
            elif f and f["type"] == "ref":
                t = db.one("SELECT title FROM records WHERE id = ?", t)["title"]
            title = str(t)
        return db.insert("records", {"kind": kind, "title": title, "site_id": site["id"] if site else None, "user_id": (person or by)["id"],
                                     "status": status or ("pending" if k.get("approval") else (k.get("statuses") or ["open"])[0]),
                                     "data": json.dumps(data), "file_id": file_id, "lat": lat, "lng": lng, "created_by": by["id"], "created_at": when, "updated_at": when})

    def chain(kind_key: str, rid: str, subject: dict, amount: float, title: str, link: str, decisions: list[tuple[dict, str]]) -> None:
        modules.start_chain(db, kind_key, rid, subject["id"], amount, title, link)
        status = "pending"
        for who, d in decisions:
            status = modules.decide_chain(db, kind_key, rid, {**who, "sites": []}, d, "", subject["id"], title, link)
        if status != "pending":
            db.update("records", rid, {"status": status})

    def photo(kind: str, lines: list[str], who: dict, lat=None, lng=None) -> str:
        return put_file(db, stock_photo(kind, lines), "Records/Demo", f"{now:%Y-%m-%d} {kind} {R.randint(1000, 9999)}.jpg", "image/jpeg", "record", who["id"], now, lat, lng)

    # ---------------- people: reporting lines, phones, consent, employee records
    for u in (f1, f3, f6):
        db.run("UPDATE users SET manager_id = ? WHERE id = ?", mgr["id"], u["id"])
    for u in (f2, f7):
        db.run("UPDATE users SET manager_id = ? WHERE id = ?", mgr_agro["id"], u["id"])
    for u in (mgr, hr, mgr_agro):
        db.run("UPDATE users SET manager_id = ? WHERE id = ?", admin["id"], u["id"])
    phones = {"EMP101": "98250 11223", "EMP102": "98790 44556", "EMP103": "97250 77889", "EMP002": "98980 12121", "EMP003": "99090 34343", "EMP001": "98250 00001",
              "EMP005": "98240 55667", "EMP106": "99250 88112", "EMP107": "97370 66441"}
    for emp, ph in phones.items():
        db.run("UPDATE users SET phone = ?, consent_at = ? WHERE employee_id = ?", ph, now_iso(), emp)
    db.run("UPDATE sites SET strict = 1 WHERE id = ?", gas["id"])
    pay = {
        "EMP001": (120000, 48000, 40000, 1600, "2019-04-01", "Permanent"), "EMP002": (40000, 16000, 12000, 1600, "2021-06-14", "Permanent"),
        "EMP003": (22000, 8800, 5000, 1600, "2022-01-10", "Permanent"), "EMP101": (12500, 5000, 1800, 1600, "2023-08-01", "Permanent"),
        "EMP102": (12000, 4800, 2000, 1600, "2024-02-19", "Probation"), "EMP103": (13500, 5400, 1500, 1600, "2022-11-07", "Contract"),
        "EMP005": (38000, 15200, 10000, 1600, "2023-03-01", "Permanent"), "EMP106": (16000, 6400, 2500, 1600, "2024-06-03", "Permanent"),
        "EMP107": (11500, 4600, 1500, 1600, "2025-01-15", "Probation"),
    }
    banks = ["State Bank of India", "Bank of Baroda", "HDFC Bank", "Dena Gujarat Gramin Bank"]
    for i, (emp, (b, h, s, c, joined, typ)) in enumerate(pay.items()):
        u = users[emp]
        prof = {"dob": f"19{R.randint(78, 99)}-0{R.randint(1, 9)}-1{R.randint(0, 9)}", "gender": "Female" if emp in ("EMP002", "EMP005", "EMP107") else "Male",
                "blood_group": R.choice(["B+", "O+", "A+", "AB+"]), "address": f"{R.randint(10, 99)}, {R.choice(['Shastri Nagar', 'Kalawad Road', 'Station Road', 'Bapunagar'])}, Gujarat",
                "emergency_name": R.choice(["Sunita (wife)", "Ramesh (father)", "Kavita (sister)"]), "emergency_phone": f"9{R.randint(100000000, 999999999)}",
                "joining_date": joined, "employment": typ, "bank_name": banks[i % 4], "bank_account": f"{R.randint(10**10, 10**11 - 1)}",
                "ifsc": f"{['SBIN', 'BARB', 'HDFC', 'GSCB'][i % 4]}000{R.randint(1000, 9999)}", "pan": f"{''.join(R.choice('ABCDEFGHJKLMNP') for _ in range(5))}{R.randint(1000, 9999)}{R.choice('ABCDEF')}",
                "aadhaar_last4": str(R.randint(1000, 9999)), "uan": f"10{R.randint(10**9, 10**10 - 1)}", "esic": f"3{R.randint(10**9, 10**10 - 1)}" if b + h + s + c <= 21000 else "",
                "basic": b, "hra": h, "special": s, "conveyance": c, "opening_earned": R.choice([4, 6, 9])}
        db.insert("records", {"kind": "profile", "title": u["name"], "user_id": u["id"], "data": json.dumps(prof), "status": "open", "created_by": hr["id"],
                              "created_at": now_iso(), "updated_at": now_iso()})
    # office staff mark attendance at the head office (no selfie at the desk)
    for d in range(13, 0, -1):
        day = ago(d, 9)
        if day.weekday() == 6:
            continue
        for u in (mgr, hr, admin, mgr_agro):
            cin = day.replace(hour=9, minute=R.randint(0, 25))
            cout = day.replace(hour=18, minute=R.randint(0, 40))
            db.insert("attendance", {"user_id": u["id"], "site_id": office["id"], "checkin_at": iso(cin), "checkout_at": iso(cout), "checkin_lat": office["lat"],
                                     "checkin_lng": office["lng"], "checkin_dist": 12, "checkout_lat": office["lat"], "checkout_lng": office["lng"], "checkout_dist": 10, "status": "ok"})

    # agroforestry plans belong to the agroforestry manager
    for pl in db.all("SELECT id FROM plans WHERE site_id IN (SELECT id FROM sites WHERE project_type = 'agroforestry')"):
        db.run("UPDATE plans SET created_by = ? WHERE id = ?", mgr_agro["id"], pl["id"])
        db.run("UPDATE tasks SET created_by = ? WHERE plan_id = ?", mgr_agro["id"], pl["id"])

    # ---------------- calendar
    for d, name, typ in (("2026-01-14", "Uttarayan", "Festival"), ("2026-01-26", "Republic Day", "National"), ("2026-03-04", "Holi", "Festival"),
                         ("2026-08-15", "Independence Day", "National"), ("2026-10-02", "Gandhi Jayanti", "National"), ("2026-10-20", "Dussehra", "Festival"),
                         ("2026-11-08", "Diwali", "Festival"), ("2026-11-09", "Gujarati New Year", "Festival"), ("2026-11-10", "Bhai Bij", "Optional"),
                         ("2026-12-25", "Christmas", "Optional")):
        rec("holiday", {"date": d, "name": name, "type": typ}, hr, days=60)
    rec("shift", {"name": "General", "start": "09:00", "end": "18:00", "weekly_off": "Sunday"}, hr, days=60)
    rec("shift", {"name": "Kiln night shift", "start": "20:00", "end": "05:00", "weekly_off": "Sunday", "site": bio["id"]}, hr, site=bio, days=60)

    # ---------------- attendance correction (pending with the manager) and one approved
    r1 = rec("regularisation", {"date": (today - timedelta(days=3)).isoformat(), "in_time": "08:40", "out_time": "17:30", "site": bio["id"],
                                "reason": "Phone battery died before check-out; I left at 5:30 pm with the loader driver."}, f1, site=bio, days=2)
    chain("regularisation", r1, f1, 0, "Attendance correction · Jignesh Rathod", f"#rec/regularisation/{r1}", [])

    # ---------------- assets, training, goals, reviews
    for u, asset, cat, serial, val in ((f1, "Redmi Note 13", "Phone", "IMEI 8649 2210 4471 302", 14999), (f2, "Samsung Galaxy M14", "Phone", "IMEI 3571 0045 9921 110", 12490),
                                       (f3, "Redmi Note 13", "Phone", "IMEI 8649 2210 4471 318", 14999), (f1, "Fire-resistant suit, gloves, boots", "Safety kit", "SK-031", 6200),
                                       (f3, "Ear defenders and gas detector", "Safety kit", "SK-044", 9800), (mgr, "Dell Latitude 3440", "Laptop", "5CG3401ZQ", 61500)):
        rec("asset_issue", {"asset": asset, "category": cat, "serial": serial, "person": u["id"], "issued_on": (today - timedelta(days=R.randint(40, 300))).isoformat(),
                            "value": val, "condition": "Good"}, hr, person=u, status="issued", days=40)
    for u, t, prov, done, valid in ((f1, "Fire safety at kiln sites", "Gujarat Fire Services", -200, 165), (f1, "Kon-Tiki kiln operation", "Sajeevan training team", -150, None),
                                    (f3, "First aid (St John)", "St John Ambulance", -700, 25), (f2, "Nursery and sapling care", "Navsari Agricultural University", -90, None),
                                    (f3, "Gasifier safe start-up", "Ankur Scientific", -320, 45)):
        rec("training", {"title": t, "person": u["id"], "provider": prov, "completed_on": (today + timedelta(days=done)).isoformat(),
                         "valid_until": (today + timedelta(days=valid)).isoformat() if valid else ""}, hr, person=u, days=-done)
    for u, t, target, prog, st in ((f1, "Produce 40 t biochar this quarter", "40,000 kg out of the kilns by 31 Dec", 55, "on track"),
                                   (f1, "Zero lost-time injuries", "No injury needing leave", 100, "on track"),
                                   (f2, "Sign 60 farmer agreements", "60 signed, KML for every plot", 40, "at risk"),
                                   (f3, "Gasifier uptime above 90%", "Breakdown hours under 10% of run time", 72, "on track")):
        rec("goal", {"person": u["id"], "title": t, "target": target, "due": "2026-12-31", "weight": 30, "progress": prog}, mgr, person=u, status=st, days=40)
    rec("review", {"person": f1["id"], "period": "Apr–Sep 2026", "rating": "4 Exceeds", "strengths": "Runs the kilns safely, keeps the register photo-perfect.",
                   "improve": "Plan feedstock purchases a week ahead."}, mgr, person=f1, days=35)
    rec("review", {"person": f3["id"], "period": "Apr–Sep 2026", "rating": "3 Meets", "strengths": "Quick breakdown repairs.", "improve": "Log every stoppage with downtime hours."},
        mgr, person=f3, days=35)

    # ---------------- policies (one accepted by Jignesh)
    p1 = rec("policy", {"title": "Safety at kiln and gasifier sites", "version": "2026.1", "must_ack": "Yes",
                        "body": "1. Wear the full safety kit near a burning kiln or the gasifier.\n2. Never quench a kiln alone; two people at all times.\n3. Keep 10 m clear of the kiln for visitors.\n4. Report every near miss in the app the same day.\n5. Fire extinguisher and water within 15 m of every kiln."}, hr, days=20)
    rec("policy", {"title": "Leave and attendance policy", "version": "2026", "must_ack": "Yes",
                   "body": "Casual 12 days a year (1 a month), sick 8 a year, earned 15 a year credited monthly. Check in with a selfie at the site; corrections need your manager's approval within 7 days."}, hr, days=20)
    rec("policy", {"title": "Travel and expense policy", "version": "2025.2", "must_ack": "No",
                   "body": "Two-wheeler ₹3.5/km, car ₹9/km. Claims over ₹500 need a receipt photo. Claims over ₹2,000 also go to HR."}, hr, days=90)
    db.insert("records", {"kind": "policy_ack", "title": "Accepted", "user_id": f1["id"], "data": json.dumps({"policy": p1}), "status": "open", "created_by": f1["id"],
                          "created_at": iso(ago(10)), "updated_at": iso(ago(10))})

    # ---------------- onboarding and exit
    ob = rec("onboarding", {"name": "Nikita Joshi", "role": "Field Officer, Agroforestry", "site": agro["id"], "joining_date": (today + timedelta(days=5)).isoformat(),
                            "checklist": modules.KINDS["onboarding"]["fields"][-1]["default"], "done": ["Offer letter signed", "ID and address proof collected", "Bank details and PAN"]},
             hr, site=agro, status="in progress", days=4)
    del ob
    pid = db.insert("users", {"employee_id": "EMP104", "name": "Bharat Solanki", "role": "field", "designation": "Kiln Helper (contract)", "active": 0, "must_change_pin": 0, "created_at": now_iso()})
    rec("exit", {"person": pid, "last_day": (today - timedelta(days=12)).isoformat(), "reason": "Contract ended", "settlement": 9850,
                 "checklist": modules.KINDS["exit"]["fields"][3]["default"], "done": modules.KINDS["exit"]["fields"][3]["default"].split("\n")},
        hr, person={"id": pid}, status="settled", days=12)
    for w, contractor, days_, rate in (("Mansukh Parmar", "Shiv Labour Contractors", 22, 450), ("Dinesh Koli", "Shiv Labour Contractors", 20, 450), ("Hansa Ben Vala", "Direct", 18, 400)):
        rec("labour", {"worker": w, "contractor": contractor, "site": bio["id"], "month": today.strftime("%Y-%m"), "days": days_, "rate": rate, "paid": days_ * rate}, mgr, site=bio, days=1)

    # ---------------- money
    receipt = photo("diesel", ["Receipt · Shree Fuel Centre", "₹850 · 9.4 L diesel"], f1)
    e1 = rec("expense", {"date": (today - timedelta(days=6)).isoformat(), "category": "Fuel", "amount": 850, "site": bio["id"], "description": "Diesel for the loader, pump was out at site"},
             f1, site=bio, days=6, file_id=receipt)
    chain("expense", e1, f1, 850, "Expense claim · Jignesh Rathod", f"#rec/expense/{e1}", [(mgr, "approved")])
    e2 = rec("expense", {"date": (today - timedelta(days=3)).isoformat(), "category": "Repairs", "amount": 3200, "site": gas["id"], "description": "Replaced the gasifier blower bearing (local workshop)"},
             f3, site=gas, days=3, file_id=photo("power", ["Workshop bill · Surat", "₹3,200 · blower bearing"], f3))
    chain("expense", e2, f3, 3200, "Expense claim · Suresh Makwana", f"#rec/expense/{e2}", [(mgr, "approved")])
    e3 = rec("expense", {"date": (today - timedelta(days=1)).isoformat(), "category": "Food", "amount": 420, "site": agro["id"], "description": "Tea and snacks for the farmer meeting at Vanthali"},
             f2, site=agro, days=1)
    chain("expense", e3, f2, 420, "Expense claim · Kiran Vaghela", f"#rec/expense/{e3}", [])
    a1 = rec("advance", {"type": "Salary advance", "amount": 6000, "recover_months": 3, "purpose": "Child's school fees"}, f3, days=20)
    chain("advance", a1, f3, 6000, "Advance · Suresh Makwana", f"#rec/advance/{a1}", [(mgr, "approved"), (admin, "approved")])
    farmers = db.all("SELECT * FROM farmers ORDER BY created_at")
    if farmers:
        fp1 = rec("farmer_payment", {"farmer": farmers[0]["id"], "amount": 2400, "purpose": "Sapling incentive", "mode": "UPI", "reference": "UTR 4307 1182 9921",
                                     "date": (today - timedelta(days=8)).isoformat()}, mgr, site=agro, person=mgr, days=8)
        chain("farmer_payment", fp1, mgr, 2400, f"Farmer payment · {farmers[0]['name']}", f"#rec/farmer_payment/{fp1}", [(admin, "approved")])
        fp2 = rec("farmer_payment", {"farmer": farmers[1]["id"], "amount": 28000, "purpose": "Carbon revenue share", "mode": "Bank transfer", "date": today.isoformat()},
                  f2, site=agro, person=f2, days=0)
        chain("farmer_payment", fp2, f2, 28000, f"Farmer payment · {farmers[1]['name']}", f"#rec/farmer_payment/{fp2}", [(mgr_agro, "approved")])

    # ---------------- equipment and maintenance
    eq = {}
    for name, typ, site, serial, every, last, st in (("Kiln K-1", "Kiln", bio, "KT-2022-01", 30, -12, "working"), ("Kiln K-2", "Kiln", bio, "KT-2022-02", 30, -41, "needs service"),
                                                     ("JCB loader", "Loader", bio, "JCB3DX-55871", 90, -60, "working"), ("Biomass shredder", "Shredder", bio, "SH-7.5-118", 45, -20, "working"),
                                                     ("Gasifier G-1 (100 kW)", "Gasifier", gas, "ANK-100-2291", 15, -9, "working"), ("DG set 62.5 kVA", "Generator", gas, "KOEL-62-881", 60, -70, "breakdown")):
        eq[name] = rec("equipment", {"name": name, "type": typ, "site": site["id"], "serial": serial, "service_days": every,
                                     "last_service": (today + timedelta(days=last)).isoformat()}, mgr, site=site, status=st, days=100)
    mph = photo("ash", ["Kiln K-1 service", "Refractory patched"], f1)
    for e, site, typ, desc, dt, cost, res, who in (("Kiln K-1", bio, "Preventive service", "Patched refractory lining, cleaned flue", 12, 1800, "working", f1),
                                                   ("Gasifier G-1 (100 kW)", gas, "Preventive service", "Cleaned cyclone and filters, checked gas lines", 9, 650, "working", f3),
                                                   ("DG set 62.5 kVA", gas, "Breakdown repair", "Starter motor failed; sent for rewinding", 2, 4200, "breakdown", f3),
                                                   ("Kiln K-2", bio, "Inspection", "Cracks in the lining on the east side; service due", 3, 0, "needs service", f1)):
        rec("maintenance", {"equipment": eq[e], "date": (today - timedelta(days=dt)).isoformat(), "type": typ, "description": desc, "downtime": R.choice([0, 2, 6, 20]),
                            "cost": cost, "result": res}, who, site=site, person=who, days=dt, file_id=mph)

    # ---------------- checklists and incidents
    t1 = rec("checklist_template", {"name": "Kiln daily safety check", "site": bio["id"], "frequency": "Daily",
                                    "items": "Safety kit worn by everyone\nFire extinguisher in place and charged\nWater line and quench pump working\n10 m clear zone marked\nFirst-aid box stocked"},
             mgr, site=bio, days=30)
    rec("checklist_template", {"name": "Gasifier start-up check", "site": gas["id"], "frequency": "Daily",
                               "items": "Gas lines leak-tested\nCyclone and filters clean\nCooling water flowing\nCO detector working\nLog book updated"}, mgr, site=gas, days=30)
    items = ["Safety kit worn by everyone", "Fire extinguisher in place and charged", "Water line and quench pump working", "10 m clear zone marked", "First-aid box stocked"]
    for d in range(5, 0, -1):
        bad = d == 2
        ans = [{"item": it, "ok": not (bad and i == 2), "note": "Pump not priming; used drums" if bad and i == 2 else ""} for i, it in enumerate(items)]
        rec("checklist_run", {"template": t1, "name": "Kiln daily safety check", "site": bio["id"], "answers": ans}, f1, site=bio, person=f1, days=d)
    inc_ph = photo("biochar", ["Near miss · Kiln K-2", "Ember on dry grass"], f1, bio["lat"], bio["lng"])
    for typ, sev, site, desc, injured, action, st, d, who in (("Near miss", "Low", bio, "Ember from Kiln K-2 lit dry grass 6 m away; put out at once.", "", "Cleared grass 15 m around the kilns", "closed", 9, f1),
                                                              ("Injury", "Medium", bio, "Minor burn on the forearm while quenching Kiln K-1.", "Mansukh Parmar (contract)", "First aid on site, burn gel; back at work next day", "investigating", 4, f1),
                                                              ("Spill / pollution", "Low", gas, "About 5 L of tar condensate spilled near the drain.", "", "Soaked up with sawdust, drain blocked", "open", 1, f3)):
        lat, lng, _ = near(site["lat"], site["lng"], 60)
        iid = rec("incident", {"date": iso(ago(d, 15))[:16], "type": typ, "severity": sev, "site": site["id"], "description": desc, "injured": injured, "action": action},
                  who, site=site, person=who, status=st, days=d, file_id=inc_ph, lat=lat, lng=lng)
        if sev == "Medium":
            plan = db.one("SELECT id FROM plans WHERE name = 'Safety & maintenance actions'")
            if not plan:
                import planner

                pidp = db.insert("plans", {"name": "Safety & maintenance actions", "site_id": None, "color": "red", "labels": json.dumps(planner.DEFAULT_LABELS),
                                           "created_by": mgr["id"], "created_at": iso(ago(30))})
                for i, b in enumerate(["Open actions", "In progress", "Verified"]):
                    db.insert("buckets", {"plan_id": pidp, "name": b, "sort": i})
                plan = {"id": pidp}
            bks = db.all("SELECT id FROM buckets WHERE plan_id = ? ORDER BY sort", plan["id"])
            for title, b, prog, who2 in (("Investigate burn at Kiln K-1 and update the quench procedure", 1, "in_progress", mgr),
                                         ("Repair the quench pump at the biochar site", 0, "not_started", f1),
                                         ("Fit long-handled quench nozzles on all kilns", 0, "not_started", f1)):
                tid = db.insert("tasks", {"plan_id": plan["id"], "bucket_id": bks[b]["id"], "title": title, "notes": f"Raised from incident {iid}.", "priority": "urgent" if b == 1 else "important",
                                          "progress": prog, "due_date": (today + timedelta(days=3)).isoformat(), "labels": json.dumps(["red"]), "checklist": "[]", "photo_required": 1,
                                          "sort": 0, "created_by": mgr["id"], "created_at": iso(ago(4)), "updated_at": iso(ago(4))})
                db.insert("task_assignees", {"task_id": tid, "user_id": who2["id"]})

    # ---------------- suppliers and purchasing
    s1 = rec("supplier", {"name": "Patel Agro Residues", "material": "Cotton stalk, groundnut shell", "phone": "98250 66771", "gstin": "24ABCPP1234F1Z5", "village": "Gondal"}, mgr, days=90)
    rec("supplier", {"name": "Shree Fuel Centre", "material": "Diesel", "phone": "0281 2550011", "gstin": "24AAKFS4471K1Z2", "village": "Lodhika"}, mgr, days=90)
    s3 = rec("supplier", {"name": "Saurashtra Refractories", "material": "Fire bricks, castable", "phone": "98240 22110", "gstin": "24AAGCS9981L1Z1", "village": "Morbi"}, mgr, days=90)
    pr1 = rec("purchase_request", {"item": "Biomass (feedstock)", "qty": 12000, "unit": "kg", "site": bio["id"], "needed_by": (today + timedelta(days=4)).isoformat(), "est_cost": 30000,
                                   "supplier": s1, "reason": "Feedstock for next week's 5 kiln runs"}, f1, site=bio, days=6)
    chain("purchase_request", pr1, f1, 30000, "Purchase request · Biomass (feedstock)", f"#rec/purchase_request/{pr1}", [(mgr, "approved"), (admin, "approved")])
    d = json.loads(db.one("SELECT data FROM records WHERE id = ?", pr1)["data"])
    d["po_number"] = f"PO/{today:%y%m}/{pr1[:4].upper()}"
    db.update("records", pr1, {"status": "ordered", "data": json.dumps(d)})
    pr2 = rec("purchase_request", {"item": "Fire bricks (IS 8)", "qty": 400, "unit": "nos", "site": bio["id"], "needed_by": (today + timedelta(days=10)).isoformat(), "est_cost": 26000,
                                   "supplier": s3, "reason": "Re-line Kiln K-2 (cracks found at inspection)"}, f1, site=bio, days=2)
    chain("purchase_request", pr2, f1, 26000, "Purchase request · Fire bricks (IS 8)", f"#rec/purchase_request/{pr2}", [(mgr, "approved")])
    pr3 = rec("purchase_request", {"item": "Nitrile gloves", "qty": 50, "unit": "pairs", "site": gas["id"], "est_cost": 2750, "reason": "Handling tar condensate"}, f3, site=gas, days=1)
    chain("purchase_request", pr3, f3, 2750, "Purchase request · Nitrile gloves", f"#rec/purchase_request/{pr3}", [])

    # ---------------- production batches, lab, applications (stock flows through modules.post)
    feed = modules.find_item(db, bio["id"], kind="input", like=("feed", "biomass"))
    char = modules.find_item(db, bio["id"], kind="product", like=("biochar", "char"))
    kph = photo("biochar", ["Kiln run · Lodhika Kiln Site", "Quenched and weighed"], f1, bio["lat"], bio["lng"])
    modules.post(db, feed, "in", 24000, f1["id"], "Received from Patel Agro Residues (PO)", "PO-DEMO", kph)
    batch_ids = []
    for i, d_ in enumerate((13, 11, 10, 8, 6, 5, 3, 1)):
        fk = R.choice([2400, 2600, 2800, 3000])
        out = round(fk * R.uniform(0.21, 0.27))
        code = f"B-{(today - timedelta(days=d_)):%y%m%d}-{i + 1:03d}"
        start = ago(d_, 7)
        data = {"code": code, "site": bio["id"], "equipment": eq["Kiln K-1" if i % 2 == 0 else "Kiln K-2"], "start": start.strftime("%Y-%m-%dT%H:%M"),
                "end": (start + timedelta(hours=5)).strftime("%Y-%m-%dT%H:%M"), "feedstock_type": R.choice(["Cotton stalk", "Pigeon pea stalk", "Groundnut shell"]),
                "feedstock_kg": fk, "moisture": R.choice([11, 13, 14, 16]), "output_kg": out, "peak_temp": R.randint(620, 710), "notes": ""}
        bid = rec("batch", data, f1, site=bio, person=f1, status="produced", days=d_, file_id=kph, lat=bio["lat"], lng=bio["lng"])
        modules.post(db, feed, "out", fk, f1["id"], f"Used in batch {code}", code, kph)
        modules.post(db, char, "in", out, f1["id"], f"Produced in batch {code}", code, kph)
        batch_ids.append((bid, code, out))
    lab_ph = photo("biochar", ["NABL lab report", "Sample from the kiln run"], mgr)
    for bid, code, out in batch_ids[:5]:
        rec("lab_result", {"batch": bid, "lab": "Gujarat Soil & Biochar Lab, Anand", "sample_date": today.isoformat(), "carbon": round(R.uniform(66, 79), 1),
                           "h_corg": round(R.uniform(0.28, 0.52), 2), "ash": round(R.uniform(8, 18), 1), "ph": round(R.uniform(8.6, 9.8), 1), "result": "Pass"},
            mgr, site=bio, days=2, file_id=lab_ph)
        db.update("records", bid, {"status": "tested"})
    app_ph = photo("biochar", ["Biochar applied · farm", "Mixed with compost"], f1)
    bio_farmers = []
    for nm, father, vil in (("Bharat Bhai Kher", "Popat Bhai", "Lodhika"), ("Mansukh Bhai Bhalodiya", "Jivan Bhai", "Pardi"), ("Govind Bhai Ranpariya", "Shamji Bhai", "Khambha"),
                            ("Vanita Ben Sakhiya", "Ramji Bhai", "Metoda"), ("Kanji Bhai Dhola", "Devshi Bhai", "Lodhika"), ("Rasila Ben Vaghasiya", "Hari Bhai", "Pardi")):
        fid_ = db.insert("farmers", {"name": nm, "father_name": father, "village": vil, "taluka": "Lodhika", "district": "Rajkot", "phone": f"98{R.randint(10000000, 99999999)}",
                                     "id_last4": f"{R.randint(1000, 9999)}", "site_id": bio["id"], "created_by": f1["id"], "created_at": iso(ago(30))})
        db.insert("plots", {"farmer_id": fid_, "survey_no": str(R.randint(40, 199)), "area_ha_declared": round(R.uniform(0.8, 3.0), 2), "created_at": iso(ago(30))})
        bio_farmers.append(db.one("SELECT * FROM farmers WHERE id = ?", fid_))
    for n, (bid, code, out) in enumerate(batch_ids[:3]):
        remaining = out
        for fr in bio_farmers[n * 2:n * 2 + 2]:
            q = min(remaining, round(out * R.uniform(0.35, 0.5)))
            remaining -= q
            plot = db.one("SELECT survey_no FROM plots WHERE farmer_id = ? LIMIT 1", fr["id"])
            lat, lng, _ = near(bio["lat"], bio["lng"], 4000)
            rec("application", {"batch": bid, "farmer": fr["id"], "plot": plot["survey_no"] if plot else "", "qty_kg": q, "date": (today - timedelta(days=2 - n * 0.5)).isoformat(),
                                "method": R.choice(["Mixed with compost", "Root zone"])}, f1, site=bio, person=f1, days=1, file_id=app_ph, lat=lat, lng=lng)
            modules.post(db, char, "out", q, f1["id"], f"Applied on farm ({fr['name']})", code, app_ph, lat, lng)
        db.update("records", bid, {"status": "applied"})
    # transfer and dispatch
    pfeed = modules.find_item(db, plant["id"], kind="input", like=("feed", "biomass"))
    rec("transfer", {"from_site": bio["id"], "to_site": plant["id"], "item": feed["name"], "qty": 3000, "vehicle": "GJ03 BX 4471", "date": (today - timedelta(days=2)).isoformat()},
        f1, site=bio, person=f1, days=2, file_id=kph)
    modules.post(db, feed, "out", 3000, f1["id"], "Transfer to Viramgam Biochar Plant", "TR-DEMO1", kph)
    modules.post(db, pfeed, "in", 3000, f1["id"], "Transfer from Lodhika Kiln Site", "TR-DEMO1", kph)
    rec("dispatch", {"site": bio["id"], "item": char["name"], "qty": 500, "customer": "Shree Krishna Agro Kendra, Gondal", "vehicle": "GJ03 AT 9182", "invoice": "SJ/26-27/0418",
                     "date": (today - timedelta(days=1)).isoformat()}, f1, site=bio, person=f1, days=1, file_id=kph)
    modules.post(db, char, "out", 500, f1["id"], "Dispatched to Shree Krishna Agro Kendra", "SJ/26-27/0418", kph)

    # ---------------- Viramgam industrial plant: equipment, runs (feedstock out, biochar in), lab
    peq = {}
    for name, typ, every, last, st in (("Pyrolysis reactor PR-1 (1 t/h)", "Kiln", 30, -8, "working"), ("Rotary biomass dryer", "Other", 45, -30, "working"),
                                       ("Hammer mill shredder", "Shredder", 30, -35, "needs service")):
        peq[name] = rec("equipment", {"name": name, "type": typ, "site": plant["id"], "serial": f"VG-{R.randint(100, 999)}", "service_days": every,
                                      "last_service": (today + timedelta(days=last)).isoformat()}, mgr, site=plant, status=st, days=100)
    pchar = modules.find_item(db, plant["id"], kind="product", like=("biochar", "char"))
    pph = photo("biochar", ["Plant run · Viramgam", "Reactor discharge weighed"], f6, plant["lat"], plant["lng"])
    for i, d_ in enumerate((9, 7, 5, 3, 2, 1)):
        fk = R.choice([7000, 8000, 9000])
        out = round(fk * R.uniform(0.26, 0.31))
        code = f"P-{(today - timedelta(days=d_)):%y%m%d}-{i + 1:02d}"
        start = ago(d_, 6)
        data = {"code": code, "site": plant["id"], "equipment": peq["Pyrolysis reactor PR-1 (1 t/h)"], "start": start.strftime("%Y-%m-%dT%H:%M"),
                "end": (start + timedelta(hours=9)).strftime("%Y-%m-%dT%H:%M"), "feedstock_type": R.choice(["Rice husk", "Cotton stalk", "Mixed"]), "feedstock_kg": fk,
                "moisture": R.choice([9, 10, 12]), "output_kg": out, "peak_temp": R.randint(520, 600), "run_hours": 9, "power_kwh": R.randint(380, 460)}
        if modules.balance(db, pfeed["id"]) < fk:
            modules.post(db, pfeed, "in", 20000, f6["id"], "Received from Patel Agro Residues", "PO-DEMO2", pph)
        bid = rec("batch", data, f6, site=plant, person=f6, status="tested" if i < 4 else "produced", days=d_, file_id=pph, lat=plant["lat"], lng=plant["lng"])
        modules.post(db, pfeed, "out", fk, f6["id"], f"Used in plant run {code}", code, pph)
        modules.post(db, pchar, "in", out, f6["id"], f"Produced in plant run {code}", code, pph)
        if i < 4:
            rec("lab_result", {"batch": bid, "lab": "Gujarat Soil & Biochar Lab, Anand", "sample_date": today.isoformat(), "carbon": round(R.uniform(72, 82), 1),
                               "h_corg": round(R.uniform(0.22, 0.4), 2), "ash": round(R.uniform(6, 12), 1), "ph": round(R.uniform(8.8, 9.9), 1), "result": "Pass"},
                mgr, site=plant, days=1, file_id=lab_ph)
    rec("checklist_template", {"name": "Plant start-up and safety round", "site": plant["id"], "frequency": "Daily",
                               "items": "Reactor seals and gauges OK\nSyngas flare lit\nCooling water flowing\nDust extraction running\nFire hydrant pressure OK"}, mgr, site=plant, days=30)

    # ---------------- Balaji gasifier: daily runs post feedstock, power, ash and diesel
    gfeed = modules.find_item(db, gas["id"], kind="input", like=("feed",))
    if gfeed and modules.balance(db, gfeed["id"]) < 15000:
        modules.post(db, gfeed, "in", 15000, f3["id"], "Received from Patel Agro Residues", "PO-DEMO3")
    gph = photo("power", ["Energy meter · Balaji Gasifier", "Daily reading"], f3, gas["lat"], gas["lng"])
    for d_ in range(8, 0, -1):
        if (today - timedelta(days=d_)).weekday() == 6:
            continue
        hrs = R.choice([16, 18, 20, 22])
        data = {"site": gas["id"], "equipment": eq["Gasifier G-1 (100 kW)"], "date": (today - timedelta(days=d_)).isoformat(), "run_hours": hrs,
                "feedstock_kg": hrs * R.randint(95, 115), "power_kwh": hrs * R.randint(68, 82), "ash_kg": hrs * R.randint(3, 6), "diesel_l": R.choice([0, 0, 4, 6]),
                "notes": R.choice(["", "", "Stopped 40 min to clear the hopper", "Grid tripped once"])}
        rec("gas_run", data, f3, site=gas, person=f3, days=d_, file_id=gph, lat=gas["lat"], lng=gas["lng"])
        for like, ik, typ, key in ((("feed",), "input", "out", "feedstock_kg"), (("power",), "product", "in", "power_kwh"), (("ash",), "product", "in", "ash_kg"), (("diesel",), "input", "out", "diesel_l")):
            it = modules.find_item(db, gas["id"], kind=ik, like=like)
            if it and data[key]:
                modules.post(db, it, typ, data[key], f3["id"], f"Gasifier run {data['date']}", f"RUN-{data['date']}", gph, allow_negative=True)

    # ---------------- agroforestry: saplings and survival
    tree_ph = photo("biomass", ["Saplings handed over", "Nava site"], f2)
    for site_, who, base in ((agro, f2, 1.0), (deesa, f7, 0.7), (salariya, f7, 0.4)):
        for sp in ("Teak", "Mango", "Drumstick", "Melia dubia"):
            rec("nursery", {"site": site_["id"], "species": sp, "action": "Seeds sown", "qty": round(1500 * base * R.uniform(0.8, 1.2)) + 400, "date": (today - timedelta(days=95)).isoformat(),
                            "source": f"Bed {R.randint(1, 12)}"}, who, site=site_, person=who, days=95, file_id=tree_ph)
            if R.random() < 0.6:
                rec("nursery", {"site": site_["id"], "species": sp, "action": "Saplings received", "qty": round(400 * base), "date": (today - timedelta(days=40)).isoformat(),
                                "source": "Forest department nursery"}, who, site=site_, person=who, days=40, file_id=tree_ph)
            rec("nursery", {"site": site_["id"], "species": sp, "action": "Died or culled", "qty": round(60 * base * R.uniform(0.5, 1.5)), "date": (today - timedelta(days=20)).isoformat(),
                            "source": "Weekly cull"}, who, site=site_, person=who, days=20)
    for site_, who, names_ in ((deesa, f7, (("Lakhma Bhai Desai", "Deesa"), ("Rami Ben Chaudhary", "Juna Deesa"), ("Bhemji Bhai Rabari", "Bhadath"))),
                               (salariya, f7, (("Jaysukh Bhai Kalariya", "Salariya"), ("Hansa Ben Ghodasara", "Salariya")))):
        for nm, vil in names_:
            fid_ = db.insert("farmers", {"name": nm, "father_name": "", "village": vil, "taluka": vil, "district": "Banaskantha" if site_ is deesa else "Junagadh",
                                         "phone": f"97{R.randint(10000000, 99999999)}", "id_last4": f"{R.randint(1000, 9999)}", "site_id": site_["id"], "created_by": who["id"], "created_at": iso(ago(50))})
            sp = R.choice(["Teak", "Drumstick", "Melia dubia"])
            cnt = R.choice([100, 150, 200])
            rec("sapling", {"farmer": fid_, "species": sp, "count": cnt, "date": (today - timedelta(days=35)).isoformat(), "site": site_["id"]}, who, site=site_, person=who, days=35, file_id=tree_ph)
            lat, lng, _ = near(site_["lat"], site_["lng"], 2500)
            rec("survival", {"farmer": fid_, "species": sp, "planted": cnt, "alive": round(cnt * R.uniform(0.7, 0.96)), "avg_height": R.randint(30, 80),
                             "date": (today - timedelta(days=3)).isoformat()}, who, site=site_, person=who, days=3, file_id=tree_ph, lat=lat, lng=lng)
    for n, fr in enumerate(farmers[:5]):
        sp = R.choice(["Teak", "Mango", "Drumstick", "Melia dubia"])
        cnt = R.choice([120, 150, 200, 250])
        rec("sapling", {"farmer": fr["id"], "species": sp, "count": cnt, "date": (today - timedelta(days=60 + n * 5)).isoformat(), "site": agro["id"]}, f2, site=agro, person=f2,
            days=60 + n * 5, file_id=tree_ph)
        if n < 4:
            lat, lng, _ = near(agro["lat"], agro["lng"], 3500)
            rec("survival", {"farmer": fr["id"], "species": sp, "planted": cnt, "alive": round(cnt * R.uniform(0.72, 0.95)), "avg_height": R.randint(45, 110),
                             "date": (today - timedelta(days=n + 1)).isoformat()}, f2, site=agro, person=f2, days=n + 1, file_id=tree_ph, lat=lat, lng=lng)
