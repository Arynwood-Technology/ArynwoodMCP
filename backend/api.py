import os
from contextlib import asynccontextmanager
from fastapi import FastAPI

from backend._frozen import app_base_dir, user_data_dir

# Load .env from the repo root (source checkout) or the XDG user data dir (packaged
# build — there's no "repo root" once bundled, and it may not be writable anyway) so
# API credentials are available even when the launcher doesn't source the file itself.
_env_file = os.path.join(user_data_dir(), ".env")
if os.path.exists(_env_file):
    with open(_env_file) as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _v = _line.split("=", 1)
                os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from prometheus_fastapi_instrumentator import Instrumentator

import asyncio
import logging

from backend.db import init_db, DB_PATH
from backend.services.auth import ApiKeyMiddleware
from backend.services import memory_index
from backend.routers import chat, ollama, servers, tools, system, deploy, fs, memory, mcp_proxy, mcp_codebase, knowledge, studio, social, lora, video, models, music, dj, projects

logger = logging.getLogger(__name__)


async def _backfill_memory_index():
    """Re-embed every arynwood_memory row into memory_index's Qdrant collection on
    startup (see roadmap 1.1) — fired in the background so a slow-to-warm-up or
    unreachable Ollama/Qdrant never delays the API becoming available; a failure
    here just means memory retrieval falls back to recency until it's fixed."""
    import aiosqlite
    try:
        db = await aiosqlite.connect(DB_PATH)
        db.row_factory = aiosqlite.Row
        try:
            count = await memory_index.backfill_all(db)
            logger.info("memory_index backfill: indexed %d memories", count)
        finally:
            await db.close()
    except Exception:
        logger.exception("memory_index backfill failed (non-fatal)")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    asyncio.create_task(_backfill_memory_index())
    yield
    studio.stop_all_sidecars()


app = FastAPI(title="Arynwood MCP", version="0.4.2", lifespan=lifespan)
Instrumentator().instrument(app).expose(app, endpoint="/metrics")

# No endpoint under /api/* set any Cache-Control header, which left every dynamic
# response (persona list, LoRA list, tool list, etc.) eligible for WebKitGTK's
# heuristic HTTP caching — confirmed as a real cause of packaged-app bugs, not just a
# theoretical one: WebKitCache/ (the packaged app's persistent on-disk cache,
# ~/.local/share/com.arynwood.mcp/WebKitCache) had accumulated stale responses from
# earlier in this app's debugging, and kept serving them across app relaunches even
# after the backend itself was already returning correct, current data — so a
# backend-side fix alone wasn't enough; both the header (this) and the actual stale
# cache had to be cleared. /html-tools below already had its own explicit no-cache
# headers for a similar iframe-reload reason; this generalizes the same protection to
# every /api/* response instead of leaving it to be rediscovered endpoint by endpoint.
@app.middleware("http")
async def _no_cache_api_responses(request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response

app.add_middleware(ApiKeyMiddleware)  # no-op unless ARYNWOOD_API_KEY is set — see backend/services/auth.py

# Wildcard allow_origins is a real risk with auth opt-in/off by default (see
# ApiKeyMiddleware above): any website's JS, running in a browser tab on this same
# machine, can otherwise read responses from this API — filesystem, deploy/SFTP,
# chat/memory — purely because the victim's own browser can reach localhost,
# regardless of the backend's bind address (see CLAUDE.md's network-binding note;
# loopback binding doesn't stop this class of attack). Narrowed to the origins a
# browser actually loads this app's frontend from.
#
# An exact single guess at the packaged Tauri webview's origin (`http://tauri.localhost`,
# based on a misread of the tauri crate's own source) broke the real packaged app on a
# real machine — curl testing with that Origin header "confirmed" it, but curl doesn't
# enforce CORS the way an actual browser does, so that test never proved the real
# webview sends exactly that string; the actual fetches were being silently blocked
# client-side (empty persona list, empty tool list — every /api/* call failing the
# same way, not a backend problem, since the same backend answered curl fine).
#
# Root cause (confirmed via live capture: every single /api/* OPTIONS preflight came
# back 400, with zero exceptions across every router — a categorical mismatch, not an
# edge case) traced to tauri-2.10.3/src/app.rs's own doc comment on its custom-protocol
# origin format: "macOS, iOS and Linux: <scheme_name>://localhost/<path>" versus
# "Windows and Android: http://<scheme_name>.localhost/<path>" — the http(s) remap only
# happens on Windows/Android because WebView2 can't navigate a non-http(s) scheme.
# Tauri's built-in scheme name is "tauri", so on this Linux build the webview's real
# Origin is `tauri://localhost` — a scheme our old `https?://` regex could never match,
# hence the 100% failure rate. allow_origin_regex still covers the realistic http(s)
# dev-server variants (scheme, optional port); tauri://localhost is added as an exact
# origin since it's a fixed non-http(s) string, not something a regex needs to vary.
# ARYNWOOD_API_KEY remains what actually gates LAN/remote exposure once
# ARYNWOOD_BIND_HOST is opened up, not this list.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5180", "tauri://localhost", "null"],
    allow_origin_regex=r"https?://(tauri\.localhost|localhost:5180)(:\d+)?",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(system.router, prefix="/api/system", tags=["system"])
app.include_router(ollama.router, prefix="/api/ollama", tags=["ollama"])
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(servers.router, prefix="/api/servers", tags=["servers"])
app.include_router(tools.router, prefix="/api/tools", tags=["tools"])
app.include_router(deploy.router, prefix="/api/deploy", tags=["deploy"])
app.include_router(fs.router, prefix="/api/fs", tags=["fs"])
app.include_router(memory.router, prefix="/api/memory", tags=["memory"])
app.include_router(mcp_proxy.router, prefix="/api/mcp", tags=["mcp"])
# Opt-in developer feature: search/read/run-tests/apply-patch over this app's own source tree.
# The endpoint itself can't tell an approved call from a raw request (approval lives in the chat
# tool loop), so it is off unless ARYNWOOD_ENABLE_CODEBASE_TOOLS=1 — and inert when packaged.
if os.environ.get("ARYNWOOD_ENABLE_CODEBASE_TOOLS") == "1":
    app.include_router(mcp_codebase.router, prefix="/api/mcp-codebase", tags=["mcp-codebase"])
app.include_router(knowledge.router, prefix="/api/knowledge", tags=["knowledge"])
app.include_router(studio.router,   prefix="/api/studio",    tags=["studio"])
app.include_router(social.router,   prefix="/api/social",    tags=["social"])
app.include_router(lora.router,     prefix="/api/lora",      tags=["lora"])
app.include_router(video.router,    prefix="/api/video",     tags=["video"])
app.include_router(models.router,   prefix="/api/models",    tags=["models"])
app.include_router(music.router,    prefix="/api/music",     tags=["music"])
app.include_router(dj.router,       prefix="/api/dj",        tags=["dj"])
app.include_router(projects.router, prefix="/api/projects",  tags=["projects"])


_SOCIAL_MEDIA_DIR = os.path.join(user_data_dir(), "static", "social-media")
os.makedirs(_SOCIAL_MEDIA_DIR, exist_ok=True)
app.mount("/social-media", StaticFiles(directory=_SOCIAL_MEDIA_DIR), name="social-media")

_HTML_TOOLS_DIR = os.path.join(app_base_dir(), "static", "html-tools")
if os.path.isdir(_HTML_TOOLS_DIR):
    from fastapi import Request
    from fastapi.responses import FileResponse
    import os as _os

    @app.get("/html-tools/{filename:path}")
    async def serve_html_tool(filename: str, request: Request):
        path = _os.path.join(_HTML_TOOLS_DIR, filename)
        if not _os.path.isfile(path):
            from fastapi import HTTPException
            raise HTTPException(status_code=404)
        resp = FileResponse(path)
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        resp.headers["Pragma"] = "no-cache"
        resp.headers["Expires"] = "0"
        return resp


@app.get("/")
async def root():
    return {"status": "Arynwood MCP running"}
