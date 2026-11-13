"""Planner, modelled on Microsoft Planner: plans (one per project or site) hold buckets, buckets hold task cards.

A task has a title, notes, priority (urgent, important, medium, low), progress (not started, in progress,
completed), start and due dates, coloured labels named per plan, a checklist, assignees, comments, and on
completion an optional note and photo (required when the manager asks for photo proof).

Managers, HR and admins create plans and tasks and assign people; assigned people are told in their inbox.
Field staff see the plans for their sites or with tasks assigned to them, move their tasks along, tick the
checklist, comment and complete them; completing a task tells the person who created it and the managers of
the plan's site, so progress can be tracked without asking.
"""



import json
from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from db import NO_ID_TABLES, Db, now_iso

NO_ID_TABLES.add("task_assignees")

SCHEMA = """
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, site_id TEXT, color TEXT DEFAULT 'leaf', labels TEXT NOT NULL DEFAULT '[]',
  created_by TEXT, created_at TEXT NOT NULL, archived INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS buckets (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, name TEXT NOT NULL, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, bucket_id TEXT NOT NULL, title TEXT NOT NULL, notes TEXT DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('urgent','important','medium','low')),
  progress TEXT NOT NULL DEFAULT 'not_started' CHECK (progress IN ('not_started','in_progress','completed')),
  start_date TEXT, due_date TEXT, labels TEXT NOT NULL DEFAULT '[]', checklist TEXT NOT NULL DEFAULT '[]',
  photo_required INTEGER DEFAULT 0, sort REAL DEFAULT 0,
  created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  completed_at TEXT, completed_by TEXT, completion_note TEXT DEFAULT '', completion_file TEXT
);
CREATE TABLE IF NOT EXISTS task_assignees (task_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (task_id, user_id));
CREATE TABLE IF NOT EXISTS task_comments (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, user_id TEXT NOT NULL, text TEXT NOT NULL,
  created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_task_plan ON tasks (plan_id, bucket_id, sort);
CREATE INDEX IF NOT EXISTS idx_assignee_user ON task_assignees (user_id);
"""

PRIORITIES = ("urgent", "important", "medium", "low")
PROGRESS = ("not_started", "in_progress", "completed")
LABEL_COLORS = ("pink", "red", "yellow", "green", "blue", "purple", "bronze", "lime", "aqua", "grey")
DEFAULT_LABELS = [
    {"color": "pink", "name": "Carbon audit"},
    {"color": "red", "name": "Safety"},
    {"color": "yellow", "name": "Equipment"},
    {"color": "green", "name": "Field visit"},
    {"color": "blue", "name": "Paperwork"},
    {"color": "purple", "name": "Training"},
]
DEFAULT_BUCKETS = ["To do", "This week", "Later"]
PROGRESS_TEXT = {"not_started": "Not started", "in_progress": "In progress", "completed": "Completed"}


def init(db: Db) -> None:
    db.con.executescript(SCHEMA)
    db.con.commit()


def make_router(user_dep: Any, db_dep: Any, *, save_upload: Callable, is_staff: Callable[[dict], bool]) -> APIRouter:
    r = APIRouter(prefix="/api/planner", tags=["planner"])

    # -------------------------------------------------------------- reading

    def visible_plan_ids(db: Db, user: dict) -> list[str]:
        if is_staff(user):
            return [p["id"] for p in db.all("SELECT id FROM plans WHERE archived = 0")]
        mine = {row["plan_id"] for row in db.all(
            "SELECT DISTINCT t.plan_id FROM tasks t JOIN task_assignees a ON a.task_id = t.id WHERE a.user_id = ?", user["id"])}
        for p in db.all("SELECT id, site_id FROM plans WHERE archived = 0"):
            if p["site_id"] and p["site_id"] in user["sites"]:
                mine.add(p["id"])
        return list(mine)

    def plan_or_404(db: Db, user: dict, plan_id: str) -> dict:
        p = db.one("SELECT * FROM plans WHERE id = ?", plan_id)
        if not p or plan_id not in visible_plan_ids(db, user):
            raise HTTPException(404, "Plan not found")
        p["labels"] = json.loads(p["labels"])
        return p

    def task_rows(db: Db, where: str, *args) -> list[dict]:
        rows = db.all(f"SELECT t.*, p.name AS plan_name FROM tasks t JOIN plans p ON p.id = t.plan_id WHERE {where} ORDER BY t.sort, t.created_at", *args)  # noqa: S608
        if not rows:
            return []
        ids = [t["id"] for t in rows]
        marks = ", ".join("?" for _ in ids)
        assignees: dict[str, list[str]] = {}
        for a in db.all(f"SELECT task_id, user_id FROM task_assignees WHERE task_id IN ({marks})", *ids):  # noqa: S608
            assignees.setdefault(a["task_id"], []).append(a["user_id"])
        comments = {c["task_id"]: c["n"] for c in db.all(
            f"SELECT task_id, COUNT(*) AS n FROM task_comments WHERE task_id IN ({marks}) GROUP BY task_id", *ids)}  # noqa: S608
        for t in rows:
            t["labels"] = json.loads(t["labels"])
            t["checklist"] = json.loads(t["checklist"])
            t["assignees"] = assignees.get(t["id"], [])
            t["comments"] = comments.get(t["id"], 0)
            t["photo_required"] = bool(t["photo_required"])
        return rows

    @r.get("/plans")
    def plans(user: user_dep, db: db_dep):
        ids = visible_plan_ids(db, user)
        out = []
        for pid in ids:
            p = db.one("SELECT p.*, s.name AS site_name FROM plans p LEFT JOIN sites s ON s.id = p.site_id WHERE p.id = ?", pid)
            stats = db.one(
                "SELECT COUNT(*) AS total, SUM(progress = 'completed') AS done, SUM(progress = 'in_progress') AS doing,"
                " SUM(progress != 'completed' AND due_date IS NOT NULL AND due_date < date('now', 'localtime')) AS late FROM tasks WHERE plan_id = ?", pid)
            p["labels"] = json.loads(p["labels"])
            out.append({**p, "total": stats["total"] or 0, "done": stats["done"] or 0, "doing": stats["doing"] or 0, "late": stats["late"] or 0})
        out.sort(key=lambda p: p["created_at"])
        return {"plans": out}

    @r.get("/plans/{plan_id}")
    def plan(plan_id: str, user: user_dep, db: db_dep):
        p = plan_or_404(db, user, plan_id)
        buckets = db.all("SELECT * FROM buckets WHERE plan_id = ? ORDER BY sort, name", plan_id)
        return {"plan": p, "buckets": buckets, "tasks": task_rows(db, "t.plan_id = ?", plan_id)}

    @r.get("/my")
    def my_tasks(user: user_dep, db: db_dep):
        rows = task_rows(db, "t.id IN (SELECT task_id FROM task_assignees WHERE user_id = ?) AND p.archived = 0", user["id"])
        return {"tasks": rows}

    @r.get("/tasks/{task_id}")
    def task(task_id: str, user: user_dep, db: db_dep):
        rows = task_rows(db, "t.id = ?", task_id)
        if not rows:
            raise HTTPException(404, "Task not found")
        t = rows[0]
        plan_or_404(db, user, t["plan_id"])
        t["comment_list"] = db.all(
            "SELECT c.*, u.name AS user_name FROM task_comments c JOIN users u ON u.id = c.user_id WHERE c.task_id = ? ORDER BY c.created_at", task_id)
        t["bucket_name"] = (db.one("SELECT name FROM buckets WHERE id = ?", t["bucket_id"]) or {}).get("name", "")
        return t

    # -------------------------------------------------------------- plans and buckets (managers)

    def staff_only(user: dict) -> None:
        if not is_staff(user):
            raise HTTPException(403, "Only managers can change plans")

    @r.post("/plans")
    def save_plan(payload: dict, user: user_dep, db: db_dep):
        staff_only(user)
        name = str(payload.get("name", "")).strip()[:80]
        if len(name) < 2:
            raise HTTPException(422, "Give the plan a name")
        labels = payload.get("labels")
        if labels is not None:
            labels = [{"color": lb["color"], "name": str(lb.get("name", ""))[:30]} for lb in labels if lb.get("color") in LABEL_COLORS]
        if payload.get("id"):
            p = plan_or_404(db, user, payload["id"])
            patch = {"name": name, "site_id": payload.get("siteId") or None, "color": payload.get("color") or p["color"]}
            if labels is not None:
                patch["labels"] = json.dumps(labels)
            db.update("plans", p["id"], patch)
            return {"id": p["id"]}
        pid = db.insert("plans", {"name": name, "site_id": payload.get("siteId") or None, "color": payload.get("color") or "leaf",
                                  "labels": json.dumps(labels or DEFAULT_LABELS), "created_by": user["id"], "created_at": now_iso()})
        for i, b in enumerate(DEFAULT_BUCKETS):
            db.insert("buckets", {"plan_id": pid, "name": b, "sort": i})
        db.audit(user["id"], "plan_created", "plan", pid, name)
        return {"id": pid}

    @r.post("/buckets")
    def save_bucket(payload: dict, user: user_dep, db: db_dep):
        staff_only(user)
        name = str(payload.get("name", "")).strip()[:40]
        if not name:
            raise HTTPException(422, "Give the bucket a name")
        if payload.get("id"):
            b = db.one("SELECT * FROM buckets WHERE id = ?", payload["id"])
            if not b:
                raise HTTPException(404, "Bucket not found")
            db.update("buckets", b["id"], {"name": name})
            return {"id": b["id"]}
        p = plan_or_404(db, user, str(payload.get("planId", "")))
        n = db.one("SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM buckets WHERE plan_id = ?", p["id"])["n"]
        return {"id": db.insert("buckets", {"plan_id": p["id"], "name": name, "sort": n})}

    @r.post("/buckets/{bucket_id}/delete")
    def delete_bucket(bucket_id: str, user: user_dep, db: db_dep):
        staff_only(user)
        b = db.one("SELECT * FROM buckets WHERE id = ?", bucket_id)
        if not b:
            raise HTTPException(404, "Bucket not found")
        if db.one("SELECT 1 FROM tasks WHERE bucket_id = ?", bucket_id):
            raise HTTPException(409, "Move or delete the tasks in this bucket first")
        db.run("DELETE FROM buckets WHERE id = ?", bucket_id)
        return {"ok": True}

    # -------------------------------------------------------------- tasks

    def check_people(db: Db, ids: list[str]) -> list[str]:
        out = []
        for uid in ids:
            if db.one("SELECT 1 FROM users WHERE id = ? AND active = 1", uid):
                out.append(uid)
        return out

    @r.post("/tasks")
    def save_task(payload: dict, user: user_dep, db: db_dep):
        """Create or edit a task (managers). Field staff use the progress, checklist and comment calls."""
        staff_only(user)
        title = str(payload.get("title", "")).strip()[:160]
        if len(title) < 2:
            raise HTTPException(422, "Give the task a title")
        priority = payload.get("priority", "medium")
        if priority not in PRIORITIES:
            raise HTTPException(422, "Priority must be urgent, important, medium or low")
        checklist = [{"text": str(c.get("text", "")).strip()[:120], "done": bool(c.get("done"))} for c in (payload.get("checklist") or [])
                     if str(c.get("text", "")).strip()][:20]
        labels = [c for c in (payload.get("labels") or []) if c in LABEL_COLORS]
        people = check_people(db, list(dict.fromkeys(payload.get("assignees") or [])))
        row = {"title": title, "notes": str(payload.get("notes", ""))[:4000], "priority": priority,
               "start_date": payload.get("startDate") or None, "due_date": payload.get("dueDate") or None,
               "labels": json.dumps(labels), "checklist": json.dumps(checklist), "photo_required": 1 if payload.get("photoRequired") else 0,
               "updated_at": now_iso()}
        if payload.get("id"):
            t = db.one("SELECT * FROM tasks WHERE id = ?", payload["id"])
            if not t:
                raise HTTPException(404, "Task not found")
            if payload.get("bucketId"):
                row["bucket_id"] = payload["bucketId"]
            db.update("tasks", t["id"], row)
            tid, plan_id = t["id"], t["plan_id"]
            before = {a["user_id"] for a in db.all("SELECT user_id FROM task_assignees WHERE task_id = ?", tid)}
        else:
            p = plan_or_404(db, user, str(payload.get("planId", "")))
            bucket = payload.get("bucketId") or (db.one("SELECT id FROM buckets WHERE plan_id = ? ORDER BY sort LIMIT 1", p["id"]) or {}).get("id")
            if not bucket:
                raise HTTPException(422, "The plan has no bucket")
            top = db.one("SELECT COALESCE(MIN(sort), 0) - 1 AS s FROM tasks WHERE bucket_id = ?", bucket)["s"]
            tid = db.insert("tasks", {**row, "plan_id": p["id"], "bucket_id": bucket, "progress": "not_started", "sort": top,
                                      "created_by": user["id"], "created_at": now_iso()})
            plan_id = p["id"]
            before = set()
        db.run("DELETE FROM task_assignees WHERE task_id = ?", tid)
        for uid in people:
            db.insert("task_assignees", {"task_id": tid, "user_id": uid})
        plan_name = db.one("SELECT name FROM plans WHERE id = ?", plan_id)["name"]
        for uid in set(people) - before:
            if uid != user["id"]:
                due = f" · due {row['due_date']}" if row["due_date"] else ""
                db.notify(uid, f"New task: {title}", f"{plan_name}{due} · from {user['name']}", f"#task/{tid}")
        db.audit(user["id"], "task_saved", "task", tid, title)
        return {"id": tid}

    @r.post("/tasks/{task_id}/move")
    def move_task(task_id: str, payload: dict, user: user_dep, db: db_dep):
        t = _task_for(db, user, task_id, may_edit=True)
        bucket = payload.get("bucketId") or t["bucket_id"]
        if not db.one("SELECT 1 FROM buckets WHERE id = ? AND plan_id = ?", bucket, t["plan_id"]):
            raise HTTPException(422, "That bucket is not in this plan")
        db.update("tasks", task_id, {"bucket_id": bucket, "sort": float(payload.get("sort", t["sort"])), "updated_at": now_iso()})
        return {"ok": True}

    def _task_for(db: Db, user: dict, task_id: str, *, may_edit: bool = False) -> dict:
        t = db.one("SELECT * FROM tasks WHERE id = ?", task_id)
        if not t:
            raise HTTPException(404, "Task not found")
        plan_or_404(db, user, t["plan_id"])
        assigned = db.one("SELECT 1 FROM task_assignees WHERE task_id = ? AND user_id = ?", task_id, user["id"])
        if may_edit and not (is_staff(user) or assigned):
            raise HTTPException(403, "Only the people on this task or a manager can change it")
        return t

    @r.post("/tasks/{task_id}/progress")
    async def set_progress(task_id: str, user: user_dep, db: db_dep, progress: str = Form(...),
                           note: str = Form(""), lat: str = Form(""), lng: str = Form(""),
                           photo: UploadFile | None = File(None)):
        t = _task_for(db, user, task_id, may_edit=True)
        if progress not in PROGRESS:
            raise HTTPException(422, "Progress must be not started, in progress or completed")
        patch: dict[str, Any] = {"progress": progress, "updated_at": now_iso()}
        if progress == "completed":
            if t["photo_required"] and not (photo and photo.filename):
                raise HTTPException(422, "This task needs a photo as proof that it is done")
            fid = None
            if photo and photo.filename:
                fid = await save_upload(db, photo, f"Tasks/{t['title'][:60]}", "task_proof", user,
                                        lat=float(lat) if lat else None, lng=float(lng) if lng else None)
            patch.update({"completed_at": now_iso(), "completed_by": user["id"], "completion_note": note.strip()[:1000], "completion_file": fid})
        else:
            patch.update({"completed_at": None, "completed_by": None})
        db.update("tasks", task_id, patch)
        if progress == "completed" and t["progress"] != "completed":
            plan = db.one("SELECT name, site_id FROM plans WHERE id = ?", t["plan_id"])
            body = f"{plan['name']} · by {user['name']}" + (f": {note.strip()[:120]}" if note.strip() else "")
            told = set()
            if t["created_by"] and t["created_by"] != user["id"]:
                db.notify(t["created_by"], f"Task done: {t['title']}", body, f"#task/{task_id}")
                told.add(t["created_by"])
            for m in db.all("SELECT id, role FROM users WHERE active = 1 AND role IN ('manager', 'admin')"):
                if m["id"] in told or m["id"] == user["id"]:
                    continue
                if m["role"] == "manager" and plan["site_id"]:
                    mine = db.all("SELECT site_id FROM user_sites WHERE user_id = ?", m["id"])
                    if mine and plan["site_id"] not in {s["site_id"] for s in mine}:
                        continue
                db.notify(m["id"], f"Task done: {t['title']}", body, f"#task/{task_id}")
            db.audit(user["id"], "task_completed", "task", task_id, t["title"])
        return {"ok": True}

    @r.post("/tasks/{task_id}/checklist")
    def tick(task_id: str, payload: dict, user: user_dep, db: db_dep):
        t = _task_for(db, user, task_id, may_edit=True)
        items = json.loads(t["checklist"])
        i = int(payload.get("index", -1))
        if not 0 <= i < len(items):
            raise HTTPException(422, "No such checklist item")
        items[i]["done"] = bool(payload.get("done"))
        patch: dict[str, Any] = {"checklist": json.dumps(items), "updated_at": now_iso()}
        if t["progress"] == "not_started" and items[i]["done"]:
            patch["progress"] = "in_progress"  # as Planner does: ticking an item starts the task
        db.update("tasks", task_id, patch)
        return {"checklist": items, "progress": patch.get("progress", t["progress"])}

    @r.post("/tasks/{task_id}/comments")
    def comment(task_id: str, payload: dict, user: user_dep, db: db_dep):
        t = _task_for(db, user, task_id)
        text = str(payload.get("text", "")).strip()[:1000]
        if not text:
            raise HTTPException(422, "Write a comment")
        db.insert("task_comments", {"task_id": task_id, "user_id": user["id"], "text": text, "created_at": now_iso()})
        people = {a["user_id"] for a in db.all("SELECT user_id FROM task_assignees WHERE task_id = ?", task_id)} | {t["created_by"]}
        for uid in people - {user["id"], None}:
            db.notify(uid, f"Comment on: {t['title']}", f"{user['name']}: {text[:120]}", f"#task/{task_id}")
        return {"ok": True}

    @r.post("/tasks/{task_id}/delete")
    def delete_task(task_id: str, user: user_dep, db: db_dep):
        staff_only(user)
        t = _task_for(db, user, task_id)
        for table in ("task_assignees", "task_comments"):
            db.run(f"DELETE FROM {table} WHERE task_id = ?", task_id)  # noqa: S608
        db.run("DELETE FROM tasks WHERE id = ?", task_id)
        db.audit(user["id"], "task_deleted", "task", task_id, t["title"])
        return {"ok": True}

    return r



