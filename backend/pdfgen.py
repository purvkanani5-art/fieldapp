"""Signed farmer documents as PDF (reportlab). The template body has {{field}} placeholders; the company's
authorised signature is already on the letterhead; the farmer signs on the phone and the PNG is placed in the box.
The footer carries the document number, who recorded it, GPS, time and the SHA-256 of the signature image."""

from __future__ import annotations

import io
import re
from datetime import datetime

from PIL import Image
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas


def _mark(c, m: float, h: float) -> None:
    """The Kshetralekha circle mark at the left of the green letterhead band."""
    from reportlab.lib.utils import ImageReader

    import brand_mark
    c.drawImage(ImageReader(io.BytesIO(brand_mark.PNG)), m - 1 * mm, h - 20 * mm, 18 * mm, 18 * mm, mask="auto")


def _wrap(c, text: str, x: float, y: float, width: float, size: float = 10.5, leading: float = 14.5) -> float:
    c.setFont("Helvetica", size)
    for para in text.split("\n"):
        words = para.split()
        line = ""
        if not words:
            y -= leading * 0.6
            continue
        for w in words:
            trial = f"{line} {w}".strip()
            if c.stringWidth(trial, "Helvetica", size) <= width:
                line = trial
            else:
                c.drawString(x, y, line)
                y -= leading
                line = w
        if line:
            c.drawString(x, y, line)
            y -= leading
        y -= leading * 0.35
    return y


def render_document(*, company: dict, template: dict, fields: dict, farmer: dict, recorded_by: str, doc_no: str,
                    when: datetime, lat: float | None, lng: float | None, signature_png: bytes | None,
                    company_signature_png: bytes | None, signature_sha: str) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    w, h = A4
    m = 18 * mm

    # Letterhead
    c.setFillColorRGB(0.18, 0.48, 0.29)  # Sajeevan leaf green
    c.rect(0, h - 22 * mm, w, 22 * mm, fill=1, stroke=0)
    c.setFillColorRGB(0.41, 0.28, 0.16)  # earth brown rule
    c.rect(0, h - 23.2 * mm, w, 1.2 * mm, fill=1, stroke=0)
    _mark(c, m, h)
    c.setFillColorRGB(1, 1, 1)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(m + 19 * mm, h - 13 * mm, company.get("name", "Company"))
    c.setFont("Helvetica", 9)
    c.drawString(m + 19 * mm, h - 18.5 * mm, company.get("address", ""))
    c.drawRightString(w - m, h - 13 * mm, f"Document no. {doc_no}")
    c.drawRightString(w - m, h - 18.5 * mm, when.strftime("%d %b %Y, %H:%M"))
    c.setFillColorRGB(0, 0, 0)

    y = h - 34 * mm
    c.setFont("Helvetica-Bold", 14)
    c.drawString(m, y, template["name"])
    y -= 9 * mm

    body = template["body"]
    data = {**farmer, **fields}
    body = re.sub(r"{{\s*(\w+)\s*}}", lambda mt: str(data.get(mt.group(1), "____________")), body)
    y = _wrap(c, body, m, y, w - 2 * m)

    # Field table
    y -= 2 * mm
    c.setFont("Helvetica-Bold", 10.5)
    c.drawString(m, y, "Particulars")
    y -= 6 * mm
    c.setFont("Helvetica", 10.5)
    for f in template["fields"]:
        val = str(fields.get(f["key"], "") or "")
        c.setFillColorRGB(0.35, 0.35, 0.35)
        c.drawString(m, y, f["label"])
        c.setFillColorRGB(0, 0, 0)
        c.drawString(m + 60 * mm, y, val)
        c.setStrokeColorRGB(0.85, 0.85, 0.85)
        c.line(m, y - 2 * mm, w - m, y - 2 * mm)
        y -= 7 * mm
        if y < 80 * mm:
            c.showPage()
            y = h - m

    # Signature boxes
    if y < 75 * mm:
        c.showPage()
        y = h - m
    y -= 6 * mm
    box_w, box_h = 70 * mm, 32 * mm
    for label, img, x in (
        ("For " + company.get("name", "Company") + " (authorised signatory)", company_signature_png, m),
        ("Farmer: " + str(farmer.get("name", "")), signature_png, w - m - box_w),
    ):
        c.setStrokeColorRGB(0.6, 0.6, 0.6)
        c.rect(x, y - box_h, box_w, box_h)
        if img:
            try:
                im = Image.open(io.BytesIO(img)).convert("RGBA")
                bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
                bg.alpha_composite(im)
                im = bg.convert("RGB")
                ratio = min((box_w - 6 * mm) / im.width, (box_h - 6 * mm) / im.height)
                iw, ih = im.width * ratio, im.height * ratio
                tmp = io.BytesIO()
                im.save(tmp, "PNG")
                tmp.seek(0)
                from reportlab.lib.utils import ImageReader

                c.drawImage(ImageReader(tmp), x + (box_w - iw) / 2, y - box_h + (box_h - ih) / 2, iw, ih)
            except Exception:  # noqa: BLE001
                pass
        c.setFont("Helvetica", 8.5)
        c.setFillColorRGB(0.3, 0.3, 0.3)
        c.drawString(x, y - box_h - 4 * mm, label[:60])
        c.setFillColorRGB(0, 0, 0)

    # Footer / evidence line
    c.setFont("Helvetica", 7.5)
    c.setFillColorRGB(0.35, 0.35, 0.35)
    where = f"GPS {lat:.5f}, {lng:.5f}" if lat is not None and lng is not None else "GPS not available"
    c.drawString(m, 14 * mm, f"Recorded by {recorded_by} · {when.strftime('%d %b %Y %H:%M')} · {where}")
    c.drawString(m, 10 * mm, f"Signature SHA-256 {signature_sha[:32]}… · generated by Kshetralekha; any edit breaks the hash")
    c.showPage()
    c.save()
    return buf.getvalue()



def render_declaration(*, company: dict, person: dict, policies: list[tuple[str, str]], text: str, when: datetime,
                       signature_png: bytes, signature_sha: str) -> bytes:
    """The policy declaration an employee signs before starting: the policies (with versions), the text, their signature."""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    w, h = A4
    m = 18 * mm
    c.setFillColorRGB(0.18, 0.48, 0.29)
    c.rect(0, h - 22 * mm, w, 22 * mm, fill=1, stroke=0)
    _mark(c, m, h)
    c.setFillColorRGB(1, 1, 1)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(m + 19 * mm, h - 13 * mm, company.get("name", "Company"))
    c.setFont("Helvetica", 9)
    c.drawString(m + 19 * mm, h - 18.5 * mm, company.get("address", ""))
    c.drawRightString(w - m, h - 13 * mm, "Policy declaration")
    c.drawRightString(w - m, h - 18.5 * mm, when.strftime("%d %b %Y, %H:%M"))
    c.setFillColorRGB(0, 0, 0)
    y = h - 34 * mm
    c.setFont("Helvetica-Bold", 14)
    c.drawString(m, y, "Declaration: company policies")
    y -= 9 * mm
    c.setFont("Helvetica", 10.5)
    for label, val in (("Name", person.get("name", "")), ("Employee code", person.get("employee_id", "")), ("Designation", person.get("designation") or "")):
        c.setFillColorRGB(0.35, 0.35, 0.35)
        c.drawString(m, y, label)
        c.setFillColorRGB(0, 0, 0)
        c.drawString(m + 40 * mm, y, str(val))
        y -= 6.5 * mm
    y -= 3 * mm
    c.setFont("Helvetica-Bold", 10.5)
    c.drawString(m, y, "Policies read and accepted")
    y -= 6.5 * mm
    c.setFont("Helvetica", 10.5)
    for i, (title, version) in enumerate(policies, 1):
        c.drawString(m, y, f"{i}. {title}{f'  (version {version})' if version else ''}"[:110])
        y -= 6 * mm
        if y < 90 * mm:
            c.showPage()
            y = h - m
    y -= 4 * mm
    y = _wrap(c, text, m, y, w - 2 * m)
    if y < 70 * mm:
        c.showPage()
        y = h - m
    y -= 6 * mm
    box_w, box_h = 80 * mm, 34 * mm
    c.setStrokeColorRGB(0.6, 0.6, 0.6)
    c.rect(m, y - box_h, box_w, box_h)
    try:
        from reportlab.lib.utils import ImageReader

        im = Image.open(io.BytesIO(signature_png)).convert("RGBA")
        bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
        bg.alpha_composite(im)
        im = bg.convert("RGB")
        ratio = min((box_w - 6 * mm) / im.width, (box_h - 6 * mm) / im.height)
        iw, ih = im.width * ratio, im.height * ratio
        tmp = io.BytesIO()
        im.save(tmp, "PNG")
        tmp.seek(0)
        c.drawImage(ImageReader(tmp), m + (box_w - iw) / 2, y - box_h + (box_h - ih) / 2, iw, ih)
    except Exception:  # noqa: BLE001
        pass
    c.setFont("Helvetica", 8.5)
    c.setFillColorRGB(0.3, 0.3, 0.3)
    c.drawString(m, y - box_h - 4 * mm, f"Signed by {person.get('name', '')} on the phone, {when.strftime('%d %b %Y %H:%M')}")
    c.setFont("Helvetica", 7.5)
    c.drawString(m, 10 * mm, f"Signature SHA-256 {signature_sha[:32]}… · generated by Kshetralekha; any edit breaks the hash")
    c.showPage()
    c.save()
    return buf.getvalue()

def placeholder_signature(text: str) -> bytes:
    """A stand-in authorised-signatory stamp until the real scanned signature is uploaded in Admin."""
    from PIL import ImageDraw, ImageFont

    im = Image.new("RGBA", (600, 220), (255, 255, 255, 0))
    d = ImageDraw.Draw(im)
    try:
        font = ImageFont.truetype("arial.ttf", 44)
        small = ImageFont.truetype("arial.ttf", 26)
    except OSError:
        font, small = ImageFont.load_default(size=44), ImageFont.load_default(size=26)
    d.rounded_rectangle((10, 10, 590, 210), radius=18, outline=(30, 90, 60, 255), width=5)
    d.text((40, 55), text, fill=(30, 90, 60, 255), font=font)
    d.text((40, 130), "Authorised Signatory", fill=(30, 90, 60, 255), font=small)
    out = io.BytesIO()
    im.save(out, "PNG")
    return out.getvalue()
