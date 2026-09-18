#!/usr/bin/env python3
"""Smoke-test a PyInstaller-built backend the way the desktop app runs it.

    python3 scripts/smoke_packaged_backend.py dist/arynwood-backend

Every bug this has found was invisible in a source checkout and in unit tests, because they only exist in
a frozen binary launched with an AppImage's environment:

  * the sidecars never started (the bundle's PYTHONHOME killed every child Python)
  * "Restart API" claimed success and did nothing
  * generated files were written into a temp extraction dir and lost on quit
  * quitting the app left the backend (and its sidecars) running, squatting :8010 and GPU memory

It is hermetic: an isolated port and XDG data dir (your real DB, personas and logs are never touched), and a
fake sidecar, so no MusicStudio checkout or GPU is needed. Exit code 0 = all checks passed.
"""
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

PORT = int(os.environ.get("SMOKE_PORT", "18011"))
SIDECAR_ID, SIDECAR_PORT = "voice", 8001          # from backend/routers/studio.py SIDECARS
failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{('  — ' + detail) if detail and not ok else ''}")
    if not ok:
        failures.append(name)
    return ok


def api(path: str, method: str = "GET", timeout: float = 10.0):
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}{path}", method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"null")
        except ValueError:
            return e.code, None


def listener_pid(port: int) -> int | None:
    out = subprocess.run(["ss", "-ltnp"], capture_output=True, text=True).stdout
    for line in out.splitlines():
        if f":{port} " in line:
            m = re.search(r"pid=(\d+)", line)
            return int(m.group(1)) if m else None
    return None


def alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        with open(f"/proc/{pid}/stat") as f:
            return f.read().rsplit(")", 1)[1].split()[0] != "Z"
    except (ProcessLookupError, FileNotFoundError):
        return False


def wait_until(predicate, seconds: float, step: float = 0.25) -> bool:
    deadline = time.time() + seconds
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(step)
    return False


HEALTH_SERVER = (
    "import http.server, json, os\n"
    "class H(http.server.BaseHTTPRequestHandler):\n"
    "    def do_GET(self):\n"
    "        self.send_response(200); self.end_headers(); self.wfile.write(json.dumps({'status': 'ok'}).encode())\n"
    "    def log_message(self, *a): pass\n"
    "http.server.HTTPServer(('127.0.0.1', int(os.environ['PORT'])), H).serve_forever()\n"
)


def main(binary: str) -> int:
    if not sys.platform.startswith("linux"):
        print("Linux only")
        return 2
    if not os.access(binary, os.X_OK):
        print(f"not an executable: {binary}")
        return 2
    if listener_pid(PORT) or listener_pid(SIDECAR_PORT):
        print(f"port {PORT} or {SIDECAR_PORT} is already in use — set SMOKE_PORT or stop what is using it")
        return 2

    work = tempfile.mkdtemp(prefix="arynwood-smoke-")
    xdg, studio = os.path.join(work, "xdg"), os.path.join(work, "MusicStudio")
    fake = os.path.join(studio, "sidecars", SIDECAR_ID)
    os.makedirs(os.path.join(fake, "venv", "bin"))
    os.symlink(sys.executable, os.path.join(fake, "venv", "bin", "python"))   # a sidecar's OWN interpreter
    with open(os.path.join(fake, "main.py"), "w") as f:
        f.write(HEALTH_SERVER)
    overlay = os.path.join(work, "personas.local.json")
    with open(overlay, "w") as f:
        json.dump({"smoke_persona": {"name": "Smoke", "role": "t", "llm": {"model": "x:1b"}, "system": "s"}}, f)

    # The AppImage's poison: an incomplete stdlib as PYTHONHOME kills any *other* Python at interpreter start.
    appdir = os.path.join(work, "mount")
    os.makedirs(os.path.join(appdir, "usr", "lib", "python3.11"))
    env = {**os.environ, "APPDIR": appdir, "PYTHONHOME": f"{appdir}/usr/", "PYTHONPATH": f"{appdir}/usr/share/pyshared/:",
           "LD_LIBRARY_PATH": f"{appdir}/usr/lib/", "XDG_DATA_HOME": xdg, "ARYNWOOD_BACKEND_PORT": str(PORT),
           "ARYNWOOD_MUSICSTUDIO_DIR": studio, "ARYNWOOD_PERSONAS_FILE": overlay}
    log = open(os.path.join(work, "backend.log"), "w")
    boot = subprocess.Popen([binary], env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    backend = sidecar = None
    try:
        print(f"packaged backend: {binary}\n  isolated port {PORT}, data dir {xdg}")
        def ready() -> bool:
            try:
                return api("/api/system/status", timeout=2)[0] == 200
            except Exception:            # not listening yet
                return False
        up = wait_until(ready, 90)
        if not check("starts and answers /api/system/status", up, open(log.name).read()[-600:]):
            return 1
        backend = listener_pid(PORT)

        st, body = api("/api/system/status")
        check("reports it cannot restart itself", body.get("can_restart") is False)
        check("POST /restart is refused (501), not a fake success", api("/api/system/restart", "POST")[0] == 501)

        ids = [p["id"] for p in (api("/api/chat/personas")[1] or [])]
        check("user persona overlay is loaded", "smoke_persona" in ids, f"personas: {ids}")

        st, body = api(f"/api/studio/sidecars/{SIDECAR_ID}/start", "POST", timeout=30)
        check("a sidecar starts under the AppImage environment", st == 200, f"{st} {body}")
        running = wait_until(lambda: api("/api/studio/sidecars")[1][SIDECAR_ID]["status"] == "running", 20)
        check("...and reaches 'running'", running, str(api("/api/studio/sidecars")[1][SIDECAR_ID]))
        sidecar = listener_pid(SIDECAR_PORT)
        if sidecar:
            child_env = dict(x.split(b"=", 1) for x in open(f"/proc/{sidecar}/environ", "rb").read().split(b"\0") if b"=" in x)
            check("the sidecar did not inherit the bundle's PYTHONHOME/PYTHONPATH",
                  b"PYTHONHOME" not in child_env and b"PYTHONPATH" not in child_env)

        data = os.path.join(xdg, "arynwood-mcp")
        check("state goes to the user data dir (db + sidecar log)",
              os.path.isfile(os.path.join(data, "arynwood.db")) and os.path.isfile(os.path.join(data, "logs", f"sidecar-{SIDECAR_ID}.log")))

        print("  ...hard-killing the launcher, as the desktop shell does on quit")
        os.kill(boot.pid, signal.SIGKILL)
        boot.wait()
        gone = wait_until(lambda: not (backend and alive(backend)) and not (sidecar and alive(sidecar)), 8)
        check("backend and sidecar both die with it (no orphans)", gone,
              f"backend alive={bool(backend and alive(backend))} sidecar alive={bool(sidecar and alive(sidecar))}")
        check("its ports are released", listener_pid(PORT) is None and listener_pid(SIDECAR_PORT) is None)
    finally:
        for pid in (boot.pid, backend, sidecar):
            if pid and alive(pid):
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        shutil.rmtree(work, ignore_errors=True)

    print(f"\n{'ALL CHECKS PASSED' if not failures else 'FAILED: ' + ', '.join(failures)}")
    return 1 if failures else 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
