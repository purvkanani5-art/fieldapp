"""One-off: replace emoji icons in the front-end views with line-icon calls (ic('name')). Safe to re-run."""
import io
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "frontend"
NAMES = {
    "📍": "pin", "🛵": "bike", "📦": "box", "🌾": "sprout", "📝": "note", "🔔": "bell", "✅": "check", "📷": "camera", "📄": "doc",
    "🏖️": "sun", "💬": "chat", "🔒": "lock", "📤": "upload", "🚪": "logout", "📊": "chart", "👥": "users", "🗂️": "folder", "⚙️": "cog",
    "⛽": "fuel", "🗺️": "map", "🖼️": "image", "📎": "clip", "👤": "user", "🛡️": "shield", "🧭": "compass", "🔥": "flame", "🌳": "tree",
    "🏢": "building", "✍️": "pen", "⬆": "upload", "🧾": "receipt", "💡": "bulb", "⚠️": "alert", "🏠": "home", "🧰": "work",
}
# Inside lrow({ icon: '📍' ... }) the value becomes the icon name; elsewhere the emoji becomes an inline ${ic('name')}.
for f in ["views-field.js", "views-me.js", "views-staff.js", "app.js"]:
    p = ROOT / f
    s = io.open(p, encoding="utf-8").read()
    before = s
    for emoji, name in NAMES.items():
        s = s.replace(f"icon: '{emoji}'", f"icon: '{name}'")
        s = s.replace(f"'{emoji}'", f"'{name}'")  # other quoted uses (maps, ternaries) become names
        s = s.replace(f"{emoji} ", f"${{ic('{name}')}} ")  # inline before text
        s = s.replace(emoji, f"${{ic('{name}')}}")
    # icon maps that now hold names must be rendered through ic(): { admin: 'shield', ... }[u.role] || 'user'
    s = s.replace("icon: { admin: 'shield', manager: 'compass', hr: 'folder', field: 'sprout' }[u.role] || 'user'", "icon: { admin: 'shield', manager: 'compass', hr: 'folder', field: 'sprout' }[u.role] || 'user'")
    s = s.replace("PROJECT_ICON[s.project_type] || 'pin'", "PROJECT_ICON[s.project_type] || 'pin'")
    if s != before:
        io.open(p, "w", encoding="utf-8").write(s)
        print("updated", f)
    left = set(re.findall(r"[\U0001F300-\U0001FAFF☀-➿]", s))
    if left:
        print("  still has:", f, left)
