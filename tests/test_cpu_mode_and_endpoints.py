"""One program for every machine: CPU mode, and endpoints that bridge what a machine lacks.
See backend/services/machine.py, backend/routers/servers.py and backend/routers/images.py."""
import asyncio
import base64
import json

import aiosqlite
import httpx
import pytest

from backend.db import DB_PATH, init_db
from backend.routers import chat, images, servers
from backend.services import machine, ollama_client, public_web

PNG = base64.b64encode(b"\x89PNG\r\n\x1a\nfake").decode()


async def _db():
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    return db


async def _reset_db():
    await init_db()
    db = await _db()
    try:
        await db.execute("DELETE FROM servers WHERE id > 1")
        await db.execute("DELETE FROM settings WHERE key IN ('cpu_mode', 'image_endpoint')")
        await db.execute("UPDATE settings SET value='1' WHERE key='default_server_id'")
        await db.commit()
    finally:
        await db.close()


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    """Shared test DB and module state: leave both as found."""
    monkeypatch.setattr(machine, "_gpu_present", True)
    monkeypatch.setattr(machine, "_setting", None)
    for name in ("ARYNWOOD_ENDPOINT_URL", "ARYNWOOD_ENDPOINT_TYPE", "ARYNWOOD_ENDPOINT_TOKEN",
                 "ARYNWOOD_ENDPOINT_MODEL", "ARYNWOOD_ENDPOINT_IMAGE_MODEL", "ARYNWOOD_ENDPOINT_NAME"):
        monkeypatch.delenv(name, raising=False)
    asyncio.run(_reset_db())
    yield
    asyncio.run(_reset_db())
    machine._setting = None


def _mock_httpx(monkeypatch, module, handler):
    factory = httpx.AsyncClient
    monkeypatch.setattr(module.httpx, "AsyncClient",
                        lambda **kwargs: factory(transport=httpx.MockTransport(handler), **kwargs))


# ── CPU mode ────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("setting,gpu,expected", [
    ("auto", False, True), ("auto", True, False),
    ("on", True, True), ("off", False, False),
])
def test_cpu_mode_follows_the_setting_and_the_gpu(monkeypatch, setting, gpu, expected):
    monkeypatch.setattr(machine, "_gpu_present", gpu)
    monkeypatch.setattr(machine, "_setting", setting)
    assert machine.enabled() is expected


def test_installer_default_applies_until_the_owner_chooses(monkeypatch, client):
    monkeypatch.setenv("ARYNWOOD_CPU_MODE", "on")
    assert client.get("/api/system/cpu-mode").json()["setting"] == "on"
    assert client.put("/api/system/cpu-mode", json={"setting": "off"}).json() == {
        "enabled": False, "setting": "off", "nvidia_gpu": True}
    assert client.get("/api/system/cpu-mode").json()["setting"] == "off"   # stored, wins over .env
    assert client.get("/api/system/status").json()["cpu_mode"]["setting"] == "off"


def test_cpu_mode_rejects_unknown_settings(client):
    assert client.put("/api/system/cpu-mode", json={"setting": "turbo"}).status_code == 400


def test_only_local_ollama_counts_as_this_computer():
    for host in ("localhost", "127.0.0.1", "http://localhost:11434", "http://[::1]:11434", None):
        assert machine.is_local_host(host), host
    for host in ("https://api.example.com/v1", "http://10.0.0.5:11434", "gpu-box"):
        assert not machine.is_local_host(host), host


def test_cpu_mode_tunes_local_chat_only(monkeypatch):
    monkeypatch.setattr(machine, "_setting", "on")
    assert chat._ctx_ceiling("localhost") == machine.CPU_NUM_CTX
    assert chat._ctx_ceiling("https://api.example.com/v1") == chat.MAX_NUM_CTX
    assert ollama_client._keep_alive("localhost", 11434) == machine.CPU_KEEP_ALIVE
    assert ollama_client._keep_alive("http://10.0.0.5:11434", None) is None
    assert machine.timeout(60.0, "localhost") == 60.0 * machine.CPU_TIMEOUT_SCALE
    assert machine.timeout(60.0, "https://api.example.com/v1") == 60.0
    # A persona's own num_ctx still wins over the CPU ceiling.
    assert chat._persona_num_ctx({"llm": {"num_ctx": 12288}}, machine.CPU_NUM_CTX) == 12288
    monkeypatch.setattr(machine, "_setting", "off")
    assert chat._ctx_ceiling("localhost") == chat.MAX_NUM_CTX
    assert ollama_client._keep_alive("localhost", 11434) is None


def test_cpu_mode_leaves_provider_servers_alone(monkeypatch):
    """An OpenAI-compatible server on this computer (a local llama.cpp server, say) manages its
    own context: CPU mode's ceiling is for Ollama only."""
    from backend.services import providers
    monkeypatch.setattr(machine, "_setting", "on")
    token = providers.active_provider.set({"host": "http://127.0.0.1:18099/v1", "type": "openai-compatible"})
    try:
        assert chat._ctx_ceiling("http://127.0.0.1:18099/v1") == chat.MAX_NUM_CTX
    finally:
        providers.active_provider.reset(token)
    token = providers.active_provider.set({"host": "localhost", "port": 11434, "type": "ollama"})
    try:
        assert chat._ctx_ceiling("http://localhost:11434") == machine.CPU_NUM_CTX
    finally:
        providers.active_provider.reset(token)


def test_central_fits_the_cpu_ceiling_on_a_fresh_install(monkeypatch):
    """A fresh install has no token calibration, so the conservative estimate decides. Central's
    persona prompt and tool definitions must leave room for a message at CPU mode's ceiling
    (4096 didn't: every central turn was refused)."""
    from backend.services import context_budget
    from backend.services.context_budget import request_tokens
    monkeypatch.setattr(context_budget, "_calibration", {})
    persona = chat.get_personas()["central"]
    model = persona["llm"]["model"]
    count = lambda text: request_tokens([{"role": "system", "content": text}], None, model)
    system = chat.build_system_prompt(persona, "", [], "", budget_tokens=chat.MIN_BUDGET_TOKENS, history_summary="",
                                      has_native_tools=True, tool_servers=[], count_tokens=count, memory_enabled=True)
    fixed = request_tokens([{"role": "system", "content": system}, {"role": "user", "content": "x" * 400}],
                           chat._NATIVE_TOOLS, model)
    limit = machine.CPU_NUM_CTX - min(chat.RESPONSE_RESERVE_TOKENS, machine.CPU_NUM_CTX // 4)
    assert fixed < limit * 0.8, (fixed, limit)


def test_gpu_tools_are_marked_and_refused_in_cpu_mode(monkeypatch, client):
    listed = {t["id"]: t for t in client.get("/api/tools").json()}
    assert listed["stable_diffusion"]["gpu"] and listed["sadtalker"]["gpu"]
    assert not listed["kokoro_tts"]["gpu"] and not listed["whisper"]["gpu"] and not listed["design_center"]["gpu"]

    monkeypatch.setattr(machine, "_setting", "on")
    for path, body in (("/api/tools/sd/generate", {"prompt": "x"}), ("/api/tools/stable_diffusion/install/stream", None),
                       ("/api/studio/sidecars/song-gen/start", None), ("/api/lora/projects/1/train", {"base_model_path": "x"})):
        r = client.post(path, json=body)
        assert r.status_code == 409, path
        assert "CPU mode" in r.json()["detail"]
    sidecars = client.get("/api/studio/sidecars").json()
    assert sidecars["song-gen"]["gpu"] and not sidecars["audio-fx"]["gpu"]
    # CPU-friendly sidecars aren't refused (this one fails later, for a missing venv).
    assert client.post("/api/studio/sidecars/audio-fx/start").status_code != 409


# ── Servers: tokens, the default, model lists, the installer preset ────────────

def test_server_tokens_never_reach_the_page(client):
    created = client.post("/api/servers", json={"name": "Remote", "host": "https://api.example.com/v1",
                                                 "port": 443, "type": "openai-compatible",
                                                 "auth_token": "sk-secret", "model": "chat-model"}).json()
    assert created["has_token"] is True and "auth_token" not in created
    listed = client.get("/api/servers").json()
    assert all("auth_token" not in s for s in listed)
    assert "sk-secret" not in json.dumps(listed)
    assert client.get(f"/api/servers/{created['id']}").json()["model"] == "chat-model"


def test_default_server_is_remembered(client):
    assert client.get("/api/servers/default").json()["server"]["id"] == 1
    sid = client.post("/api/servers", json={"name": "Remote", "host": "https://api.example.com/v1",
                                             "type": "openai-compatible"}).json()["id"]
    assert client.put("/api/servers/default", json={"server_id": sid}).json()["server"]["id"] == sid
    assert client.get("/api/servers/default").json()["server"]["id"] == sid
    client.patch(f"/api/servers/{sid}", json={"enabled": 0})
    assert client.get("/api/servers/default").json()["server"]["id"] == 1   # disabled: fall back
    assert client.put("/api/servers/default", json={"server_id": sid}).status_code == 400


def test_models_of_an_openai_compatible_server(monkeypatch, client):
    def handler(request):
        assert request.url.path == "/v1/models"
        assert request.headers["authorization"] == "Bearer sk-secret"
        return httpx.Response(200, json={"data": [{"id": "chat-model"}, {"id": "image-model"}]})
    _mock_httpx(monkeypatch, servers, handler)
    sid = client.post("/api/servers", json={"name": "Remote", "host": "https://api.example.com/v1",
                                             "type": "openai-compatible", "auth_token": "sk-secret"}).json()["id"]
    assert client.get(f"/api/servers/{sid}/models").json() == {
        "models": [{"name": "chat-model"}, {"name": "image-model"}]}


async def test_installer_preset_registers_once_then_the_owner_decides(monkeypatch):
    monkeypatch.setenv("ARYNWOOD_ENDPOINT_URL", "https://models.example.net/v1/")
    monkeypatch.setenv("ARYNWOOD_ENDPOINT_TOKEN", "first-token")
    monkeypatch.setenv("ARYNWOOD_ENDPOINT_MODEL", "chat-model")
    monkeypatch.setenv("ARYNWOOD_ENDPOINT_IMAGE_MODEL", "image-model")
    db = await _db()
    try:
        sid = await servers.apply_preset(db)
        row = dict(await (await db.execute("SELECT * FROM servers WHERE id=?", (sid,))).fetchone())
        assert (row["host"], row["port"], row["type"], row["model"], row["auth_token"]) == (
            "https://models.example.net/v1", 443, "openai-compatible", "chat-model", "first-token")
        assert (await servers.get_default_server(db))["server"]["id"] == sid
        assert (await images.get_config(db))["model"] == "image-model"

        await servers.put_default_server(servers.DefaultServer(server_id=1), db)   # the owner switches back
        monkeypatch.setenv("ARYNWOOD_ENDPOINT_TOKEN", "rotated-token")
        assert await servers.apply_preset(db) == sid                               # no duplicate row
        assert (await servers.get_default_server(db))["server"]["id"] == 1         # choice kept
        token = (await (await db.execute("SELECT auth_token FROM servers WHERE id=?", (sid,))).fetchone())[0]
        assert token == "rotated-token"
    finally:
        await db.close()


async def test_preset_ignores_a_malformed_url(monkeypatch):
    monkeypatch.setenv("ARYNWOOD_ENDPOINT_URL", "file:///etc/passwd")
    db = await _db()
    try:
        assert await servers.apply_preset(db) is None
    finally:
        await db.close()


# ── Image endpoint ──────────────────────────────────────────────────────────────

def _image_server(client) -> int:
    return client.post("/api/servers", json={"name": "Images", "host": "https://img.example.com/v1",
                                              "type": "openai-compatible", "auth_token": "sk-img"}).json()["id"]


def test_image_config_requires_an_openai_compatible_server_and_a_model(client):
    assert client.get("/api/images/config").json()["source"] == "local"
    assert client.put("/api/images/config", json={"server_id": 1, "model": "x"}).status_code == 400   # Ollama
    sid = _image_server(client)
    assert client.put("/api/images/config", json={"server_id": sid, "model": " "}).status_code == 400
    config = client.put("/api/images/config", json={"server_id": sid, "model": "image-model"}).json()
    assert config["source"] == "endpoint" and config["model"] == "image-model"
    assert "sk-img" not in json.dumps(config)
    assert client.put("/api/images/config", json={"server_id": None}).json()["source"] == "local"


def test_generate_without_an_endpoint_says_how_to_add_one(client):
    r = client.post("/api/images/generate", json={"prompt": "a tree"})
    assert r.status_code == 409 and "Servers" in r.json()["detail"]


def test_generate_and_edit_through_the_endpoint(monkeypatch, client):
    seen = []

    def handler(request):
        seen.append(request)
        assert request.headers["authorization"] == "Bearer sk-img"
        return httpx.Response(200, json={"data": [{"b64_json": PNG}]})
    _mock_httpx(monkeypatch, images, handler)
    sid = _image_server(client)
    client.put("/api/images/config", json={"server_id": sid, "model": "image-model"})

    r = client.post("/api/images/generate", json={"prompt": "a tree", "width": 1536, "height": 1024})
    assert r.json() == {"images": [PNG], "source": "endpoint"}
    body = json.loads(seen[0].content)
    assert seen[0].url.path == "/v1/images/generations"
    assert body == {"model": "image-model", "prompt": "a tree", "n": 1, "size": "1536x1024",
                    "response_format": "b64_json"}

    r = client.post("/api/images/edit", json={"prompt": "at night", "image": "data:image/jpeg;base64," + PNG})
    assert r.status_code == 200
    assert seen[1].url.path == "/v1/images/edits"
    assert b'filename="image.jpeg"' in seen[1].content and b"at night" in seen[1].content


def test_gpt_image_models_are_not_sent_response_format(monkeypatch, client):
    bodies = []
    _mock_httpx(monkeypatch, images, lambda r: bodies.append(json.loads(r.content))
                or httpx.Response(200, json={"data": [{"b64_json": PNG}]}))
    sid = _image_server(client)
    client.put("/api/images/config", json={"server_id": sid, "model": "gpt-image-1"})
    client.post("/api/images/generate", json={"prompt": "a tree"})
    assert "response_format" not in bodies[0]


def test_image_links_are_fetched_as_public_web_content(monkeypatch, client):
    _mock_httpx(monkeypatch, images, lambda r: httpx.Response(200, json={"data": [{"url": "https://cdn.example.com/x.png"}]}))
    fetched = []

    async def fake_fetch(url):
        fetched.append(url)
        return httpx.Response(200, content=b"png-bytes")
    monkeypatch.setattr(public_web, "fetch_public_url", fake_fetch)
    sid = _image_server(client)
    client.put("/api/images/config", json={"server_id": sid, "model": "image-model"})
    r = client.post("/api/images/generate", json={"prompt": "a tree"})
    assert fetched == ["https://cdn.example.com/x.png"]
    assert r.json()["images"] == [base64.b64encode(b"png-bytes").decode()]


def test_endpoint_errors_are_passed_on_readably(monkeypatch, client):
    _mock_httpx(monkeypatch, images, lambda r: httpx.Response(400, json={"error": {"message": "size not supported"}}))
    sid = _image_server(client)
    client.put("/api/images/config", json={"server_id": sid, "model": "image-model"})
    r = client.post("/api/images/generate", json={"prompt": "a tree", "width": 777, "height": 777})
    assert r.status_code == 502 and "size not supported" in r.json()["detail"]
    r = client.post("/api/images/edit", json={"prompt": "x", "image": "data:image/gif;base64," + PNG})
    assert r.status_code == 400


# ── Chat: the CPU status line ───────────────────────────────────────────────────

def test_cpu_mode_tells_the_user_why_the_reply_is_slow(monkeypatch, client):
    from backend.services import knowledge, mcp_tool_agent

    async def context_length(model, host=None, port=None, timeout=5.0):
        return 8192

    seen_ctx = []

    async def chat_stream(*, model, messages, host, port, options=None, tools=None):
        seen_ctx.append(options.get("num_ctx"))
        yield {"token": "ok", "done": True}

    async def no_hits(*args, **kwargs):
        return []
    monkeypatch.setattr(ollama_client, "context_length", context_length)
    monkeypatch.setattr(ollama_client, "chat_stream", chat_stream)
    monkeypatch.setattr(knowledge, "search", no_hits)
    monkeypatch.setattr(machine, "_setting", "on")
    monkeypatch.setattr(machine, "_gpu_present", False)
    monkeypatch.setattr(machine, "load_setting", lambda db: asyncio.sleep(0, result="on"))
    with client.websocket_connect("/api/chat/ws") as ws:
        ws.send_json({"message": "please summarize the plan for chapter three", "persona": "doc", "model": "llama3.2"})
        msgs = []
        while not (msgs and msgs[-1].get("type") == "token" and msgs[-1].get("done")):
            msgs.append(ws.receive_json())
    labels = [m["label"] for m in msgs if m["type"] == "status"]
    assert any("this computer's CPU" in label for label in labels)
    assert seen_ctx == [machine.CPU_NUM_CTX]
