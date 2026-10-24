"""Reject untrusted browser origins on HTTP and WebSocket API requests.

Bearer authentication remains opt-in for local compatibility. Origin validation
runs even without a key; CORS alone cannot prevent requests from taking effect.
Clients without Origin still need ARYNWOOD_API_KEY when configured. This is a
single-user boundary, not tenant isolation or a sandbox for local processes.
Non-loopback clients require authentication even when a launcher is bypassed.
"""

import logging
import os
import re
import secrets
from urllib.parse import parse_qs

from starlette.responses import JSONResponse
from backend.services.exposure import allowed_hosts, is_loopback, request_host_allowed


class RedactTokenFilter(logging.Filter):
    """uvicorn writes each request's path with its query string: the HTTP access log, and WebSocket
    accepts and refusals (on uvicorn.error). A WebSocket may carry the API key as ?token=, so its value
    is replaced before the line is written."""
    TOKEN = re.compile(r"((?:^|[?&])token=)[^&\s\"]*", re.I)

    def filter(self, record):
        if isinstance(record.args, tuple):
            record.args = tuple(self.TOKEN.sub(r"\1[redacted]", a) if isinstance(a, str) else a for a in record.args)
        return True


def redact_tokens_in_server_logs():
    for name in ("uvicorn.access", "uvicorn.error"):
        logger = logging.getLogger(name)
        if not any(isinstance(f, RedactTokenFilter) for f in logger.filters):
            logger.addFilter(RedactTokenFilter())


# Opaque origins can be created by arbitrary sandboxed websites.
TRUSTED_BROWSER_ORIGINS = [
    "http://localhost:5180", "http://127.0.0.1:5180",
    "http://localhost:8010", "http://127.0.0.1:8010",
    "tauri://localhost", "http://tauri.localhost", "https://tauri.localhost",
]

# Read-only files the desktop app itself loads cross-site. Its web view is tauri://localhost, and
# WebKitGTK (checked on 2.52) sends the html-tools iframes and <img>/<audio>/<video> loads to :8010
# with Sec-Fetch-Site: cross-site and neither Origin nor Referer, exactly like another site's request.
# GET/HEAD of these change nothing, the media ids are random UUIDs, and html-tools render only inside
# a trusted frame (frame-ancestors, set where they're served).
CROSS_SITE_READ_ONLY = re.compile(
    r"/html-tools/.+"
    r"|/api/tools/jobs/[^/]+/file"
    r"|/api/music/assets/[^/]+/audio"
    r"|/api/studio/stems/[^/]+/[^/]+"
    r"|/api/studio/voice/convert/[^/]+/result"
    r"|/api/video/music/proxy"
    # The Community page's pictures: a Grove's logo and login picture, photos in Messages, and image
    # files shown from a space's Files. Their ids are random; the Grove's answers stay read-only.
    r"|/api/community/grove/brand/(?:logo|picture)"
    r"|/api/community/grove/messages/photos/[^/]+"
    r"|/api/community/grove/community/spaces/[^/]+/files/[^/]+/content"
    r"|/api/community/preview/.+"
)
# A Grove website preview (backend/routers/community.py) runs sandboxed, so the fonts and module scripts
# it loads with CORS say `Origin: null`. Its signed address is the whole permission; no sign-in goes with it.
SANDBOXED_READ_ONLY = re.compile(r"/api/community/preview/.+")


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
        read_only = scope["type"] == "http" and scope.get("method") in ("GET", "HEAD")
        if origin is not None and origin.decode("latin-1") not in TRUSTED_BROWSER_ORIGINS and not (
                origin == b"null" and read_only and SANDBOXED_READ_ONLY.fullmatch(scope["path"])):
            await self._reject(scope, receive, send, 403, "Untrusted browser origin")
            return
        # Cross-site navigations/images can omit Origin. Do not let them trigger
        # owner endpoints (including the legacy GET install stream).
        if origin is None and headers.get(b"sec-fetch-site") == b"cross-site" and not (
                read_only and CROSS_SITE_READ_ONLY.fullmatch(scope["path"])):
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
