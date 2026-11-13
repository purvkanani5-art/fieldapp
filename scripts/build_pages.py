"""Build the GitHub Pages site: the front end plus the backend's Python files, which run in the browser under
Pyodide (frontend/local/pyworker.js) because Pages has no server.

    python scripts/build_pages.py [out_dir]      (default: site/)
"""

import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "site"
if out.exists():
    shutil.rmtree(out)
shutil.copytree(ROOT / "frontend", out)
backend = out / "local" / "backend"
backend.mkdir(parents=True)
names = sorted(p.name for p in (ROOT / "backend").glob("*.py"))
for n in names:
    shutil.copy2(ROOT / "backend" / n, backend / n)
wheels = sorted(p.name for p in (out / "local" / "wheels").glob("*.whl"))
(out / "local" / "manifest.json").write_text(json.dumps({"backend": names, "wheels": wheels}, indent=1), encoding="utf-8")
(out / ".nojekyll").write_text("", encoding="utf-8")
print(f"built {out}: {len(names)} backend files, {len(wheels)} wheels")
