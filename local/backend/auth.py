"""Sign-in for the prototype: Employee ID + PIN, then a signed token per device.

Office staff will later sign in with Microsoft (Entra ID): the same `users` row gets its `entra_oid` filled and
the token issued here is the same, so nothing else in the app changes. PINs are hashed with PBKDF2 (standard
library only); tokens are HMAC-signed with a secret kept in data/secret.key.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time

from db import DATA_DIR

SECRET_PATH = DATA_DIR / "secret.key"
TOKEN_DAYS = 30
MAX_FAILURES = 5


def _secret() -> bytes:
    if not SECRET_PATH.exists():
        SECRET_PATH.write_bytes(secrets.token_bytes(32))
    return SECRET_PATH.read_bytes()


# The browser build (GitHub Pages demo, data only on that device) sets KL_PBKDF2_ITER lower: there is no OpenSSL
# there and the pure-Python fallback is slow.
PBKDF2_ITER = int(os.environ.get("KL_PBKDF2_ITER", "120000"))


def _pbkdf2_sha256(password: bytes, salt: bytes, rounds: int) -> bytes:
    """RFC 8018 PBKDF2-HMAC-SHA256, one 32-byte block; used only where hashlib.pbkdf2_hmac is missing (Pyodide)."""
    inner, outer = hashlib.sha256(), hashlib.sha256()
    key = password if len(password) <= 64 else hashlib.sha256(password).digest()
    key = key.ljust(64, b"\0")
    inner.update(bytes(k ^ 0x36 for k in key))
    outer.update(bytes(k ^ 0x5C for k in key))

    def prf(msg: bytes) -> bytes:
        i, o = inner.copy(), outer.copy()
        i.update(msg)
        o.update(i.digest())
        return o.digest()

    u = prf(salt + b"\x00\x00\x00\x01")
    acc = int.from_bytes(u, "big")
    for _ in range(rounds - 1):
        u = prf(u)
        acc ^= int.from_bytes(u, "big")
    return acc.to_bytes(32, "big")


def hash_pin(pin: str, salt: str | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_hex(16)
    if hasattr(hashlib, "pbkdf2_hmac"):
        digest = hashlib.pbkdf2_hmac("sha256", pin.encode(), bytes.fromhex(salt), PBKDF2_ITER)
    else:
        digest = _pbkdf2_sha256(pin.encode(), bytes.fromhex(salt), PBKDF2_ITER)
    return digest.hex(), salt


def check_pin(pin: str, pin_hash: str, salt: str) -> bool:
    if not pin_hash or not salt:
        return False
    digest, _ = hash_pin(pin, salt)
    return hmac.compare_digest(digest, pin_hash)


def make_token(user_id: str, device_id: str) -> str:
    payload = {"u": user_id, "d": device_id, "exp": int(time.time()) + TOKEN_DAYS * 86400}
    body = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).rstrip(b"=")
    sig = hmac.new(_secret(), body, hashlib.sha256).digest()
    return f"{body.decode()}.{base64.urlsafe_b64encode(sig).rstrip(b'=').decode()}"


def read_token(token: str) -> dict | None:
    try:
        body, sig = token.split(".", 1)
        want = hmac.new(_secret(), body.encode(), hashlib.sha256).digest()
        got = base64.urlsafe_b64decode(sig + "=" * (-len(sig) % 4))
        if not hmac.compare_digest(want, got):
            return None
        payload = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        if payload.get("exp", 0) < time.time():
            return None
        return payload
    except Exception:  # noqa: BLE001
        return None


# Failed PIN attempts per employee id, in memory (the prototype runs as one process).
_failures: dict[str, list[float]] = {}


def too_many_failures(employee_id: str) -> bool:
    recent = [t for t in _failures.get(employee_id, []) if time.time() - t < 900]
    _failures[employee_id] = recent
    return len(recent) >= MAX_FAILURES


def record_failure(employee_id: str) -> None:
    _failures.setdefault(employee_id, []).append(time.time())


def clear_failures(employee_id: str) -> None:
    _failures.pop(employee_id, None)
