"""Demo activity for the prototype: two weeks of believable field work dated relative to today, so every screen
has something to show the moment someone signs in — attendance with selfies, trips with odometer photos, stock
movements with photos, farmers with plot boundaries and signed agreements, HR items, and Planner plans with
tasks in every state.

Photos are drawn here (Pillow) and carry the same burnt-in stamp the phone adds (who, what, time, GPS), so they
look and audit like the real thing. `reset()` wipes the database and files and builds it all again.
"""

from __future__ import annotations

import io
import json
import math
import random
import shutil
from datetime import UTC, datetime, timedelta

from PIL import Image, ImageDraw, ImageFont

import planner
from db import DB_PATH, Db, init_db, now_iso
from pdfgen import render_document
from storage import FILES_DIR, store

R = random.Random(1108)  # same demo every time


def iso(dt: datetime) -> str:
    return dt.astimezone(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def local_day(days_ago: int, h: int, m: int) -> datetime:
    base = datetime.now().astimezone().replace(hour=h, minute=m, second=0, microsecond=0)
    return base - timedelta(days=days_ago)


def font(size: int) -> ImageFont.ImageFont:
    for name in ("segoeuib.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


# ------------------------------------------------------------------ photos


def _gradient(w: int, h: int, top: tuple, bottom: tuple) -> Image.Image:
    im = Image.new("RGB", (w, h), top)
    d = ImageDraw.Draw(im)
    for y in range(h):
        t = y / h
        d.line([(0, y), (w, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(top, bottom, strict=True)))
    return im


def _stamp(im: Image.Image, lines: list[str]) -> bytes:
    w, h = im.size
    fs = max(14, w // 42)
    f = font(fs)
    pad = fs // 2
    bh = len(lines) * (fs + 6) + pad * 2
    overlay = Image.new("RGBA", (w, bh), (0, 0, 0, 140))
    im = im.convert("RGBA")
    im.alpha_composite(overlay, (0, h - bh))
    d = ImageDraw.Draw(im)
    for i, t in enumerate(lines):
        d.text((pad, h - bh + pad + i * (fs + 6)), t, fill=(255, 255, 255), font=f)
    out = io.BytesIO()
    im.convert("RGB").save(out, "JPEG", quality=78)
    return out.getvalue()


def selfie(name: str, lines: list[str]) -> bytes:
    w, h = 540, 720
    sky = R.choice([((120, 180, 220), (210, 230, 210)), ((230, 200, 150), (240, 230, 200)), ((150, 200, 170), (220, 235, 215))])
    im = _gradient(w, h, *sky)
    d = ImageDraw.Draw(im)
    d.rectangle((0, int(h * 0.62), w, h), fill=(110, 130, 80))  # field behind
    skin = R.choice([(198, 145, 105), (176, 124, 86), (214, 165, 125)])
    shirt = R.choice([(46, 122, 75), (40, 70, 120), (150, 60, 50), (90, 90, 100)])
    d.ellipse((w * 0.18, h * 0.62, w * 0.82, h * 1.25), fill=shirt)
    d.rectangle((w * 0.42, h * 0.52, w * 0.58, h * 0.66), fill=skin)
    d.ellipse((w * 0.30, h * 0.22, w * 0.70, h * 0.58), fill=skin)
    d.chord((w * 0.29, h * 0.19, w * 0.71, h * 0.42), 180, 360, fill=(30, 25, 22))
    d.ellipse((w * 0.40, h * 0.37, w * 0.44, h * 0.40), fill=(30, 25, 22))
    d.ellipse((w * 0.56, h * 0.37, w * 0.60, h * 0.40), fill=(30, 25, 22))
    d.arc((w * 0.43, h * 0.43, w * 0.57, h * 0.50), 20, 160, fill=(120, 60, 50), width=4)
    d.text((w * 0.06, h * 0.05), name.split()[0], fill=(255, 255, 255), font=font(28))
    return _stamp(im, lines)


def odometer(reading: float, lines: list[str]) -> bytes:
    w, h = 720, 540
    im = _gradient(w, h, (28, 30, 34), (10, 10, 12))
    d = ImageDraw.Draw(im)
    cx, cy, rad = w // 2, int(h * 0.55), 230
    d.arc((cx - rad, cy - rad, cx + rad, cy + rad), 150, 390, fill=(210, 210, 210), width=6)
    for k in range(13):
        a = math.radians(150 + k * 20)
        d.line([(cx + (rad - 25) * math.cos(a), cy + (rad - 25) * math.sin(a)), (cx + rad * math.cos(a), cy + rad * math.sin(a))], fill=(230, 230, 230), width=4)
    a = math.radians(R.uniform(190, 260))
    d.line([(cx, cy), (cx + (rad - 50) * math.cos(a), cy + (rad - 50) * math.sin(a))], fill=(230, 80, 40), width=7)
    digits = f"{int(reading):06d}"
    bx = cx - 3 * 52
    for i, ch in enumerate(digits):
        d.rounded_rectangle((bx + i * 52, cy + 40, bx + i * 52 + 46, cy + 108), radius=6, fill=(240, 240, 235))
        d.text((bx + i * 52 + 10, cy + 46), ch, fill=(20, 20, 20), font=font(48))
    d.text((cx + 170, cy + 60), "km", fill=(220, 220, 220), font=font(26))
    return _stamp(im, lines)


def stock_photo(kind: str, lines: list[str]) -> bytes:
    w, h = 720, 540
    im = _gradient(w, h, (170, 205, 230), (225, 235, 240))
    d = ImageDraw.Draw(im)
    d.rectangle((0, int(h * 0.6), w, h), fill=(150, 120, 85))
    if kind in ("diesel",):
        d.rounded_rectangle((220, 170, 500, 430), radius=30, fill=(200, 50, 40))
        d.rectangle((250, 200, 470, 230), fill=(240, 240, 240))
        d.text((262, 202), "DIESEL", fill=(200, 50, 40), font=font(26))
    elif kind in ("biochar", "ash"):
        for _ in range(3):
            x = R.randint(80, 480)
            d.pieslice((x, 230, x + 260, 500), 180, 360, fill=(35, 33, 30))
    elif kind in ("power",):
        d.rounded_rectangle((180, 120, 540, 440), radius=16, fill=(60, 64, 70))
        d.rectangle((220, 160, 500, 260), fill=(20, 40, 25))
        d.text((240, 182), f"{R.randint(900, 1400)} kWh", fill=(90, 230, 120), font=font(44))
    else:  # biomass, feedstock
        for _ in range(9):
            x, y = R.randint(40, 620), R.randint(250, 420)
            d.ellipse((x, y, x + 120, y + 70), fill=(R.randint(170, 200), R.randint(140, 165), R.randint(70, 95)))
    return _stamp(im, lines)


def signature_png(name: str) -> bytes:
    im = Image.new("RGBA", (600, 200), (255, 255, 255, 0))
    d = ImageDraw.Draw(im)
    x, y = 40, 120
    pts = []
    for i in range(70):
        x += R.uniform(4, 9)
        y = 110 + 40 * math.sin(i / 3.2) * R.uniform(0.6, 1.0) + R.uniform(-6, 6)
        pts.append((x, y))
    d.line(pts, fill=(20, 30, 80, 255), width=4, joint="curve")
    d.line([(60, 160), (x, 150)], fill=(20, 30, 80, 255), width=3)
    out = io.BytesIO()
    im.save(out, "PNG")
    return out.getvalue()


def kml(lat: float, lng: float, hectares: float) -> bytes:
    side = math.sqrt(hectares * 10_000)
    dlat = side / 111_320
    dlng = side / (111_320 * math.cos(math.radians(lat)))
    ring = [(lng, lat), (lng + dlng, lat), (lng + dlng * 1.05, lat + dlat), (lng - dlng * 0.05, lat + dlat), (lng, lat)]
    coords = " ".join(f"{a:.6f},{b:.6f},0" for a, b in ring)
    return (f'<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><Polygon>'
            f"<outerBoundaryIs><LinearRing><coordinates>{coords}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>"
            f"</Document></kml>").encode()


# ------------------------------------------------------------------ helpers


def put_file(db: Db, data: bytes, folder: str, name: str, mime: str, kind: str, user_id: str | None, at: datetime,
             lat: float | None = None, lng: float | None = None) -> str:
    rel, sha = store.put(folder, name, data)
    return db.insert("files", {"path": rel, "name": rel.rsplit("/", 1)[-1], "mime": mime, "size": len(data), "sha256": sha, "kind": kind,
                               "lat": lat, "lng": lng, "accuracy": R.uniform(4, 15) if lat else None, "taken_at": iso(at),
                               "uploaded_by": user_id, "created_at": iso(at)})


def near(lat: float, lng: float, metres: float) -> tuple[float, float, float]:
    a = R.uniform(0, 2 * math.pi)
    d = R.uniform(0.2, 1.0) * metres
    return lat + d * math.cos(a) / 111_320, lng + d * math.sin(a) / (111_320 * math.cos(math.radians(lat))), d


def when_text(dt: datetime) -> str:
    return dt.astimezone().strftime("%d %b %Y, %I:%M %p")


# ------------------------------------------------------------------ the demo


def seed_activity(db: Db) -> None:
    if db.one("SELECT 1 FROM attendance LIMIT 1") or db.one("SELECT 1 FROM plans LIMIT 1"):
        return
    users = {u["employee_id"]: u for u in db.all("SELECT * FROM users")}
    sites: dict = {}
    for s_ in db.all("SELECT * FROM sites ORDER BY rowid"):
        sites.setdefault(s_["project_type"], s_)  # the first site of each project
        sites[s_["name"]] = s_
    field = [("EMP101", "biochar"), ("EMP102", "agroforestry"), ("EMP103", "gasifier"), ("EMP106", "Viramgam Biochar Plant"), ("EMP107", "Deesa Agroforestry Site")]
    manager = users["EMP002"]
    now = datetime.now().astimezone()

    # ---- attendance: 12 working days back; today two people are already on site (EMP101 is left for you to try)
    for days_ago in range(13, 0, -1):
        day = local_day(days_ago, 9, 0)
        if day.weekday() == 6:
            continue
        for emp, ptype in field:
            u, s = users[emp], sites[ptype]
            if emp == "EMP102" and days_ago in (6, 7):  # on approved sick leave
                continue
            cin = local_day(days_ago, 8, R.randint(25, 59))
            cout = local_day(days_ago, 17, R.randint(5, 55))
            lat, lng, dist = near(s["lat"], s["lng"], s["radius_m"] * 0.7)
            pending = emp == "EMP103" and days_ago == 1
            if pending:
                lat, lng, dist = near(s["lat"], s["lng"], 1)
                lat += 380 / 111_320
                dist = 380.0
            f1 = put_file(db, selfie(u["name"], [f"{u['name']} · {s['name']}", "Check-in", when_text(cin), f"GPS {lat:.5f}, {lng:.5f} (±8 m)"]),
                          f"Sites/{s['name']}/Attendance", f"{cin:%Y-%m-%d %H-%M} {u['name']} check-in.jpg", "image/jpeg", "attendance", u["id"], cin, lat, lng)
            olat, olng, odist = near(s["lat"], s["lng"], s["radius_m"] * 0.7)
            f2 = put_file(db, selfie(u["name"], [f"{u['name']} · {s['name']}", "Check-out", when_text(cout), f"GPS {olat:.5f}, {olng:.5f} (±9 m)"]),
                          f"Sites/{s['name']}/Attendance", f"{cout:%Y-%m-%d %H-%M} {u['name']} check-out.jpg", "image/jpeg", "attendance", u["id"], cout, olat, olng)
            db.insert("attendance", {"user_id": u["id"], "site_id": s["id"], "checkin_at": iso(cin), "checkin_file": f1, "checkin_lat": lat, "checkin_lng": lng,
                                     "checkin_acc": 8, "checkin_dist": round(dist, 1), "checkout_at": iso(cout), "checkout_file": f2, "checkout_lat": olat,
                                     "checkout_lng": olng, "checkout_acc": 9, "checkout_dist": round(odist, 1), "status": "pending" if pending else "ok",
                                     "override_reason": "Working at the far feedstock yard; the boundary needs widening" if pending else ""})
    for emp, ptype, ago in (("EMP102", "agroforestry", 80), ("EMP103", "gasifier", 50)):
        u, s = users[emp], sites[ptype]
        cin = now - timedelta(minutes=ago)
        lat, lng, dist = near(s["lat"], s["lng"], s["radius_m"] * 0.6)
        f1 = put_file(db, selfie(u["name"], [f"{u['name']} · {s['name']}", "Check-in", when_text(cin), f"GPS {lat:.5f}, {lng:.5f} (±7 m)"]),
                      f"Sites/{s['name']}/Attendance", f"{cin:%Y-%m-%d %H-%M} {u['name']} check-in.jpg", "image/jpeg", "attendance", u["id"], cin, lat, lng)
        db.insert("attendance", {"user_id": u["id"], "site_id": s["id"], "checkin_at": iso(cin), "checkin_file": f1, "checkin_lat": lat, "checkin_lng": lng,
                                 "checkin_acc": 7, "checkin_dist": round(dist, 1), "status": "ok"})

    # ---- trips: approved ones in the past, one waiting for approval
    travel = db.setting("travel", {"vehicles": {"Two-wheeler": 3.5}})
    odo = {"EMP101": 48_213.0, "EMP102": 31_870.0}
    for days_ago in range(12, 0, -2):
        for emp in ("EMP101", "EMP102"):
            u = users[emp]
            s = sites["biochar" if emp == "EMP101" else "agroforestry"]
            vehicle = "Two-wheeler"
            km = round(R.uniform(18, 64), 1)
            t0, t1 = local_day(days_ago, 8, R.randint(0, 20)), local_day(days_ago, 18, R.randint(0, 40))
            start, end = odo[emp], odo[emp] + km
            odo[emp] = end + R.uniform(2, 9)
            rate = travel["vehicles"].get(vehicle, 3.5)
            purpose = R.choice(["Farmer visits, Vanthali cluster", "Biomass pickup from suppliers", "Plot survey with KML", "Village meeting on carbon programme"])
            fs = put_file(db, odometer(start, [f"{u['name']} · trip start", f"{vehicle} · {start:,.0f} km", when_text(t0)]), f"Travel/{u['name']}",
                          f"{t0:%Y-%m-%d} odometer start.jpg", "image/jpeg", "odometer", u["id"], t0, s["lat"], s["lng"])
            fe = put_file(db, odometer(end, [f"{u['name']} · trip end", f"{vehicle} · {end:,.0f} km", when_text(t1)]), f"Travel/{u['name']}",
                          f"{t1:%Y-%m-%d} odometer end.jpg", "image/jpeg", "odometer", u["id"], t1, s["lat"], s["lng"])
            waiting = days_ago == 2 and emp == "EMP102"
            db.insert("trips", {"user_id": u["id"], "site_id": s["id"], "vehicle": vehicle, "purpose": purpose, "start_at": iso(t0), "start_reading": start,
                                "start_file": fs, "start_lat": s["lat"], "start_lng": s["lng"], "end_at": iso(t1), "end_reading": end, "end_file": fe,
                                "end_lat": s["lat"] + 0.01, "end_lng": s["lng"] + 0.012, "km_claimed": km, "km_straight": round(km * R.uniform(0.35, 0.6), 1),
                                "rate_per_km": rate, "amount": round(km * rate, 2), "status": "submitted" if waiting else "approved",
                                "decided_by": None if waiting else manager["id"], "decided_at": None if waiting else iso(t1 + timedelta(hours=14)),
                                "decision_note": "" if waiting else "OK"})

    # ---- stock movements with photos
    plans_stock = {
        "Biomass (feedstock)": [("in", (1800, 2600), "biomass", "Truck GJ03 AB 1234"), ("out", (1500, 2100), "biomass", "Kiln run")],
        "Biochar (finished)": [("in", (280, 420), "biochar", "Kiln run"), ("out", (0, 0), "biochar", "")],
        "Diesel": [("out", (8, 14), "diesel", "Loader")],
        "Feedstock": [("in", (1500, 2200), "biomass", "Tractor trolley"), ("out", (1300, 1900), "biomass", "Gasifier feed")],
        "Power generated": [("in", (900, 1350), "power", "Daily meter")],
        "Ash / char": [("in", (40, 75), "ash", "Ash pit")],
    }
    for item in db.all("SELECT i.*, s.name AS site_name, s.lat, s.lng, s.project_type FROM register_items i JOIN sites s ON s.id = i.site_id"):
        who = users[{"Viramgam Biochar Plant": "EMP106", "Balaji Gasifier Site": "EMP103"}.get(item["site_name"], "EMP101")]
        bal = {"Diesel": 120.0, "Biomass (feedstock)": 3200.0, "Feedstock": 2600.0}.get(item["name"], 0.0)
        for days_ago in range(13, 0, -1):
            if local_day(days_ago, 9, 0).weekday() == 6:
                continue
            steps = list(plans_stock.get(item["name"], []))
            if item["name"] == "Diesel" and days_ago % 5 == 0:
                steps.insert(0, ("in", (100, 100), "diesel", "Pump receipt"))
            if item["name"] == "Biochar (finished)" and days_ago % 4 == 0:
                steps = [steps[0], ("out", (600, 900), "biochar", "Dispatched to farmers")]
            for k, (typ, (lo, hi), pic, ref) in enumerate(steps):
                if hi == 0:
                    continue
                q = float(round(R.uniform(lo, hi)))
                if typ == "out":
                    q = min(q, bal)
                    if q <= 0:
                        continue
                bal = bal + q if typ == "in" else bal - q
                at = local_day(days_ago, 10 + 3 * k, R.randint(0, 50))
                lat, lng, _ = near(item["lat"], item["lng"], 60)
                fid = put_file(db, stock_photo(pic, [f"{item['site_name']} · {item['name']}", f"{'In' if typ == 'in' else 'Out'} {q:,.0f} {item['unit']}",
                                                     who["name"], when_text(at)]), f"Sites/{item['site_name']}/Registers/{item['name']}",
                               f"{at:%Y-%m-%d %H-%M} {typ} {q:g}.jpg", "image/jpeg", "register", who["id"], at, lat, lng)
                db.insert("movements", {"item_id": item["id"], "user_id": who["id"], "type": typ, "qty": q, "balance_after": bal, "batch": ref, "note": "",
                                        "file_id": fid, "lat": lat, "lng": lng, "at": iso(at)})

    # ---- farmers, plots (with KML), and signed agreements
    s = sites["agroforestry"]
    kiran = users["EMP102"]
    villages = ["Vanthali", "Mendarda", "Bhesan", "Visavadar", "Keshod", "Maliya"]
    names = [("Ramesh Bhai Patel", "Karsan Bhai"), ("Savitaben Chavda", "Mohan Bhai"), ("Dinesh Bhai Sorathiya", "Valji Bhai"),
             ("Manjulaben Rabari", "Bhikha Bhai"), ("Haresh Bhai Kanani", "Gordhan Bhai"), ("Parul Ben Dobariya", "Jayesh Bhai"),
             ("Mahesh Bhai Vekariya", "Naran Bhai"), ("Kanta Ben Bhuva", "Ravji Bhai")]
    template = db.one("SELECT * FROM templates WHERE name LIKE 'Agroforestry%'")
    company = db.setting("company", {"name": "Sajeevan Life Pvt Ltd"})
    cs = db.one("SELECT path FROM files WHERE id = ?", db.setting("company_signature_file"))
    comp_sig = store.get(cs["path"]) if cs and store.exists(cs["path"]) else None
    for i, (name, father) in enumerate(names):
        made = local_day(13 - i, 11, 15)
        village = villages[i % len(villages)]
        fid_ = db.insert("farmers", {"name": name, "father_name": father, "village": village, "taluka": "Vanthali" if i % 2 else "Junagadh",
                                     "district": "Junagadh", "phone": f"98{R.randint(10000000, 99999999)}", "id_last4": f"{R.randint(1000, 9999)}",
                                     "site_id": s["id"], "created_by": kiran["id"], "created_at": iso(made)})
        declared = round(R.uniform(0.6, 2.4), 2)
        measured = round(declared * R.uniform(0.9, 1.15), 2)
        plat, plng, _ = near(s["lat"], s["lng"], 3000)
        kml_id = put_file(db, kml(plat, plng, measured), f"Farmers/{name} ({village})", f"Survey {120 + i} boundary.kml",
                          "application/vnd.google-earth.kml+xml", "kml", kiran["id"], made, plat, plng)
        db.insert("farmer_files", {"farmer_id": fid_, "kind": "kml", "file_id": kml_id, "created_at": iso(made)})
        db.insert("plots", {"farmer_id": fid_, "survey_no": str(120 + i), "area_ha_declared": declared, "area_ha_kml": measured, "kml_file": kml_id,
                            "created_at": iso(made)})
        if i < 4 and template:
            t = {**template, "fields": json.loads(template["fields"])}
            fields = {"survey_no": str(120 + i), "area_ha": str(measured), "trees_count": str(R.choice([120, 160, 200, 240])),
                      "species": R.choice(["Mango, Drumstick", "Teak, Neem", "Bamboo, Custard apple", "Lemon, Guava"]), "planting_month": "July 2026"}
            sig = signature_png(name)
            number = f"KL/{made.year}/{i + 1:05d}"
            pdf = render_document(company=company, template=t, fields={**fields, "company": company["name"]},
                                  farmer=db.one("SELECT * FROM farmers WHERE id = ?", fid_), recorded_by=f"{kiran['name']} ({kiran['employee_id']})",
                                  doc_no=number, when=made, lat=plat, lng=plng, signature_png=sig, company_signature_png=comp_sig,
                                  signature_sha=__import__("hashlib").sha256(sig).hexdigest())
            folder = f"Farmers/{name} ({village})"
            sig_id = put_file(db, sig, folder, f"{number.replace('/', '-')} signature.png", "image/png", "signature", kiran["id"], made, plat, plng)
            pdf_id = put_file(db, pdf, folder, f"{number.replace('/', '-')} {t['name']}.pdf", "application/pdf", "signed_document", kiran["id"], made, plat, plng)
            db.insert("documents", {"doc_no": number, "farmer_id": fid_, "template_id": t["id"], "user_id": kiran["id"], "fields": json.dumps(fields),
                                    "pdf_file": pdf_id, "signature_file": sig_id, "lat": plat, "lng": plng, "created_at": iso(made)})

    # ---- daily updates, leave, feedback
    summaries = {
        "EMP101": ["Two kiln runs, 2.1 t biomass charged, 410 kg biochar out. Loader serviced.", "Received 2.4 t cotton stalk from 3 suppliers; moisture checked.",
                   "Kiln K-2 lining repaired; one run only. Stock count done."],
        "EMP102": ["Visited 6 farmers in Mendarda; 2 agreements signed, KML for 3 plots.", "Sapling count at Vanthali nursery: 1,240 ready.",
                   "Village meeting at Bhesan on the carbon programme, 28 farmers."],
        "EMP103": ["Gasifier ran 9.5 h, 1,180 kWh. Feed rate steady at 210 kg/h.", "Ash pit cleared, 62 kg. Filter cleaned.", "Shutdown 2 h for cyclone check; restarted."],
    }
    for days_ago in range(6, 0, -1):
        for emp in ("EMP101", "EMP102", "EMP103"):
            if local_day(days_ago, 9, 0).weekday() == 6:
                continue
            db.insert("work_updates", {"user_id": users[emp]["id"], "date": local_day(days_ago, 9, 0).strftime("%Y-%m-%d"),
                                       "summary": R.choice(summaries[emp]), "hours": R.choice([8, 8.5, 9, 9.5]), "blockers": "",
                                       "created_at": iso(local_day(days_ago, 18, 30))})
    db.insert("leaves", {"user_id": users["EMP102"]["id"], "from_date": local_day(7, 9, 0).strftime("%Y-%m-%d"), "to_date": local_day(6, 9, 0).strftime("%Y-%m-%d"),
                         "type": "Sick", "reason": "Fever", "status": "approved", "decided_by": manager["id"], "decided_at": iso(local_day(8, 10, 0)),
                         "decision_note": "Get well soon", "created_at": iso(local_day(8, 8, 0))})
    db.insert("leaves", {"user_id": users["EMP101"]["id"], "from_date": local_day(-5, 9, 0).strftime("%Y-%m-%d"), "to_date": local_day(-6, 9, 0).strftime("%Y-%m-%d"),
                         "type": "Casual", "reason": "Family function in the village", "status": "pending", "created_at": iso(now - timedelta(hours=20))})
    db.insert("feedback", {"user_id": None, "type": "complaint", "text": "No drinking water cooler at the Lodhika kiln yard in the afternoon heat.",
                           "status": "open", "created_at": iso(local_day(2, 14, 0))})
    db.insert("feedback", {"user_id": users["EMP103"]["id"], "type": "suggestion", "text": "A second ash trolley would save an hour every day.",
                           "status": "closed", "response": "Approved, ordering one this week.", "responded_by": users["EMP003"]["id"],
                           "responded_at": iso(local_day(3, 11, 0)), "created_at": iso(local_day(4, 16, 0))})

    # ---- HR documents (payslips)
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas as pdfcanvas

    month = (now.replace(day=1) - timedelta(days=1)).strftime("%B %Y")
    for emp in ("EMP101", "EMP102", "EMP103"):
        u = users[emp]
        buf = io.BytesIO()
        c = pdfcanvas.Canvas(buf, pagesize=A4)
        c.setFillColorRGB(0.18, 0.48, 0.29)
        c.rect(0, 800, 600, 42, fill=1, stroke=0)
        c.setFillColorRGB(1, 1, 1)
        c.setFont("Helvetica-Bold", 16)
        c.drawString(40, 815, f"{company['name']} · Payslip {month}")
        c.setFillColorRGB(0, 0, 0)
        c.setFont("Helvetica", 12)
        for k, line in enumerate([f"Employee: {u['name']} ({u['employee_id']})", f"Designation: {u['designation']}", "Basic: ₹18,500", "Allowances: ₹4,200",
                                  "Travel (approved): as per trips", "Deductions (PF): ₹2,220", "Net pay: ₹20,480"]):
            c.drawString(40, 760 - k * 22, line)
        c.showPage()
        c.save()
        fid = put_file(db, buf.getvalue(), f"HR/{u['name']}", f"Payslip {month}.pdf", "application/pdf", "hr_document", users["EMP003"]["id"], now - timedelta(days=3))
        db.insert("hr_documents", {"user_id": u["id"], "title": f"Payslip {month}", "category": "Payslip", "file_id": fid, "uploaded_by": users["EMP003"]["id"],
                                   "created_at": iso(now - timedelta(days=3))})

    seed_planner(db, users, sites)

    # ---- inbox: what each person would have been told
    db.notify(manager["id"], "Trip to approve: Kiran Vaghela", "Two-wheeler trip, awaiting your approval", "#approvals")
    db.notify(manager["id"], "Check-in exception: Suresh Makwana", "380 m from Balaji Gasifier Site: Working at the far feedstock yard", "#approvals")
    db.notify(manager["id"], "Leave request: Jignesh Rathod", "Casual leave next week", "#approvals")
    db.notify(users["EMP101"]["id"], "Trip approved", "Your last trip was approved", "#trips")
    db.notify(users["EMP101"]["id"], f"Payslip {month}", "HR uploaded your payslip", "#me")
    db.audit(None, "seed", "demo", None, "demo activity")


def seed_planner(db: Db, users: dict, sites: dict) -> None:
    planner.init(db)
    m = users["EMP002"]
    today = datetime.now().astimezone().date()

    def day(n: int) -> str:
        return (today + timedelta(days=n)).isoformat()

    def make_plan(name: str, site: str | None, color: str, buckets: list[str]) -> tuple[str, dict[str, str]]:
        pid = db.insert("plans", {"name": name, "site_id": sites[site]["id"] if site else None, "color": color, "labels": json.dumps(planner.DEFAULT_LABELS),
                                  "created_by": m["id"], "created_at": iso(local_day(14, 9, 0))})
        ids = {b: db.insert("buckets", {"plan_id": pid, "name": b, "sort": i}) for i, b in enumerate(buckets)}
        return pid, ids

    def task(pid: str, bucket: str, title: str, who: list[str], *, prio: str = "medium", due: int | None = None, start: int | None = None,
             progress: str = "not_started", labels: tuple = (), checklist: tuple = (), done_items: int = 0, notes: str = "", photo: bool = False,
             done_note: str = "", sort: float = 0) -> str:
        items = [{"text": t, "done": i < done_items} for i, t in enumerate(checklist)]
        created = local_day(R.randint(4, 12), 9, 30)
        row = {"plan_id": pid, "bucket_id": bucket, "title": title, "notes": notes, "priority": prio, "progress": progress,
               "start_date": day(start) if start is not None else None, "due_date": day(due) if due is not None else None,
               "labels": json.dumps(list(labels)), "checklist": json.dumps(items), "photo_required": 1 if photo else 0, "sort": sort,
               "created_by": m["id"], "created_at": iso(created), "updated_at": iso(created)}
        if progress == "completed":
            row.update({"completed_at": iso(local_day(R.randint(1, 3), 16, 20)), "completed_by": users[who[0]]["id"] if who else m["id"],
                        "completion_note": done_note})
        tid = db.insert("tasks", row)
        for emp in who:
            db.insert("task_assignees", {"task_id": tid, "user_id": users[emp]["id"]})
        return tid

    pid, b = make_plan("Lodhika Kiln Site · November", "biochar", "earth", ["To do", "This week", "Kiln maintenance", "Done this month"])
    task(pid, b["This week"], "Stock count: biomass and biochar", ["EMP101"], prio="important", due=0, labels=("pink",),
         checklist=("Count biomass bales", "Weigh biochar sacks", "Photograph both heaps", "Enter counts in the register"), done_items=1,
         notes="Physical count for the monthly carbon audit. Enter each count in the register so the variance is recorded.", photo=True, progress="in_progress")
    task(pid, b["This week"], "Collect supplier declarations for cotton stalk", ["EMP101"], due=2, labels=("blue", "pink"),
         checklist=("Bharat Bhai (2.4 t)", "Mansukh Bhai (1.8 t)", "Govind Bhai (2.1 t)"), notes="Biomass Supply Declaration for each supplier this week.")
    task(pid, b["Kiln maintenance"], "Replace kiln K-2 lining bricks", ["EMP101"], prio="urgent", due=-1, labels=("yellow", "red"),
         checklist=("Cool down 24 h", "Remove damaged bricks", "Fit new lining", "Test burn"), done_items=2, progress="in_progress",
         notes="Overdue: the lining crack is widening.")
    task(pid, b["Kiln maintenance"], "Loader service (500 h)", ["EMP101"], due=5, labels=("yellow",))
    task(pid, b["To do"], "Fire-safety drill with the kiln crew", ["EMP101"], prio="important", due=7, labels=("red", "purple"))
    task(pid, b["To do"], "Buy two drinking-water coolers for the yard", [], due=3, labels=("red",), notes="From the complaint raised in HR desk.")
    task(pid, b["Done this month"], "Install new weighbridge display", ["EMP101"], progress="completed", labels=("yellow",), done_note="Installed and calibrated with a 500 kg test weight.")
    task(pid, b["Done this month"], "Monthly biochar sample to the lab", ["EMP101"], progress="completed", labels=("pink",), done_note="Couriered to the lab; receipt in the folder.")

    pid, b = make_plan("Nava Agroforestry · monsoon planting", "agroforestry", "leaf", ["Farmer onboarding", "Plot surveys", "Planting", "Completed"])
    task(pid, b["Farmer onboarding"], "Sign agreements: Bhesan village (5 farmers)", ["EMP102"], prio="important", due=4, labels=("green", "blue"),
         checklist=("Harsukh Bhai", "Lalji Bhai", "Champaben", "Dhiru Bhai", "Vasant Bhai"), done_items=2, progress="in_progress")
    task(pid, b["Plot surveys"], "KML boundaries for Mendarda plots", ["EMP102"], due=1, labels=("green",),
         checklist=("Survey 131", "Survey 134", "Survey 140"), done_items=3, progress="in_progress",
         notes="Walk each boundary with the phone and upload the KML to the farmer's page.")
    task(pid, b["Planting"], "Distribute 1,200 saplings to Vanthali farmers", ["EMP102"], prio="urgent", due=6, start=3, labels=("green",), photo=True)
    task(pid, b["Planting"], "Survival count at 30 days: Keshod", ["EMP102"], due=12, labels=("pink",))
    task(pid, b["Completed"], "Village meeting on the carbon programme", ["EMP102"], progress="completed", labels=("purple",),
         done_note="28 farmers attended; 9 interested in joining.")

    gp, gb = make_plan("General · head office and other work", None, "violet", ["To do", "In progress", "Done"])
    task(gp, gb["To do"], "Survey a new biochar site at Bhachau, Kutch (not in the app yet)", ["EMP002"], prio="important", due=9, labels=("green",),
         notes="Site visit for a possible third biochar location; not a site in the app, so this plan has no site.")
    task(gp, gb["To do"], "Collect annual health check reports from everyone", ["EMP003"], due=12, labels=("blue",))
    task(gp, gb["In progress"], "Help the Deesa team with the district forest office meeting", ["EMP107", "EMP005"], due=3, labels=("purple",), progress="in_progress")
    task(gp, gb["To do"], "Prepare carbon registry audit binder (all projects)", ["EMP001", "EMP002", "EMP005"], prio="urgent", due=6, labels=("pink",),
         checklist=("Biochar batch reports", "Agroforestry survival data", "Gasifier run logs"))
    task(gp, gb["Done"], "Renew vehicle insurance for the company car", ["EMP002"], progress="completed", done_note="Renewed till Nov 2027.")

    pid, b = make_plan("Balaji Gasifier · operations", "gasifier", "blue", ["Daily", "Maintenance", "Compliance", "Done"])
    task(pid, b["Maintenance"], "Clean cyclone and filter housing", ["EMP103"], prio="important", due=0, labels=("yellow",),
         checklist=("Shut down safely", "Clean cyclone", "Replace filter", "Restart and log"), done_items=4, progress="in_progress", photo=True)
    task(pid, b["Daily"], "Log power generation at 6 pm", ["EMP103"], due=0, labels=("blue",))
    task(pid, b["Compliance"], "Pollution board inspection: keep logs ready", ["EMP103"], prio="urgent", due=2, labels=("blue", "pink"),
         checklist=("Last 3 months' run log", "Ash disposal records", "Fire NOC copy"))
    task(pid, b["Done"], "Train new helper on feed hopper safety", ["EMP103"], progress="completed", labels=("purple", "red"),
         done_note="Trained Ramesh; signed the safety register.")


def reset() -> None:
    """Wipe the database and stored files, then build the demo again."""
    from seed import seed_if_empty

    db = Db()
    try:
        tables = [r["name"] for r in db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")]
        for t in tables:
            db.con.execute(f"DELETE FROM {t}")  # noqa: S608
        db.con.commit()
    finally:
        db.close()
    if FILES_DIR.exists():
        for child in FILES_DIR.iterdir():
            if child.is_dir():
                shutil.rmtree(child, ignore_errors=True)
            else:
                child.unlink(missing_ok=True)
    init_db()
    seed_if_empty()
    import demo_modules
    import hrops
    import modules

    db = Db()
    try:
        planner.init(db)
        modules.init(db)
        hrops.init(db)
        seed_activity(db)
        demo_modules.seed(db)
        hrops.seed(db)
    finally:
        db.close()


__all__ = ["DB_PATH", "now_iso", "reset", "seed_activity"]
