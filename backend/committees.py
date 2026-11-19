"""Committees and the cases they handle (2026-11-19).

Four committees exist from the start, each with its own mailbox: POSH Internal Committee, Workplace Health & Safety,
Grievance, and Suggestions. HR names the members in the app. A complaint goes to the POSH committee when the sender
marks it POSH, a suggestion goes to Suggestions, and any other complaint goes to the committee whose policies include
the one the sender picked (Grievance when unsure). Each case lands in the app for the committee's members, who are
notified, and is emailed to the committee's mailbox (Microsoft Graph Mail.Send, only when KL_MAIL=on).

Who sees a case: its committee's members, plus HR and the director, except POSH cases, which only POSH members see
(HR and the director only while the POSH committee has no members, so nothing is lost). Anyone named in the complaint
("Against whom") is matched to employees and kept out of the case, even if they are a member, HR or the director.
Anonymous senders are never stored: the case has no user, only the hash of a tracking code (see hrops.add_feedback)."""


import json
import os
import re
import threading
from typing import Any

from fastapi import APIRouter, HTTPException

from db import Db, now_iso

SCHEMA = """
CREATE TABLE IF NOT EXISTS committees (
  id TEXT PRIMARY KEY, key TEXT NOT NULL, name TEXT NOT NULL, purpose TEXT DEFAULT '', why TEXT DEFAULT '', how TEXT DEFAULT '',
  mailbox TEXT DEFAULT '', policies TEXT NOT NULL DEFAULT '[]', external TEXT NOT NULL DEFAULT '[]', sort INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS committee_members (
  id TEXT PRIMARY KEY, committee_id TEXT NOT NULL, user_id TEXT NOT NULL, presiding INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_cmember ON committee_members (committee_id, user_id);
"""
MIGRATIONS = [
    "ALTER TABLE feedback ADD COLUMN committee_id TEXT",
    "ALTER TABLE feedback ADD COLUMN policy TEXT DEFAULT ''",
    "ALTER TABLE feedback ADD COLUMN against TEXT DEFAULT ''",
    "ALTER TABLE feedback ADD COLUMN excluded TEXT DEFAULT '[]'",
    "ALTER TABLE feedback ADD COLUMN outcome TEXT DEFAULT ''",
    "ALTER TABLE feedback ADD COLUMN closed_at TEXT",
    "ALTER TABLE feedback ADD COLUMN mail_status TEXT DEFAULT ''",
    "ALTER TABLE feedback ADD COLUMN named_at TEXT",
]
NOT_SURE = "Not sure / something else"
DEFAULT_COMMITTEES = [
    {"key": "posh", "name": "POSH Internal Committee", "mailbox": "posh@sajeevan.co.in",
     "purpose": "Hears complaints of sexual harassment at work, in confidence, and recommends action.",
     "why": "The POSH Act, 2013 requires every workplace with 10 or more people to have one. It keeps everyone safe and treated with dignity.",
     "how": "Use Complaints & suggestions and turn on \"This is a POSH complaint\". Only this committee sees it. You can also write to the mailbox or speak to any member.",
     "policies": ["Prevention of sexual harassment (POSH) policy"]},
    {"key": "safety", "name": "Workplace Health & Safety", "mailbox": "safety@sajeevan.co.in",
     "purpose": "Looks after safety at every site: unsafe work, injuries, fire, protective gear, drinking water, toilets and rest areas.",
     "why": "Field and plant work has real risks. This committee makes sure problems are fixed and do not happen again.",
     "how": "Report an accident from the site (Report a problem). For anything else unsafe, send a complaint and pick a safety policy.",
     "policies": ["Health & safety policy", "Protective gear (PPE) and site safety rules", "Drinking water, toilets and rest areas", "Vehicle and travel safety"]},
    {"key": "grievance", "name": "Grievance Committee", "mailbox": "grievance@sajeevan.co.in",
     "purpose": "Hears complaints about pay, leave, attendance, unfair treatment, bullying, discrimination and behaviour at work.",
     "why": "Everyone should have a fair and safe way to raise a problem and get an answer, without fear.",
     "how": "Send a complaint and pick the policy it breaks. Not sure which? Pick \"Not sure\" and it comes here.",
     "policies": ["Code of conduct", "Pay, leave and attendance", "Bullying and abusive behaviour", "Equal treatment, no discrimination", "Travel and expense rules", NOT_SURE]},
    {"key": "ideas", "name": "Suggestions Committee", "mailbox": "suggestion@sajeevan.co.in",
     "purpose": "Reads every suggestion and takes the good ones forward.",
     "why": "The people doing the work know best how to make it better, safer and cheaper.",
     "how": "Send a suggestion from Complaints & suggestions. You can send it with your name or without.",
     "policies": []},
]


def init(db: Db) -> None:
    db.con.executescript(SCHEMA)
    for sql in MIGRATIONS:
        try:
            db.con.execute(sql)
        except Exception:  # noqa: BLE001 - column already there
            pass
    db.con.commit()
    if not db.one("SELECT 1 FROM committees LIMIT 1"):
        for i, c in enumerate(DEFAULT_COMMITTEES):
            db.insert("committees", {**c, "policies": json.dumps(c["policies"]), "external": "[]", "sort": i, "created_at": now_iso()})
        import_posh_setting(db)
    # the first release guessed ideas@; the company's mailbox is suggestion@ (owner, 2026-11-19)
    db.run("UPDATE committees SET mailbox = 'suggestion@sajeevan.co.in' WHERE key = 'ideas' AND mailbox = 'ideas@sajeevan.co.in'")
    route_old_cases(db)


def import_posh_setting(db: Db) -> None:
    """The POSH committee used to live in a setting: its staff become members, outsiders the external members."""
    p = db.setting("posh") or {}
    c = by_key(db, "posh")
    if not c or not p.get("committee"):
        return
    ext = []
    for m in p["committee"]:
        if m.get("user_id") and db.one("SELECT 1 FROM users WHERE id = ?", m["user_id"]):
            if not db.one("SELECT 1 FROM committee_members WHERE committee_id = ? AND user_id = ?", c["id"], m["user_id"]):
                db.insert("committee_members", {"committee_id": c["id"], "user_id": m["user_id"], "presiding": 1 if "presiding" in str(m.get("role", "")).lower() else 0})
        else:
            ext.append({"name": m.get("name", ""), "role": m.get("role", "External member"), "phone": m.get("phone", "")})
    db.update("committees", c["id"], {"external": json.dumps(ext), "updated_at": now_iso()})


def route_old_cases(db: Db) -> None:
    """Complaints and suggestions sent before committees existed go to the committee that would get them now."""
    rows = db.all("SELECT id, type, category FROM feedback WHERE committee_id IS NULL OR committee_id = ''")
    if not rows:
        return
    keys = {c["key"]: c["id"] for c in db.all("SELECT id, key FROM committees")}
    for r in rows:
        key = "ideas" if r["type"] == "suggestion" else "posh" if r["category"] == "posh" else "safety" if r["category"] == "safety" else "grievance"
        if key in keys:
            db.update("feedback", r["id"], {"committee_id": keys[key]})


def by_key(db: Db, key: str) -> dict | None:
    return db.one("SELECT * FROM committees WHERE key = ? AND active = 1 ORDER BY sort LIMIT 1", key)


def member_ids(db: Db, cid: str | None) -> list[str]:
    return [m["user_id"] for m in db.all("SELECT cm.user_id FROM committee_members cm JOIN users u ON u.id = cm.user_id WHERE cm.committee_id = ? AND u.active = 1", cid or "")]


def on_posh(db: Db, user: dict) -> bool:
    c = by_key(db, "posh")
    return bool(c) and user["id"] in member_ids(db, c["id"])


def all_policies(db: Db) -> list[dict]:
    """The policies a complaint can name, each with the committee it goes to (POSH has its own switch)."""
    out = []
    for c in db.all("SELECT * FROM committees WHERE active = 1 AND key NOT IN ('posh', 'ideas') ORDER BY sort, name"):
        out += [{"policy": p, "committee": c["name"], "committee_id": c["id"]} for p in json.loads(c["policies"] or "[]")]
    if not any(p["policy"] == NOT_SURE for p in out):
        g = by_key(db, "grievance")
        if g:
            out.append({"policy": NOT_SURE, "committee": g["name"], "committee_id": g["id"]})
    return out


def route(db: Db, kind: str, posh: bool, policy: str) -> dict:
    if kind == "suggestion":
        c = by_key(db, "ideas")
    elif posh:
        c = by_key(db, "posh")
    else:
        hit = next((p for p in all_policies(db) if p["policy"] == policy), None)
        c = db.one("SELECT * FROM committees WHERE id = ?", hit["committee_id"]) if hit else by_key(db, "grievance")
    c = c or db.one("SELECT * FROM committees WHERE active = 1 ORDER BY sort LIMIT 1")
    if not c:
        raise HTTPException(500, "No committee is set up")
    return c


def _words(s: str) -> str:
    return re.sub(r"[^\w]+", " ", (s or "").lower())


def named_people(db: Db, text: str) -> list[str]:
    """Employees named in free text: first and last name both present, or the employee ID."""
    t = f" {_words(text)} "
    if not t.strip():
        return []
    out = []
    for u in db.all("SELECT id, name, employee_id FROM users"):
        words = [w for w in _words(u["name"]).split() if len(w) > 1]
        eid = (u["employee_id"] or "").lower()
        if (len(words) >= 2 and f" {words[0]} " in t and f" {words[-1]} " in t) or (eid and f" {eid} " in t):
            out.append(u["id"])
    return out


def excluded(case: dict) -> list[str]:
    try:
        return json.loads(case.get("excluded") or "[]")
    except ValueError:
        return []


def can_handle(db: Db, user: dict, case: dict, cache: dict | None = None) -> bool:
    """A committee member, or HR/the director (not for POSH unless that committee has no members); never someone named in it."""
    if user["id"] in excluded(case):
        return False
    cache = cache if cache is not None else {}
    cid = case.get("committee_id") or ""
    if cid not in cache:
        c = db.one("SELECT key FROM committees WHERE id = ?", cid)
        cache[cid] = (c["key"] if c else "", member_ids(db, cid))
    key, members = cache[cid]
    if user["id"] in members:
        return True
    lead = user["role"] in ("admin", "hr")
    return lead and not members if key == "posh" else lead


def handlers(db: Db, case: dict) -> list[str]:
    """Who is told about a case: the committee's members; HR and the director when it has none yet."""
    out = member_ids(db, case.get("committee_id"))
    if not out:
        out = [u["id"] for u in db.all("SELECT id FROM users WHERE role IN ('admin', 'hr') AND active = 1")]
    skip = set(excluded(case))
    return [u for u in dict.fromkeys(out) if u not in skip]


def tell(db: Db, case: dict, title: str, body: str) -> None:
    for uid in handlers(db, case):
        db.notify(uid, title, body, f"#case/{case['id']}")


# ------------------------------------------------------------------ email to the committee mailbox

def mail_on() -> bool:
    return os.environ.get("KL_MAIL", "off") == "on" and bool(os.environ.get("KL_SP_TENANT"))


def mail_case(case_id: str, what: str = "new") -> None:
    """Email the case to its committee's mailbox in the background; the result is kept on the case (mail_status)."""
    if not mail_on():
        return
    threading.Thread(target=_send, args=(case_id, what), daemon=True).start()


def _send(case_id: str, what: str) -> None:
    from storage import Graph

    db = Db()
    try:
        case = db.one("SELECT * FROM feedback WHERE id = ?", case_id)
        c = db.one("SELECT * FROM committees WHERE id = ?", case["committee_id"]) if case else None
        if not case or not c or not c["mailbox"]:
            return
        who = db.one("SELECT name, employee_id FROM users WHERE id = ?", case["user_id"]) if case["user_id"] else None
        sender = f"{who['name']} ({who['employee_id']})" if who else "Anonymous (the app does not know who sent it)"
        kind = "Suggestion" if case["type"] == "suggestion" else "Complaint"
        lines = [f"{kind} for the {c['name']}", "", f"Reference: {case.get('ref') or '-'}", f"From: {sender}", f"Sent: {case['created_at'][:16].replace('T', ' ')} UTC"]
        if case["policy"]:
            lines.append(f"Policy: {case['policy']}")
        lines += ["", "What happened / the idea:", case["text"]]
        if case["against"]:
            lines += ["", "Against whom / who should read it:", case["against"]]
        lines += ["", "Open it in Kshetralekha to reply, start the review or close it with an outcome.",
                  "Please keep this confidential. Do not forward it to anyone named in it."]
        subject = f"[Kshetralekha] {case.get('ref') or ''} {'The sender added their name to a' if what == 'named' else 'New'} {kind.lower()}{' · ' + case['policy'] if case['policy'] else ''}"
        g = Graph(os.environ["KL_SP_TENANT"], os.environ["KL_SP_CLIENT_ID"], os.environ["KL_SP_CLIENT_SECRET"])
        msg = {"message": {"subject": subject[:200], "body": {"contentType": "Text", "content": "\n".join(lines)},
                           "toRecipients": [{"emailAddress": {"address": c["mailbox"]}}]}, "saveToSentItems": False}
        g.call("POST", f"/users/{c['mailbox']}/sendMail", json.dumps(msg).encode(), {"Content-Type": "application/json"})
        db.update("feedback", case_id, {"mail_status": f"sent {now_iso()[:16]}"})
    except Exception as e:  # noqa: BLE001 - email is best-effort; the case is already in the app
        try:
            db.update("feedback", case_id, {"mail_status": f"failed: {str(e)[:120]}"})
        except Exception:  # noqa: BLE001
            pass
    finally:
        db.close()


# ------------------------------------------------------------------ the committees screen

def make_router(user_dep: Any, db_dep: Any) -> APIRouter:
    r = APIRouter(prefix="/api")

    def out(db: Db, c: dict, user: dict) -> dict:
        mem = db.all("SELECT u.id, u.name, u.designation, cm.presiding FROM committee_members cm JOIN users u ON u.id = cm.user_id "
                     "WHERE cm.committee_id = ? AND u.active = 1 ORDER BY cm.presiding DESC, u.name", c["id"])
        o = {**c, "policies": json.loads(c["policies"] or "[]"), "external": json.loads(c["external"] or "[]"), "members": mem,
             "isMember": any(m["id"] == user["id"] for m in mem)}
        if o["isMember"] or (user["role"] in ("admin", "hr") and (c["key"] != "posh" or not mem)):
            o["openCases"] = db.one("SELECT COUNT(*) AS n FROM feedback WHERE committee_id = ? AND status <> 'closed'", c["id"])["n"]
        return o

    @r.get("/committees")
    def committees(user: user_dep, db: db_dep):
        return {"rows": [out(db, c, user) for c in db.all("SELECT * FROM committees WHERE active = 1 ORDER BY sort, name")], "policies": all_policies(db),
                "canEdit": user["role"] in ("admin", "hr"), "mail": mail_on()}

    @r.post("/committees")
    def save(payload: dict, user: user_dep, db: db_dep):
        if user["role"] not in ("admin", "hr"):
            raise HTTPException(403, "Only HR and the director can change committees")
        cid = payload.get("id") or ""
        old = db.one("SELECT * FROM committees WHERE id = ?", cid) if cid else None
        if cid and not old:
            raise HTTPException(404, "Committee not found")
        name = str(payload.get("name", old["name"] if old else "")).strip()[:80]
        if len(name) < 3:
            raise HTTPException(422, "Give the committee a name")
        mailbox = str(payload.get("mailbox", old["mailbox"] if old else "")).strip()[:120]
        if mailbox and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", mailbox):
            raise HTTPException(422, "The mailbox must be an email address")
        pol = payload.get("policies", json.loads(old["policies"]) if old else [])
        pol = [str(p).strip()[:100] for p in (pol.split("\n") if isinstance(pol, str) else pol) if str(p).strip()][:30]
        ext = [{"name": str(e.get("name", "")).strip()[:80], "role": str(e.get("role", "") or "External member").strip()[:60], "phone": str(e.get("phone", "")).strip()[:30]}
               for e in (payload.get("external", json.loads(old["external"]) if old else []) or []) if str(e.get("name", "")).strip()][:6]
        row = {"name": name, "mailbox": mailbox, "policies": json.dumps(pol), "external": json.dumps(ext), "updated_at": now_iso(),
               **{k: str(payload.get(k, old[k] if old else "")).strip()[:600] for k in ("purpose", "why", "how")}}
        if old:
            db.update("committees", old["id"], row)
            cid = old["id"]
        else:
            n = db.one("SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM committees")["n"]
            cid = db.insert("committees", {**row, "key": "custom", "sort": n, "created_at": now_iso()})
        if "members" in payload:
            before = set(member_ids(db, cid))
            ids = [m for m in dict.fromkeys(str(x) for x in payload["members"] or []) if db.one("SELECT 1 FROM users WHERE id = ? AND active = 1", m)]
            pres = str(payload.get("presiding") or "")
            db.run("DELETE FROM committee_members WHERE committee_id = ?", cid)
            for m in ids:
                db.insert("committee_members", {"committee_id": cid, "user_id": m, "presiding": 1 if m == pres else 0})
            for m in set(ids) - before:
                db.notify(m, f"You are on the {name}", "Its cases come to your inbox. Keep them confidential.", "#committees")
        db.audit(user["id"], "committee_saved", "committee", cid, name)
        return {"id": cid}

    return r


def seed_demo(db: Db, by_emp: dict) -> None:
    """Demo members (by_emp: employee ID → user row). The POSH committee comes from the demo's POSH setting."""
    want = {"safety": ["EMP002", "EMP101", "EMP003"], "grievance": ["EMP003", "EMP001"], "ideas": ["EMP001", "EMP002"]}
    for key, ids in want.items():
        c = by_key(db, key)
        for i, e in enumerate(ids):
            if c and e in by_emp and not db.one("SELECT 1 FROM committee_members WHERE committee_id = ? AND user_id = ?", c["id"], by_emp[e]["id"]):
                db.insert("committee_members", {"committee_id": c["id"], "user_id": by_emp[e]["id"], "presiding": 1 if i == 0 else 0})
    import_posh_setting(db)
