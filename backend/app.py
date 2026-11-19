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
from db import Db, ensure_refs, init_db, new_id, now_iso  # noqa: E402
from geo import haversine_m, kml_summary, within_fence  # noqa: E402
from pdfgen import render_document  # noqa: E402
from seed import migrate_admin_code, seed_if_empty  # noqa: E402
from storage import FILES_DIR, store  # noqa: E402

import demo  # noqa: E402
import demo_modules  # noqa: E402
import committees  # noqa: E402
import policies  # noqa: E402
import hrops  # noqa: E402
import modules  # noqa: E402
import lists  # noqa: E402
import perms  # noqa: E402
import planner  # noqa: E402

APP_VERSION = "0.6.0"
DEMO = os.environ.get("KL_DEMO", "1") == "1"  # prototype: demo accounts, person switch, reset
FRONTEND = Path(__file__).resolve().parent.parent / "frontend"

init_db()
seed_if_empty()
_db = Db()
try:
    migrate_admin_code(_db)
    lists.sync(_db)  # saved lists (Settings > Lists) into the record definitions
    perms.migrate(_db)  # travel joins the approval rules; default departments
finally:
    _db.close()
_db0 = Db()
planner.init(_db0)
modules.init(_db0)
hrops.init(_db0)
ensure_refs(_db0)
if DEMO:
    demo.seed_activity(_db0)
    demo_modules.seed(_db0)
    hrops.seed(_db0)
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
    if not db.one("SELECT 1 FROM devices WHERE id = ? AND user_id = ?", payload["d"], user["id"]):
        raise HTTPException(401, "Please sign in again")  # HR reset the PIN (or the phone was signed out): the old token stops working
    if user.get("must_change_pin") and request.method != "GET" and not request.url.path.startswith(("/api/auth/", "/api/me/consent")):
        raise HTTPException(403, "Set your own PIN first (Me > Change PIN)")
    db.run("UPDATE devices SET last_seen = ? WHERE id = ?", now_iso(), payload["d"])
    resolve_access(db, user)
    user.pop("pin_hash", None)
    user.pop("pin_salt", None)
    return user


UserDep = Annotated[dict, Depends(current_user)]


def require(user: dict, *roles: str) -> None:
    if user["role"] not in roles:
        raise HTTPException(403, "Not allowed for your role")


def is_staff(user: dict) -> bool:
    return user["role"] in ("admin", "manager", "hr")


ALL_ACCESS = ("admin", "hr")  # management and HR see every project and site


def resolve_access(db: Db, u: dict) -> dict:
    """Which sites a person may see: their own sites, every site of the projects they manage, or all (director, HR)."""
    direct = [r["site_id"] for r in db.all("SELECT site_id FROM user_sites WHERE user_id = ?", u["id"])]
    projects = [r["project"] for r in db.all("SELECT project FROM user_projects WHERE user_id = ?", u["id"])]
    every = db.all("SELECT id, project_type FROM sites")
    u["all_sites"] = u["role"] in ALL_ACCESS or bool(u.get("level") and lists.level_info(db, u["level"]).get("sees") == "company")
    u["sites"] = [s["id"] for s in every] if u["all_sites"] else sorted(set(direct) | {s["id"] for s in every if s["project_type"] in projects})
    u["direct_sites"] = direct
    u["projects"] = projects
    u["perms"] = perms.for_user(db, u)
    u["dept"] = perms.dept_of(db, u)
    return u


def site_allowed(user: dict, site_id: str) -> bool:
    return bool(user.get("all_sites")) or site_id in user["sites"]


def public_user(u: dict) -> dict:
    return {k: u.get(k) for k in ("id", "employee_id", "name", "role", "designation", "phone", "email", "active", "must_change_pin", "sites", "created_at", "manager_id", "consent_at",
                                  "all_sites", "projects", "direct_sites", "supervisor", "app_access", "perms", "dept", "department", "level", "photo_id")}


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

@app.middleware("http")
async def once_only(request: Request, call_next):
    """A submission carries X-Client-Id. If the phone lost the reply (weak signal) and sends it again from the
    outbox, the stored first answer is returned instead of saving the check-in, trip or entry twice."""
    cid = request.headers.get("x-client-id", "")
    if request.method != "POST" or not re.fullmatch(r"[A-Za-z0-9-]{8,64}", cid):
        return await call_next(request)
    d = Db()
    try:
        seen = d.one("SELECT status, body FROM client_requests WHERE id = ?", cid)
    finally:
        d.close()
    if seen:
        return Response(content=seen["body"], status_code=seen["status"], media_type="application/json")
    res = await call_next(request)
    if 200 <= res.status_code < 300:
        body = b"".join([chunk async for chunk in res.body_iterator])
        d = Db()
        try:
            d.run("INSERT OR IGNORE INTO client_requests (id, path, status, body, created_at) VALUES (?, ?, ?, ?, ?)", cid, request.url.path[:200], res.status_code, body.decode("utf-8", "replace"), now_iso())
        finally:
            d.close()
        return Response(content=body, status_code=res.status_code, headers={k: v for k, v in res.headers.items() if k.lower() != "content-length"}, media_type=res.media_type)
    return res


def taken_time(taken_at: str | None, queued: str | None, not_before: str | None = None) -> str:
    """The phone's time for a photo, kept only when believable: sent live it must be within 10 minutes of the server
    clock (a phone set to 08:55 is not trusted); sent later from the phone's outbox it may be up to 7 days old.
    Never in the future, never before `not_before` (e.g. a check-out before its check-in)."""
    now = datetime.now(UTC)
    try:
        t = datetime.fromisoformat(str(taken_at).replace("Z", "+00:00"))
        if t.tzinfo is None:
            t = t.replace(tzinfo=UTC)
    except (TypeError, ValueError):
        return now_iso()
    age = (now - t).total_seconds()
    limit = 7 * 86400 if queued else 600
    if age < -300 or age > limit:
        return now_iso()
    if not_before:
        try:
            nb = datetime.fromisoformat(str(not_before).replace("Z", "+00:00"))
            if t < (nb if nb.tzinfo else nb.replace(tzinfo=UTC)):
                return now_iso()
        except ValueError:
            pass
    return t.astimezone(UTC).isoformat().replace("+00:00", "Z")


app.include_router(lists.router(UserDep, DbDep))
app.include_router(perms.router(UserDep, DbDep))
app.include_router(planner.make_router(UserDep, DbDep, save_upload=save_upload, is_staff=is_staff))
app.include_router(committees.make_router(UserDep, DbDep))
app.include_router(policies.make_router(UserDep, DbDep, save_upload=save_upload, save_bytes=save_bytes))
app.include_router(hrops.make_router(UserDep, DbDep, save_upload=save_upload, is_staff=is_staff, site_allowed=site_allowed, demo=DEMO))
app.include_router(modules.make_router(UserDep, DbDep, save_upload=save_upload, save_bytes=save_bytes, is_staff=is_staff, site_allowed=site_allowed, demo=DEMO))


# ------------------------------------------------------------------ prototype: demo accounts


# ------------------------------------------------------------------ live server: health check, nightly job, file retries


@app.get("/api/health")
def health():
    """For Azure's health probe and uptime checks: no sign-in, no personal data."""
    out = {"ok": True, "version": APP_VERSION, "time": now_iso(), "storage": "sharepoint" if store.remote else "local"}
    if store.remote:
        out["pendingFiles"] = store.pending_count()
    return out


@app.post("/api/cron/nightly")
def cron_nightly(request: Request):
    """Called once a night by a scheduled job with the shared key: closes missed check-outs, retries files waiting
    for SharePoint and copies the database to the Backups library."""
    key = os.environ.get("KL_CRON_KEY", "")
    if not key or request.headers.get("X-Cron-Key", "") != key:
        raise HTTPException(403, "Not allowed")
    db = Db()
    try:
        closed = modules.close_missed_checkouts(db)
    finally:
        db.close()
    out = {"closedCheckouts": closed}
    if store.remote:
        out["filesSent"] = store.retry_pending()
        out["backup"] = store.backup_database()
    return out


def _retry_files_forever() -> None:
    import threading
    import time

    def loop() -> None:
        while True:
            time.sleep(120)
            try:
                if store.pending_count():
                    store.retry_pending()
            except Exception as e:  # noqa: BLE001 - keep trying; the nightly job also retries
                print("file retry failed:", e, file=sys.stderr)

    threading.Thread(target=loop, name="sharepoint-retry", daemon=True).start()


if store.remote:
    _retry_files_forever()


@app.get("/api/demo")
def demo_info(db: DbDep):
    """The demo accounts, for the sign-in screen's one-tap buttons (prototype only)."""
    if not DEMO:
        return {"demo": False, "people": []}
    people = db.all("SELECT employee_id, name, role, designation FROM users WHERE active = 1 AND COALESCE(app_access, 1) = 1 ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 WHEN 'hr' THEN 2 ELSE 3 END, employee_id")
    return {"demo": True, "pin": "1234", "people": people}


@app.post("/api/demo/switch")
def demo_switch(payload: dict, user: UserDep, db: DbDep):
    """Sign in as another demo account without a PIN, to see the app as a manager or a field worker."""
    if not DEMO:
        raise HTTPException(404, "Not available")
    target = db.one("SELECT * FROM users WHERE employee_id = ? AND active = 1 AND COALESCE(app_access, 1) = 1", str(payload.get("employeeId", "")).upper())
    if not target:
        raise HTTPException(404, "No such account")
    device_id = new_id()
    db.insert("devices", {"id": device_id, "user_id": target["id"], "name": "Demo switch", "created_at": now_iso(), "last_seen": now_iso()})
    db.audit(user["id"], "demo_switch", "user", target["id"], f"{user['employee_id']} -> {target['employee_id']}")
    resolve_access(db, target)
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
    if not (user.get("app_access") if user.get("app_access") is not None else 1):
        raise HTTPException(403, "This employee does not use the app; the site supervisor marks their attendance. HR can turn the app on.")
    secret = modules.totp_required(db, user["id"])
    if secret and not modules.totp_ok(secret, str(payload.get("code", ""))):
        msg = "Enter the 6-digit code from your authenticator app" if not payload.get("code") else "That code is not right; use the current one"
        return JSONResponse(status_code=401, content={"detail": msg, "need2fa": True})
    auth.clear_failures(emp)
    device_id = new_id()
    db.insert("devices", {"id": device_id, "user_id": user["id"], "name": device, "created_at": now_iso(), "last_seen": now_iso()})
    db.audit(user["id"], "login", "user", user["id"], device)
    resolve_access(db, user)
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
    modules.close_missed_checkouts(db)
    unread = db.one("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0", user["id"])["n"]
    open_att = db.one("SELECT a.*, s.name AS site_name FROM attendance a JOIN sites s ON s.id = a.site_id WHERE a.user_id = ? AND a.checkout_at IS NULL ORDER BY checkin_at DESC LIMIT 1", user["id"])
    open_trip = db.one("SELECT * FROM trips WHERE user_id = ? AND status = 'open' ORDER BY start_at DESC LIMIT 1", user["id"])
    pending = len(modules.waiting_for(db, user))  # anyone can be an approver (a role or a department in the approval rules)
    if is_staff(user):
        pending += db.one("SELECT COUNT(*) AS n FROM trips t WHERE status = 'submitted' AND NOT EXISTS (SELECT 1 FROM approval_steps s WHERE s.kind = 'travel' AND s.ref_id = t.id)")["n"]
        if perms.can(user, "att.exceptions"):
            pending += db.one("SELECT COUNT(*) AS n FROM attendance WHERE status = 'pending'")["n"]
        team = modules.team_ids(db, user)
        pending += sum(1 for r in db.all("SELECT user_id FROM leaves l WHERE status = 'pending' AND NOT EXISTS (SELECT 1 FROM approval_steps s WHERE s.kind = 'leave' AND s.ref_id = l.id)")
                       if team is None or r["user_id"] in team)
    return {"user": public_user(user), "unread": unread, "openAttendance": open_att, "openTrip": open_trip, "pendingApprovals": pending, "version": APP_VERSION,
            "policiesPending": policies.pending_count(db, user)}


@app.get("/api/bootstrap")
def bootstrap(user: UserDep, db: DbDep):
    sites = db.all("SELECT * FROM sites WHERE active = 1 ORDER BY name")
    mine = [s for s in sites if site_allowed(user, s["id"])]
    items = db.all("SELECT * FROM register_items WHERE active = 1 ORDER BY site_id, sort, name")
    templates = db.all("SELECT id, name, project_type, fields FROM templates WHERE active = 1 ORDER BY name")
    for t in templates:
        t["fields"] = json.loads(t["fields"])
    people = db.all("SELECT id, employee_id, name, role, designation, photo_id FROM users WHERE active = 1 ORDER BY name")
    return {
        "company": db.setting("company"), "travel": db.setting("travel"), "leaveTypes": db.setting("leave_types"),
        "updatePrompts": db.setting("update_prompts"), "offices": db.setting("offices", []) or [], "sites": sites, "mySites": mine, "items": items, "templates": templates, "people": people,
        "demo": DEMO, "projects": modules.PROJECTS, "offKinds": [k for k, v in modules.KINDS.items() if v.get("off")], **lists.boot_extra(db),
        "gpsNeed": modules.num(modules.setting(db, "work_hours").get("gps_accuracy_m"), 50) or 50,
    }


# ------------------------------------------------------------------ attendance


@app.post("/api/attendance/checkin")
async def checkin(user: UserDep, db: DbDep, siteId: Annotated[str, Form()], lat: Annotated[str, Form()], lng: Annotated[str, Form()],
                  accuracy: Annotated[str | None, Form()] = None, override: Annotated[str | None, Form()] = None,
                  takenAt: Annotated[str | None, Form()] = None, queued: Annotated[str | None, Form()] = None, photo: UploadFile = File(...)):
    takenAt = taken_time(takenAt, queued)
    site = db.one("SELECT * FROM sites WHERE id = ? AND active = 1", siteId)
    if not site:
        raise HTTPException(404, "Site not found")
    if not site_allowed(user, siteId):
        raise HTTPException(403, "You are not assigned to this site")
    if db.one("SELECT 1 FROM attendance WHERE user_id = ? AND checkout_at IS NULL", user["id"]):
        raise HTTPException(409, "You are already checked in. Check out first.")
    la, ln, acc = parse_float(lat, "Latitude"), parse_float(lng, "Longitude"), parse_float(accuracy, "Accuracy", False)
    inside, dist = within_fence(la, ln, acc, site)
    if not inside and site.get("strict"):
        raise HTTPException(422, f"{site['name']} allows check-in only inside its boundary (strict site). You are {dist:,.0f} m away; move closer.")
    if not inside and not (override or "").strip():
        return JSONResponse(status_code=422, content={"detail": f"You are {dist:,.0f} m from {site['name']} (allowed {site['radius_m']} m). Move closer, or request an exception with a reason.",
                                                      "distance": round(dist), "outside": True})
    fid = await save_upload(db, photo, f"{site_folder(db, siteId)}/Attendance/{user['employee_id']}", "checkin", user, lat=la, lng=ln, accuracy=acc,
                            taken_at=takenAt, name=f"{stamp(takenAt)} check-in.jpg")
    status = "ok" if inside else "pending"
    if db.one("SELECT 1 FROM attendance WHERE user_id = ? AND checkout_at IS NULL", user["id"]):  # a second tap while the photo uploaded
        raise HTTPException(409, "You are already checked in. Check out first.")
    aid = db.insert("attendance", {"user_id": user["id"], "site_id": siteId, "checkin_at": takenAt or now_iso(), "checkin_file": fid, "checkin_lat": la, "checkin_lng": ln,
                                   "checkin_acc": acc, "checkin_dist": round(dist, 1), "status": status, "override_reason": (override or "").strip()})
    db.audit(user["id"], "checkin", "attendance", aid, f"{dist:.0f} m, {status}")
    if status == "pending":
        db.notify_role(("manager", "admin"), f"Check-in exception: {user['name']}", f"{dist:,.0f} m from {site['name']}: {override}", "#approvals", siteId)
    return {"id": aid, "status": status, "distance": round(dist)}


@app.post("/api/attendance/checkout")
async def checkout(user: UserDep, db: DbDep, lat: Annotated[str, Form()], lng: Annotated[str, Form()], accuracy: Annotated[str | None, Form()] = None,
                   override: Annotated[str | None, Form()] = None, takenAt: Annotated[str | None, Form()] = None,
                   queued: Annotated[str | None, Form()] = None, photo: UploadFile = File(...)):
    att = db.one("SELECT * FROM attendance WHERE user_id = ? AND checkout_at IS NULL ORDER BY checkin_at DESC LIMIT 1", user["id"])
    if not att and queued:
        # saved offline yesterday, sent today after the nightly job closed the day as "missed": the real check-out wins
        att = db.one("SELECT * FROM attendance WHERE user_id = ? AND flag = 'missed_checkout' AND COALESCE(checkout_file, '') = '' AND checkin_at < ? "
                     "ORDER BY checkin_at DESC LIMIT 1", user["id"], taken_time(takenAt, queued))
    if not att:
        raise HTTPException(409, "You are not checked in")
    takenAt = taken_time(takenAt, queued, att["checkin_at"])
    site = db.one("SELECT * FROM sites WHERE id = ?", att["site_id"])
    la, ln, acc = parse_float(lat, "Latitude"), parse_float(lng, "Longitude"), parse_float(accuracy, "Accuracy", False)
    inside, dist = within_fence(la, ln, acc, site)
    if not inside and int(site.get("strict") or 0) >= 2:
        raise HTTPException(422, f"{site['name']} allows check-out only inside its boundary. You are {dist:,.0f} m away; move closer.")
    if not inside and not (override or "").strip():
        return JSONResponse(status_code=422, content={"detail": f"You are {dist:,.0f} m from {site['name']}. Check out at the site, or give a reason for checking out from here.",
                                                      "distance": round(dist), "outside": True})
    fid = await save_upload(db, photo, f"{site_folder(db, att['site_id'])}/Attendance/{user['employee_id']}", "checkout", user, lat=la, lng=ln, accuracy=acc,
                            taken_at=takenAt, name=f"{stamp(takenAt)} check-out.jpg")
    patch = {"checkout_at": takenAt or now_iso(), "checkout_file": fid, "checkout_lat": la, "checkout_lng": ln, "checkout_acc": acc, "checkout_dist": round(dist, 1)}
    if att.get("flag") == "missed_checkout":
        patch["flag"] = ""  # the real check-out replaced the automatic one
    if not inside:
        patch["status"] = "pending"
        patch["override_reason"] = ((att["override_reason"] + " | ") if att["override_reason"] else "") + f"Check-out: {override.strip()}"
        if not att.get("ref"):
            patch["ref"] = db.next_ref("CE", att["checkin_at"])
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
        team = modules.team_ids(db, user)
        if team is not None:
            rows = [r for r in rows if r["user_id"] in team or r["site_id"] in user["sites"]]
    else:
        rows = db.all(base + " WHERE a.user_id = ? AND a.checkin_at >= ? ORDER BY a.checkin_at DESC", user["id"], since_iso)
    return {"rows": rows}


# ------------------------------------------------------------------ trips


@app.post("/api/trips/start")
async def trip_start(user: UserDep, db: DbDep, vehicle: Annotated[str, Form()], reading: Annotated[str, Form()], lat: Annotated[str, Form()], lng: Annotated[str, Form()],
                     purpose: Annotated[str, Form()] = "", siteId: Annotated[str | None, Form()] = None, takenAt: Annotated[str | None, Form()] = None,
                     queued: Annotated[str | None, Form()] = None, photo: UploadFile = File(...)):
    takenAt = taken_time(takenAt, queued)
    if db.one("SELECT 1 FROM trips WHERE user_id = ? AND status = 'open'", user["id"]):
        raise HTTPException(409, "A trip is already open. End it first.")
    travel = db.setting("travel", {"vehicles": {}})
    if vehicle not in travel["vehicles"]:
        raise HTTPException(422, "Unknown vehicle type")
    rd, la, ln = parse_float(reading, "Odometer reading"), parse_float(lat, "Latitude"), parse_float(lng, "Longitude")
    fid = await save_upload(db, photo, f"Travel/{user['employee_id']}", "odometer_start", user, lat=la, lng=ln, taken_at=takenAt, name=f"{stamp(takenAt)} start {rd:.0f} km.jpg")
    if db.one("SELECT 1 FROM trips WHERE user_id = ? AND status = 'open'", user["id"]):  # a second tap while the photo uploaded
        raise HTTPException(409, "A trip is already open. End it first.")
    tid = db.insert("trips", {"user_id": user["id"], "site_id": siteId or None, "vehicle": vehicle, "purpose": purpose.strip(), "start_at": takenAt or now_iso(),
                              "start_reading": rd, "start_file": fid, "start_lat": la, "start_lng": ln, "rate_per_km": travel["vehicles"][vehicle], "status": "open"})
    db.audit(user["id"], "trip_start", "trip", tid, f"{vehicle} @ {rd}")
    return {"id": tid}


@app.post("/api/trips/{trip_id}/end")
async def trip_end(trip_id: str, user: UserDep, db: DbDep, reading: Annotated[str, Form()], lat: Annotated[str, Form()], lng: Annotated[str, Form()],
                   takenAt: Annotated[str | None, Form()] = None, queued: Annotated[str | None, Form()] = None, photo: UploadFile = File(...)):
    if trip_id == "open":  # the trip was started offline, so the phone does not know its id yet
        trip = db.one("SELECT * FROM trips WHERE user_id = ? AND status = 'open' ORDER BY start_at DESC LIMIT 1", user["id"])
    else:
        trip = db.one("SELECT * FROM trips WHERE id = ? AND user_id = ?", trip_id, user["id"])
    if not trip or trip["status"] != "open":
        raise HTTPException(404, "Open trip not found")
    takenAt = taken_time(takenAt, queued, trip["start_at"])
    rd, la, ln = parse_float(reading, "Odometer reading"), parse_float(lat, "Latitude"), parse_float(lng, "Longitude")
    if rd < trip["start_reading"]:
        raise HTTPException(422, f"End reading {rd:.0f} is below the start reading {trip['start_reading']:.0f}")
    km = round(rd - trip["start_reading"], 1)
    if km > 1500:
        raise HTTPException(422, "More than 1,500 km in one trip looks like a typo. Check the reading.")
    fid = await save_upload(db, photo, f"Travel/{user['employee_id']}", "odometer_end", user, lat=la, lng=ln, taken_at=takenAt, name=f"{stamp(takenAt)} end {rd:.0f} km.jpg")
    straight = round(haversine_m(trip["start_lat"], trip["start_lng"], la, ln) / 1000, 1) if trip["start_lat"] is not None else None
    amount = round(km * (trip["rate_per_km"] or 0), 2)
    db.update("trips", trip["id"], {"end_at": takenAt or now_iso(), "end_reading": rd, "end_file": fid, "end_lat": la, "end_lng": ln, "km_claimed": km, "km_straight": straight,
                                 "amount": amount, "status": "submitted"})
    db.audit(user["id"], "trip_end", "trip", trip["id"], f"{km} km")
    modules.start_chain(db, "travel", trip["id"], user["id"], amount, f"Travel · {user['name']} · {km:g} km, ₹{amount:,.0f}", "#approvals")
    return {"id": trip["id"], "km": km, "straight": straight, "amount": amount}


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
    rows = db.all(sql, *args)
    for t in rows:
        if t["status"] == "submitted":
            cur = next((x for x in modules.steps_for(db, "travel", t["id"]) if x["status"] == "waiting"), None)
            t["waiting"] = (cur["approver_name"] or cur["role_label"]) if cur else ""
    team = modules.team_ids(db, user) if scope == "team" else None
    return {"rows": [r for r in rows if team is None or r["user_id"] in team]}


@app.post("/api/trips/{trip_id}/decide")
def trip_decide(trip_id: str, payload: dict, user: UserDep, db: DbDep):
    trip = db.one("SELECT * FROM trips WHERE id = ?", trip_id)
    if not trip or trip["status"] != "submitted":
        raise HTTPException(404, "Trip is not waiting for approval")
    if trip["user_id"] == user["id"] and user["role"] != "admin":
        raise HTTPException(403, "Someone else approves your own trip")
    decision = payload.get("decision")
    if decision not in ("approved", "rejected"):
        raise HTTPException(422, "decision must be approved or rejected")
    note = str(payload.get("note", ""))[:300]
    chained = bool(modules.steps_for(db, "travel", trip_id))
    if chained:
        res = modules.decide_chain(db, "travel", trip_id, user, decision, note, trip["user_id"], f"Trip {trip['km_claimed']:g} km on {trip['start_at'][:10]}", "#trips")
    else:  # a trip sent before travel had approval rules: one decision by a manager
        require(user, "admin", "manager")
        if user.get("level"):
            raise HTTPException(403, "A reporting manager decides this trip")
        res = decision
    if res != "pending":
        if not db.change("UPDATE trips SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ? AND status = 'submitted'", res, user["id"], now_iso(), note, trip_id):
            raise HTTPException(409, "This claim was withdrawn or decided meanwhile")
        if not chained:
            db.notify(trip["user_id"], f"Trip {decision}", f"{trip['km_claimed']} km on {trip['start_at'][:10]}" + (f": {note}" if note else ""), "#trips")
    db.audit(user["id"], f"trip_{decision}", "trip", trip_id)
    return {"ok": True, "status": res}


@app.post("/api/trips/{trip_id}/withdraw")
def trip_withdraw(trip_id: str, user: UserDep, db: DbDep):
    trip = db.one("SELECT * FROM trips WHERE id = ?", trip_id)
    if not trip or trip["user_id"] != user["id"]:
        raise HTTPException(404, "Trip not found")
    if trip["status"] != "submitted":
        raise HTTPException(409, "Only a claim waiting for approval can be withdrawn")
    if not db.change("UPDATE trips SET status = 'withdrawn' WHERE id = ? AND status = 'submitted'", trip_id):
        raise HTTPException(409, "Already withdrawn or decided")
    modules.withdraw_chain(db, "travel", trip_id, user, f"Trip {trip['km_claimed']:g} km on {trip['start_at'][:10]}", "#trips")
    db.audit(user["id"], "trip_withdrawn", "trip", trip_id)
    return {"ok": True}


@app.post("/api/attendance/{att_id}/decide")
def attendance_decide(att_id: str, payload: dict, user: UserDep, db: DbDep):
    perms.need(user, "att.exceptions")
    att = db.one("SELECT * FROM attendance WHERE id = ?", att_id)
    if not att or att["status"] != "pending":
        raise HTTPException(404, "Nothing to decide")
    if att["user_id"] == user["id"] and user["role"] != "admin":
        raise HTTPException(403, "Someone else decides your own check-in exception")
    decision = payload.get("decision")
    if decision not in ("ok", "rejected"):
        raise HTTPException(422, "decision must be ok or rejected")
    hrops.assert_open(db, modules.to_local(att["checkin_at"]).date().isoformat())
    db.update("attendance", att_id, {"status": decision, "decided_by": user["id"], "decided_at": now_iso(), "decision_note": str(payload.get("note", ""))[:300]})
    hrops.log_change(db, user["id"], "attendance", att_id, att["user_id"], f"Check-in exception {modules.to_local(att['checkin_at']):%Y-%m-%d}", "pending",
                     "accepted" if decision == "ok" else "rejected", str(payload.get("note", "")))
    db.notify(att["user_id"], "Check-in exception " + ("accepted" if decision == "ok" else "rejected"), str(payload.get("note", "")), "#attendance")
    return {"ok": True}


# ------------------------------------------------------------------ registers


def item_balance(db: Db, item_id: str) -> float:
    r = db.one("SELECT balance_after FROM movements WHERE item_id = ? ORDER BY rowid DESC LIMIT 1", item_id)
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
    if not user.get("all_sites"):
        rows = [r for r in rows if r["site_id"] in user["sites"] or r.get("created_by") == user["id"]]  # also farmers they added without a site
    return {"rows": rows[:300]}


def farmer_allowed(user: dict, f: dict) -> bool:
    return bool(user.get("all_sites")) or f.get("created_by") == user["id"] or (f.get("site_id") in user["sites"])


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
    if not f or not farmer_allowed(user, f):
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
    if not f or not farmer_allowed(user, f):
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
    if not f or not farmer_allowed(user, f):
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
        perms.need(user, "hr.documents")
        target = userId
    rows = db.all("SELECT h.*, f.name AS file_name, f.mime, f.size FROM hr_documents h JOIN files f ON f.id = h.file_id WHERE h.user_id = ? ORDER BY h.created_at DESC", target)
    return {"rows": rows}


@app.post("/api/hr/documents")
async def hr_upload(user: UserDep, db: DbDep, userId: Annotated[str, Form()], title: Annotated[str, Form()], category: Annotated[str, Form()], file: UploadFile = File(...)):
    perms.need(user, "hr.documents")
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
    rows = db.all(sql + " ORDER BY w.date DESC, w.created_at DESC", *args)
    team = modules.team_ids(db, user)
    return {"rows": [r for r in rows if team is None or r["user_id"] in team]}


def _team_member(db: Db, user: dict, uid: str) -> dict:
    """Someone in the signed-in manager's team (anyone for HR and the director)."""
    if user["role"] not in ("admin", "hr", "manager"):
        raise HTTPException(403, "Managers, HR and the director only")
    team = modules.team_ids(db, user)
    target = db.one("SELECT id, name FROM users WHERE id = ? AND active = 1", uid)
    if not target or (team is not None and uid not in team):
        raise HTTPException(404, "Not in your team")
    return target


@app.post("/api/updates/remind")
def remind_update(payload: dict, user: UserDep, db: DbDep):
    """Ask someone who has not sent today's daily update to send it."""
    t = _team_member(db, user, str(payload.get("userId", "")))
    db.notify(t["id"], "Please send your daily update", f"From {user['name']}", "#updates")
    return {"ok": True}


@app.post("/api/updates/reply")
def reply_update(payload: dict, user: UserDep, db: DbDep):
    """A short note back to the person about their update."""
    t = _team_member(db, user, str(payload.get("userId", "")))
    text = str(payload.get("text", "")).strip()[:500]
    if len(text) < 2:
        raise HTTPException(422, "Write a message")
    db.notify(t["id"], f"{user['name']} read your update", text, "#updates")
    return {"ok": True}


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


@app.get("/api/leaves")
def leaves(user: UserDep, db: DbDep, scope: str = "mine"):
    sql = "SELECT l.*, u.name AS user_name FROM leaves l JOIN users u ON u.id = l.user_id"
    args: list = []
    if not (scope == "team" and is_staff(user)):
        sql += " WHERE l.user_id = ?"
        args.append(user["id"])
    rows = db.all(sql + " ORDER BY l.created_at DESC LIMIT 200", *args)
    team = modules.team_ids(db, user)
    rows = [r for r in rows if team is None or r["user_id"] in team]
    for lv in rows:
        st = modules.steps_for(db, "leave", lv["id"])
        cur = next((s for s in st if s["status"] == "waiting"), None)
        lv["waiting"] = (cur["approver_name"] or cur["role"]) if cur else ""
        lv["steps"] = st
        lv["days"] = modules.leave_len(db, lv)
        lv["canWithdraw"] = lv["user_id"] == user["id"] and leave_withdrawable(lv)
    return {"rows": rows}


def leave_withdrawable(lv: dict) -> bool:
    """Your own leave can be withdrawn while it waits, or once approved until its first day."""
    return lv["status"] == "pending" or (lv["status"] == "approved" and lv["from_date"] > modules.local_today().isoformat())


@app.post("/api/leaves")
def add_leave(payload: dict, user: UserDep, db: DbDep):
    fd, td = str(payload.get("from", "")), str(payload.get("to", ""))
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", fd) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", td) or td < fd:
        raise HTTPException(422, "Pick valid from and to dates")
    typ = str(payload.get("type", "Casual"))[:30]
    if typ not in (db.setting("leave_types", []) or []):
        raise HTTPException(422, "Choose a leave type from the list")
    half = str(payload.get("half") or "")
    if half not in ("", *modules.HALVES):
        raise HTTPException(422, "Half day must be the first or the second half")
    if half and fd != td:
        raise HTTPException(422, "A half day is one date: make From and To the same day")
    for c in db.all("SELECT from_date, to_date, half, status FROM leaves WHERE user_id = ? AND status IN ('pending', 'approved') AND from_date <= ? AND to_date >= ?",
                    user["id"], td, fd):
        if half and c["half"] and c["half"] != half:
            continue  # the other half of the same day is fine
        # the same days twice would count twice against the balance
        when = f"on {c['from_date']} ({modules.HALVES[c['half']]})" if c["half"] else f"from {c['from_date']} to {c['to_date']}"
        raise HTTPException(409, f"You already have leave {when} ({c['status']})")
    hrops.assert_range_open(db, fd, td)
    days = modules.leave_days(db, fd, td, half)
    if days <= 0:
        raise HTTPException(422, "That day is a holiday or weekly off" if half else "Those dates are all holidays or weekly offs")
    bal = next((b for b in modules.leave_balances(db, user["id"], int(fd[:4])) if b["type"] == typ), None)
    if bal and bal["available"] is not None and typ != "Unpaid" and days > bal["available"] + 1e-9:
        raise HTTPException(422, f"Only {bal['available']:g} days of {typ} leave left; this request is {days:g} days. Apply for the rest as Unpaid.")
    lid = db.insert("leaves", {"user_id": user["id"], "from_date": fd, "to_date": td, "half": half, "type": typ, "reason": str(payload.get("reason", ""))[:500],
                               "status": "pending", "created_at": now_iso()})
    what = f"{typ} ½ day ({modules.HALVES[half]})" if half else f"{typ} {days:g} day(s)"
    modules.start_chain(db, "leave", lid, user["id"], days, f"Leave · {user['name']} · {what}", "#approvals")
    return {"id": lid, "days": days}


@app.post("/api/leaves/{leave_id}/withdraw")
def leave_withdraw(leave_id: str, user: UserDep, db: DbDep):
    lv = db.one("SELECT * FROM leaves WHERE id = ?", leave_id)
    if not lv or lv["user_id"] != user["id"]:
        raise HTTPException(404, "Leave not found")
    if not leave_withdrawable(lv):
        raise HTTPException(409, "This leave has started or is decided. Ask HR to change it." if lv["status"] == "approved" else "This leave is already decided")
    hrops.assert_range_open(db, lv["from_date"], lv["to_date"])
    if not db.change("UPDATE leaves SET status = 'withdrawn' WHERE id = ? AND status = ?", leave_id, lv["status"]):
        raise HTTPException(409, "Already withdrawn or decided")
    when = lv["from_date"] if lv["from_date"] == lv["to_date"] else f"{lv['from_date']} to {lv['to_date']}"
    modules.withdraw_chain(db, "leave", leave_id, user, f"Leave {when} ({lv['type']})", "#leaves")
    hrops.log_change(db, user["id"], "leave", leave_id, user["id"], f"{lv['type']} leave {when}", lv["status"], "withdrawn", "withdrawn by the employee")
    db.audit(user["id"], "leave_withdrawn", "leave", leave_id, lv["status"])
    return {"ok": True}


@app.post("/api/leaves/{leave_id}/decide")
def leave_decide(leave_id: str, payload: dict, user: UserDep, db: DbDep):
    lv = db.one("SELECT * FROM leaves WHERE id = ?", leave_id)
    if not lv or lv["status"] != "pending":
        raise HTTPException(404, "Nothing to decide")
    decision = payload.get("decision")
    if decision not in ("approved", "rejected"):
        raise HTTPException(422, "decision must be approved or rejected")
    note = str(payload.get("note", ""))[:300]
    hrops.assert_range_open(db, lv["from_date"], lv["to_date"])
    if not modules.steps_for(db, "leave", leave_id):  # made before approval chains: one decision by office staff
        require(user, "admin", "manager", "hr")
        if user.get("level"):
            raise HTTPException(403, "A reporting manager or HR decides this leave")
    res = modules.decide_chain(db, "leave", leave_id, user, decision, note, lv["user_id"], f"Leave {lv['from_date']} to {lv['to_date']}", "#leaves")
    if res != "pending":
        if not db.change("UPDATE leaves SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ? AND status = 'pending'", res, user["id"], now_iso(), note, leave_id):
            raise HTTPException(409, "This leave was withdrawn or decided meanwhile")
        hrops.log_change(db, user["id"], "leave", leave_id, lv["user_id"], f"{lv['type']} leave {lv['from_date']} to {lv['to_date']}", "pending", res, note)
        if not modules.steps_for(db, "leave", leave_id):
            db.notify(lv["user_id"], f"Leave {decision}", f"{lv['from_date']} to {lv['to_date']}", "#leaves")
    return {"ok": True, "status": res}


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
    """Everything waiting for this person. Anyone can be an approver: the approval rules may name a role or a department."""
    staff = is_staff(user)
    trips_ = db.all("SELECT t.*, u.name AS user_name, s.name AS site_name FROM trips t JOIN users u ON u.id = t.user_id LEFT JOIN sites s ON s.id = t.site_id WHERE t.status = 'submitted' ORDER BY t.end_at")
    att = db.all("SELECT a.*, u.name AS user_name, s.name AS site_name, s.radius_m FROM attendance a JOIN users u ON u.id = a.user_id JOIN sites s ON s.id = a.site_id WHERE a.status = 'pending' ORDER BY a.checkin_at")
    lv = db.all("SELECT l.*, u.name AS user_name FROM leaves l JOIN users u ON u.id = l.user_id WHERE l.status = 'pending' ORDER BY l.created_at")
    team = modules.team_ids(db, user)
    waiting = modules.waiting_for(db, user)
    my_trips = {s["ref_id"] for s in waiting if s["kind"] == "travel"}
    keep_t = []
    for t in trips_:
        st = modules.steps_for(db, "travel", t["id"])
        if t["id"] in my_trips or (not st and user["role"] in ("admin", "manager") and (team is None or t["user_id"] in team)):
            t["steps"] = st
            keep_t.append(t)
    trips_ = keep_t
    if not perms.can(user, "att.exceptions"):
        att = []
    elif team is not None:
        att = [x for x in att if x["user_id"] in team or x["site_id"] in user["sites"]]
    att = [x for x in att if x["user_id"] != user["id"] or user["role"] == "admin"]
    mine = {s["ref_id"] for s in waiting if s["kind"] == "leave"}
    keep = []
    for x in lv:
        st = modules.steps_for(db, "leave", x["id"])
        if (not st and staff and (team is None or x["user_id"] in team)) or x["id"] in mine:
            x["steps"] = st
            x["days"] = modules.leave_len(db, x)
            x["balance"] = next((b for b in modules.leave_balances(db, x["user_id"]) if b["type"] == x["type"]), None)
            keep.append(x)
    return {"trips": trips_, "attendance": att, "leaves": keep}


@app.get("/api/dashboard")
def dashboard(user: UserDep, db: DbDep):
    require(user, "admin", "manager", "hr")
    perms.need(user, "reports.view")
    today = datetime.now().strftime("%Y-%m-%d")
    day0 = datetime.now().astimezone().replace(hour=0, minute=0, second=0, microsecond=0)
    start_utc = day0.astimezone(UTC).isoformat().replace("+00:00", "Z")  # check-in times are UTC: compare instants
    on_site = db.all("SELECT a.id, a.user_id, a.site_id, a.checkin_at, a.checkin_dist, a.status, u.name AS user_name, s.name AS site_name FROM attendance a JOIN users u ON u.id = a.user_id JOIN sites s ON s.id = a.site_id WHERE a.checkout_at IS NULL ORDER BY a.checkin_at")
    team = modules.team_ids(db, user)
    in_team = (lambda uid: True) if team is None else (lambda uid: uid in team)
    on_site = [a for a in on_site if team is None or a["user_id"] in team]
    today_att = len({r["user_id"] for r in db.all("SELECT user_id FROM attendance WHERE checkin_at >= ?", start_utc) if in_team(r["user_id"])})
    field_total = sum(1 for r in db.all("SELECT id FROM users WHERE active = 1 AND role = 'field'") if in_team(r["id"]))
    stock = []
    for it in [x for x in db.all("SELECT i.*, s.name AS site_name FROM register_items i JOIN sites s ON s.id = i.site_id WHERE i.active = 1 ORDER BY s.name, i.sort") if site_allowed(user, x["site_id"])]:
        bal = item_balance(db, it["id"])
        stock.append({"item": it["name"], "site": it["site_name"], "unit": it["unit"], "balance": bal, "low": it["kind"] == "input" and it["low_stock"] and bal < it["low_stock"], "kind": it["kind"]})
    month = today[:7]
    travel = db.one("SELECT COALESCE(SUM(amount), 0) AS amt, COALESCE(SUM(km_claimed), 0) AS km, COUNT(*) AS n FROM trips WHERE status = 'approved' AND substr(end_at, 1, 7) = ?", month)
    farmers_n = sum(1 for f in db.all("SELECT site_id FROM farmers") if site_allowed(user, f["site_id"]))
    docs_week = db.one("SELECT COUNT(*) AS n FROM documents WHERE created_at >= ?", datetime.fromtimestamp(datetime.now(UTC).timestamp() - 7 * 86400, UTC).isoformat())["n"]
    updates_today = db.one("SELECT COUNT(*) AS n FROM work_updates WHERE date = ?", today)["n"]
    cache: dict = {}
    open_fb = sum(1 for x in db.all("SELECT * FROM feedback WHERE status = 'open'") if committees.can_handle(db, user, x, cache))  # only cases this person may see
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
    ops = {
        "incidentsOpen": db.one("SELECT COUNT(*) AS n FROM records WHERE kind = 'incident' AND status != 'closed'")["n"],
        "equipmentDown": db.one("SELECT COUNT(*) AS n FROM records WHERE kind = 'equipment' AND status != 'working'")["n"],
        "batchesMonth": db.one("SELECT COUNT(*) AS n FROM records WHERE kind = 'batch' AND substr(created_at, 1, 7) = ?", today[:7])["n"],
        "biocharMonth": sum(float(json.loads(r["data"]).get("output_kg") or 0) for r in db.all("SELECT data FROM records WHERE kind = 'batch' AND substr(created_at, 1, 7) = ?", today[:7])),
        "appliedMonth": sum(float(json.loads(r["data"]).get("qty_kg") or 0) for r in db.all("SELECT data FROM records WHERE kind = 'application' AND substr(created_at, 1, 7) = ?", today[:7])),
        "expensesPending": db.one("SELECT COUNT(*) AS n FROM records WHERE kind = 'expense' AND status = 'pending'")["n"],
    }
    # the home screen's "Today": who is late, who is on leave, travel waiting, and each site's state (2026-11-19 redesign)
    wh = modules.setting(db, "work_hours")
    sh, sm = (int(x) for x in str(wh.get("start", "09:00")).split(":")[:2])
    late_after = sh * 60 + sm + int(wh.get("grace_min", 15))
    first_in: dict[str, dict] = {}
    for a in db.all("SELECT a.user_id, a.checkin_at, u.name FROM attendance a JOIN users u ON u.id = a.user_id WHERE a.checkin_at >= ? ORDER BY a.checkin_at", start_utc):
        if in_team(a["user_id"]) and a["user_id"] not in first_in:
            first_in[a["user_id"]] = a
    late = []
    for a in first_in.values():
        t = modules.to_local(a["checkin_at"])
        if t.hour * 60 + t.minute > late_after:
            late.append({"name": a["name"], "at": t.strftime("%H:%M")})
    on_leave = [{"name": r["name"], "type": r["type"], "half": r["half"] or ""} for r in db.all(
        "SELECT u.name, l.type, l.half, l.user_id FROM leaves l JOIN users u ON u.id = l.user_id WHERE l.status = 'approved' AND l.from_date <= ? AND l.to_date >= ?", today, today) if in_team(r["user_id"])]
    travel_pending = sum(float(t["amount"] or 0) for t in db.all("SELECT user_id, amount FROM trips WHERE status = 'submitted'") if in_team(t["user_id"]))
    open_inc: dict[str, int] = {}
    for r in db.all("SELECT site_id FROM records WHERE kind = 'incident' AND status NOT IN ('closed', 'done')"):
        open_inc[r["site_id"]] = open_inc.get(r["site_id"], 0) + 1
    sites_today = []
    for s in db.all("SELECT id, name, project_type FROM sites WHERE active = 1 AND project_type <> 'office' ORDER BY name"):
        if not site_allowed(user, s["id"]):
            continue
        sites_today.append({"id": s["id"], "name": s["name"], "project": s["project_type"], "onSite": sum(1 for a in on_site if a.get("site_id") == s["id"]),
                            "incidents": open_inc.get(s["id"], 0), "low": [x["item"] for x in stock if x["low"] and x["site"] == s["name"]]})
    return {"ops": ops, "days": days, "tasks": {"total": tasks["total"] or 0, "done": tasks["done"] or 0, "doing": tasks["doing"] or 0, "late": tasks["late"] or 0, "doneWeek": done_week},
            "onSite": on_site, "todayAttendance": today_att, "fieldTotal": field_total, "stock": stock, "travelMonth": travel, "farmers": farmers_n, "docsWeek": docs_week,
            "updatesToday": updates_today, "openFeedback": open_fb,
            "late": late, "onLeave": on_leave, "travelPending": travel_pending, "sitesToday": sites_today}


@app.get("/api/export/site/{site_id}")
def export_site(site_id: str, user: UserDep, db: DbDep):
    """Audit pack: every movement with its photo hash, as CSV (the ZIP of photos is the SharePoint folder itself)."""
    perms.need(user, "reports.export")
    if not site_allowed(user, site_id):
        raise HTTPException(403, "Not your site")
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


# Employee codes: project code + reporting office (2 digits, list in Administration > Company) + running number, e.g. BIO01001.
# Generated when HR adds someone; never reused, never changed by a transfer (the code shows where the person started).
def next_employee_code(db: Db, project: str, office: str) -> str:
    prefix = lists.project_codes(db).get(str(project or "").strip().lower())
    office = str(office or "").strip()
    if not prefix:
        raise HTTPException(422, "Choose the project")
    if office not in {o["code"] for o in db.setting("offices", []) or []}:
        raise HTTPException(422, "Choose the reporting office")
    head = prefix + office
    used = [int(m.group(1)) for r in db.all("SELECT employee_id FROM users WHERE employee_id LIKE ?", head + "%")
            if (m := re.fullmatch(re.escape(head) + r"(\d{3,})", r["employee_id"]))]
    return f"{head}{(max(used) + 1 if used else 1):03d}"


@app.get("/api/admin/next-employee-code")
def admin_next_employee_code(project: str, office: str, user: UserDep, db: DbDep):
    perms.need(user, "users.add")
    return {"employeeId": next_employee_code(db, project, office)}


@app.get("/api/admin/users")
def admin_users(user: UserDep, db: DbDep):
    if not any(perms.can(user, k) for k in ("users.add", "users.edit", "users.deactivate", "users.pin", "users.role", "users.assign")):
        raise HTTPException(403, "Your designation may not manage employees")
    rows = db.all("SELECT id, employee_id, name, role, designation, phone, email, active, must_change_pin, created_at, COALESCE(department, '') AS department, COALESCE(level, '') AS level FROM users ORDER BY employee_id")
    sites = db.all("SELECT user_id, site_id FROM user_sites")
    for r in rows:
        r["sites"] = [s["site_id"] for s in sites if s["user_id"] == r["id"]]
        r["devices"] = db.one("SELECT COUNT(*) AS n FROM devices WHERE user_id = ?", r["id"])["n"]
        r["dept"] = perms.dept_of(db, r)
    return {"rows": rows}


@app.post("/api/admin/users")
def admin_user_save(payload: dict, user: UserDep, db: DbDep):
    perms.need(user, "users.edit" if payload.get("id") else "users.add")
    if payload.get("id"):
        emp = str(payload.get("employee_id", "")).strip().upper()
    else:
        emp = next_employee_code(db, payload.get("project", ""), payload.get("office", ""))
    name = re.sub(r"\s+", " ", str(payload.get("name", ""))).strip()[:80]
    role = payload.get("role", "field")
    designation = str(payload.get("designation", ""))[:80]
    level = ""
    if payload.get("roleName"):  # a designation from Settings > Lists: its access level decides the role
        r = next((x for x in lists.roles(db) if x["name"] == payload["roleName"]), None)
        if not r:
            raise HTTPException(422, "Choose a designation from the list")
        role, designation = lists.base_role(db, r["level"]), r["name"]
        level = "" if r["level"] in lists.LEVELS else r["level"]
    if not emp or len(name) < 2 or role not in ("admin", "manager", "hr", "field"):
        raise HTTPException(422, "Employee code, name and a designation are required")
    if role == "admin" and user["role"] != "admin":
        raise HTTPException(403, "Only an admin can create admins")
    dept = str(payload.get("department") or "")
    if not dept and not payload.get("id"):
        dept = perms.dept_of_project(db, payload.get("project", ""))
    if dept and not any(d["key"] == dept for d in perms.departments(db)):
        raise HTTPException(422, "Choose a department from the list")
    row = {"employee_id": emp, "name": name, "role": role, "designation": designation, "phone": str(payload.get("phone", ""))[:20],
           "email": str(payload.get("email", ""))[:120], "active": 1 if payload.get("active", True) else 0, "department": dept, "level": level}
    raw_sites = payload.get("sites") or []
    if not isinstance(raw_sites, list):
        raise HTTPException(422, "Sites must be a list")
    known_sites = {s["id"] for s in db.all("SELECT id FROM sites")}
    payload["sites"] = [s for s in dict.fromkeys(str(x) for x in raw_sites) if s in known_sites]  # unknown ids dropped, no repeats
    uid = payload.get("id")
    if uid:
        prev = db.one("SELECT * FROM users WHERE id = ?", uid)
        if not prev:
            raise HTTPException(404, "User not found")
        if prev["role"] == "admin" and user["role"] != "admin":
            raise HTTPException(403, "Only the director edits a director")
        if not payload.get("roleName"):  # designation not from the list: keep the custom level only if nothing changed
            same = (prev["role"], prev["designation"] or "") == (role, designation)
            level = row["level"] = (prev.get("level") or "") if same else ""
        if (prev["role"], prev["designation"] or "", prev.get("level") or "") != (role, designation, level):
            perms.need(user, "users.role")
            if prev["id"] == user["id"] and prev["role"] == "admin" and role != "admin":
                raise HTTPException(409, "You cannot take the director role away from yourself")
        if bool(prev["active"]) != bool(row["active"]):
            perms.need(user, "users.deactivate")
            if prev["id"] == user["id"]:
                raise HTTPException(409, "You cannot deactivate yourself")
        if sorted(payload.get("sites") or []) != sorted(x["site_id"] for x in db.all("SELECT site_id FROM user_sites WHERE user_id = ?", uid)):
            perms.need(user, "users.assign")
        hrops.log_dict(db, user["id"], "employee", uid, uid, prev, row, {"role": "Role", "active": "Active", "designation": "Designation", "name": "Name", "employee_id": "Employee ID", "department": "Department"})
        db.update("users", uid, row)
    else:
        if db.one("SELECT 1 FROM users WHERE employee_id = ?", emp):
            raise HTTPException(409, f"{emp} already exists")
        pin = str(payload.get("pin") or "1234")
        if not re.fullmatch(r"\d{4,6}", pin):
            raise HTTPException(422, "Starting PIN must be 4 to 6 digits")
        h, s = auth.hash_pin(pin)
        uid = db.insert("users", {**row, "pin_hash": h, "pin_salt": s, "must_change_pin": 1, "created_at": now_iso()})
    db.run("DELETE FROM user_sites WHERE user_id = ?", uid)
    for sid in payload.get("sites") or []:
        db.insert("user_sites", {"user_id": uid, "site_id": sid})
    db.audit(user["id"], "user_save", "user", uid, emp)
    return {"id": uid, "employeeId": emp}


@app.post("/api/admin/users/{uid}/reset-pin")
def admin_reset_pin(uid: str, payload: dict, user: UserDep, db: DbDep):
    perms.need(user, "users.pin")
    t = db.one("SELECT role FROM users WHERE id = ?", uid)
    if t and t["role"] == "admin" and user["role"] != "admin":
        raise HTTPException(403, "Only the director resets a director's PIN")
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
    perms.need(user, "sites.edit")
    name = str(payload.get("name", "")).strip()
    if len(name) < 2:
        raise HTTPException(422, "Site name is required")
    row = {"name": name, "project_type": str(payload.get("project_type", "other"))[:30], "lat": parse_float(payload.get("lat"), "Latitude"), "lng": parse_float(payload.get("lng"), "Longitude"),
           "radius_m": int(parse_float(payload.get("radius_m", 150), "Radius") or 150), "address": str(payload.get("address", ""))[:200], "active": 1 if payload.get("active", True) else 0,
           "subtype": str(payload.get("subtype", ""))[:20], "strict": site_rule(payload.get("strict"))}
    if not 10 <= row["radius_m"] <= 20000:
        raise HTTPException(422, "Radius must be between 10 m and 20 km")
    if not (-90 <= row["lat"] <= 90 and -180 <= row["lng"] <= 180):
        raise HTTPException(422, "Latitude or longitude is out of range")
    if row["project_type"] != "office" and row["project_type"] not in lists.project_codes(db):
        raise HTTPException(422, "Choose the project")
    groups = [x["key"] for x in lists.subgroups(db).get(row["project_type"], [])]
    if row["subtype"] and row["subtype"] not in groups:
        raise HTTPException(422, "Choose a sub-group of this project")
    if groups and not row["subtype"] and row["project_type"] == "biochar":
        row["subtype"] = "kiln"  # older app versions sent no type for low-tech kiln sites; other projects show "Sub-group not set"
    if not groups:
        row["subtype"] = ""
    add, remove = payload.get("teamAdd") or [], payload.get("teamRemove") or []
    if not isinstance(add, list) or not isinstance(remove, list):
        raise HTTPException(422, "Team changes must be lists")
    if add or remove:  # checked before anything is written
        perms.need(user, "users.assign")
    sid = payload.get("id")
    if sid:
        if not db.one("SELECT 1 FROM sites WHERE id = ?", sid):
            raise HTTPException(404, "Site not found")
        db.update("sites", sid, row)
    else:
        sid = db.insert("sites", row)
    # only the people the form added or took off change: a team that never loaded cannot empty the site
    for uid in {str(x) for x in add}:
        if db.one("SELECT 1 FROM users WHERE id = ?", uid) and not db.one("SELECT 1 FROM user_sites WHERE user_id = ? AND site_id = ?", uid, sid):
            db.insert("user_sites", {"user_id": uid, "site_id": sid})
    for uid in {str(x) for x in remove} - {str(x) for x in add}:
        db.run("DELETE FROM user_sites WHERE user_id = ? AND site_id = ?", uid, sid)
    db.audit(user["id"], "site_save", "site", sid, f"{name}" + (f" · team +{len(add)} -{len(remove)}" if add or remove else ""))
    return {"id": sid}


@app.get("/api/admin/sites")
def admin_sites(user: UserDep, db: DbDep):
    """Every site, closed ones too, so a closed site can be opened again."""
    perms.need(user, "sites.edit")
    return {"rows": db.all("SELECT * FROM sites ORDER BY active DESC, name")}


def site_rule(v) -> int:
    """0 allow exceptions, 1 only inside for check-in, 2 only inside for check-in and check-out."""
    if v in (2, "2", "both", "Both"):
        return 2
    return 1 if v in (True, 1, "1", "yes", "Strict", "checkin") else 0


@app.post("/api/admin/items")
def admin_item_save(payload: dict, user: UserDep, db: DbDep):
    perms.need(user, "sites.edit")
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
    perms.need(user, "sites.edit")
    rows = db.all("SELECT * FROM templates ORDER BY name")
    for r in rows:
        r["fields"] = json.loads(r["fields"])
    return {"rows": rows}


@app.post("/api/admin/templates")
def admin_template_save(payload: dict, user: UserDep, db: DbDep):
    perms.need(user, "sites.edit")
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
    perms.need(user, "settings.company")
    if "offices" in payload:
        clean = []
        for o in payload["offices"] or []:
            code = str(o.get("code", "")).strip()
            if not re.fullmatch(r"\d{2}", code) or code == "00":
                raise HTTPException(422, f"Office number '{code}' must be two digits, 01 to 99")
            if code in (c["code"] for c in clean):
                raise HTTPException(422, f"Office number {code} is used twice")
            clean.append({"code": code, "name": str(o.get("name", "")).strip()[:60]})
        db.set_setting("offices", clean)
    for key in ("company", "travel", "leave_types", "update_prompts"):
        if key in payload:
            db.set_setting(key, payload[key])
    return {"ok": True}


@app.post("/api/admin/company-signature")
async def admin_company_signature(user: UserDep, db: DbDep, file: UploadFile = File(...)):
    perms.need(user, "settings.company")
    fid = await save_upload(db, file, "Company", "company_signature", user, name="authorised-signature.png")
    db.set_setting("company_signature_file", fid)
    return {"fileId": fid}


@app.get("/api/admin/audit")
def admin_audit(user: UserDep, db: DbDep, limit: int = 200):
    perms.need(user, "settings.audit")
    return {"rows": db.all("SELECT a.*, u.name AS user_name FROM audit a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.at DESC LIMIT ?", limit)}


# ------------------------------------------------------------------ files


@app.post("/api/people/{uid}/photo")
async def set_photo(uid: str, user: UserDep, db: DbDep, photo: UploadFile = File(...)):
    """A person's photo, shown in place of their initials. HR and the director for anyone; everyone for themselves."""
    if uid != user["id"]:
        perms.need(user, "users.edit")
    u = db.one("SELECT id, employee_id, name FROM users WHERE id = ?", uid)
    if not u:
        raise HTTPException(404, "Not found")
    if not (photo.content_type or "").startswith("image/"):
        raise HTTPException(422, "Choose a photo")
    fid = await save_upload(db, photo, f"HR/{u['employee_id']} {u['name']}", "profile_photo", user, name=f"{u['employee_id']} photo.jpg")
    db.update("users", uid, {"photo_id": fid})
    db.audit(user["id"], "photo_set", "user", uid, "")
    return {"photo_id": fid}


@app.post("/api/people/{uid}/photo/remove")
def remove_photo(uid: str, user: UserDep, db: DbDep):
    if uid != user["id"]:
        perms.need(user, "users.edit")
    db.update("users", uid, {"photo_id": None})
    db.audit(user["id"], "photo_removed", "user", uid, "")
    return {"ok": True}


@app.get("/api/files/{file_id}")
def get_file(file_id: str, user: UserDep, db: DbDep, download: int = 0):
    f = db.one("SELECT * FROM files WHERE id = ?", file_id)
    if not f or not store.exists(f["path"]):
        raise HTTPException(404, "File not found")
    # Field staff: HR documents only their own; check-in selfies and odometer photos only their own (colleagues'
    # attendance evidence is for managers); the rest (task, farmer, site evidence) they open from screens they may see.
    private = f["kind"] in ("checkin", "checkout", "odometer_start", "odometer_end") or "/Attendance/" in f["path"] or f["path"].startswith("Travel/")
    if private and not is_staff(user) and f.get("uploaded_by") != user["id"]:
        raise HTTPException(403, "Not allowed")
    if f["kind"] == "hr_document" and not is_staff(user):
        owner = db.one("SELECT user_id FROM hr_documents WHERE file_id = ?", file_id)
        if not owner or owner["user_id"] != user["id"]:
            raise HTTPException(403, "Not your document")
    headers = {"X-SHA256": f["sha256"]}
    if download:
        headers["Content-Disposition"] = f'attachment; filename="{f["name"]}"'
    if not (FILES_DIR / f["path"]).exists():
        store.get(f["path"])  # live server: fetch from SharePoint into the local cache (the disk is temporary)
    return FileResponse(FILES_DIR / f["path"], media_type=f["mime"], headers=headers)


app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="frontend")
