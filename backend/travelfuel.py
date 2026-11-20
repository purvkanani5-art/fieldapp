"""Travel plans and the fuel check (owner 2026-11-20, "Release 2").

- A manager assigns a travel plan: a person, a day or a whole week, the sites to visit in order (from a start site,
  optionally back to it). The planned distance is the road distance from the free OpenStreetMap router (OSRM); when it is
  busy, straight line x 1.3. Sites with no fixed place (Farmer-land / Retro) have no point and are left out of the km.
- A trip's odometer distance is compared with the day's plan; over the limit (Settings, default 15%) it is flagged for
  the approver and the director is told.
- Odometer and fuel-bill photos are read on the server (Azure AI Vision when configured, else Tesseract when installed);
  the phone fills the reading in and asks the person to type it only when the reading is unsure. Both numbers are kept;
  a typed reading far from a sure photo reading is flagged.
- A fuel bill (expense, Fuel): litres bought vs the litres the km since the previous fuel bill should have needed
  (km / the vehicle's mileage, set in Settings), and the rate per litre vs recent bills; over the limit: flagged and the
  director is told (flag only, owner chose; it still goes for approval). Prices are the ones on the bills, not a feed."""

import json
import math
import os
import re
import shutil
import statistics
import subprocess
import tempfile
import threading
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from starlette.datastructures import UploadFile as FormFile

from db import Db, now_iso

SCHEMA = """
CREATE TABLE IF NOT EXISTS travel_plans (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, date TEXT NOT NULL, start_site TEXT, stops TEXT NOT NULL DEFAULT '[]', return_to_start INTEGER DEFAULT 1,
  planned_km REAL, km_note TEXT DEFAULT '', note TEXT DEFAULT '', created_by TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tplan_user ON travel_plans (user_id, date);
"""
MIGRATIONS = ["ALTER TABLE trips ADD COLUMN plan_id TEXT", "ALTER TABLE trips ADD COLUMN planned_km REAL", "ALTER TABLE trips ADD COLUMN flags TEXT DEFAULT '[]'",
              "ALTER TABLE trips ADD COLUMN start_read REAL", "ALTER TABLE trips ADD COLUMN end_read REAL"]
FUELS = ["Petrol", "Diesel", "CNG"]
DEFAULTS = {"limit_pct": 15, "specs": {}}  # specs: vehicle name -> {"fuel": "Petrol", "mileage": 45}


def init(db: Db) -> None:
    db.con.executescript(SCHEMA)
    for sql in MIGRATIONS:
        try:
            db.con.execute(sql)
        except Exception:  # noqa: BLE001 - already there
            pass
    db.con.commit()


def settings(db: Db) -> dict:
    s = db.setting("travel_fuel") or {}
    return {**DEFAULTS, **s, "specs": {**DEFAULTS["specs"], **(s.get("specs") or {})}}


def limit(db: Db) -> float:
    return max(1.0, float(settings(db).get("limit_pct") or 15)) / 100


def _tell_director(db: Db, title: str, body: str, link: str) -> None:
    for u in db.all("SELECT id FROM users WHERE role = 'admin' AND active = 1"):
        db.notify(u["id"], title, body, link)


# ------------------------------------------------------------------ road distance

_route_cache: dict[str, tuple[float, str]] = {}
_route_lock = threading.Lock()


def _hav_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0088 * math.asin(math.sqrt(h))


def route_km(points: list[tuple[float, float]]) -> tuple[float, str]:
    """Road km through the points in order (OSRM), else straight line x 1.3."""
    if len(points) < 2:
        return 0.0, "fewer than two places with a location"
    key = ";".join(f"{lng:.5f},{lat:.5f}" for lat, lng in points)
    if key in _route_cache:
        return _route_cache[key]
    out: tuple[float, str]
    try:
        with _route_lock:
            req = urllib.request.Request(f"https://router.project-osrm.org/route/v1/driving/{key}?overview=false",
                                         headers={"User-Agent": "Kshetralekha/0.6 (+https://kshetralekha.sajeevan.co.in)"})
            with urllib.request.urlopen(req, timeout=10) as r:
                data = json.loads(r.read().decode())
        if data.get("code") != "Ok" or not data.get("routes"):
            raise ValueError(data.get("code"))
        out = (round(data["routes"][0]["distance"] / 1000, 1), "road distance")
    except Exception:  # noqa: BLE001 - the free router is busy or unreachable
        out = (round(sum(_hav_km(points[i], points[i + 1]) for i in range(len(points) - 1)) * 1.3, 1), "straight line x 1.3 (road router unavailable)")
    _route_cache[key] = out
    return out


def plan_km(db: Db, start_site: str | None, stops: list[str], back: bool) -> tuple[float, str]:
    ids = ([start_site] if start_site else []) + stops + ([start_site] if start_site and back else [])
    pts, skipped = [], []
    for sid in ids:
        s = db.one("SELECT name, lat, lng, COALESCE(fenced, 1) AS fenced FROM sites WHERE id = ?", sid)
        if s and s["fenced"] and (s["lat"] or s["lng"]):
            pts.append((s["lat"], s["lng"]))
        elif s:
            skipped.append(s["name"])
    km, how = route_km(pts)
    if skipped:
        how += f"; no location for {', '.join(dict.fromkeys(skipped))} (not counted)"
    return km, how


# ------------------------------------------------------------------ reading photos (odometer, fuel bill)

_token: dict[str, Any] = {"value": "", "until": 0.0}


def _vision_auth() -> dict[str, str] | None:
    """Owner 2026-11-20: "limit this API only to kshetralekha". On the live server the app signs in with its own Azure
    identity (key access is switched off on the reader, which also accepts only the app's addresses); a key is used only
    where one is set (a developer's machine)."""
    key = os.environ.get("KL_VISION_KEY", "")
    if key:
        return {"Ocp-Apim-Subscription-Key": key}
    ep, hdr = os.environ.get("IDENTITY_ENDPOINT", ""), os.environ.get("IDENTITY_HEADER", "")
    if not ep or not hdr:
        return None
    import time
    if _token["value"] and time.time() < _token["until"] - 300:
        return {"Authorization": f"Bearer {_token['value']}"}
    q = urllib.parse.urlencode({"resource": "https://cognitiveservices.azure.com", "api-version": "2019-08-01"})
    with urllib.request.urlopen(urllib.request.Request(f"{ep}?{q}", headers={"X-IDENTITY-HEADER": hdr}), timeout=10) as r:
        tok = json.loads(r.read().decode())
    _token.update(value=tok["access_token"], until=float(tok.get("expires_on") or time.time() + 3000))
    return {"Authorization": f"Bearer {_token['value']}"}


def _words_azure(blob: bytes) -> list[tuple[str, float]] | None:
    ep = os.environ.get("KL_VISION_ENDPOINT", "").rstrip("/")
    auth = _vision_auth() if ep else None
    if not ep or not auth:
        return None
    req = urllib.request.Request(f"{ep}/computervision/imageanalysis:analyze?api-version=2023-10-01&features=read", data=blob, method="POST",
                                 headers={**auth, "Content-Type": "application/octet-stream"})
    with urllib.request.urlopen(req, timeout=20) as r:
        res = json.loads(r.read().decode())
    out = []
    for blk in (res.get("readResult") or {}).get("blocks", []):
        for ln in blk.get("lines", []):
            for w in ln.get("words", []):
                out.append((w.get("text", ""), float(w.get("confidence", 0)) * 100))
            out.append(("\n", 100.0))
    return out


def _words_tesseract(blob: bytes, digits: bool) -> list[tuple[str, float]] | None:
    exe = shutil.which("tesseract")
    if not exe:
        return None
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
        f.write(blob)
        path = f.name
    try:
        args = [exe, path, "stdout", "--psm", "6" if not digits else "11"] + (["-c", "tessedit_char_whitelist=0123456789."] if digits else []) + ["tsv"]
        res = subprocess.run(args, capture_output=True, text=True, timeout=25)  # noqa: S603 - fixed program, temp file
        out, line = [], None
        for row in res.stdout.splitlines()[1:]:
            c = row.split("\t")
            if len(c) >= 12 and c[11].strip():
                if line is not None and c[4] != line:
                    out.append(("\n", 100.0))
                line = c[4]
                out.append((c[11].strip(), float(c[10] or 0)))
        return out
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def read_words(blob: bytes, digits: bool = False) -> tuple[list[tuple[str, float]], str]:
    try:
        w = _words_azure(blob)
        if w is not None:
            return w, "azure"
    except Exception:  # noqa: BLE001 - fall back to the local reader
        pass
    try:
        w = _words_tesseract(blob, digits)
        if w is not None:
            return w, "tesseract"
    except Exception:  # noqa: BLE001
        pass
    return [], "none"


def vision_self_test() -> None:
    """At start-up on the live server: read a small made-up odometer once and log whether the Azure reader answers."""
    if not os.environ.get("KL_VISION_ENDPOINT"):
        return

    def run() -> None:
        import io
        import sys
        try:
            from PIL import Image, ImageDraw
            im = Image.new("RGB", (360, 120), "white")
            ImageDraw.Draw(im).text((20, 40), "048213", fill="black")
            b = io.BytesIO()
            im.save(b, "JPEG")
            w = _words_azure(b.getvalue())
            print(f"vision self-test: {'ok' if w is not None else 'not configured'} ({len(w or [])} words)", file=sys.stderr)
        except Exception as e:  # noqa: BLE001 - logged, the app falls back to Tesseract
            print(f"vision self-test: failed: {e}", file=sys.stderr)

    threading.Thread(target=run, name="vision-self-test", daemon=True).start()


def read_odometer(blob: bytes, near: float | None = None) -> dict:
    """The odometer number on the photo, and whether it is sure enough to fill in without asking."""
    words, engine = read_words(blob, digits=True)
    cands = []
    for t, conf in words:
        for m in re.finditer(r"\d[\d,]{2,8}(?:\.\d)?", t):
            v = float(m.group(0).replace(",", ""))
            cands.append((v, conf, len(m.group(0))))
    if not cands:
        return {"value": None, "sure": False, "engine": engine}
    if near is not None:  # close to what the reading should be (the start of the trip, the last reading) wins
        cands.sort(key=lambda c: (abs(c[0] - near) > 2000, -c[1], -c[2]))
    else:
        cands.sort(key=lambda c: (-c[2], -c[1]))
    v, conf, _ = cands[0]
    sure = conf >= 85 and (near is None or 0 <= v - near <= 1500)
    return {"value": v, "sure": bool(sure), "confidence": round(conf), "engine": engine}


def read_fuel_bill(blob: bytes) -> dict:
    """Litres, rate per litre and amount from a fuel bill; sure only when they agree (litres x rate = amount)."""
    words, engine = read_words(blob)
    lines = [ln.strip().lower() for ln in " ".join(t for t, _ in words).split("\n") if ln.strip()]
    rate_words = r"rate|price|rs\s*/\s*l|rs/ltr|₹\s*/\s*l|per\s*l"

    def near(keys: str, skip: str = "") -> float | None:
        """The first number after the label, on a line that has the label (and none of the words to skip)."""
        for ln in lines:
            if skip and re.search(skip, ln):
                continue
            m = re.search(rf"(?:{keys})[^0-9]{{0,18}}([0-9]{{1,6}}(?:[.,][0-9]{{1,3}})?)", ln)
            if m:
                return float(m.group(1).replace(",", "."))
        return None

    # "Rs/L" on the rate line must not be taken for the litres label
    litres = near(r"vol(?:ume)?|qty|quantity|litres?|ltrs?|ltr", rate_words) or near(r"\bl\b", rate_words)
    rate = near(rate_words)
    amount = near(r"amount|amt|total|sale", rate_words) or near(r"rs\.?|inr|₹", rate_words)
    sure = bool(litres and rate and amount and abs(litres * rate - amount) <= max(2.0, amount * 0.02))
    if litres and rate and not amount:
        amount = round(litres * rate, 2)
    conf = statistics.mean([c for _, c in words]) if words else 0
    return {"litres": litres, "rate": rate, "amount": amount, "sure": sure and conf >= 70, "engine": engine}


# ------------------------------------------------------------------ checks

def check_trip(db: Db, trip_id: str) -> None:
    """After a trip ends: compare with the day's plan and the photo readings; flag and tell the director when off."""
    t = db.one("SELECT t.*, u.name AS user_name FROM trips t JOIN users u ON u.id = t.user_id WHERE t.id = ?", trip_id)
    if not t or t["km_claimed"] is None:
        return
    flags = []
    day = t["start_at"][:10]
    try:
        import modules
        day = modules.to_local(t["start_at"]).date().isoformat()
    except Exception:  # noqa: BLE001
        pass
    plan = db.one("SELECT * FROM travel_plans WHERE user_id = ? AND date = ?", t["user_id"], day)
    patch: dict[str, Any] = {}
    if plan and plan["planned_km"]:
        done = (db.one("SELECT COALESCE(SUM(km_claimed), 0) AS k FROM trips WHERE user_id = ? AND substr(start_at, 1, 10) = substr(?, 1, 10) AND km_claimed IS NOT NULL",
                       t["user_id"], t["start_at"]) or {"k": 0})["k"]
        patch.update(plan_id=plan["id"], planned_km=plan["planned_km"])
        if done > plan["planned_km"] * (1 + limit(db)):
            flags.append(f"{done:g} km against {plan['planned_km']:g} km planned ({(done / plan['planned_km'] - 1) * 100:.0f}% over)")
    for side in ("start", "end"):
        read, typed = t.get(f"{side}_read"), t[f"{side}_reading"]
        if read is not None and typed is not None and abs(read - typed) > max(5.0, typed * 0.002):
            flags.append(f"{side} reading typed {typed:g}, photo shows {read:g}")
    patch["flags"] = json.dumps(flags)
    db.update("trips", trip_id, patch)
    if flags:
        _tell_director(db, f"Trip flagged: {t['user_name']}", "; ".join(flags)[:200], "#trips")


def check_fuel(db: Db, rec: dict) -> dict:
    """A fuel bill: litres vs the km since the previous fuel bill / mileage; rate vs recent bills. Returns the check."""
    d = json.loads(rec["data"] or "{}")
    litres, rate = float(d.get("litres") or 0), float(d.get("rate") or 0)
    if litres <= 0:
        return {}
    uid, when = rec["user_id"] or rec["created_by"], str(d.get("date") or rec["created_at"][:10])
    prev = None
    for r in db.all("SELECT data, created_at FROM records WHERE kind = 'expense' AND (user_id = ? OR created_by = ?) AND id <> ? AND status NOT IN ('rejected', 'withdrawn')",
                    uid, uid, rec["id"]):
        x = json.loads(r["data"] or "{}")
        if x.get("category") == "Fuel" and float(x.get("litres") or 0) > 0 and str(x.get("date") or "") < when and (prev is None or str(x["date"]) > prev):
            prev = str(x["date"])
    trip = db.one("SELECT vehicle FROM trips WHERE user_id = ? ORDER BY start_at DESC LIMIT 1", uid)
    vehicle = d.get("vehicle") or (trip["vehicle"] if trip else "")
    spec = settings(db)["specs"].get(vehicle) or {}
    mileage = float(spec.get("mileage") or 0)
    out: dict[str, Any] = {"vehicle": vehicle, "mileage": mileage or None, "since": prev, "flags": []}
    lim = limit(db)
    if prev and mileage > 0:
        km = (db.one("SELECT COALESCE(SUM(km_claimed), 0) AS k FROM trips WHERE user_id = ? AND km_claimed IS NOT NULL AND substr(start_at, 1, 10) > ? AND substr(start_at, 1, 10) <= ?",
                     uid, prev, when) or {"k": 0})["k"]
        expected = round(km / mileage, 1)
        out.update(km=round(km, 1), expected_litres=expected)
        if litres > expected * (1 + lim) and litres - expected > 2:
            out["flags"].append(f"{litres:g} L bought; {km:g} km since the last fuel bill needs about {expected:g} L ({vehicle}, {mileage:g} km/L)")
    if rate > 0:
        rates = []
        cut = (date.fromisoformat(when[:10]) - timedelta(days=30)).isoformat() if re.match(r"\d{4}-\d\d-\d\d", when) else ""
        for r in db.all("SELECT data FROM records WHERE kind = 'expense' AND id <> ?", rec["id"]):
            x = json.loads(r["data"] or "{}")
            if x.get("category") == "Fuel" and float(x.get("rate") or 0) > 0 and str(x.get("date") or "") >= cut and \
                    (settings(db)["specs"].get(x.get("vehicle") or "", {}).get("fuel") or "") == (spec.get("fuel") or ""):
                rates.append(float(x["rate"]))
        if len(rates) >= 3:
            med = statistics.median(rates)
            out["usual_rate"] = round(med, 2)
            if rate > med * (1 + lim):
                out["flags"].append(f"rate ₹{rate:g}/L against the usual ₹{med:.2f}/L")
    return out


# ------------------------------------------------------------------ routes

def make_router(user_dep: Any, db_dep: Any) -> APIRouter:
    r = APIRouter(prefix="/api")

    def staff(user: dict) -> None:
        if user["role"] not in ("admin", "manager", "hr"):
            raise HTTPException(403, "Managers assign travel plans")

    def plan_out(db: Db, p: dict) -> dict:
        stops = json.loads(p["stops"] or "[]")
        names = {s["id"]: s["name"] for s in db.all("SELECT id, name FROM sites")}
        u = db.one("SELECT name FROM users WHERE id = ?", p["user_id"])
        done = db.one("SELECT COALESCE(SUM(km_claimed), 0) AS k, COUNT(*) AS n FROM trips WHERE user_id = ? AND km_claimed IS NOT NULL AND substr(start_at, 1, 10) = ?",
                      p["user_id"], p["date"])
        route = ([names.get(p["start_site"], "?")] if p["start_site"] else []) + [names.get(s, "?") for s in stops] + \
                ([names.get(p["start_site"], "?")] if p["start_site"] and p["return_to_start"] else [])
        return {**p, "stops": stops, "route": route, "user_name": u["name"] if u else "", "done_km": done["k"] if done and done["n"] else None}

    @r.get("/travelplans")
    def plans(user: user_dep, db: db_dep, scope: str = "mine", start: str = "", end: str = ""):
        start = start or (date.today() - timedelta(days=7)).isoformat()
        end = end or (date.today() + timedelta(days=14)).isoformat()
        if scope == "team" and user["role"] in ("admin", "manager", "hr"):
            import modules
            team = None if user["role"] in ("admin", "hr") or user.get("all_sites") else modules.team_ids(db, user)
            rows = [p for p in db.all("SELECT * FROM travel_plans WHERE date BETWEEN ? AND ? ORDER BY date, user_id", start, end) if team is None or p["user_id"] in team or p["created_by"] == user["id"]]
        else:
            rows = db.all("SELECT * FROM travel_plans WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date", user["id"], start, end)
        return {"rows": [plan_out(db, p) for p in rows]}

    @r.post("/travelplans")
    def save_plans(payload: dict, user: user_dep, db: db_dep):
        """One plan per day: a single day, or every working day from - to (a week)."""
        staff(user)
        uid = str(payload.get("userId") or "")
        if not db.one("SELECT 1 FROM users WHERE id = ? AND active = 1", uid):
            raise HTTPException(422, "Choose the person")
        stops = [s for s in dict.fromkeys(str(x) for x in payload.get("stops") or []) if db.one("SELECT 1 FROM sites WHERE id = ?", s)]
        if not stops:
            raise HTTPException(422, "Add at least one site to visit")
        start_site = str(payload.get("startSite") or "") or None
        if start_site and not db.one("SELECT 1 FROM sites WHERE id = ?", start_site):
            start_site = None
        try:
            d0 = date.fromisoformat(str(payload.get("from"))[:10])
            d1 = date.fromisoformat(str(payload.get("to") or payload.get("from"))[:10])
        except ValueError as e:
            raise HTTPException(422, "Choose the day (or the first and last day)") from e
        if d1 < d0 or (d1 - d0).days > 13:
            raise HTTPException(422, "Plan one day or up to two weeks at a time")
        back = bool(payload.get("returnToStart", True))
        km, how = plan_km(db, start_site, stops, back)
        made = []
        d = d0
        import modules
        while d <= d1:
            if d0 == d1 or modules.working_day(db, d):
                db.run("DELETE FROM travel_plans WHERE user_id = ? AND date = ?", uid, d.isoformat())  # a new plan for a day replaces the old one
                made.append(db.insert("travel_plans", {"user_id": uid, "date": d.isoformat(), "start_site": start_site, "stops": json.dumps(stops), "return_to_start": 1 if back else 0,
                                                       "planned_km": km, "km_note": how, "note": str(payload.get("note") or "")[:300], "created_by": user["id"], "created_at": now_iso()}))
            d += timedelta(days=1)
        if uid != user["id"]:
            db.notify(uid, f"Travel plan: {d0:%d %b}" + (f" to {d1:%d %b}" if d1 != d0 else ""), f"{len(stops)} place(s), about {km:g} km a day", "#trips")
        db.audit(user["id"], "travel_plan", "travel_plan", made[0] if made else None, f"{len(made)} day(s), {km:g} km")
        return {"ids": made, "plannedKm": km, "how": how}

    @r.post("/travelplans/{pid}/delete")
    def delete_plan(pid: str, user: user_dep, db: db_dep):
        staff(user)
        db.run("DELETE FROM travel_plans WHERE id = ?", pid)
        return {"ok": True}

    @r.get("/travelplans/estimate")
    def estimate(user: user_dep, db: db_dep, stops: str, startSite: str = "", back: int = 1):
        staff(user)
        km, how = plan_km(db, startSite or None, [s for s in stops.split(",") if s], bool(back))
        return {"km": km, "how": how}

    @r.post("/ocr/read")
    async def ocr(request: Request, user: user_dep):
        """Read an odometer or a fuel bill photo (the phone fills the numbers in; the person types only when unsure)."""
        form = await request.form()
        up = form.get("photo")
        if not isinstance(up, FormFile):
            raise HTTPException(422, "Send the photo")
        blob = await up.read()
        if len(blob) > 8_000_000:
            raise HTTPException(413, "Photo too large")
        kind = str(form.get("kind") or "odometer")
        if kind == "fuel":
            return read_fuel_bill(blob)
        near = float(form.get("near")) if str(form.get("near") or "").replace(".", "", 1).isdigit() else None
        return read_odometer(blob, near)

    @r.get("/travelfuel/settings")
    def get_settings(user: user_dep, db: db_dep):
        travel = db.setting("travel", {"vehicles": {}}) or {"vehicles": {}}
        s = settings(db)
        return {"limitPct": s["limit_pct"], "fuels": FUELS, "vehicles": [{"name": v, "rate": rate, **(s["specs"].get(v) or {})} for v, rate in travel["vehicles"].items()],
                "canEdit": user["role"] in ("admin", "hr") or user.get("department") == "accounts"}

    @r.post("/travelfuel/settings")
    def set_settings(payload: dict, user: user_dep, db: db_dep):
        if user["role"] not in ("admin", "hr"):
            raise HTTPException(403, "HR and the director set these")
        pct = float(payload.get("limitPct") or 15)
        if not 1 <= pct <= 100:
            raise HTTPException(422, "The limit must be between 1% and 100%")
        specs = {}
        for v in payload.get("vehicles") or []:
            name = str(v.get("name") or "")
            mil = float(v.get("mileage") or 0)
            if mil < 0 or mil > 200:
                raise HTTPException(422, f"{name}: mileage must be between 0 and 200 km per litre")
            specs[name] = {"fuel": v.get("fuel") if v.get("fuel") in FUELS else "", "mileage": mil}
        db.set_setting("travel_fuel", {"limit_pct": pct, "specs": specs})
        db.audit(user["id"], "travel_fuel_settings", "settings", None, f"{pct:g}% · {len(specs)} vehicles")
        return {"ok": True}

    @r.get("/fuelcheck")
    def fuel_check(user: user_dep, db: db_dep, month: str = ""):
        """A month at a glance: km travelled, litres bought, litres expected, and every flagged trip or bill."""
        if user["role"] not in ("admin", "hr", "manager") and user.get("department") != "accounts":
            raise HTTPException(403, "Not allowed")
        month = month or date.today().isoformat()[:7]
        s = settings(db)
        people: dict[str, dict] = {}
        for t in db.all("SELECT t.*, u.name FROM trips t JOIN users u ON u.id = t.user_id WHERE substr(t.start_at, 1, 7) = ? AND t.km_claimed IS NOT NULL", month):
            p = people.setdefault(t["user_id"], {"name": t["name"], "km": 0.0, "planned": 0.0, "litres": 0.0, "expected": 0.0, "flags": []})
            p["km"] += t["km_claimed"] or 0
            p["planned"] += t["planned_km"] or 0
            mil = float((s["specs"].get(t["vehicle"]) or {}).get("mileage") or 0)
            if mil:
                p["expected"] += (t["km_claimed"] or 0) / mil
            for f in json.loads(t.get("flags") or "[]"):
                p["flags"].append({"kind": "trip", "id": t["id"], "date": t["start_at"][:10], "text": f})
        for r_ in db.all("SELECT r.*, u.name FROM records r JOIN users u ON u.id = COALESCE(r.user_id, r.created_by) WHERE r.kind = 'expense'"):
            d = json.loads(r_["data"] or "{}")
            if d.get("category") != "Fuel" or not str(d.get("date") or "").startswith(month):
                continue
            uid = r_["user_id"] or r_["created_by"]
            p = people.setdefault(uid, {"name": r_["name"], "km": 0.0, "planned": 0.0, "litres": 0.0, "expected": 0.0, "flags": []})
            p["litres"] += float(d.get("litres") or 0)
            for f in (d.get("fuel_check") or {}).get("flags", []):
                p["flags"].append({"kind": "expense", "id": r_["id"], "date": d.get("date"), "text": f})
        rows = []
        for uid, p in people.items():
            over = (p["litres"] / p["expected"] - 1) * 100 if p["expected"] and p["litres"] else None
            rows.append({"userId": uid, **{k: round(v, 1) if isinstance(v, float) else v for k, v in p.items()}, "overPct": round(over) if over is not None else None})
        return {"month": month, "limitPct": s["limit_pct"], "rows": sorted(rows, key=lambda x: (-(len(x["flags"])), x["name"]))}

    return r
