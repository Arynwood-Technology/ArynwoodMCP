"""Reject untrusted browser origins on HTTP and WebSocket API requests.

Bearer authentication remains opt-in for local compatibility. Origin validation
runs even without a key; CORS alone cannot prevent requests from taking effect.
Clients without Origin still need ARYNWOOD_API_KEY when configured. This is a
single-user boundary, not tenant isolation or a sandbox for local processes.
Non-loopback clients require authentication even when a launcher is bypassed.
"""

import os
import secrets
from urllib.parse import parse_qs

from starlette.responses import JSONResponse
from backend.services.exposure import allowed_hosts, is_loopback, request_host_allowed


# Opaque origins can be created by arbitrary sandboxed websites.
TRUSTED_BROWSER_ORIGINS = [
    "http://localhost:5180", "http://127.0.0.1:5180",
    "http://localhost:8010", "http://127.0.0.1:8010",
    "tauri://localhost", "http://tauri.localhost", "https://tauri.localhost",
]


class ApiKeyMiddleware:
    """ASGI middleware (not BaseHTTPMiddleware) so it can also gate the WebSocket
    handshake, not just HTTP requests.

    Checks `Authorization: Bearer <token>` for HTTP calls, or a `?token=<token>`
    query param for the WebSocket endpoint — browsers can't attach custom headers to
    a WebSocket upgrade request, so the token has to travel some other way there.
    """

    def __init__(self, app):
        self.app = app
        self.api_key = os.environ.get("ARYNWOOD_API_KEY", "").strip() or None
        self.allowed_hosts = allowed_hosts()

    async def _reject(self, scope, receive, send, status: int, detail: str):
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 4400 + status - 400})
        else:
            await JSONResponse({"detail": detail}, status_code=status)(scope, receive, send)

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers") or [])
        host = headers.get(b"host")
        if host is not None and not request_host_allowed(host.decode("latin-1"), self.allowed_hosts):
            await self._reject(scope, receive, send, 400, "Untrusted Host header")
            return
        origin = headers.get(b"origin")
        if origin is not None and origin.decode("latin-1") not in TRUSTED_BROWSER_ORIGINS:
            await self._reject(scope, receive, send, 403, "Untrusted browser origin")
            return
        # Cross-site navigations/images can omit Origin. Do not let them trigger
        # owner endpoints (including the legacy GET install stream).
        if origin is None and headers.get(b"sec-fetch-site") == b"cross-site":
            await self._reject(scope, receive, send, 403, "Cross-site request denied")
            return

        peer = scope.get("client")
        remote = peer is not None and not is_loopback(peer[0])
        if not self.api_key:
            if remote:
                await self._reject(scope, receive, send, 401, "Remote access requires ARYNWOOD_API_KEY")
                return
            await self.app(scope, receive, send)
            return

        path = scope["path"]
        protected = remote or path == "/api" or path.startswith(("/api/", "/social-media/")) or path in ("/metrics", "/social-media")
        if not protected:
            await self.app(scope, receive, send)
            return

        auth = headers.get(b"authorization", b"").decode("latin-1")
        token = auth[7:] if auth.startswith("Bearer ") else None
        if token is None and scope["type"] == "websocket":
            query = parse_qs((scope.get("query_string") or b"").decode("latin-1"))
            token = (query.get("token") or [None])[0]

        if token is not None and secrets.compare_digest(token.encode("utf-8"), self.api_key.encode("utf-8")):
            await self.app(scope, receive, send)
            return

        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 4401})
        else:
            response = JSONResponse({"detail": "Unauthorized"}, status_code=401)
            await response(scope, receive, send)
