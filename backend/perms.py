"""Roles & permissions (Settings > Roles & permissions): what each role from Settings > Lists may do, who approves
which request up to which limit, and departments (groups of projects, plus teams such as Accounts & Finance).

A person's role is their designation (a role from Lists); a role that was never ticked gets the defaults of its
access level, which match what the app did before this page existed. The director always has everything, and only
the director changes this page. What a person can *see* (sites, people) still follows the access level; these
permissions decide what they can *do*."""

import re

from fastapi import APIRouter, HTTPException

import lists
import modules
from db import Db

# key, label, group, levels that have it by default
PERMS = [
    ("users.add", "Add employees", "people", ("hr",)),
    ("users.edit", "Edit employee details", "people", ("hr",)),
    ("users.deactivate", "Deactivate or bring back employees", "people", ("hr",)),
    ("users.pin", "Reset PINs", "people", ("hr",)),
    ("users.assign", "Assign people to sites and projects", "people", ("hr",)),
    ("sites.edit", "Add and edit sites, register items and farmer templates", "sites", ("manager",)),
    ("att.exceptions", "Accept check-in exceptions", "attendance", ("manager",)),
    ("att.edit", "Edit timesheets (crew attendance of any day)", "attendance", ("manager", "hr")),
    ("att.lock", "Approve and lock month end", "attendance", ("hr",)),
    ("planner.plans", "Create plans and assign tasks", "planner", ("manager", "hr")),
    ("hr.notices", "Post notices", "hr", ("manager", "hr")),
    ("hr.surveys", "Run surveys", "hr", ("hr",)),
    ("hr.complaints", "Read complaints and suggestions", "hr", ("hr",)),
    ("hr.documents", "Upload employee documents", "hr", ("hr",)),
    ("reports.view", "See dashboard and reports", "reports", ("manager", "hr")),
    ("reports.export", "Download data (CSV, audit packs, Zoho export)", "reports", ("manager", "hr")),
    ("settings.lists", "Edit lists (roles, offices, leave types, form options)", "settings", ("hr",)),
    ("settings.company", "Edit company details and travel rates", "settings", ()),
    ("settings.audit", "See the audit log", "settings", ()),
]
KEYS = [p[0] for p in PERMS]
GROUPS = {"people": "People", "sites": "Sites", "attendance": "Attendance", "planner": "Planner", "hr": "HR", "reports": "Reports", "settings": "Settings"}

# request types that go through approval rules: key -> label, unit
APPROVAL_KINDS = {
    "leave": ("Leave", "days"),
    "travel": ("Travel allowance", "₹"),
    "expense": ("Expense claims", "₹"),
    "advance": ("Advances & loans", "₹"),
    "farmer_payment": ("Farmer payments", "₹"),
    "purchase_request": ("Purchase requests", "₹"),
    "regularisation": ("Attendance corrections", ""),
}
DEFAULT_DEPARTMENTS = [
    {"key": "carbon", "name": "Biochar & Gas", "projects": ["biochar", "gasifier"]},
    {"key": "agro", "name": "Agroforestry", "projects": ["agroforestry"]},
    {"key": "accounts", "name": "Accounts & Finance", "projects": []},
    {"key": "management", "name": "Management", "projects": ["management"]},
]
TRAVEL_DEFAULT = [{"role": "manager"}, {"role": "dept:accounts"}]


# ------------------------------------------------------------------ permissions


def role_perms(db: Db) -> dict:
    return db.setting("role_perms", {}) or {}


def defaults_for(level: str, db: Db | None = None) -> list[str]:
    """Starting ticks of an access level: built-in ones from PERMS, a custom level its own list."""
    if level == "admin":
        return list(KEYS)
    if level in lists.LEVELS or db is None:
        return [k for k, _, _, lv in PERMS if level in lv]
    info = lists.level_info(db, level)
    return [] if info["app"] == "field" else [k for k in KEYS if k in (info.get("perms") or [])]


def is_field_level(db: Db, level: str) -> bool:
    return lists.level_info(db, level)["app"] == "field"


def for_role(db: Db, name: str, level: str) -> list[str]:
    if level == "admin":
        return list(KEYS)
    if is_field_level(db, level):
        return []  # the simple phone app has no office tools
    saved = role_perms(db).get(name)
    return [k for k in KEYS if k in saved] if saved is not None else defaults_for(level, db)


def for_user(db: Db, u: dict) -> list[str]:
    if u["role"] == "admin":
        return list(KEYS)
    level = u.get("level") or u["role"]  # a custom access level, else the built-in one
    known = {r["name"]: r["level"] for r in lists.roles(db)}
    name = u.get("designation") or ""
    if known.get(name) == level:  # the designation's own ticks; a stray designation falls back to the level
        return for_role(db, name, level)
    return [] if is_field_level(db, level) else defaults_for(level, db)


def can(u: dict, key: str) -> bool:
    return u["role"] == "admin" or key in (u.get("perms") or [])


def need(u: dict, key: str) -> None:
    if not can(u, key):
        label = next((p[1] for p in PERMS if p[0] == key), key)
        raise HTTPException(403, f"Your designation may not do this: {label}")


# ------------------------------------------------------------------ departments


def departments(db: Db) -> list[dict]:
    d = db.setting("departments")
    if d is None:
        d = [dict(x, projects=list(x["projects"])) for x in DEFAULT_DEPARTMENTS]
        db.set_setting("departments", d)
    return d


def dept_of_project(db: Db, project: str) -> str:
    return next((d["key"] for d in departments(db) if project in d["projects"]), "")


def dept_of(db: Db, u: dict) -> str:
    """The person's department: chosen by HR, else from the project in their employee code (BIO01001 -> biochar)."""
    if u.get("department"):
        return u["department"]
    code = (u.get("employee_id") or "")[:3]
    proj = next((k for k, c in lists.project_codes(db).items() if c == code), "")
    return dept_of_project(db, proj) if proj else ""


def dept_usage(db: Db, key: str) -> int:
    n = sum(1 for u in db.all("SELECT employee_id, department FROM users WHERE active = 1") if dept_of(db, u) == key)
    rules = modules.setting(db, "approval_chains")
    return n + sum(1 for steps in rules.values() for s in steps if s.get("role") == f"dept:{key}")


# ------------------------------------------------------------------ approvers


def approver_label(db: Db, spec: str) -> str:
    if spec == "manager":
        return "Reporting manager"
    if spec == "hr":
        return "HR"
    if spec == "admin":
        return "Director"
    if spec.startswith("role:"):
        return spec[5:]
    if spec.startswith("dept:"):
        d = next((x for x in departments(db) if x["key"] == spec[5:]), None)
        return f"{d['name'] if d else spec[5:]} team"
    return spec


def members(db: Db, spec: str) -> list[dict]:
    """People who may decide a step given to a role or a department (anyone of them)."""
    rows = db.all("SELECT id, employee_id, department, designation, role FROM users WHERE active = 1")
    if spec.startswith("role:"):
        return [u for u in rows if u["designation"] == spec[5:]]
    if spec.startswith("dept:"):
        return [u for u in rows if dept_of(db, u) == spec[5:]]
    return []


def is_member(db: Db, user: dict, spec: str) -> bool:
    return any(m["id"] == user["id"] for m in members(db, spec))


def valid_spec(db: Db, spec: str) -> bool:
    if spec in ("manager", "hr", "admin"):
        return True
    if spec.startswith("role:"):
        return any(r["name"] == spec[5:] for r in lists.roles(db))
    if spec.startswith("dept:"):
        return any(d["key"] == spec[5:] for d in departments(db))
    return False


def step_applies(step: dict, amount: float) -> bool:
    if step.get("over") not in (None, ""):
        return amount > float(step["over"])
    return amount >= float(step.get("min") or 0)  # rules saved before this page: "from" instead of "more than"


def migrate(db: Db) -> None:
    """Once: travel joins the approval rules; departments get their defaults."""
    departments(db)
    rules = db.setting("approval_chains")
    if rules is not None and "travel" not in rules:
        db.set_setting("approval_chains", {**rules, "travel": [dict(s) for s in TRAVEL_DEFAULT]})


def overview(db: Db) -> dict:
    rules = modules.setting(db, "approval_chains")
    rs = lists.roles(db)
    specs = [{"value": "manager", "label": "Reporting manager"}, *({"value": f"role:{r['name']}", "label": r["name"]} for r in rs),
             *({"value": f"dept:{d['key']}", "label": f"{d['name']} team"} for d in departments(db)), {"value": "admin", "label": "Director"}]
    out_rules = []
    for k, (label, unit) in APPROVAL_KINDS.items():
        steps = rules.get(k) or [{"role": "manager"}]
        out_rules.append({"kind": k, "label": label, "unit": unit, "steps": [
            {"approver": s["role"], "label": approver_label(db, s["role"]),
             "over": s["over"] if s.get("over") not in (None, "") else (float(s["min"]) - (1 if unit == "days" else 0) if s.get("min") else None)}
            for s in steps]})
    return {"perms": [{"key": k, "label": lb, "group": g} for k, lb, g, _ in PERMS], "groups": GROUPS,
            "roles": [{"name": r["name"], "level": r["level"], "perms": for_role(db, r["name"], r["level"]), "locked": r["level"] == "admin",
                       "field": is_field_level(db, r["level"]),
                       "people": db.one("SELECT COUNT(*) AS n FROM users WHERE designation = ? AND active = 1", r["name"])["n"]} for r in rs],
            "rules": out_rules, "approvers": specs, "levels": lists.levels(db),
            "levelInfo": [{**lists.level_info(db, k), "defaults": defaults_for(k, db), "roles": sum(1 for r in rs if r["level"] == k)} for k in lists.levels(db)]}


# ------------------------------------------------------------------ API


def router(user_dep, db_dep) -> APIRouter:
    r = APIRouter(prefix="/api/admin/permissions")

    def director(user: dict) -> None:
        if user["role"] != "admin":
            raise HTTPException(403, "Only the director changes roles and permissions")

    @r.get("")
    def get_all(user: user_dep, db: db_dep):
        director(user)
        return overview(db)

    @r.post("/role")
    def set_perm(payload: dict, user: user_dep, db: db_dep):
        director(user)
        role = next((x for x in lists.roles(db) if x["name"] == payload.get("role")), None)
        key = payload.get("perm")
        if not role or key not in KEYS:
            raise HTTPException(404, "Unknown role or permission")
        if role["level"] == "admin":
            raise HTTPException(409, "Director-level roles always have every permission")
        if is_field_level(db, role["level"]):
            raise HTTPException(409, "Field-app designations use the simple phone app. Give the designation an office access level to give office tools")
        cur = set(for_role(db, role["name"], role["level"]))
        on = bool(payload.get("on"))
        (cur.add if on else cur.discard)(key)
        db.set_setting("role_perms", {**role_perms(db), role["name"]: [k for k in KEYS if k in cur]})
        label = next(p[1] for p in PERMS if p[0] == key)
        db.audit(user["id"], "permission", "role", role["name"], f"{label}: {'on' if on else 'off'}")
        return {"ok": True}

    @r.post("/level")
    def set_level(payload: dict, user: user_dep, db: db_dep):
        """Change a role's access level; everyone holding the role moves with it."""
        director(user)
        rs = lists.roles(db)
        role = next((x for x in rs if x["name"] == payload.get("role")), None)
        level = payload.get("level")
        if not role or level not in lists.levels(db):
            raise HTTPException(404, "Unknown designation or access level")
        if role["level"] == level:
            return {"ok": True}
        holders = db.all("SELECT id, role FROM users WHERE designation = ?", role["name"])
        if role["level"] == "admin":
            if any(h["id"] == user["id"] for h in holders):
                raise HTTPException(409, "This is your own role: you would lose the director's access")
            others = db.one("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND COALESCE(designation, '') <> ?", role["name"])["n"]
            if not others:
                raise HTTPException(409, "Keep at least one director")
        db.set_setting("roles", [{**x, "level": level} if x["name"] == role["name"] else x for x in rs])
        rp = role_perms(db)
        if role["name"] in rp:  # new level, fresh defaults
            db.set_setting("role_perms", {k: v for k, v in rp.items() if k != role["name"]})
        base, custom = lists.base_role(db, level), ("" if level in lists.LEVELS else level)
        for h in holders:
            db.update("users", h["id"], {"role": base, "level": custom})
        db.audit(user["id"], "role_level", "role", role["name"], f"{role['level']} -> {level} ({len(holders)} people)")
        return {"ok": True, "moved": len(holders)}

    # -------------------------------------------------------------- the director's own access levels

    def level_payload(payload: dict) -> dict:
        name = re.sub(r"\s+", " ", str(payload.get("name", ""))).strip()[:40]
        if len(name) < 2:
            raise HTTPException(422, "Give the access level a name")
        app = payload.get("app") if payload.get("app") in ("office", "field") else "office"
        sees = payload.get("sees") if payload.get("sees") in ("team", "company") else "team"
        ticks = [k for k in KEYS if k in (payload.get("perms") or [])]  # kept while the level is on the field app
        return {"name": name, "app": app, "sees": sees, "perms": ticks}

    @r.post("/levels/add")
    def level_add(payload: dict, user: user_dep, db: db_dep):
        director(user)
        lv = level_payload(payload)
        cur = lists.custom_levels(db)
        if any(n.lower() == lv["name"].lower() for n in lists.levels(db).values()):
            raise HTTPException(409, f"{lv['name']} already exists")
        key = "lv_" + (re.sub(r"[^a-z0-9]+", "_", lv["name"].lower()).strip("_")[:24] or "level")
        while key in lists.levels(db):
            key += "_"
        db.set_setting("access_levels", [*cur, {"key": key, **lv}])
        db.audit(user["id"], "level_add", "level", key, lv["name"])
        return {"ok": True, "key": key}

    @r.post("/levels/edit")
    def level_edit(payload: dict, user: user_dep, db: db_dep):
        """Rename a custom level, change what it sees, its app or its starting ticks; its people follow."""
        director(user)
        key = payload.get("key")
        cur = lists.custom_levels(db)
        old = next((x for x in cur if x["key"] == key), None)
        if not old:
            raise HTTPException(404, "Only access levels you added can be changed")
        lv = level_payload({**old, **payload})
        if any(n.lower() == lv["name"].lower() for k, n in lists.levels(db).items() if k != key):
            raise HTTPException(409, f"{lv['name']} already exists")
        db.set_setting("access_levels", [{"key": key, **lv} if x["key"] == key else x for x in cur])
        if lv["app"] != old.get("app"):  # office <-> field: move everyone holding a designation of this level
            names = [r["name"] for r in lists.roles(db) if r["level"] == key]
            for n in names:
                db.run("UPDATE users SET role = ? WHERE designation = ?", lists.base_role(db, key), n)
        db.audit(user["id"], "level_edit", "level", key, f"{old['name']} -> {lv['name']} · {lv['app']} · {lv['sees']}")
        return {"ok": True}

    @r.post("/levels/delete")
    def level_delete(payload: dict, user: user_dep, db: db_dep):
        director(user)
        key = payload.get("key")
        cur = lists.custom_levels(db)
        if not any(x["key"] == key for x in cur):
            raise HTTPException(404, "Only access levels you added can be deleted")
        used = [r["name"] for r in lists.roles(db) if r["level"] == key]
        if used:
            raise HTTPException(409, f"In use by {', '.join(used)}. Move those designations to another level first")
        if db.one("SELECT 1 FROM users WHERE level = ?", key):
            raise HTTPException(409, "Some people still have this level. Give them another designation first")
        db.set_setting("access_levels", [x for x in cur if x["key"] != key])
        db.audit(user["id"], "level_delete", "level", key, "")
        return {"ok": True}

    @r.post("/rules")
    def set_rules(payload: dict, user: user_dep, db: db_dep):
        director(user)
        kind = payload.get("kind")
        if kind not in APPROVAL_KINDS:
            raise HTTPException(404, "Unknown request type")
        unit = APPROVAL_KINDS[kind][1]
        steps = []
        for s in payload.get("steps") or []:
            spec = str(s.get("approver", ""))
            if not valid_spec(db, spec):
                raise HTTPException(422, "Choose who approves each step")
            over = s.get("over")
            if over in (None, ""):
                steps.append({"role": spec})
                continue
            try:
                over = float(over)
            except (TypeError, ValueError):
                raise HTTPException(422, "The limit must be a number") from None
            if over < 0 or not unit:
                raise HTTPException(422, "The limit must be zero or more" if unit else "Attendance corrections have no limit")
            steps.append({"role": spec, "over": int(over) if over == int(over) else over})
        if not steps:
            raise HTTPException(422, "Keep at least one approver")
        if steps[0].get("over") is not None:
            raise HTTPException(422, "The first approver decides every request: leave its limit empty")
        if len({(s["role"], s.get("over")) for s in steps}) < len(steps):
            raise HTTPException(422, "The same approver is listed twice")
        rules = modules.setting(db, "approval_chains")
        db.set_setting("approval_chains", {**rules, kind: steps})
        db.audit(user["id"], "approval_rules", "rules", kind, "; ".join(approver_label(db, s["role"]) + (f" over {s['over']}" if "over" in s else "") for s in steps))
        return {"ok": True}

    return r


def dept_add(db: Db, value: str, projects: list[str]) -> None:
    ds = departments(db)
    if any(d["name"].lower() == value.lower() for d in ds):
        raise HTTPException(409, f"{value} already exists")
    key = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")[:30] or "dept"
    while any(d["key"] == key for d in ds):
        key += "_"
    valid = set(lists.project_codes(db))
    projects = [p for p in projects if p in valid]
    taken = {p for d in ds for p in d["projects"]}
    if taken & set(projects):
        names = {p["key"]: p["name"] for p in lists.projects(db)}
        raise HTTPException(409, f"{', '.join(names[p] for p in taken & set(projects))} is already in another department")
    db.set_setting("departments", [*ds, {"key": key, "name": value, "projects": projects}])
