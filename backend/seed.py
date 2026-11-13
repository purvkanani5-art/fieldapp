"""Demo data for the prototype: a company, users of every role (PIN 1234), three sites, register items and a
farmer-agreement template. Runs once on an empty database."""

from __future__ import annotations

import json

from auth import hash_pin
from db import Db, now_iso
from pdfgen import placeholder_signature
from storage import store

USERS = [
    ("EMP001", "Purv Kanani", "admin", "Director"),
    ("EMP002", "Meera Shah", "manager", "Operations Manager"),
    ("EMP003", "Ravi Patel", "hr", "HR Executive"),
    ("EMP101", "Jignesh Rathod", "field", "Field Officer, Biochar"),
    ("EMP102", "Kiran Vaghela", "field", "Field Officer, Agroforestry"),
    ("EMP103", "Suresh Makwana", "field", "Site Operator, Gasifier"),
]

SITES = [
    ("Biochar Site, Rajkot", "biochar", 22.3039, 70.8022, 200, "Survey 112, Lodhika, Rajkot"),
    ("Agroforestry Cluster, Junagadh", "agroforestry", 21.5222, 70.4579, 400, "Vanthali road, Junagadh"),
    ("Gasifier Plant, Surat", "gasifier", 21.1702, 72.8311, 150, "GIDC Sachin, Surat"),
    ("Head Office, Ahmedabad", "office", 23.0225, 72.5714, 120, "SG Highway, Ahmedabad"),
]

ITEMS = {
    "biochar": [("Diesel", "L", "input", 60), ("Biomass (feedstock)", "kg", "input", 2000), ("Biochar (finished)", "kg", "product", 0)],
    "gasifier": [("Feedstock", "kg", "input", 1500), ("Diesel", "L", "input", 40), ("Power generated", "kWh", "product", 0), ("Ash / char", "kg", "product", 0)],
}

TEMPLATE_BODY = """This agreement is made on the date above between {{company}} (the Company) and Shri/Smt {{name}}, s/o or d/o {{father_name}}, resident of village {{village}}, taluka {{taluka}}, district {{district}} (the Farmer).

The Farmer agrees to plant and maintain the trees listed below on the land bearing survey number {{survey_no}} measuring about {{area_ha}} hectares, for the agroforestry programme of the Company, and permits the Company and its verifiers to visit, measure and photograph the plantation.

The Company agrees to supply saplings, provide technical guidance, and pass on the agreed share of carbon revenue to the Farmer as per the programme terms explained to the Farmer in their own language.

Both parties have read and understood this agreement. The Farmer has signed below in the presence of the Company's field officer, whose location and time of recording are printed at the foot of this document."""

TEMPLATE_FIELDS = [
    {"key": "survey_no", "label": "Survey number", "type": "text", "required": True},
    {"key": "area_ha", "label": "Area (hectares)", "type": "number", "required": True},
    {"key": "trees_count", "label": "Number of saplings", "type": "number", "required": True},
    {"key": "species", "label": "Species", "type": "text", "required": True},
    {"key": "planting_month", "label": "Planting month", "type": "text", "required": False},
    {"key": "bank_last4", "label": "Bank account (last 4)", "type": "text", "required": False},
]


def seed_if_empty() -> None:
    db = Db()
    try:
        if db.one("SELECT 1 FROM users LIMIT 1"):
            return
        now = now_iso()
        db.set_setting("company", {"name": "Sajeevan Life Pvt Ltd", "address": "Registered office, Gujarat, India", "short": "Sajeevan"})
        db.set_setting("travel", {"vehicles": {"Two-wheeler": 3.5, "Car": 9.0, "Public transport": 0.0}, "currency": "₹"})
        db.set_setting("leave_types", ["Casual", "Sick", "Earned", "Unpaid"])
        db.set_setting("update_prompts", ["What did you complete today?", "What is planned for tomorrow?", "Any blockers?"])

        sig = placeholder_signature("Sajeevan Life Pvt Ltd")
        rel, sha = store.put("Company", "authorised-signature.png", sig)
        fid = db.insert("files", {"path": rel, "name": "authorised-signature.png", "mime": "image/png", "size": len(sig), "sha256": sha,
                                  "kind": "company_signature", "created_at": now})
        db.set_setting("company_signature_file", fid)

        site_ids = {}
        for name, ptype, lat, lng, radius, addr in SITES:
            site_ids[ptype] = db.insert("sites", {"name": name, "project_type": ptype, "lat": lat, "lng": lng, "radius_m": radius, "address": addr, "active": 1})
        for ptype, items in ITEMS.items():
            for i, (name, unit, kind, low) in enumerate(items):
                db.insert("register_items", {"site_id": site_ids[ptype], "name": name, "unit": unit, "kind": kind, "low_stock": low, "active": 1, "sort": i})

        pin_hash, salt = hash_pin("1234")
        uid = {}
        for emp, name, role, desig in USERS:
            uid[emp] = db.insert("users", {"employee_id": emp, "name": name, "role": role, "designation": desig, "pin_hash": pin_hash, "pin_salt": salt,
                                           "must_change_pin": 0, "active": 1, "created_at": now})
        assign = {"EMP002": list(site_ids.values()), "EMP101": [site_ids["biochar"]], "EMP102": [site_ids["agroforestry"]], "EMP103": [site_ids["gasifier"]],
                  "EMP003": [site_ids["office"]]}
        for emp, sites in assign.items():
            for s in sites:
                db.insert("user_sites", {"user_id": uid[emp], "site_id": s})

        db.insert("templates", {"name": "Agroforestry Farmer Agreement", "project_type": "agroforestry", "body": TEMPLATE_BODY,
                                "fields": json.dumps(TEMPLATE_FIELDS), "active": 1})
        db.insert("templates", {"name": "Biomass Supply Declaration", "project_type": "biochar",
                                "body": "I, {{name}} of village {{village}}, declare that the biomass supplied to {{company}} on {{supply_date}} ({{biomass_kg}} kg of {{biomass_type}}) is agricultural residue from my own land bearing survey number {{survey_no}}, and that no standing trees were felled for it.",
                                "fields": json.dumps([
                                    {"key": "supply_date", "label": "Supply date", "type": "text", "required": True},
                                    {"key": "biomass_kg", "label": "Quantity (kg)", "type": "number", "required": True},
                                    {"key": "biomass_type", "label": "Type of residue", "type": "text", "required": True},
                                    {"key": "survey_no", "label": "Survey number", "type": "text", "required": False},
                                ]), "active": 1})
        for emp in uid:
            db.notify(uid[emp], "Welcome to Kshetralekha", "This is the prototype. Your PIN is 1234; change it from Me → Change PIN.", "#me")
        db.audit(None, "seed", "database", None, "demo data")
    finally:
        db.close()
