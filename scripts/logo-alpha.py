"""Make the white background of frontend/logo.png transparent (run once after replacing the logo)."""
from pathlib import Path

from PIL import Image

p = Path(__file__).resolve().parent.parent / "frontend" / "logo.png"
im = Image.open(p).convert("RGBA")
px = im.load()
w, h = im.size
for y in range(h):
    for x in range(w):
        r, g, b, a = px[x, y]
        if r > 238 and g > 238 and b > 238:
            px[x, y] = (255, 255, 255, 0)
        elif r > 215 and g > 215 and b > 215:
            # soften the edge: partially transparent light pixels
            px[x, y] = (r, g, b, int(255 * (255 - min(r, g, b)) / 40))
im.save(p)
print("logo.png now has a transparent background", im.size)
