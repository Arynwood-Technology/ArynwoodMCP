import asyncio
import json
import subprocess
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
import httpx
from pydantic import BaseModel

router = APIRouter()


def ollama_url(server_host: str = "localhost", server_port: int = 11434) -> str:
    """Build the Ollama base URL from host and port."""
    return f"http://{server_host}:{server_port}"


class PullRequest(BaseModel):
    model: str
    server_host: str = "localhost"
    server_port: int = 11434


class DeleteRequest(BaseModel):
    model: str
    server_host: str = "localhost"
    server_port: int = 11434


async def check_ollama_reachable(host: str, port: int) -> bool:
    """Return True if the Ollama /api/tags endpoint responds successfully."""
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(f"http://{host}:{port}/api/tags", timeout=3.0)
            return 200 <= r.status_code < 300
    except Exception:
        return False


@router.get("/models")
async def list_models(
    host: str = Query("localhost"),
    port: int = Query(11434),
):
    """List all models available on an Ollama server."""
    base = ollama_url(host, port)
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(f"{base}/api/tags", timeout=5.0)
            if r.status_code == 200:
                return r.json()
            body = r.text[:300]
            raise HTTPException(
                status_code=502,
                detail=f"Ollama at {base} returned HTTP {r.status_code}: {body}",
            )
    except HTTPException:
        raise
    except httpx.ConnectError:
        raise HTTPException(status_code=502, detail=f"Cannot connect to Ollama at {base}")
    except httpx.TimeoutException:
        raise HTTPException(status_code=502, detail=f"Ollama at {base} timed out")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Ollama at {base}: {e}")


@router.get("/running")
async def list_running(
    host: str = Query("localhost"),
    port: int = Query(11434),
):
    """Return models currently loaded in memory via Ollama /api/ps."""
    base = ollama_url(host, port)
    async with httpx.AsyncClient() as client:
        try:
            r = await client.get(f"{base}/api/ps", timeout=5.0)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            raise HTTPException(status_code=502, detail=str(e))


class UnloadRequest(BaseModel):
    model: str
    server_host: str = "localhost"
    server_port: int = 11434


@router.post("/unload")
async def unload_model(req: UnloadRequest):
    """Evict a model from VRAM immediately, freeing memory for other GPU tools.

    keep_alive: 0 on a generate call is Ollama's documented mechanism for this —
    it unloads without running real inference (no prompt is sent).
    """
    base = ollama_url(req.server_host, req.server_port)
    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{base}/api/generate",
                json={"model": req.model, "keep_alive": 0},
                timeout=15.0,
            )
            r.raise_for_status()
            return {"status": "unloaded", "model": req.model}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/ping")
async def ping_ollama(
    host: str = Query("localhost"),
    port: int = Query(11434),
):
    """Check whether an Ollama server is online."""
    online = await check_ollama_reachable(host, port)
    return {"online": online, "host": host, "port": port}


@router.post("/start-local")
async def start_local_ollama():
    """Start ollama serve on localhost if it isn't already running."""
    if await check_ollama_reachable("localhost", 11434):
        return {"status": "already_running"}
    try:
        subprocess.Popen(
            ["ollama", "serve"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        # Wait up to 8 seconds for it to come up
        for _ in range(16):
            await asyncio.sleep(0.5)
            if await check_ollama_reachable("localhost", 11434):
                return {"status": "started"}
        return {"status": "timeout", "detail": "Ollama started but didn't respond in 8s"}
    except FileNotFoundError:
        raise HTTPException(404, "ollama binary not found in PATH")
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/pull")
async def pull_model(req: PullRequest):
    """Stream a model pull from an Ollama server, returning NDJSON progress lines."""
    base = ollama_url(req.server_host, req.server_port)

    # Check reachability first — fail fast instead of hanging
    if not await check_ollama_reachable(req.server_host, req.server_port):
        raise HTTPException(
            502,
            f"Ollama is not reachable at {req.server_host}:{req.server_port}. "
            "Start it first or choose a different server."
        )

    async def stream_pull():
        """Async generator that proxies Ollama's streaming pull response."""
        try:
            connect_timeout = httpx.Timeout(connect=10.0, read=None, write=60.0, pool=10.0)
            async with httpx.AsyncClient(timeout=connect_timeout) as client:
                async with client.stream(
                    "POST", f"{base}/api/pull",
                    json={"name": req.model, "stream": True}
                ) as r:
                    if r.status_code >= 400:
                        body = await r.aread()
                        yield json.dumps({"status": f"error: {r.status_code} {body.decode()[:200]}"}) + "\n"
                        return
                    async for chunk in r.aiter_lines():
                        if chunk:
                            yield chunk + "\n"
        except httpx.ConnectError as e:
            yield json.dumps({"status": f"error: Cannot connect to {req.server_host}:{req.server_port}"}) + "\n"
        except Exception as e:
            yield json.dumps({"status": f"error: {str(e)[:200]}"}) + "\n"

    return StreamingResponse(stream_pull(), media_type="text/plain")


@router.delete("/model")
async def delete_model(req: DeleteRequest):
    """Delete a model from an Ollama server."""
    base = ollama_url(req.server_host, req.server_port)
    async with httpx.AsyncClient() as client:
        try:
            r = await client.delete(f"{base}/api/delete", json={"name": req.model}, timeout=10.0)
            r.raise_for_status()
            return {"deleted": req.model}
        except Exception as e:
            raise HTTPException(status_code=502, detail=str(e))


@router.get("/show")
async def show_model(
    model: str = Query(...),
    host: str = Query("localhost"),
    port: int = Query(11434),
):
    """Return model metadata from Ollama /api/show."""
    base = ollama_url(host, port)
    async with httpx.AsyncClient() as client:
        try:
            r = await client.post(f"{base}/api/show", json={"name": model}, timeout=10.0)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            raise HTTPException(status_code=502, detail=str(e))
