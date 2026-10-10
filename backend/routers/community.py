"""Arynwood Community (Arynwood Grove) — the Community page's connection to a Grove.

A Grove is a separate service (its own repo, venv, frontend and SQLite data) that keeps the
spaces, calendars, tasks, notes and discussions people share. This router:

* keeps the owner's choice of Grove address (`settings.community_url`; the installer default is
  ARYNWOOD_COMMUNITY_URL, else a Grove on this computer at :8018);
* starts/stops a local copy and opens it in the system browser;
* passes the Community page's requests through to that one Grove (`/grove/...`, plus its live
  notices and the host's IRC/peer-message sockets), so the page works inside the desktop app.

The pass-through holds the Grove sign-in itself (`settings.community_session`). The desktop web
view never sees the Grove's cookie: its page origin (tauri://localhost) is a different site from
any Grove, and the Grove's session cookie is SameSite=Strict, so a cookie in the web view could
never be sent. Only the configured address is ever contacted, only the Grove API areas the
Community page uses are reachable, redirects are not followed, and Arynwood's own credentials
and cookies are never forwarded. Anyone who can use this Arynwood's API can act as the signed-in
Grove account — the same single-owner boundary as the rest of the app (see SECURITY.md).

Lifecycle differs from the MusicStudio sidecars on purpose: members stay connected when
Arynwood quits, so a Grove started here gets its own session (no die_with_parent) and is
tracked by a pidfile, which lets Stop work after an Arynwood restart too.

Configuration: ARYNWOOD_COMMUNITY_DIR (see external_paths) and ARYNWOOD_COMMUNITY_URL.
Paths go to the UI home-relative ("~/…"), never absolute: a screenshot or a shared page
must not carry the user's home directory. The source repo URL is external_paths.COMMUNITY_REPO_URL.
A non-local address (e.g. https://community.arynwood.com) means a hosted Grove: it is used
and opened, but nothing is started or stopped on this machine.
"""
import asyncio
import json
import os
import signal
import subprocess
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from http.cookies import CookieError, SimpleCookie
from urllib.parse import urlparse, urlsplit

import anyio
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel
from websockets.asyncio.client import connect as ws_connect
from websockets.exceptions import WebSocketException

from backend import external_paths
from backend.db import get_db
from backend.external_paths import display_path
from backend._frozen import sanitize_environ_for_children, xdg_data_dir

router = APIRouter()

LABEL = "Arynwood Community"
# Community 0.4 is Arynwood Grove; its health check reports that name.
NAMES = ("Arynwood Grove", LABEL)
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}
DEFAULT_URL = "http://127.0.0.1:8018"
ADDRESS_SETTING = "community_url"
SESSION_SETTING = "community_session"
# The Grove API areas the Community page uses; nothing else on a Grove is reachable from here.
GROVE_AREAS = ("auth", "community", "grove-setup", "mail", "irc", "p2p")
GROVE_SOCKETS = ("irc/ws", "p2p/ws")
FORWARD_REQUEST_HEADERS = ("content-type", "accept", "x-community-request")
FORWARD_RESPONSE_HEADERS = ("content-type", "content-disposition")
MAX_REQUEST_BYTES = 8 * 1024 * 1024    # a 2 MB photo travels as base64 JSON
MAX_RESPONSE_BYTES = 32 * 1024 * 1024  # space exports
MAX_SOCKET_MESSAGE = 8 * 1024 * 1024
USER_AGENT = "Arynwood MCP"
STARTUP_GRACE_SECONDS = 1.5
# Mirrors the checks in Community's own start.sh — report them instead of letting it exit.
SETUP_MARKERS = (".venv/bin/python", "frontend/dist/index.html", "nkn/node_modules")

_proc: subprocess.Popen | None = None
_failure: str | None = None


def community_dir() -> str:
    return os.environ.get("ARYNWOOD_COMMUNITY_DIR") or external_paths.COMMUNITY_DIR


def community_url() -> str:
    """The installer default; the owner's choice on the Community page overrides it (grove_url)."""
    return (os.environ.get("ARYNWOOD_COMMUNITY_URL") or DEFAULT_URL).rstrip("/")


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
    """{"version": ..., "name": ...} when Community (or Grove) answers at url, else None."""
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
    if r.status_code == 200 and body.get("name") in NAMES:
        return {"version": body.get("version"), "name": body["name"]}
    return None


@router.get("/status")
async def status(db=Depends(get_db)):
    url = await grove_url(db)
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
        "label": (info or {}).get("name") or LABEL,
        "mode": "local" if local else "remote",
        "url": url,
        "default_url": community_url(),
        "status": state,
        "version": info.get("version") if info else None,
        "dir": display_path(directory) if local else None,
        "repo_url": external_paths.COMMUNITY_REPO_URL,
        "installed": installed if local else None,
        "setup_missing": missing,
        "managed": pid is not None,
        "can_start": os.name != "nt" and local and installed and not missing and state in ("stopped", "failed"),
        "can_stop": pid is not None,
        "error": _failure if state == "failed" else None,
    }


@router.post("/start")
async def start(db=Depends(get_db)):
    global _proc, _failure
    if os.name == "nt":
        raise HTTPException(501, "Community's local launcher requires Linux. Start your Grove separately and enter its address here.")
    url = await grove_url(db)
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
async def stop(db=Depends(get_db)):
    global _proc, _failure
    _failure = None
    pid = managed_pid()
    if pid is None:
        url = await grove_url(db)
        if is_local(url) and await health(url):
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
async def open_in_browser(target: str = "app", db=Depends(get_db)):
    """Open the Grove (target=app) or its source repo (target=repo) in the system browser —
    the desktop app's web view can't open external windows, and a Grove refuses framing."""
    if target not in ("app", "repo"):
        raise HTTPException(400, "target must be 'app' or 'repo'")
    url = await grove_url(db) if target == "app" else external_paths.COMMUNITY_REPO_URL
    env = os.environ.copy()
    sanitize_environ_for_children(env)
    try:
        if os.name == "nt":
            os.startfile(url)
        else:
            subprocess.Popen(["xdg-open", url], env=env, stdin=subprocess.DEVNULL,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    except OSError as e:
        raise HTTPException(501, f"Couldn't open a browser ({e}). Open {url} yourself.")
    return {"url": url}


# ---------------------------------------------------------------------------
# Which Grove: the owner's address choice and the Grove sign-in this app holds
# ---------------------------------------------------------------------------

async def _setting(db, key: str) -> str | None:
    async with db.execute("SELECT value FROM settings WHERE key=?", (key,)) as cur:
        row = await cur.fetchone()
    return row["value"] if row else None


async def _store(db, key: str, value: str | None) -> None:
    if value is None:
        await db.execute("DELETE FROM settings WHERE key=?", (key,))
    else:
        await db.execute(
            "INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, value))
    await db.commit()


async def grove_url(db) -> str:
    """The Grove the Community page uses: the owner's choice, else the installer default."""
    return await _setting(db, ADDRESS_SETTING) or community_url()


def normalize_address(text: str) -> str:
    """A Grove's origin (scheme://host[:port]) from what the owner typed or pasted, which may
    be a full page or invitation link. ValueError carries a sentence to show them."""
    value = (text or "").strip()
    if not value:
        raise ValueError("Enter the Grove's address, such as https://grove.example.com.")
    if "://" not in value:
        value = "https://" + value
        host = urlsplit(value).hostname or ""
        if host in LOCAL_HOSTS:
            value = "http://" + value[len("https://"):]
    parts = urlsplit(value)
    try:
        port = parts.port
    except ValueError:
        raise ValueError("That address has an invalid port number.") from None
    host = parts.hostname
    if parts.scheme not in ("http", "https") or not host:
        raise ValueError("Enter a web address starting with https://")
    if parts.username is not None or parts.password is not None:
        raise ValueError("Leave the account name and password out of the address.")
    if parts.scheme == "http" and host not in LOCAL_HOSTS:
        raise ValueError("Use an https:// address for a Grove on another computer. Your Grove "
                         "password is sent to it.")
    netloc = f"[{host}]" if ":" in host else host
    return f"{parts.scheme}://{netloc}" + (f":{port}" if port else "")


class AddressBody(BaseModel):
    url: str | None = None


@router.put("/address")
async def set_address(body: AddressBody, db=Depends(get_db)):
    """Choose the Grove (an empty address returns to the default). Changing it forgets the
    sign-in, which belonged to the previous Grove."""
    try:
        chosen = normalize_address(body.url) if (body.url or "").strip() else None
    except ValueError as e:
        raise HTTPException(400, str(e)) from None
    before = await grove_url(db)
    await _store(db, ADDRESS_SETTING, None if chosen == community_url() else chosen)
    if (chosen or community_url()) != before:
        await _store(db, SESSION_SETTING, None)
    return await status(db)


async def _session_cookies(db, url: str) -> dict[str, str]:
    """Cookies the Grove at `url` gave this app; never another Grove's."""
    raw = await _setting(db, SESSION_SETTING)
    try:
        data = json.loads(raw) if raw else {}
    except ValueError:
        return {}
    cookies = data.get("cookies") if isinstance(data, dict) and data.get("url") == url else None
    return {str(k): str(v) for k, v in cookies.items()} if isinstance(cookies, dict) else {}


def _cookie_cleared(morsel) -> bool:
    if not morsel.value:
        return True
    max_age = morsel["max-age"]
    if max_age:
        try:
            return int(max_age) <= 0
        except ValueError:
            pass
    if morsel["expires"]:
        try:
            return parsedate_to_datetime(morsel["expires"]) <= datetime.now(timezone.utc)
        except (TypeError, ValueError):
            pass
    return False


_session_lock = asyncio.Lock()


async def _remember_cookies(db, url: str, set_cookies: list[str]) -> None:
    if not set_cookies:
        return
    async with _session_lock:
        cookies = await _session_cookies(db, url)
        for header in set_cookies:
            jar = SimpleCookie()
            try:
                jar.load(header)
            except CookieError:
                continue
            for name, morsel in jar.items():
                if _cookie_cleared(morsel):
                    cookies.pop(name, None)
                else:
                    cookies[name] = morsel.value
        await _store(db, SESSION_SETTING, json.dumps({"url": url, "cookies": cookies}) if cookies else None)


# ---------------------------------------------------------------------------
# Pass-through: the Community page's requests, its live notices, and host sockets
# ---------------------------------------------------------------------------

def _grove_path(path: str) -> str:
    """`/api/<path>` on the Grove, for the areas the Community page uses only."""
    segments = path.split("/")
    if (not path or any(c in path for c in "\\?#") or any(ord(c) < 32 for c in path)
            or any(seg in ("", ".", "..") for seg in segments) or segments[0] not in GROVE_AREAS):
        raise HTTPException(404, "That isn't part of the Community page.")
    return "/api/" + path


def _host(url: str) -> str:
    return urlsplit(url).netloc


def _client(url: str, timeout: httpx.Timeout) -> httpx.AsyncClient:
    # Environment proxy settings apply to a hosted Grove only; a local one stays on loopback.
    return httpx.AsyncClient(timeout=timeout, follow_redirects=False, trust_env=not is_local(url))


async def _read_body(request: Request) -> bytes:
    length = request.headers.get("content-length", "")
    if length.isdigit() and int(length) > MAX_REQUEST_BYTES:
        raise HTTPException(413, "That's too large to send to the Grove.")
    body = bytearray()
    async for chunk in request.stream():
        body += chunk
        if len(body) > MAX_REQUEST_BYTES:
            raise HTTPException(413, "That's too large to send to the Grove.")
    return bytes(body)


def _unreachable(url: str, error: Exception) -> HTTPException:
    if isinstance(error, httpx.TimeoutException):
        return HTTPException(504, f"The Grove at {_host(url)} didn't answer in time.")
    return HTTPException(502, f"Couldn't reach the Grove at {_host(url)}. Check that it's running, "
                              "or change the Grove address on the Community page.")


def _moved(url: str, response: httpx.Response) -> HTTPException:
    target = response.headers.get("location", "")
    where = f" to {_host(target)}" if _host(target) and _host(target) != _host(url) else ""
    return HTTPException(502, f"The Grove at {_host(url)} sent Arynwood elsewhere{where}. If it moved, "
                              "enter its new address on the Community page.")


@router.api_route("/grove/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def grove_passthrough(path: str, request: Request, db=Depends(get_db)):
    base = await grove_url(db)
    target = httpx.URL(base).copy_with(path=_grove_path(path), query=request.url.query.encode() or None)
    headers = {name: request.headers[name] for name in FORWARD_REQUEST_HEADERS if name in request.headers}
    headers["user-agent"] = USER_AGENT
    cookies = await _session_cookies(db, base)
    if cookies:
        headers["cookie"] = "; ".join(f"{k}={v}" for k, v in cookies.items())
    if request.method == "GET" and path.startswith("community/spaces/") and path.endswith("/events"):
        return await _relay_events(base, target, headers)
    body = await _read_body(request) if request.method != "GET" else b""

    try:
        async with _client(base, httpx.Timeout(30.0, connect=5.0)) as client:
            async with client.stream(request.method, target, headers=headers, content=body or None) as r:
                data = bytearray()
                # Decoded: a Grove behind Cloudflare or nginx answers gzip or brotli, and the page
                # gets no Content-Encoding. The limit therefore applies to the decompressed size.
                async for chunk in r.aiter_bytes():
                    data += chunk
                    if len(data) > MAX_RESPONSE_BYTES:
                        raise HTTPException(502, "The Grove's answer was too large.")
    except httpx.HTTPError as e:
        raise _unreachable(base, e) from None
    await _remember_cookies(db, base, r.headers.get_list("set-cookie"))
    if r.is_redirect:
        raise _moved(base, r)
    passed = {name: r.headers[name] for name in FORWARD_RESPONSE_HEADERS if name in r.headers}
    return Response(content=bytes(data), status_code=r.status_code, headers=passed)


async def _relay_events(base: str, target: httpx.URL, headers: dict) -> Response:
    """A space's change notices (server-sent events), streamed as they arrive. The Grove ends
    each stream about every half minute and the page reconnects, so a read timeout of 90 s
    only trips on a Grove that has stopped answering."""
    client = _client(base, httpx.Timeout(10.0, connect=5.0, read=90.0))
    # Uncompressed, so a proxy in front of the Grove has nothing to hold back while it compresses.
    headers = {**headers, "accept-encoding": "identity"}
    try:
        upstream = await client.send(client.build_request("GET", target, headers=headers), stream=True)
    except httpx.HTTPError as e:
        await client.aclose()
        raise _unreachable(base, e) from None
    if upstream.status_code != 200:
        body = await upstream.aread()
        await upstream.aclose()
        await client.aclose()
        passed = {name: upstream.headers[name] for name in FORWARD_RESPONSE_HEADERS if name in upstream.headers}
        return Response(content=body, status_code=upstream.status_code if not upstream.is_redirect else 502,
                        headers=passed)

    async def relay():
        try:
            async for chunk in upstream.aiter_bytes():
                yield chunk
        except httpx.HTTPError:
            return
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(relay(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no"})


@router.websocket("/grove/{path:path}")
async def grove_socket(websocket: WebSocket, path: str):
    """The Grove host's IRC and peer-message connections (Grove allows them to its host
    account only). Opens the Grove's socket first, so a refusal there refuses this one."""
    if path not in GROVE_SOCKETS:
        await websocket.close(code=1008)
        return
    db_session = get_db()
    db = await anext(db_session)
    try:
        base = await grove_url(db)
        cookies = await _session_cookies(db, base)
    finally:
        await db_session.aclose()
    parts = urlsplit(base)
    target = f"{'wss' if parts.scheme == 'https' else 'ws'}://{parts.netloc}/api/{path}"
    headers = {"Cookie": "; ".join(f"{k}={v}" for k, v in cookies.items())} if cookies else {}
    try:
        upstream_cm = ws_connect(target, additional_headers=headers, user_agent_header=USER_AGENT,
                                 open_timeout=10, max_size=MAX_SOCKET_MESSAGE,
                                 proxy=True if not is_local(base) else None)
        upstream = await upstream_cm.__aenter__()
    except (OSError, asyncio.TimeoutError, WebSocketException):
        await websocket.close(code=1011)
        return
    await websocket.accept()

    async def to_page():
        async for message in upstream:
            if isinstance(message, bytes):
                await websocket.send_bytes(message)
            else:
                await websocket.send_text(message)

    async def to_grove():
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                return
            if message.get("text") is not None:
                await upstream.send(message["text"])
            elif message.get("bytes") is not None:
                await upstream.send(message["bytes"])

    tasks = [asyncio.create_task(to_page()), asyncio.create_task(to_grove())]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        # Closing must finish even while this handler is being cancelled; cut short, it left
        # the Grove's socket open and the cancellation escaped half-handled.
        with anyio.CancelScope(shield=True):
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            await upstream_cm.__aexit__(None, None, None)
            try:
                await websocket.close()
            except RuntimeError:
                pass  # the page already closed it
