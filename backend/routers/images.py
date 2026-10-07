"""Image generation through an endpoint: any OpenAI-compatible images API.

Design Center generates with local Stable Diffusion (A1111, tools.py) on a machine with an
NVIDIA GPU. This router is the other source: a server registered on the Servers page as
`openai-compatible`, plus an image model the owner names. Prompts, and for edits the source
image, are sent to that server. The token stays on the backend (providers.headers).

Config lives in settings["image_endpoint"] = {"server_id": int, "model": str}; absent means
local Stable Diffusion.
"""
import base64
import binascii
import json

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from backend.db import get_db
from backend.services import machine, providers, public_web

router = APIRouter()

CONFIG_SETTING = "image_endpoint"
REQUEST_TIMEOUT = 180.0
MAX_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024


class ImageConfig(BaseModel):
    server_id: int | None = None
    model: str | None = None


class GenerateRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)
    width: int = Field(default=1024, ge=64, le=4096)
    height: int = Field(default=1024, ge=64, le=4096)


class EditRequest(GenerateRequest):
    image: str = Field(min_length=1)     # base64, raw or as a data: URL


async def _load(db) -> dict | None:
    async with db.execute("SELECT value FROM settings WHERE key=?", (CONFIG_SETTING,)) as cur:
        row = await cur.fetchone()
    try:
        config = json.loads(row["value"]) if row else None
    except ValueError:
        return None
    return config if isinstance(config, dict) and config.get("server_id") and config.get("model") else None


async def _server(db, server_id: int) -> dict | None:
    async with db.execute("SELECT * FROM servers WHERE id=? AND enabled=1", (server_id,)) as cur:
        row = await cur.fetchone()
    return dict(row) if row else None


async def save_config(db, server_id: int | None, model: str | None) -> None:
    value = json.dumps({"server_id": server_id, "model": model}) if server_id and model else ""
    await db.execute(
        "INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (CONFIG_SETTING, value))
    await db.commit()


async def _endpoint(db) -> tuple[dict, str]:
    config = await _load(db)
    server = await _server(db, config["server_id"]) if config else None
    if not server:
        raise HTTPException(409, "No image endpoint is set. Add an OpenAI-compatible server on the Servers "
                                 "page, then choose it for images there.")
    return server, config["model"]


@router.get("/config")
async def get_config(db=Depends(get_db)):
    """GET /config — where Design Center's images come from: {source: endpoint|local, server, model,
    cpu_mode}. `local` means Stable Diffusion on this computer."""
    config = await _load(db)
    server = await _server(db, config["server_id"]) if config else None
    return {
        "source": "endpoint" if server else "local",
        "server": {"id": server["id"], "name": server["name"], "host": server["host"]} if server else None,
        "model": config["model"] if server else None,
        "cpu_mode": machine.enabled(),
    }


@router.put("/config")
async def put_config(body: ImageConfig, db=Depends(get_db)):
    """PUT /config — choose an OpenAI-compatible server and image model, or null for local SD."""
    if body.server_id is None:
        await save_config(db, None, None)
        return await get_config(db)
    server = await _server(db, body.server_id)
    if not server:
        raise HTTPException(404, "Server not found or disabled")
    if server["type"] != "openai-compatible":
        raise HTTPException(400, "Image endpoints use the OpenAI images API. Choose a server of type "
                                 "openai-compatible.")
    model = (body.model or "").strip()
    if not model:
        raise HTTPException(400, "Name the image model the server should use")
    await save_config(db, server["id"], model)
    return await get_config(db)


def _error_detail(response: httpx.Response) -> str:
    try:
        error = response.json().get("error")
        message = error.get("message") if isinstance(error, dict) else error
    except ValueError:
        message = None
    message = str(message or response.text or "").strip()[:300]
    return f"The image endpoint answered HTTP {response.status_code}" + (f": {message}" if message else "")


async def _images_from(response: httpx.Response) -> list[str]:
    if response.status_code != 200:
        raise HTTPException(502, _error_detail(response))
    images = []
    for item in response.json().get("data", []):
        if item.get("b64_json"):
            images.append(item["b64_json"])
        elif item.get("url"):
            # Some servers answer with a link instead. Fetch it as untrusted public content:
            # bounded size, public addresses only, no proxies.
            try:
                fetched = await public_web.fetch_public_url(item["url"])
            except Exception as e:
                raise HTTPException(502, f"Couldn't download the generated image: {e}")
            images.append(base64.b64encode(fetched.content).decode())
    if not images:
        raise HTTPException(502, "The image endpoint returned no images")
    return images


def _wants_format_param(model: str) -> bool:
    # gpt-image models always return base64 and reject response_format; most other servers
    # return a URL unless asked for b64_json.
    return not model.startswith("gpt-image")


@router.post("/generate")
async def generate(body: GenerateRequest, db=Depends(get_db)):
    """POST /generate — text to image. Returns {images: [base64 PNG], source: "endpoint"},
    the same shape as /api/tools/sd/generate."""
    server, model = await _endpoint(db)
    payload = {"model": model, "prompt": body.prompt, "n": 1, "size": f"{body.width}x{body.height}"}
    if _wants_format_param(model):
        payload["response_format"] = "b64_json"
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            r = await client.post(providers.endpoint(server, "images/generations"),
                                  json=payload, headers=providers.headers(server))
    except httpx.TimeoutException:
        raise HTTPException(504, "The image endpoint took too long to answer")
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Can't reach the image endpoint: {type(e).__name__}")
    return {"images": await _images_from(r), "source": "endpoint"}


@router.post("/edit")
async def edit(body: EditRequest, db=Depends(get_db)):
    """POST /edit — image + prompt to image (Design Center's image-to-image), through the
    endpoint's /images/edits. Sends the source image to that server."""
    server, model = await _endpoint(db)
    mime, raw = "image/png", body.image
    if body.image.startswith("data:"):
        header, _, raw = body.image.partition(",")
        mime = header[5:].split(";")[0] or mime
    if mime not in ("image/png", "image/jpeg", "image/webp"):
        raise HTTPException(400, "The source image must be PNG, JPEG or WebP")
    try:
        source = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(400, "The source image isn't valid base64")
    if len(source) > MAX_SOURCE_IMAGE_BYTES:
        raise HTTPException(413, "The source image is larger than 20 MB")
    data = {"model": model, "prompt": body.prompt, "n": "1", "size": f"{body.width}x{body.height}"}
    if _wants_format_param(model):
        data["response_format"] = "b64_json"
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            r = await client.post(providers.endpoint(server, "images/edits"), data=data,
                                  files={"image": ("image." + mime.split("/")[1], source, mime)},
                                  headers=providers.headers(server))
    except httpx.TimeoutException:
        raise HTTPException(504, "The image endpoint took too long to answer")
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Can't reach the image endpoint: {type(e).__name__}")
    return {"images": await _images_from(r), "source": "endpoint"}
