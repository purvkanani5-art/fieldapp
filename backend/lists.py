"""Editable lists (Settings > Lists): every dropdown the company may want to change: roles, reporting offices, projects,
leave types, travel vehicles and the option lists of the record forms. Items can be added and deleted; an item in use
cannot be deleted. Optional Gujarati / Hindi names are kept per item (`list_tr` setting) and merged into the app's
translations. Built-in projects (biochar, gasifier, agroforestry, management) can't be deleted: screens depend on them."""

import re

from fastapi import APIRouter, HTTPException

import modules
from db import Db

LEVELS = {"field": "Field staff", "manager": "Manager", "hr": "HR", "admin": "Director"}  # built in; users.role is one of these


def custom_levels(db: Db) -> list[dict]:
    """Access levels the director added (Settings > Designations & access), e.g. Finance & Accounts:
    {key, name, app: office | field, sees: team | company, perms: [starting ticks]}."""
    return db.setting("access_levels", []) or []


def levels(db: Db) -> dict[str, str]:
    return {**LEVELS, **{lv["key"]: lv["name"] for lv in custom_levels(db)}}


def level_info(db: Db, key: str) -> dict:
    if key in LEVELS:
        return {"key": key, "name": LEVELS[key], "app": "field" if key == "field" else "office", "sees": "company" if key in ("admin", "hr") else "team", "builtin": True}
    lv = next((x for x in custom_levels(db) if x["key"] == key), None)
    return {**lv, "builtin": False} if lv else {"key": key, "name": key, "app": "field", "sees": "team", "builtin": False, "missing": True}


def base_role(db: Db, level: str) -> str:
    """users.role for a level: a custom office level works as Manager (its own ticks and reach), a field one as Field staff."""
    if level in LEVELS:
        return level
    return "manager" if level_info(db, level)["app"] == "office" else "field"

# record-form option lists: key -> label, group, the (kind, field) pairs that use it
FORM_LISTS = {
    "holiday_type": ("Holiday types", "people", [("holiday", "type")]),
    "exit_reason": ("Exit reasons", "people", [("exit", "reason")]),
    "asset_category": ("Asset categories", "people", [("asset_issue", "category")]),
    "asset_condition": ("Asset condition", "people", [("asset_issue", "condition")]),
    "review_rating": ("Review ratings", "people", [("review", "rating")]),
    "expense_category": ("Expense categories", "money", [("expense", "category")]),
    "advance_type": ("Advance types", "money", [("advance", "type")]),
    "farmer_payment_purpose": ("Farmer payment purposes", "money", [("farmer_payment", "purpose")]),
    "payment_method": ("Payment methods", "money", [("farmer_payment", "mode")]),
    "incident_type": ("Incident types", "ops", [("incident", "type")]),
    "incident_severity": ("Incident severity", "ops", [("incident", "severity")]),
    "equipment_type": ("Equipment types", "ops", [("equipment", "type")]),
    "maintenance_type": ("Maintenance types", "ops", [("maintenance", "type")]),
    "feedstock": ("Feedstock types", "ops", [("batch", "feedstock_type")]),
    "species": ("Tree species", "ops", [("nursery", "species"), ("sapling", "species"), ("survival", "species")]),
    "application_method": ("Biochar application methods", "ops", [("application", "method")]),
}
GROUPS = {"people": "People", "money": "Money", "ops": "Operations"}
BUILTIN_PROJECTS = {"biochar": "BIO", "gasifier": "GAS", "agroforestry": "AGR"}
MANAGEMENT = {"key": "management", "name": "Management", "code": "ADM", "icon": "building", "builtin": True}
ICONS = ["flame", "cog", "tree", "leaf", "sprout", "sun", "box", "building", "pin", "fuel"]
PROJECT_DEFAULTS = {key: {k: v for k, v in p.items()} for key, p in modules.PROJECTS.items()}  # the built-ins as shipped


def _field(kind: str, key: str) -> dict:
    return next(f for f in modules.KINDS[kind]["fields"] if f["key"] == key)


def _profile_field(key: str) -> dict:
    return next(f for f in modules.PROFILE_FIELDS if f["key"] == key)


SHIPPED = {key: list(_field(*refs[0])["options"]) for key, (_, _, refs) in FORM_LISTS.items()} | {"employment": list(_profile_field("employment")["options"])}


def form_values(db: Db, key: str) -> list[str]:
    saved = (db.setting("lists", {}) or {}).get(key)
    return list(saved) if saved is not None else list(SHIPPED[key])


def roles(db: Db) -> list[dict]:
    r = db.setting("roles")
    if r is None:  # first run: one role per designation already in use, plus a few common ones
        seen, r = set(), []
        for u in db.all("SELECT designation, role FROM users WHERE COALESCE(designation, '') <> '' ORDER BY role = 'admin' DESC, designation"):
            if u["designation"] not in seen:
                seen.add(u["designation"])
                r.append({"name": u["designation"], "level": u["role"] if u["role"] in LEVELS else "field"})
        for name, level in (("Director", "admin"), ("Manager", "manager"), ("HR Executive", "hr"), ("Site Supervisor", "field"), ("Field worker", "field")):
            if name not in seen:
                r.append({"name": name, "level": level})
        db.set_setting("roles", r)
    return r


def projects(db: Db) -> list[dict]:
    """Every project with its employee-code prefix; built-ins first, management last."""
    custom = db.setting("projects_custom", []) or []
    out = [{"key": k, "name": p["name"], "code": BUILTIN_PROJECTS[k], "icon": p["icon"], "builtin": True} for k, p in PROJECT_DEFAULTS.items()]
    return out + [{**c, "builtin": False} for c in custom] + [MANAGEMENT]


# Sites sit in a project and, where the project has them, a sub-group (sites.subtype holds the key). Biochar's
# kiln / plant keys drive its tabs and words, so they can be renamed but not deleted. Offices may have sub-groups too.
SUBGROUP_DEFAULTS = {
    "biochar": [{"key": "kiln", "name": "Low-tech (kilns)"}, {"key": "plant", "name": "High-tech (industrial plant)"}],
    "agroforestry": [{"key": "trust", "name": "Trust land"}, {"key": "farmer", "name": "Farmer land"}, {"key": "retro", "name": "Retro agroforestry"}],
}
FIXED_SUBGROUPS = {("biochar", "kiln"), ("biochar", "plant")}


def subgroups(db: Db) -> dict[str, list[dict]]:
    saved = db.setting("subgroups")
    return saved if isinstance(saved, dict) else {k: [dict(x) for x in v] for k, v in SUBGROUP_DEFAULTS.items()}


def project_codes(db: Db) -> dict[str, str]:
    return {p["key"]: p["code"] for p in projects(db)}


def sync(db: Db) -> None:
    """Make the in-memory definitions follow the saved lists (one server process, so this is enough)."""
    for k in list(modules.PROJECTS):
        if k not in PROJECT_DEFAULTS:
            del modules.PROJECTS[k]
    for c in db.setting("projects_custom", []) or []:
        modules.PROJECTS[c["key"]] = {"name": c["name"], "icon": c.get("icon") or "pin", "tone": "", "blurb": c.get("blurb", "")}
    sg = subgroups(db)
    for k, p in modules.PROJECTS.items():
        if sg.get(k):
            p["subtypes"] = {x["key"]: x["name"] for x in sg[k]}
        else:
            p.pop("subtypes", None)
    for key, (_, _, refs) in FORM_LISTS.items():
        vals = form_values(db, key)
        for kind, field in refs:
            _field(kind, field)["options"] = vals
    _profile_field("employment")["options"] = form_values(db, "employment")


def usage(db: Db, key: str, value: str) -> int:
    if key in FORM_LISTS:
        return sum(db.one("SELECT COUNT(*) AS n FROM records WHERE kind = ? AND json_extract(data, ?) = ?", kind, f"$.{field}", value)["n"]
                   for kind, field in FORM_LISTS[key][2])
    if key == "employment":
        return db.one("SELECT COUNT(*) AS n FROM records WHERE kind = 'profile' AND json_extract(data, '$.employment') = ?", value)["n"]
    if key == "leave_types":
        return db.one("SELECT COUNT(*) AS n FROM leaves WHERE type = ?", value)["n"]
    if key == "vehicles":
        return db.one("SELECT COUNT(*) AS n FROM trips WHERE vehicle = ?", value)["n"]
    if key == "roles":
        return db.one("SELECT COUNT(*) AS n FROM users WHERE designation = ?", value)["n"]
    if key == "offices":
        codes = set(project_codes(db).values())
        return sum(1 for u in db.all("SELECT employee_id FROM users") if re.fullmatch(r"[A-Z]{3}(\d{2})\d{3,}", u["employee_id"] or "")
                   and u["employee_id"][:3] in codes and u["employee_id"][3:5] == value)
    if key == "departments":
        import perms

        return perms.dept_usage(db, value)
    if key == "projects":
        code = project_codes(db).get(value, "")
        return (db.one("SELECT COUNT(*) AS n FROM sites WHERE project_type = ?", value)["n"]
                + db.one("SELECT COUNT(*) AS n FROM user_projects WHERE project = ?", value)["n"]
                + sum(1 for u in db.all("SELECT employee_id FROM users WHERE employee_id LIKE ?", code + "%") if re.fullmatch(re.escape(code) + r"\d{5,}", u["employee_id"])))
    return 0


def all_lists(db: Db) -> list[dict]:
    """Everything the Lists tab shows: items with use counts. `who` = roles that may edit."""
    tr = db.setting("list_tr", {}) or {}

    def items(key, rows):
        return [{**r, "used": usage(db, key, r["value"]), **({"gu": tr[r["value"]].get("gu", ""), "hi": tr[r["value"]].get("hi", "")} if r["value"] in tr else {})} for r in rows]

    travel = db.setting("travel", {"vehicles": {}}) or {"vehicles": {}}
    out = [
        {"key": "roles", "label": "Designations", "group": "people", "who": ["admin", "hr"], "hint": "Job titles. Each has an access level that decides what the person can see and do",
         "items": items("roles", [{"value": r["name"], "level": r["level"]} for r in roles(db)])},
        {"key": "offices", "label": "Reporting offices", "group": "people", "who": ["admin", "hr"], "hint": "The 2-digit number is the middle of the employee code: BIO01001",
         "items": items("offices", [{"value": o["code"], "name": o["name"]} for o in db.setting("offices", []) or []])},
        {"key": "projects", "label": "Projects", "group": "people", "who": ["admin"], "hint": "The 3-letter code starts the employee code; built-in projects stay",
         "items": [{"value": p["key"], "name": p["name"], "code": p["code"], "icon": p["icon"], "builtin": p["builtin"], "used": usage(db, "projects", p["key"])} for p in projects(db)]},
        {"key": "departments", "label": "Departments", "group": "people", "who": ["admin"], "hint": "Projects in each department. Approval rules can send a request to a department's team",
         "items": [{"value": d["key"], "name": d["name"], "projects": d["projects"], "used": usage(db, "departments", d["key"])} for d in _departments(db)]},
        {"key": "leave_types", "label": "Leave types", "group": "people", "who": ["admin", "hr"], "items": items("leave_types", [{"value": v} for v in db.setting("leave_types", []) or []])},
        {"key": "employment", "label": "Employment types", "group": "people", "who": ["admin", "hr"], "items": items("employment", [{"value": v} for v in form_values(db, "employment")])},
        {"key": "vehicles", "label": "Travel vehicles and rate per km", "group": "money", "who": ["admin"],
         "items": items("vehicles", [{"value": k, "rate": v} for k, v in travel["vehicles"].items()])},
    ]
    for key, (label, group, _) in FORM_LISTS.items():
        who = ["admin", "hr"] if group == "people" else ["admin"]
        out.append({"key": key, "label": label, "group": group, "who": who, "items": items(key, [{"value": v} for v in form_values(db, key)])})
    order = list(GROUPS)
    return sorted(out, key=lambda x: order.index(x["group"]))


def _departments(db: Db) -> list[dict]:
    import perms

    return perms.departments(db)


def allowed(user: dict, lst: dict) -> bool:
    """The director edits every list; a role with "Edit lists" edits the HR-side ones."""
    import perms

    return user["role"] == "admin" or ("hr" in lst["who"] and perms.can(user, "settings.lists"))


def boot_extra(db: Db) -> dict:
    """What every screen needs: roles, projects with codes, departments, translations of added items."""
    return {"roles": roles(db), "projectList": projects(db), "departments": _departments(db), "listTr": db.setting("list_tr", {}) or {}, "subgroups": subgroups(db),
            "levels": [level_info(db, k) for k in levels(db)]}


def router(user_dep, db_dep) -> APIRouter:
    r = APIRouter(prefix="/api/admin/lists")

    def find(db: Db, user: dict, key: str) -> dict:
        lst = next((x for x in all_lists(db) if x["key"] == key), None)
        if not lst:
            raise HTTPException(404, "Unknown list")
        if not allowed(user, lst):
            raise HTTPException(403, "Only the director can change this list")
        return lst

    def save_tr(db: Db, value: str, payload: dict) -> None:
        gu, hi = str(payload.get("gu", "")).strip()[:120], str(payload.get("hi", "")).strip()[:120]
        tr = db.setting("list_tr", {}) or {}
        if gu or hi:
            tr[value] = {"gu": gu, "hi": hi}
            db.set_setting("list_tr", tr)

    @r.get("")
    def get_lists(user: user_dep, db: db_dep):
        out = [x for x in all_lists(db) if allowed(user, x)]
        if not out:
            raise HTTPException(403, "Your role may not edit lists")
        return {"lists": out, "groups": GROUPS, "levels": levels(db), "icons": ICONS}

    @r.post("/departments/project")
    def dept_project(payload: dict, user: user_dep, db: db_dep):
        """Put a project in a department (it leaves its old one) or take it out."""
        find(db, user, "departments")
        ds = _departments(db)
        d = next((x for x in ds if x["key"] == payload.get("value")), None)
        proj = payload.get("project")
        if not d or proj not in project_codes(db):
            raise HTTPException(404, "Not found")
        for x in ds:
            x["projects"] = [q for q in x["projects"] if q != proj]
        if payload.get("on"):
            d["projects"].append(proj)
        db.set_setting("departments", ds)
        db.audit(user["id"], "department_projects", "list", d["name"], f"{proj} {'in' if payload.get('on') else 'out'}")
        return {"ok": True}

    @r.post("/{key}/add")
    def add(key: str, payload: dict, user: user_dep, db: db_dep):
        find(db, user, key)
        value = re.sub(r"\s+", " ", str(payload.get("value", ""))).strip()[:60]
        if key == "offices":
            code = str(payload.get("value", "")).strip().zfill(2)
            name = str(payload.get("name", "")).strip()[:60]
            if not re.fullmatch(r"\d{2}", code) or code == "00":
                raise HTTPException(422, "Office number must be two digits, 01 to 99")
            if not name:
                raise HTTPException(422, "Give the office a name")
            offices = db.setting("offices", []) or []
            if any(o["code"] == code for o in offices):
                raise HTTPException(409, f"Office {code} already exists")
            db.set_setting("offices", sorted([*offices, {"code": code, "name": name}], key=lambda o: o["code"]))
            save_tr(db, name, payload)
        elif key == "projects":
            code = str(payload.get("code", "")).strip().upper()
            if len(value) < 2:
                raise HTTPException(422, "Give the project a name")
            if not re.fullmatch(r"[A-Z]{3}", code):
                raise HTTPException(422, "The project code must be 3 letters, e.g. SOL")
            existing = projects(db)
            if any(p["code"] == code for p in existing):
                raise HTTPException(409, f"Code {code} is already used")
            pkey = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")[:30] or code.lower()
            if pkey in {p["key"] for p in existing} or pkey == "office":
                raise HTTPException(409, f"{value} already exists")
            icon = payload.get("icon") if payload.get("icon") in ICONS else "pin"
            db.set_setting("projects_custom", [*(db.setting("projects_custom", []) or []), {"key": pkey, "name": value, "code": code, "icon": icon}])
            save_tr(db, value, payload)
        else:
            if not value:
                raise HTTPException(422, "Type a name")
            if key == "roles":
                level = payload.get("level")
                if level not in levels(db):
                    raise HTTPException(422, "Choose the access level")
                if level == "admin" and user["role"] != "admin":
                    raise HTTPException(403, "Only the director can add a director-level role")
                rs = roles(db)
                if any(x["name"].lower() == value.lower() for x in rs):
                    raise HTTPException(409, f"{value} already exists")
                db.set_setting("roles", [*rs, {"name": value, "level": level}])
            elif key == "departments":
                import perms

                perms.dept_add(db, value, [str(x) for x in payload.get("projects") or []])
            elif key == "vehicles":
                travel = db.setting("travel", {"vehicles": {}, "currency": "₹"}) or {"vehicles": {}}
                try:
                    rate = float(payload.get("rate"))
                except (TypeError, ValueError):
                    raise HTTPException(422, "Give the rate per km") from None
                if value in travel["vehicles"]:
                    raise HTTPException(409, f"{value} already exists")
                travel["vehicles"][value] = rate
                db.set_setting("travel", travel)
            else:
                cur = db.setting("leave_types", []) if key == "leave_types" else form_values(db, key)
                if any(v.lower() == value.lower() for v in cur):
                    raise HTTPException(409, f"{value} already exists")
                if key == "leave_types":
                    db.set_setting("leave_types", [*cur, value])
                else:
                    db.set_setting("lists", {**(db.setting("lists", {}) or {}), key: [*cur, value]})
            save_tr(db, value, payload)
        sync(db)
        db.audit(user["id"], "list_add", "list", key, value or str(payload.get("value", "")))
        return {"ok": True}

    @r.post("/{key}/rename")
    def rename(key: str, payload: dict, user: user_dep, db: db_dep):
        """Change only the name: departments and offices keep their key / number, a designation moves its people,
        ticks and approval steps to the new name."""
        lst = find(db, user, key)
        value = str(payload.get("value", ""))
        new = re.sub(r"\s+", " ", str(payload.get("name", ""))).strip()[:60]
        item = next((i for i in lst["items"] if i["value"] == value), None)
        if not item:
            raise HTTPException(404, "Not found")
        if len(new) < 2:
            raise HTTPException(422, "Type the new name")
        old = item.get("name") or value
        if new == old:
            return {"ok": True}
        if key == "departments":
            ds = _departments(db)
            if any(d["name"].lower() == new.lower() and d["key"] != value for d in ds):
                raise HTTPException(409, f"{new} already exists")
            db.set_setting("departments", [{**d, "name": new} if d["key"] == value else d for d in ds])
        elif key == "offices":
            offs = db.setting("offices", []) or []
            if any(o["name"].lower() == new.lower() and o["code"] != value for o in offs):
                raise HTTPException(409, f"{new} already exists")
            db.set_setting("offices", [{**o, "name": new} if o["code"] == value else o for o in offs])
        elif key == "roles":
            rs = roles(db)
            if item.get("level") == "admin" and user["role"] != "admin":
                raise HTTPException(403, "Only the director renames a director-level designation")
            if any(x["name"].lower() == new.lower() for x in rs if x["name"] != value):
                raise HTTPException(409, f"{new} already exists")
            db.set_setting("roles", [{**x, "name": new} if x["name"] == value else x for x in rs])
            db.run("UPDATE users SET designation = ? WHERE designation = ?", new, value)
            rp = db.setting("role_perms", {}) or {}
            rp.pop(new, None)  # a leftover entry under the new name must not win
            if value in rp:
                rp[new] = rp.pop(value)
            db.set_setting("role_perms", rp)
            rules = modules.setting(db, "approval_chains")
            db.set_setting("approval_chains", {k: [{**s, "role": f"role:{new}"} if s.get("role") == f"role:{value}" else s for s in steps] for k, steps in rules.items()})
            db.run("UPDATE approval_steps SET role = ? WHERE role = ?", f"role:{new}", f"role:{value}")
        else:
            raise HTTPException(409, "This list cannot be renamed; add a new item instead")
        tr = db.setting("list_tr", {}) or {}
        if old in tr:  # the Gujarati / Hindi names follow
            tr[new] = tr.pop(old)
            db.set_setting("list_tr", tr)
        sync(db)
        db.audit(user["id"], "list_rename", "list", key, f"{old} -> {new}")
        import hrops

        hrops.log_change(db, user["id"], "list", key, None, lst["label"], old, new, "renamed")
        return {"ok": True}

    @r.post("/{key}/delete")
    def delete(key: str, payload: dict, user: user_dep, db: db_dep):
        lst = find(db, user, key)
        value = str(payload.get("value", ""))
        item = next((i for i in lst["items"] if i["value"] == value), None)
        if not item:
            raise HTTPException(404, "Not found")
        if item.get("builtin"):
            raise HTTPException(409, f"{item.get('name', value)} is built in and stays")
        if item["used"]:
            raise HTTPException(409, f"{item.get('name', value)} is in use ({item['used']}) and cannot be deleted")
        if len(lst["items"]) <= 1:
            raise HTTPException(409, "Keep at least one item in the list")
        if key == "roles":
            db.set_setting("roles", [x for x in roles(db) if x["name"] != value])
            rp = db.setting("role_perms", {}) or {}
            if value in rp:
                db.set_setting("role_perms", {k: v for k, v in rp.items() if k != value})
        elif key == "departments":
            db.set_setting("departments", [d for d in _departments(db) if d["key"] != value])
        elif key == "offices":
            db.set_setting("offices", [o for o in db.setting("offices", []) if o["code"] != value])
        elif key == "projects":
            db.set_setting("projects_custom", [p for p in db.setting("projects_custom", []) if p["key"] != value])
        elif key == "vehicles":
            travel = db.setting("travel")
            travel["vehicles"].pop(value, None)
            db.set_setting("travel", travel)
        elif key == "leave_types":
            db.set_setting("leave_types", [v for v in db.setting("leave_types", []) if v != value])
        else:
            db.set_setting("lists", {**(db.setting("lists", {}) or {}), key: [v for v in form_values(db, key) if v != value]})
        sync(db)
        db.audit(user["id"], "list_delete", "list", key, value)
        return {"ok": True}


    # -------------------------------------------------------------- site sub-groups (Settings > Lists)
    def sg_project(db: Db, user: dict, payload: dict) -> tuple[str, dict]:
        import perms

        perms.need(user, "sites.edit")
        proj = str(payload.get("project", ""))
        if proj != "office" and proj not in project_codes(db):
            raise HTTPException(422, "Choose the project")
        return proj, subgroups(db)

    @r.post("/subgroups")
    def subgroup_save(payload: dict, user: user_dep, db: db_dep):
        """Add a sub-group to a project, or rename one (key given)."""
        proj, sg = sg_project(db, user, payload)
        name = str(payload.get("name", "")).strip()[:40]
        if len(name) < 2:
            raise HTTPException(422, "Give the sub-group a name")
        cur = sg.get(proj, [])
        key = str(payload.get("key") or "")
        if any(x["name"].lower() == name.lower() and x["key"] != key for x in cur):
            raise HTTPException(409, f"{name} already exists")
        if key:
            if not any(x["key"] == key for x in cur):
                raise HTTPException(404, "Sub-group not found")
            cur = [{**x, "name": name} if x["key"] == key else x for x in cur]
        else:
            key = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")[:20] or "group"
            while any(x["key"] == key for x in cur):
                key = f"{key[:17]}_{len(cur) + 1}"
            cur = [*cur, {"key": key, "name": name}]
        db.set_setting("subgroups", {**sg, proj: cur})
        sync(db)
        db.audit(user["id"], "subgroup_saved", "project", proj, name)
        return {"key": key}

    @r.post("/subgroups/remove")
    def subgroup_delete(payload: dict, user: user_dep, db: db_dep):
        proj, sg = sg_project(db, user, payload)
        key = str(payload.get("key", ""))
        if (proj, key) in FIXED_SUBGROUPS:
            raise HTTPException(409, "Low-tech and high-tech biochar can be renamed but not removed")
        db.set_setting("subgroups", {**sg, proj: [x for x in sg.get(proj, []) if x["key"] != key]})
        sync(db)  # sites in it show under "Sub-group not set" until they are edited
        db.audit(user["id"], "subgroup_deleted", "project", proj, key)
        return {"ok": True}

    return r
