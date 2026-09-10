"""
Opt-in bearer-token gate for the /api/* surface, including the WebSocket endpoint.

This app has run with zero authentication until now (see the Arynwood Runtime Roadmap,
item 0.5) — CORS was wide open with credentials on, and nothing checked who was
calling. That's fine for a single local user on localhost, but CLAUDE.md names
multi-tenant managed hosting as a deployment target, and there's no reason to expose
chat history, memories, and deploy-target credentials on the network unauthenticated
the moment this app is reachable from anywhere but localhost.

Kept strictly opt-in rather than on-by-default: this only activates if ARYNWOOD_API_KEY
is set in the environment, so an existing local setup with nothing set keeps working
exactly as it did before this module existed. Set the env var to require it.
"""

import os
from urllib.parse import parse_qs

from starlette.responses import JSONResponse


class ApiKeyMiddleware:
    """ASGI middleware (not BaseHTTPMiddleware) so it can also gate the WebSocket
    handshake, not just HTTP requests.

    Checks `Authorization: Bearer <token>` for HTTP calls, or a `?token=<token>`
    query param for the WebSocket endpoint — browsers can't attach custom headers to
    a WebSocket upgrade request, so the token has to travel some other way there.
    """

    def __init__(self, app):
        self.app = app
        self.api_key = os.environ.get("ARYNWOOD_API_KEY")

    async def __call__(self, scope, receive, send):
        if not self.api_key or scope["type"] not in ("http", "websocket") or not scope["path"].startswith("/api"):
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers") or [])
        auth = headers.get(b"authorization", b"").decode()
        token = auth[7:] if auth.startswith("Bearer ") else None
        if token is None and scope["type"] == "websocket":
            query = parse_qs((scope.get("query_string") or b"").decode())
            token = (query.get("token") or [None])[0]

        if token == self.api_key:
            await self.app(scope, receive, send)
            return

        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 4401})
        else:
            response = JSONResponse({"detail": "Unauthorized"}, status_code=401)
            await response(scope, receive, send)
