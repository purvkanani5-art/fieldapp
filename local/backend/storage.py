"""Where files go. The prototype writes to data/files/<folder tree>; the live app writes the same tree into a
SharePoint document library through Microsoft Graph (see SharePointStore, a stub with the exact calls to make).

Every stored file gets a SHA-256 so a photo or PDF can be proven unchanged later (carbon-credit audits).
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

from db import DATA_DIR

FILES_DIR = DATA_DIR / "files"
FILES_DIR.mkdir(parents=True, exist_ok=True)


def safe_name(name: str) -> str:
    name = re.sub(r"[^\w.\- ()]+", "_", name, flags=re.UNICODE).strip() or "file"
    return name[:120]


class LocalStore:
    """Files under data/files, mirrored one-to-one to the SharePoint folder layout."""

    def put(self, folder: str, name: str, data: bytes) -> tuple[str, str]:
        rel = Path(*[safe_name(p) for p in folder.split("/") if p]) / safe_name(name)
        full = FILES_DIR / rel
        full.parent.mkdir(parents=True, exist_ok=True)
        # never overwrite: evidence files are immutable
        if full.exists():
            stem, suffix = full.stem, full.suffix
            n = 2
            while (full.parent / f"{stem} ({n}){suffix}").exists():
                n += 1
            full = full.parent / f"{stem} ({n}){suffix}"
            rel = full.relative_to(FILES_DIR)
        full.write_bytes(data)
        return str(rel).replace("\\", "/"), hashlib.sha256(data).hexdigest()

    def get(self, rel: str) -> bytes:
        return (FILES_DIR / rel).read_bytes()

    def exists(self, rel: str) -> bool:
        return (FILES_DIR / rel).exists()


class SharePointStore(LocalStore):
    """Live version (not active in the prototype).

    Setup: an Entra app registration with application permission `Sites.Selected`, granted on one SharePoint
    site, and a document library "Kshetralekha". Then each put() is:
        PUT https://graph.microsoft.com/v1.0/sites/{site-id}/drive/root:/{folder}/{name}:/content   (< 250 MB)
    and the returned driveItem id is stored in files.remote_id. Downloads use
        GET  https://graph.microsoft.com/v1.0/sites/{site-id}/drive/items/{remote_id}/content
    The local copy is kept as a cache so the app keeps working when Graph is slow or offline.
    """


store = LocalStore()
