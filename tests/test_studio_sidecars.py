"""Sidecar start/stop: a failure must be visible (with the reason), not a silent flip back to 'stopped'."""
import sys
import textwrap
import time

import pytest

from backend.routers import studio

HEALTHY = textwrap.dedent("""
    import http.server, json, os
    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200); self.end_headers(); self.wfile.write(json.dumps({"status": "ok"}).encode())
        def log_message(self, *a): pass
    http.server.HTTPServer(("127.0.0.1", int(os.environ["PORT"])), H).serve_forever()
""")
CRASHES = "import sys\nprint('boom: No module named foo', file=sys.stderr)\nsys.exit(3)\n"


@pytest.fixture()
def fake_sidecar(monkeypatch, tmp_path):
    def make(script_body, port=18963):
        script = tmp_path / "main.py"
        script.write_text(script_body)
        monkeypatch.setattr(studio, "SIDECARS", {"fake": {
            "port": port, "script": str(script), "venv": sys.executable, "label": "Fake Sidecar"}})
        # start_sidecar() Popen()s with cwd=MUSICSTUDIO_DIR unconditionally — the real
        # value (~/GitHub/MusicStudio) only exists on a dev machine with that sibling repo
        # checked out, not on a CI runner, so leaving it unpatched raised FileNotFoundError
        # for the subprocess's cwd before it ever got to running our fake script.
        monkeypatch.setattr(studio, "MUSICSTUDIO_DIR", str(tmp_path))
        monkeypatch.setattr(studio, "LOG_DIR", str(tmp_path / "logs"))
        monkeypatch.setattr(studio, "STARTUP_GRACE_SECONDS", 0.8)
        studio._procs.clear()
        studio._failures.clear()
    yield make
    proc = studio._procs.pop("fake", None)
    if proc and proc.poll() is None:
        proc.kill()
    studio._failures.clear()


def test_a_sidecar_that_crashes_on_start_says_why(client, fake_sidecar):
    fake_sidecar(CRASHES)
    r = client.post("/api/studio/sidecars/fake/start")
    assert r.status_code == 500
    assert "boom: No module named foo" in r.json()["detail"] and "code 3" in r.json()["detail"]

    listed = client.get("/api/studio/sidecars").json()["fake"]
    assert listed["status"] == "failed"
    assert "boom: No module named foo" in listed["error"]


def test_a_failure_is_cleared_by_stopping(client, fake_sidecar):
    fake_sidecar(CRASHES)
    client.post("/api/studio/sidecars/fake/start")
    client.post("/api/studio/sidecars/fake/stop")
    assert client.get("/api/studio/sidecars").json()["fake"]["status"] == "stopped"


def test_stderr_is_kept_in_a_log_file(client, fake_sidecar, tmp_path):
    fake_sidecar(CRASHES)
    client.post("/api/studio/sidecars/fake/start")
    assert "boom: No module named foo" in (tmp_path / "logs" / "sidecar-fake.log").read_text()


def test_a_healthy_sidecar_starts_runs_and_stops(client, fake_sidecar):
    fake_sidecar(HEALTHY)
    assert client.post("/api/studio/sidecars/fake/start").json()["status"] == "starting"
    for _ in range(40):
        if client.get("/api/studio/sidecars").json()["fake"]["status"] == "running":
            break
        time.sleep(0.25)
    assert client.get("/api/studio/sidecars").json()["fake"]["status"] == "running"
    assert client.post("/api/studio/sidecars/fake/start").json()["status"] == "already_running"
    client.post("/api/studio/sidecars/fake/stop")
    assert client.get("/api/studio/sidecars").json()["fake"]["status"] == "stopped"


def test_the_sidecar_does_not_inherit_the_apps_bundle_environment(client, fake_sidecar, monkeypatch, tmp_path):
    """The actual field bug: PYTHONHOME pointing into the AppImage made every sidecar die at startup."""
    appdir = tmp_path / "mount"
    (appdir / "usr" / "lib" / "python3.11").mkdir(parents=True)
    monkeypatch.setenv("APPDIR", str(appdir))
    monkeypatch.setenv("PYTHONHOME", f"{appdir}/usr/")
    fake_sidecar(HEALTHY)
    assert client.post("/api/studio/sidecars/fake/start").status_code == 200      # would be 500 (encodings) before


def test_stop_is_honest_about_a_sidecar_this_app_did_not_start(client, fake_sidecar, tmp_path):
    """Started from a terminal (or by a previous session): it answers /health but isn't ours to stop.
    Reporting "stopped" would leave it running and holding GPU memory while the UI said otherwise."""
    import subprocess
    fake_sidecar(HEALTHY)
    outside = subprocess.Popen([sys.executable, str(tmp_path / "main.py")], env={**__import__("os").environ, "PORT": "18963"})
    try:
        for _ in range(40):
            if client.get("/api/studio/sidecars").json()["fake"]["status"] == "running":
                break
            time.sleep(0.25)
        r = client.post("/api/studio/sidecars/fake/stop")
        assert r.status_code == 409
        assert "wasn't started by this app" in r.json()["detail"]
        assert outside.poll() is None                     # and we did not touch it
    finally:
        outside.kill()
