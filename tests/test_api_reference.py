"""docs/api/ is generated from the backend (scripts/gen_api_reference.py). These fail when a route
changes without the reference being regenerated, or when a route the backend serves has no section."""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HTTP_DOCS = ROOT / "docs" / "api" / "http"

# Every (method, path) the app answers with the opt-in routers mounted, found without the generator.
PROBE = r"""
import json, re
from backend.api import app
spec = app.openapi()
found = {(m.upper(), p) for p, item in spec["paths"].items() for m in item}
def walk(routes, prefix=""):
    for r in routes:
        if type(r).__name__ == "_IncludedRouter":
            yield from walk(r.original_router.routes, prefix + r.include_context.prefix)
        else:
            yield prefix, r
for prefix, r in walk(app.routes):
    path = re.sub(r"\{(\w+):\w+\}", r"{\1}", prefix + r.path)
    if "WebSocket" in type(r).__name__:
        found.add(("WS", path))
    elif not getattr(r, "include_in_schema", False) or type(r).__name__ == "Route":
        found |= {(m, path) for m in r.methods if not (m == "HEAD" and type(r).__name__ == "Route")}
print(json.dumps(sorted(found)))
"""


def _child_env(tmp_path):
    env = {k: v for k, v in os.environ.items() if not k.startswith("ARYNWOOD_ENABLE_")}
    env.update(ARYNWOOD_ENABLE_CODEBASE_TOOLS="1", ARYNWOOD_ENABLE_GATEWAY="1",
               ARYNWOOD_DB_PATH=str(tmp_path / "probe.db"), ARYNWOOD_DISABLE_BACKGROUND_INDEX="1")
    return env


def test_reference_is_up_to_date():
    import fastapi
    pinned = re.search(r"^fastapi~=([\d.]+)", (ROOT / "requirements.txt").read_text(), re.M).group(1)
    assert fastapi.__version__.startswith(pinned.rsplit(".", 1)[0] + "."), (
        f"FastAPI {fastapi.__version__} is installed but requirements.txt pins {pinned}, and the OpenAPI document "
        "depends on it: pip install -r requirements.txt")
    out = subprocess.run([sys.executable, "scripts/gen_api_reference.py", "--check"], cwd=ROOT,
                         capture_output=True, text=True, timeout=300)
    assert out.returncode == 0, out.stdout[-3000:] + out.stderr[-2000:]


def test_every_route_the_backend_serves_has_a_section(tmp_path):
    out = subprocess.run([sys.executable, "-c", PROBE], cwd=ROOT, env=_child_env(tmp_path),
                         capture_output=True, text=True, timeout=300)
    assert out.returncode == 0, out.stderr[-2000:]
    served = {tuple(x) for x in json.loads(out.stdout.strip().splitlines()[-1])}
    documented = set()
    for page in HTTP_DOCS.glob("*.md"):
        for methods, path in re.findall(r"^### `([A-Z ]+) (\S+)`$", page.read_text(), re.M):
            documented |= {(m, path) for m in methods.split()}
    assert served - documented == set(), "routes with no section"
    assert documented - served == set(), "sections for routes the backend doesn't serve"
    assert len(served) > 200


def test_snapshot_marks_opt_in_routes():
    spec = json.loads((ROOT / "docs" / "api" / "openapi.json").read_text())
    gated = {p for p, item in spec["paths"].items() if any("x-arynwood-mounted-only-with" in op for op in item.values())}
    assert gated and all(p.startswith(("/api/gateway", "/api/mcp-codebase")) for p in gated)
    assert not any(p.startswith(("/api/gateway", "/api/mcp-codebase")) for p in set(spec["paths"]) - gated)
