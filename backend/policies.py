"""Company policies everyone must accept (2026-11-19, owner: "every employee must acknowledge relevant company
policies and sign a declaration when onboarded and starts working").

HR uploads each policy as a PDF (optionally a Gujarati and a Hindi copy) and says who must accept it, with the same
audience choice as the notice board (everyone, a project, a site). Anyone with a required policy they have not accepted
in its current version sees only the "Before you start" screen: they open each policy, tick that they read and accept
it, and sign a declaration with their finger. The signed declaration becomes a PDF in their HR documents (SharePoint)
and one policy_ack record per policy (with the version), so a new version asks again. Policies are records of kind
"policy"; data: title, version, body (short summary), audience, must_ack Yes/No, files {en, gu, hi}."""

import base64
import hashlib
import json
from collections.abc import Callable
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from starlette.datastructures import UploadFile as FormFile

import hrops
import pdfgen
from db import Db, now_iso

DEFAULT_DECLARATION = ("I have read and understood the company policies listed above and agree to follow them. "
                       "I understand that breaking them can lead to disciplinary action.")


def declaration(db: Db) -> str:
    return db.setting("policy_declaration") or DEFAULT_DECLARATION


def _data(p: dict) -> dict:
    d = json.loads(p["data"] or "{}")
    d.setdefault("audience", {"type": "all"})
    return d


def required_for(db: Db, uid: str) -> list[dict]:
    """Policies this person must accept, newest version only (archived ones and "No" ones are not required)."""
    out = []
    for p in db.all("SELECT * FROM records WHERE kind = 'policy' AND status NOT IN ('archived', 'withdrawn') ORDER BY created_at"):
        d = _data(p)
        if d.get("must_ack", "Yes") != "No" and hrops.in_audience(db, uid, d["audience"]):
            out.append({**p, "d": d})
    return out


def accepted(db: Db, uid: str, p: dict) -> dict | None:
    """The acceptance of this policy's current version (an old acceptance without a version counts only for an unversioned policy)."""
    want = str(p["d"].get("version") or "")
    for a in db.all("SELECT * FROM records WHERE kind = 'policy_ack' AND user_id = ? AND json_extract(data, '$.policy') = ? ORDER BY created_at DESC", uid, p["id"]):
        if str(json.loads(a["data"]).get("version") or "") == want:
            return a
    return None


def pending(db: Db, uid: str) -> list[dict]:
    return [p for p in required_for(db, uid) if not accepted(db, uid, p)]


def pending_count(db: Db, user: dict) -> int:
    return len(pending(db, user["id"]))


def _out(p: dict, lang: str = "en") -> dict:
    d = p["d"]
    files = d.get("files") or {}
    return {"id": p["id"], "title": d.get("title") or p["title"], "version": d.get("version") or "", "summary": d.get("body") or "",
            "file": files.get(lang) or files.get("en") or p.get("file_id"), "files": files, "audience": d["audience"], "must_ack": d.get("must_ack", "Yes"),
            "status": p["status"], "created_at": p["created_at"], "updated_at": p["updated_at"]}


def make_router(user_dep: Any, db_dep: Any, *, save_upload: Callable, save_bytes: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/policies")

    def hr_only(user: dict) -> None:
        if user["role"] not in ("admin", "hr"):
            raise HTTPException(403, "Only HR and the director manage policies")

    @r.get("/pending")
    def my_pending(user: user_dep, db: db_dep, lang: str = "en"):
        return {"rows": [_out(p, lang) for p in pending(db, user["id"])], "declaration": declaration(db)}

    @r.get("/mine")
    def mine(user: user_dep, db: db_dep, lang: str = "en"):
        rows = []
        for p in required_for(db, user["id"]):
            a = accepted(db, user["id"], p)
            rows.append({**_out(p, lang), "accepted_at": a["created_at"] if a else None, "declaration_file": json.loads(a["data"]).get("declaration") if a else None})
        return {"rows": rows}

    @r.post("/sign")
    def sign(payload: dict, user: user_dep, db: db_dep):
        """Accept every pending policy at once and sign the declaration (a PNG from the signature pad)."""
        want = pending(db, user["id"])
        if not want:
            return {"ok": True, "signed": 0}
        ticked = {str(x) for x in payload.get("policies") or []}
        missing = [p["d"].get("title") or p["title"] for p in want if p["id"] not in ticked]
        if missing:
            raise HTTPException(422, f"Open and accept every policy first: {', '.join(missing)}")
        sig = str(payload.get("signature") or "")
        if not sig.startswith("data:image/png;base64,"):
            raise HTTPException(422, "Sign in the box first")
        png = base64.b64decode(sig.split(",", 1)[1])
        if len(png) < 200:
            raise HTTPException(422, "Sign in the box first")
        u = db.one("SELECT * FROM users WHERE id = ?", user["id"])
        when = datetime.now()
        text = declaration(db)
        pdf = pdfgen.render_declaration(company=db.setting("company") or {}, person=u, policies=[(p["d"].get("title") or p["title"], p["d"].get("version") or "") for p in want],
                                        text=text, when=when, signature_png=png, signature_sha=hashlib.sha256(png).hexdigest())
        fid = save_bytes(db, pdf, f"HR/{u['employee_id']} {u['name']}", f"{when:%Y-%m-%d %H-%M} policy declaration.pdf", "application/pdf", "hr_document", user["id"])
        db.insert("hr_documents", {"user_id": user["id"], "title": f"Policy declaration {when:%d %b %Y}", "category": "Policy declaration", "file_id": fid,
                                   "uploaded_by": user["id"], "created_at": now_iso()})
        for p in want:
            db.insert("records", {"kind": "policy_ack", "title": "Accepted", "user_id": user["id"], "status": "open", "created_by": user["id"],
                                  "data": json.dumps({"policy": p["id"], "version": p["d"].get("version") or "", "declaration": fid}), "created_at": now_iso(), "updated_at": now_iso()})
            db.audit(user["id"], "policy_accepted", "policy", p["id"], f"{p['d'].get('title')} {p['d'].get('version') or ''}".strip())
        # a joiner's onboarding checklist gets its tick
        for ob in db.all("SELECT id, data FROM records WHERE kind = 'onboarding' AND status <> 'done'"):
            d = json.loads(ob["data"])
            if str(d.get("name", "")).strip().lower() == u["name"].strip().lower():
                item = next((x for x in str(d.get("checklist", "")).split("\n") if "polic" in x.lower()), None)
                if item and item not in (d.get("done") or []):
                    d["done"] = [*(d.get("done") or []), item]
                    db.update("records", ob["id"], {"data": json.dumps(d), "updated_at": now_iso()})
        return {"ok": True, "signed": len(want), "declaration": fid}

    # -------------------------------------------------------------- HR: the list, who accepted, upload, remind

    @r.get("")
    def all_policies(user: user_dep, db: db_dep):
        hr_only(user)
        rows = []
        for p in db.all("SELECT * FROM records WHERE kind = 'policy' AND status <> 'withdrawn' ORDER BY status = 'archived', created_at DESC"):
            p = {**p, "d": _data(p)}
            people = hrops.audience_users(db, p["d"]["audience"])
            done = sum(1 for x in people if accepted(db, x["id"], p))
            rows.append({**_out(p), "audienceText": hrops.audience_text(db, p["d"]["audience"]), "total": len(people), "done": done})
        return {"rows": rows, "declaration": declaration(db)}

    @r.get("/{pid}")
    def one(pid: str, user: user_dep, db: db_dep):
        hr_only(user)
        p = db.one("SELECT * FROM records WHERE id = ? AND kind = 'policy'", pid)
        if not p:
            raise HTTPException(404, "Policy not found")
        p = {**p, "d": _data(p)}
        people = []
        for x in hrops.audience_users(db, p["d"]["audience"]):
            a = accepted(db, x["id"], p)
            people.append({**x, "accepted_at": a["created_at"] if a else None, "declaration": json.loads(a["data"]).get("declaration") if a else None})
        return {**_out(p), "audienceText": hrops.audience_text(db, p["d"]["audience"]), "people": people}

    @r.post("")
    async def save(request: Request, user: user_dep, db: db_dep):
        """New policy, or a new version / changed details of one (multipart: data JSON, files en / gu / hi)."""
        hr_only(user)
        form = await request.form()
        body = json.loads(form.get("data") or "{}")
        pid = str(form.get("id") or "")
        old = db.one("SELECT * FROM records WHERE id = ? AND kind = 'policy'", pid) if pid else None
        if pid and not old:
            raise HTTPException(404, "Policy not found")
        d = _data(old) if old else {}
        title = str(body.get("title", d.get("title", ""))).strip()[:120]
        if len(title) < 3:
            raise HTTPException(422, "Give the policy a name")
        aud = body.get("audience") or d.get("audience") or {"type": "all"}
        if aud.get("type") not in ("all", "project", "site"):
            raise HTTPException(422, "Choose who must accept it")
        files = dict(d.get("files") or {})
        for lang in ("en", "gu", "hi"):
            up = form.get(f"file_{lang}")
            if isinstance(up, FormFile) and up.filename:
                if not (up.content_type == "application/pdf" or up.filename.lower().endswith(".pdf")):
                    raise HTTPException(422, "Upload the policy as a PDF")
                files[lang] = await save_upload(db, up, "Policies", "policy", user, name=f"{title} {body.get('version') or ''} {lang}.pdf".replace("  ", " "))
        if not files.get("en") and not str(body.get("body", d.get("body", ""))).strip():
            raise HTTPException(422, "Upload the policy PDF")
        new = {**d, "title": title, "version": str(body.get("version", d.get("version", ""))).strip()[:30], "body": str(body.get("body", d.get("body", "")))[:2000],
               "audience": aud, "must_ack": "No" if body.get("must_ack") in ("No", False) else "Yes", "files": files}
        if old:
            db.update("records", old["id"], {"title": title, "data": json.dumps(new), "file_id": files.get("en"), "updated_at": now_iso()})
            rid = old["id"]
        else:
            rid = db.insert("records", {"kind": "policy", "title": title, "status": "open", "data": json.dumps(new), "file_id": files.get("en"),
                                        "created_by": user["id"], "created_at": now_iso(), "updated_at": now_iso()})
        if new["must_ack"] == "Yes":
            for x in hrops.audience_users(db, aud):
                if not accepted(db, x["id"], {"id": rid, "d": new}):
                    db.notify(x["id"], f"Please read and accept: {title}", "Open the app to read it and sign.", "#home")
        db.audit(user["id"], "policy_saved", "policy", rid, f"{title} {new['version']}".strip())
        return {"id": rid}

    @r.post("/{pid}/archive")
    def archive(pid: str, payload: dict, user: user_dep, db: db_dep):
        hr_only(user)
        if not db.one("SELECT 1 FROM records WHERE id = ? AND kind = 'policy'", pid):
            raise HTTPException(404, "Policy not found")
        db.update("records", pid, {"status": "open" if payload.get("restore") else "archived", "updated_at": now_iso()})
        return {"ok": True}

    @r.post("/{pid}/remind")
    def remind(pid: str, user: user_dep, db: db_dep):
        hr_only(user)
        p = db.one("SELECT * FROM records WHERE id = ? AND kind = 'policy'", pid)
        if not p:
            raise HTTPException(404, "Policy not found")
        p = {**p, "d": _data(p)}
        n = 0
        for x in hrops.audience_users(db, p["d"]["audience"]):
            if not accepted(db, x["id"], p):
                db.notify(x["id"], f"Reminder: please accept {p['d'].get('title')}", "Open the app to read it and sign.", "#home")
                n += 1
        return {"count": n}

    @r.post("/declaration/text")
    def set_declaration(payload: dict, user: user_dep, db: db_dep):
        hr_only(user)
        text = str(payload.get("text", "")).strip()[:1500]
        if len(text) < 20:
            raise HTTPException(422, "Write the declaration (a sentence or two)")
        db.set_setting("policy_declaration", text)
        return {"ok": True}

    return r
