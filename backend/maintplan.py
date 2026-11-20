"""Equipment numbers, Monday maintenance tasks and site plan names (owner 2026-11-20).

- "automatic serial numbers to equipments": each machine gets an asset number by type, running across the company:
  KLN-001, GAS-002, GEN-003... (the maker's own serial number stays as typed).
- "auto reminders and task in planner every x days in maintenence bucket as planned and it gets updated every week on
  monday morning": every Monday from 06:00, each machine due for service that week (or overdue; "service every X days"
  after the last service) gets a task in the Maintenance bucket of its site's plan, assigned to the site supervisor, else
  the site manager (owner chose). The morning a service is due, and every 3 days while overdue, the assignee is reminded.
  Logging a preventive service closes the task (and the next due date moves on).
- "plan name in planner takes from site": a plan linked to a site carries the site's name and follows a rename."""

import json
from datetime import date, datetime, timedelta

from db import Db, now_iso

TYPE_CODES = {"Kiln": "KLN", "Gasifier": "GAS", "Generator": "GEN", "Loader": "LDR", "Shredder": "SHR", "Pump": "PMP", "Vehicle": "VEH", "Other": "OTH"}
BUCKET = "Maintenance"


def init(db: Db) -> None:
    try:
        db.con.execute("ALTER TABLE tasks ADD COLUMN source TEXT DEFAULT ''")
        db.con.commit()
    except Exception:  # noqa: BLE001 - already there
        pass
    # equipment added before numbering: numbered in the order it was added
    for r in db.all("SELECT id, data, title FROM records WHERE kind = 'equipment' ORDER BY created_at"):
        d = json.loads(r["data"] or "{}")
        if not d.get("asset_no"):
            d["asset_no"] = next_asset_no(db, d.get("type"))
            db.update("records", r["id"], {"data": json.dumps(d), "title": equipment_title(d)})
    # plans linked to a site carry the site's name
    for p in db.all("SELECT p.id, p.name, s.name AS site_name FROM plans p JOIN sites s ON s.id = p.site_id WHERE p.site_id IS NOT NULL"):
        if p["name"] != p["site_name"]:
            db.update("plans", p["id"], {"name": p["site_name"]})


def next_asset_no(db: Db, typ: str | None) -> str:
    code = TYPE_CODES.get(str(typ or ""), "OTH")
    n = 0
    for r in db.all("SELECT data FROM records WHERE kind = 'equipment'"):
        a = str(json.loads(r["data"] or "{}").get("asset_no") or "")
        if a.startswith(f"{code}-"):
            try:
                n = max(n, int(a.split("-", 1)[1]))
            except ValueError:
                pass
    return f"{code}-{n + 1:03d}"


def equipment_title(d: dict) -> str:
    return f"{d.get('asset_no')} · {d.get('name') or 'Equipment'}" if d.get("asset_no") else str(d.get("name") or "Equipment")


def rename_site_plans(db: Db, site_id: str, name: str) -> None:
    db.run("UPDATE plans SET name = ? WHERE site_id = ?", name, site_id)


def site_plan(db: Db, site_id: str) -> tuple[str, str]:
    """The site's plan (made, named after the site, if there is none) and its Maintenance bucket."""
    import planner

    site = db.one("SELECT name FROM sites WHERE id = ?", site_id)
    p = db.one("SELECT id FROM plans WHERE site_id = ? AND archived = 0 ORDER BY created_at LIMIT 1", site_id)
    if p:
        pid = p["id"]
    else:
        pid = db.insert("plans", {"name": site["name"] if site else "Site", "site_id": site_id, "color": "leaf", "labels": json.dumps(planner.DEFAULT_LABELS),
                                  "created_by": None, "created_at": now_iso()})
        for i, b in enumerate(planner.DEFAULT_BUCKETS):
            db.insert("buckets", {"plan_id": pid, "name": b, "sort": i})
    b = db.one("SELECT id FROM buckets WHERE plan_id = ? AND lower(name) = 'maintenance'", pid)
    if b:
        return pid, b["id"]
    top = db.one("SELECT COALESCE(MAX(sort), 0) AS m FROM buckets WHERE plan_id = ?", pid)
    return pid, db.insert("buckets", {"plan_id": pid, "name": BUCKET, "sort": int(top["m"] or 0) + 1})


def assignee(db: Db, site_id: str) -> str | None:
    """The site supervisor, else the site manager, else a manager over all sites."""
    for sql in ("SELECT u.id FROM user_sites us JOIN users u ON u.id = us.user_id WHERE us.site_id = ? AND u.active = 1 AND u.supervisor = 1 ORDER BY u.name",
                "SELECT u.id FROM user_sites us JOIN users u ON u.id = us.user_id WHERE us.site_id = ? AND u.active = 1 AND u.role = 'manager' ORDER BY u.name"):
        r = db.one(sql, site_id)
        if r:
            return r["id"]
    r = db.one("SELECT id FROM users WHERE active = 1 AND role = 'manager' ORDER BY name")
    return r["id"] if r else None


def due_date(d: dict) -> date | None:
    try:
        days = int(float(d.get("service_days") or 0))
        return date.fromisoformat(str(d.get("last_service"))[:10]) + timedelta(days=days) if days > 0 and d.get("last_service") else None
    except (TypeError, ValueError):
        return None


def weekly(db: Db, today: date) -> int:
    """Monday: a task for every machine due this week or overdue that does not already have an open one."""
    n = 0
    for r in db.all("SELECT * FROM records WHERE kind = 'equipment' AND site_id IS NOT NULL"):
        d = json.loads(r["data"] or "{}")
        due = due_date(d)
        if not due or due > today + timedelta(days=6):
            continue
        src = f"equipment:{r['id']}"
        if db.one("SELECT 1 FROM tasks WHERE source = ? AND progress <> 'completed'", src):
            continue
        pid, bid = site_plan(db, r["site_id"])
        late = due < today
        tid = db.insert("tasks", {"plan_id": pid, "bucket_id": bid, "title": f"Service {equipment_title(d)}"[:160],
                                  "notes": f"Preventive service every {d.get('service_days')} days. Last service {d.get('last_service')}. "
                                           "Log it under the machine (Maintenance > Preventive service): this task closes itself.",
                                  "priority": "urgent" if late else "important", "due_date": max(due, today).isoformat() if late else due.isoformat(),
                                  "labels": json.dumps(["yellow"]), "checklist": "[]", "photo_required": 1, "sort": 0, "created_by": None,
                                  "created_at": now_iso(), "updated_at": now_iso(), "progress": "not_started", "source": src})
        who = assignee(db, r["site_id"])
        if who:
            db.insert("task_assignees", {"task_id": tid, "user_id": who})
            db.notify(who, f"Maintenance this week: {equipment_title(d)}", f"{'Overdue since' if late else 'Due'} {due:%d %b}", f"#task/{tid}")
        n += 1
    return n


def remind(db: Db, today: date) -> int:
    """Each morning: due today, and every 3 days while overdue."""
    n = 0
    for t in db.all("SELECT * FROM tasks WHERE source LIKE 'equipment:%' AND progress <> 'completed' AND due_date IS NOT NULL"):
        due = date.fromisoformat(t["due_date"][:10])
        late = (today - due).days
        if late == 0 or (late > 0 and late % 3 == 0):
            for a in db.all("SELECT user_id FROM task_assignees WHERE task_id = ?", t["id"]):
                db.notify(a["user_id"], f"{'Due today' if late == 0 else f'Overdue {late} days'}: {t['title']}", "Log the service under the machine.", f"#task/{t['id']}")
                n += 1
    return n


def serviced(db: Db, equipment_id: str, by: str | None) -> None:
    """A preventive service was logged: its open task is done."""
    db.run("UPDATE tasks SET progress = 'completed', completed_at = ?, completed_by = ?, completion_note = 'Service logged', updated_at = ? "
           "WHERE source = ? AND progress <> 'completed'", now_iso(), by, now_iso(), f"equipment:{equipment_id}")


def tick(db: Db) -> None:
    """Called every few minutes: Monday 06:00 the week's tasks, 07:00 each day the reminders (once each)."""
    now = datetime.now().astimezone()
    today = now.date()
    week = f"{today.isocalendar()[0]}-W{today.isocalendar()[1]:02d}"
    if today.weekday() == 0 and now.hour >= 6 and db.setting("maint_week") != week:
        db.set_setting("maint_week", week)
        weekly(db, today)
    if now.hour >= 7 and db.setting("maint_day") != today.isoformat():
        db.set_setting("maint_day", today.isoformat())
        remind(db, today)
