"""The Community page's pass-through to a Grove: the owner's address choice, the Grove sign-in
held by this app (never by the web view), what may and may not be forwarded, live notices and
the host's sockets. Runs against a real stand-in Grove on a loopback port, because what crosses
the network (headers, cookies, redirects, streaming) is the point."""
import asyncio
import gzip
import json
import socket
import threading
import time

import pytest
import uvicorn
from fastapi import FastAPI, Request, Response, WebSocket
from fastapi.responses import JSONResponse, RedirectResponse, StreamingResponse

from backend.routers import community

COOKIE = "grove_session"


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _fake_grove(seen: list) -> FastAPI:
    app = FastAPI()

    @app.get("/api/health")
    def health():
        return {"status": "ok", "name": "Arynwood Grove", "version": "0.4.0"}

    @app.post("/api/auth/login")
    async def login(request: Request):
        body = await request.json()
        seen.append(("login", dict(request.headers), body))
        response = JSONResponse({"id": "u1", "name": "Owner", "email": body["email"], "admin": 1})
        response.set_cookie(COOKIE, "token-1", httponly=True, samesite="strict", max_age=3600, path="/")
        return response

    @app.post("/api/auth/logout")
    def logout():
        response = JSONResponse({"ok": True})
        response.delete_cookie(COOKIE, path="/")
        return response

    @app.get("/api/auth/me")
    def me(request: Request):
        seen.append(("me", dict(request.headers), str(request.url.query)))
        if request.cookies.get(COOKIE) != "token-1":
            return JSONResponse({"detail": "Sign in first."}, status_code=401)
        return {"id": "u1", "name": "Owner", "email": "owner@example.com", "admin": 1}

    @app.get("/api/community/spaces/{space}/export")
    def export(space: str):
        return Response(json.dumps({"space": space}), media_type="application/json",
                        headers={"Content-Disposition": f'attachment; filename="{space}.json"',
                                 "X-Frame-Options": "DENY"})

    @app.get("/api/community/moved")
    def moved():
        return RedirectResponse("https://elsewhere.example/api/community/moved", status_code=308)

    @app.post("/api/community/echo-size")
    async def echo_size(request: Request):
        return {"bytes": len(await request.body())}

    @app.get("/api/community/spaces/{space}/notes")
    def notes(space: str, request: Request):
        # Like Cloudflare or nginx in front of a real Grove: compressed whenever the client accepts it.
        body = json.dumps({"space": space, "notes": ["a note"] * 400}).encode()
        if "gzip" in request.headers.get("accept-encoding", ""):
            return Response(gzip.compress(body), media_type="application/json", headers={"Content-Encoding": "gzip"})
        return Response(body, media_type="application/json")

    @app.get("/api/community/spaces/{space}/events")
    async def events(space: str, request: Request):
        seen.append(("events", dict(request.headers), None))
        if request.cookies.get(COOKIE) != "token-1":
            return JSONResponse({"detail": "Sign in first."}, status_code=401)

        async def stream():
            for n in range(2):
                yield f"event: changed\ndata: {n}\n\n"
                await asyncio.sleep(0.05)
        return StreamingResponse(stream(), media_type="text/event-stream")

    @app.get("/api/messages/events")
    async def message_events(request: Request):
        seen.append(("message-events", dict(request.headers), None))

        async def stream():
            yield "event: changed\ndata: 1\n\n"
        return StreamingResponse(stream(), media_type="text/event-stream")

    @app.get("/api/messages/unread")
    def unread():
        return {"unread": 2}

    @app.get("/api/community/spaces/{space}/files/{file}/content")
    async def content(space: str, file: str):
        async def stream():
            for _ in range(8):
                yield b"x" * 1000
        return StreamingResponse(stream(), media_type="application/octet-stream", headers={
            "Content-Disposition": f'attachment; filename="{file}.bin"', "Content-Security-Policy": "sandbox"})

    @app.get("/api/community/preview/{token}/{path:path}")
    def preview(token: str, path: str, request: Request):
        seen.append(("preview", dict(request.headers), path))
        return Response(f"<link rel=stylesheet href=/api/community/preview/{token}/site.css><h1>{path or 'home'}</h1>",
                        media_type="text/html", headers={
                            "Content-Security-Policy": "sandbox allow-scripts; default-src 'none'; frame-ancestors 'self'",
                            "X-Frame-Options": "SAMEORIGIN", "Access-Control-Allow-Origin": "*"})

    @app.websocket("/api/chat/ws")
    async def chat(ws: WebSocket):
        if ws.cookies.get(COOKIE) != "token-1":
            await ws.close(code=1008)
            return
        await ws.accept()
        await ws.send_text("welcome to #public")
        await ws.close()

    @app.websocket("/api/irc/ws")
    async def irc(ws: WebSocket):
        if ws.cookies.get(COOKIE) != "token-1":
            await ws.close(code=1008)
            return
        await ws.accept()
        seen.append(("ws", dict(ws.headers), None))
        while True:
            text = await ws.receive_text()
            await ws.send_text("echo:" + text)

    return app


@pytest.fixture()
def grove(monkeypatch):
    """A stand-in Grove on a free loopback port, set as the installer default."""
    seen: list = []
    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(_fake_grove(seen), host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + 10
    while not server.started and time.time() < deadline:
        time.sleep(0.02)
    url = f"http://127.0.0.1:{port}"
    monkeypatch.setenv("ARYNWOOD_COMMUNITY_URL", url)
    yield {"url": url, "seen": seen, "port": port}
    server.should_exit = True
    thread.join(timeout=5)


@pytest.fixture(autouse=True)
def _forget_choice(client):
    """The suite shares one database; no test may leave an address or a sign-in behind."""
    def clear():
        import sqlite3
        from backend.db import DB_PATH
        with sqlite3.connect(DB_PATH) as db:
            db.execute("DELETE FROM settings WHERE key IN (?, ?)", (community.ADDRESS_SETTING, community.SESSION_SETTING))
    clear()
    yield
    clear()


def _sign_in(client):
    return client.post("/api/community/grove/auth/login", json={"email": "owner@example.com", "password": "x" * 12},
                       headers={"X-Community-Request": "1"})


# --- the address -------------------------------------------------------------------------------

@pytest.mark.parametrize("typed, stored", [
    ("community.arynwood.com", "https://community.arynwood.com"),
    ("https://Grove.Example.com/community?invite=abc", "https://grove.example.com"),
    ("127.0.0.1:8019", "http://127.0.0.1:8019"),
    ("http://localhost:8018/", "http://localhost:8018"),
    ("https://[::1]:9000", "https://[::1]:9000"),
])
def test_address_is_reduced_to_the_groves_origin(typed, stored):
    assert community.normalize_address(typed) == stored


@pytest.mark.parametrize("typed", [
    "http://grove.example.com",          # a password would cross the network unencrypted
    "https://owner:secret@grove.example.com",
    "ftp://grove.example.com",
    "https://grove.example.com:99999",
    "   ",
])
def test_unsafe_or_meaningless_addresses_are_refused(typed):
    with pytest.raises(ValueError):
        community.normalize_address(typed)


def test_choosing_an_address_and_returning_to_the_default(client, grove):
    assert client.get("/api/community/status").json()["url"] == grove["url"]
    body = client.put("/api/community/address", json={"url": "community.example.invalid"}).json()
    assert body["url"] == "https://community.example.invalid" and body["mode"] == "remote"
    assert body["default_url"] == grove["url"]
    refused = client.put("/api/community/address", json={"url": "http://grove.example.com"})
    assert refused.status_code == 400 and "https://" in refused.json()["detail"]
    assert client.put("/api/community/address", json={"url": ""}).json()["url"] == grove["url"]


# --- the sign-in stays in Arynwood --------------------------------------------------------------

def test_sign_in_is_held_by_arynwood_and_never_reaches_the_page(client, grove):
    assert client.get("/api/community/grove/auth/me").status_code == 401
    r = _sign_in(client)
    assert r.status_code == 200 and r.json()["name"] == "Owner"
    assert "set-cookie" not in r.headers and not client.cookies
    assert client.get("/api/community/grove/auth/me").json()["email"] == "owner@example.com"

    assert client.post("/api/community/grove/auth/logout", headers={"X-Community-Request": "1"}).status_code == 200
    assert client.get("/api/community/grove/auth/me").status_code == 401


def test_changing_grove_forgets_the_sign_in(client, grove):
    _sign_in(client)
    client.put("/api/community/address", json={"url": "https://community.example.invalid"})
    client.put("/api/community/address", json={"url": grove["url"]})
    assert client.get("/api/community/grove/auth/me").status_code == 401


def test_only_the_page_headers_are_forwarded(client, grove):
    _sign_in(client)
    client.get("/api/community/grove/auth/me?x=1&y=%2F", headers={
        "Authorization": "Bearer arynwood-api-key", "Cookie": "arynwood=private",
        "Origin": "http://localhost:5180", "X-Forwarded-For": "203.0.113.9"})
    _, headers, query = grove["seen"][-1]
    assert headers["cookie"] == f"{COOKIE}=token-1"
    assert headers["user-agent"] == community.USER_AGENT
    assert query == "x=1&y=%2F"
    for name in ("authorization", "origin", "x-forwarded-for", "referer"):
        assert name not in headers
    login_headers = next(h for kind, h, _ in grove["seen"] if kind == "login")
    assert login_headers["x-community-request"] == "1"


# --- what can and can't be reached ---------------------------------------------------------------

@pytest.mark.parametrize("path", ["grove/chat", "health", "source", "community/../grove/chat", "community//spaces",
                                  "p2p/wallet"])
def test_only_the_community_pages_areas_are_reachable(client, grove, path):
    assert client.get(f"/api/community/grove/{path}").status_code == 404


def test_the_areas_grove_0_7_added_are_reachable(client, grove):
    assert client.get("/api/community/grove/messages/unread").json() == {"unread": 2}


def test_downloads_keep_their_file_name_and_drop_grove_page_headers(client, grove):
    r = client.get("/api/community/grove/community/spaces/s1/export")
    assert r.status_code == 200 and r.json() == {"space": "s1"}
    assert r.headers["content-disposition"] == 'attachment; filename="s1.json"'
    assert "x-frame-options" not in r.headers


def test_files_stream_past_the_json_limit_and_keep_the_groves_sandbox(client, grove, monkeypatch):
    monkeypatch.setattr(community, "MAX_RESPONSE_BYTES", 2000)
    r = client.get("/api/community/grove/community/spaces/s1/files/f1/content")
    assert r.status_code == 200 and r.content == b"x" * 8000
    assert r.headers["content-disposition"] == 'attachment; filename="f1.bin"'
    # Opened from this app's own address, the file still can't run as a page of it.
    assert r.headers["content-security-policy"] == "sandbox"


def test_a_compressed_answer_reaches_the_page_decoded(client, grove):
    r = client.get("/api/community/grove/community/spaces/s1/notes")
    assert r.status_code == 200 and r.json()["space"] == "s1" and len(r.json()["notes"]) == 400
    assert "content-encoding" not in r.headers


def test_the_size_limit_counts_what_a_compressed_answer_unpacks_to(client, grove, monkeypatch):
    monkeypatch.setattr(community, "MAX_RESPONSE_BYTES", 2000)
    r = client.get("/api/community/grove/community/spaces/s1/notes")
    assert r.status_code == 502 and "too large" in r.json()["detail"]


def test_redirects_are_reported_not_followed(client, grove):
    r = client.get("/api/community/grove/community/moved")
    assert r.status_code == 502 and "elsewhere.example" in r.json()["detail"]


def test_an_unreachable_grove_is_explained(client, monkeypatch):
    monkeypatch.setenv("ARYNWOOD_COMMUNITY_URL", f"http://127.0.0.1:{_free_port()}")
    r = client.get("/api/community/grove/auth/me")
    assert r.status_code == 502 and "Couldn't reach the Grove" in r.json()["detail"]


def test_oversized_uploads_are_refused_before_forwarding(client, grove, monkeypatch):
    monkeypatch.setattr(community, "MAX_REQUEST_BYTES", 1000)
    ok = client.post("/api/community/grove/community/echo-size", content=b"x" * 1000, headers={"X-Community-Request": "1"})
    assert ok.json() == {"bytes": 1000}
    assert client.post("/api/community/grove/community/echo-size", content=b"x" * 1001).status_code == 413


# --- live notices and host sockets ----------------------------------------------------------------

def test_live_notices_stream_through(client, grove):
    _sign_in(client)
    with client.stream("GET", "/api/community/grove/community/spaces/s1/events") as r:
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
        text = "".join(r.iter_text())
    assert text.count("event: changed") == 2
    assert [h for kind, h, _ in grove["seen"] if kind == "events"][-1]["accept-encoding"] == "identity"


def test_a_members_messages_notices_stream_through(client, grove):
    _sign_in(client)
    with client.stream("GET", "/api/community/grove/messages/events") as r:
        assert r.headers["content-type"].startswith("text/event-stream")
        assert "event: changed" in "".join(r.iter_text())
    assert [h for kind, h, _ in grove["seen"] if kind == "message-events"][-1]["cookie"] == f"{COOKIE}=token-1"


def test_live_notices_pass_a_refusal_through(client, grove):
    assert client.get("/api/community/grove/community/spaces/s1/events").status_code == 401


def test_host_socket_carries_the_sign_in_and_both_directions(client, grove):
    _sign_in(client)
    with client.websocket_connect("/api/community/grove/irc/ws") as ws:
        ws.send_text("PING")
        assert ws.receive_text() == "echo:PING"
    _, headers, _ = next(entry for entry in grove["seen"] if entry[0] == "ws")
    assert headers["cookie"] == f"{COOKIE}=token-1" and "origin" not in headers


def test_public_chat_socket_reaches_the_grove(client, grove):
    _sign_in(client)
    with client.websocket_connect("/api/community/grove/chat/ws") as ws:
        assert ws.receive_text() == "welcome to #public"


# --- website previews ------------------------------------------------------------------------------

TOKEN = "eyJzIjoxfQ." + "0" * 64


def test_previews_answer_at_the_groves_own_address_without_the_sign_in(client, grove):
    _sign_in(client)
    r = client.get(f"/api/community/preview/{TOKEN}/about.html?x=1")
    assert r.status_code == 200 and "<h1>about.html</h1>" in r.text
    # The page's own links, rewritten by the Grove, lead back to this same address.
    assert f"/api/community/preview/{TOKEN}/site.css" in r.text
    _, headers, path = [entry for entry in grove["seen"] if entry[0] == "preview"][-1]
    assert path == "about.html" and "cookie" not in headers
    assert client.get(f"/api/community/preview/{TOKEN}/").text.endswith("<h1>home</h1>")


def test_previews_run_sandboxed_and_only_this_app_may_frame_them(client, grove):
    r = client.get(f"/api/community/preview/{TOKEN}/index.html")
    policy = r.headers["content-security-policy"]
    assert policy.startswith("sandbox allow-scripts ") and "default-src 'none'" in policy
    assert "frame-ancestors 'self' " in policy and "tauri://localhost" in policy
    # Its files are named by the preview's own address: WebKit matches 'self' in a sandboxed frame to nothing.
    own = str(r.url.copy_with(path=f"/api/community/preview/{TOKEN}/", query=None))
    assert f"style-src {own} 'unsafe-inline'" in policy and f"img-src {own} data:" in policy
    assert "'self'" not in policy.split("frame-ancestors")[0]
    assert "x-frame-options" not in r.headers and r.headers["access-control-allow-origin"] == "*"


@pytest.mark.parametrize("path", [f"{TOKEN}/../../auth/me", f"{TOKEN}/a//b", "not-a-token/index.html",
                                  f"{TOKEN[:-1]}g/index.html"])
def test_previews_stay_inside_their_own_address(client, grove, path):
    assert client.get(f"/api/community/preview/{path}").status_code == 404
    assert not [entry for entry in grove["seen"] if entry[0] == "preview"]


def test_other_sockets_and_signed_out_sockets_are_refused(client, grove):
    from starlette.websockets import WebSocketDisconnect
    for path in ("community/ws", "p2p/ws", "irc/ws"):  # not socket areas; then not signed in
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(f"/api/community/grove/{path}") as ws:
                ws.receive_text()
