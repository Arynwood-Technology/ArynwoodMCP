"""Arynwood Community — optional sidecar (launcher + status).

Community is a separate app (its own repo, venv, frontend and SQLite data) that serves a
private space other members connect to. This router only finds it, reports whether it's
running, starts/stops a local copy, and opens it in the system browser. It deliberately
does not embed or read Community: the app forbids framing (X-Frame-Options: DENY) and its
API is cookie-authenticated per member.

Lifecycle differs from the MusicStudio sidecars on purpose: members stay connected when
Arynwood quits, so a Community started here gets its own session (no die_with_parent) and
is tracked by a pidfile, which lets Stop work after an Arynwood restart too.

Configuration: ARYNWOOD_COMMUNITY_DIR (see external_paths) and ARYNWOOD_COMMUNITY_URL.
Paths go to the UI home-relative ("~/…"), never absolute: a screenshot or a shared page
must not carry the user's home directory. The official source repo URL is
external_paths.COMMUNITY_REPO_URL — TODO(community-repo): still a placeholder.
A non-local URL (e.g. https://community.arynwood.com) means a hosted instance: status and
Open only — nothing is started or stopped on this machine.
"""
import asyncio
import os
import signal
import subprocess
import time
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException

from backend import external_paths
from backend._frozen import sanitize_environ_for_children, xdg_data_dir

router = APIRouter()

LABEL = "Arynwood Community"
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}
STARTUP_GRACE_SECONDS = 1.5
# Mirrors the checks in Community's own start.sh — report them instead of letting it exit.
SETUP_MARKERS = (".venv/bin/python", "frontend/dist/index.html", "nkn/node_modules")

_proc: subprocess.Popen | None = None
_failure: str | None = None


def community_dir() -> str:
    return os.environ.get("ARYNWOOD_COMMUNITY_DIR") or external_paths.COMMUNITY_DIR


def display_path(path: str) -> str:
    """Home-relative form for anything shown to the user (no absolute home directory)."""
    home = os.path.expanduser("~")
    return "~" + path[len(home):] if path == home or path.startswith(home + os.sep) else path


def community_url() -> str:
    return (os.environ.get("ARYNWOOD_COMMUNITY_URL") or "http://127.0.0.1:8018").rstrip("/")


def is_local(url: str) -> bool:
    return (urlparse(url).hostname or "") in LOCAL_HOSTS


def _pid_file() -> str:
    return os.path.join(xdg_data_dir(), "community.pid")


def _log_path() -> str:
    return os.path.join(xdg_data_dir(), "logs", "sidecar-community.log")


def _log_tail(lines: int = 6) -> str:
    try:
        with open(_log_path(), "rb") as f:
            f.seek(0, os.SEEK_END)
            f.seek(max(0, f.tell() - 4000))
            text = f.read().decode("utf-8", "replace")
    except OSError:
        return ""
    return "\n".join([ln.rstrip() for ln in text.splitlines() if ln.strip()][-lines:])


def setup_missing(directory: str) -> list[str]:
    return [m for m in SETUP_MARKERS if not os.path.exists(os.path.join(directory, m))]


def managed_pid() -> int | None:
    """PID of a Community this app started — only if that process is still Community's
    server running from the Community folder, so a stale pidfile never points Stop at an
    unrelated process that reused the number."""
    try:
        with open(_pid_file()) as f:
            pid = int(f.read().strip())
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            cmdline = f.read().replace(b"\0", b" ").decode("utf-8", "replace")
        cwd = os.path.realpath(os.readlink(f"/proc/{pid}/cwd"))
    except (OSError, ValueError):
        return None
    if "backend.api:app" in cmdline and cwd == os.path.realpath(community_dir()):
        return pid
    return None


async def health(url: str | None = None) -> dict | None:
    """{"version": ...} when Community answers at url, else None."""
    url = url or community_url()
    try:
        async with httpx.AsyncClient(timeout=2.0 if is_local(url) else 6.0, follow_redirects=True) as client:
            r = await client.get(f"{url}/api/health")
    except httpx.HTTPError:
        return None
    if r.status_code == 400 and "host" in r.text.lower():
        # Up, but configured for a public hostname (COMMUNITY_HOSTS) so it rejects a bare
        # 127.0.0.1 request — still running, just can't report its version this way.
        return {"version": None}
    try:
        body = r.json()
    except ValueError:
        return None
    if r.status_code == 200 and body.get("name") == LABEL:
        return {"version": body.get("version")}
    return None


@router.get("/status")
async def status():
    url = community_url()
    local = is_local(url)
    directory = community_dir()
    installed = os.path.isfile(os.path.join(directory, "start.sh"))
    missing = setup_missing(directory) if installed else []
    info = await health(url)
    pid = managed_pid() if local else None

    if info:
        state = "running"
    elif not local:
        state = "unreachable"
    elif _proc is not None and _proc.poll() is None:
        state = "starting"
    elif _failure:
        state = "failed"
    else:
        state = "stopped"

    return {
        "label": LABEL,
        "mode": "local" if local else "remote",
        "url": url,
        "status": state,
        "version": info.get("version") if info else None,
        "dir": display_path(directory) if local else None,
        "repo_url": external_paths.COMMUNITY_REPO_URL,
        "installed": installed if local else None,
        "setup_missing": missing,
        "managed": pid is not None,
        "can_start": local and installed and not missing and state in ("stopped", "failed"),
        "can_stop": pid is not None,
        "error": _failure if state == "failed" else None,
    }


@router.post("/start")
async def start():
    global _proc, _failure
    url = community_url()
    if not is_local(url):
        raise HTTPException(400, f"Community is hosted at {url}; it isn't started from this computer.")
    directory = community_dir()
    if not os.path.isfile(os.path.join(directory, "start.sh")):
        raise HTTPException(404, f"Arynwood Community isn't installed at {display_path(directory)}. "
                                 "Set ARYNWOOD_COMMUNITY_DIR to its folder.")
    missing = setup_missing(directory)
    if missing:
        raise HTTPException(409, f"Community isn't set up yet (missing {', '.join(missing)}). "
                                 f"Run ./setup.sh in {display_path(directory)}.")
    if await health(url):
        return {"status": "already_running"}

    env = os.environ.copy()
    sanitize_environ_for_children(env)  # a packaged backend's PYTHONHOME etc. would kill Community's Python
    _failure = None
    os.makedirs(os.path.dirname(_log_path()), exist_ok=True)
    with open(_log_path(), "ab") as log:
        log.write(f"\n--- start {time.strftime('%Y-%m-%d %H:%M:%S')} ---\n".encode())
        log.flush()
        _proc = subprocess.Popen(
            [os.path.join(directory, "start.sh")], cwd=directory, env=env,
            stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
            start_new_session=True,  # keeps serving members after Arynwood quits (no die_with_parent)
        )
    with open(_pid_file(), "w") as f:
        f.write(str(_proc.pid))  # start.sh execs uvicorn, so this is the server's own pid

    await asyncio.sleep(STARTUP_GRACE_SECONDS)
    code = _proc.poll()
    if code is not None:
        _failure = _log_tail() or f"exited with code {code}"
        raise HTTPException(500, f"{LABEL} exited immediately (code {code}). {_failure}".strip())
    return {"status": "starting", "pid": _proc.pid}


@router.post("/stop")
async def stop():
    global _proc, _failure
    _failure = None
    pid = managed_pid()
    if pid is None:
        if is_local(community_url()) and await health():
            raise HTTPException(409, f"{LABEL} is running but wasn't started by Arynwood MCP, so it "
                                     "isn't stopped from here. Stop it where it was started.")
        return {"status": "stopped"}
    os.kill(pid, signal.SIGTERM)
    for _ in range(50):
        await asyncio.sleep(0.1)
        if _proc is not None and _proc.pid == pid:
            _proc.poll()  # reap our own child so it doesn't linger as a zombie
        if managed_pid() is None:
            break
    else:
        os.kill(pid, signal.SIGKILL)
    try:
        os.remove(_pid_file())
    except OSError:
        pass
    _proc = None
    return {"status": "stopped"}


@router.post("/open")
async def open_in_browser(target: str = "app"):
    """Open Community (target=app) or its source repo (target=repo) in the system browser —
    the desktop app's web view can't open external windows, and Community refuses framing."""
    if target not in ("app", "repo"):
        raise HTTPException(400, "target must be 'app' or 'repo'")
    url = community_url() if target == "app" else external_paths.COMMUNITY_REPO_URL
    env = os.environ.copy()
    sanitize_environ_for_children(env)
    try:
        subprocess.Popen(["xdg-open", url], env=env, stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    except OSError as e:
        raise HTTPException(501, f"Couldn't open a browser ({e}). Open {url} yourself.")
    return {"url": url}
