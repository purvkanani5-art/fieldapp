"""HR operations around attendance and the people side, now that pay lives in Zoho Payroll.

Zoho does payroll, PF, ESI, PT, LWF, TDS, Form 16 and salary payment. Kshetralekha keeps the attendance and leave
behind them and hands Zoho one approved, locked file a month:

- month end: managers confirm their team's month, HR approves and locks it; a snapshot is kept and every write that
  would change a locked month (corrections, leave, exceptions, muster) is refused until an admin unlocks it;
- export per employee for Zoho: paid days, loss-of-pay days, half days, overtime, leave taken by type, late marks,
  advance recovery (CSV, a short LOP-only CSV, and JSON for an API pull);
- change log: who changed attendance, leave, balances, settings or assignments, when, old and new value, why;
- registers to print or download: monthly muster roll and the leave register (CSV and PDF);
- supervisor muster: a supervisor marks a crew without phones (P / H / A, overtime) with one geotagged crew photo;
- complaints: a tracking code for anonymous senders (they read HR's reply and write back), a POSH category that
  only the Internal Committee sees, and the POSH notice on the complaint screen;
- surveys with eNPS (anonymous answers, results only from 3 responses);
- notice board with read receipts and "I have read this" for important notices.
"""

import csv
import hashlib
import io
import json
import secrets
from collections.abc import Callable
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from starlette.datastructures import UploadFile as FormFile

import modules
from db import Db, now_iso
from modules import attendance_month, leave_balances, local_today, num, profile_data, setting, team_ids, user_name

SCHEMA = """
CREATE TABLE IF NOT EXISTS change_log (
  id TEXT PRIMARY KEY, at TEXT NOT NULL, by_id TEXT, entity TEXT NOT NULL, entity_id TEXT, subject_id TEXT,
  field TEXT DEFAULT '', old TEXT DEFAULT '', new TEXT DEFAULT '', reason TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_change_subject ON change_log (subject_id, at);
CREATE TABLE IF NOT EXISTS att_periods (
  id TEXT PRIMARY KEY, month TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'open', locked_by TEXT, locked_at TEXT,
  unlocked_by TEXT, unlocked_at TEXT, unlock_reason TEXT DEFAULT '', snapshot TEXT
);
CREATE TABLE IF NOT EXISTS att_reviews (id TEXT PRIMARY KEY, month TEXT NOT NULL, manager_id TEXT NOT NULL, at TEXT NOT NULL, note TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS muster_sheets (
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL, date TEXT NOT NULL, marked_by TEXT, file_id TEXT, lat REAL, lng REAL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_muster_site ON muster_sheets (site_id, date);
CREATE TABLE IF NOT EXISTS muster_lines (
  id TEXT PRIMARY KEY, sheet_id TEXT NOT NULL, user_id TEXT, worker_name TEXT DEFAULT '', contractor TEXT DEFAULT '', code TEXT NOT NULL,
  ot_hours REAL DEFAULT 0, note TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_muster_user ON muster_lines (user_id);
CREATE TABLE IF NOT EXISTS feedback_msgs (id TEXT PRIMARY KEY, feedback_id TEXT NOT NULL, from_hr INTEGER DEFAULT 0, by_id TEXT, text TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS surveys (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, intro TEXT DEFAULT '', questions TEXT NOT NULL, anonymous INTEGER DEFAULT 1, audience TEXT NOT NULL DEFAULT '{"type":"all"}',
  closes_on TEXT, status TEXT NOT NULL DEFAULT 'open', created_by TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS survey_done (id TEXT PRIMARY KEY, survey_id TEXT NOT NULL, user_id TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS survey_answers (id TEXT PRIMARY KEY, survey_id TEXT NOT NULL, user_id TEXT, project TEXT DEFAULT '', answers TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notices (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, audience TEXT NOT NULL DEFAULT '{"type":"all"}', important INTEGER DEFAULT 0, pinned INTEGER DEFAULT 0,
  created_by TEXT, created_at TEXT NOT NULL, expires_on TEXT
);
CREATE TABLE IF NOT EXISTS notice_reads (id TEXT PRIMARY KEY, notice_id TEXT NOT NULL, user_id TEXT NOT NULL, read_at TEXT NOT NULL, ack_at TEXT);
CREATE INDEX IF NOT EXISTS idx_notice_reads ON notice_reads (notice_id, user_id);
"""

MIGRATIONS = [
    "ALTER TABLE users ADD COLUMN app_access INTEGER DEFAULT 1",
    "ALTER TABLE users ADD COLUMN supervisor INTEGER DEFAULT 0",
    "ALTER TABLE feedback ADD COLUMN track_hash TEXT",
    "ALTER TABLE feedback ADD COLUMN category TEXT DEFAULT ''",
]

DEFAULTS = {
    "posh": {
        "committee": [],  # filled by the demo / HR: {"name", "role", "user_id", "phone"}
        "local_committee": "District Officer (Local Committee) of your district",
        "email": "ic@company.example",
    },
}

CATEGORIES = {"workplace": "Work and behaviour", "safety": "Safety and facilities", "pay_leave": "Pay, leave and attendance", "posh": "Sexual harassment (POSH)", "other": "Other"}
LEAVE_COLS = ("Casual", "Sick", "Earned", "Unpaid")


def init(db: Db) -> None:
    db.con.executescript(SCHEMA)
    for sql in MIGRATIONS:
        try:
            db.con.execute(sql)
        except Exception:  # noqa: BLE001 - column already there
            pass
    db.con.commit()
    for k, v in DEFAULTS.items():
        if db.setting(k) is None:
            db.set_setting(k, v)


# ------------------------------------------------------------------ change log


def log_change(db: Db, by: str | None, entity: str, entity_id: str | None, subject: str | None, field: str, old, new, reason: str = "") -> None:
    def s(v) -> str:
        if v is None:
            return ""
        return v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)
    if s(old) == s(new):
        return
    db.insert("change_log", {"at": now_iso(), "by_id": by, "entity": entity, "entity_id": entity_id, "subject_id": subject, "field": field,
                             "old": s(old)[:1000], "new": s(new)[:1000], "reason": str(reason or "")[:500]})


def log_dict(db: Db, by: str | None, entity: str, entity_id: str | None, subject: str | None, old: dict, new: dict, labels: dict, reason: str = "") -> int:
    n = 0
    for k, label in labels.items():
        if k in new and str(old.get(k, "") or "") != str(new.get(k, "") or ""):
            log_change(db, by, entity, entity_id, subject, label, old.get(k, ""), new.get(k, ""), reason)
            n += 1
    return n


def day_text(db: Db, uid: str, day: str) -> str:
    """One day of someone's attendance as text, for the change log (e.g. 'A', 'P 08:40-17:30')."""
    d = next((x for x in attendance_month(db, uid, day[:7])["days"] if x["date"] == day), None)
    if not d:
        return ""
    return d["code"] + (f" {d['in']}-{d['out']}" if d.get("in") else "") + (f" ({d['note']})" if d.get("note") else "")


# ------------------------------------------------------------------ month end: review, approve and lock


def month_label(month: str) -> str:
    return datetime.strptime(month, "%Y-%m").strftime("%B %Y")


def period(db: Db, month: str) -> dict | None:
    return db.one("SELECT * FROM att_periods WHERE month = ?", month)


def is_locked(db: Db, month: str) -> bool:
    p = period(db, month)
    return bool(p and p["status"] == "locked")


def assert_open(db: Db, *days: str) -> None:
    """Refuse a change to a locked month. Takes ISO dates (or months); ranges are passed as their first and last day."""
    seen = set()
    for d in days:
        if not d:
            continue
        m = str(d)[:7]
        if m in seen:
            continue
        seen.add(m)
        if is_locked(db, m):
            raise HTTPException(409, f"Attendance for {month_label(m)} is approved and locked (sent to Zoho Payroll). Ask HR to unlock it first.")


def assert_range_open(db: Db, fd: str, td: str) -> None:
    a, b = date.fromisoformat(fd[:10]), date.fromisoformat(td[:10])
    months, d = set(), a.replace(day=1)
    while d <= b:
        months.add(d.strftime("%Y-%m"))
        d = (d + timedelta(days=32)).replace(day=1)
    assert_open(db, *sorted(months))


def advance_recovery(db: Db, uid: str, month: str) -> float:
    """Monthly instalment of approved advances that fall in this month (first instalment the month after approval)."""
    total = 0.0
    y, m = int(month[:4]), int(month[5:7])
    for r in db.all("SELECT data, updated_at FROM records WHERE kind = 'advance' AND user_id = ? AND status = 'approved'", uid):
        d = json.loads(r["data"])
        n = max(1, int(num(d.get("recover_months"), 1)))
        ad = date.fromisoformat(r["updated_at"][:10])
        since = (y * 12 + m) - (ad.year * 12 + ad.month)
        if 1 <= since <= n:
            total += round(num(d.get("amount")) / n)
    return total


def export_rows(db: Db, month: str) -> list[dict]:
    """One row per employee for Zoho Payroll, worked out live from attendance, leave, corrections and muster."""
    y, m = int(month[:4]), int(month[5:7])
    import calendar

    days_in = calendar.monthrange(y, m)[1]
    out = []
    for u in db.all("SELECT id, employee_id, name, designation, role, app_access FROM users WHERE active = 1 ORDER BY employee_id"):
        res = attendance_month(db, u["id"], month)
        t = res["totals"]
        leave = dict.fromkeys(LEAVE_COLS, 0.0)
        for d in res["days"]:
            if d["code"] == "L":
                leave[d["note"] if d["note"] in leave else "Casual"] += 1
        lop = t["A"] + t["unpaid"] + 0.5 * t["H"]
        out.append({"user_id": u["id"], "employee_id": u["employee_id"], "name": u["name"], "designation": u["designation"], "days": days_in,
                    "paid_days": max(0.0, days_in - lop), "lop_days": lop, "present": t["P"], "half_days": t["H"], "absent": t["A"],
                    "weekly_off": t["WO"], "holidays": t["HO"], "leave": leave, "ot_hours": t["ot_hours"], "late": t["late"], "missed_checkout": t["MC"],
                    "advance_recovery": advance_recovery(db, u["id"], month), "by_supervisor": not u["app_access"],
                    "not_yet": sum(1 for d in res["days"] if d["code"] == "--")})
    return out


def month_rows(db: Db, month: str) -> tuple[list[dict], bool]:
    p = period(db, month)
    if p and p["status"] == "locked" and p["snapshot"]:
        return json.loads(p["snapshot"]), True
    return export_rows(db, month), False


def month_checks(db: Db, month: str, rows: list[dict]) -> list[dict]:
    """Things to sort out before locking."""
    first, last = f"{month}-01", f"{month}-31"
    out = []
    mc = [r for r in rows if r["missed_checkout"]]
    if mc:
        out.append({"tone": "warn", "text": f"{sum(r['missed_checkout'] for r in mc)} missed check-out(s): {', '.join(r['name'] for r in mc[:4])}",
                    "hint": "Counted as present. Ask for an attendance correction if the hours matter.", "link": "#attsum"})
    pend_reg = db.one("SELECT COUNT(*) AS n FROM records WHERE kind = 'regularisation' AND status = 'pending' AND json_extract(data, '$.date') BETWEEN ? AND ?", first, last)["n"]
    if pend_reg:
        out.append({"tone": "bad", "text": f"{pend_reg} attendance correction(s) waiting for approval", "hint": "Decide them first or the days stay as they are.", "link": "#approvals"})
    pend_lv = db.one("SELECT COUNT(*) AS n FROM leaves WHERE status = 'pending' AND from_date <= ? AND to_date >= ?", last, first)["n"]
    if pend_lv:
        out.append({"tone": "bad", "text": f"{pend_lv} leave request(s) in this month not decided", "hint": "Undecided leave counts as absent (loss of pay).", "link": "#approvals"})
    pend_att = db.one("SELECT COUNT(*) AS n FROM attendance WHERE status = 'pending' AND substr(checkin_at, 1, 7) = ?", month)["n"]
    if pend_att:
        out.append({"tone": "warn", "text": f"{pend_att} check-in exception(s) not decided", "hint": "Away-from-site check-ins still count as present until rejected.", "link": "#approvals"})
    ab = [r for r in rows if r["absent"]]
    if ab:
        out.append({"tone": "info", "text": f"{sum(r['absent'] for r in ab):g} absent day(s) without leave across {len(ab)} people", "hint": "These become loss-of-pay days in Zoho.", "link": "#attsum"})
    return out


def managers_for_month(db: Db) -> list[dict]:
    return db.all("SELECT id, name, designation FROM users WHERE role = 'manager' AND active = 1 ORDER BY name")


# ------------------------------------------------------------------ audiences (notices and surveys)


def user_projects_of(db: Db, uid: str) -> set[str]:
    p = {r["project_type"] for r in db.all("SELECT s.project_type FROM user_sites us JOIN sites s ON s.id = us.site_id WHERE us.user_id = ?", uid)}
    p |= {r["project"] for r in db.all("SELECT project FROM user_projects WHERE user_id = ?", uid)}
    return p


def in_audience(db: Db, uid: str, aud: dict) -> bool:
    t = aud.get("type", "all")
    if t == "all":
        return True
    if t == "project":
        return aud.get("value") in user_projects_of(db, uid)
    if t == "site":
        if db.one("SELECT 1 FROM user_sites WHERE user_id = ? AND site_id = ?", uid, aud.get("value")):
            return True
        s = db.one("SELECT project_type FROM sites WHERE id = ?", aud.get("value"))
        return bool(s and db.one("SELECT 1 FROM user_projects WHERE user_id = ? AND project = ?", uid, s["project_type"]))
    return False


def audience_users(db: Db, aud: dict) -> list[dict]:
    return [u for u in db.all("SELECT id, name, role, designation FROM users WHERE active = 1 AND COALESCE(app_access, 1) = 1 ORDER BY name") if in_audience(db, u["id"], aud)]


def audience_text(db: Db, aud: dict) -> str:
    t = aud.get("type", "all")
    if t == "project":
        return modules.PROJECTS.get(aud.get("value"), {}).get("name", aud.get("value", ""))
    if t == "site":
        s = db.one("SELECT name FROM sites WHERE id = ?", aud.get("value"))
        return s["name"] if s else "a site"
    return "Everyone"


def main_project(db: Db, uid: str) -> str:
    p = sorted(user_projects_of(db, uid) - {"office"})
    return p[0] if p else "office"


# ------------------------------------------------------------------ complaints


def new_code() -> str:
    a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "KL-" + "".join(secrets.choice(a) for _ in range(4)) + "-" + "".join(secrets.choice(a) for _ in range(4))


def code_hash(code: str) -> str:
    return hashlib.sha256(code.strip().upper().replace(" ", "").encode()).hexdigest()


def ic_members(db: Db) -> list[dict]:
    return (db.setting("posh") or {}).get("committee", [])


def on_ic(db: Db, user: dict) -> bool:
    return any(m.get("user_id") == user["id"] for m in ic_members(db))


def thread(db: Db, fid: str) -> list[dict]:
    rows = db.all("SELECT m.*, u.name AS by_name FROM feedback_msgs m LEFT JOIN users u ON u.id = m.by_id WHERE feedback_id = ? ORDER BY at", fid)
    for r in rows:
        if not r["from_hr"]:
            r["by_name"] = ""  # the sender's own messages never carry a name (anonymous items)
    return rows


# ------------------------------------------------------------------ surveys


def enps(scores: list[float]) -> dict:
    n = len(scores)
    if not n:
        return {"n": 0, "score": None, "promoters": 0, "passives": 0, "detractors": 0, "dist": [0] * 11}
    pro = sum(1 for s in scores if s >= 9)
    det = sum(1 for s in scores if s <= 6)
    dist = [0] * 11
    for s in scores:
        dist[max(0, min(10, int(s)))] += 1
    return {"n": n, "score": round((pro - det) / n * 100), "promoters": pro, "passives": n - pro - det, "detractors": det, "dist": dist}


MIN_RESPONSES = 3


def survey_results(db: Db, s: dict) -> dict:
    qs = json.loads(s["questions"])
    answers = [json.loads(a["answers"]) | {"_project": a["project"]} for a in db.all("SELECT answers, project FROM survey_answers WHERE survey_id = ?", s["id"])]
    n = len(answers)
    out = {"n": n, "hidden": n < MIN_RESPONSES, "questions": []}
    if out["hidden"]:
        return out
    for i, q in enumerate(qs):
        vals = [a.get(str(i)) for a in answers if a.get(str(i)) not in (None, "")]
        r: dict = {"q": q, "n": len(vals)}
        if q["type"] == "enps":
            r["enps"] = enps([num(v) for v in vals])
            by = {}
            for p in sorted({a["_project"] for a in answers}):
                pv = [num(a.get(str(i))) for a in answers if a["_project"] == p and a.get(str(i)) not in (None, "")]
                if len(pv) >= MIN_RESPONSES:
                    by[modules.PROJECTS.get(p, {}).get("name", "Head office")] = enps(pv)["score"]
            r["byProject"] = by
        elif q["type"] == "rating":
            nums = [num(v) for v in vals]
            r["avg"] = round(sum(nums) / len(nums), 2) if nums else None
            r["dist"] = [sum(1 for v in nums if int(v) == k) for k in range(1, 6)]
        elif q["type"] == "choice":
            r["counts"] = {o: sum(1 for v in vals if v == o) for o in q.get("options", [])}
        else:
            r["comments"] = [str(v) for v in vals][-40:]
        out["questions"].append(r)
    return out


# ------------------------------------------------------------------ registers (PDF)


def muster_pdf(company: str, month: str, rows: list[dict], codes: dict, site: str) -> bytes:
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas

    import calendar

    y, m = int(month[:4]), int(month[5:7])
    nd = calendar.monthrange(y, m)[1]
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=landscape(A4))
    w, h = landscape(A4)
    cw = 6.2 * mm
    x0 = 12 * mm + 52 * mm

    def head():
        c.setFont("Helvetica-Bold", 13)
        c.drawString(12 * mm, h - 14 * mm, f"{company} · Muster roll (monthly attendance register)")
        c.setFont("Helvetica", 9)
        c.drawString(12 * mm, h - 20 * mm, f"{month_label(month)} · {site} · P present, H half day, L leave, A absent, WO weekly off, HO holiday, MC missed check-out")
        c.setFont("Helvetica-Bold", 7)
        c.drawString(12 * mm, h - 28 * mm, "Employee")
        for i in range(nd):
            c.drawCentredString(x0 + i * cw + cw / 2, h - 28 * mm, str(i + 1))
        for j, t in enumerate(("Paid", "LOP", "OT h")):
            c.drawCentredString(x0 + nd * cw + j * 11 * mm + 5 * mm, h - 28 * mm, t)

    head()
    yy = h - 34 * mm
    for r in rows:
        if yy < 14 * mm:
            c.showPage()
            head()
            yy = h - 34 * mm
        c.setFont("Helvetica", 7.2)
        c.drawString(12 * mm, yy, f"{r['employee_id']}  {r['name']}"[:38])
        for i, cd in enumerate(codes.get(r["user_id"], [])):
            c.drawCentredString(x0 + i * cw + cw / 2, yy, "" if cd == "--" else cd)
        c.drawCentredString(x0 + nd * cw + 5 * mm, yy, f"{r['paid_days']:g}")
        c.drawCentredString(x0 + nd * cw + 16 * mm, yy, f"{r['lop_days']:g}")
        c.drawCentredString(x0 + nd * cw + 27 * mm, yy, f"{r['ot_hours']:g}")
        c.setStrokeGray(0.85)
        c.line(12 * mm, yy - 1.8 * mm, w - 12 * mm, yy - 1.8 * mm)
        yy -= 5.6 * mm
    c.setFont("Helvetica", 7)
    c.drawString(12 * mm, 8 * mm, f"Made by Kshetralekha on {datetime.now():%d %b %Y %H:%M}. Signature of employer / manager: ____________________")
    c.save()
    return buf.getvalue()


def leave_pdf(company: str, year: int, rows: list[dict]) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    w, h = A4

    def head():
        c.setFont("Helvetica-Bold", 13)
        c.drawString(14 * mm, h - 16 * mm, f"{company} · Leave register {year}")
        c.setFont("Helvetica", 8.5)
        c.drawString(14 * mm, h - 22 * mm, "Opening + accrued − taken − pending = balance, per leave type; then each leave taken")

    head()
    yy = h - 32 * mm
    for r in rows:
        need = (len(r["balances"]) + len(r["leaves"]) + 3) * 4.6 * mm
        if yy - need < 14 * mm:
            c.showPage()
            head()
            yy = h - 32 * mm
        c.setFont("Helvetica-Bold", 9.5)
        c.drawString(14 * mm, yy, f"{r['employee_id']} · {r['name']}  {r['designation'] or ''}")
        yy -= 5 * mm
        c.setFont("Helvetica-Bold", 7.5)
        for j, t in enumerate(("Type", "Opening", "Accrued", "Taken", "Pending", "Balance")):
            c.drawString(18 * mm + j * 26 * mm, yy, t)
        yy -= 4.4 * mm
        c.setFont("Helvetica", 7.5)
        for b in r["balances"]:
            vals = (b["type"], f"{b['opening']:g}", f"{b['accrued']:g}", f"{b['used']:g}", f"{b['pending']:g}", "–" if b["available"] is None else f"{b['available']:g}")
            for j, t in enumerate(vals):
                c.drawString(18 * mm + j * 26 * mm, yy, t)
            yy -= 4.4 * mm
        for lv in r["leaves"]:
            c.drawString(22 * mm, yy, f"{lv['from_date']} to {lv['to_date']} · {lv['type']} · {lv['days']:g} day(s) · {lv['status']} {('· ' + lv['reason']) if lv['reason'] else ''}"[:120])
            yy -= 4.4 * mm
        c.setStrokeGray(0.8)
        c.line(14 * mm, yy + 1 * mm, w - 14 * mm, yy + 1 * mm)
        yy -= 4 * mm
    c.save()
    return buf.getvalue()


# ------------------------------------------------------------------ router


def make_router(user_dep: Any, db_dep: Any, *, save_upload: Callable, is_staff: Callable[[dict], bool], site_allowed: Callable[[dict, str], bool], demo: bool) -> APIRouter:
    r = APIRouter(prefix="/api")

    def hr_only(user: dict) -> None:
        if user["role"] not in ("admin", "hr"):
            raise HTTPException(403, "HR only")

    def csv_resp(rows: list[list], name: str) -> Response:
        buf = io.StringIO()
        csv.writer(buf).writerows(rows)
        return Response("﻿" + buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{name}"'})

    def check_month(month: str) -> str:
        try:
            datetime.strptime(month, "%Y-%m")
        except ValueError as e:
            raise HTTPException(422, "Month must look like 2026-11") from e
        return month

    # -------------------------------------------------------------- month end

    @r.get("/hr/month/{month}")
    def month_view(month: str, user: user_dep, db: db_dep):
        if not is_staff(user):
            raise HTTPException(403, "Managers and HR only")
        check_month(month)
        modules.close_missed_checkouts(db)
        rows, frozen = month_rows(db, month)
        team = team_ids(db, user)
        if team is not None:
            rows = [x for x in rows if x["user_id"] in team]
        p = period(db, month)
        reviews = {x["manager_id"]: x for x in db.all("SELECT * FROM att_reviews WHERE month = ?", month)}
        mgrs = [{**m, "reviewed_at": reviews.get(m["id"], {}).get("at"), "note": reviews.get(m["id"], {}).get("note", "")} for m in managers_for_month(db)]
        over = month < local_today().strftime("%Y-%m")
        locked_name = user_name(db, p["locked_by"]) if p and p["locked_by"] else ""
        return {"month": month, "label": month_label(month), "status": p["status"] if p else "open", "locked_at": p["locked_at"] if p else None, "locked_by": locked_name,
                "unlock_reason": p["unlock_reason"] if p else "", "unlocked_by": user_name(db, p["unlocked_by"]) if p and p["unlocked_by"] else "",
                "frozen": frozen, "over": over, "rows": rows, "checks": [] if frozen else month_checks(db, month, rows), "managers": mgrs,
                "canLock": user["role"] in ("admin", "hr"), "canUnlock": user["role"] == "admin", "iReviewed": user["id"] in reviews}

    @r.post("/hr/month/{month}/review")
    def month_review(month: str, payload: dict, user: user_dep, db: db_dep):
        if user["role"] != "manager":
            raise HTTPException(403, "Project managers confirm their team's month")
        check_month(month)
        if is_locked(db, month):
            raise HTTPException(409, "Already locked")
        db.run("DELETE FROM att_reviews WHERE month = ? AND manager_id = ?", month, user["id"])
        db.insert("att_reviews", {"month": month, "manager_id": user["id"], "at": now_iso(), "note": str(payload.get("note", ""))[:300]})
        log_change(db, user["id"], "attendance_month", month, None, "Team attendance confirmed", "", f"{month_label(month)} by {user['name']}", payload.get("note", ""))
        db.notify_role(("hr",), f"{user['name']} confirmed {month_label(month)} attendance", "Ready for HR to approve and lock", f"#monthend/{month}")
        return {"ok": True}

    @r.post("/hr/month/{month}/lock")
    def month_lock(month: str, user: user_dep, db: db_dep):
        hr_only(user)
        check_month(month)
        if month >= local_today().strftime("%Y-%m"):
            raise HTTPException(422, "A month can be locked only after it is over")
        if is_locked(db, month):
            raise HTTPException(409, "Already locked")
        rows = export_rows(db, month)
        p = period(db, month)
        patch = {"status": "locked", "locked_by": user["id"], "locked_at": now_iso(), "snapshot": json.dumps(rows)}
        if p:
            db.update("att_periods", p["id"], patch)
        else:
            db.insert("att_periods", {"month": month, **patch})
        log_change(db, user["id"], "attendance_month", month, None, "Month status", "open", "approved and locked", f"{len(rows)} employees, {sum(x['lop_days'] for x in rows):g} LOP days")
        db.audit(user["id"], "attendance_locked", "attendance_month", month, "")
        db.notify_role(("admin", "manager"), f"{month_label(month)} attendance locked", f"by {user['name']} · export ready for Zoho Payroll", f"#monthend/{month}")
        return {"ok": True, "count": len(rows)}

    @r.post("/hr/month/{month}/unlock")
    def month_unlock(month: str, payload: dict, user: user_dep, db: db_dep):
        if user["role"] != "admin":
            raise HTTPException(403, "Only the director (admin) can unlock a month")
        reason = str(payload.get("reason", "")).strip()
        if len(reason) < 5:
            raise HTTPException(422, "Say why it is being unlocked")
        p = period(db, month)
        if not p or p["status"] != "locked":
            raise HTTPException(409, "Not locked")
        db.update("att_periods", p["id"], {"status": "open", "unlocked_by": user["id"], "unlocked_at": now_iso(), "unlock_reason": reason[:300], "snapshot": None})
        db.run("DELETE FROM att_reviews WHERE month = ?", month)
        log_change(db, user["id"], "attendance_month", month, None, "Month status", "approved and locked", "unlocked", reason)
        db.notify_role(("hr",), f"{month_label(month)} attendance unlocked", reason, f"#monthend/{month}")
        return {"ok": True}

    def export_guard(user: dict, db: Db, month: str) -> list[dict]:
        hr_only(user)
        check_month(month)
        return month_rows(db, month)[0]

    @r.get("/hr/month/{month}/zoho.csv")
    def zoho_csv(month: str, user: user_dep, db: db_dep):
        rows = export_guard(user, db, month)
        head = ["Employee ID", "Employee Name", "Month", "Days in Month", "Paid Days", "LOP Days", "Present Days", "Half Days", "Weekly Offs", "Holidays",
                *[f"{t} Leave" for t in LEAVE_COLS], "Overtime Hours", "Late Marks", "Advance Recovery", "Locked"]
        locked = "Yes" if is_locked(db, month) else "No (draft)"
        return csv_resp([head, *[[x["employee_id"], x["name"], month, x["days"], f"{x['paid_days']:g}", f"{x['lop_days']:g}", x["present"], x["half_days"], x["weekly_off"],
                                  x["holidays"], *[f"{x['leave'][t]:g}" for t in LEAVE_COLS], f"{x['ot_hours']:g}", x["late"], f"{x['advance_recovery']:.0f}", locked] for x in rows]],
                        f"zoho-attendance-{month}.csv")

    @r.get("/hr/month/{month}/zoho-lop.csv")
    def zoho_lop(month: str, user: user_dep, db: db_dep):
        rows = export_guard(user, db, month)
        return csv_resp([["Employee ID", "Employee Name", "LOP Days"], *[[x["employee_id"], x["name"], f"{x['lop_days']:g}"] for x in rows]], f"zoho-lop-{month}.csv")

    @r.get("/hr/month/{month}/export.json")
    def month_json(month: str, user: user_dep, db: db_dep):
        """For a scheduled pull (Zoho Flow / Deluge) once the API is opened to Zoho."""
        rows = export_guard(user, db, month)
        return {"month": month, "locked": is_locked(db, month), "employees": [{k: v for k, v in x.items() if k != "user_id"} for x in rows]}

    # -------------------------------------------------------------- registers

    @r.get("/hr/registers/muster/{month}.{fmt}")
    def muster_register(month: str, fmt: str, user: user_dep, db: db_dep, siteId: str = ""):
        if not is_staff(user):
            raise HTTPException(403, "Managers and HR only")
        check_month(month)
        rows, _ = month_rows(db, month)
        team = team_ids(db, user)
        site = "All sites"
        if siteId:
            if not site_allowed(user, siteId):
                raise HTTPException(404, "Not found")
            members = {x["user_id"] for x in db.all("SELECT user_id FROM user_sites WHERE site_id = ?", siteId)}
            rows = [x for x in rows if x["user_id"] in members]
            site = (db.one("SELECT name FROM sites WHERE id = ?", siteId) or {}).get("name", "")
        if team is not None:
            rows = [x for x in rows if x["user_id"] in team]
        codes = {x["user_id"]: [d["code"] for d in attendance_month(db, x["user_id"], month)["days"]] for x in rows}
        company = (db.setting("company") or {}).get("name", "")
        if fmt == "pdf":
            return Response(muster_pdf(company, month, rows, codes, site), media_type="application/pdf",
                            headers={"Content-Disposition": f'attachment; filename="muster-roll-{month}.pdf"'})
        nd = len(next(iter(codes.values()), []))
        out = [["Employee ID", "Name", "Designation", *[str(i + 1) for i in range(nd)], "Present", "Half days", "Leave", "Absent", "Weekly off", "Holidays", "Paid days", "LOP days", "OT hours"]]
        for x in rows:
            out.append([x["employee_id"], x["name"], x["designation"], *[("" if c == "--" else c) for c in codes[x["user_id"]]], x["present"], x["half_days"],
                        f"{sum(x['leave'].values()):g}", x["absent"], x["weekly_off"], x["holidays"], f"{x['paid_days']:g}", f"{x['lop_days']:g}", f"{x['ot_hours']:g}"])
        # contract workers marked on the crew muster (they are not employees; also see the contract labour register)
        lab = db.all("SELECT l.worker_name, l.contractor, s.date, l.code, s.site_id FROM muster_lines l JOIN muster_sheets s ON s.id = l.sheet_id "
                     "WHERE l.user_id IS NULL AND substr(s.date, 1, 7) = ?" + (" AND s.site_id = ?" if siteId else "") + " ORDER BY l.worker_name, s.date", month, *([siteId] if siteId else []))
        if lab:
            out.append([])
            out.append(["Contract workers (crew muster)", "Contractor", "Site", *[str(i + 1) for i in range(nd)], "Days"])
            by: dict = {}
            for x in lab:
                k = (x["worker_name"], x["contractor"], x["site_id"])
                by.setdefault(k, [""] * nd)[int(x["date"][8:10]) - 1] = x["code"]
            for (wn, ct, sid), cs in by.items():
                out.append([wn, ct, (db.one("SELECT name FROM sites WHERE id = ?", sid) or {}).get("name", ""), *cs, f"{sum(1 if c == 'P' else 0.5 if c == 'H' else 0 for c in cs):g}"])
        return csv_resp(out, f"muster-roll-{month}.csv")

    @r.get("/hr/registers/leave/{year}.{fmt}")
    def leave_register(year: int, fmt: str, user: user_dep, db: db_dep):
        if not is_staff(user):
            raise HTTPException(403, "Managers and HR only")
        team = team_ids(db, user)
        rows = []
        for u in db.all("SELECT id, employee_id, name, designation FROM users WHERE active = 1 ORDER BY employee_id"):
            if team is not None and u["id"] not in team:
                continue
            lvs = db.all("SELECT from_date, to_date, type, status, reason FROM leaves WHERE user_id = ? AND substr(from_date, 1, 4) = ? ORDER BY from_date", u["id"], str(year))
            for lv in lvs:
                lv["days"] = modules.leave_days(db, lv["from_date"], lv["to_date"])
            rows.append({**u, "balances": leave_balances(db, u["id"], year), "leaves": lvs})
        company = (db.setting("company") or {}).get("name", "")
        if fmt == "pdf":
            return Response(leave_pdf(company, year, rows), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="leave-register-{year}.pdf"'})
        out = [["Employee ID", "Name", "Leave type", "Opening", "Accrued", "Taken", "Pending", "Balance", "Leave taken (dates)"]]
        for x in rows:
            for b in x["balances"]:
                taken = "; ".join(f"{lv['from_date']}–{lv['to_date']} ({lv['days']:g}, {lv['status']})" for lv in x["leaves"] if lv["type"] == b["type"])
                out.append([x["employee_id"], x["name"], b["type"], f"{b['opening']:g}", f"{b['accrued']:g}", f"{b['used']:g}", f"{b['pending']:g}",
                            "" if b["available"] is None else f"{b['available']:g}", taken])
        return csv_resp(out, f"leave-register-{year}.csv")

    # -------------------------------------------------------------- change log

    def change_rows(db: Db, user: dict, subject: str, entity: str, limit: int) -> list[dict]:
        sql, args = "SELECT c.*, b.name AS by_name, s.name AS subject_name FROM change_log c LEFT JOIN users b ON b.id = c.by_id LEFT JOIN users s ON s.id = c.subject_id WHERE 1 = 1", []
        if subject:
            sql += " AND c.subject_id = ?"
            args.append(subject)
        if entity:
            sql += " AND c.entity = ?"
            args.append(entity)
        rows = db.all(sql + " ORDER BY c.at DESC LIMIT ?", *args, limit)
        if user["role"] in ("admin", "hr"):
            return rows
        if is_staff(user):
            team = team_ids(db, user) or set()
            return [x for x in rows if x["subject_id"] in team or x["by_id"] == user["id"] or (not x["subject_id"] and x["entity"] == "attendance_month")]
        return [x for x in rows if x["subject_id"] == user["id"]]

    @r.get("/hr/changes")
    def changes(user: user_dep, db: db_dep, subject: str = "", entity: str = "", limit: int = 300):
        if subject == "me":
            subject = user["id"]
        return {"rows": change_rows(db, user, subject, entity, min(limit, 2000))}

    @r.get("/hr/changes.csv")
    def changes_csv(user: user_dep, db: db_dep, subject: str = "", entity: str = ""):
        rows = change_rows(db, user, subject, entity, 5000)
        return csv_resp([["When (UTC)", "Changed by", "Employee", "What", "Field", "Old value", "New value", "Reason"],
                         *[[x["at"], x["by_name"] or "system", x["subject_name"] or "", x["entity"], x["field"], x["old"], x["new"], x["reason"]] for x in rows]],
                        "change-log.csv")

    # -------------------------------------------------------------- supervisor muster

    def may_muster(db: Db, user: dict, sid: str) -> bool:
        if is_staff(user):
            return site_allowed(user, sid)
        u = db.one("SELECT supervisor FROM users WHERE id = ?", user["id"])
        return bool(u and u["supervisor"]) and sid in (user.get("direct_sites") or user["sites"])

    @r.get("/muster/{sid}")
    def muster_get(sid: str, user: user_dep, db: db_dep, day: str = ""):
        if not may_muster(db, user, sid):
            raise HTTPException(403, "Only the site supervisor or a manager can mark crew attendance")
        day = day or local_today().isoformat()
        site = db.one("SELECT id, name, project_type FROM sites WHERE id = ?", sid)
        sheet = db.one("SELECT * FROM muster_sheets WHERE site_id = ? AND date = ?", sid, day)
        lines = {(x["user_id"] or f"w:{x['worker_name']}|{x['contractor']}"): x for x in db.all("SELECT * FROM muster_lines WHERE sheet_id = ?", sheet["id"])} if sheet else {}
        people = []
        for u in db.all("SELECT u.id, u.name, u.employee_id, u.designation, COALESCE(u.app_access, 1) AS app_access FROM users u JOIN user_sites us ON us.user_id = u.id "
                        "WHERE us.site_id = ? AND u.active = 1 AND u.role = 'field' ORDER BY u.app_access, u.name", sid):
            own = db.one("SELECT checkin_at, checkout_at FROM attendance WHERE user_id = ? AND substr(checkin_at, 1, 10) BETWEEN ? AND ? ORDER BY checkin_at LIMIT 1", u["id"],
                         (date.fromisoformat(day) - timedelta(days=1)).isoformat(), day)
            own_day = own and modules.to_local(own["checkin_at"]).date().isoformat() == day
            lv = db.one("SELECT type FROM leaves WHERE user_id = ? AND status = 'approved' AND from_date <= ? AND to_date >= ?", u["id"], day, day)
            ln = lines.get(u["id"])
            state = ("own", f"Checked in {modules.to_local(own['checkin_at']):%H:%M} on own phone") if own_day else ("leave", f"On {lv['type'].lower()} leave") if lv else                 ("phone", "Uses the app: checks in on own phone") if u["app_access"] else (None, "")
            people.append({**u, "locked": state[0], "lockText": state[1], "code": ln["code"] if ln else "", "ot": ln["ot_hours"] if ln else 0, "note": ln["note"] if ln else ""})
        workers = [{"name": x["worker_name"], "contractor": x["contractor"], "code": x["code"], "ot": x["ot_hours"]} for k, x in lines.items() if k.startswith("w:")]
        if not sheet:  # suggest the contract workers from the last sheet of this site
            last = db.one("SELECT id FROM muster_sheets WHERE site_id = ? AND date < ? ORDER BY date DESC LIMIT 1", sid, day)
            if last:
                workers = [{"name": x["worker_name"], "contractor": x["contractor"], "code": "", "ot": 0} for x in db.all("SELECT * FROM muster_lines WHERE sheet_id = ? AND user_id IS NULL", last["id"])]
        recent = db.all("SELECT s.date, s.updated_at, u.name AS by_name, (SELECT COUNT(*) FROM muster_lines l WHERE l.sheet_id = s.id AND l.code IN ('P', 'H')) AS present "
                        "FROM muster_sheets s LEFT JOIN users u ON u.id = s.marked_by WHERE s.site_id = ? ORDER BY s.date DESC LIMIT 7", sid)
        return {"site": site, "date": day, "locked": is_locked(db, day[:7]), "sheet": {"file_id": sheet["file_id"], "by": user_name(db, sheet["marked_by"]), "at": sheet["updated_at"]} if sheet else None,
                "people": people, "workers": workers, "recent": recent}

    @r.post("/muster/{sid}")
    async def muster_save(sid: str, request: Request, user: user_dep, db: db_dep):
        if not may_muster(db, user, sid):
            raise HTTPException(403, "Only the site supervisor or a manager can mark crew attendance")
        form = await request.form()
        day = str(form.get("date") or local_today().isoformat())[:10]
        dd = date.fromisoformat(day)
        if dd > local_today():
            raise HTTPException(422, "Attendance cannot be marked for a future day")
        if not is_staff(user) and (local_today() - dd).days > 2:
            raise HTTPException(422, "Supervisors can mark today and the two days before; ask your manager for older days")
        assert_open(db, day)
        lines = json.loads(form.get("lines") or "[]")
        workers = json.loads(form.get("workers") or "[]")
        photo = form.get("photo")
        lat, lng = form.get("lat") or None, form.get("lng") or None
        sheet = db.one("SELECT * FROM muster_sheets WHERE site_id = ? AND date = ?", sid, day)
        fid = sheet["file_id"] if sheet else None
        if isinstance(photo, FormFile) and photo.filename:
            fid = await save_upload(db, photo, f"Muster/{day}", "muster", user, lat=num(lat, None) if lat else None, lng=num(lng, None) if lng else None, name=f"{day} crew photo.jpg")
        if not fid:
            raise HTTPException(422, "Take one photo of the crew at the site")
        # only crew without the app; people with the app check in on their own phone
        allowed = {x["user_id"] for x in db.all("SELECT us.user_id FROM user_sites us JOIN users u ON u.id = us.user_id WHERE us.site_id = ? AND COALESCE(u.app_access, 1) = 0", sid)}
        reason = str(form.get("reason") or "")
        if sheet:
            db.update("muster_sheets", sheet["id"], {"file_id": fid, "marked_by": user["id"], "updated_at": now_iso(), "lat": num(lat, None) if lat else sheet["lat"], "lng": num(lng, None) if lng else sheet["lng"]})
            sheet_id = sheet["id"]
            old = {(x["user_id"] or f"w:{x['worker_name']}"): x for x in db.all("SELECT * FROM muster_lines WHERE sheet_id = ?", sheet_id)}
            db.run("DELETE FROM muster_lines WHERE sheet_id = ?", sheet_id)
        else:
            sheet_id = db.insert("muster_sheets", {"site_id": sid, "date": day, "marked_by": user["id"], "file_id": fid, "lat": num(lat, None) if lat else None,
                                                   "lng": num(lng, None) if lng else None, "created_at": now_iso(), "updated_at": now_iso()})
            old = {}
        n = 0
        for ln in lines:
            uid, code = ln.get("user_id"), ln.get("code")
            if uid not in allowed or code not in ("P", "H", "A"):
                continue
            ot = max(0.0, min(12.0, num(ln.get("ot"))))
            db.insert("muster_lines", {"sheet_id": sheet_id, "user_id": uid, "code": code, "ot_hours": ot, "note": str(ln.get("note", ""))[:200]})
            prev = old.get(uid)
            if prev and (prev["code"] != code or num(prev["ot_hours"]) != ot):
                log_change(db, user["id"], "attendance", sheet_id, uid, f"Crew muster {day}", f"{prev['code']} OT {num(prev['ot_hours']):g}", f"{code} OT {ot:g}", reason or "muster re-marked")
            n += 1
        for w in workers:
            name = str(w.get("name", "")).strip()[:80]
            if not name or w.get("code") not in ("P", "H", "A"):
                continue
            db.insert("muster_lines", {"sheet_id": sheet_id, "user_id": None, "worker_name": name, "contractor": str(w.get("contractor", ""))[:80], "code": w["code"],
                                       "ot_hours": max(0.0, min(12.0, num(w.get("ot"))))})
            n += 1
        db.audit(user["id"], "muster_saved", "muster", sheet_id, f"{day} {n} lines")
        return {"ok": True, "count": n}

    @r.post("/hr/flags/{uid}")
    def set_flags(uid: str, payload: dict, user: user_dep, db: db_dep):
        hr_only(user)
        u = db.one("SELECT id, supervisor, COALESCE(app_access, 1) AS app_access FROM users WHERE id = ?", uid)
        if not u:
            raise HTTPException(404, "Not found")
        patch = {}
        if "supervisor" in payload:
            patch["supervisor"] = 1 if payload["supervisor"] else 0
        if "appAccess" in payload:
            patch["app_access"] = 1 if payload["appAccess"] else 0
        log_dict(db, user["id"], "employee", uid, uid, u, patch, {"supervisor": "Crew supervisor", "app_access": "Uses the app"})
        db.update("users", uid, patch)
        return {"ok": True}

    # -------------------------------------------------------------- complaints, POSH

    @r.get("/hr/posh")
    def posh(user: user_dep, db: db_dep):
        p = db.setting("posh") or {}
        return {**p, "onCommittee": on_ic(db, user), "categories": CATEGORIES}

    @r.get("/feedback")
    def feedback_list(user: user_dep, db: db_dep):
        hr, ic = user["role"] in ("admin", "hr"), on_ic(db, user)
        if hr or ic:
            rows = db.all("SELECT fb.*, u.name AS user_name FROM feedback fb LEFT JOIN users u ON u.id = fb.user_id ORDER BY fb.created_at DESC")
            rows = [x for x in rows if (ic if x["category"] == "posh" else hr)]
            for x in rows:
                if not x["user_id"]:
                    x["user_name"] = "Anonymous"
                x["thread"] = thread(db, x["id"])
                x["tracked"] = bool(x.get("track_hash"))
                x.pop("track_hash", None)
            return {"rows": rows, "ic": ic}
        rows = db.all("SELECT * FROM feedback WHERE user_id = ? ORDER BY created_at DESC", user["id"])
        for x in rows:
            x["thread"] = thread(db, x["id"])
            x.pop("track_hash", None)
        return {"rows": rows, "ic": False}

    @r.post("/feedback")
    def add_feedback(payload: dict, user: user_dep, db: db_dep):
        kind = payload.get("type")
        text = str(payload.get("text", "")).strip()
        cat = payload.get("category") or ("other" if kind == "complaint" else "")
        if kind not in ("complaint", "suggestion") or len(text) < 5:
            raise HTTPException(422, "Choose complaint or suggestion and write a few words")
        if kind == "complaint" and cat not in CATEGORIES:
            raise HTTPException(422, "Choose what the complaint is about")
        anon = bool(payload.get("anonymous"))
        code = new_code() if anon else None
        fid = db.insert("feedback", {"user_id": None if anon else user["id"], "type": kind, "text": text[:3000], "status": "open", "created_at": now_iso(),
                                     "category": cat if kind == "complaint" else "", "track_hash": code_hash(code) if code else None})
        label = f"New {kind}" + (" (anonymous)" if anon else f" from {user['name']}")
        if cat == "posh":
            for m in ic_members(db):
                if m.get("user_id"):
                    db.notify(m["user_id"], "POSH complaint for the Internal Committee", "Confidential. Open it in the Internal Committee desk.", "#poshdesk")
        else:
            db.notify_role(("hr", "admin"), label, text[:120], "#hrdesk")
        return {"id": fid, "code": code}

    def fb_or_404(db: Db, fid: str) -> dict:
        fb = db.one("SELECT * FROM feedback WHERE id = ?", fid)
        if not fb:
            raise HTTPException(404, "Not found")
        return fb

    def may_answer(db: Db, user: dict, fb: dict) -> bool:
        return on_ic(db, user) if fb["category"] == "posh" else user["role"] in ("admin", "hr")

    @r.post("/feedback/{fid}/respond")
    def respond(fid: str, payload: dict, user: user_dep, db: db_dep):
        fb = fb_or_404(db, fid)
        if not may_answer(db, user, fb):
            raise HTTPException(403, "Only HR (or the Internal Committee for POSH) can reply")
        text = str(payload.get("response", "")).strip()
        status = payload.get("status", "closed")
        if status not in ("open", "in_progress", "closed"):
            raise HTTPException(422, "Unknown status")
        if text:
            db.insert("feedback_msgs", {"feedback_id": fid, "from_hr": 1, "by_id": user["id"], "text": text[:2000], "at": now_iso()})
        db.update("feedback", fid, {"response": text[:2000] or fb["response"], "status": status, "responded_by": user["id"], "responded_at": now_iso()})
        if fb["user_id"] and text:
            db.notify(fb["user_id"], f"Reply to your {fb['type']}", text[:200], "#feedback")
        return {"ok": True}

    @r.get("/feedback/track")
    def track(code: str, user: user_dep, db: db_dep):
        fb = db.one("SELECT * FROM feedback WHERE track_hash = ?", code_hash(code))
        if not fb:
            raise HTTPException(404, "No complaint with that code. Check the letters and try again.")
        return {"id": fb["id"], "type": fb["type"], "category": fb["category"], "text": fb["text"], "status": fb["status"], "created_at": fb["created_at"], "thread": thread(db, fb["id"])}

    @r.post("/feedback/track")
    def track_reply(payload: dict, user: user_dep, db: db_dep):
        fb = db.one("SELECT * FROM feedback WHERE track_hash = ?", code_hash(str(payload.get("code", ""))))
        if not fb:
            raise HTTPException(404, "No complaint with that code")
        text = str(payload.get("text", "")).strip()
        if len(text) < 2:
            raise HTTPException(422, "Write a few words")
        db.insert("feedback_msgs", {"feedback_id": fb["id"], "from_hr": 0, "by_id": None, "text": text[:2000], "at": now_iso()})
        if fb["status"] == "closed":
            db.update("feedback", fb["id"], {"status": "open"})
        if fb["category"] == "posh":
            for m in ic_members(db):
                if m.get("user_id"):
                    db.notify(m["user_id"], "New message on a POSH complaint", "Confidential", "#poshdesk")
        else:
            db.notify_role(("hr",), "Anonymous sender replied", text[:120], "#hrdesk")
        return {"ok": True}

    # -------------------------------------------------------------- notice board

    def notice_out(db: Db, n: dict, user: dict, *, full: bool = False) -> dict:
        aud = json.loads(n["audience"])
        rd = db.one("SELECT read_at, ack_at FROM notice_reads WHERE notice_id = ? AND user_id = ?", n["id"], user["id"])
        o = {**n, "audience": aud, "audienceText": audience_text(db, aud), "by": user_name(db, n["created_by"]), "read": bool(rd), "acked": bool(rd and rd["ack_at"]),
             "forMe": in_audience(db, user["id"], aud)}
        mine = n["created_by"] == user["id"] or user["role"] in ("admin", "hr")
        if mine or (is_staff(user) and full):
            people = audience_users(db, aud)
            reads = {x["user_id"]: x for x in db.all("SELECT * FROM notice_reads WHERE notice_id = ?", n["id"])}
            o["total"] = len(people)
            o["readCount"] = sum(1 for p in people if p["id"] in reads)
            o["ackCount"] = sum(1 for p in people if p["id"] in reads and reads[p["id"]]["ack_at"])
            if full:
                o["receipts"] = [{"id": p["id"], "name": p["name"], "designation": p["designation"], "read_at": reads.get(p["id"], {}).get("read_at"),
                                  "ack_at": reads.get(p["id"], {}).get("ack_at")} for p in people]
            o["canManage"] = mine
        return o

    @r.get("/notices")
    def notices(user: user_dep, db: db_dep):
        today = local_today().isoformat()
        rows = db.all("SELECT * FROM notices ORDER BY pinned DESC, created_at DESC LIMIT 200")
        out = []
        for n in rows:
            mine = n["created_by"] == user["id"] or user["role"] in ("admin", "hr")
            if not mine and (not in_audience(db, user["id"], json.loads(n["audience"])) or (n["expires_on"] and n["expires_on"] < today)):
                continue
            out.append(notice_out(db, n, user))
        return {"rows": out, "unread": sum(1 for x in out if not x["read"] and in_audience(db, user["id"], x["audience"])),
                "toAck": sum(1 for x in out if x["important"] and not x["acked"] and in_audience(db, user["id"], x["audience"])),
                "canPost": is_staff(user)}

    @r.post("/notices")
    def notice_add(payload: dict, user: user_dep, db: db_dep):
        if not is_staff(user):
            raise HTTPException(403, "Managers and HR post notices")
        title, body = str(payload.get("title", "")).strip(), str(payload.get("body", "")).strip()
        if len(title) < 3 or len(body) < 5:
            raise HTTPException(422, "Give the notice a title and some text")
        aud = payload.get("audience") or {"type": "all"}
        if aud.get("type") not in ("all", "project", "site"):
            raise HTTPException(422, "Unknown audience")
        if user["role"] == "manager":  # managers post to their own projects or sites
            if aud["type"] == "all" or (aud["type"] == "project" and aud.get("value") not in user["projects"]) or (aud["type"] == "site" and not site_allowed(user, aud.get("value", ""))):
                raise HTTPException(403, "Managers post to their own projects or sites; HR posts to everyone")
        nid = db.insert("notices", {"title": title[:140], "body": body[:5000], "audience": json.dumps(aud), "important": 1 if payload.get("important") else 0,
                                    "pinned": 1 if payload.get("pinned") else 0, "created_by": user["id"], "created_at": now_iso(), "expires_on": payload.get("expires_on") or None})
        for p in audience_users(db, aud):
            if p["id"] != user["id"]:
                db.notify(p["id"], ("Important notice: " if payload.get("important") else "Notice: ") + title[:90], body[:120], f"#notice/{nid}")
        db.audit(user["id"], "notice_posted", "notice", nid, title[:80])
        return {"id": nid}

    @r.get("/notices/{nid}")
    def notice_get(nid: str, user: user_dep, db: db_dep):
        n = db.one("SELECT * FROM notices WHERE id = ?", nid)
        if not n or not (in_audience(db, user["id"], json.loads(n["audience"])) or n["created_by"] == user["id"] or user["role"] in ("admin", "hr") or is_staff(user)):
            raise HTTPException(404, "Not found")
        if in_audience(db, user["id"], json.loads(n["audience"])) and not db.one("SELECT 1 FROM notice_reads WHERE notice_id = ? AND user_id = ?", nid, user["id"]):
            db.insert("notice_reads", {"notice_id": nid, "user_id": user["id"], "read_at": now_iso()})
        return notice_out(db, n, user, full=True)

    @r.post("/notices/{nid}/ack")
    def notice_ack(nid: str, user: user_dep, db: db_dep):
        rd = db.one("SELECT id FROM notice_reads WHERE notice_id = ? AND user_id = ?", nid, user["id"])
        if rd:
            db.update("notice_reads", rd["id"], {"ack_at": now_iso()})
        else:
            db.insert("notice_reads", {"notice_id": nid, "user_id": user["id"], "read_at": now_iso(), "ack_at": now_iso()})
        return {"ok": True}

    @r.post("/notices/{nid}/remind")
    def notice_remind(nid: str, user: user_dep, db: db_dep):
        n = db.one("SELECT * FROM notices WHERE id = ?", nid)
        if not n or not (n["created_by"] == user["id"] or user["role"] in ("admin", "hr")):
            raise HTTPException(404, "Not found")
        reads = {x["user_id"]: x for x in db.all("SELECT * FROM notice_reads WHERE notice_id = ?", nid)}
        k = 0
        for p in audience_users(db, json.loads(n["audience"])):
            r_ = reads.get(p["id"])
            if not r_ or (n["important"] and not r_["ack_at"]):
                db.notify(p["id"], f"Reminder: please read {n['title'][:90]}", "", f"#notice/{nid}")
                k += 1
        return {"count": k}

    @r.post("/notices/{nid}/delete")
    def notice_delete(nid: str, user: user_dep, db: db_dep):
        n = db.one("SELECT * FROM notices WHERE id = ?", nid)
        if not n or not (n["created_by"] == user["id"] or user["role"] in ("admin", "hr")):
            raise HTTPException(404, "Not found")
        db.run("DELETE FROM notices WHERE id = ?", nid)
        db.run("DELETE FROM notice_reads WHERE notice_id = ?", nid)
        return {"ok": True}

    # -------------------------------------------------------------- surveys

    def survey_out(db: Db, s: dict, user: dict) -> dict:
        aud = json.loads(s["audience"])
        done = bool(db.one("SELECT 1 FROM survey_done WHERE survey_id = ? AND user_id = ?", s["id"], user["id"]))
        closed = s["status"] == "closed" or (s["closes_on"] and s["closes_on"] < local_today().isoformat())
        o = {**s, "questions": json.loads(s["questions"]), "audience": aud, "audienceText": audience_text(db, aud), "done": done, "closed": bool(closed),
             "mine": in_audience(db, user["id"], aud), "by": user_name(db, s["created_by"])}
        if user["role"] in ("admin", "hr") or s["created_by"] == user["id"]:
            o["responses"] = db.one("SELECT COUNT(*) AS n FROM survey_done WHERE survey_id = ?", s["id"])["n"]
            o["invited"] = len(audience_users(db, aud))
            o["canManage"] = True
        return o

    @r.get("/surveys")
    def surveys(user: user_dep, db: db_dep):
        rows = [survey_out(db, s, user) for s in db.all("SELECT * FROM surveys ORDER BY created_at DESC")]
        rows = [x for x in rows if x["mine"] or x.get("canManage")]
        return {"rows": rows, "todo": sum(1 for x in rows if x["mine"] and not x["done"] and not x["closed"]), "canCreate": user["role"] in ("admin", "hr")}

    @r.post("/surveys")
    def survey_add(payload: dict, user: user_dep, db: db_dep):
        hr_only(user)
        title = str(payload.get("title", "")).strip()
        qs = payload.get("questions") or []
        clean = []
        for q in qs:
            t = q.get("type")
            text = str(q.get("text", "")).strip()
            if t not in ("enps", "rating", "choice", "text") or not text:
                continue
            item = {"type": t, "text": text[:300]}
            if t == "choice":
                item["options"] = [str(o).strip()[:80] for o in q.get("options", []) if str(o).strip()][:8]
                if len(item["options"]) < 2:
                    raise HTTPException(422, f"'{text[:40]}' needs at least two options")
            clean.append(item)
        if len(title) < 3 or not clean:
            raise HTTPException(422, "Give the survey a title and at least one question")
        sid = db.insert("surveys", {"title": title[:140], "intro": str(payload.get("intro", ""))[:1000], "questions": json.dumps(clean), "anonymous": 1 if payload.get("anonymous", True) else 0,
                                    "audience": json.dumps(payload.get("audience") or {"type": "all"}), "closes_on": payload.get("closes_on") or None, "status": "open",
                                    "created_by": user["id"], "created_at": now_iso()})
        for p in audience_users(db, payload.get("audience") or {"type": "all"}):
            db.notify(p["id"], f"Survey: {title[:90]}", "Takes two minutes" + (", answers are anonymous" if payload.get("anonymous", True) else ""), f"#survey/{sid}")
        return {"id": sid}

    @r.get("/surveys/{sid}")
    def survey_get(sid: str, user: user_dep, db: db_dep):
        s = db.one("SELECT * FROM surveys WHERE id = ?", sid)
        if not s:
            raise HTTPException(404, "Not found")
        o = survey_out(db, s, user)
        if not (o["mine"] or o.get("canManage")):
            raise HTTPException(404, "Not found")
        if o.get("canManage"):
            o["results"] = survey_results(db, s)
            o["minResponses"] = MIN_RESPONSES
        return o

    @r.post("/surveys/{sid}/respond")
    def survey_respond(sid: str, payload: dict, user: user_dep, db: db_dep):
        s = db.one("SELECT * FROM surveys WHERE id = ?", sid)
        if not s:
            raise HTTPException(404, "Not found")
        o = survey_out(db, s, user)
        if not o["mine"] or o["closed"]:
            raise HTTPException(409, "This survey is closed")
        if o["done"]:
            raise HTTPException(409, "You have already answered")
        ans = payload.get("answers") or {}
        clean = {}
        for i, q in enumerate(o["questions"]):
            v = ans.get(str(i))
            if v in (None, ""):
                if q["type"] in ("enps", "rating", "choice"):
                    raise HTTPException(422, f"Answer: {q['text'][:60]}")
                continue
            if q["type"] == "enps" and not (0 <= num(v, -1) <= 10):
                raise HTTPException(422, "Pick 0 to 10")
            if q["type"] == "rating" and not (1 <= num(v, -1) <= 5):
                raise HTTPException(422, "Pick 1 to 5")
            if q["type"] == "choice" and v not in q.get("options", []):
                raise HTTPException(422, "Pick one of the options")
            clean[str(i)] = v if q["type"] in ("choice", "text") else num(v)
            if q["type"] == "text":
                clean[str(i)] = str(v)[:1000]
        db.insert("survey_done", {"survey_id": sid, "user_id": user["id"], "at": now_iso()})
        db.insert("survey_answers", {"survey_id": sid, "user_id": None if s["anonymous"] else user["id"], "project": main_project(db, user["id"]), "answers": json.dumps(clean),
                                     "at": local_today().isoformat() if s["anonymous"] else now_iso()})  # anonymous: only the day, so answers cannot be matched to the done-list by time
        return {"ok": True}

    @r.post("/surveys/{sid}/close")
    def survey_close(sid: str, user: user_dep, db: db_dep):
        hr_only(user)
        db.run("UPDATE surveys SET status = 'closed' WHERE id = ?", sid)
        return {"ok": True}

    # -------------------------------------------------------------- what is waiting for me (home banners)

    @r.get("/hr/waiting")
    def waiting(user: user_dep, db: db_dep):
        n = notices(user, db)
        s = surveys(user, db)
        imp = [x for x in n["rows"] if x["important"] and not x["acked"] and in_audience(db, user["id"], x["audience"])]
        open_s = [x for x in s["rows"] if x["mine"] and not x["done"] and not x["closed"]]
        out = {"unreadNotices": n["unread"], "important": [{"id": x["id"], "title": x["title"]} for x in imp[:3]],
               "surveys": [{"id": x["id"], "title": x["title"]} for x in open_s[:3]]}
        if user["role"] in ("admin", "hr", "manager"):
            last = (local_today().replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
            out["lastMonth"] = {"month": last, "label": month_label(last), "locked": is_locked(db, last),
                                "reviewed": bool(db.one("SELECT 1 FROM att_reviews WHERE month = ? AND manager_id = ?", last, user["id"]))}
        sup = db.one("SELECT supervisor FROM users WHERE id = ?", user["id"])
        out["supervisor"] = bool(sup and sup["supervisor"])
        return out

    return r


# ------------------------------------------------------------------ demo data


def seed(db: Db) -> None:
    """Crew without phones, muster sheets, a locked month, notices, surveys, a tracked anonymous complaint, POSH committee."""
    if db.one("SELECT 1 FROM surveys LIMIT 1"):
        return
    users = {u["employee_id"]: u for u in db.all("SELECT * FROM users")}
    if "EMP101" not in users:
        return
    import random

    from auth import hash_pin

    R = random.Random(11)
    sites = {s["name"]: s for s in db.all("SELECT * FROM sites")}
    lod, deesa = sites.get("Lodhika Kiln Site"), sites.get("Deesa Agroforestry Site")
    meera, nidhi, ravi, purv = users["EMP002"], users["EMP005"], users["EMP003"], users["EMP001"]
    jig, asha = users["EMP101"], users["EMP107"]
    db.run("UPDATE users SET supervisor = 1 WHERE id IN (?, ?)", jig["id"], asha["id"])
    # crew who do not use the app: the supervisor marks their attendance
    h, s_ = hash_pin(secrets.token_hex(8))
    crew = []
    for emp, name, desig, site, mgr in (("EMP201", "Ramesh Koli", "Kiln helper", lod, meera), ("EMP202", "Bhavna Parmar", "Kiln helper", lod, meera),
                                        ("EMP203", "Dinesh Solanki", "Loader operator", lod, meera), ("EMP204", "Kanta Bharwad", "Nursery worker", deesa, nidhi),
                                        ("EMP205", "Valji Desai", "Nursery worker", deesa, nidhi)):
        if emp in users or not site:
            continue
        uid = db.insert("users", {"employee_id": emp, "name": name, "role": "field", "designation": desig, "pin_hash": h, "pin_salt": s_, "must_change_pin": 0, "active": 1,
                                  "created_at": now_iso(), "manager_id": mgr["id"], "app_access": 0})
        db.insert("user_sites", {"user_id": uid, "site_id": site["id"]})
        db.insert("records", {"kind": "profile", "title": name, "user_id": uid, "status": "open", "created_by": ravi["id"], "created_at": now_iso(), "updated_at": now_iso(),
                              "data": json.dumps({"employment": "Daily wage", "joining_date": "2025-11-03", "gender": "Female" if name.split()[0] in ("Bhavna", "Kanta") else "Male",
                                                  "uan": f"10{R.randint(10**9, 10**10 - 1)}", "esic": f"3{R.randint(10**9, 10**10 - 1)}"})})
        crew.append((uid, site, jig if site is lod else asha))
    today = local_today()
    hol = modules.holidays(db)
    start = (today.replace(day=1) - timedelta(days=1)).replace(day=1)
    # app users: the demo's photo check-ins cover the last two weeks; fill the days before, back to the 1st of last month
    from demo import iso

    for u in db.all("SELECT u.id, (SELECT site_id FROM user_sites WHERE user_id = u.id LIMIT 1) AS site_id FROM users u WHERE COALESCE(u.app_access, 1) = 1 AND u.active = 1"):
        u["site_id"] = u["site_id"] or (db.one("SELECT id FROM sites WHERE project_type = 'office' LIMIT 1") or {}).get("id")
        if not u["site_id"]:
            continue
        first = db.one("SELECT MIN(checkin_at) AS m FROM attendance WHERE user_id = ?", u["id"])["m"]
        stop = modules.to_local(first).date() if first else today
        d = start
        while d < stop:
            on_leave = db.one("SELECT 1 FROM leaves WHERE user_id = ? AND status IN ('approved', 'pending') AND from_date <= ? AND to_date >= ?", u["id"], d.isoformat(), d.isoformat())
            if modules.working_day(db, d, hol) and not on_leave and R.random() < 0.97:
                cin = datetime(d.year, d.month, d.day, 8, R.randint(40, 59)).astimezone() + timedelta(minutes=R.choice([0, 0, 0, 5, 12, 30]))
                cout = cin + timedelta(hours=R.choice([9, 9, 9, 9, 9.25, 9.25, 9.5, 10, 10.5, 4]))
                db.insert("attendance", {"user_id": u["id"], "site_id": u["site_id"], "checkin_at": iso(cin), "checkout_at": iso(cout), "checkin_acc": 8, "checkin_dist": R.randint(5, 80),
                                         "checkout_acc": 9, "checkout_dist": R.randint(5, 80), "status": "ok"})
            d += timedelta(days=1)
    d = start
    while d < today:
        if modules.working_day(db, d, hol):
            for site, sup in ((lod, jig), (deesa, asha)):
                mine = [c for c in crew if c[1] is site]
                if not mine:
                    continue
                sh = db.insert("muster_sheets", {"site_id": site["id"], "date": d.isoformat(), "marked_by": sup["id"], "file_id": None, "lat": site["lat"], "lng": site["lng"],
                                                 "created_at": now_iso(), "updated_at": now_iso()})
                for uid, _, _ in mine:
                    code = R.choices(["P", "H", "A"], weights=[88, 6, 6])[0]
                    db.insert("muster_lines", {"sheet_id": sh, "user_id": uid, "code": code, "ot_hours": R.choice([0, 0, 0, 1, 2]) if code == "P" else 0, "note": ""})
                if site is lod:
                    for wn in ("Lakha Bharwad", "Mansukh Koli"):
                        db.insert("muster_lines", {"sheet_id": sh, "user_id": None, "worker_name": wn, "contractor": "Shree Ram Labour Contractors",
                                                   "code": R.choices(["P", "A"], weights=[9, 1])[0], "ot_hours": 0})
        d += timedelta(days=1)
    # one crew photo reused on the sheets (fast in the browser build)
    try:
        from demo import put_file, stock_photo

        fid = put_file(db, stock_photo("crew", ["Crew muster", "DEMO SAMPLE PHOTO"]), "Muster", "crew photo.jpg", "image/jpeg", "muster", jig["id"], datetime.now())
        db.run("UPDATE muster_sheets SET file_id = ?", fid)
    except Exception:  # noqa: BLE001 - photo is decoration only
        pass
    # last month: managers confirmed, HR locked it (the month before if this month has only just begun)
    last = (today.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
    for m in (meera, nidhi):
        db.insert("att_reviews", {"month": last, "manager_id": m["id"], "at": now_iso(), "note": "Checked with site supervisors"})
        log_change(db, m["id"], "attendance_month", last, None, "Team attendance confirmed", "", f"{month_label(last)} by {m['name']}", "Checked with site supervisors")
    pend = db.one("SELECT COUNT(*) AS n FROM leaves WHERE status = 'pending' AND substr(from_date, 1, 7) <= ? AND substr(to_date, 1, 7) >= ?", last, last)["n"] + \
        db.one("SELECT COUNT(*) AS n FROM records WHERE kind = 'regularisation' AND status = 'pending' AND substr(json_extract(data, '$.date'), 1, 7) = ?", last)["n"]
    if not pend:
        rows = export_rows(db, last)
        db.insert("att_periods", {"month": last, "status": "locked", "locked_by": ravi["id"], "locked_at": now_iso(), "snapshot": json.dumps(rows)})
        log_change(db, ravi["id"], "attendance_month", last, None, "Month status", "open", "approved and locked", f"{len(rows)} employees · exported to Zoho Payroll")
    # a few changes, as HR would make them
    kir = users["EMP102"]
    log_change(db, ravi["id"], "leave_balance", kir["id"], kir["id"], "Opening earned leave", "4", "6", "Carried forward from 2025 as per appointment letter")
    if crew:
        log_change(db, jig["id"], "attendance", None, crew[0][0], f"Crew muster {(today - timedelta(days=2)).isoformat()}", "A OT 0", "P OT 0", "Came at 10:30 after the bus was late")
    log_change(db, ravi["id"], "settings", "work_hours", None, "Grace minutes", "10", "15", "Agreed in the October site leads meeting")
    # POSH Internal Committee (presiding officer a senior woman; half the members women; one external member)
    db.set_setting("posh", {"committee": [{"name": meera["name"], "role": "Presiding Officer", "user_id": meera["id"], "phone": "98250 41122"},
                                          {"name": ravi["name"], "role": "Member (HR)", "user_id": ravi["id"], "phone": "98790 22110"},
                                          {"name": asha["name"], "role": "Member (field staff)", "user_id": asha["id"], "phone": "97240 66031"},
                                          {"name": "Adv. Hetal Desai, Sahyog Trust", "role": "External member (NGO)", "user_id": None, "phone": "98980 55710"}],
                            "local_committee": "District Officer, Rajkot (Local Committee), for complaints against the employer",
                            "email": "ic@sajeevan.example"})
    # the seeded anonymous complaint (water cooler) gets a tracking code the reviewer can try
    fb = db.one("SELECT id FROM feedback WHERE user_id IS NULL ORDER BY created_at LIMIT 1")
    if fb:
        db.update("feedback", fb["id"], {"track_hash": code_hash("KL-DEMO-2026"), "category": "safety", "status": "in_progress"})
        db.insert("feedback_msgs", {"feedback_id": fb["id"], "from_hr": 1, "by_id": ravi["id"], "text": "Thank you for raising this. Two water coolers are ordered for the Lodhika yard and should arrive by Friday. Until then the supervisor will keep 20-litre cans in the shade.", "at": now_iso()})
        db.insert("feedback_msgs", {"feedback_id": fb["id"], "from_hr": 0, "by_id": None, "text": "Thanks. Can the cans be refilled after lunch also?", "at": now_iso()})
    # notice board
    def notice(title, body, aud, by, important=0, pinned=0, readers=(), ack=()):
        nid = db.insert("notices", {"title": title, "body": body, "audience": json.dumps(aud), "important": important, "pinned": pinned, "created_by": by["id"], "created_at": now_iso()})
        for e in readers:
            if e in users:
                db.insert("notice_reads", {"notice_id": nid, "user_id": users[e]["id"], "read_at": now_iso(), "ack_at": now_iso() if e in ack else None})
        return nid
    notice("Diwali holidays and site shutdown", "Sites close on the Diwali and New Year days in the holiday calendar. Kilns are cooled and covered the evening before; the gasifier is shut down by the operator and logged. Field staff on duty get a compensatory day off.",
           {"type": "all"}, ravi, important=1, pinned=1, readers=("EMP001", "EMP002", "EMP005", "EMP102", "EMP106"), ack=("EMP001", "EMP002", "EMP005", "EMP106"))
    notice("Heat safety: water break every hour", "From 12:00 to 16:00 every kiln crew takes a 10-minute water break each hour in the shade. Supervisors note it on the daily safety checklist. Report anyone feeling dizzy as a Health incident at once.",
           {"type": "project", "value": "biochar"}, meera, important=1, readers=("EMP106",), ack=())
    if deesa:
        notice("New nursery working hours", "From Monday the Deesa nursery works 07:30 to 16:30 (watering before the heat). Asha marks crew attendance by 08:00.", {"type": "site", "value": deesa["id"]}, nidhi, readers=("EMP107",))
    notice("Updated travel rates", "Two-wheeler travel is now paid at ₹3.50 a km. The app works it out from your odometer photos.", {"type": "all"}, ravi, readers=("EMP101", "EMP102", "EMP103", "EMP106", "EMP107"))
    # surveys: last month's eNPS (closed, with answers) and an open pulse survey
    q_enps = [{"type": "enps", "text": "How likely are you to recommend working at Sajeevan to a friend? (0 not at all, 10 very likely)"},
              {"type": "rating", "text": "I have what I need to do my job safely"}, {"type": "rating", "text": "My manager listens when I raise a problem"},
              {"type": "text", "text": "One thing we should change"}]
    sv = db.insert("surveys", {"title": f"eNPS · {month_label(last)}", "intro": "Anonymous. HR sees only totals, and only when at least 3 people have answered.", "questions": json.dumps(q_enps),
                               "anonymous": 1, "audience": json.dumps({"type": "all"}), "closes_on": f"{last}-28", "status": "closed", "created_by": ravi["id"], "created_at": now_iso()})
    comments = ["More shade at the kiln yard", "Faster travel claim payment", "Training on the new plant controls", "", "Drinking water at Lodhika", "", "Phone data allowance for field staff", "", "Night shift transport"]
    for i, emp in enumerate(["EMP001", "EMP002", "EMP003", "EMP005", "EMP101", "EMP102", "EMP103", "EMP106", "EMP107"]):
        db.insert("survey_done", {"survey_id": sv, "user_id": users[emp]["id"], "at": now_iso()})
        score = [9, 8, 10, 9, 6, 7, 5, 9, 10][i]
        db.insert("survey_answers", {"survey_id": sv, "user_id": None, "project": main_project(db, users[emp]["id"]), "at": f"{last}-20",
                                     "answers": json.dumps({"0": score, "1": [4, 4, 5, 4, 3, 4, 2, 4, 5][i], "2": [5, 4, 4, 5, 3, 4, 3, 4, 5][i], "3": comments[i]})})
    q_pulse = [{"type": "rating", "text": "Drinking water and shade at my site are enough"}, {"type": "rating", "text": "Toilets at my site are clean"},
               {"type": "choice", "text": "Safety kit (gloves, mask, shoes) is", "options": ["Complete and good", "Some items missing", "Worn out, needs replacing"]},
               {"type": "enps", "text": "How likely are you to recommend working here to a friend?"}, {"type": "text", "text": "Anything else about your site"}]
    sp = db.insert("surveys", {"title": "Site facilities pulse", "intro": "Five quick questions about your site. Anonymous.", "questions": json.dumps(q_pulse), "anonymous": 1,
                               "audience": json.dumps({"type": "all"}), "closes_on": (today + timedelta(days=10)).isoformat(), "status": "open", "created_by": ravi["id"], "created_at": now_iso()})
    for emp, a in (("EMP106", {"0": 4, "1": 3, "2": "Complete and good", "3": 8, "4": ""}), ("EMP103", {"0": 3, "1": 2, "2": "Some items missing", "3": 6, "4": "Gloves tear in a week"}),
                   ("EMP005", {"0": 4, "1": 4, "2": "Complete and good", "3": 9, "4": ""})):
        db.insert("survey_done", {"survey_id": sp, "user_id": users[emp]["id"], "at": now_iso()})
        db.insert("survey_answers", {"survey_id": sp, "user_id": None, "project": main_project(db, users[emp]["id"]), "at": today.isoformat(), "answers": json.dumps(a)})
    _ = purv
