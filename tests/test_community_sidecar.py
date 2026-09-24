"""Arynwood Community sidecar: find it, report it, start/stop a local copy that outlives
Arynwood, and never touch a hosted one. Uses a real child process (a fake Community folder
whose start.sh execs a tiny health server), not mocks, because the lifecycle is the point."""
import os
import signal
import socket
import sys
import textwrap
import time

import pytest

from backend.routers import community

FAKE_SERVER = textwrap.dedent("""
    import http.server, json, sys
    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            body = json.dumps({"status": "ok", "name": "Arynwood Community", "version": "9.9.9"}).encode()
            self.send_response(200 if self.path == "/api/health" else 404); self.end_headers(); self.wfile.write(body)
        def log_message(self, *a): pass
    http.server.HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
""")


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture()
def fake_community(tmp_path, monkeypatch):
    """A Community folder that's installed and set up, served on a free port."""
    port = _free_port()
    home = tmp_path / "community"
    for marker in community.SETUP_MARKERS:
        (home / marker).parent.mkdir(parents=True, exist_ok=True)
        (home / marker).mkdir() if marker.endswith("node_modules") else (home / marker).write_text("")
    (home / "fake_server.py").write_text(FAKE_SERVER)
    start = home / "start.sh"
    # "backend.api:app" in argv mirrors the real start.sh (uvicorn backend.api:app) — it's what
    # managed_pid() checks before it will signal anything.
    start.write_text(f"#!/bin/sh\nexec {sys.executable} fake_server.py {port} backend.api:app\n")
    start.chmod(0o755)
    monkeypatch.setenv("ARYNWOOD_COMMUNITY_DIR", str(home))
    monkeypatch.setenv("ARYNWOOD_COMMUNITY_URL", f"http://127.0.0.1:{port}")
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "xdg"))
    monkeypatch.setattr(community, "STARTUP_GRACE_SECONDS", 0.5)
    monkeypatch.setattr(community, "_proc", None)
    monkeypatch.setattr(community, "_failure", None)
    yield home
    pid = community.managed_pid()
    if pid:
        os.kill(pid, signal.SIGKILL)


def _wait_running(client, timeout=10):
    deadline = time.time() + timeout
    while time.time() < deadline:
        body = client.get("/api/community/status").json()
        if body["status"] == "running":
            return body
        time.sleep(0.2)
    raise AssertionError(f"never became running: {body}")


def test_start_status_stop_round_trip(client, fake_community):
    before = client.get("/api/community/status").json()
    assert before["status"] == "stopped" and before["can_start"] and not before["can_stop"]

    assert client.post("/api/community/start").json()["status"] == "starting"
    running = _wait_running(client)
    assert running["version"] == "9.9.9" and running["managed"] and running["can_stop"]
    assert not running["can_start"]
    assert client.post("/api/community/start").json() == {"status": "already_running"}

    # Members stay connected when Arynwood quits: the server is in its own session, not ours.
    pid = community.managed_pid()
    assert os.getsid(pid) != os.getsid(0)

    assert client.post("/api/community/stop").json() == {"status": "stopped"}
    after = client.get("/api/community/status").json()
    assert after["status"] == "stopped" and not after["managed"]


def test_stop_after_arynwood_restart_uses_the_pidfile(client, fake_community, monkeypatch):
    client.post("/api/community/start")
    _wait_running(client)
    monkeypatch.setattr(community, "_proc", None)  # a fresh backend has no Popen handle
    assert client.get("/api/community/status").json()["can_stop"]
    assert client.post("/api/community/stop").json() == {"status": "stopped"}
    assert client.get("/api/community/status").json()["status"] == "stopped"


def test_a_stale_pidfile_never_targets_another_process(client, fake_community):
    unrelated = os.getpid()  # alive, but not Community's server in Community's folder
    os.makedirs(os.path.dirname(community._pid_file()), exist_ok=True)
    with open(community._pid_file(), "w") as f:
        f.write(str(unrelated))
    assert community.managed_pid() is None
    assert client.post("/api/community/stop").json() == {"status": "stopped"}  # and we're still alive


def test_one_not_started_here_is_reported_not_killed(client, fake_community):
    import subprocess
    port = community.community_url().rsplit(":", 1)[1]
    proc = subprocess.Popen([sys.executable, str(fake_community / "fake_server.py"), port])
    try:
        body = _wait_running(client)
        assert not body["managed"] and not body["can_stop"]
        r = client.post("/api/community/stop")
        assert r.status_code == 409 and "wasn't started by Arynwood" in r.json()["detail"]
        assert proc.poll() is None
    finally:
        proc.kill()


def test_setup_and_install_problems_are_explained(client, fake_community, monkeypatch, tmp_path):
    (fake_community / "frontend/dist/index.html").unlink()
    body = client.get("/api/community/status").json()
    assert body["setup_missing"] == ["frontend/dist/index.html"] and not body["can_start"]
    r = client.post("/api/community/start")
    assert r.status_code == 409 and "./setup.sh" in r.json()["detail"]

    monkeypatch.setenv("ARYNWOOD_COMMUNITY_DIR", str(tmp_path / "nowhere"))
    assert client.get("/api/community/status").json()["installed"] is False
    assert client.post("/api/community/start").status_code == 404


def test_crash_on_start_is_reported_with_its_reason(client, fake_community):
    (fake_community / "start.sh").write_text("#!/bin/sh\necho 'Run ./setup.sh first.' >&2\nexit 1\n")
    r = client.post("/api/community/start")
    assert r.status_code == 500 and "Run ./setup.sh first." in r.json()["detail"]
    body = client.get("/api/community/status").json()
    assert body["status"] == "failed" and "setup.sh" in body["error"]


def test_hosted_instance_is_status_and_open_only(client, monkeypatch):
    monkeypatch.setenv("ARYNWOOD_COMMUNITY_URL", "https://community.example.invalid")

    async def up(url=None):
        return {"version": "0.3.0"}

    monkeypatch.setattr(community, "health", up)
    body = client.get("/api/community/status").json()
    assert body["mode"] == "remote" and body["status"] == "running" and body["version"] == "0.3.0"
    assert not body["can_start"] and not body["can_stop"] and body["dir"] is None
    assert client.post("/api/community/start").status_code == 400


def test_open_uses_the_system_browser(client, monkeypatch):
    launched = []
    monkeypatch.setenv("ARYNWOOD_COMMUNITY_URL", "http://127.0.0.1:8018")
    monkeypatch.setattr(community.subprocess, "Popen", lambda cmd, **kw: launched.append(cmd))
    assert client.post("/api/community/open").json() == {"url": "http://127.0.0.1:8018"}
    assert launched == [["xdg-open", "http://127.0.0.1:8018"]]


def test_status_never_exposes_the_home_directory(client, monkeypatch):
    home = os.path.expanduser("~")
    monkeypatch.setenv("ARYNWOOD_COMMUNITY_DIR", os.path.join(home, "somewhere", "arynwood-community"))
    monkeypatch.setenv("ARYNWOOD_COMMUNITY_URL", "http://127.0.0.1:1")  # nothing listening
    r = client.get("/api/community/status")
    assert r.json()["dir"] == "~/somewhere/arynwood-community"
    assert home not in r.text
    assert home not in client.post("/api/community/start").json()["detail"]


def test_default_location_is_the_official_repo_checkout_not_the_old_one(monkeypatch):
    import importlib
    from backend import external_paths
    monkeypatch.delenv("ARYNWOOD_COMMUNITY_DIR", raising=False)
    monkeypatch.setenv("ARYNWOOD_PROJECTS_DIR", "/projects")
    reloaded = importlib.reload(external_paths)
    try:
        assert reloaded.COMMUNITY_DIR == "/projects/arynwood-community"
        assert "aryncore" not in reloaded.COMMUNITY_DIR
        assert reloaded.COMMUNITY_REPO_URL.startswith("https://github.com/Arynwood-Technology/")
    finally:
        monkeypatch.undo()
        importlib.reload(external_paths)


def test_open_repo_target_opens_the_source_repo(client, monkeypatch):
    from backend import external_paths
    launched = []
    monkeypatch.setattr(community.subprocess, "Popen", lambda cmd, **kw: launched.append(cmd))
    assert client.post("/api/community/open", params={"target": "repo"}).json() == {"url": external_paths.COMMUNITY_REPO_URL}
    assert launched == [["xdg-open", external_paths.COMMUNITY_REPO_URL]]
    assert client.post("/api/community/open", params={"target": "file:///etc"}).status_code == 400
