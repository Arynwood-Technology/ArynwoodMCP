"""
Unified model file listing beyond Ollama — SD checkpoints and LoRAs.

Ollama models already have a UI (ModelManager.tsx + /api/ollama). SD checkpoints
and LoRAs are managed entirely by hand today (drop a .safetensors in a directory,
add an entry to SD_CHECKPOINTS in tools.py if you want it selectable) - there's no
way to see what's actually installed or how much disk it's using without SSHing in.

Read-only for now (list + disk usage). Deliberately not doing delete/install here
yet - delete risks removing a checkpoint that's actively referenced by
SD_CHECKPOINTS in tools.py, and install means picking a download source (HF? civitai?
direct URL?) that's a real design decision, not a follow-on to this.
"""
import os

from fastapi import APIRouter

from backend.routers.lora import A1111_CHECKPOINTS_DIR
from backend.routers.tools import SD_CHECKPOINTS

router = APIRouter()

A1111_LORA_DIR = "/home/lorelei/services/a1111/data/models/Lora"


def _list_safetensor_dir(directory: str) -> list[dict]:
    if not os.path.isdir(directory):
        return []
    entries = []
    for name in sorted(os.listdir(directory)):
        path = os.path.join(directory, name)
        if not os.path.isfile(path):
            continue
        if not name.endswith((".safetensors", ".ckpt", ".pt")):
            continue
        stat = os.stat(path)
        entries.append({
            "filename": name,
            "size_bytes": stat.st_size,
            "modified_at": stat.st_mtime,
        })
    return entries


@router.get("/checkpoints")
async def list_checkpoints():
    """GET /api/models/checkpoints — SD checkpoint files on disk, cross-referenced
    against the style presets in tools.py's SD_CHECKPOINTS so the UI can flag
    files that exist but aren't wired to any style, or styles pointing at a
    missing file."""
    known_filenames = {cfg["checkpoint"] for cfg in SD_CHECKPOINTS.values()}
    files = _list_safetensor_dir(A1111_CHECKPOINTS_DIR)
    for f in files:
        f["known"] = f["filename"] in known_filenames
        f["style"] = next(
            (style for style, cfg in SD_CHECKPOINTS.items() if cfg["checkpoint"] == f["filename"]),
            None,
        )
    missing = [
        {"style": style, "filename": cfg["checkpoint"]}
        for style, cfg in SD_CHECKPOINTS.items()
        if cfg["checkpoint"] not in {f["filename"] for f in files}
    ]
    total_bytes = sum(f["size_bytes"] for f in files)
    return {"files": files, "missing_from_styles": missing, "total_bytes": total_bytes}


@router.get("/loras")
async def list_loras():
    """GET /api/models/loras — LoRA files in A1111's Lora directory."""
    files = _list_safetensor_dir(A1111_LORA_DIR)
    total_bytes = sum(f["size_bytes"] for f in files)
    return {"files": files, "total_bytes": total_bytes}
