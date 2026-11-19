"""One timeline for incidents, complaints / suggestions and direct escalations (owner 2026-11-20): "when it was opened,
who investigated it in the investigation stage and what was the conclusion ... what was the action taken when marked
closed ... to keep people accountable. if decision by committee, it should show under committee review and not any
individual", "no option to edit once submitted".

Stages: Opened -> Investigation (who: the people assigned, or "Committee review - <committee>") -> Closed (conclusion
and action taken, both required). After closing nothing changes except "Reopen" with a reason. Events are kept in
case_events; the report itself is never edited (corrections are dated notes). For a committee case the actor of each
step is stored too, but only the director sees the name. Notes by the people handling a case are internal; the
reporter sees the stages, the conclusion and the action, and their own notes.

A case is ('incident', records.id), ('feedback', feedback.id) or ('escalation', escalations.id)."""

import json
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException

from db import Db, now_iso

OVERDUE_DAYS = 7
SCHEMA = """
CREATE TABLE IF NOT EXISTS case_events (
  id TEXT PRIMARY KEY, case_kind TEXT NOT NULL, case_id TEXT NOT NULL, stage TEXT NOT NULL, text TEXT DEFAULT '',
  actor_id TEXT, by_reporter INTEGER DEFAULT 0, at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_case_events ON case_events (case_kind, case_id, at);
CREATE TABLE IF NOT EXISTS escalations (
  id TEXT PRIMARY KEY, ref TEXT, user_id TEXT NOT NULL, matter TEXT NOT NULL, contact_id TEXT DEFAULT '', contact_user TEXT,
  text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', conclusion TEXT DEFAULT '', action_taken TEXT DEFAULT '',
  investigators TEXT DEFAULT '[]', created_at TEXT NOT NULL, closed_at TEXT
);
"""
MIGRATIONS = ["ALTER TABLE feedback ADD COLUMN action_taken TEXT DEFAULT ''"]
STATUS_IN = {"open": "open", "in_progress": "investigating", "investigating": "investigating", "closed": "closed"}


def init(db: Db) -> None:
    db.con.executescript(SCHEMA)
    for sql in MIGRATIONS:
        try:
            db.con.execute(sql)
        except Exception:  # noqa: BLE001 - the column is already there
            pass
    db.con.commit()


def _name(db: Db, uid: str | None) -> str:
    if not uid:
        return ""
    u = db.one("SELECT name FROM users WHERE id = ?", uid)
    return u["name"] if u else "Former employee"


def _days(a: str, b: str | None = None) -> int:
    t0 = datetime.fromisoformat(a.replace("Z", "+00:00"))
    t1 = datetime.fromisoformat(b.replace("Z", "+00:00")) if b else datetime.now(UTC)
    return max(0, (t1 - t0).days)


# ------------------------------------------------------------------ the three kinds of case, seen the same way

def load(db: Db, ck: str, cid: str) -> dict | None:
    """A case in one shape: status open / investigating / closed, the reporter, the committee (if any), the answers."""
    if ck == "incident":
        r = db.one("SELECT * FROM records WHERE id = ? AND kind = 'incident'", cid)
        if not r:
            return None
        d = json.loads(r["data"] or "{}")
        st = r["status"] if r["status"] in ("open", "investigating", "closed") else "open"
        return {"kind": ck, "id": cid, "ref": r.get("ref"), "status": st, "created_at": r["created_at"], "reporter": r["created_by"] or r["user_id"],
                "anonymous": not (r["created_by"] or r["user_id"]), "committee": None, "site_id": r["site_id"], "title": r["title"],
                "conclusion": d.get("conclusion") or (d.get("root_cause") if st == "closed" else "") or "", "action": d.get("action_taken") or "",
                "investigators": d.get("investigators") or [], "closed_at": d.get("closed_at") or (r["updated_at"] if st == "closed" else None), "row": r, "data": d}
    if ck == "feedback":
        f = db.one("SELECT * FROM feedback WHERE id = ?", cid)
        if not f:
            return None
        c = db.one("SELECT id, name FROM committees WHERE id = ?", f.get("committee_id")) if f.get("committee_id") else None
        kind = "Suggestion" if f["type"] == "suggestion" else "POSH complaint" if f.get("category") == "posh" else "Complaint"
        return {"kind": ck, "id": cid, "ref": f.get("ref"), "status": STATUS_IN.get(f["status"], "open"), "created_at": f["created_at"], "reporter": f["user_id"],
                "anonymous": not f["user_id"], "committee": c, "site_id": None, "title": kind, "conclusion": f.get("outcome") or "", "action": f.get("action_taken") or "",
                "investigators": [], "closed_at": f.get("closed_at"), "row": f}
    if ck == "escalation":
        e = db.one("SELECT * FROM escalations WHERE id = ?", cid)
        if not e:
            return None
        return {"kind": ck, "id": cid, "ref": e.get("ref"), "status": e["status"], "created_at": e["created_at"], "reporter": e["user_id"], "anonymous": False,
                "committee": None, "site_id": None, "title": f"Escalation: {e['matter']}", "conclusion": e["conclusion"] or "", "action": e["action_taken"] or "",
                "investigators": json.loads(e["investigators"] or "[]"), "closed_at": e["closed_at"], "row": e}
    return None


def can_handle(db: Db, user: dict, case: dict) -> bool:
    """Who may start, note, close and reopen."""
    if case["kind"] == "feedback":
        import committees
        return committees.can_handle(db, user, case["row"])
    if user["id"] in case["investigators"]:
        return True
    if case["kind"] == "escalation":
        return user["role"] == "admin" or case["row"].get("contact_user") == user["id"]
    # incidents: the director / HR, all-sites managers, and managers of the incident's site
    if user["role"] in ("admin", "hr") or user.get("all_sites"):
        return True
    return user["role"] == "manager" and case["site_id"] in (user.get("sites") or [])


def can_view(db: Db, user: dict, case: dict) -> bool:
    return can_handle(db, user, case) or (case["reporter"] and case["reporter"] == user["id"])


def _write_status(db: Db, case: dict, status: str, **extra: Any) -> None:
    if case["kind"] == "incident":
        d = {**case["data"], **{k: v for k, v in extra.items() if k in ("conclusion", "action_taken", "investigators", "closed_at")}}
        if "conclusion" in extra:
            d["root_cause"] = d.get("root_cause") or extra["conclusion"]  # the register's old column keeps showing something
        db.update("records", case["id"], {"status": status, "data": json.dumps(d), "updated_at": now_iso()})
    elif case["kind"] == "feedback":
        patch = {"status": {"investigating": "in_progress"}.get(status, status), "responded_at": now_iso()}
        if "conclusion" in extra:
            patch["outcome"] = extra["conclusion"]
        if "action_taken" in extra:
            patch["action_taken"] = extra["action_taken"]
        if "closed_at" in extra:
            patch["closed_at"] = extra["closed_at"]
        db.update("feedback", case["id"], patch)
    else:
        patch = {"status": status}
        for k in ("conclusion", "action_taken", "closed_at"):
            if k in extra:
                patch[k] = extra[k]
        if "investigators" in extra:
            patch["investigators"] = json.dumps(extra["investigators"])
        db.update("escalations", case["id"], patch)


def log(db: Db, case: dict, stage: str, text: str = "", actor: str | None = None, *, reporter: bool = False) -> None:
    db.insert("case_events", {"case_kind": case["kind"], "case_id": case["id"], "stage": stage, "text": text[:3000], "actor_id": actor,
                              "by_reporter": 1 if reporter else 0, "at": now_iso()})


def _tell(db: Db, case: dict, title: str, body: str, *, reporter: bool = True, handlers: bool = False, skip: str | None = None) -> None:
    link = {"incident": f"#rec/incident/{case['id']}", "feedback": f"#case/{case['id']}", "escalation": f"#esc/{case['id']}"}[case["kind"]]
    if reporter and case["reporter"] and case["reporter"] != skip:
        db.notify(case["reporter"], title, body, link)
    if not handlers:
        return
    if case["kind"] == "feedback":
        import committees
        committees.tell(db, case["row"], title, body)
        return
    who = set(case["investigators"])
    if case["kind"] == "escalation":
        who |= {u["id"] for u in db.all("SELECT id FROM users WHERE role = 'admin' AND active = 1")}
        if case["row"].get("contact_user"):
            who.add(case["row"]["contact_user"])
    else:
        who |= {u["id"] for u in db.all("SELECT id FROM users WHERE role IN ('admin', 'hr') AND active = 1")}
        if case["site_id"]:
            who |= {u["user_id"] for u in db.all("SELECT us.user_id FROM user_sites us JOIN users u ON u.id = us.user_id WHERE us.site_id = ? AND u.role = 'manager' AND u.active = 1", case["site_id"])}
    for uid in who - {skip, case["reporter"] if reporter else None}:
        db.notify(uid, title, body, link)


# ------------------------------------------------------------------ the timeline

def timeline(db: Db, case: dict, viewer: dict | None) -> dict:
    """What a viewer sees. viewer None = an anonymous sender with their tracking code."""
    handler = bool(viewer and can_handle(db, viewer, case))
    director = bool(viewer and viewer["role"] == "admin")
    cm = case["committee"]
    who_label = f"Committee review · {cm['name']}" if cm else None

    def actor(uid: str | None, reporter: bool) -> dict:
        if reporter:
            return {"by": "Anonymous" if case["anonymous"] else (_name(db, case["reporter"]) if handler or (viewer and viewer["id"] == case["reporter"]) else "The reporter")}
        if who_label:
            return {"by": who_label, **({"actual": _name(db, uid)} if director and uid else {})}
        return {"by": _name(db, uid) or "—"}

    ev = db.all("SELECT * FROM case_events WHERE case_kind = ? AND case_id = ? ORDER BY at, rowid", case["kind"], case["id"])
    items = [{"stage": "opened", "at": case["created_at"], "by": "Anonymous" if case["anonymous"] else (_name(db, case["reporter"]) if handler or (viewer and viewer["id"] == case["reporter"]) else "The reporter"),
              "text": case["title"]}]
    if not any(e["stage"] == "investigation" for e in ev) and case["status"] in ("investigating", "closed"):
        items.append({"stage": "investigation", "at": None, "by": who_label or "Before tracking began", "text": "Started before the timeline was kept"})
    for e in ev:
        if e["stage"] == "note" and not e["by_reporter"] and not handler:
            continue  # the investigators' working notes stay with them
        it = {"stage": e["stage"], "at": e["at"], "text": e["text"], "fromReporter": bool(e["by_reporter"]), **actor(e["actor_id"], bool(e["by_reporter"]))}
        items.append(it)
    if case["status"] == "closed" and not any(e["stage"] == "closed" for e in ev):
        items.append({"stage": "closed", "at": case["closed_at"], "by": who_label or "Before tracking began", "text": ""})
    days = _days(case["created_at"], case["closed_at"] if case["status"] == "closed" else None)
    inv = [_name(db, u) for u in case["investigators"]]
    return {"kind": case["kind"], "id": case["id"], "ref": case["ref"], "status": case["status"], "items": items, "days": days,
            "overdue": case["status"] != "closed" and days >= OVERDUE_DAYS, "conclusion": case["conclusion"], "action": case["action"],
            "investigatedBy": who_label or (", ".join(inv) if inv else ""), "committee": cm["name"] if cm else "",
            "canHandle": handler, "canNote": handler or bool(viewer and viewer["id"] == case["reporter"]), "locked": case["status"] == "closed"}


# ------------------------------------------------------------------ routes

def make_router(user_dep: Any, db_dep: Any) -> APIRouter:
    r = APIRouter(prefix="/api/track")

    def get(db: Db, user: dict, ck: str, cid: str) -> dict:
        case = load(db, ck, cid)
        if not case or not can_view(db, user, case):
            raise HTTPException(404, "Not found")
        return case

    def need_handler(db: Db, user: dict, case: dict) -> None:
        if not can_handle(db, user, case):
            raise HTTPException(403, "Only the people handling it can do this" if not case["committee"] else "Only the committee can do this")

    @r.get("/{ck}/{cid}")
    def view(ck: str, cid: str, user: user_dep, db: db_dep):
        return timeline(db, get(db, user, ck, cid), user)

    @r.post("/{ck}/{cid}/start")
    def start(ck: str, cid: str, payload: dict, user: user_dep, db: db_dep):
        """Investigation begins: the people investigating (a committee case: the committee)."""
        case = get(db, user, ck, cid)
        need_handler(db, user, case)
        if case["status"] != "open":
            raise HTTPException(409, "The investigation has already started" if case["status"] == "investigating" else "It is closed; reopen it with a reason first")
        inv: list[str] = []
        if not case["committee"]:
            inv = [u["id"] for u in (db.one("SELECT id FROM users WHERE id = ? AND active = 1", str(x)) for x in payload.get("investigators") or []) if u]
            inv = list(dict.fromkeys(inv))
            if not inv:
                raise HTTPException(422, "Choose who investigates it")
        _write_status(db, case, "investigating", investigators=inv)
        names = ", ".join(_name(db, u) for u in inv)
        log(db, case, "investigation", (f"Investigated by {names}" if inv else "") + (f"\n{str(payload.get('note') or '').strip()[:1000]}" if payload.get("note") else ""), user["id"])
        case = load(db, ck, cid)
        _tell(db, case, f"{case['ref'] or case['title']}: investigation started", f"By {case['committee']['name'] if case['committee'] else names}", handlers=False)
        for u in inv:
            if u != user["id"]:
                db.notify(u, f"You are investigating {case['ref'] or case['title']}", case["title"], {"incident": f"#rec/incident/{cid}", "feedback": f"#case/{cid}", "escalation": f"#esc/{cid}"}[ck])
        return {"ok": True}

    @r.post("/{ck}/{cid}/note")
    def note(ck: str, cid: str, payload: dict, user: user_dep, db: db_dep):
        """A dated note: the investigators' working notes, or the reporter's correction / new facts (never an edit)."""
        case = get(db, user, ck, cid)
        text = str(payload.get("text", "")).strip()
        if len(text) < 3:
            raise HTTPException(422, "Write the note")
        handler = can_handle(db, user, case)
        reporter = not handler and case["reporter"] == user["id"]
        if not (handler or reporter):
            raise HTTPException(403, "Not allowed")
        log(db, case, "note", text, user["id"], reporter=reporter)
        if reporter:
            _tell(db, case, f"{case['ref'] or case['title']}: the reporter added a note", text[:120] if case["kind"] != "feedback" or case["row"].get("category") != "posh" else "Confidential",
                  reporter=False, handlers=True)
        return {"ok": True}

    @r.post("/{ck}/{cid}/close")
    def close(ck: str, cid: str, payload: dict, user: user_dep, db: db_dep):
        case = get(db, user, ck, cid)
        need_handler(db, user, case)
        if case["status"] == "closed":
            raise HTTPException(409, "Already closed")
        if case["status"] == "open":
            raise HTTPException(409, "Start the investigation first")
        conclusion = str(payload.get("conclusion", "")).strip()[:2000]
        action = str(payload.get("action", "")).strip()[:2000]
        if len(conclusion) < 3:
            raise HTTPException(422, "Write the conclusion: what was found")
        if len(action) < 3:
            raise HTTPException(422, "Write the action taken")
        at = now_iso()
        _write_status(db, case, "closed", conclusion=conclusion, action_taken=action, closed_at=at)
        log(db, case, "closed", f"Conclusion: {conclusion}\nAction taken: {action}", user["id"])
        _tell(db, case, f"{case['ref'] or case['title']} is closed", f"Conclusion: {conclusion[:120]}", handlers=False)
        return {"ok": True}

    @r.post("/{ck}/{cid}/reopen")
    def reopen(ck: str, cid: str, payload: dict, user: user_dep, db: db_dep):
        case = get(db, user, ck, cid)
        need_handler(db, user, case)
        if case["status"] != "closed":
            raise HTTPException(409, "It is not closed")
        reason = str(payload.get("reason", "")).strip()[:1000]
        if len(reason) < 5:
            raise HTTPException(422, "Give the reason for reopening")
        _write_status(db, case, "investigating", closed_at=None)
        log(db, case, "reopened", reason, user["id"])
        _tell(db, case, f"{case['ref'] or case['title']} is reopened", reason[:120], handlers=True, skip=user["id"])
        return {"ok": True}

    @r.get("")
    def overdue(user: user_dep, db: db_dep):
        """Cases this person handles that have been open 7 days or more (HR desk, cases list)."""
        out = []
        cands = [("incident", x["id"]) for x in db.all("SELECT id FROM records WHERE kind = 'incident' AND status <> 'closed'")]
        cands += [("feedback", x["id"]) for x in db.all("SELECT id FROM feedback WHERE status <> 'closed'")]
        cands += [("escalation", x["id"]) for x in db.all("SELECT id FROM escalations WHERE status <> 'closed'")]
        for ck, cid in cands:
            c = load(db, ck, cid)
            if c and _days(c["created_at"]) >= OVERDUE_DAYS and can_handle(db, user, c):
                out.append({"kind": ck, "id": cid, "ref": c["ref"], "title": c["title"], "days": _days(c["created_at"]), "status": c["status"]})
        return {"rows": sorted(out, key=lambda x: -x["days"])}

    return r


def remind_overdue(db: Db) -> int:
    """Nightly: a case open 7, 14, 21... days reminds the people handling it."""
    n = 0
    for table, ck in (("records", "incident"), ("feedback", "feedback"), ("escalations", "escalation")):
        where = "kind = 'incident' AND " if table == "records" else ""
        for x in db.all(f"SELECT id FROM {table} WHERE {where}status <> 'closed'"):  # noqa: S608 - fixed names
            c = load(db, ck, x["id"])
            d = _days(c["created_at"]) if c else 0
            if c and d >= OVERDUE_DAYS and d % OVERDUE_DAYS == 0:
                _tell(db, c, f"{c['ref'] or c['title']} has been open {d} days", "Start the investigation or close it with the conclusion and action taken.",
                      reporter=False, handlers=True)
                n += 1
    return n


# ------------------------------------------------------------------ direct escalation

MATTERS = ["Money or fraud", "Safety", "Compliance violation", "Commitment to a client", "Other serious matter"]


def contacts(db: Db) -> list[dict]:
    return [c for c in (db.setting("escalation_contacts") or []) if isinstance(c, dict)]


def make_escalation_router(user_dep: Any, db_dep: Any) -> APIRouter:
    r = APIRouter(prefix="/api/escalation")

    def out(db: Db, e: dict) -> dict:
        c = next((x for x in contacts(db) if x.get("id") == e["contact_id"]), {})
        return {"id": e["id"], "ref": e["ref"], "matter": e["matter"], "text": e["text"], "status": e["status"], "created_at": e["created_at"],
                "by": _name(db, e["user_id"]), "to": c.get("name", ""), "days": _days(e["created_at"], e["closed_at"] if e["status"] == "closed" else None)}

    @r.get("")
    def page(user: user_dep, db: db_dep):
        mine = db.all("SELECT * FROM escalations WHERE user_id = ? ORDER BY created_at DESC", user["id"])
        handle = [e for e in db.all("SELECT * FROM escalations ORDER BY created_at DESC")
                  if e["user_id"] != user["id"] and can_handle(db, user, load(db, "escalation", e["id"]))]
        return {"contacts": contacts(db), "matters": MATTERS, "mine": [out(db, e) for e in mine], "forMe": [out(db, e) for e in handle],
                "canEdit": user["role"] in ("admin", "hr")}

    @r.post("/contacts")
    def save_contacts(payload: dict, user: user_dep, db: db_dep):
        if user["role"] not in ("admin", "hr"):
            raise HTTPException(403, "Only HR and the director keep this list")
        rows = []
        for i, c in enumerate(payload.get("contacts") or []):
            name = " ".join(str(c.get("name", "")).split())[:80]
            if len(name) < 2:
                raise HTTPException(422, f"Contact {i + 1}: give the name")
            phone = "".join(ch for ch in str(c.get("phone", "")) if ch.isdigit() or ch == "+")[:16]
            email = str(c.get("email", "")).strip()[:120]
            if not phone and not email:
                raise HTTPException(422, f"{name}: give a phone number or an email")
            uid = str(c.get("user_id") or "") or None
            if uid and not db.one("SELECT 1 FROM users WHERE id = ?", uid):
                uid = None
            rows.append({"id": str(c.get("id") or "")[:40] or f"c{i}{int(datetime.now(UTC).timestamp())}", "name": name, "role": str(c.get("role", "")).strip()[:80],
                         "phone": phone, "whatsapp": bool(c.get("whatsapp", True)) and bool(phone), "email": email, "user_id": uid,
                         "matters": [m for m in c.get("matters") or [] if m in MATTERS]})
        db.set_setting("escalation_contacts", rows)
        db.audit(user["id"], "escalation_contacts", "settings", None, f"{len(rows)} contacts")
        return {"ok": True, "contacts": rows}

    @r.post("")
    def raise_it(payload: dict, user: user_dep, db: db_dep):
        """Record a direct escalation: it goes straight to the chosen contact and the director, outside the usual chain."""
        matter = str(payload.get("matter", ""))
        if matter not in MATTERS:
            raise HTTPException(422, "Choose what it is about")
        text = str(payload.get("text", "")).strip()
        if len(text) < 10:
            raise HTTPException(422, "Write what happened (a sentence or two)")
        c = next((x for x in contacts(db) if x.get("id") == payload.get("contact")), None)
        if not c:
            raise HTTPException(422, "Choose who it goes to")
        eid = db.insert("escalations", {"user_id": user["id"], "matter": matter, "contact_id": c["id"], "contact_user": c.get("user_id"), "text": text[:4000],
                                        "status": "open", "created_at": now_iso()})
        case = load(db, "escalation", eid)
        _tell(db, case, f"Direct escalation from {user['name']}: {matter}", text[:140], reporter=False, handlers=True, skip=user["id"])
        db.audit(user["id"], "escalation", "escalation", eid, f"{matter} -> {c['name']}")
        return {"id": eid, "ref": case["ref"]}

    @r.get("/{eid}")
    def one(eid: str, user: user_dep, db: db_dep):
        case = load(db, "escalation", eid)
        if not case or not can_view(db, user, case):
            raise HTTPException(404, "Not found")
        return {**out(db, case["row"]), "contact": next((x for x in contacts(db) if x.get("id") == case["row"]["contact_id"]), None)}

    return r
