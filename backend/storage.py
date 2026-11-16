"""Where files go. The prototype writes to data/files/<folder tree>; the live app writes the same tree into a
SharePoint document library through Microsoft Graph (SharePointStore), keeping a local copy as a cache.

Every stored file gets a SHA-256 so a photo or PDF can be proven unchanged later (carbon-credit audits).

Live set-up (KL_STORAGE=sharepoint): an Entra app registration with the application permission `Sites.Selected`,
granted Write on one SharePoint site. Environment: KL_SP_TENANT, KL_SP_CLIENT_ID, KL_SP_CLIENT_SECRET,
KL_SP_SITE (https://<tenant>.sharepoint.com/sites/<name>), optional KL_SP_FOLDER (default "Records") and
KL_SP_BACKUP_LIBRARY (default "Backups"). The server's disk is temporary in Azure Container Apps, so a file that
cannot reach SharePoint at once is kept inside the database (table sp_pending, which is replicated) and retried.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import re
import sqlite3
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

from db import DATA_DIR, DB_PATH

FILES_DIR = DATA_DIR / "files"
FILES_DIR.mkdir(parents=True, exist_ok=True)


def safe_name(name: str) -> str:
    name = re.sub(r"[^\w.\- ()]+", "_", name, flags=re.UNICODE).strip() or "file"
    return name[:120]


class LocalStore:
    """Files under data/files, mirrored one-to-one to the SharePoint folder layout."""

    remote = False

    def _rel(self, folder: str, name: str) -> Path:
        return Path(*[safe_name(p) for p in folder.split("/") if p]) / safe_name(name)

    def put(self, folder: str, name: str, data: bytes) -> tuple[str, str]:
        rel = self._rel(folder, name)
        full = FILES_DIR / rel
        full.parent.mkdir(parents=True, exist_ok=True)
        # never overwrite: evidence files are immutable
        if full.exists() or self._taken(str(rel).replace("\\", "/")):
            stem, suffix = full.stem, full.suffix
            n = 2
            while (full.parent / f"{stem} ({n}){suffix}").exists() or self._taken(str((full.parent / f"{stem} ({n}){suffix}").relative_to(FILES_DIR)).replace("\\", "/")):
                n += 1
            full = full.parent / f"{stem} ({n}){suffix}"
            rel = full.relative_to(FILES_DIR)
        full.write_bytes(data)
        return str(rel).replace("\\", "/"), hashlib.sha256(data).hexdigest()

    def _taken(self, rel: str) -> bool:  # noqa: ARG002 - the SharePoint store also checks the remote side
        return False

    def get(self, rel: str) -> bytes:
        return (FILES_DIR / rel).read_bytes()

    def exists(self, rel: str) -> bool:
        return (FILES_DIR / rel).exists()


# ------------------------------------------------------------------ Microsoft Graph


class Graph:
    """The few Graph calls the app needs, with an app-only token (client credentials). Standard library only."""

    BASE = "https://graph.microsoft.com/v1.0"

    def __init__(self, tenant: str, client_id: str, secret: str) -> None:
        self.tenant, self.client_id, self.secret = tenant, client_id, secret
        self._token, self._expires = "", 0.0
        self._lock = threading.Lock()

    def token(self) -> str:
        with self._lock:
            if self._token and time.time() < self._expires - 120:
                return self._token
            body = urllib.parse.urlencode({"client_id": self.client_id, "client_secret": self.secret, "grant_type": "client_credentials",
                                           "scope": "https://graph.microsoft.com/.default"}).encode()
            req = urllib.request.Request(f"https://login.microsoftonline.com/{self.tenant}/oauth2/v2.0/token", data=body, method="POST")
            with urllib.request.urlopen(req, timeout=30) as r:
                d = json.loads(r.read())
            self._token, self._expires = d["access_token"], time.time() + int(d.get("expires_in", 3600))
            return self._token

    def call(self, method: str, url: str, data: bytes | None = None, headers: dict | None = None, raw: bool = False, auth: bool = True):
        h = dict(headers or {})
        if auth:
            h["Authorization"] = f"Bearer {self.token()}"
        full = url if url.startswith("http") else self.BASE + url
        for attempt in range(4):
            req = urllib.request.Request(full, data=data, method=method, headers=h)
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    body = r.read()
                    return body if raw else (json.loads(body) if body else {})
            except urllib.error.HTTPError as e:
                if e.code in (429, 503, 504) and attempt < 3:  # throttled or busy: wait as told, then retry
                    time.sleep(min(30, int(e.headers.get("Retry-After", 2 ** attempt))))
                    continue
                raise

    @staticmethod
    def quote_path(path: str) -> str:
        return urllib.parse.quote(path.strip("/"), safe="/")


class SharePointStore(LocalStore):
    remote = True

    def __init__(self) -> None:
        self.g = Graph(os.environ["KL_SP_TENANT"], os.environ["KL_SP_CLIENT_ID"], os.environ["KL_SP_CLIENT_SECRET"])
        self.site_url = os.environ["KL_SP_SITE"].rstrip("/")
        self.folder = os.environ.get("KL_SP_FOLDER", "Records").strip("/")
        self.backup_library = os.environ.get("KL_SP_BACKUP_LIBRARY", "Backups")
        self._site_id = ""
        self._drives: dict[str, str] = {}
        self._remote_seen: set[str] = set()

    # -------- where things are
    def site_id(self) -> str:
        if not self._site_id:
            u = urllib.parse.urlparse(self.site_url)
            self._site_id = self.g.call("GET", f"/sites/{u.hostname}:{u.path}")["id"]
        return self._site_id

    def drive_id(self, library: str | None = None) -> str:
        """The document library's drive: the default library ("Documents") or one by name (e.g. "Backups")."""
        key = library or ""
        if key not in self._drives:
            if not library:
                self._drives[key] = self.g.call("GET", f"/sites/{self.site_id()}/drive")["id"]
            else:
                drives = self.g.call("GET", f"/sites/{self.site_id()}/drives")["value"]
                match = next((d for d in drives if d.get("name") == library), None)
                if not match:
                    raise RuntimeError(f"SharePoint library '{library}' not found on {self.site_url}")
                self._drives[key] = match["id"]
        return self._drives[key]

    def _remote_path(self, rel: str) -> str:
        return f"{self.folder}/{rel}" if self.folder else rel

    # -------- pending uploads live in the database (replicated), not on the temporary disk
    @staticmethod
    def _db() -> sqlite3.Connection:
        con = sqlite3.connect(DB_PATH, timeout=30)
        con.execute("CREATE TABLE IF NOT EXISTS sp_pending (rel TEXT PRIMARY KEY, data BLOB NOT NULL, tries INTEGER DEFAULT 0, last_error TEXT DEFAULT '', created_at TEXT NOT NULL)")
        return con

    def _taken(self, rel: str) -> bool:
        with self._db() as con:
            if con.execute("SELECT 1 FROM sp_pending WHERE rel = ?", (rel,)).fetchone():
                return True
        try:
            return self._remote_exists(rel)
        except Exception:  # noqa: BLE001 - SharePoint unreachable: names carry a timestamp, so a clash is unlikely
            return False

    def _remote_exists(self, rel: str) -> bool:
        if rel in self._remote_seen:
            return True
        try:
            self.g.call("GET", f"/drives/{self.drive_id()}/root:/{Graph.quote_path(self._remote_path(rel))}")
            self._remote_seen.add(rel)
            return True
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return False
            raise

    def _upload(self, drive: str, path: str, data: bytes) -> None:
        q = Graph.quote_path(path)
        if len(data) <= 4 * 1024 * 1024:
            self.g.call("PUT", f"/drives/{drive}/root:/{q}:/content?@microsoft.graph.conflictBehavior=replace", data=data,
                        headers={"Content-Type": "application/octet-stream"})
            return
        sess = self.g.call("POST", f"/drives/{drive}/root:/{q}:/createUploadSession", data=json.dumps({"item": {"@microsoft.graph.conflictBehavior": "replace"}}).encode(),
                           headers={"Content-Type": "application/json"})
        url, chunk, total = sess["uploadUrl"], 5 * 320 * 1024, len(data)
        for start in range(0, total, chunk):
            part = data[start:start + chunk]
            self.g.call("PUT", url, data=part, auth=False, headers={"Content-Length": str(len(part)), "Content-Range": f"bytes {start}-{start + len(part) - 1}/{total}"})

    # -------- the store interface
    def put(self, folder: str, name: str, data: bytes) -> tuple[str, str]:
        rel, sha = super().put(folder, name, data)
        try:
            self._upload(self.drive_id(), self._remote_path(rel), data)
            self._remote_seen.add(rel)
        except Exception as e:  # noqa: BLE001 - keep the file safe in the database and retry later
            with self._db() as con:
                con.execute("INSERT OR REPLACE INTO sp_pending (rel, data, tries, last_error, created_at) VALUES (?, ?, 0, ?, ?)",
                            (rel, data, str(e)[:300], datetime.now(UTC).isoformat()))
        return rel, sha

    def get(self, rel: str) -> bytes:
        local = FILES_DIR / rel
        if local.exists():
            return local.read_bytes()
        with self._db() as con:
            row = con.execute("SELECT data FROM sp_pending WHERE rel = ?", (rel,)).fetchone()
        data = row[0] if row else self.g.call("GET", f"/drives/{self.drive_id()}/root:/{Graph.quote_path(self._remote_path(rel))}:/content", raw=True)
        local.parent.mkdir(parents=True, exist_ok=True)
        local.write_bytes(data)  # cache for next time
        return data

    def exists(self, rel: str) -> bool:
        return (FILES_DIR / rel).exists() or self._taken(rel)

    # -------- background work
    def retry_pending(self) -> int:
        with self._db() as con:
            rows = con.execute("SELECT rel, data, tries FROM sp_pending ORDER BY created_at LIMIT 50").fetchall()
        sent = 0
        for rel, data, tries in rows:
            try:
                self._upload(self.drive_id(), self._remote_path(rel), data)
                with self._db() as con:
                    con.execute("DELETE FROM sp_pending WHERE rel = ?", (rel,))
                sent += 1
            except Exception as e:  # noqa: BLE001
                with self._db() as con:
                    con.execute("UPDATE sp_pending SET tries = ?, last_error = ? WHERE rel = ?", (tries + 1, str(e)[:300], rel))
        return sent

    def pending_count(self) -> int:
        with self._db() as con:
            return con.execute("SELECT COUNT(*) FROM sp_pending").fetchone()[0]

    def backup_database(self, keep: int = 30) -> str:
        """A consistent copy of the database, compressed, into the Backups library; older copies beyond `keep` deleted."""
        tmp = DATA_DIR / "backup.sqlite"
        src = sqlite3.connect(DB_PATH)
        dst = sqlite3.connect(tmp)
        try:
            src.backup(dst)
        finally:
            dst.close()
            src.close()
        data = gzip.compress(tmp.read_bytes())
        tmp.unlink(missing_ok=True)
        name = f"kshetralekha-{datetime.now(UTC):%Y-%m-%d-%H%M}.sqlite.gz"
        drive = self.drive_id(self.backup_library)
        self._upload(drive, f"Database/{name}", data)
        items = self.g.call("GET", f"/drives/{drive}/root:/Database:/children?$select=id,name&$top=999").get("value", [])
        old = sorted((i for i in items if i["name"].startswith("kshetralekha-")), key=lambda i: i["name"], reverse=True)[keep:]
        for i in old:
            self.g.call("DELETE", f"/drives/{drive}/items/{i['id']}")
        return name


def make_store() -> LocalStore:
    if os.environ.get("KL_STORAGE", "local") == "sharepoint":
        return SharePointStore()
    return LocalStore()


store = make_store()
