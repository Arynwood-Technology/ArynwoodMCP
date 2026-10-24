"""The packaged app's Content-Security-Policy (tauri.conf.json, app.security.csp).

Narrowed 2026-10-24 after the security pass (finding 4): scripts only from the app itself (no
'unsafe-eval', no 'unsafe-inline', no http://localhost:* scripts), connections to the backend, IPC and
GitHub's API instead of any https: host, and no plugins, <base> or outside form targets. The production
build was loaded under this policy in Chrome, every page, with no violation. `tauri dev` keeps the old
broad policy as devCsp, since Vite's dev server needs inline scripts and eval."""
import json
from pathlib import Path

CONF = json.loads((Path(__file__).resolve().parents[1] / "frontend/src-tauri/tauri.conf.json").read_text())["app"]["security"]


def directives(policy):
    return {d.split()[0]: d.split()[1:] for d in (p.strip() for p in policy.split(";")) if d}


def test_scripts_come_only_from_the_app():
    assert directives(CONF["csp"])["script-src"] == ["'self'"]


def test_what_the_packaged_app_is_known_to_need_is_still_allowed():
    csp = directives(CONF["csp"])
    assert {"ipc://localhost", "http://localhost:*", "ws://localhost:*", "https://api.github.com"} <= set(csp["connect-src"])
    assert "blob:" in csp["media-src"]                       # previews of picked files and recordings
    assert "http://localhost:*" in csp["style-src"] and "http://localhost:*" in csp["font-src"]   # Grove site-editor previews
    assert "http://localhost:*" in csp["frame-src"]           # html-tools, Grove previews, local tool pages
    assert csp["object-src"] == ["'none'"] and csp["base-uri"] == ["'self'"]


def test_no_wildcard_hosts_for_connections():
    assert "https:" not in directives(CONF["csp"])["connect-src"]
