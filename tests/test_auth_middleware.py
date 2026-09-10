"""Unit tests for ApiKeyMiddleware, exercised directly against a fake inner ASGI app
rather than through the full FastAPI app + TestClient — Starlette caches its built
middleware stack on the app singleton, so constructing a fresh middleware instance
per test (after monkeypatching the env var) is the deterministic way to test this."""

from backend.services.auth import ApiKeyMiddleware


class _RecordingApp:
    def __init__(self):
        self.called = False

    async def __call__(self, scope, receive, send):
        self.called = True


async def _collect_sent(mw, scope):
    sent = []

    async def send(msg):
        sent.append(msg)

    await mw(scope, None, send)
    return sent


def _http_scope(path="/api/memory", headers=None):
    return {"type": "http", "path": path, "headers": headers or []}


async def test_noop_when_no_api_key_set(monkeypatch):
    monkeypatch.delenv("ARYNWOOD_API_KEY", raising=False)
    inner = _RecordingApp()
    await ApiKeyMiddleware(inner)(_http_scope(), None, None)
    assert inner.called


async def test_blocks_unauthenticated_http_when_key_set(monkeypatch):
    monkeypatch.setenv("ARYNWOOD_API_KEY", "secret123")
    inner = _RecordingApp()
    sent = await _collect_sent(ApiKeyMiddleware(inner), _http_scope())
    assert not inner.called
    assert sent[0]["status"] == 401


async def test_allows_correct_bearer_token(monkeypatch):
    monkeypatch.setenv("ARYNWOOD_API_KEY", "secret123")
    inner = _RecordingApp()
    scope = _http_scope(headers=[(b"authorization", b"Bearer secret123")])
    await ApiKeyMiddleware(inner)(scope, None, None)
    assert inner.called


async def test_wrong_bearer_token_is_rejected(monkeypatch):
    monkeypatch.setenv("ARYNWOOD_API_KEY", "secret123")
    inner = _RecordingApp()
    scope = _http_scope(headers=[(b"authorization", b"Bearer wrong")])
    sent = await _collect_sent(ApiKeyMiddleware(inner), scope)
    assert not inner.called
    assert sent[0]["status"] == 401


async def test_non_api_path_is_never_gated(monkeypatch):
    monkeypatch.setenv("ARYNWOOD_API_KEY", "secret123")
    inner = _RecordingApp()
    await ApiKeyMiddleware(inner)(_http_scope(path="/metrics"), None, None)
    assert inner.called


async def test_websocket_token_accepted_via_query_string(monkeypatch):
    monkeypatch.setenv("ARYNWOOD_API_KEY", "secret123")
    inner = _RecordingApp()
    scope = {"type": "websocket", "path": "/api/chat/ws", "headers": [], "query_string": b"token=secret123"}
    await ApiKeyMiddleware(inner)(scope, None, None)
    assert inner.called


async def test_websocket_rejected_without_token(monkeypatch):
    monkeypatch.setenv("ARYNWOOD_API_KEY", "secret123")
    inner = _RecordingApp()
    scope = {"type": "websocket", "path": "/api/chat/ws", "headers": [], "query_string": b""}
    sent = await _collect_sent(ApiKeyMiddleware(inner), scope)
    assert not inner.called
    assert sent[0]["type"] == "websocket.close"
