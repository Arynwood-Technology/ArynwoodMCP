"""
File system exploration API — lets the agent and UI browse and read local files.
All paths are resolved relative to the project root and sandboxed there.

A second set of endpoints (browse-home / save-image / mkdir) is sandboxed to the
user's home directory instead — used by the Design Center "save to folder" dialog.
"""
import base64
import os
import re
import sys
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from backend._frozen import app_base_dir

router = APIRouter()

# /tree, /read, /ls below are a "browse this app's own source tree" feature — real
# and useful in a dev checkout, meaningless in a packaged build (there's no project
# to browse, just the PyInstaller bundle's temp extraction dir). _safe_path() below
# refuses those three routes outright when frozen rather than silently resolving
# into that temp dir. browse-home/save-image/save-audio/mkdir further down are a
# separate, unrelated feature (Design Center's save-to-folder dialog, sandboxed to
# the user's home directory) and are unaffected — packaging doesn't touch them.
BASE_DIR = app_base_dir()

SKIP = {"__pycache__", "node_modules", "venv", ".venv", ".git",
        "dist", "build", ".cache", ".mypy_cache"}

MAX_FILE_BYTES = 256 * 1024  # 256 KB read cap


def _safe_path(rel: str) -> str:
    """Resolve a relative path inside BASE_DIR, rejecting traversal attempts."""
    if getattr(sys, "frozen", False):
        raise HTTPException(
            501,
            "Project file browsing isn't available in a packaged build — there's no "
            "source checkout to browse. Run from source for this feature; see "
            "docs/troubleshooting.md.",
        )
    resolved = os.path.realpath(os.path.join(BASE_DIR, rel))
    if not resolved.startswith(BASE_DIR):
        raise HTTPException(403, "Path outside project root")
    return resolved


def _tree(path: str, depth: int, max_depth: int) -> dict:
    """Recursively build a JSON directory tree, skipping hidden and vendor dirs."""
    name = os.path.basename(path) or path
    if os.path.isfile(path):
        return {"name": name, "type": "file", "size": os.path.getsize(path)}

    node: dict = {"name": name, "type": "dir", "children": []}
    if depth >= max_depth:
        return node
    try:
        entries = sorted(os.listdir(path))
    except PermissionError:
        return node
    for e in entries:
        if e.startswith(".") or e in SKIP:
            continue
        node["children"].append(_tree(os.path.join(path, e), depth + 1, max_depth))
    return node


@router.get("/tree")
async def fs_tree(
    path: str = Query(".", description="Relative path from project root"),
    depth: int = Query(2, ge=1, le=4),
):
    """Return a JSON directory tree up to `depth` levels deep."""
    real = _safe_path(path)
    if not os.path.exists(real):
        raise HTTPException(404, f"Path not found: {path}")
    return _tree(real, 0, depth)


@router.get("/read")
async def fs_read(
    path: str = Query(..., description="Relative path from project root"),
):
    """Return the text content of a file (max 256 KB)."""
    real = _safe_path(path)
    if not os.path.exists(real):
        raise HTTPException(404, f"File not found: {path}")
    if not os.path.isfile(real):
        raise HTTPException(400, "Path is a directory — use /tree")
    size = os.path.getsize(real)
    if size > MAX_FILE_BYTES:
        raise HTTPException(413, f"File too large ({size // 1024} KB). Max is 256 KB.")
    try:
        with open(real, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except Exception as e:
        raise HTTPException(500, f"Could not read file: {e}")
    return {"path": path, "size": size, "content": content}


@router.get("/ls")
async def fs_ls(
    path: str = Query(".", description="Relative path from project root"),
):
    """List immediate children of a directory with type + size."""
    real = _safe_path(path)
    if not os.path.isdir(real):
        raise HTTPException(400, "Not a directory")
    entries = []
    for e in sorted(os.listdir(real)):
        if e.startswith(".") or e in SKIP:
            continue
        full = os.path.join(real, e)
        entries.append({
            "name": e,
            "type": "dir" if os.path.isdir(full) else "file",
            "size": os.path.getsize(full) if os.path.isfile(full) else None,
        })
    return {"path": path, "entries": entries}


# ── Home-scoped endpoints (Design Center save dialog) ──────────────────────

HOME_DIR = os.path.realpath(os.path.expanduser("~"))

IMG_NAME_RE = re.compile(r"^[\w][\w .()\-]*\.(png|jpg|jpeg|webp)$", re.I)
AUDIO_NAME_RE = re.compile(r"^[\w][\w .()\-]*\.(wav|mp3|ogg|flac)$", re.I)

MAX_IMAGE_BYTES = 50 * 1024 * 1024  # 50 MB save cap
MAX_AUDIO_BYTES = 300 * 1024 * 1024  # 300 MB save cap (long voiceover takes)


def _home_path(p: str) -> str:
    """Resolve a path inside the user's home directory, rejecting traversal."""
    resolved = os.path.realpath(os.path.expanduser(p or "~"))
    if resolved != HOME_DIR and not resolved.startswith(HOME_DIR + os.sep):
        raise HTTPException(403, "Path outside home directory")
    return resolved


@router.get("/browse-home")
async def fs_browse_home(path: str = Query("~", description="Absolute path or ~ inside home")):
    """List subdirectories of a folder in the user's home (for the save dialog)."""
    real = _home_path(path)
    if not os.path.isdir(real):
        raise HTTPException(404, f"Not a directory: {path}")
    try:
        dirs = sorted(
            (e for e in os.listdir(real)
             if not e.startswith(".") and os.path.isdir(os.path.join(real, e))),
            key=str.lower,
        )
    except PermissionError:
        raise HTTPException(403, "Permission denied")
    return {
        "path": real,
        "parent": os.path.dirname(real) if real != HOME_DIR else None,
        "home": HOME_DIR,
        "dirs": dirs,
    }


class SaveImageBody(BaseModel):
    dir: str
    filename: str
    data: str  # data URL or raw base64


@router.post("/save-image")
async def fs_save_image(body: SaveImageBody):
    """Save a base64 image into a folder in the user's home. Auto-renames on conflict."""
    real_dir = _home_path(body.dir)
    os.makedirs(real_dir, exist_ok=True)
    name = body.filename.strip()
    if name != os.path.basename(name) or not IMG_NAME_RE.match(name):
        raise HTTPException(400, "Filename must be a plain name ending in .png/.jpg/.jpeg/.webp")
    data = body.data
    if data.startswith("data:") and "," in data:
        data = data.split(",", 1)[1]
    try:
        raw = base64.b64decode(data, validate=True)
    except Exception:
        raise HTTPException(400, "Invalid base64 image data")
    if not raw:
        raise HTTPException(400, "Empty image data")
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Image too large (max 50 MB)")
    target = os.path.join(real_dir, name)
    if os.path.exists(target):
        stem, ext = os.path.splitext(name)
        i = 1
        while os.path.exists(os.path.join(real_dir, f"{stem}-{i}{ext}")):
            i += 1
        target = os.path.join(real_dir, f"{stem}-{i}{ext}")
    try:
        with open(target, "wb") as f:
            f.write(raw)
    except OSError as e:
        raise HTTPException(500, f"Could not write file: {e}")
    return {"saved": target, "bytes": len(raw)}


class SaveAudioBody(BaseModel):
    dir: str
    filename: str
    data: str  # data URL or raw base64


@router.post("/save-audio")
async def fs_save_audio(body: SaveAudioBody):
    """Save a base64 audio clip into a folder in the user's home. Auto-renames on conflict."""
    real_dir = _home_path(body.dir)
    os.makedirs(real_dir, exist_ok=True)
    name = body.filename.strip()
    if name != os.path.basename(name) or not AUDIO_NAME_RE.match(name):
        raise HTTPException(400, "Filename must be a plain name ending in .wav/.mp3/.ogg/.flac")
    data = body.data
    if data.startswith("data:") and "," in data:
        data = data.split(",", 1)[1]
    try:
        raw = base64.b64decode(data, validate=True)
    except Exception:
        raise HTTPException(400, "Invalid base64 audio data")
    if not raw:
        raise HTTPException(400, "Empty audio data")
    if len(raw) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "Audio too large (max 300 MB)")
    target = os.path.join(real_dir, name)
    if os.path.exists(target):
        stem, ext = os.path.splitext(name)
        i = 1
        while os.path.exists(os.path.join(real_dir, f"{stem}-{i}{ext}")):
            i += 1
        target = os.path.join(real_dir, f"{stem}-{i}{ext}")
    try:
        with open(target, "wb") as f:
            f.write(raw)
    except OSError as e:
        raise HTTPException(500, f"Could not write file: {e}")
    return {"saved": target, "bytes": len(raw)}


class MkdirBody(BaseModel):
    parent: str
    name: str


@router.post("/mkdir")
async def fs_mkdir(body: MkdirBody):
    """Create a new subfolder inside a home-directory folder (save dialog)."""
    real_parent = _home_path(body.parent)
    if not os.path.isdir(real_parent):
        raise HTTPException(404, "Parent folder not found")
    name = body.name.strip()
    if not name or name != os.path.basename(name) or name.startswith("."):
        raise HTTPException(400, "Invalid folder name")
    target = os.path.join(real_parent, name)
    try:
        os.makedirs(target, exist_ok=True)
    except OSError as e:
        raise HTTPException(500, f"Could not create folder: {e}")
    return {"created": target}
