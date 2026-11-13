"""SQLite storage for the prototype. One file under data/, created on first run.

Plain sqlite3 on purpose: the prototype must run from a folder with no services. The same schema moves to
Azure SQL / Postgres unchanged when the app goes live (ids are text, times are ISO strings in UTC).
"""

from __future__ import annotations

import json
import os
import sqlite3
import uuid
from datetime import UTC, datetime
from pathlib import Path

DATA_DIR = Path(os.environ.get("KL_DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "kshetralekha.sqlite"

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, employee_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','manager','hr','field')),
  designation TEXT DEFAULT '', phone TEXT DEFAULT '', email TEXT DEFAULT '', entra_oid TEXT DEFAULT '',
  pin_hash TEXT DEFAULT '', pin_salt TEXT DEFAULT '', must_change_pin INTEGER DEFAULT 1,
  active INTEGER DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_sites (user_id TEXT NOT NULL, site_id TEXT NOT NULL, PRIMARY KEY (user_id, site_id));
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT DEFAULT '', created_at TEXT NOT NULL, last_seen TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, project_type TEXT NOT NULL,
  lat REAL NOT NULL, lng REAL NOT NULL, radius_m INTEGER NOT NULL DEFAULT 150,
  address TEXT DEFAULT '', active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY, path TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL,
  sha256 TEXT NOT NULL, kind TEXT NOT NULL, lat REAL, lng REAL, accuracy REAL, taken_at TEXT,
  uploaded_by TEXT, created_at TEXT NOT NULL, remote_id TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS attendance (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, site_id TEXT NOT NULL,
  checkin_at TEXT NOT NULL, checkin_file TEXT, checkin_lat REAL, checkin_lng REAL, checkin_acc REAL, checkin_dist REAL,
  checkout_at TEXT, checkout_file TEXT, checkout_lat REAL, checkout_lng REAL, checkout_acc REAL, checkout_dist REAL,
  status TEXT NOT NULL DEFAULT 'ok', override_reason TEXT DEFAULT '', decided_by TEXT, decided_at TEXT, decision_note TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, site_id TEXT, vehicle TEXT NOT NULL, purpose TEXT DEFAULT '',
  start_at TEXT NOT NULL, start_reading REAL NOT NULL, start_file TEXT, start_lat REAL, start_lng REAL,
  end_at TEXT, end_reading REAL, end_file TEXT, end_lat REAL, end_lng REAL,
  km_claimed REAL, km_straight REAL, rate_per_km REAL, amount REAL,
  status TEXT NOT NULL DEFAULT 'open', decided_by TEXT, decided_at TEXT, decision_note TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS register_items (
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL, name TEXT NOT NULL, unit TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('input','product')), low_stock REAL DEFAULT 0, active INTEGER DEFAULT 1, sort INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS movements (
  id TEXT PRIMARY KEY, item_id TEXT NOT NULL, user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('in','out','count')), qty REAL NOT NULL, balance_after REAL NOT NULL,
  batch TEXT DEFAULT '', note TEXT DEFAULT '', file_id TEXT, lat REAL, lng REAL, at TEXT NOT NULL,
  reverses_id TEXT, variance REAL
);

CREATE TABLE IF NOT EXISTS farmers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, father_name TEXT DEFAULT '', village TEXT DEFAULT '', taluka TEXT DEFAULT '',
  district TEXT DEFAULT '', phone TEXT DEFAULT '', id_last4 TEXT DEFAULT '', site_id TEXT, created_by TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plots (
  id TEXT PRIMARY KEY, farmer_id TEXT NOT NULL, survey_no TEXT DEFAULT '', area_ha_declared REAL, area_ha_kml REAL,
  kml_file TEXT, land_record_file TEXT, notes TEXT DEFAULT '', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, project_type TEXT NOT NULL, body TEXT NOT NULL, fields TEXT NOT NULL,
  active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY, doc_no TEXT UNIQUE NOT NULL, farmer_id TEXT NOT NULL, template_id TEXT NOT NULL, user_id TEXT NOT NULL,
  fields TEXT NOT NULL, pdf_file TEXT NOT NULL, signature_file TEXT, lat REAL, lng REAL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS farmer_files (
  id TEXT PRIMARY KEY, farmer_id TEXT NOT NULL, kind TEXT NOT NULL, file_id TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hr_documents (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, category TEXT NOT NULL, file_id TEXT NOT NULL,
  uploaded_by TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS work_updates (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, date TEXT NOT NULL, site_id TEXT, summary TEXT NOT NULL,
  hours REAL, blockers TEXT DEFAULT '', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY, user_id TEXT, type TEXT NOT NULL CHECK (type IN ('complaint','suggestion')), text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', response TEXT DEFAULT '', responded_by TEXT, responded_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS leaves (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, from_date TEXT NOT NULL, to_date TEXT NOT NULL, type TEXT NOT NULL,
  reason TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', decided_by TEXT, decided_at TEXT, decision_note TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT DEFAULT '', link TEXT DEFAULT '',
  read INTEGER DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
  id TEXT PRIMARY KEY, user_id TEXT, action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT, detail TEXT DEFAULT '', at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_att_user ON attendance (user_id, checkin_at);
CREATE INDEX IF NOT EXISTS idx_mov_item ON movements (item_id, at);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications (user_id, read);
"""


NO_ID_TABLES = {"user_sites"}


def now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def new_id() -> str:
    return uuid.uuid4().hex


def connect() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA foreign_keys=ON")
    return con


def init_db() -> None:
    with connect() as con:
        con.executescript(SCHEMA)


class Db:
    """Tiny helper around a connection: rows come back as dicts."""

    def __init__(self) -> None:
        self.con = connect()

    def close(self) -> None:
        self.con.close()

    def all(self, sql: str, *args) -> list[dict]:
        return [dict(r) for r in self.con.execute(sql, args).fetchall()]

    def one(self, sql: str, *args) -> dict | None:
        r = self.con.execute(sql, args).fetchone()
        return dict(r) if r else None

    def run(self, sql: str, *args) -> None:
        self.con.execute(sql, args)
        self.con.commit()

    def insert(self, table: str, row: dict) -> str:
        row = dict(row)
        if table not in NO_ID_TABLES:
            row.setdefault("id", new_id())
        cols = ", ".join(row)
        marks = ", ".join("?" for _ in row)
        self.con.execute(f"INSERT INTO {table} ({cols}) VALUES ({marks})", tuple(row.values()))  # noqa: S608
        self.con.commit()
        return row.get("id", "")

    def update(self, table: str, id_: str, patch: dict) -> None:
        if not patch:
            return
        sets = ", ".join(f"{k} = ?" for k in patch)
        self.con.execute(f"UPDATE {table} SET {sets} WHERE id = ?", (*patch.values(), id_))  # noqa: S608
        self.con.commit()

    def setting(self, key: str, default=None):
        r = self.one("SELECT value FROM settings WHERE key = ?", key)
        return json.loads(r["value"]) if r else default

    def set_setting(self, key: str, value) -> None:
        self.run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, json.dumps(value))

    def audit(self, user_id: str | None, action: str, entity: str, entity_id: str | None = None, detail: str = "") -> None:
        self.insert("audit", {"user_id": user_id, "action": action, "entity": entity, "entity_id": entity_id, "detail": detail, "at": now_iso()})

    def notify(self, user_id: str, title: str, body: str = "", link: str = "") -> None:
        self.insert("notifications", {"user_id": user_id, "title": title, "body": body, "link": link, "read": 0, "created_at": now_iso()})

    def notify_role(self, roles: tuple[str, ...], title: str, body: str = "", link: str = "", site_id: str | None = None) -> None:
        """Tell every active user in the roles (optionally only those assigned to the site, admins always)."""
        marks = ", ".join("?" for _ in roles)
        users = self.all(f"SELECT id, role FROM users WHERE active = 1 AND role IN ({marks})", *roles)  # noqa: S608
        for u in users:
            if site_id and u["role"] != "admin":
                ok = self.one("SELECT 1 FROM user_sites WHERE user_id = ? AND site_id = ?", u["id"], site_id)
                has_any = self.one("SELECT 1 FROM user_sites WHERE user_id = ?", u["id"])
                if has_any and not ok:
                    continue  # assigned elsewhere
            self.notify(u["id"], title, body, link)
