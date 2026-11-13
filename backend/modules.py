"""Kshetralekha prototype modules beyond field evidence: core HR, money, operations and the carbon chain.

Most of them are plain records described by KINDS (fields, who may create, who may see, approval chain) and kept
in one `records` table as JSON, so one set of endpoints and one front-end screen serve them all. The parts with
real logic have their own functions: approval chains, leave balances, the monthly attendance summary, payroll
(PF, ESI, Gujarat professional tax, TDS estimate, payslip PDFs, bank file, Tally XML), production batches and
stock postings, the carbon chain of custody, map data, recurring checklists, incidents with follow-up tasks,
admin two-step sign-in (TOTP) and a simulated WhatsApp/SMS outbox.

Prototype rules: numbers are realistic but simplified (see each function); nothing here files anything with a
government portal or sends a real message.
"""

import base64
import calendar
import csv
import hashlib
import hmac
import io
import json
import secrets
import struct
import time
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from starlette.datastructures import UploadFile as FormFile

from db import NO_ID_TABLES, Db, now_iso
from geo import haversine_m, kml_summary
from storage import store

NO_ID_TABLES.add("user_totp")

SCHEMA = """
CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT DEFAULT '', site_id TEXT, user_id TEXT, status TEXT DEFAULT 'open',
  data TEXT NOT NULL DEFAULT '{}', file_id TEXT, lat REAL, lng REAL, created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rec_kind ON records (kind, created_at);
CREATE INDEX IF NOT EXISTS idx_rec_user ON records (user_id);
CREATE TABLE IF NOT EXISTS approval_steps (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, ref_id TEXT NOT NULL, step INTEGER NOT NULL, role TEXT NOT NULL, approver_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued', decided_by TEXT, decided_at TEXT, note TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_steps_ref ON approval_steps (kind, ref_id);
CREATE TABLE IF NOT EXISTS message_log (
  id TEXT PRIMARY KEY, channel TEXT NOT NULL, user_id TEXT, to_name TEXT DEFAULT '', to_phone TEXT DEFAULT '', text TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_totp (user_id TEXT PRIMARY KEY, secret TEXT NOT NULL, enabled INTEGER DEFAULT 0);
"""

MIGRATIONS = [
    "ALTER TABLE users ADD COLUMN manager_id TEXT",
    "ALTER TABLE users ADD COLUMN consent_at TEXT",
    "ALTER TABLE sites ADD COLUMN strict INTEGER DEFAULT 0",
    "ALTER TABLE attendance ADD COLUMN flag TEXT DEFAULT ''",
    "ALTER TABLE sites ADD COLUMN subtype TEXT DEFAULT ''",
    "CREATE TABLE IF NOT EXISTS user_projects (user_id TEXT NOT NULL, project TEXT NOT NULL, PRIMARY KEY (user_id, project))",
]

PROJECTS = {
    "biochar": {"name": "Biochar", "icon": "flame", "tone": "earth", "blurb": "Kiln sites and industrial plants: biomass in, biochar out, lab-tested and applied on farms",
                "subtypes": {"kiln": "Low-tech · kilns", "plant": "High-tech · industrial plant"}},
    "gasifier": {"name": "Gasifier", "icon": "cog", "tone": "blue", "blurb": "Biomass gasifiers making power: feedstock, run hours, kWh, ash"},
    "agroforestry": {"name": "Agroforestry", "icon": "tree", "tone": "", "blurb": "Nurseries, plantation on farmers' land, survival and farmer records"},
}


def team_ids(db: Db, user: dict) -> set | None:
    """People a person may see records of: None means everyone (director, HR); otherwise people at their sites, their reports, themselves."""
    if user.get("all_sites"):
        return None
    sites = set(user.get("sites") or [])
    ids = {r["user_id"] for r in db.all("SELECT user_id, site_id FROM user_sites") if r["site_id"] in sites}
    ids |= {r["id"] for r in db.all("SELECT id FROM users WHERE manager_id = ?", user["id"])}
    ids.add(user["id"])
    return ids

DEFAULTS = {
    "approval_chains": {
        "leave": [{"role": "manager"}, {"role": "hr", "min": 3}],
        "expense": [{"role": "manager"}, {"role": "hr", "min": 2000}],
        "advance": [{"role": "manager"}, {"role": "admin"}],
        "farmer_payment": [{"role": "manager"}, {"role": "admin", "min": 25000}],
        "purchase_request": [{"role": "manager"}, {"role": "admin", "min": 20000}],
        "regularisation": [{"role": "manager"}],
    },
    "leave_policy": {
        "Casual": {"per_year": 12, "accrual": "monthly"},
        "Sick": {"per_year": 8, "accrual": "yearly"},
        "Earned": {"per_year": 15, "accrual": "monthly"},
        "Unpaid": {"per_year": 0, "accrual": "none"},
    },
    "work_hours": {"start": "09:00", "end": "18:00", "grace_min": 15, "half_day_hours": 4.5, "full_day_hours": 9, "weekly_off": [6]},
    "retention": {"photos_years": 8, "attendance_years": 3, "farmer_documents_years": 10},
    "messaging": {"whatsapp": True, "sms": False},
}

# ------------------------------------------------------------------ record kinds


def F(key: str, label: str, type: str = "text", **kw) -> dict:  # noqa: A002
    return {"key": key, "label": label, "type": type, **kw}


KINDS: dict[str, dict] = {
    # ---------- people
    "holiday": {"label": "Holidays", "one": "Holiday", "group": "hr", "icon": "calendar", "create": "hr", "scope": "all", "title": "name",
                "fields": [F("date", "Date", "date", required=True), F("name", "Holiday", required=True), F("type", "Type", "select", options=["National", "Festival", "Optional"])]},
    "shift": {"label": "Shifts", "one": "Shift", "group": "hr", "icon": "clock", "create": "hr", "scope": "all", "title": "name",
              "fields": [F("name", "Shift name", required=True), F("start", "Starts", "time", required=True), F("end", "Ends", "time", required=True),
                         F("weekly_off", "Weekly off", "select", options=["Sunday", "Saturday", "Friday"]), F("site", "Site", "site")]},
    "regularisation": {"label": "Attendance corrections", "one": "Attendance correction", "group": "hr", "icon": "clock", "create": "all", "scope": "own",
                       "approval": "regularisation", "title": "date",
                       "fields": [F("date", "Day", "date", required=True), F("in_time", "Came in at", "time", required=True), F("out_time", "Left at", "time", required=True),
                                  F("site", "Site", "site"), F("reason", "Why the record is wrong", "textarea", required=True)]},
    "asset_issue": {"label": "Assets issued", "one": "Asset", "group": "hr", "icon": "box", "create": "staff", "scope": "own", "title": "asset",
                    "statuses": ["issued", "returned", "lost"],
                    "fields": [F("asset", "Asset", required=True), F("category", "Category", "select", options=["Phone", "Safety kit", "Tool", "Laptop", "Vehicle", "Uniform"]),
                               F("serial", "Serial / IMEI"), F("person", "Issued to", "user", required=True), F("issued_on", "Issued on", "date"),
                               F("value", "Value", "money"), F("condition", "Condition", "select", options=["New", "Good", "Fair", "Damaged"]), F("returned_on", "Returned on", "date")]},
    "training": {"label": "Training & certificates", "one": "Training", "group": "hr", "icon": "shield", "create": "staff", "scope": "own", "title": "title", "photo": "Certificate",
                 "fields": [F("title", "Training", required=True), F("person", "Person", "user", required=True), F("provider", "Given by"),
                            F("completed_on", "Completed on", "date"), F("valid_until", "Valid until", "date")]},
    "goal": {"label": "Goals", "one": "Goal", "group": "hr", "icon": "target", "create": "staff", "scope": "own", "title": "title", "statuses": ["on track", "at risk", "done"],
             "fields": [F("person", "Person", "user", required=True), F("title", "Goal", required=True), F("target", "Measure of success"),
                        F("due", "Due", "date"), F("weight", "Weight %", "number"), F("progress", "Progress %", "number")]},
    "review": {"label": "Performance reviews", "one": "Review", "group": "hr", "icon": "chart", "create": "staff", "scope": "own", "title": "period",
               "fields": [F("person", "Person", "user", required=True), F("period", "Period", required=True, placeholder="e.g. Apr–Sep 2026"),
                          F("rating", "Rating", "select", options=["5 Outstanding", "4 Exceeds", "3 Meets", "2 Needs work", "1 Unsatisfactory"]),
                          F("strengths", "Strengths", "textarea"), F("improve", "To improve", "textarea")]},
    "policy": {"label": "Policies", "one": "Policy", "group": "hr", "icon": "doc", "create": "hr", "scope": "all", "title": "title",
               "fields": [F("title", "Policy", required=True), F("version", "Version"), F("body", "Text", "textarea", required=True),
                          F("must_ack", "Everyone must accept", "select", options=["Yes", "No"])]},
    "onboarding": {"label": "Onboarding", "one": "Joiner", "group": "hr", "icon": "users", "create": "hr", "scope": "staff", "title": "name", "statuses": ["in progress", "done"],
                   "fields": [F("name", "New joiner", required=True), F("role", "Role"), F("site", "Site", "site"), F("joining_date", "Joining date", "date"),
                              F("checklist", "Checklist", "checklist", default="Offer letter signed\nID and address proof collected\nBank details and PAN\nUAN / ESIC registration\nPhone and app PIN issued\nSafety induction\nSite introduction")]},
    "exit": {"label": "Exits & settlement", "one": "Exit", "group": "hr", "icon": "logout", "create": "hr", "scope": "staff", "title": "person", "statuses": ["in progress", "settled"],
             "fields": [F("person", "Employee", "user", required=True), F("last_day", "Last working day", "date"), F("reason", "Reason", "select", options=["Resigned", "Contract ended", "Terminated", "Retired"]),
                        F("checklist", "Checklist", "checklist", default="Assets returned\nAdvance recovered\nLeave encashment worked out\nFinal salary\nExperience letter\nApp access removed"),
                        F("settlement", "Final settlement", "money")]},
    "labour": {"label": "Contract labour register", "one": "Labour entry", "group": "hr", "icon": "users", "create": "staff", "scope": "site", "title": "worker",
               "fields": [F("worker", "Worker", required=True), F("contractor", "Contractor"), F("site", "Site", "site", required=True), F("month", "Month", placeholder="2026-11"),
                          F("days", "Days worked", "number"), F("rate", "Daily wage", "money"), F("paid", "Wages paid", "money")]},
    # ---------- money
    "expense": {"label": "Expense claims", "one": "Expense claim", "group": "money", "icon": "receipt", "create": "all", "scope": "own", "approval": "expense", "title": "category",
                "photo": "Receipt", "amount": "amount",
                "fields": [F("date", "Date", "date", required=True), F("category", "Category", "select", options=["Food", "Lodging", "Fuel", "Materials", "Repairs", "Phone", "Other"], required=True),
                           F("amount", "Amount", "money", required=True), F("site", "Site", "site"), F("description", "What for", "textarea", required=True)]},
    "advance": {"label": "Advances & loans", "one": "Advance", "group": "money", "icon": "receipt", "create": "all", "scope": "own", "approval": "advance", "title": "type", "amount": "amount",
                "fields": [F("type", "Type", "select", options=["Salary advance", "Loan"], required=True), F("amount", "Amount", "money", required=True),
                           F("recover_months", "Recover over (months)", "number", default="3"), F("purpose", "Purpose", "textarea", required=True)]},
    "farmer_payment": {"label": "Farmer payments", "one": "Farmer payment", "group": "money", "icon": "sprout", "create": "staff", "scope": "site", "approval": "farmer_payment",
                       "title": "farmer", "amount": "amount", "photo": "Proof of payment",
                       "fields": [F("farmer", "Farmer", "farmer", required=True), F("amount", "Amount", "money", required=True),
                                  F("purpose", "For", "select", options=["Sapling incentive", "Carbon revenue share", "Biomass purchase", "Labour", "Other"]),
                                  F("mode", "Paid by", "select", options=["UPI", "Bank transfer", "Cash"]), F("reference", "UTR / reference"), F("date", "Date", "date")]},
    # ---------- operations
    "checklist_template": {"label": "Checklist templates", "one": "Checklist template", "group": "ops", "icon": "checklist", "create": "staff", "scope": "all", "title": "name",
                           "fields": [F("name", "Checklist", required=True), F("site", "Site", "site"), F("frequency", "Repeats", "select", options=["Daily", "Weekly", "Monthly"]),
                                      F("items", "Items, one per line", "textarea", required=True)]},
    "checklist_run": {"label": "Checklists done", "one": "Checklist", "group": "ops", "icon": "checklist", "create": "all", "scope": "site", "title": "name", "photo": "Photo", "hidden": True,
                      "fields": [F("template", "Checklist", "ref", ref="checklist_template", required=True), F("site", "Site", "site"), F("answers", "Answers", "answers")]},
    "incident": {"label": "Incidents", "one": "Incident", "group": "ops", "icon": "alert", "create": "all", "scope": "site", "title": "type", "photo": "Photo", "geo": True,
                 "statuses": ["open", "investigating", "closed"],
                 "fields": [F("date", "When", "datetime", required=True), F("type", "Type", "select", options=["Injury", "Near miss", "Fire", "Spill / pollution", "Equipment damage", "Health"], required=True),
                            F("severity", "Severity", "select", options=["Low", "Medium", "High", "Critical"], required=True), F("site", "Site", "site", required=True),
                            F("description", "What happened", "textarea", required=True), F("injured", "Who was hurt (if anyone)"), F("action", "Immediate action taken", "textarea"),
                            F("root_cause", "Root cause (after investigation)", "textarea")]},
    "equipment": {"label": "Equipment", "one": "Equipment", "group": "ops", "icon": "cog", "create": "staff", "scope": "site", "title": "name",
                  "statuses": ["working", "needs service", "breakdown"],
                  "fields": [F("name", "Name", required=True), F("type", "Type", "select", options=["Kiln", "Gasifier", "Generator", "Loader", "Shredder", "Pump", "Vehicle", "Other"]),
                             F("site", "Site", "site", required=True), F("serial", "Serial no"), F("service_days", "Service every (days)", "number"), F("last_service", "Last service", "date")]},
    "maintenance": {"label": "Maintenance log", "one": "Maintenance entry", "group": "ops", "icon": "cog", "create": "all", "scope": "site", "title": "type", "photo": "Photo",
                    "fields": [F("equipment", "Equipment", "ref", ref="equipment", required=True), F("date", "Date", "date", required=True),
                               F("type", "Type", "select", options=["Preventive service", "Breakdown repair", "Inspection"], required=True), F("description", "Work done", "textarea", required=True),
                               F("downtime", "Downtime (hours)", "number"), F("cost", "Cost", "money"), F("result", "Equipment now", "select", options=["working", "needs service", "breakdown"])]},
    "batch": {"label": "Production batches", "one": "Production batch", "group": "carbon", "icon": "flame", "create": "all", "scope": "site", "title": "code", "photo": "Photo",
              "statuses": ["produced", "tested", "applied"],
              "fields": [F("site", "Site", "site", required=True), F("equipment", "Kiln / unit", "ref", ref="equipment"), F("start", "Started", "datetime", required=True),
                         F("end", "Finished", "datetime"), F("feedstock_type", "Feedstock", "select", options=["Cotton stalk", "Groundnut shell", "Pigeon pea stalk", "Prosopis wood", "Rice husk", "Mixed"]),
                         F("feedstock_kg", "Feedstock used (kg)", "number", required=True), F("moisture", "Feedstock moisture %", "number"),
                         F("output_kg", "Biochar out (kg)", "number", required=True), F("peak_temp", "Peak temperature °C", "number"),
                         F("run_hours", "Run hours (plants)", "number"), F("power_kwh", "Power used kWh (plants)", "number"), F("notes", "Notes", "textarea")]},
    "gas_run": {"label": "Gasifier runs", "one": "Gasifier run", "group": "ops", "icon": "cog", "create": "all", "scope": "site", "title": "date", "photo": "Energy meter",
                "fields": [F("site", "Site", "site", required=True), F("equipment", "Gasifier", "ref", ref="equipment"), F("date", "Date", "date", required=True),
                           F("run_hours", "Run hours", "number", required=True), F("feedstock_kg", "Feedstock used (kg)", "number", required=True),
                           F("power_kwh", "Power generated (kWh)", "number", required=True), F("ash_kg", "Ash / char out (kg)", "number"),
                           F("diesel_l", "Diesel for start-up (L)", "number"), F("notes", "Stoppages, issues", "textarea")]},
    "nursery": {"label": "Nursery register", "one": "Nursery entry", "group": "carbon", "icon": "sprout", "create": "all", "scope": "site", "title": "species", "photo": "Photo",
                "fields": [F("site", "Nursery site", "site", required=True), F("species", "Species", "select", options=["Teak", "Mango", "Drumstick", "Neem", "Melia dubia", "Bamboo", "Lemon"], required=True),
                           F("action", "Entry", "select", options=["Seeds sown", "Saplings received", "Died or culled"], required=True),
                           F("qty", "Number of plants", "number", required=True), F("date", "Date", "date", required=True), F("source", "Source / bed no")]},
    "lab_result": {"label": "Lab results", "one": "Lab result", "group": "carbon", "icon": "scale", "create": "staff", "scope": "site", "title": "lab", "photo": "Lab report",
                   "fields": [F("batch", "Batch", "ref", ref="batch", required=True), F("lab", "Laboratory", required=True), F("sample_date", "Sampled on", "date"),
                              F("carbon", "Organic carbon %", "number", required=True), F("h_corg", "H/Corg ratio", "number"), F("ash", "Ash %", "number"), F("ph", "pH", "number"),
                              F("result", "Result", "select", options=["Pass", "Fail"], required=True)]},
    "application": {"label": "Biochar applied to farms", "one": "Field application", "group": "carbon", "icon": "sprout", "create": "all", "scope": "site", "title": "farmer", "photo": "Photo",
                    "geo": True,
                    "fields": [F("batch", "Batch", "ref", ref="batch", required=True), F("farmer", "Farmer", "farmer", required=True), F("plot", "Survey no"),
                               F("qty_kg", "Quantity (kg)", "number", required=True), F("date", "Date", "date", required=True),
                               F("method", "Method", "select", options=["Mixed with compost", "Broadcast and tilled", "Furrow", "Root zone"])]},
    "sapling": {"label": "Sapling distribution", "one": "Sapling distribution", "group": "carbon", "icon": "tree", "create": "all", "scope": "site", "title": "farmer", "photo": "Photo",
                "fields": [F("farmer", "Farmer", "farmer", required=True), F("species", "Species", "select", options=["Teak", "Mango", "Drumstick", "Neem", "Melia dubia", "Bamboo", "Lemon"], required=True),
                           F("count", "Saplings", "number", required=True), F("date", "Date", "date", required=True), F("site", "Site", "site")]},
    "survival": {"label": "Survival checks", "one": "Survival check", "group": "carbon", "icon": "leaf", "create": "all", "scope": "site", "title": "farmer", "photo": "Photo", "geo": True,
                 "fields": [F("farmer", "Farmer", "farmer", required=True), F("species", "Species", "select", options=["Teak", "Mango", "Drumstick", "Neem", "Melia dubia", "Bamboo", "Lemon"]),
                            F("planted", "Planted", "number", required=True), F("alive", "Alive now", "number", required=True), F("avg_height", "Average height (cm)", "number"),
                            F("date", "Checked on", "date", required=True)]},
    # ---------- supply
    "supplier": {"label": "Suppliers", "one": "Supplier", "group": "supply", "icon": "building", "create": "staff", "scope": "all", "title": "name",
                 "fields": [F("name", "Supplier", required=True), F("material", "Supplies"), F("phone", "Phone"), F("gstin", "GSTIN"), F("village", "Village / town")]},
    "purchase_request": {"label": "Purchase requests", "one": "Purchase request", "group": "supply", "icon": "receipt", "create": "all", "scope": "site", "approval": "purchase_request",
                         "title": "item", "amount": "est_cost", "statuses": ["pending", "approved", "ordered", "received", "rejected"],
                         "fields": [F("item", "Item", required=True), F("qty", "Quantity", "number", required=True), F("unit", "Unit", placeholder="kg, L, nos"),
                                    F("site", "For site", "site", required=True), F("needed_by", "Needed by", "date"), F("est_cost", "Estimated cost", "money", required=True),
                                    F("supplier", "Supplier", "ref", ref="supplier"), F("reason", "Why", "textarea")]},
    "transfer": {"label": "Stock transfers", "one": "Stock transfer", "group": "supply", "icon": "swap", "create": "all", "scope": "site", "title": "item", "photo": "Photo",
                 "fields": [F("from_site", "From site", "site", required=True), F("to_site", "To site", "site", required=True), F("item", "Item", "item", required=True),
                            F("qty", "Quantity", "number", required=True), F("vehicle", "Vehicle"), F("date", "Date", "date")]},
    "dispatch": {"label": "Dispatch notes", "one": "Dispatch", "group": "supply", "icon": "send", "create": "all", "scope": "site", "title": "customer", "photo": "Loaded vehicle",
                 "fields": [F("site", "From site", "site", required=True), F("item", "Item", "item", required=True), F("qty", "Quantity", "number", required=True),
                            F("customer", "Customer", required=True), F("vehicle", "Vehicle no"), F("invoice", "Invoice no"), F("date", "Date", "date")]},
}
GROUPS = {"hr": "People", "money": "Money", "ops": "Safety & equipment", "carbon": "Production & carbon", "supply": "Purchasing & supply"}


def kind_or_404(kind: str) -> dict:
    k = KINDS.get(kind)
    if not k:
        raise HTTPException(404, "Unknown record type")
    return k


# ------------------------------------------------------------------ setup


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


def setting(db: Db, key: str):
    v = db.setting(key)
    return v if v is not None else DEFAULTS[key]


def local_today() -> date:
    return datetime.now().astimezone().date()


def to_local(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone()


def num(v, default=0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def user_name(db: Db, uid: str | None) -> str:
    r = db.one("SELECT name FROM users WHERE id = ?", uid) if uid else None
    return r["name"] if r else ""


# ------------------------------------------------------------------ messages (simulated WhatsApp / SMS)

_original_notify = Db.notify


def _notify_and_message(self: Db, user_id: str, title: str, body: str = "", link: str = "") -> None:
    _original_notify(self, user_id, title, body, link)
    try:
        cfg = self.setting("messaging") or {}
        if not (cfg.get("whatsapp") or cfg.get("sms")):
            return
        u = self.one("SELECT name, phone, role FROM users WHERE id = ?", user_id)
        if not u or u["role"] != "field":  # office staff read the app; field staff also get a message
            return
        channel = "WhatsApp" if cfg.get("whatsapp") else "SMS"
        self.insert("message_log", {"channel": channel, "user_id": user_id, "to_name": u["name"], "to_phone": u["phone"] or "",
                                    "text": f"Kshetralekha: {title}" + (f" · {body}" if body else ""), "created_at": now_iso()})
    except Exception:  # noqa: BLE001 - before the table exists
        pass


Db.notify = _notify_and_message


# ------------------------------------------------------------------ approval chains


def chain_amount(kind: str, data: dict, days: float | None = None) -> float:
    if days is not None:
        return days
    field = KINDS.get(kind, {}).get("amount")
    return num(data.get(field)) if field else 0.0


def resolve_approver(db: Db, role: str, subject_id: str) -> str | None:
    if role == "manager":
        u = db.one("SELECT manager_id FROM users WHERE id = ?", subject_id)
        if u and u["manager_id"] and u["manager_id"] != subject_id:
            return u["manager_id"]
        m = db.one("SELECT id FROM users WHERE role = 'manager' AND active = 1 AND id != ? ORDER BY created_at LIMIT 1", subject_id)
        return m["id"] if m else None
    r = db.one("SELECT id FROM users WHERE role = ? AND active = 1 AND id != ? ORDER BY created_at LIMIT 1", role, subject_id)
    return r["id"] if r else None


def start_chain(db: Db, kind: str, ref_id: str, subject_id: str, amount: float, title: str, link: str) -> list[dict]:
    """Make the approval steps for one request; the first waits, the rest are queued. Steps with a minimum apply only above it."""
    chain = setting(db, "approval_chains").get(kind) or [{"role": "manager"}]
    steps = [s for s in chain if amount >= num(s.get("min"), 0)] or chain[:1]
    out = []
    for i, s in enumerate(steps):
        approver = resolve_approver(db, s["role"], subject_id)
        sid = db.insert("approval_steps", {"kind": kind, "ref_id": ref_id, "step": i + 1, "role": s["role"], "approver_id": approver,
                                           "status": "waiting" if i == 0 else "queued"})
        out.append({"id": sid, "role": s["role"], "approver_id": approver})
    if out and out[0]["approver_id"]:
        db.notify(out[0]["approver_id"], f"Approval needed: {title}", f"Step 1 of {len(out)}", link)
    return out


def steps_for(db: Db, kind: str, ref_id: str) -> list[dict]:
    rows = db.all("SELECT s.*, u.name AS approver_name, d.name AS decided_name FROM approval_steps s LEFT JOIN users u ON u.id = s.approver_id "
                  "LEFT JOIN users d ON d.id = s.decided_by WHERE s.kind = ? AND s.ref_id = ? ORDER BY s.step", kind, ref_id)
    return rows


def may_decide(user: dict, step: dict) -> bool:
    if user["role"] == "admin":
        return True
    if step["approver_id"]:
        return step["approver_id"] == user["id"]
    return user["role"] == step["role"] or (step["role"] == "manager" and user["role"] in ("manager",))


def decide_chain(db: Db, kind: str, ref_id: str, user: dict, decision: str, note: str, subject_id: str, title: str, link: str) -> str:
    """Decide the waiting step. Returns 'pending' (more steps to go), 'approved' or 'rejected'."""
    if decision not in ("approved", "rejected"):
        raise HTTPException(422, "decision must be approved or rejected")
    steps = steps_for(db, kind, ref_id)
    if not steps:
        return decision  # requests made before chains existed: one decision
    cur = next((s for s in steps if s["status"] == "waiting"), None)
    if not cur:
        raise HTTPException(409, "Already decided")
    if not may_decide(user, cur):
        raise HTTPException(403, f"Waiting for {cur['approver_name'] or cur['role']}")
    db.update("approval_steps", cur["id"], {"status": decision, "decided_by": user["id"], "decided_at": now_iso(), "note": note[:300]})
    if decision == "rejected":
        for s in steps:
            if s["status"] == "queued":
                db.update("approval_steps", s["id"], {"status": "skipped"})
        db.notify(subject_id, f"Rejected: {title}", f"by {user['name']}" + (f": {note}" if note else ""), link)
        return "rejected"
    nxt = next((s for s in steps if s["status"] == "queued"), None)
    if nxt:
        db.update("approval_steps", nxt["id"], {"status": "waiting"})
        if nxt["approver_id"]:
            db.notify(nxt["approver_id"], f"Approval needed: {title}", f"Step {nxt['step']} of {len(steps)} · approved by {user['name']}", link)
        db.notify(subject_id, f"Step approved: {title}", f"{user['name']} approved; now with {nxt['approver_name'] or nxt['role']}", link)
        return "pending"
    db.notify(subject_id, f"Approved: {title}", f"by {user['name']}" + (f": {note}" if note else ""), link)
    return "approved"


def waiting_for(db: Db, user: dict) -> list[dict]:
    """Steps waiting for this user to decide."""
    rows = db.all("SELECT * FROM approval_steps WHERE status = 'waiting'")
    return [s for s in rows if may_decide(user, s) and (user["role"] != "admin" or s["approver_id"] in (None, user["id"]) or s["role"] == "admin")]


# ------------------------------------------------------------------ calendar, leave, attendance summary


def holidays(db: Db, year: int | None = None) -> dict[str, str]:
    rows = db.all("SELECT data FROM records WHERE kind = 'holiday'")
    out = {}
    for r in rows:
        d = json.loads(r["data"])
        if d.get("date") and (year is None or d["date"][:4] == str(year)):
            out[d["date"]] = d.get("name", "Holiday")
    return out


def working_day(db: Db, d: date, hol: dict | None = None) -> bool:
    wh = setting(db, "work_hours")
    if d.weekday() in wh.get("weekly_off", [6]):
        return False
    return d.isoformat() not in (hol if hol is not None else holidays(db))


def leave_days(db: Db, fd: str, td: str) -> float:
    a, b = date.fromisoformat(fd), date.fromisoformat(td)
    hol = holidays(db)
    n, d = 0, a
    while d <= b:
        if working_day(db, d, hol):
            n += 1
        d += timedelta(days=1)
    return float(n)


def leave_balances(db: Db, user_id: str, year: int | None = None) -> list[dict]:
    year = year or local_today().year
    policy = setting(db, "leave_policy")
    today = local_today()
    months = 12 if year < today.year else today.month
    prof = profile_data(db, user_id)
    out = []
    for typ, p in policy.items():
        per = num(p.get("per_year"))
        acc = p.get("accrual", "yearly")
        accrued = per if acc == "yearly" else round(per * months / 12, 1) if acc == "monthly" else 0.0
        opening = num(prof.get(f"opening_{typ.lower()}"))
        used = pending = 0.0
        for lv in db.all("SELECT * FROM leaves WHERE user_id = ? AND type = ? AND substr(from_date, 1, 4) = ? AND status IN ('approved', 'pending')", user_id, typ, str(year)):
            days = leave_days(db, lv["from_date"], lv["to_date"])
            if lv["status"] == "approved":
                used += days
            else:
                pending += days
        out.append({"type": typ, "perYear": per, "accrual": acc, "opening": opening, "accrued": accrued, "used": used, "pending": pending,
                    "available": round(opening + accrued - used - pending, 1) if per or opening else None})
    return out


def _parse_hm(s: str) -> tuple[int, int]:
    h, m = (s or "09:00").split(":")[:2]
    return int(h), int(m)


def attendance_month(db: Db, user_id: str, month: str) -> dict:
    """Day by day for one person: P present, H half day, L leave, A absent, WO weekly off, HO holiday, MC missed check-out, -- future."""
    y, m = int(month[:4]), int(month[5:7])
    wh = setting(db, "work_hours")
    sh, sm = _parse_hm(wh["start"])
    grace = int(wh.get("grace_min", 15))
    half = num(wh.get("half_day_hours"), 4.5)
    full = num(wh.get("full_day_hours"), 9)
    hol = holidays(db, y)
    today = local_today()
    first, last = date(y, m, 1), date(y, m, calendar.monthrange(y, m)[1])
    att: dict[str, list[dict]] = {}
    for a in db.all("SELECT * FROM attendance WHERE user_id = ? AND checkin_at >= ? AND checkin_at < ?", user_id,
                    (datetime.combine(first, datetime.min.time()) - timedelta(days=1)).isoformat(), (datetime.combine(last, datetime.min.time()) + timedelta(days=2)).isoformat()):
        d = to_local(a["checkin_at"]).date().isoformat()
        att.setdefault(d, []).append(a)
    lv: dict[str, str] = {}
    for x in db.all("SELECT * FROM leaves WHERE user_id = ? AND status = 'approved' AND to_date >= ? AND from_date <= ?", user_id, first.isoformat(), last.isoformat()):
        d = date.fromisoformat(x["from_date"])
        while d <= date.fromisoformat(x["to_date"]):
            lv[d.isoformat()] = x["type"]
            d += timedelta(days=1)
    reg: dict[str, dict] = {}
    for r in db.all("SELECT data FROM records WHERE kind = 'regularisation' AND user_id = ? AND status = 'approved'", user_id):
        dd = json.loads(r["data"])
        reg[dd.get("date", "")] = dd
    days, totals = [], {"P": 0, "H": 0, "L": 0, "A": 0, "WO": 0, "HO": 0, "MC": 0, "late": 0, "ot_hours": 0.0, "hours": 0.0, "unpaid": 0}
    d = first
    while d <= last:
        key = d.isoformat()
        rec = {"date": key, "code": "", "in": "", "out": "", "hours": 0.0, "late": False, "ot": 0.0, "note": ""}
        if d > today or (d == today and key not in att and key not in lv and key not in reg):
            rec["code"] = "--"  # the future, or today before the person has checked in
        elif key in reg:
            r = reg[key]
            ih, im = _parse_hm(r.get("in_time", "09:00"))
            oh, om = _parse_hm(r.get("out_time", "18:00"))
            rec.update(code="P", **{"in": r.get("in_time", ""), "out": r.get("out_time", "")}, hours=round(((oh * 60 + om) - (ih * 60 + im)) / 60, 2), note="corrected")
        elif key in att:
            a = sorted(att[key], key=lambda x: x["checkin_at"])[0]
            cin = to_local(a["checkin_at"])
            rec["in"] = cin.strftime("%H:%M")
            rec["late"] = (cin.hour * 60 + cin.minute) > (sh * 60 + sm + grace)
            if a["checkout_at"]:
                cout = to_local(a["checkout_at"])
                hrs = round((cout - cin).total_seconds() / 3600, 2)
                rec.update(out=cout.strftime("%H:%M"), hours=hrs)
                rec["code"] = "P" if hrs >= half else "H"
                rec["ot"] = round(max(0.0, hrs - full), 2)
                if a.get("flag") == "missed_checkout":
                    rec["code"], rec["note"] = "MC", "check-out missed; closed automatically"
            else:
                rec["code"] = "P" if d == today else "MC"
            if a.get("status") == "pending":
                rec["note"] = (rec["note"] + " · exception awaiting approval").strip(" ·")
        elif key in lv:
            rec["code"], rec["note"] = "L", lv[key]
            if lv[key] == "Unpaid":
                totals["unpaid"] += 1
        elif key in hol:
            rec["code"], rec["note"] = "HO", hol[key]
        elif d.weekday() in wh.get("weekly_off", [6]):
            rec["code"] = "WO"
        else:
            rec["code"] = "A"
        if rec["code"] in totals:
            totals[rec["code"]] += 1
        totals["late"] += 1 if rec["late"] else 0
        totals["ot_hours"] = round(totals["ot_hours"] + rec["ot"], 2)
        totals["hours"] = round(totals["hours"] + rec["hours"], 2)
        days.append(rec)
        d += timedelta(days=1)
    return {"days": days, "totals": totals}


def close_missed_checkouts(db: Db) -> int:
    """Open check-ins from an earlier day are closed at the end of the shift and flagged for correction."""
    wh = setting(db, "work_hours")
    eh, em = _parse_hm(wh["end"])
    today = local_today()
    n = 0
    for a in db.all("SELECT a.*, u.name AS user_name FROM attendance a JOIN users u ON u.id = a.user_id WHERE a.checkout_at IS NULL"):
        cin = to_local(a["checkin_at"])
        if cin.date() >= today:
            continue
        close = cin.replace(hour=eh, minute=em, second=0, microsecond=0)
        if close < cin:
            close = cin + timedelta(hours=1)
        db.update("attendance", a["id"], {"checkout_at": close.astimezone(UTC).isoformat().replace("+00:00", "Z"), "flag": "missed_checkout"})
        db.notify(a["user_id"], "Check-out missed", f"{cin:%d %b}: closed at {close:%H:%M}. Ask for an attendance correction if that is wrong.", "#rec/regularisation")
        n += 1
    return n


# ------------------------------------------------------------------ employee record and payroll


SENSITIVE = {"bank_account", "ifsc", "pan", "aadhaar_last4", "uan", "esic", "basic", "hra", "special", "conveyance"}
PROFILE_FIELDS = [
    F("dob", "Date of birth", "date"), F("gender", "Gender", "select", options=["Female", "Male", "Other"]), F("blood_group", "Blood group"),
    F("address", "Address", "textarea"), F("emergency_name", "Emergency contact"), F("emergency_phone", "Emergency phone"),
    F("joining_date", "Joining date", "date"), F("employment", "Employment", "select", options=["Permanent", "Probation", "Contract", "Daily wage"]),
    F("bank_name", "Bank"), F("bank_account", "Account number"), F("ifsc", "IFSC"), F("pan", "PAN"), F("aadhaar_last4", "Aadhaar (last 4)"),
    F("uan", "UAN (PF)"), F("esic", "ESIC number"),
    F("basic", "Basic (monthly)", "money"), F("hra", "HRA (monthly)", "money"), F("special", "Special allowance (monthly)", "money"),
    F("conveyance", "Conveyance (monthly)", "money"),
    F("opening_casual", "Opening casual leave", "number"), F("opening_sick", "Opening sick leave", "number"), F("opening_earned", "Opening earned leave", "number"),
]


def profile_data(db: Db, user_id: str) -> dict:
    r = db.one("SELECT data FROM records WHERE kind = 'profile' AND user_id = ?", user_id)
    return json.loads(r["data"]) if r else {}


def pt_gujarat(gross: float) -> float:
    return 200.0 if gross >= 12000 else 0.0


def tds_new_regime_monthly(gross_month: float) -> float:
    """FY 2025-26 new regime estimate: standard deduction 75,000, rebate to 12 lakh, 4% cess; spread over 12 months."""
    income = max(0.0, gross_month * 12 - 75000)
    if income <= 1_200_000:
        return 0.0
    slabs = [(400_000, 0.0), (800_000, 0.05), (1_200_000, 0.10), (1_600_000, 0.15), (2_000_000, 0.20), (2_400_000, 0.25), (float("inf"), 0.30)]
    tax, low = 0.0, 0.0
    for high, rate in slabs:
        if income > low:
            tax += (min(income, high) - low) * rate
        low = high
    return round(tax * 1.04 / 12)


def payroll_rows(db: Db, month: str) -> list[dict]:
    y, m = int(month[:4]), int(month[5:7])
    days_in = calendar.monthrange(y, m)[1]
    out = []
    for u in db.all("SELECT * FROM users WHERE active = 1 ORDER BY employee_id"):
        p = profile_data(db, u["id"])
        basic, hra, special, conv = (num(p.get(k)) for k in ("basic", "hra", "special", "conveyance"))
        if basic <= 0:
            continue
        s = attendance_month(db, u["id"], month)["totals"]
        lop = s["A"] + s["unpaid"] + 0.5 * s["H"]
        paid = max(0.0, days_in - lop)
        f = paid / days_in
        e = {"basic": round(basic * f), "hra": round(hra * f), "special": round(special * f), "conveyance": round(conv * f)}
        gross = sum(e.values())
        pf = round(0.12 * min(e["basic"], 15000))
        esi = round(gross * 0.0075) if gross <= 21000 else 0
        pt = pt_gujarat(gross)
        tds = tds_new_regime_monthly(gross)
        adv = 0.0
        for r in db.all("SELECT data FROM records WHERE kind = 'advance' AND user_id = ? AND status = 'approved'", u["id"]):
            d = json.loads(r["data"])
            adv += round(num(d.get("amount")) / max(1.0, num(d.get("recover_months"), 1)))
        ded = pf + esi + pt + tds + adv
        out.append({"user_id": u["id"], "employee_id": u["employee_id"], "name": u["name"], "designation": u["designation"], "days": days_in, "lop": lop,
                    "paid_days": paid, "earnings": e, "gross": gross, "pf": pf, "employer_pf": pf, "esi": esi, "employer_esi": round(gross * 0.0325) if esi else 0,
                    "pt": pt, "tds": tds, "advance": adv, "deductions": ded, "net": gross - ded,
                    "bank": p.get("bank_name", ""), "account": p.get("bank_account", ""), "ifsc": p.get("ifsc", ""), "uan": p.get("uan", ""), "pan": p.get("pan", ""),
                    "present": s["P"], "half": s["H"], "leave": s["L"], "absent": s["A"], "ot_hours": s["ot_hours"]})
    return out


def payslip_pdf(company: dict, month: str, r: dict) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    w, h = A4
    c.setFillColorRGB(0.06, 0.23, 0.16)
    c.rect(0, h - 32 * mm, w, 32 * mm, fill=1, stroke=0)
    c.setFillColorRGB(1, 1, 1)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(18 * mm, h - 16 * mm, company.get("name", "Company"))
    c.setFont("Helvetica", 10)
    c.drawString(18 * mm, h - 23 * mm, f"Payslip for {datetime.strptime(month, '%Y-%m').strftime('%B %Y')}")
    c.setFillColorRGB(0, 0, 0)
    y = h - 44 * mm
    c.setFont("Helvetica", 10)
    for label, val in (("Employee", f"{r['name']} ({r['employee_id']})"), ("Designation", r["designation"] or ""), ("PAN / UAN", f"{r['pan'] or '-'} / {r['uan'] or '-'}"),
                       ("Bank", f"{r['bank'] or '-'} {('XXXX' + r['account'][-4:]) if r['account'] else ''}"),
                       ("Days", f"{r['days']} in month, {r['paid_days']:g} paid, {r['lop']:g} loss of pay")):
        c.drawString(18 * mm, y, label)
        c.drawString(60 * mm, y, str(val))
        y -= 6 * mm
    y -= 4 * mm
    c.setFont("Helvetica-Bold", 11)
    c.drawString(18 * mm, y, "Earnings")
    c.drawString(110 * mm, y, "Deductions")
    y -= 7 * mm
    c.setFont("Helvetica", 10)
    earn = [("Basic", r["earnings"]["basic"]), ("HRA", r["earnings"]["hra"]), ("Special allowance", r["earnings"]["special"]), ("Conveyance", r["earnings"]["conveyance"])]
    ded = [("Provident fund (12%)", r["pf"]), ("ESI (0.75%)", r["esi"]), ("Professional tax", r["pt"]), ("Income tax (TDS)", r["tds"]), ("Advance recovery", r["advance"])]
    for i in range(max(len(earn), len(ded))):
        if i < len(earn):
            c.drawString(18 * mm, y, earn[i][0])
            c.drawRightString(95 * mm, y, f"{earn[i][1]:,.0f}")
        if i < len(ded):
            c.drawString(110 * mm, y, ded[i][0])
            c.drawRightString(190 * mm, y, f"{ded[i][1]:,.0f}")
        y -= 6 * mm
    c.line(18 * mm, y + 2 * mm, 190 * mm, y + 2 * mm)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(18 * mm, y - 3 * mm, "Gross")
    c.drawRightString(95 * mm, y - 3 * mm, f"{r['gross']:,.0f}")
    c.drawString(110 * mm, y - 3 * mm, "Total deductions")
    c.drawRightString(190 * mm, y - 3 * mm, f"{r['deductions']:,.0f}")
    c.setFillColorRGB(0.12, 0.48, 0.3)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(18 * mm, y - 16 * mm, f"Net pay: Rs {r['net']:,.0f}")
    c.setFillColorRGB(0.4, 0.4, 0.4)
    c.setFont("Helvetica", 8)
    c.drawString(18 * mm, 15 * mm, "Prototype payslip generated by Kshetralekha. Employer PF and ESI are paid in addition to the amounts above.")
    c.showPage()
    c.save()
    return buf.getvalue()


def tally_xml(company: str, month: str, rows: list[dict]) -> str:
    """A Tally journal voucher for the month's salary (import in Tally: Gateway > Import Data > Vouchers)."""
    vdate = month.replace("-", "") + str(calendar.monthrange(int(month[:4]), int(month[5:7]))[1])
    gross = sum(r["gross"] for r in rows)
    lines = [("Salaries", -gross), ("PF Payable", sum(r["pf"] for r in rows)), ("ESI Payable", sum(r["esi"] for r in rows)),
             ("Professional Tax Payable", sum(r["pt"] for r in rows)), ("TDS on Salary", sum(r["tds"] for r in rows)),
             ("Staff Advances", sum(r["advance"] for r in rows)), ("Salary Payable", sum(r["net"] for r in rows))]
    entries = "".join(f"<ALLLEDGERENTRIES.LIST><LEDGERNAME>{n}</LEDGERNAME><ISDEEMEDPOSITIVE>{'Yes' if a < 0 else 'No'}</ISDEEMEDPOSITIVE><AMOUNT>{a:.2f}</AMOUNT></ALLLEDGERENTRIES.LIST>"
                      for n, a in lines if a)
    return (f'<?xml version="1.0"?><ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>'
            f"<STATICVARIABLES><SVCURRENTCOMPANY>{company}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE>"
            f'<VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>{vdate}</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>'
            f"<NARRATION>Salary for {month} ({len(rows)} employees) from Kshetralekha</NARRATION>{entries}</VOUCHER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>")


# ------------------------------------------------------------------ TOTP (admin two-step sign-in)


def totp(secret_b32: str, at: float | None = None, step: int = 30) -> str:
    key = base64.b32decode(secret_b32 + "=" * (-len(secret_b32) % 8))
    counter = int((at or time.time()) // step)
    mac = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    o = mac[-1] & 0x0F
    return f"{(struct.unpack('>I', mac[o:o + 4])[0] & 0x7FFFFFFF) % 1_000_000:06d}"


def totp_ok(secret: str, code: str) -> bool:
    now = time.time()
    return any(hmac.compare_digest(totp(secret, now + d * 30), str(code).strip()) for d in (-1, 0, 1))


def totp_required(db: Db, user_id: str) -> str | None:
    r = db.one("SELECT secret FROM user_totp WHERE user_id = ? AND enabled = 1", user_id)
    return r["secret"] if r else None


# ------------------------------------------------------------------ stock postings (batches, transfers, dispatch, applications)


def find_item(db: Db, site_id: str, *, kind: str | None = None, like: tuple[str, ...] = (), name: str | None = None) -> dict | None:
    items = db.all("SELECT * FROM register_items WHERE site_id = ? AND active = 1", site_id)
    if name:
        return next((i for i in items if i["name"].lower() == name.lower()), None)
    for i in items:
        if (kind is None or i["kind"] == kind) and any(w in i["name"].lower() for w in like):
            return i
    return None


def balance(db: Db, item_id: str) -> float:
    r = db.one("SELECT balance_after FROM movements WHERE item_id = ? ORDER BY at DESC, rowid DESC LIMIT 1", item_id)
    return float(r["balance_after"]) if r else 0.0


def post(db: Db, item: dict, typ: str, qty: float, user_id: str, note: str, ref: str, file_id: str | None = None, lat=None, lng=None, at: str | None = None,
         allow_negative: bool = False) -> float:
    bal = balance(db, item["id"])
    if typ == "out" and qty > bal + 1e-9 and not allow_negative:
        raise HTTPException(422, f"Only {bal:g} {item['unit']} of {item['name']} in stock at this site")
    new = bal + qty if typ == "in" else bal - qty
    db.insert("movements", {"item_id": item["id"], "user_id": user_id, "type": typ, "qty": qty, "balance_after": round(new, 3), "batch": ref[:60],
                            "note": note[:300], "file_id": file_id, "lat": lat, "lng": lng, "at": at or now_iso()})
    return new


# ------------------------------------------------------------------ router


def make_router(user_dep: Any, db_dep: Any, *, save_upload: Callable, save_bytes: Callable, is_staff: Callable[[dict], bool],
                site_allowed: Callable[[dict, str], bool], demo: bool) -> APIRouter:
    r = APIRouter(prefix="/api")

    def can_create(user: dict, k: dict) -> bool:
        c = k.get("create", "staff")
        return c == "all" or (c == "staff" and is_staff(user)) or (c == "hr" and user["role"] in ("admin", "hr"))

    def visible(user: dict, k: dict, rec: dict, team: set | None = None) -> bool:
        if user.get("all_sites"):
            return True
        scope = k.get("scope", "own")
        mine = rec["user_id"] == user["id"] or rec["created_by"] == user["id"]
        if is_staff(user):  # project managers: their sites and their people
            return mine or scope == "all" or (rec["site_id"] in user["sites"]) or (team is not None and rec["user_id"] in team)
        if scope == "all":
            return True
        if scope == "staff":
            return mine
        if scope == "site":
            return mine or rec["site_id"] in user["sites"]
        return mine

    def enrich(db: Db, kind: str, rec: dict, *, full: bool = False) -> dict:
        rec["data"] = json.loads(rec["data"]) if isinstance(rec["data"], str) else rec["data"]
        rec["user_name"] = user_name(db, rec["user_id"])
        rec["created_name"] = user_name(db, rec["created_by"])
        if KINDS.get(kind, {}).get("approval") or kind == "leave":
            st = steps_for(db, kind, rec["id"])
            rec["steps"] = st
            cur = next((s for s in st if s["status"] == "waiting"), None)
            rec["waiting"] = (cur["approver_name"] or cur["role"]) if cur else ""
        if kind == "batch":
            d = rec["data"]
            rec["yield"] = round(num(d.get("output_kg")) / num(d.get("feedstock_kg"), 1) * 100, 1) if num(d.get("feedstock_kg")) else None
            rec["applied"] = sum(num(json.loads(a["data"]).get("qty_kg")) for a in db.all("SELECT data FROM records WHERE kind = 'application' AND json_extract(data, '$.batch') = ?", rec["id"]))
            lab = db.one("SELECT data FROM records WHERE kind = 'lab_result' AND json_extract(data, '$.batch') = ? ORDER BY created_at DESC LIMIT 1", rec["id"])
            rec["lab"] = json.loads(lab["data"]) if lab else None
        if kind == "survival":
            d = rec["data"]
            rec["survival"] = round(num(d.get("alive")) / num(d.get("planted"), 1) * 100) if num(d.get("planted")) else None
        if kind == "equipment":
            d = rec["data"]
            if num(d.get("service_days")) and d.get("last_service"):
                due = date.fromisoformat(d["last_service"]) + timedelta(days=int(num(d["service_days"])))
                rec["service_due"] = due.isoformat()
                rec["service_overdue"] = due < local_today()
        if full and kind == "policy":
            rec["acks"] = db.all("SELECT r.user_id, u.name, r.created_at FROM records r JOIN users u ON u.id = r.user_id WHERE r.kind = 'policy_ack' AND json_extract(r.data, '$.policy') = ?", rec["id"])
        if kind == "policy":
            rec["acked"] = None
        return rec

    def title_for(kind: str, k: dict, data: dict, db: Db) -> str:
        if kind == "batch":
            return data.get("code") or ""
        t = data.get(k.get("title", ""), "")
        for f in k["fields"]:
            if f["key"] == k.get("title"):
                if f["type"] == "user":
                    return user_name(db, t)
                if f["type"] == "farmer":
                    fr = db.one("SELECT name FROM farmers WHERE id = ?", t)
                    return fr["name"] if fr else ""
                if f["type"] == "ref":
                    rr = db.one("SELECT title FROM records WHERE id = ?", t)
                    return rr["title"] if rr else ""
        return str(t)[:120]

    # -------------------------------------------------------------- definitions

    @r.get("/m/kinds")
    def kinds(user: user_dep, db: db_dep):
        out = {}
        for key, k in KINDS.items():
            out[key] = {**k, "canCreate": can_create(user, k), "key": key}
        return {"kinds": out, "groups": GROUPS, "profileFields": PROFILE_FIELDS, "sensitive": sorted(SENSITIVE),
                "chains": setting(db, "approval_chains"), "leavePolicy": setting(db, "leave_policy"), "workHours": setting(db, "work_hours"),
                "retention": setting(db, "retention"), "messaging": setting(db, "messaging")}

    # -------------------------------------------------------------- generic records

    @r.get("/m/{kind}")
    def list_records(kind: str, user: user_dep, db: db_dep, siteId: str = "", userId: str = "", status: str = "", ref: str = ""):
        k = kind_or_404(kind)
        sql, args = "SELECT * FROM records WHERE kind = ?", [kind]
        if siteId:
            sql += " AND site_id = ?"
            args.append(siteId)
        if userId:
            sql += " AND user_id = ?"
            args.append(userId)
        if status:
            sql += " AND status = ?"
            args.append(status)
        team = team_ids(db, user)
        rows = [x for x in db.all(sql + " ORDER BY created_at DESC LIMIT 400", *args) if visible(user, k, x, team)]
        if ref:
            rows = [x for x in rows if ref in x["data"]]
        out = [enrich(db, kind, x) for x in rows]
        if kind == "policy":
            mine = {json.loads(a["data"]).get("policy") for a in db.all("SELECT data FROM records WHERE kind = 'policy_ack' AND user_id = ?", user["id"])}
            for x in out:
                x["acked"] = x["id"] in mine
        return {"rows": out}

    @r.get("/m/{kind}/{rid}")
    def get_record(kind: str, rid: str, user: user_dep, db: db_dep):
        k = kind_or_404(kind)
        rec = db.one("SELECT * FROM records WHERE id = ? AND kind = ?", rid, kind)
        if not rec or not visible(user, k, rec, team_ids(db, user)):
            raise HTTPException(404, "Not found")
        rec = enrich(db, kind, rec, full=True)
        if kind == "policy":
            rec["acked"] = bool(db.one("SELECT 1 FROM records WHERE kind = 'policy_ack' AND user_id = ? AND json_extract(data, '$.policy') = ?", user["id"], rid))
        if kind == "batch":
            rec["chain"] = carbon_chain(db, rec)
        return rec

    @r.post("/m/{kind}")
    async def save_record(kind: str, request: Request, user: user_dep, db: db_dep):
        k = kind_or_404(kind)
        form = await request.form()
        data = json.loads(form.get("data") or "{}")
        rid = form.get("id") or ""
        photo = form.get("photo")
        lat, lng = form.get("lat") or None, form.get("lng") or None
        old = db.one("SELECT * FROM records WHERE id = ? AND kind = ?", rid, kind) if rid else None
        if rid and not old:
            raise HTTPException(404, "Not found")
        if old:
            if not (is_staff(user) or old["created_by"] == user["id"]):
                raise HTTPException(403, "Only the person who made it or a manager can change it")
            if k.get("approval") and old["status"] in ("approved", "rejected") and not is_staff(user):
                raise HTTPException(409, "Already decided; it can no longer be changed")
        elif not can_create(user, k):
            raise HTTPException(403, f"Only {'HR' if k.get('create') == 'hr' else 'managers'} can add {k['label'].lower()}")
        for f in k["fields"]:
            if f.get("required") and str(data.get(f["key"], "")).strip() == "":
                raise HTTPException(422, f"{f['label']} is required")
            if f["type"] in ("number", "money") and str(data.get(f["key"], "")).strip() != "":
                try:
                    float(data[f["key"]])
                except ValueError as e:
                    raise HTTPException(422, f"{f['label']} must be a number") from e
        site_id = data.get("site") or data.get("from_site") or (old["site_id"] if old else None)
        if kind in ("lab_result", "application") and data.get("batch"):
            b = db.one("SELECT site_id FROM records WHERE id = ?", data["batch"])
            site_id = b["site_id"] if b else site_id
        if kind == "maintenance" and data.get("equipment"):
            e = db.one("SELECT site_id FROM records WHERE id = ?", data["equipment"])
            site_id = e["site_id"] if e else site_id
        if kind in ("application", "sapling", "survival", "farmer_payment") and data.get("farmer"):
            fr = db.one("SELECT site_id FROM farmers WHERE id = ?", data["farmer"])
            site_id = site_id or (fr["site_id"] if fr else None)
        if site_id and not is_staff(user) and not site_allowed(user, site_id) and k.get("create") == "all":
            raise HTTPException(403, "Not your site")
        subject = data.get("person") or (old["user_id"] if old else user["id"])
        if kind == "batch" and not old:
            n = db.one("SELECT COUNT(*) AS n FROM records WHERE kind = 'batch'")["n"] + 1
            data["code"] = f"B-{local_today():%y%m%d}-{n:03d}"
        if kind == "checklist_run" and data.get("template"):
            t = db.one("SELECT title, site_id FROM records WHERE id = ?", data["template"])
            data["name"] = t["title"] if t else "Checklist"
            site_id = site_id or (t["site_id"] if t else None)
        fid = old["file_id"] if old else None
        if isinstance(photo, FormFile) and photo.filename:
            fid = await save_upload(db, photo, f"Records/{k['label']}", f"record_{kind}", user, lat=num(lat, None) if lat else None, lng=num(lng, None) if lng else None,
                                    name=f"{datetime.now():%Y-%m-%d %H-%M-%S} {k['one']}.jpg")
        elif k.get("photo") == "Receipt" and not old and kind == "expense" and num(data.get("amount")) > 500:
            raise HTTPException(422, "A receipt photo is needed for claims over ₹500")
        title = title_for(kind, k, data, db)
        row = {"title": title, "site_id": site_id, "user_id": subject, "data": json.dumps(data), "file_id": fid, "updated_at": now_iso()}
        if lat:
            row.update(lat=num(lat, None), lng=num(lng, None))
        if old:
            if form.get("status") and form.get("status") in (k.get("statuses") or []):
                row["status"] = form.get("status")
            db.update("records", old["id"], row)
            rec_id = old["id"]
        else:
            status = "pending" if k.get("approval") else (k.get("statuses") or ["open"])[0]
            rec_id = db.insert("records", {**row, "kind": kind, "status": status, "created_by": user["id"], "created_at": now_iso()})
            after_create(db, kind, k, rec_id, data, user, fid, site_id, subject, num(lat, None) if lat else None, num(lng, None) if lng else None)
        if kind == "maintenance" and data.get("equipment"):
            eq = db.one("SELECT * FROM records WHERE id = ?", data["equipment"])
            if eq:
                ed = json.loads(eq["data"])
                if data.get("type") == "Preventive service":
                    ed["last_service"] = data.get("date") or local_today().isoformat()
                db.update("records", eq["id"], {"data": json.dumps(ed), "status": data.get("result") or eq["status"], "updated_at": now_iso()})
        db.audit(user["id"], f"{kind}_saved", kind, rec_id, title)
        return {"id": rec_id}

    def after_create(db: Db, kind: str, k: dict, rid: str, data: dict, user: dict, fid, site_id, subject, lat, lng) -> None:
        link = f"#rec/{kind}/{rid}"
        if k.get("approval"):
            start_chain(db, k["approval"], rid, subject, chain_amount(kind, data), f"{k['one']} · {user_name(db, subject)}", link)
        if kind == "batch":
            site = site_id
            feed = find_item(db, site, kind="input", like=("feed", "biomass"))
            out = find_item(db, site, kind="product", like=("biochar", "char"))
            if not feed or not out:
                raise HTTPException(422, "This site has no feedstock or biochar register item; add them in Admin → Register items")
            try:
                post(db, feed, "out", num(data.get("feedstock_kg")), user["id"], f"Used in batch {data['code']}", data["code"], fid, lat, lng)
            except HTTPException:
                db.run("DELETE FROM records WHERE id = ?", rid)
                raise
            post(db, out, "in", num(data.get("output_kg")), user["id"], f"Produced in batch {data['code']}", data["code"], fid, lat, lng)
            db.notify_role(("manager", "admin"), f"Batch {data['code']} produced", f"{num(data.get('output_kg')):g} kg biochar from {num(data.get('feedstock_kg')):g} kg", link, site)
        if kind == "lab_result" and data.get("batch"):
            db.update("records", data["batch"], {"status": "tested", "updated_at": now_iso()})
        if kind == "gas_run":
            moves = [(("feed", "biomass"), "input", "out", "feedstock_kg"), (("power",), "product", "in", "power_kwh"), (("ash", "char"), "product", "in", "ash_kg"),
                     (("diesel",), "input", "out", "diesel_l")]
            ref = f"RUN-{data.get('date', '')}"
            done = []
            try:
                for like, ik, typ, key in moves:
                    q = num(data.get(key))
                    it = find_item(db, site_id, kind=ik, like=like) if q > 0 else None
                    if it:
                        post(db, it, typ, q, user["id"], f"Gasifier run {data.get('date', '')}", ref, fid, lat, lng)
                        done.append(it["id"])
            except HTTPException:
                db.run("DELETE FROM records WHERE id = ?", rid)
                for iid in done:  # undo what was posted before the failure
                    db.run("DELETE FROM movements WHERE item_id = ? AND batch = ? AND at = (SELECT MAX(at) FROM movements WHERE item_id = ? AND batch = ?)", iid, ref, iid, ref)
                raise
        if kind == "application":
            b = db.one("SELECT * FROM records WHERE id = ?", data.get("batch"))
            if not b:
                raise HTTPException(422, "Pick the batch")
            item = find_item(db, b["site_id"], kind="product", like=("biochar", "char"))
            if item:
                try:
                    post(db, item, "out", num(data.get("qty_kg")), user["id"], f"Applied on farm ({title_for(kind, k, data, db)})", json.loads(b["data"]).get("code", ""), fid, lat, lng)
                except HTTPException:
                    db.run("DELETE FROM records WHERE id = ?", rid)
                    raise
            db.update("records", b["id"], {"status": "applied", "updated_at": now_iso()})
        if kind == "transfer":
            src = find_item(db, data["from_site"], name=data["item"])
            if not src:
                db.run("DELETE FROM records WHERE id = ?", rid)
                raise HTTPException(422, f"{data['item']} is not kept at the sending site")
            dst = find_item(db, data["to_site"], name=data["item"])
            if not dst:
                did = db.insert("register_items", {"site_id": data["to_site"], "name": src["name"], "unit": src["unit"], "kind": src["kind"], "low_stock": 0, "active": 1, "sort": 9})
                dst = db.one("SELECT * FROM register_items WHERE id = ?", did)
            ref = f"TR-{rid[:6].upper()}"
            try:
                post(db, src, "out", num(data["qty"]), user["id"], f"Transfer to {site_name(db, data['to_site'])}", ref, fid)
            except HTTPException:
                db.run("DELETE FROM records WHERE id = ?", rid)
                raise
            post(db, dst, "in", num(data["qty"]), user["id"], f"Transfer from {site_name(db, data['from_site'])}", ref, fid)
        if kind == "dispatch":
            it = find_item(db, data["site"], name=data["item"])
            if not it:
                db.run("DELETE FROM records WHERE id = ?", rid)
                raise HTTPException(422, f"{data['item']} is not kept at this site")
            try:
                post(db, it, "out", num(data["qty"]), user["id"], f"Dispatched to {data.get('customer', '')}", data.get("invoice") or f"DN-{rid[:6].upper()}", fid)
            except HTTPException:
                db.run("DELETE FROM records WHERE id = ?", rid)
                raise
        if kind == "incident":
            sev = data.get("severity", "Low")
            db.notify_role(("manager", "admin", "hr"), f"Incident ({sev}): {data.get('type')}", f"{site_name(db, site_id)} · {str(data.get('description', ''))[:100]}", link, site_id)
            if sev in ("Medium", "High", "Critical"):
                follow_up_task(db, user, f"Investigate {data.get('type', 'incident').lower()} at {site_name(db, site_id)}", rid, sev, site_id)
        if kind == "checklist_run":
            fails = [a for a in data.get("answers", []) if a.get("ok") is False]
            if fails:
                db.notify_role(("manager", "admin"), f"Checklist issues: {data.get('name')}", f"{len(fails)} item(s) not OK: {', '.join(a['item'] for a in fails)[:120]}", link, site_id)
                for a in fails[:3]:
                    follow_up_task(db, user, f"Fix: {a['item']} ({data.get('name')})", rid, "Medium", site_id)
        if kind == "maintenance" and data.get("result") == "breakdown":
            db.notify_role(("manager", "admin"), "Equipment breakdown", str(data.get("description", ""))[:120], link, site_id)
        if kind == "asset_issue" and subject != user["id"]:
            db.notify(subject, f"Asset issued to you: {data.get('asset')}", data.get("serial", ""), "#rec/asset_issue")
        if kind in ("training", "goal", "review") and subject != user["id"]:
            db.notify(subject, f"New {k['one'].lower()}: {title_for(kind, k, data, db)}", "", f"#rec/{kind}/{rid}")
        if kind == "policy" and data.get("must_ack") == "Yes":
            for u in db.all("SELECT id FROM users WHERE active = 1"):
                if u["id"] != user["id"]:
                    db.notify(u["id"], f"Please read and accept: {data.get('title')}", "Policy", f"#rec/policy/{rid}")

    def site_name(db: Db, sid: str | None) -> str:
        s = db.one("SELECT name FROM sites WHERE id = ?", sid) if sid else None
        return s["name"] if s else "all sites"

    def follow_up_task(db: Db, user: dict, title: str, rid: str, sev: str, site_id: str | None) -> None:
        """Follow-up actions go to the Planner, in a 'Safety & maintenance actions' plan."""
        plan = db.one("SELECT id FROM plans WHERE name = 'Safety & maintenance actions'")
        if not plan:
            import planner

            pid = db.insert("plans", {"name": "Safety & maintenance actions", "site_id": None, "color": "red", "labels": json.dumps(planner.DEFAULT_LABELS),
                                      "created_by": user["id"], "created_at": now_iso()})
            for i, b in enumerate(["Open actions", "In progress", "Verified"]):
                db.insert("buckets", {"plan_id": pid, "name": b, "sort": i})
            plan = {"id": pid}
        bucket = db.one("SELECT id FROM buckets WHERE plan_id = ? ORDER BY sort LIMIT 1", plan["id"])
        mgr = resolve_approver(db, "manager", user["id"])
        tid = db.insert("tasks", {"plan_id": plan["id"], "bucket_id": bucket["id"], "title": title[:160], "notes": f"Raised from record {rid}.",
                                  "priority": {"Critical": "urgent", "High": "urgent", "Medium": "important"}.get(sev, "medium"),
                                  "due_date": (local_today() + timedelta(days=2 if sev in ("High", "Critical") else 7)).isoformat(),
                                  "labels": json.dumps(["red"]), "checklist": "[]", "photo_required": 1, "sort": 0, "created_by": user["id"],
                                  "created_at": now_iso(), "updated_at": now_iso(), "progress": "not_started"})
        if mgr:
            db.insert("task_assignees", {"task_id": tid, "user_id": mgr})
            db.notify(mgr, f"New task: {title[:80]}", "Safety & maintenance actions", f"#task/{tid}")

    @r.post("/m-ack/{rid}")
    def accept_policy(rid: str, user: user_dep, db: db_dep):
        p = db.one("SELECT * FROM records WHERE id = ? AND kind = 'policy'", rid)
        if not p:
            raise HTTPException(404, "Not found")
        if not db.one("SELECT 1 FROM records WHERE kind = 'policy_ack' AND user_id = ? AND json_extract(data, '$.policy') = ?", user["id"], rid):
            db.insert("records", {"kind": "policy_ack", "title": "Accepted", "user_id": user["id"], "data": json.dumps({"policy": rid}), "status": "open",
                                  "created_by": user["id"], "created_at": now_iso(), "updated_at": now_iso()})
            db.audit(user["id"], "policy_accepted", "policy", rid, p["title"])
        return {"ok": True}

    @r.post("/m/{kind}/{rid}/status")
    def set_status(kind: str, rid: str, payload: dict, user: user_dep, db: db_dep):
        k = kind_or_404(kind)
        rec = db.one("SELECT * FROM records WHERE id = ? AND kind = ?", rid, kind)
        if not rec or not visible(user, k, rec):
            raise HTTPException(404, "Not found")
        st = payload.get("status")
        if st not in (k.get("statuses") or []):
            raise HTTPException(422, "Unknown status")
        if not (is_staff(user) or rec["created_by"] == user["id"]):
            raise HTTPException(403, "Not allowed")
        if kind == "purchase_request" and st in ("ordered", "received") and rec["status"] not in ("approved", "ordered"):
            raise HTTPException(409, "Approve the request first")
        patch: dict = {"status": st, "updated_at": now_iso()}
        if kind == "purchase_request" and st == "ordered":
            d = json.loads(rec["data"])
            d["po_number"] = d.get("po_number") or f"PO/{local_today():%y%m}/{rid[:4].upper()}"
            patch["data"] = json.dumps(d)
        if kind == "purchase_request" and st == "received":
            d = json.loads(rec["data"])
            it = find_item(db, rec["site_id"], name=d.get("item", "")) if rec["site_id"] else None
            if it:
                post(db, it, "in", num(d.get("qty")), user["id"], f"Received against {d.get('po_number', 'PO')}", d.get("po_number", ""))
        db.update("records", rid, patch)
        if rec["user_id"] and rec["user_id"] != user["id"]:
            db.notify(rec["user_id"], f"{k['one']} {st}: {rec['title']}", f"by {user['name']}", f"#rec/{kind}/{rid}")
        return {"ok": True}

    @r.post("/m/{kind}/{rid}/check")
    def tick_checklist(kind: str, rid: str, payload: dict, user: user_dep, db: db_dep):
        """Tick an item of an onboarding / exit checklist."""
        k = kind_or_404(kind)
        rec = db.one("SELECT * FROM records WHERE id = ? AND kind = ?", rid, kind)
        if not rec or not is_staff(user):
            raise HTTPException(404, "Not found")
        d = json.loads(rec["data"])
        done = set(d.get("done", []))
        item = str(payload.get("item", ""))
        if payload.get("done"):
            done.add(item)
        else:
            done.discard(item)
        d["done"] = sorted(done)
        items = [x for f in k["fields"] if f["type"] == "checklist" for x in str(d.get(f["key"], "")).split("\n") if x.strip()]
        st = rec["status"]
        if k.get("statuses") and items and all(x in done for x in items):
            st = k["statuses"][-1]
        db.update("records", rid, {"data": json.dumps(d), "status": st, "updated_at": now_iso()})
        return {"ok": True, "status": st}

    @r.post("/m/{kind}/{rid}/delete")
    def delete_record(kind: str, rid: str, user: user_dep, db: db_dep):
        kind_or_404(kind)
        rec = db.one("SELECT * FROM records WHERE id = ? AND kind = ?", rid, kind)
        if not rec:
            raise HTTPException(404, "Not found")
        if not (is_staff(user) or (rec["created_by"] == user["id"] and rec["status"] in ("pending", "open"))):
            raise HTTPException(403, "Not allowed")
        if kind in ("batch", "application", "transfer", "dispatch"):
            raise HTTPException(409, "This moved stock; record a correction in the register instead of deleting it")
        db.run("DELETE FROM records WHERE id = ?", rid)
        db.run("DELETE FROM approval_steps WHERE kind = ? AND ref_id = ?", KINDS[kind].get("approval") or kind, rid)
        db.audit(user["id"], f"{kind}_deleted", kind, rid, rec["title"])
        return {"ok": True}

    @r.get("/m-export/{kind}.csv")
    def export_kind(kind: str, user: user_dep, db: db_dep):
        k = kind_or_404(kind)
        if not is_staff(user):
            raise HTTPException(403, "Managers only")
        rows = [enrich(db, kind, x) for x in db.all("SELECT * FROM records WHERE kind = ? ORDER BY created_at", kind)]
        buf = io.StringIO()
        w = csv.writer(buf)
        keys = [f["key"] for f in k["fields"] if f["type"] not in ("answers",)]
        w.writerow(["id", "title", "status", "person", "created_by", "created_at", *[f["label"] for f in k["fields"] if f["type"] not in ("answers",)]])
        for x in rows:
            w.writerow([x["id"], x["title"], x["status"], x["user_name"], x["created_name"], x["created_at"], *[x["data"].get(kk, "") for kk in keys]])
        return Response(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{kind}.csv"'})

    # -------------------------------------------------------------- approvals (records and leave)

    @r.get("/m-approvals")
    def my_approvals(user: user_dep, db: db_dep):
        out = []
        for s in waiting_for(db, user):
            if s["kind"] == "leave":
                continue  # leave is shown in its own section
            kind = next((kk for kk, kv in KINDS.items() if kv.get("approval") == s["kind"]), s["kind"])
            rec = db.one("SELECT * FROM records WHERE id = ?", s["ref_id"])
            if rec:
                out.append({"step": s, "kind": kind, "record": enrich(db, kind, rec)})
        return {"rows": out}

    @r.post("/m-steps/{kind}/{rid}/decide")
    def decide(kind: str, rid: str, payload: dict, user: user_dep, db: db_dep):
        k = kind_or_404(kind)
        rec = db.one("SELECT * FROM records WHERE id = ? AND kind = ?", rid, kind)
        if not rec or rec["status"] != "pending":
            raise HTTPException(404, "Nothing to decide")
        res = decide_chain(db, k["approval"], rid, user, payload.get("decision"), str(payload.get("note", "")), rec["user_id"],
                           f"{k['one']} · {rec['title']}", f"#rec/{kind}/{rid}")
        if res != "pending":
            db.update("records", rid, {"status": res, "updated_at": now_iso()})
        return {"status": res}

    # -------------------------------------------------------------- people

    @r.get("/hr/people")
    def people(user: user_dep, db: db_dep):
        if not is_staff(user):
            raise HTTPException(403, "Managers and HR only")
        team = team_ids(db, user)
        rows = [u for u in db.all("SELECT id, employee_id, name, role, designation, phone, email, manager_id, active FROM users ORDER BY active DESC, name")
                if team is None or u["id"] in team]
        for u in rows:
            p = profile_data(db, u["id"])
            u["joining_date"] = p.get("joining_date", "")
            u["employment"] = p.get("employment", "")
            u["manager_name"] = user_name(db, u["manager_id"])
            u["sites"] = [x["site_id"] for x in db.all("SELECT site_id FROM user_sites WHERE user_id = ?", u["id"])]
            u["projects"] = [x["project"] for x in db.all("SELECT project FROM user_projects WHERE user_id = ?", u["id"])]
            u["complete"] = round(sum(1 for f in PROFILE_FIELDS[:15] if p.get(f["key"])) / 15 * 100)
        return {"rows": rows}

    @r.get("/hr/profile/{uid}")
    def get_profile(uid: str, user: user_dep, db: db_dep):
        if uid == "me":
            uid = user["id"]
        if uid != user["id"] and not is_staff(user):
            raise HTTPException(403, "Not allowed")
        u = db.one("SELECT id, employee_id, name, role, designation, phone, email, manager_id, created_at FROM users WHERE id = ?", uid)
        if not u:
            raise HTTPException(404, "Not found")
        p = profile_data(db, uid)
        hr = user["role"] in ("admin", "hr") or uid == user["id"]
        if not hr:
            p = {k: ("•••• " + str(v)[-2:] if v and k in SENSITIVE else v) for k, v in p.items()}
        u["manager_name"] = user_name(db, u["manager_id"])
        u["reports"] = db.all("SELECT id, name, designation FROM users WHERE manager_id = ? AND active = 1", uid)
        u["sites"] = [x["site_id"] for x in db.all("SELECT site_id FROM user_sites WHERE user_id = ?", uid)]
        u["projects"] = [x["project"] for x in db.all("SELECT project FROM user_projects WHERE user_id = ?", uid)]
        u["canAssign"] = user["role"] in ("admin", "hr")
        y = local_today().year
        return {"user": u, "profile": p, "canEdit": user["role"] in ("admin", "hr"), "balances": leave_balances(db, uid, y),
                "assets": [enrich(db, "asset_issue", x) for x in db.all("SELECT * FROM records WHERE kind = 'asset_issue' AND user_id = ?", uid)],
                "trainings": [enrich(db, "training", x) for x in db.all("SELECT * FROM records WHERE kind = 'training' AND user_id = ?", uid)],
                "goals": [enrich(db, "goal", x) for x in db.all("SELECT * FROM records WHERE kind = 'goal' AND user_id = ?", uid)]}

    @r.post("/hr/profile/{uid}")
    def save_profile(uid: str, payload: dict, user: user_dep, db: db_dep):
        if user["role"] not in ("admin", "hr"):
            raise HTTPException(403, "HR only")
        if not db.one("SELECT 1 FROM users WHERE id = ?", uid):
            raise HTTPException(404, "Not found")
        keys = {f["key"] for f in PROFILE_FIELDS}
        data = {k: str(v)[:300] for k, v in (payload.get("profile") or {}).items() if k in keys}
        old = db.one("SELECT id, data FROM records WHERE kind = 'profile' AND user_id = ?", uid)
        if old:
            merged = {**json.loads(old["data"]), **data}
            db.update("records", old["id"], {"data": json.dumps(merged), "updated_at": now_iso()})
        else:
            db.insert("records", {"kind": "profile", "title": user_name(db, uid), "user_id": uid, "data": json.dumps(data), "status": "open",
                                  "created_by": user["id"], "created_at": now_iso(), "updated_at": now_iso()})
        if "managerId" in payload:
            mid = payload.get("managerId") or None
            if mid == uid:
                raise HTTPException(422, "Someone cannot report to themselves")
            db.run("UPDATE users SET manager_id = ? WHERE id = ?", mid, uid)
        db.audit(user["id"], "profile_saved", "user", uid, "")
        return {"ok": True}

    @r.get("/hr/org")
    def org(user: user_dep, db: db_dep):
        return {"rows": db.all("SELECT id, name, designation, role, manager_id FROM users WHERE active = 1 ORDER BY name")}

    @r.get("/hr/leave-balances")
    def balances(user: user_dep, db: db_dep, userId: str = ""):
        uid = userId if userId and is_staff(user) else user["id"]
        return {"rows": leave_balances(db, uid), "policy": setting(db, "leave_policy")}

    @r.get("/hr/attendance-summary")
    def att_summary(user: user_dep, db: db_dep, month: str = "", userId: str = ""):
        close_missed_checkouts(db)
        month = month or local_today().strftime("%Y-%m")
        if userId or not is_staff(user):
            uid = userId if userId and is_staff(user) else user["id"]
            res = attendance_month(db, uid, month)
            return {"month": month, "user": {"id": uid, "name": user_name(db, uid)}, **res}
        rows = []
        team = team_ids(db, user)
        for u in [x for x in db.all("SELECT id, name, employee_id, designation FROM users WHERE active = 1 ORDER BY role = 'field' DESC, name") if team is None or x["id"] in team]:
            res = attendance_month(db, u["id"], month)
            rows.append({**u, "totals": res["totals"], "codes": [d["code"] for d in res["days"]]})
        return {"month": month, "rows": rows, "holidays": holidays(db)}

    # -------------------------------------------------------------- assignments: who works where

    @r.post("/hr/assign")
    def assign(payload: dict, user: user_dep, db: db_dep):
        """HR puts a person at sites (they work there) and, for managers, over whole projects (they manage them)."""
        if user["role"] not in ("admin", "hr"):
            raise HTTPException(403, "HR only")
        uid = str(payload.get("userId", ""))
        u = db.one("SELECT id, name, role FROM users WHERE id = ?", uid)
        if not u:
            raise HTTPException(404, "Not found")
        valid = {s["id"] for s in db.all("SELECT id FROM sites")}
        sites = [s for s in payload.get("sites") or [] if s in valid]
        projects = [p for p in payload.get("projects") or [] if p in PROJECTS]
        if projects and u["role"] == "field":
            raise HTTPException(422, "Field staff work at sites; only managers manage a whole project")
        db.run("DELETE FROM user_sites WHERE user_id = ?", uid)
        db.run("DELETE FROM user_projects WHERE user_id = ?", uid)
        for s in sites:
            db.insert("user_sites", {"user_id": uid, "site_id": s})
        for p in projects:
            db.insert("user_projects", {"user_id": uid, "project": p})
        names = [x["name"] for x in db.all("SELECT name FROM sites") if x["name"]]
        del names
        db.notify(uid, "Your sites were updated", ", ".join(site_name(db, s) for s in sites) + (f" · manages {', '.join(PROJECTS[p]['name'] for p in projects)}" if projects else ""), "#sites")
        db.audit(user["id"], "assign", "user", uid, f"sites={len(sites)} projects={projects}")
        return {"ok": True}

    @r.post("/hr/site-member")
    def site_member(payload: dict, user: user_dep, db: db_dep):
        if user["role"] not in ("admin", "hr"):
            raise HTTPException(403, "HR only")
        uid, sid = str(payload.get("userId", "")), str(payload.get("siteId", ""))
        if not db.one("SELECT 1 FROM users WHERE id = ?", uid) or not db.one("SELECT 1 FROM sites WHERE id = ?", sid):
            raise HTTPException(404, "Not found")
        db.run("DELETE FROM user_sites WHERE user_id = ? AND site_id = ?", uid, sid)
        if payload.get("add"):
            db.insert("user_sites", {"user_id": uid, "site_id": sid})
            db.notify(uid, f"You now work at {site_name(db, sid)}", "Open Sites to see it", f"#site/{sid}")
        db.audit(user["id"], "site_member", "site", sid, f"{uid} {'added' if payload.get('add') else 'removed'}")
        return {"ok": True}

    # -------------------------------------------------------------- one site at a glance

    @r.get("/sites/{sid}/summary")
    def site_summary(sid: str, user: user_dep, db: db_dep):
        s = db.one("SELECT * FROM sites WHERE id = ?", sid)
        if not s or not site_allowed(user, sid):
            raise HTTPException(404, "Site not found")
        members = []
        for x in db.all("SELECT u.id, u.name, u.designation, u.role, u.employee_id FROM user_sites us JOIN users u ON u.id = us.user_id WHERE us.site_id = ? AND u.active = 1", sid):
            members.append({**x, "how": "works here"})
        for x in db.all("SELECT u.id, u.name, u.designation, u.role, u.employee_id FROM user_projects up JOIN users u ON u.id = up.user_id WHERE up.project = ? AND u.active = 1", s["project_type"]):
            if not any(m["id"] == x["id"] for m in members):
                members.append({**x, "how": f"manages {PROJECTS.get(s['project_type'], {}).get('name', '')}"})
        on_site = db.all("SELECT a.user_id, a.checkin_at, u.name FROM attendance a JOIN users u ON u.id = a.user_id WHERE a.site_id = ? AND a.checkout_at IS NULL", sid)
        items = [{**i, "balance": balance(db, i["id"])} for i in db.all("SELECT * FROM register_items WHERE site_id = ? AND active = 1 ORDER BY sort, name", sid)]
        month = local_today().strftime("%Y-%m")

        def recs(kind, this_month=False):
            rows = db.all("SELECT * FROM records WHERE kind = ? AND site_id = ?" + (" AND substr(created_at, 1, 7) = ?" if this_month else ""), kind, sid, *([month] if this_month else []))
            return [json.loads(x["data"]) | {"_status": x["status"], "_id": x["id"]} for x in rows]

        stats: dict[str, Any] = {}
        if s["project_type"] == "biochar":
            b = recs("batch", True)
            stats = {"batches": len(b), "output": sum(num(x.get("output_kg")) for x in b), "feedstock": sum(num(x.get("feedstock_kg")) for x in b),
                     "applied": sum(num(x.get("qty_kg")) for x in recs("application", True)), "untested": sum(1 for x in recs("batch") if x["_status"] == "produced")}
        elif s["project_type"] == "gasifier":
            g = recs("gas_run", True)
            stats = {"runs": len(g), "kwh": sum(num(x.get("power_kwh")) for x in g), "hours": sum(num(x.get("run_hours")) for x in g),
                     "down": sum(1 for e in db.all("SELECT status FROM records WHERE kind = 'equipment' AND site_id = ?", sid) if e["status"] != "working")}
        elif s["project_type"] == "agroforestry":
            nursery: dict[str, float] = {}
            for x in recs("nursery"):
                sign = -1 if x.get("action") == "Died or culled" else 1
                nursery[x.get("species", "?")] = nursery.get(x.get("species", "?"), 0) + sign * num(x.get("qty"))
            planted: dict[str, float] = {}
            for x in recs("sapling"):
                planted[x.get("species", "?")] = planted.get(x.get("species", "?"), 0) + num(x.get("count"))
            stock = {sp: nursery.get(sp, 0) - planted.get(sp, 0) for sp in set(nursery) | set(planted)}
            surv = [num(x.get("alive")) / num(x.get("planted"), 1) * 100 for x in recs("survival") if num(x.get("planted"))]
            stats = {"nursery": {k: round(v) for k, v in sorted(stock.items())}, "inNursery": round(sum(v for v in stock.values() if v > 0)),
                     "planted": round(sum(planted.values())), "survival": round(sum(surv) / len(surv)) if surv else None}
        stats["farmers"] = db.one("SELECT COUNT(*) AS n FROM farmers WHERE site_id = ?", sid)["n"]
        stats["openIncidents"] = sum(1 for x in recs("incident") if x["_status"] != "closed")
        tasks = db.all("SELECT t.id, t.title, t.due_date, t.progress, t.priority FROM tasks t JOIN plans p ON p.id = t.plan_id WHERE p.site_id = ? AND t.progress != 'completed' "
                       "ORDER BY t.due_date IS NULL, t.due_date LIMIT 6", sid)
        recent = []
        for x in db.all("SELECT id, kind, title, status, user_id, created_at FROM records WHERE site_id = ? AND kind NOT IN ('profile', 'policy_ack') ORDER BY created_at DESC LIMIT 8", sid):
            if x["kind"] in KINDS:
                recent.append({**x, "user_name": user_name(db, x["user_id"]), "label": KINDS[x["kind"]]["one"], "icon": KINDS[x["kind"]]["icon"]})
        return {"site": s, "project": PROJECTS.get(s["project_type"]), "members": members, "onSite": on_site, "items": items, "stats": stats, "tasks": tasks, "recent": recent}

    @r.post("/hr/settings")
    def hr_settings(payload: dict, user: user_dep, db: db_dep):
        if user["role"] not in ("admin", "hr"):
            raise HTTPException(403, "HR only")
        for key in ("approval_chains", "leave_policy", "work_hours", "retention", "messaging"):
            if key in payload:
                db.set_setting(key, payload[key])
        return {"ok": True}

    # -------------------------------------------------------------- payroll

    @r.get("/payroll/preview")
    def payroll_preview(user: user_dep, db: db_dep, month: str = ""):
        if user["role"] not in ("admin", "hr"):
            raise HTTPException(403, "HR only")
        month = month or local_today().strftime("%Y-%m")
        rows = payroll_rows(db, month)
        runs = db.all("SELECT id, title, status, created_at, data FROM records WHERE kind = 'payroll_run' ORDER BY created_at DESC")
        for x in runs:
            d = json.loads(x.pop("data"))
            x["month"], x["count"], x["net"] = d["month"], len(d["rows"]), sum(rr["net"] for rr in d["rows"])
        return {"month": month, "rows": rows, "totals": {k: sum(rr[k] for rr in rows) for k in ("gross", "pf", "esi", "pt", "tds", "advance", "net", "employer_pf", "employer_esi")},
                "runs": runs}

    @r.post("/payroll/run")
    def payroll_run(payload: dict, user: user_dep, db: db_dep):
        if user["role"] not in ("admin", "hr"):
            raise HTTPException(403, "HR only")
        month = str(payload.get("month") or local_today().strftime("%Y-%m"))
        if db.one("SELECT 1 FROM records WHERE kind = 'payroll_run' AND title = ?", f"Payroll {month}"):
            raise HTTPException(409, f"Payroll for {month} is already run")
        rows = payroll_rows(db, month)
        company = db.setting("company") or {}
        for rr in rows:
            pdf = payslip_pdf(company, month, rr)
            fid = save_bytes(db, pdf, f"HR/Payslips/{month}", f"Payslip {month} {rr['employee_id']}.pdf", "application/pdf", "hr_document", user["id"])
            db.insert("hr_documents", {"user_id": rr["user_id"], "title": f"Payslip {datetime.strptime(month, '%Y-%m'):%B %Y}", "category": "Payslip",
                                       "file_id": fid, "uploaded_by": user["id"], "created_at": now_iso()})
            db.notify(rr["user_id"], "Payslip ready", f"{datetime.strptime(month, '%Y-%m'):%B %Y} · net ₹{rr['net']:,.0f}", "#me")
        rid = db.insert("records", {"kind": "payroll_run", "title": f"Payroll {month}", "status": "processed", "data": json.dumps({"month": month, "rows": rows}),
                                    "created_by": user["id"], "created_at": now_iso(), "updated_at": now_iso()})
        db.audit(user["id"], "payroll_run", "payroll", rid, month)
        return {"id": rid, "count": len(rows)}

    def run_rows(db: Db, rid: str) -> tuple[str, list[dict]]:
        rec = db.one("SELECT data FROM records WHERE id = ? AND kind = 'payroll_run'", rid)
        if not rec:
            raise HTTPException(404, "Not found")
        d = json.loads(rec["data"])
        return d["month"], d["rows"]

    @r.get("/payroll/{rid}/bank.csv")
    def bank_file(rid: str, user: user_dep, db: db_dep):
        if user["role"] not in ("admin", "hr"):
            raise HTTPException(403, "HR only")
        month, rows = run_rows(db, rid)
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["Beneficiary name", "Account number", "IFSC", "Amount", "Narration"])
        for rr in rows:
            w.writerow([rr["name"], rr["account"], rr["ifsc"], f"{rr['net']:.2f}", f"Salary {month}"])
        return Response(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="bank-transfer-{month}.csv"'})

    @r.get("/payroll/{rid}/register.csv")
    def pay_register(rid: str, user: user_dep, db: db_dep):
        if user["role"] not in ("admin", "hr"):
            raise HTTPException(403, "HR only")
        month, rows = run_rows(db, rid)
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["Employee", "Name", "Paid days", "LOP", "Basic", "HRA", "Special", "Conveyance", "Gross", "PF", "ESI", "PT", "TDS", "Advance", "Net", "Employer PF", "Employer ESI"])
        for rr in rows:
            e = rr["earnings"]
            w.writerow([rr["employee_id"], rr["name"], rr["paid_days"], rr["lop"], e["basic"], e["hra"], e["special"], e["conveyance"], rr["gross"], rr["pf"], rr["esi"],
                        rr["pt"], rr["tds"], rr["advance"], rr["net"], rr["employer_pf"], rr["employer_esi"]])
        return Response(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="salary-register-{month}.csv"'})

    @r.get("/payroll/{rid}/tally.xml")
    def tally(rid: str, user: user_dep, db: db_dep):
        if user["role"] not in ("admin", "hr"):
            raise HTTPException(403, "HR only")
        month, rows = run_rows(db, rid)
        return Response(tally_xml((db.setting("company") or {}).get("name", ""), month, rows), media_type="application/xml",
                        headers={"Content-Disposition": f'attachment; filename="tally-salary-{month}.xml"'})

    # -------------------------------------------------------------- carbon chain of custody

    def carbon_chain(db: Db, b: dict) -> dict:
        d = b["data"] if isinstance(b["data"], dict) else json.loads(b["data"])
        code = d.get("code", "")
        files = []

        def ffile(fid):
            if not fid:
                return None
            f = db.one("SELECT id, name, sha256, lat, lng, taken_at FROM files WHERE id = ?", fid)
            if f:
                files.append(f)
            return f

        movs = db.all("SELECT m.*, i.name AS item_name, i.unit FROM movements m JOIN register_items i ON i.id = m.item_id WHERE m.batch = ? ORDER BY m.at", code)
        labs = [enrich(db, "lab_result", x) for x in db.all("SELECT * FROM records WHERE kind = 'lab_result' AND json_extract(data, '$.batch') = ?", b["id"])]
        apps = []
        for a in db.all("SELECT * FROM records WHERE kind = 'application' AND json_extract(data, '$.batch') = ? ORDER BY created_at", b["id"]):
            a = enrich(db, "application", a)
            fr = db.one("SELECT f.name, f.village, f.taluka FROM farmers f WHERE f.id = ?", a["data"].get("farmer"))
            a["farmer"] = fr or {}
            a["photo"] = ffile(a["file_id"])
            apps.append(a)
        for x in labs:
            x["photo"] = ffile(x["file_id"])
        site = db.one("SELECT name, lat, lng FROM sites WHERE id = ?", b["site_id"])
        applied = sum(num(a["data"].get("qty_kg")) for a in apps)
        lab_ok = any(x["data"].get("result") == "Pass" for x in labs)
        checks = [
            {"label": "Feedstock and output recorded with photo", "ok": bool(b.get("file_id")) and num(d.get("feedstock_kg")) > 0},
            {"label": "Stock register posted for the batch", "ok": len(movs) >= 2},
            {"label": "Lab result passed (H/Corg < 0.7)", "ok": lab_ok and all(num(x["data"].get("h_corg"), 0) < 0.7 for x in labs if x["data"].get("h_corg"))},
            {"label": "Applied to farms with GPS and photo", "ok": bool(apps) and all(a.get("lat") and a.get("photo") for a in apps)},
            {"label": "All biochar accounted for", "ok": abs(applied - num(d.get("output_kg"))) < 1 or applied >= num(d.get("output_kg"))},
        ]
        ffile(b.get("file_id"))
        carbon_pct = max((num(x["data"].get("carbon")) for x in labs), default=0)
        co2e = round(applied * carbon_pct / 100 * 44 / 12 * 0.8 / 1000, 2) if carbon_pct else 0  # tonnes; 80% permanence factor (illustrative)
        return {"site": site, "movements": movs, "labs": labs, "applications": apps, "files": files, "checks": checks, "applied": applied,
                "remaining": round(num(d.get("output_kg")) - applied, 1), "co2e_t": co2e}

    @r.get("/carbon/batch/{rid}/report.pdf")
    def carbon_pdf(rid: str, user: user_dep, db: db_dep):
        b = db.one("SELECT * FROM records WHERE id = ? AND kind = 'batch'", rid)
        if not b:
            raise HTTPException(404, "Not found")
        b = enrich(db, "batch", b)
        ch = carbon_chain(db, b)
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.units import mm
        from reportlab.pdfgen import canvas

        buf = io.BytesIO()
        c = canvas.Canvas(buf, pagesize=A4)
        w, h = A4
        y = h - 20 * mm

        def line(text: str, size: float = 10, bold: bool = False, gap: float = 6):
            nonlocal y
            if y < 20 * mm:
                c.showPage()
                y = h - 20 * mm
            c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
            c.drawString(18 * mm, y, text[:110])
            y -= gap * mm

        d = b["data"]
        line(f"Chain of custody: biochar batch {d.get('code')}", 15, True, 9)
        line(f"{(db.setting('company') or {}).get('name', '')} · {ch['site']['name'] if ch['site'] else ''} · generated {datetime.now():%d %b %Y %H:%M}", 9, gap=8)
        line("1. Production", 12, True)
        line(f"Feedstock {d.get('feedstock_type', '')}: {num(d.get('feedstock_kg')):g} kg, moisture {d.get('moisture', '-')}%")
        line(f"Biochar out: {num(d.get('output_kg')):g} kg (yield {b['yield']}%), peak {d.get('peak_temp', '-')} °C, {d.get('start', '')} to {d.get('end', '')}", gap=8)
        line("2. Stock register", 12, True)
        for m in ch["movements"]:
            line(f"{m['at'][:16]}  {m['type']:>3} {m['qty']:g} {m['unit']} {m['item_name']}  balance {m['balance_after']:g}")
        y -= 2 * mm
        line("3. Laboratory", 12, True)
        for x in ch["labs"]:
            ld = x["data"]
            line(f"{ld.get('lab')}: C {ld.get('carbon')}%, H/Corg {ld.get('h_corg', '-')}, ash {ld.get('ash', '-')}%, pH {ld.get('ph', '-')} -> {ld.get('result')}")
        y -= 2 * mm
        line("4. Application to farms", 12, True)
        for a in ch["applications"]:
            ad = a["data"]
            line(f"{ad.get('date')}  {a['farmer'].get('name', '')}, {a['farmer'].get('village', '')}  survey {ad.get('plot', '-')}  {num(ad.get('qty_kg')):g} kg  "
                 f"GPS {a.get('lat') or 0:.5f},{a.get('lng') or 0:.5f}")
        line(f"Applied {ch['applied']:g} kg, remaining {ch['remaining']:g} kg. Estimated removal {ch['co2e_t']} t CO2e (illustrative).", gap=8)
        line("5. Checks", 12, True)
        for ck in ch["checks"]:
            line(f"[{'x' if ck['ok'] else ' '}] {ck['label']}")
        y -= 2 * mm
        line("6. Evidence files (SHA-256)", 12, True)
        for f in ch["files"]:
            line(f"{f['name'][:60]}  {f['sha256'][:32]}…", 8, gap=4.5)
        c.showPage()
        c.save()
        return Response(buf.getvalue(), media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="chain-of-custody-{d.get("code")}.pdf"'})

    # -------------------------------------------------------------- map

    @r.get("/map")
    def map_data(user: user_dep, db: db_dep):
        sites = [s for s in db.all("SELECT id, name, project_type, subtype, lat, lng, radius_m FROM sites WHERE active = 1 AND project_type != 'office'") if site_allowed(user, s["id"])]
        ids = {s["id"] for s in sites}
        plots = []
        for p in db.all("SELECT p.*, f.name AS farmer_name, f.village, f.site_id, f.id AS fid FROM plots p JOIN farmers f ON f.id = p.farmer_id WHERE p.kml_file IS NOT NULL"):
            if p["site_id"] not in ids:
                continue
            f = db.one("SELECT path FROM files WHERE id = ?", p["kml_file"])
            if not f or not store.exists(f["path"]):
                continue
            try:
                text = store.get(f["path"]).decode("utf-8", "replace")
                import re as _re
                coords = _re.search(r"<coordinates>(.*?)</coordinates>", text, _re.S)
                pts = [[float(t.split(",")[1]), float(t.split(",")[0])] for t in coords.group(1).split()] if coords else []
            except Exception:  # noqa: BLE001
                pts = []
            if pts:
                plots.append({"farmer": p["farmer_name"], "farmerId": p["fid"], "village": p["village"], "survey": p["survey_no"], "area": p["area_ha_kml"], "points": pts})
        pins = []
        for kind in ("incident", "application", "survival"):
            for x in db.all("SELECT id, title, lat, lng, site_id, created_at, data FROM records WHERE kind = ? AND lat IS NOT NULL", kind):
                if x["site_id"] in ids or x["site_id"] is None:
                    pins.append({"kind": kind, "id": x["id"], "title": x["title"], "lat": x["lat"], "lng": x["lng"], "at": x["created_at"]})
        people = [p for p in db.all("SELECT a.checkin_lat AS lat, a.checkin_lng AS lng, a.site_id, u.name, s.name AS site FROM attendance a JOIN users u ON u.id = a.user_id JOIN sites s ON s.id = a.site_id WHERE a.checkout_at IS NULL") if p["site_id"] in ids] if is_staff(user) else []
        return {"sites": sites, "plots": plots, "pins": pins, "people": people}

    # -------------------------------------------------------------- geofence: left the site while on duty

    @r.post("/attendance/left-site")
    def left_site(payload: dict, user: user_dep, db: db_dep):
        a = db.one("SELECT a.*, s.name AS site_name, s.lat AS slat, s.lng AS slng, s.radius_m FROM attendance a JOIN sites s ON s.id = a.site_id WHERE a.user_id = ? AND a.checkout_at IS NULL", user["id"])
        if not a:
            return {"ok": False}
        lat, lng = num(payload.get("lat")), num(payload.get("lng"))
        dist = haversine_m(lat, lng, a["slat"], a["slng"])
        if dist <= a["radius_m"] + min(num(payload.get("accuracy")), 50):
            return {"ok": True, "inside": True}
        if a.get("flag") != "left_site":
            db.update("attendance", a["id"], {"flag": "left_site"})
            db.notify_role(("manager", "admin"), f"Left site while checked in: {user['name']}", f"{dist:,.0f} m from {a['site_name']} at {datetime.now():%H:%M}", "#team", a["site_id"])
        return {"ok": True, "inside": False, "distance": round(dist)}

    # -------------------------------------------------------------- consent, my data, two-step sign-in, messages

    @r.post("/me/consent")
    def consent(user: user_dep, db: db_dep):
        db.run("UPDATE users SET consent_at = ? WHERE id = ?", now_iso(), user["id"])
        db.audit(user["id"], "consent", "user", user["id"], "data processing notice accepted")
        return {"ok": True}

    @r.get("/me/export")
    def my_export(user: user_dep, db: db_dep):
        out = {"user": {k: user.get(k) for k in ("employee_id", "name", "role", "designation", "phone", "email")}, "profile": profile_data(db, user["id"])}
        for t, col in (("attendance", "user_id"), ("trips", "user_id"), ("leaves", "user_id"), ("work_updates", "user_id")):
            out[t] = db.all(f"SELECT * FROM {t} WHERE {col} = ?", user["id"])  # noqa: S608
        out["records"] = db.all("SELECT kind, title, status, data, created_at FROM records WHERE user_id = ? AND kind != 'profile'", user["id"])
        return Response(json.dumps(out, indent=1, default=str), media_type="application/json", headers={"Content-Disposition": 'attachment; filename="my-kshetralekha-data.json"'})

    @r.get("/auth/2fa")
    def twofa_status(user: user_dep, db: db_dep):
        row = db.one("SELECT secret, enabled FROM user_totp WHERE user_id = ?", user["id"])
        res = {"enabled": bool(row and row["enabled"])}
        if demo and row and row["enabled"]:
            res["demoCode"] = totp(row["secret"])
        return res

    @r.post("/auth/2fa/setup")
    def twofa_setup(user: user_dep, db: db_dep):
        if user["role"] not in ("admin", "hr", "manager"):
            raise HTTPException(403, "For office accounts")
        secret = base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")
        db.run("INSERT INTO user_totp (user_id, secret, enabled) VALUES (?, ?, 0) ON CONFLICT(user_id) DO UPDATE SET secret = excluded.secret, enabled = 0", user["id"], secret)
        issuer = "Kshetralekha"
        return {"secret": secret, "uri": f"otpauth://totp/{issuer}:{user['employee_id']}?secret={secret}&issuer={issuer}", "demoCode": totp(secret) if demo else None}

    @r.post("/auth/2fa/enable")
    def twofa_enable(payload: dict, user: user_dep, db: db_dep):
        row = db.one("SELECT secret FROM user_totp WHERE user_id = ?", user["id"])
        if not row or not totp_ok(row["secret"], payload.get("code", "")):
            raise HTTPException(422, "That code is not right. Use the current 6-digit code from the authenticator app.")
        db.run("UPDATE user_totp SET enabled = 1 WHERE user_id = ?", user["id"])
        db.audit(user["id"], "2fa_enabled", "user", user["id"], "")
        return {"ok": True}

    @r.post("/auth/2fa/disable")
    def twofa_disable(user: user_dep, db: db_dep):
        db.run("DELETE FROM user_totp WHERE user_id = ?", user["id"])
        return {"ok": True}

    @r.get("/admin/messages")
    def messages(user: user_dep, db: db_dep):
        if not is_staff(user):
            raise HTTPException(403, "Managers only")
        return {"rows": db.all("SELECT * FROM message_log ORDER BY created_at DESC LIMIT 100"), "messaging": setting(db, "messaging")}

    # -------------------------------------------------------------- reports

    @r.get("/reports/summary")
    def report_summary(user: user_dep, db: db_dep, month: str = ""):
        if not is_staff(user):
            raise HTTPException(403, "Managers only")
        month = month or local_today().strftime("%Y-%m")

        def recs(kind):
            return [enrich(db, kind, x) for x in db.all("SELECT * FROM records WHERE kind = ? AND substr(created_at, 1, 7) = ?", kind, month)
                    if x["site_id"] is None or site_allowed(user, x["site_id"])]

        batches = recs("batch")
        exp = recs("expense")
        by_cat: dict[str, float] = {}
        for e in exp:
            by_cat[e["data"].get("category", "Other")] = by_cat.get(e["data"].get("category", "Other"), 0) + num(e["data"].get("amount"))
        weeks: dict[str, float] = {}
        for b in batches:
            wk = to_local(b["created_at"]).strftime("%d %b")
            weeks[wk] = weeks.get(wk, 0) + num(b["data"].get("output_kg"))
        inc = recs("incident")
        att = []
        for u in db.all("SELECT id, name FROM users WHERE active = 1 AND role = 'field' ORDER BY name"):
            att.append({"name": u["name"], **attendance_month(db, u["id"], month)["totals"]})
        trips = db.one("SELECT COALESCE(SUM(amount), 0) AS amt, COALESCE(SUM(km_claimed), 0) AS km FROM trips WHERE status = 'approved' AND substr(end_at, 1, 7) = ?", month)
        return {"month": month,
                "production": {"batches": len(batches), "feedstock": sum(num(b["data"].get("feedstock_kg")) for b in batches),
                               "output": sum(num(b["data"].get("output_kg")) for b in batches), "byDay": weeks},
                "applied": sum(num(a["data"].get("qty_kg")) for a in recs("application")),
                "expenses": {"total": sum(num(e["data"].get("amount")) for e in exp), "approved": sum(num(e["data"].get("amount")) for e in exp if e["status"] == "approved"),
                             "byCategory": by_cat},
                "incidents": {"total": len(inc), "open": sum(1 for i in inc if i["status"] != "closed"),
                              "bySeverity": {s: sum(1 for i in inc if i["data"].get("severity") == s) for s in ("Low", "Medium", "High", "Critical")}},
                "attendance": att, "travel": trips,
                "saplings": sum(num(s["data"].get("count")) for s in recs("sapling"))}

    return r
