"""Kshetralekha API + static front end. Run: scripts/serve.ps1 (or `uvicorn app:app --app-dir backend`)."""

from __future__ import annotations

import base64
import hashlib
import json
import mimetypes
import os
import re
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile  # noqa: E402
from fastapi.responses import FileResponse, JSONResponse, Response  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

import auth  # noqa: E402
from db import Db, init_db, new_id, now_iso  # noqa: E402
from geo import haversine_m, kml_summary, within_fence  # noqa: E402
from pdfgen import render_document  # noqa: E402
from seed import seed_if_empty  # noqa: E402
from storage import FILES_DIR, store  # noqa: E402

import demo  # noqa: E402
import planner  # noqa: E402

APP_VERSION = "0.2.0"
DEMO = os.environ.get("KL_DEMO", "1") == "1"  # prototype: demo accounts, person switch, reset
FRONTEND = Path(__file__).resolve().parent.parent / "frontend"

init_db()
seed_if_empty()
_db0 = Db()
planner.init(_db0)
if DEMO:
    demo.seed_activity(_db0)
_db0.close()

app = FastAPI(title="Kshetralekha", version=APP_VERSION, docs_url="/api/docs", openapi_url="/api/openapi.json")


# ------------------------------------------------------------------ helpers


def get_db():
    db = Db()
    try:
        yield db
    finally:
        db.close()


DbDep = Annotated[Db, Depends(get_db)]


def current_user(request: Request, db: DbDep) -> dict:
    token = ""
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        token = header[7:].strip()
    elif request.query_params.get("token"):
        token = request.query_params["token"]
    payload = auth.read_token(token) if token else None
    if not payload:
        raise HTTPException(401, "Please sign in again")
    user = db.one("SELECT * FROM users WHERE id = ? AND active = 1", payload["u"])
    if not user:
        raise HTTPException(401, "This account is no longer active")
    db.run("UPDATE devices SET last_seen = ? WHERE id = ?", now_iso(), payload["d"])
    user["sites"] = [r["site_id"] for r in db.all("SELECT site_id FROM user_sites WHERE user_id = ?", user["id"])]
    user.pop("pin_hash", None)
    user.pop("pin_salt", None)
    return user


UserDep = Annotated[dict, Depends(current_user)]


def require(user: dict, *roles: str) -> None:
    if user["role"] not in roles:
        raise HTTPException(403, "Not allowed for your role")


def is_staff(user: dict) -> bool:
    return user["role"] in ("admin", "manager", "hr")


def site_allowed(user: dict, site_id: str) -> bool:
    return user["role"] == "admin" or not user["sites"] or site_id in user["sites"]


def public_user(u: dict) -> dict:
    return {k: u.get(k) for k in ("id", "employee_id", "name", "role", "designation", "phone", "email", "active", "must_change_pin", "sites", "created_at")}


def parse_float(v, name: str, required: bool = True) -> float | None:
    if v is None or v == "":
        if required:
            raise HTTPException(422, f"{name} is required")
        return None
    try:
        return float(v)
    except ValueError as e:
        raise HTTPException(422, f"{name} must be a number") from e


async def save_upload(db: Db, upload: UploadFile | None, folder: str, kind: str, user: dict, *, lat=None, lng=None, accuracy=None,
                      taken_at: str | None = None, name: str | None = None, required: bool = True) -> str | None:
    if upload is None or not upload.filename:
        if required:
            raise HTTPException(422, "A photo is required")
        return None
    data = await upload.read()
    if not data:
        raise HTTPException(422, "The file is empty")
    if len(data) > 25 * 1024 * 1024:
        raise HTTPException(413, "File is larger than 25 MB")
    fname = name or upload.filename
    rel, sha = store.put(folder, fname, data)
    return db.insert("files", {"path": rel, "name": Path(rel).name, "mime": upload.content_type or mimetypes.guess_type(fname)[0] or "application/octet-stream",
                               "size": len(data), "sha256": sha, "kind": kind, "lat": lat, "lng": lng, "accuracy": accuracy,
                               "taken_at": taken_at or now_iso(), "uploaded_by": user["id"], "created_at": now_iso()})


def save_bytes(db: Db, data: bytes, folder: str, name: str, mime: str, kind: str, user_id: str | None, **meta) -> str:
    rel, sha = store.put(folder, name, data)
    return db.insert("files", {"path": rel, "name": Path(rel).name, "mime": mime, "size": len(data), "sha256": sha, "kind": kind,
                               "uploaded_by": user_id, "created_at": now_iso(), **meta})


def site_folder(db: Db, site_id: str | None) -> str:
    s = db.one("SELECT name FROM sites WHERE id = ?", site_id) if site_id else None
    return f"Sites/{s['name']}" if s else "Sites/Unassigned"


def stamp(dt: str | None = None) -> str:
    d = datetime.fromisoformat((dt or now_iso()).replace("Z", "+00:00")).astimezone()
    return d.strftime("%Y-%m-%d %H-%M-%S")


def doc_no(db: Db) -> str:
    year = datetime.now(UTC).year
    n = db.one("SELECT COUNT(*) AS n FROM documents WHERE doc_no LIKE ?", f"KL/{year}/%")["n"] + 1
    return f"KL/{year}/{n:05d}"


# ------------------------------------------------------------------ planner

app.include_router(planner.make_router(UserDep, DbDep, save_upload=save_upload, is_staff=is_staff))


# ------------------------------------------------------------------ prototype: demo accounts


@app.get("/api/demo")
def demo_info(db: DbDep):
    """The demo accounts, for the sign-in screen's one-tap buttons (prototype only)."""
    if not DEMO:
        return {"demo": False, "people": []}
    people = db.all("SELECT employee_id, name, role, designation FROM users WHERE active = 1 ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 WHEN 'hr' THEN 2 ELSE 3 END, employee_id")
    return {"demo": True, "pin": "1234", "people": people}


@app.post("/api/demo/switch")
def demo_switch(payload: dict, user: UserDep, db: DbDep):
    """Sign in as another demo account without a PIN, to see the app as a manager or a field worker."""
    if not DEMO:
        raise HTTPException(404, "Not available")
    target = db.one("SELECT * FROM users WHERE employee_id = ? AND active = 1", str(payload.get("employeeId", "")).upper())
    if not target:
        raise HTTPException(404, "No such account")
    device_id = new_id()
    db.insert("devices", {"id": device_id, "user_id": target["id"], "name": "Demo switch", "created_at": now_iso(), "last_seen": now_iso()})
    db.audit(user["id"], "demo_switch", "user", target["id"], f"{user['employee_id']} -> {target['employee_id']}")
    target["sites"] = [r["site_id"] for r in db.all("SELECT site_id FROM user_sites WHERE user_id = ?", target["id"])]
    return {"token": auth.make_token(target["id"], device_id), "user": public_user(target)}


@app.post("/api/demo/reset")
def demo_reset(user: UserDep):
    """Wipe everything and rebuild the demo (prototype only; director or manager)."""
    if not DEMO:
        raise HTTPException(404, "Not available")
    require(user, "admin", "manager")
    demo.reset()
    return {"ok": True}


# ------------------------------------------------------------------ auth


@app.post("/api/auth/login")
def login(payload: dict, db: DbDep):
    emp = str(payload.get("employeeId", "")).strip().upper()
    pin = str(payload.get("pin", "")).strip()
    device = str(payload.get("device", "Phone"))[:60]
    if not emp or not pin:
        raise HTTPException(422, "Employee ID and PIN are required")
    if auth.too_many_failures(emp):
        raise HTTPException(429, "Too many wrong PINs. Try again in 15 minutes or ask HR to reset it.")
    user = db.one("SELECT * FROM users WHERE employee_id = ?", emp)
    if not user or not user["active"] or not auth.check_pin(pin, user["pin_hash"], user["pin_salt"]):
        auth.record_failure(emp)
        raise HTTPException(401, "Employee ID or PIN is wrong")
    auth.clear_failures(emp)
    device_id = new_id()
    db.insert("devices", {"id": device_id, "user_id": user["id"], "name": device, "created_at": now_iso(), "last_seen": now_iso()})
    db.audit(user["id"], "login", "user", user["id"], device)
    user["sites"] = [r["site_id"] for r in db.all("SELECT site_id FROM user_sites WHERE user_id = ?", user["id"])]
    return {"token": auth.make_token(user["id"], device_id), "user": public_user(user)}


@app.post("/api/auth/pin")
def change_pin(payload: dict, user: UserDep, db: DbDep):
    old, new = str(payload.get("old", "")), str(payload.get("new", ""))
    row = db.one("SELECT pin_hash, pin_salt FROM users WHERE id = ?", user["id"])
    if not auth.check_pin(old, row["pin_hash"], row["pin_salt"]):
        raise HTTPException(401, "Current PIN is wrong")
    if not re.fullmatch(r"\d{6}", new):
        raise HTTPException(422, "New PIN must be exactly 6 digits")
    h, s = auth.hash_pin(new)
    db.update("users", user["id"], {"pin_hash": h, "pin_salt": s, "must_change_pin": 0})
    db.audit(user["id"], "pin_change", "user", user["id"])
    return {"ok": True}


@app.get("/api/me")
def me(user: UserDep, db: DbDep):
    unread = db.one("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0", user["id"])["n"]
    open_att = db.one("SELECT a.*, s.name AS site_name FROM attendance a JOIN sites s ON s.id = a.site_id WHERE a.user_id = ? AND a.checkout_at IS NULL ORDER BY checkin_at DESC LIMIT 1", user["id"])
    open_trip = db.one("SELECT * FROM trips WHERE user_id = ? AND status = 'open' ORDER BY start_at DESC LIMIT 1", user["id"])
    pending = 0
    if is_staff(user):
        pending = db.one("SELECT COUNT(*) AS n FROM trips WHERE status = 'submitted'")["n"]
        pending += db.one("SELECT COUNT(*) AS n FROM attendance WHERE status = 'pending'")["n"]
        pending += db.one("SELECT COUNT(*) AS n FROM leaves WHERE status = 'pending'")["n"]
    return {"user": public_user(user), "unread": unread, "openAttendance": open_att, "openTrip": open_trip, "pendingApprovals": pending, "version": APP_VERSION}


@app.get("/api/bootstrap")
def bootstrap(user: UserDep, db: DbDep):
    sites = db.all("SELECT * FROM sites WHERE active = 1 ORDER BY name")
    mine = [s for s in sites if site_allowed(user, s["id"])]
    items = db.all("SELECT * FROM register_items WHERE active = 1 ORDER BY site_id, sort, name")
    templates = db.all("SELECT id, name, project_type, fields FROM templates WHERE active = 1 ORDER BY name")
    for t in templates:
        t["fields"] = json.loads(t["fields"])
    people = db.all("SELECT id, employee_id, name, role, designation FROM users WHERE active = 1 ORDER BY name")
    return {
        "company": db.setting("company"), "travel": db.setting("travel"), "leaveTypes": db.setting("leave_types"),
        "updatePrompts": db.setting("update_prompts"), "sites": sites, "mySites": mine, "items": items, "templates": templates, "people": people,
        "demo": DEMO,
    }


# ------------------------------------------------------------------ attendance


@app.post("/api/attendance/checkin")
async def checkin(user: UserDep, db: DbDep, siteId: Annotated[str, Form()], lat: Annotated[str, Form()], lng: Annotated[str, Form()],
                  accuracy: Annotated[str | None, Form()] = None, override: Annotated[str | None, Form()] = None,
                  takenAt: Annotated[str | None, Form()] = None, photo: UploadFile = File(...)):
    site = db.one("SELECT * FROM sites WHERE id = ? AND active = 1", siteId)
    if not site:
        raise HTTPException(404, "Site not found")
    if not site_allowed(user, siteId):
        raise HTTPException(403, "You are not assigned to this site")
    if db.one("SELECT 1 FROM attendance WHERE user_id = ? AND checkout_at IS NULL", user["id"]):
        raise HTTPException(409, "You are already checked in. Check out first.")
    la, ln, acc = parse_float(lat, "Latitude"), parse_float(lng, "Longitude"), parse_float(accuracy, "Accuracy", False)
    inside, dist = within_fence(la, ln, acc, site)
    if not inside and not (override or "").strip():
        return JSONResponse(status_code=422, content={"detail": f"You are {dist:,.0f} m from {site['name']} (allowed {site['radius_m']} m). Move closer, or request an exception with a reason.",
                                                      "distance": round(dist), "outside": True})
    fid = await save_upload(db, photo, f"{site_folder(db, siteId)}/Attendance/{user['employee_id']}", "checkin", user, lat=la, lng=ln, accuracy=acc,
                            taken_at=takenAt, name=f"{stamp(takenAt)} check-in.jpg")
    status = "ok" if inside else "pending"
    aid = db.insert("attendance", {"user_id": user["id"], "site_id": siteId, "checkin_at": takenAt or now_iso(), "checkin_file": fid, "checkin_lat": la, "checkin_lng": ln,
                                   "checkin_acc": acc, "checkin_dist": round(dist, 1), "status": status, "override_reason": (override or "").strip()})
    db.audit(user["id"], "checkin", "attendance", aid, f"{dist:.0f} m, {status}")
    if status == "pending":
        db.notify_role(("manager", "admin"), f"Check-in exception: {user['name']}", f"{dist:,.0f} m from {site['name']}: {override}", "#approvals", siteId)
    return {"id": aid, "status": status, "distance": round(dist)}


@app.post("/api/attendance/checkout")
async def checkout(user: UserDep, db: DbDep, lat: Annotated[str, Form()], lng: Annotated[str, Form()], accuracy: Annotated[str | None, Form()] = None,
                   override: Annotated[str | None, Form()] = None, takenAt: Annotated[str | None, Form()] = None, photo: UploadFile = File(...)):
    att = db.one("SELECT * FROM attendance WHERE user_id = ? AND checkout_at IS NULL ORDER BY checkin_at DESC LIMIT 1", user["id"])
    if not att:
        raise HTTPException(409, "You are not checked in")
    site = db.one("SELECT * FROM sites WHERE id = ?", att["site_id"])
    la, ln, acc = parse_float(lat, "Latitude"), parse_float(lng, "Longitude"), parse_float(accuracy, "Accuracy", False)
    inside, dist = within_fence(la, ln, acc, site)
    if not inside and not (override or "").strip():
        return JSONResponse(status_code=422, content={"detail": f"You are {dist:,.0f} m from {site['name']}. Check out at the site, or give a reason for checking out from here.",
                                                      "distance": round(dist), "outside": True})
    fid = await save_upload(db, photo, f"{site_folder(db, att['site_id'])}/Attendance/{user['employee_id']}", "checkout", user, lat=la, lng=ln, accuracy=acc,
                            taken_at=takenAt, name=f"{stamp(takenAt)} check-out.jpg")
    patch = {"checkout_at": takenAt or now_iso(), "checkout_file": fid, "checkout_lat": la, "checkout_lng": ln, "checkout_acc": acc, "checkout_dist": round(dist, 1)}
    if not inside:
        patch["status"] = "pending"
        patch["override_reason"] = ((att["override_reason"] + " | ") if att["override_reason"] else "") + f"Check-out: {override.strip()}"
        db.notify_role(("manager", "admin"), f"Check-out exception: {user['name']}", f"{dist:,.0f} m from {site['name']}: {override}", "#approvals", att["site_id"])
    db.update("attendance", att["id"], patch)
    db.audit(user["id"], "checkout", "attendance", att["id"], f"{dist:.0f} m")
    return {"id": att["id"], "status": patch.get("status", att["status"]), "distance": round(dist)}


@app.get("/api/attendance")
def attendance(user: UserDep, db: DbDep, scope: str = "mine", days: int = 31):
    since = datetime.now(UTC).timestamp() - days * 86400
    since_iso = datetime.fromtimestamp(since, UTC).isoformat()
    base = "SELECT a.*, s.name AS site_name, u.name AS user_name, u.employee_id FROM attendance a JOIN sites s ON s.id = a.site_id JOIN users u ON u.id = a.user_id"
    if scope == "team" and is_staff(user):
        rows = db.all(base + " WHERE a.checkin_at >= ? ORDER BY a.checkin_at DESC", since_iso)
        if user["sites"] and user["role"] != "admin":
            rows = [r for r in rows if r["site_id"] in user["sites"]]
    else:
        rows = db.all(base + " WHERE a.user_id = ? AND a.checkin_at >= ? ORDER BY a.checkin_at DESC", user["id"], since_iso)
    return {"rows": rows}


# ------------------------------------------------------------------ trips


@app.post("/api/trips/start")
async def trip_start(user: UserDep, db: DbDep, vehicle: Annotated[str, Form()], reading: Annotated[str, Form()], lat: Annotated[str, Form()], lng: Annotated[str, Form()],
                     purpose: Annotated[str, Form()] = "", siteId: Annotated[str | None, Form()] = None, takenAt: Annotated[str | None, Form()] = None,
                     photo: UploadFile = File(...)):
    if db.one("SELECT 1 FROM trips WHERE user_id = ? AND status = 'open'", user["id"]):
        raise HTTPException(409, "A trip is already open. End it first.")
    travel = db.setting("travel", {"vehicles": {}})
    if vehicle not in travel["vehicles"]:
        raise HTTPException(422, "Unknown vehicle type")
    rd, la, ln = parse_float(reading, "Odometer reading"), parse_float(lat, "Latitude"), parse_float(lng, "Longitude")
    fid = await save_upload(db, photo, f"Travel/{user['employee_id']}", "odometer_start", user, lat=la, lng=ln, taken_at=takenAt, name=f"{stamp(takenAt)} start {rd:.0f} km.jpg")
    tid = db.insert("trips", {"user_id": user["id"], "site_id": siteId or None, "vehicle": vehicle, "purpose": purpose.strip(), "start_at": takenAt or now_iso(),
                              "start_reading": rd, "start_file": fid, "start_lat": la, "start_lng": ln, "rate_per_km": travel["vehicles"][vehicle], "status": "open"})
    db.audit(user["id"], "trip_start", "trip", tid, f"{vehicle} @ {rd}")
    return {"id": tid}


@app.post("/api/trips/{trip_id}/end")
async def trip_end(trip_id: str, user: UserDep, db: DbDep, reading: Annotated[str, Form()], lat: Annotated[str, Form()], lng: Annotated[str, Form()],
                   takenAt: Annotated[str | None, Form()] = None, photo: UploadFile = File(...)):
    trip = db.one("SELECT * FROM trips WHERE id = ? AND user_id = ?", trip_id, user["id"])
    if not trip or trip["status"] != "open":
        raise HTTPException(404, "Open trip not found")
    rd, la, ln = parse_float(reading, "Odometer reading"), parse_float(lat, "Latitude"), parse_float(lng, "Longitude")
    if rd < trip["start_reading"]:
        raise HTTPException(422, f"End reading {rd:.0f} is below the start reading {trip['start_reading']:.0f}")
    km = round(rd - trip["start_reading"], 1)
    if km > 1500:
        raise HTTPException(422, "More than 1,500 km in one trip looks like a typo. Check the reading.")
    fid = await save_upload(db, photo, f"Travel/{user['employee_id']}", "odometer_end", user, lat=la, lng=ln, taken_at=takenAt, name=f"{stamp(takenAt)} end {rd:.0f} km.jpg")
    straight = round(haversine_m(trip["start_lat"], trip["start_lng"], la, ln) / 1000, 1) if trip["start_lat"] is not None else None
    amount = round(km * (trip["rate_per_km"] or 0), 2)
    db.update("trips", trip_id, {"end_at": takenAt or now_iso(), "end_reading": rd, "end_file": fid, "end_lat": la, "end_lng": ln, "km_claimed": km, "km_straight": straight,
                                 "amount": amount, "status": "submitted"})
    db.audit(user["id"], "trip_end", "trip", trip_id, f"{km} km")
    db.notify_role(("manager", "admin"), f"Trip to approve: {user['name']}", f"{km} km by {trip['vehicle']}, ₹{amount:,.0f}", "#approvals", trip["site_id"])
    return {"id": trip_id, "km": km, "straight": straight, "amount": amount}


@app.get("/api/trips")
def trips(user: UserDep, db: DbDep, scope: str = "mine", status: str | None = None):
    sql = "SELECT t.*, u.name AS user_name, u.employee_id, s.name AS site_name FROM trips t JOIN users u ON u.id = t.user_id LEFT JOIN sites s ON s.id = t.site_id"
    args: list = []
    where = []
    if scope == "team" and is_staff(user):
        pass
    else:
        where.append("t.user_id = ?")
        args.append(user["id"])
    if status:
        where.append("t.status = ?")
        args.append(status)
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY t.start_at DESC LIMIT 300"
    return {"rows": db.all(sql, *args)}


@app.post("/api/trips/{trip_id}/decide")
def trip_decide(trip_id: str, payload: dict, user: UserDep, db: DbDep):
    require(user, "admin", "manager")
    trip = db.one("SELECT * FROM trips WHERE id = ?", trip_id)
    if not trip or trip["status"] != "submitted":
        raise HTTPException(404, "Trip is not waiting for approval")
    decision = payload.get("decision")
    if decision not in ("approved", "rejected"):
        raise HTTPException(422, "decision must be approved or rejected")
    db.update("trips", trip_id, {"status": decision, "decided_by": user["id"], "decided_at": now_iso(), "decision_note": str(payload.get("note", ""))[:300]})
    db.audit(user["id"], f"trip_{decision}", "trip", trip_id)
    db.notify(trip["user_id"], f"Trip {decision}", f"{trip['km_claimed']} km on {trip['start_at'][:10]}" + (f": {payload.get('note')}" if payload.get("note") else ""), "#trips")
    return {"ok": True}


@app.post("/api/attendance/{att_id}/decide")
def attendance_decide(att_id: str, payload: dict, user: UserDep, db: DbDep):
    require(user, "admin", "manager")
    att = db.one("SELECT * FROM attendance WHERE id = ?", att_id)
    if not att or att["status"] != "pending":
        raise HTTPException(404, "Nothing to decide")
    decision = payload.get("decision")
    if decision not in ("ok", "rejected"):
        raise HTTPException(422, "decision must be ok or rejected")
    db.update("attendance", att_id, {"status": decision, "decided_by": user["id"], "decided_at": now_iso(), "decision_note": str(payload.get("note", ""))[:300]})
    db.notify(att["user_id"], "Check-in exception " + ("accepted" if decision == "ok" else "rejected"), str(payload.get("note", "")), "#attendance")
    return {"ok": True}


# ------------------------------------------------------------------ registers


def item_balance(db: Db, item_id: str) -> float:
    r = db.one("SELECT balance_after FROM movements WHERE item_id = ? ORDER BY at DESC, rowid DESC LIMIT 1", item_id)
    return float(r["balance_after"]) if r else 0.0


@app.get("/api/registers")
def registers(user: UserDep, db: DbDep, siteId: str):
    if not site_allowed(user, siteId):
        raise HTTPException(403, "Not your site")
    items = db.all("SELECT * FROM register_items WHERE site_id = ? AND active = 1 ORDER BY sort, name", siteId)
    for it in items:
        it["balance"] = item_balance(db, it["id"])
        last = db.one("SELECT at, type, qty FROM movements WHERE item_id = ? ORDER BY at DESC LIMIT 1", it["id"])
        it["last"] = last
        it["low"] = it["kind"] == "input" and it["low_stock"] and it["balance"] < it["low_stock"]
    return {"items": items}


@app.get("/api/registers/movements")
def movements(user: UserDep, db: DbDep, siteId: str, itemId: str | None = None, limit: int = 200):
    if not site_allowed(user, siteId):
        raise HTTPException(403, "Not your site")
    sql = "SELECT m.*, i.name AS item_name, i.unit, u.name AS user_name FROM movements m JOIN register_items i ON i.id = m.item_id JOIN users u ON u.id = m.user_id WHERE i.site_id = ?"
    args = [siteId]
    if itemId:
        sql += " AND m.item_id = ?"
        args.append(itemId)
    sql += " ORDER BY m.at DESC LIMIT ?"
    args.append(limit)
    return {"rows": db.all(sql, *args)}


@app.post("/api/registers/movements")
async def add_movement(user: UserDep, db: DbDep, itemId: Annotated[str, Form()], type: Annotated[str, Form()], qty: Annotated[str, Form()],  # noqa: A002
                       lat: Annotated[str, Form()], lng: Annotated[str, Form()], batch: Annotated[str, Form()] = "", note: Annotated[str, Form()] = "",
                       accuracy: Annotated[str | None, Form()] = None, takenAt: Annotated[str | None, Form()] = None, photo: UploadFile = File(...)):
    item = db.one("SELECT i.*, s.name AS site_name FROM register_items i JOIN sites s ON s.id = i.site_id WHERE i.id = ? AND i.active = 1", itemId)
    if not item:
        raise HTTPException(404, "Register item not found")
    if not site_allowed(user, item["site_id"]):
        raise HTTPException(403, "Not your site")
    if type not in ("in", "out", "count"):
        raise HTTPException(422, "type must be in, out or count")
    q, la, ln, acc = parse_float(qty, "Quantity"), parse_float(lat, "Latitude"), parse_float(lng, "Longitude"), parse_float(accuracy, "Accuracy", False)
    if q < 0 or (type != "count" and q == 0):
        raise HTTPException(422, "Quantity must be more than zero")
    bal = item_balance(db, itemId)
    variance = None
    if type == "in":
        new_bal = bal + q
    elif type == "out":
        if q > bal + 1e-9:
            raise HTTPException(422, f"Only {bal:g} {item['unit']} in stock; cannot take out {q:g}. Record what came in first, or do a physical count.")
        new_bal = bal - q
    else:
        variance = round(q - bal, 3)
        new_bal = q
    when = takenAt or now_iso()
    fid = await save_upload(db, photo, f"{site_folder(db, item['site_id'])}/Registers/{item['name']}", f"register_{type}", user, lat=la, lng=ln, accuracy=acc,
                            taken_at=when, name=f"{stamp(when)} {type} {q:g} {item['unit']}.jpg")
    mid = db.insert("movements", {"item_id": itemId, "user_id": user["id"], "type": type, "qty": q, "balance_after": round(new_bal, 3), "batch": batch.strip()[:60],
                                  "note": note.strip()[:300], "file_id": fid, "lat": la, "lng": ln, "at": when, "variance": variance})
    db.audit(user["id"], "movement", "movement", mid, f"{item['name']} {type} {q:g}")
    if item["kind"] == "input" and item["low_stock"] and new_bal < item["low_stock"] <= bal:
        db.notify_role(("manager", "admin"), f"Low stock: {item['name']} at {item['site_name']}", f"{new_bal:g} {item['unit']} left (alert below {item['low_stock']:g})", "#registers", item["site_id"])
    if type == "count" and abs(variance or 0) > 1e-9:
        db.notify_role(("manager", "admin"), f"Stock variance: {item['name']} at {item['site_name']}", f"Counted {q:g}, book {bal:g} ({variance:+g} {item['unit']})", "#registers", item["site_id"])
    return {"id": mid, "balance": round(new_bal, 3), "variance": variance}


# ------------------------------------------------------------------ farmers and documents


@app.get("/api/farmers")
def farmers(user: UserDep, db: DbDep, q: str = ""):
    rows = db.all("SELECT f.*, s.name AS site_name, (SELECT COUNT(*) FROM documents d WHERE d.farmer_id = f.id) AS docs, "
                  "(SELECT COUNT(*) FROM plots p WHERE p.farmer_id = f.id) AS plots FROM farmers f LEFT JOIN sites s ON s.id = f.site_id ORDER BY f.created_at DESC")
    if q:
        ql = q.lower()
        rows = [r for r in rows if ql in (r["name"] + " " + r["village"] + " " + r["phone"]).lower()]
    if user["sites"] and user["role"] != "admin":
        rows = [r for r in rows if not r["site_id"] or r["site_id"] in user["sites"]]
    return {"rows": rows[:300]}


@app.post("/api/farmers")
def add_farmer(payload: dict, user: UserDep, db: DbDep):
    name = str(payload.get("name", "")).strip()
    if len(name) < 2:
        raise HTTPException(422, "Farmer name is required")
    fid = db.insert("farmers", {"name": name, "father_name": str(payload.get("father_name", "")).strip(), "village": str(payload.get("village", "")).strip(),
                                "taluka": str(payload.get("taluka", "")).strip(), "district": str(payload.get("district", "")).strip(), "phone": str(payload.get("phone", "")).strip(),
                                "id_last4": str(payload.get("id_last4", "")).strip()[:4], "site_id": payload.get("site_id") or None, "created_by": user["id"], "created_at": now_iso()})
    db.audit(user["id"], "farmer_add", "farmer", fid, name)
    return {"id": fid}


@app.get("/api/farmers/{farmer_id}")
def farmer_detail(farmer_id: str, user: UserDep, db: DbDep):
    f = db.one("SELECT f.*, s.name AS site_name FROM farmers f LEFT JOIN sites s ON s.id = f.site_id WHERE f.id = ?", farmer_id)
    if not f:
        raise HTTPException(404, "Farmer not found")
    f["documents"] = db.all("SELECT d.id, d.doc_no, d.created_at, d.pdf_file, d.lat, d.lng, t.name AS template_name, u.name AS user_name FROM documents d "
                            "JOIN templates t ON t.id = d.template_id JOIN users u ON u.id = d.user_id WHERE d.farmer_id = ? ORDER BY d.created_at DESC", farmer_id)
    f["plots"] = db.all("SELECT * FROM plots WHERE farmer_id = ? ORDER BY created_at", farmer_id)
    f["files"] = db.all("SELECT ff.id, ff.kind, ff.created_at, fl.id AS file_id, fl.name, fl.mime, fl.size, fl.sha256 FROM farmer_files ff JOIN files fl ON fl.id = ff.file_id "
                        "WHERE ff.farmer_id = ? ORDER BY ff.created_at DESC", farmer_id)
    return f


@app.post("/api/farmers/{farmer_id}/files")
async def farmer_file(farmer_id: str, user: UserDep, db: DbDep, kind: Annotated[str, Form()], file: UploadFile = File(...),
                      surveyNo: Annotated[str, Form()] = "", areaDeclared: Annotated[str | None, Form()] = None, lat: Annotated[str | None, Form()] = None,
                      lng: Annotated[str | None, Form()] = None):
    f = db.one("SELECT * FROM farmers WHERE id = ?", farmer_id)
    if not f:
        raise HTTPException(404, "Farmer not found")
    if kind not in ("kml", "land_record", "id_proof", "photo", "other"):
        raise HTTPException(422, "kind must be kml, land_record, id_proof, photo or other")
    data = await file.read()
    if not data:
        raise HTTPException(422, "Empty file")
    folder = f"Farmers/{f['name']} ({f['village'] or 'village'})"
    la, ln = parse_float(lat, "lat", False), parse_float(lng, "lng", False)
    summary = None
    if kind == "kml":
        try:
            summary = kml_summary(data)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(422, f"Could not read the KML file: {e}") from e
        if not summary["polygons"]:
            raise HTTPException(422, "The KML has no polygon (plot boundary)")
    fid = save_bytes(db, data, folder, file.filename or f"{kind}.bin", file.content_type or "application/octet-stream", f"farmer_{kind}", user["id"], lat=la, lng=ln)
    db.insert("farmer_files", {"farmer_id": farmer_id, "kind": kind, "file_id": fid, "created_at": now_iso()})
    plot_id = None
    if kind in ("kml", "land_record"):
        plot = db.one("SELECT * FROM plots WHERE farmer_id = ? AND (survey_no = ? OR ? = '') ORDER BY created_at DESC LIMIT 1", farmer_id, surveyNo.strip(), surveyNo.strip())
        if not plot:
            plot_id = db.insert("plots", {"farmer_id": farmer_id, "survey_no": surveyNo.strip(), "area_ha_declared": parse_float(areaDeclared, "area", False), "created_at": now_iso()})
        else:
            plot_id = plot["id"]
            if areaDeclared:
                db.update("plots", plot_id, {"area_ha_declared": parse_float(areaDeclared, "area", False)})
        patch = {"kml_file": fid, "area_ha_kml": summary["area_ha"]} if kind == "kml" else {"land_record_file": fid}
        if surveyNo.strip():
            patch["survey_no"] = surveyNo.strip()
        db.update("plots", plot_id, patch)
    db.audit(user["id"], "farmer_file", "farmer", farmer_id, kind)
    return {"fileId": fid, "plotId": plot_id, "kml": summary}


@app.post("/api/farmers/{farmer_id}/documents")
def sign_document(farmer_id: str, payload: dict, user: UserDep, db: DbDep):
    f = db.one("SELECT * FROM farmers WHERE id = ?", farmer_id)
    if not f:
        raise HTTPException(404, "Farmer not found")
    t = db.one("SELECT * FROM templates WHERE id = ? AND active = 1", payload.get("templateId"))
    if not t:
        raise HTTPException(404, "Template not found")
    t["fields"] = json.loads(t["fields"])
    fields = payload.get("fields") or {}
    missing = [fl["label"] for fl in t["fields"] if fl.get("required") and not str(fields.get(fl["key"], "")).strip()]
    if missing:
        raise HTTPException(422, "Please fill: " + ", ".join(missing))
    sig = str(payload.get("signature", ""))
    if not sig.startswith("data:image/png;base64,"):
        raise HTTPException(422, "The farmer's signature is missing")
    sig_png = base64.b64decode(sig.split(",", 1)[1])
    if len(sig_png) < 500:
        raise HTTPException(422, "The signature looks empty. Ask the farmer to sign again.")
    lat, lng = parse_float(payload.get("lat"), "lat", False), parse_float(payload.get("lng"), "lng", False)
    company = db.setting("company", {"name": "Company"})
    comp_sig = None
    cs = db.one("SELECT path FROM files WHERE id = ?", db.setting("company_signature_file"))
    if cs and store.exists(cs["path"]):
        comp_sig = store.get(cs["path"])
    when = datetime.now(UTC).astimezone()
    number = doc_no(db)
    pdf = render_document(company={**company}, template=t, fields={**fields, "company": company["name"]}, farmer=f, recorded_by=f"{user['name']} ({user['employee_id']})",
                          doc_no=number, when=when, lat=lat, lng=lng, signature_png=sig_png, company_signature_png=comp_sig,
                          signature_sha=hashlib.sha256(sig_png).hexdigest())
    folder = f"Farmers/{f['name']} ({f['village'] or 'village'})"
    sig_id = save_bytes(db, sig_png, folder, f"{number.replace('/', '-')} signature.png", "image/png", "signature", user["id"], lat=lat, lng=lng)
    pdf_id = save_bytes(db, pdf, folder, f"{number.replace('/', '-')} {t['name']}.pdf", "application/pdf", "signed_document", user["id"], lat=lat, lng=lng)
    did = db.insert("documents", {"doc_no": number, "farmer_id": farmer_id, "template_id": t["id"], "user_id": user["id"], "fields": json.dumps(fields), "pdf_file": pdf_id,
                                  "signature_file": sig_id, "lat": lat, "lng": lng, "created_at": now_iso()})
    db.audit(user["id"], "document_signed", "document", did, number)
    db.notify_role(("manager", "admin"), f"Signed: {t['name']}", f"{f['name']}, {f['village']} · {number} · by {user['name']}", f"#farmers/{farmer_id}", f["site_id"])
    return {"id": did, "docNo": number, "pdfFile": pdf_id}


# ------------------------------------------------------------------ HR self-service


@app.get("/api/hr/documents")
def hr_documents(user: UserDep, db: DbDep, userId: str | None = None):
    target = user["id"]
    if userId and userId != user["id"]:
        require(user, "admin", "hr")
        target = userId
    rows = db.all("SELECT h.*, f.name AS file_name, f.mime, f.size FROM hr_documents h JOIN files f ON f.id = h.file_id WHERE h.user_id = ? ORDER BY h.created_at DESC", target)
    return {"rows": rows}


@app.post("/api/hr/documents")
async def hr_upload(user: UserDep, db: DbDep, userId: Annotated[str, Form()], title: Annotated[str, Form()], category: Annotated[str, Form()], file: UploadFile = File(...)):
    require(user, "admin", "hr")
    target = db.one("SELECT * FROM users WHERE id = ?", userId)
    if not target:
        raise HTTPException(404, "Employee not found")
    fid = await save_upload(db, file, f"HR/{target['employee_id']} {target['name']}", "hr_document", user, name=file.filename)
    hid = db.insert("hr_documents", {"user_id": userId, "title": title.strip()[:120], "category": category.strip()[:40], "file_id": fid, "uploaded_by": user["id"], "created_at": now_iso()})
    db.notify(userId, f"New document: {title}", category, "#me")
    return {"id": hid}


@app.get("/api/updates")
def updates(user: UserDep, db: DbDep, scope: str = "mine", days: int = 14):
    since = datetime.fromtimestamp(datetime.now(UTC).timestamp() - days * 86400, UTC).strftime("%Y-%m-%d")
    sql = "SELECT w.*, u.name AS user_name, s.name AS site_name FROM work_updates w JOIN users u ON u.id = w.user_id LEFT JOIN sites s ON s.id = w.site_id WHERE w.date >= ?"
    args: list = [since]
    if not (scope == "team" and is_staff(user)):
        sql += " AND w.user_id = ?"
        args.append(user["id"])
    return {"rows": db.all(sql + " ORDER BY w.date DESC, w.created_at DESC", *args)}


@app.post("/api/updates")
def add_update(payload: dict, user: UserDep, db: DbDep):
    summary = str(payload.get("summary", "")).strip()
    if len(summary) < 5:
        raise HTTPException(422, "Write a few words about the day")
    date = str(payload.get("date") or datetime.now().strftime("%Y-%m-%d"))
    existing = db.one("SELECT id FROM work_updates WHERE user_id = ? AND date = ?", user["id"], date)
    row = {"summary": summary[:2000], "hours": parse_float(payload.get("hours"), "hours", False), "blockers": str(payload.get("blockers", ""))[:1000], "site_id": payload.get("site_id") or None}
    if existing:
        db.update("work_updates", existing["id"], row)
        return {"id": existing["id"], "updated": True}
    wid = db.insert("work_updates", {"user_id": user["id"], "date": date, "created_at": now_iso(), **row})
    return {"id": wid}


@app.get("/api/feedback")
def feedback_list(user: UserDep, db: DbDep):
    if is_staff(user):
        rows = db.all("SELECT fb.*, u.name AS user_name FROM feedback fb LEFT JOIN users u ON u.id = fb.user_id ORDER BY fb.created_at DESC")
        for r in rows:
            if not r["user_id"]:
                r["user_name"] = "Anonymous"
        return {"rows": rows}
    return {"rows": db.all("SELECT * FROM feedback WHERE user_id = ? ORDER BY created_at DESC", user["id"])}


@app.post("/api/feedback")
def add_feedback(payload: dict, user: UserDep, db: DbDep):
    kind = payload.get("type")
    text = str(payload.get("text", "")).strip()
    if kind not in ("complaint", "suggestion") or len(text) < 5:
        raise HTTPException(422, "Choose complaint or suggestion and write a few words")
    anon = bool(payload.get("anonymous"))
    fid = db.insert("feedback", {"user_id": None if anon else user["id"], "type": kind, "text": text[:3000], "status": "open", "created_at": now_iso()})
    db.notify_role(("hr", "admin"), f"New {kind}" + (" (anonymous)" if anon else f" from {user['name']}"), text[:120], "#hrdesk")
    return {"id": fid}


@app.post("/api/feedback/{fb_id}/respond")
def respond_feedback(fb_id: str, payload: dict, user: UserDep, db: DbDep):
    require(user, "admin", "hr")
    fb = db.one("SELECT * FROM feedback WHERE id = ?", fb_id)
    if not fb:
        raise HTTPException(404, "Not found")
    db.update("feedback", fb_id, {"response": str(payload.get("response", ""))[:2000], "status": payload.get("status", "closed"), "responded_by": user["id"], "responded_at": now_iso()})
    if fb["user_id"]:
        db.notify(fb["user_id"], f"Reply to your {fb['type']}", str(payload.get("response", ""))[:200], "#me")
    return {"ok": True}


@app.get("/api/leaves")
def leaves(user: UserDep, db: DbDep, scope: str = "mine"):
    sql = "SELECT l.*, u.name AS user_name FROM leaves l JOIN users u ON u.id = l.user_id"
    args: list = []
    if not (scope == "team" and is_staff(user)):
        sql += " WHERE l.user_id = ?"
        args.append(user["id"])
    return {"rows": db.all(sql + " ORDER BY l.created_at DESC LIMIT 200", *args)}


@app.post("/api/leaves")
def add_leave(payload: dict, user: UserDep, db: DbDep):
    fd, td = str(payload.get("from", "")), str(payload.get("to", ""))
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", fd) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", td) or td < fd:
        raise HTTPException(422, "Pick valid from and to dates")
    lid = db.insert("leaves", {"user_id": user["id"], "from_date": fd, "to_date": td, "type": str(payload.get("type", "Casual"))[:30], "reason": str(payload.get("reason", ""))[:500],
                               "status": "pending", "created_at": now_iso()})
    db.notify_role(("manager", "hr", "admin"), f"Leave request: {user['name']}", f"{payload.get('type')} {fd} to {td}", "#approvals")
    return {"id": lid}


@app.post("/api/leaves/{leave_id}/decide")
def leave_decide(leave_id: str, payload: dict, user: UserDep, db: DbDep):
    require(user, "admin", "manager", "hr")
    lv = db.one("SELECT * FROM leaves WHERE id = ?", leave_id)
    if not lv or lv["status"] != "pending":
        raise HTTPException(404, "Nothing to decide")
    decision = payload.get("decision")
    if decision not in ("approved", "rejected"):
        raise HTTPException(422, "decision must be approved or rejected")
    db.update("leaves", leave_id, {"status": decision, "decided_by": user["id"], "decided_at": now_iso(), "decision_note": str(payload.get("note", ""))[:300]})
    db.notify(lv["user_id"], f"Leave {decision}", f"{lv['from_date']} to {lv['to_date']}", "#me")
    return {"ok": True}


# ------------------------------------------------------------------ inbox, approvals, dashboard


@app.get("/api/inbox")
def inbox(user: UserDep, db: DbDep):
    return {"rows": db.all("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100", user["id"])}


@app.post("/api/inbox/read")
def inbox_read(payload: dict, user: UserDep, db: DbDep):
    ids = payload.get("ids")
    if ids:
        for i in ids:
            db.run("UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?", i, user["id"])
    else:
        db.run("UPDATE notifications SET read = 1 WHERE user_id = ?", user["id"])
    return {"ok": True}


@app.get("/api/approvals")
def approvals(user: UserDep, db: DbDep):
    require(user, "admin", "manager", "hr")
    trips_ = db.all("SELECT t.*, u.name AS user_name, s.name AS site_name FROM trips t JOIN users u ON u.id = t.user_id LEFT JOIN sites s ON s.id = t.site_id WHERE t.status = 'submitted' ORDER BY t.end_at")
    att = db.all("SELECT a.*, u.name AS user_name, s.name AS site_name, s.radius_m FROM attendance a JOIN users u ON u.id = a.user_id JOIN sites s ON s.id = a.site_id WHERE a.status = 'pending' ORDER BY a.checkin_at")
    lv = db.all("SELECT l.*, u.name AS user_name FROM leaves l JOIN users u ON u.id = l.user_id WHERE l.status = 'pending' ORDER BY l.created_at")
    return {"trips": trips_, "attendance": att, "leaves": lv}


@app.get("/api/dashboard")
def dashboard(user: UserDep, db: DbDep):
    require(user, "admin", "manager", "hr")
    today = datetime.now().strftime("%Y-%m-%d")
    day0 = datetime.now().astimezone().replace(hour=0, minute=0, second=0, microsecond=0)
    start_utc = day0.astimezone(UTC).isoformat().replace("+00:00", "Z")  # check-in times are UTC: compare instants
    on_site = db.all("SELECT a.id, a.checkin_at, a.checkin_dist, a.status, u.name AS user_name, s.name AS site_name FROM attendance a JOIN users u ON u.id = a.user_id JOIN sites s ON s.id = a.site_id WHERE a.checkout_at IS NULL ORDER BY a.checkin_at")
    today_att = db.one("SELECT COUNT(DISTINCT user_id) AS n FROM attendance WHERE checkin_at >= ?", start_utc)["n"]
    field_total = db.one("SELECT COUNT(*) AS n FROM users WHERE active = 1 AND role = 'field'")["n"]
    stock = []
    for it in db.all("SELECT i.*, s.name AS site_name FROM register_items i JOIN sites s ON s.id = i.site_id WHERE i.active = 1 ORDER BY s.name, i.sort"):
        bal = item_balance(db, it["id"])
        stock.append({"item": it["name"], "site": it["site_name"], "unit": it["unit"], "balance": bal, "low": it["kind"] == "input" and it["low_stock"] and bal < it["low_stock"], "kind": it["kind"]})
    month = today[:7]
    travel = db.one("SELECT COALESCE(SUM(amount), 0) AS amt, COALESCE(SUM(km_claimed), 0) AS km, COUNT(*) AS n FROM trips WHERE status = 'approved' AND substr(end_at, 1, 7) = ?", month)
    farmers_n = db.one("SELECT COUNT(*) AS n FROM farmers")["n"]
    docs_week = db.one("SELECT COUNT(*) AS n FROM documents WHERE created_at >= ?", datetime.fromtimestamp(datetime.now(UTC).timestamp() - 7 * 86400, UTC).isoformat())["n"]
    updates_today = db.one("SELECT COUNT(*) AS n FROM work_updates WHERE date = ?", today)["n"]
    open_fb = db.one("SELECT COUNT(*) AS n FROM feedback WHERE status = 'open'")["n"]
    days = []
    for k in range(13, -1, -1):
        d0 = day0 - __import__("datetime").timedelta(days=k)
        d1 = d0 + __import__("datetime").timedelta(days=1)
        a, b = (x.astimezone(UTC).isoformat().replace("+00:00", "Z") for x in (d0, d1))
        n = db.one("SELECT COUNT(DISTINCT user_id) AS n FROM attendance WHERE checkin_at >= ? AND checkin_at < ?", a, b)["n"]
        km = db.one("SELECT COALESCE(SUM(km_claimed), 0) AS km FROM trips WHERE end_at >= ? AND end_at < ?", a, b)["km"]
        days.append({"date": d0.strftime("%Y-%m-%d"), "present": n, "km": km})
    tasks = db.one("SELECT COUNT(*) AS total, SUM(progress = 'completed') AS done, SUM(progress = 'in_progress') AS doing,"
                   " SUM(progress != 'completed' AND due_date IS NOT NULL AND due_date < ?) AS late FROM tasks", today)
    done_week = db.one("SELECT COUNT(*) AS n FROM tasks WHERE completed_at >= ?", (day0 - __import__("datetime").timedelta(days=7)).astimezone(UTC).isoformat().replace("+00:00", "Z"))["n"]
    return {"days": days, "tasks": {"total": tasks["total"] or 0, "done": tasks["done"] or 0, "doing": tasks["doing"] or 0, "late": tasks["late"] or 0, "doneWeek": done_week},
            "onSite": on_site, "todayAttendance": today_att, "fieldTotal": field_total, "stock": stock, "travelMonth": travel, "farmers": farmers_n, "docsWeek": docs_week,
            "updatesToday": updates_today, "openFeedback": open_fb}


@app.get("/api/export/site/{site_id}")
def export_site(site_id: str, user: UserDep, db: DbDep):
    """Audit pack: every movement with its photo hash, as CSV (the ZIP of photos is the SharePoint folder itself)."""
    require(user, "admin", "manager")
    rows = db.all("SELECT m.at, i.name AS item, m.type, m.qty, i.unit, m.balance_after, m.batch, m.note, m.lat, m.lng, u.name AS by_user, f.name AS photo, f.sha256 "
                  "FROM movements m JOIN register_items i ON i.id = m.item_id JOIN users u ON u.id = m.user_id LEFT JOIN files f ON f.id = m.file_id WHERE i.site_id = ? ORDER BY m.at", site_id)
    import csv
    import io

    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["Time (UTC)", "Item", "Type", "Qty", "Unit", "Balance after", "Batch", "Note", "Lat", "Lng", "By", "Photo", "Photo SHA-256"])
    for r in rows:
        w.writerow([r[k] for k in ("at", "item", "type", "qty", "unit", "balance_after", "batch", "note", "lat", "lng", "by_user", "photo", "sha256")])
    return Response(out.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="site-{site_id[:8]}-registers.csv"'})


# ------------------------------------------------------------------ admin


@app.get("/api/admin/users")
def admin_users(user: UserDep, db: DbDep):
    require(user, "admin", "hr")
    rows = db.all("SELECT id, employee_id, name, role, designation, phone, email, active, must_change_pin, created_at FROM users ORDER BY employee_id")
    sites = db.all("SELECT user_id, site_id FROM user_sites")
    for r in rows:
        r["sites"] = [s["site_id"] for s in sites if s["user_id"] == r["id"]]
        r["devices"] = db.one("SELECT COUNT(*) AS n FROM devices WHERE user_id = ?", r["id"])["n"]
    return {"rows": rows}


@app.post("/api/admin/users")
def admin_user_save(payload: dict, user: UserDep, db: DbDep):
    require(user, "admin", "hr")
    emp = str(payload.get("employee_id", "")).strip().upper()
    name = str(payload.get("name", "")).strip()
    role = payload.get("role", "field")
    if not emp or len(name) < 2 or role not in ("admin", "manager", "hr", "field"):
        raise HTTPException(422, "Employee ID, name and a valid role are required")
    if role == "admin" and user["role"] != "admin":
        raise HTTPException(403, "Only an admin can create admins")
    row = {"employee_id": emp, "name": name, "role": role, "designation": str(payload.get("designation", ""))[:80], "phone": str(payload.get("phone", ""))[:20],
           "email": str(payload.get("email", ""))[:120], "active": 1 if payload.get("active", True) else 0}
    uid = payload.get("id")
    if uid:
        if not db.one("SELECT 1 FROM users WHERE id = ?", uid):
            raise HTTPException(404, "User not found")
        db.update("users", uid, row)
    else:
        if db.one("SELECT 1 FROM users WHERE employee_id = ?", emp):
            raise HTTPException(409, f"{emp} already exists")
        pin = str(payload.get("pin") or "1234")
        h, s = auth.hash_pin(pin)
        uid = db.insert("users", {**row, "pin_hash": h, "pin_salt": s, "must_change_pin": 1, "created_at": now_iso()})
    db.run("DELETE FROM user_sites WHERE user_id = ?", uid)
    for sid in payload.get("sites") or []:
        db.insert("user_sites", {"user_id": uid, "site_id": sid})
    db.audit(user["id"], "user_save", "user", uid, emp)
    return {"id": uid}


@app.post("/api/admin/users/{uid}/reset-pin")
def admin_reset_pin(uid: str, payload: dict, user: UserDep, db: DbDep):
    require(user, "admin", "hr")
    pin = str(payload.get("pin") or "1234")
    if not re.fullmatch(r"\d{4,6}", pin):
        raise HTTPException(422, "PIN must be 4 to 6 digits")
    h, s = auth.hash_pin(pin)
    db.update("users", uid, {"pin_hash": h, "pin_salt": s, "must_change_pin": 1})
    db.run("DELETE FROM devices WHERE user_id = ?", uid)  # signs out every phone
    db.audit(user["id"], "pin_reset", "user", uid)
    return {"ok": True}


@app.post("/api/admin/sites")
def admin_site_save(payload: dict, user: UserDep, db: DbDep):
    require(user, "admin", "manager")
    name = str(payload.get("name", "")).strip()
    if len(name) < 2:
        raise HTTPException(422, "Site name is required")
    row = {"name": name, "project_type": str(payload.get("project_type", "other"))[:30], "lat": parse_float(payload.get("lat"), "Latitude"), "lng": parse_float(payload.get("lng"), "Longitude"),
           "radius_m": int(parse_float(payload.get("radius_m", 150), "Radius") or 150), "address": str(payload.get("address", ""))[:200], "active": 1 if payload.get("active", True) else 0}
    sid = payload.get("id")
    if sid:
        db.update("sites", sid, row)
    else:
        sid = db.insert("sites", row)
    db.audit(user["id"], "site_save", "site", sid, name)
    return {"id": sid}


@app.post("/api/admin/items")
def admin_item_save(payload: dict, user: UserDep, db: DbDep):
    require(user, "admin", "manager")
    name = str(payload.get("name", "")).strip()
    if not name or not payload.get("site_id"):
        raise HTTPException(422, "Site and item name are required")
    row = {"site_id": payload["site_id"], "name": name[:60], "unit": str(payload.get("unit", "kg"))[:12], "kind": "product" if payload.get("kind") == "product" else "input",
           "low_stock": parse_float(payload.get("low_stock"), "low stock", False) or 0, "active": 1 if payload.get("active", True) else 0, "sort": int(payload.get("sort") or 0)}
    iid = payload.get("id")
    if iid:
        db.update("register_items", iid, row)
    else:
        iid = db.insert("register_items", row)
    return {"id": iid}


@app.get("/api/admin/templates")
def admin_templates(user: UserDep, db: DbDep):
    require(user, "admin", "manager")
    rows = db.all("SELECT * FROM templates ORDER BY name")
    for r in rows:
        r["fields"] = json.loads(r["fields"])
    return {"rows": rows}


@app.post("/api/admin/templates")
def admin_template_save(payload: dict, user: UserDep, db: DbDep):
    require(user, "admin", "manager")
    name, body = str(payload.get("name", "")).strip(), str(payload.get("body", "")).strip()
    fields = payload.get("fields") or []
    if len(name) < 3 or len(body) < 20:
        raise HTTPException(422, "Name and body text are required")
    clean = []
    for f in fields:
        key = re.sub(r"\W+", "_", str(f.get("key") or f.get("label", ""))).strip("_").lower()
        if key:
            clean.append({"key": key, "label": str(f.get("label") or key)[:60], "type": "number" if f.get("type") == "number" else "text", "required": bool(f.get("required"))})
    row = {"name": name[:80], "project_type": str(payload.get("project_type", "other"))[:30], "body": body[:8000], "fields": json.dumps(clean), "active": 1 if payload.get("active", True) else 0}
    tid = payload.get("id")
    if tid:
        db.update("templates", tid, row)
    else:
        tid = db.insert("templates", row)
    return {"id": tid}


@app.post("/api/admin/settings")
def admin_settings(payload: dict, user: UserDep, db: DbDep):
    require(user, "admin")
    for key in ("company", "travel", "leave_types", "update_prompts"):
        if key in payload:
            db.set_setting(key, payload[key])
    return {"ok": True}


@app.post("/api/admin/company-signature")
async def admin_company_signature(user: UserDep, db: DbDep, file: UploadFile = File(...)):
    require(user, "admin")
    fid = await save_upload(db, file, "Company", "company_signature", user, name="authorised-signature.png")
    db.set_setting("company_signature_file", fid)
    return {"fileId": fid}


@app.get("/api/admin/audit")
def admin_audit(user: UserDep, db: DbDep, limit: int = 200):
    require(user, "admin")
    return {"rows": db.all("SELECT a.*, u.name AS user_name FROM audit a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.at DESC LIMIT ?", limit)}


# ------------------------------------------------------------------ files


@app.get("/api/files/{file_id}")
def get_file(file_id: str, user: UserDep, db: DbDep, download: int = 0):
    f = db.one("SELECT * FROM files WHERE id = ?", file_id)
    if not f or not store.exists(f["path"]):
        raise HTTPException(404, "File not found")
    # Field staff may see their own uploads and anything on their sites; HR documents only their own.
    if f["kind"] == "hr_document" and not is_staff(user):
        owner = db.one("SELECT user_id FROM hr_documents WHERE file_id = ?", file_id)
        if not owner or owner["user_id"] != user["id"]:
            raise HTTPException(403, "Not your document")
    headers = {"X-SHA256": f["sha256"]}
    if download:
        headers["Content-Disposition"] = f'attachment; filename="{f["name"]}"'
    return FileResponse(FILES_DIR / f["path"], media_type=f["mime"], headers=headers)


@app.get("/api/health")
def health():
    return {"ok": True, "version": APP_VERSION, "time": now_iso()}


app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="frontend")
