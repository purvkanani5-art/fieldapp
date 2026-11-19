"""Map search for sites (owner 2026-11-20: "google maps like search ... with plus codes", "it opens the coordinates or
location from google maps link", "it gets taluka, district and state from the location link").

Free services for now (the owner moves to Google Maps with the Android app): place search and the area of a point
(village, taluka, district, state) come from OpenStreetMap's Nominatim, asked from the server so its usage policy is
kept (one request a second, a named User-Agent, answers cached). Plus codes and coordinates are worked out on the phone
(geo.js). A short Google Maps link (maps.app.goo.gl/...) is opened here, only on Google's own hosts, to get the full
link the phone then reads; nothing else is fetched."""

import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from fastapi import APIRouter, HTTPException

NOMINATIM = "https://nominatim.openstreetmap.org"
AGENT = "Kshetralekha/0.6 (+https://kshetralekha.sajeevan.co.in; field operations app of Sajeevan Life)"
LINK_HOSTS = {"maps.app.goo.gl", "goo.gl", "g.co", "maps.google.com", "www.google.com", "google.com",
              "maps.google.co.in", "www.google.co.in", "google.co.in", "consent.google.com"}

_lock = threading.Lock()
_last = [0.0]
_cache: dict[str, Any] = {}


def _get(url: str) -> Any:
    if url in _cache:
        return _cache[url]
    with _lock:  # Nominatim allows one request a second
        wait = 1.05 - (time.monotonic() - _last[0])
        if wait > 0:
            time.sleep(wait)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": AGENT, "Accept-Language": "en"})
            with urllib.request.urlopen(req, timeout=12) as r:
                out = json.loads(r.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as e:
            raise HTTPException(503, "Map search is not reachable right now. Try again, or paste coordinates or a plus code.") from e
        finally:
            _last[0] = time.monotonic()
    if len(_cache) > 800:
        _cache.clear()
    _cache[url] = out
    return out


def area_of(address: dict) -> dict:
    """Nominatim's address parts for India -> village / taluka / district / state (taluka is the OSM 'county' or
    'subdistrict'; it is missing in some places and then left empty for the person to type)."""
    a = address or {}
    village = a.get("village") or a.get("hamlet") or a.get("town") or a.get("city") or a.get("suburb") or a.get("neighbourhood") or ""
    locality = next((a[k] for k in ("neighbourhood", "quarter", "suburb", "hamlet", "residential", "isolated_dwelling") if a.get(k) and a.get(k) != village), "")
    return {
        "locality": locality,
        "village": a.get("village") or a.get("hamlet") or a.get("town") or a.get("city") or a.get("suburb") or a.get("neighbourhood") or "",
        "taluka": re.sub(r"\s+(taluka|taluk|tehsil|tahsil)$", "", a.get("county") or a.get("subdistrict") or a.get("municipality") or "", flags=re.I),
        "district": a.get("state_district") or a.get("district") or "",
        "state": a.get("state") or "",
    }


def _place(x: dict) -> dict:
    parts = [p.strip() for p in str(x.get("display_name", "")).split(",")]
    return {"name": x.get("name") or parts[0], "label": ", ".join(parts[:4]), "lat": float(x["lat"]), "lng": float(x["lon"]),
            "area": area_of(x.get("address") or {}), "kind": x.get("addresstype") or x.get("type") or ""}


def make_router(user_dep: Any) -> APIRouter:
    r = APIRouter(prefix="/api/geo")

    @r.get("/search")
    def search(q: str, user: user_dep, near: str = ""):
        q = " ".join(q.split())[:120]
        if len(q) < 2:
            raise HTTPException(422, "Type a place, a plus code or coordinates")
        params = {"q": q, "format": "jsonv2", "addressdetails": 1, "limit": 8, "countrycodes": "in"}
        try:
            lat, lng = (float(v) for v in near.split(","))
            params["viewbox"] = f"{lng - 1.5},{lat + 1.5},{lng + 1.5},{lat - 1.5}"  # prefer places near the map's view, not only inside
        except ValueError:
            pass
        rows = _get(f"{NOMINATIM}/search?{urllib.parse.urlencode(params)}")
        return {"rows": [_place(x) for x in rows if "lat" in x]}

    @r.get("/reverse")
    def reverse(lat: float, lng: float, user: user_dep):
        if not (-90 <= lat <= 90 and -180 <= lng <= 180):
            raise HTTPException(422, "Latitude or longitude is out of range")
        x = _get(f"{NOMINATIM}/reverse?{urllib.parse.urlencode({'lat': round(lat, 6), 'lon': round(lng, 6), 'format': 'jsonv2', 'addressdetails': 1, 'zoom': 16})}")
        if not isinstance(x, dict) or x.get("error"):
            return {"area": {"village": "", "taluka": "", "district": "", "state": ""}, "label": ""}
        return {"area": area_of(x.get("address") or {}), "label": x.get("display_name", "")}

    @r.post("/link")
    def open_link(payload: dict, user: user_dep):
        """Follow a Google Maps link's redirects (only Google's hosts) and give back the full link."""
        url = str(payload.get("url", "")).strip()[:2000]
        for _ in range(6):
            u = urllib.parse.urlsplit(url)
            if u.scheme not in ("http", "https") or (u.hostname or "").lower() not in LINK_HOSTS:
                raise HTTPException(422, "That is not a Google Maps link")
            if (u.hostname or "").lower() == "consent.google.com":  # the cookie page carries the real link
                nxt = urllib.parse.parse_qs(u.query).get("continue", [""])[0]
                if not nxt:
                    break
                url = nxt
                continue
            if u.hostname.lower() not in ("maps.app.goo.gl", "goo.gl", "g.co"):
                return {"url": url}  # already the full link
            req = urllib.request.Request(url, method="GET", headers={"User-Agent": "Mozilla/5.0 (Kshetralekha link reader)"})
            opener = urllib.request.build_opener(_NoRedirect)
            try:
                with opener.open(req, timeout=10) as res:
                    loc = res.headers.get("Location")
                    if not loc:
                        body = res.read(200_000).decode("utf-8", "replace")
                        i = body.find("https://www.google.com/maps")
                        if i < 0:
                            break
                        loc = body[i:body.find('"', i)].replace("\\u003d", "=").replace("\\u0026", "&").replace("&amp;", "&")
            except urllib.error.HTTPError as e:
                loc = e.headers.get("Location") if 300 <= e.code < 400 else None
                if not loc:
                    raise HTTPException(422, "Could not open that link. Open it in Google Maps and copy the full link, or the plus code.") from e
            except (urllib.error.URLError, TimeoutError, OSError) as e:
                raise HTTPException(503, "Could not reach Google to open the link. Try again, or paste the plus code.") from e
            url = urllib.parse.urljoin(url, loc)
        raise HTTPException(422, "Could not read a place from that link. Copy the plus code from Google Maps instead.")

    return r


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # each hop is checked by the caller
        return None
