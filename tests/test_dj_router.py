import pytest

from backend.routers import dj


async def _no_flatpak_running():
    return set()


async def _no_binary_running(bin_name: str) -> bool:
    return False


@pytest.fixture(autouse=True)
def isolated_process_state(monkeypatch):
    """Status checks shell out to `flatpak ps` / `pgrep` — stub both so the
    suite doesn't depend on what's actually running on whatever machine it's
    executed on (same reasoning as test_music_router's sidecar stubs)."""
    monkeypatch.setattr(dj, "_flatpak_running_ids", _no_flatpak_running)
    monkeypatch.setattr(dj, "_binary_running", _no_binary_running)


def test_list_tools_covers_every_registered_tool(client):
    r = client.get("/api/dj/tools")
    assert r.status_code == 200
    body = r.json()
    assert {t["id"] for t in body} == set(dj.DJ_TOOLS.keys())
    # Nothing "running" once flatpak/pgrep are stubbed to report nothing live
    assert all(t["status"] in ("stopped", "plugin") for t in body)


def test_plugin_tools_report_plugin_status_and_are_not_launchable(client):
    r = client.get("/api/dj/tools/calf")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "plugin"
    assert body["launchable"] is False


def test_launch_unknown_tool_404s(client):
    r = client.post("/api/dj/tools/not-a-real-tool/launch")
    assert r.status_code == 404


def test_launch_plugin_tool_400s(client):
    r = client.post("/api/dj/tools/lsp/launch")
    assert r.status_code == 400


def test_launch_spawns_process(client, monkeypatch):
    calls = []
    monkeypatch.setattr(dj, "_spawn", lambda cmd: calls.append(cmd) or 12345)
    r = client.post("/api/dj/tools/mixxx/launch")
    assert r.status_code == 200
    assert r.json() == {"launched": True, "tool_id": "mixxx", "pid": 12345}
    assert calls == [["flatpak", "run", "org.mixxx.Mixxx"]]


def test_list_sessions(client):
    r = client.get("/api/dj/sessions")
    assert r.status_code == 200
    ids = {s["id"] for s in r.json()}
    assert ids == set(dj.SESSIONS.keys())


def test_start_session_launches_each_tool(client, monkeypatch):
    calls = []
    monkeypatch.setattr(dj, "_spawn", lambda cmd: calls.append(cmd) or 1)
    r = client.post("/api/dj/sessions/production/start")
    assert r.status_code == 200
    body = r.json()
    assert body["session_id"] == "production"
    assert {res["tool_id"] for res in body["results"]} == {"ardour", "hydrogen"}
    assert all(res["launched"] for res in body["results"])
    assert len(calls) == 2


def test_start_unknown_session_404s(client):
    r = client.post("/api/dj/sessions/not-a-session/start")
    assert r.status_code == 404


def test_no_machine_specific_content_ships():
    """The tool registry is public reference material: no personal paths, no claims about 'this machine',
    no installed-version numbers copied from one computer. (The docs-opening routes that read a folder on
    one machine were removed for the same reason.)"""
    import json
    blob = json.dumps(dj.DJ_TOOLS)
    assert "this machine" not in blob
    assert "Music Album" not in blob
    assert all(info.get("version") is None for info in dj.DJ_TOOLS.values())
    assert not hasattr(dj, "REFERENCE_DOCS")


def test_docs_routes_are_gone(client):
    assert client.get("/api/dj/docs").status_code == 404
    assert client.post("/api/dj/docs/readme/open").status_code == 404
