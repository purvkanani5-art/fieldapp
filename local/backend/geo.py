"""Distances and KML plot areas, standard library only."""

from __future__ import annotations

import math
import re
import xml.etree.ElementTree as ET

EARTH_M = 6_371_008.8


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_M * math.asin(math.sqrt(a))


def within_fence(lat: float, lng: float, accuracy: float | None, site: dict) -> tuple[bool, float]:
    """Inside when the fix is within the radius, with up to 50 m of GPS accuracy allowed on top."""
    dist = haversine_m(lat, lng, site["lat"], site["lng"])
    slack = min(float(accuracy or 0), 50.0)
    return dist <= float(site["radius_m"]) + slack, dist


def _polygon_area_m2(coords: list[tuple[float, float]]) -> float:
    """Shoelace on an equirectangular projection around the polygon centre (fine for field plots)."""
    if len(coords) < 3:
        return 0.0
    lat0 = sum(c[1] for c in coords) / len(coords)
    lng0 = sum(c[0] for c in coords) / len(coords)
    k = math.cos(math.radians(lat0))
    pts = [((c[0] - lng0) * k * math.pi / 180 * EARTH_M, (c[1] - lat0) * math.pi / 180 * EARTH_M) for c in coords]
    area = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        area += x1 * y2 - x2 * y1
    return abs(area) / 2


def kml_summary(data: bytes) -> dict:
    """Polygons in a KML file: count, total hectares and the centroid of the first one."""
    text = data.decode("utf-8", errors="replace")
    text = re.sub(r'\sxmlns(:\w+)?="[^"]+"', "", text, count=5)  # drop namespaces so tags are plain
    root = ET.fromstring(text)
    polys = []
    for coords_el in root.iter("coordinates"):
        pts = []
        for tok in coords_el.text.split() if coords_el.text else []:
            parts = tok.split(",")
            if len(parts) >= 2:
                try:
                    pts.append((float(parts[0]), float(parts[1])))
                except ValueError:
                    continue
        if len(pts) >= 3 and (pts[0] == pts[-1] or len(pts) >= 4):
            polys.append(pts)
    total = sum(_polygon_area_m2(p) for p in polys)
    centre = None
    if polys:
        p = polys[0]
        centre = {"lat": sum(c[1] for c in p) / len(p), "lng": sum(c[0] for c in p) / len(p)}
    names = [n.text.strip() for n in root.iter("name") if n.text and n.text.strip()]
    return {"polygons": len(polys), "area_ha": round(total / 10_000, 3), "centre": centre, "names": names[:5]}
