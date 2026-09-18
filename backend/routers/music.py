"""
Music Lab router — DB-backed instrument generation, asset library, and job
tracking for the song-gen sidecar (ACE-Step / MusicGen).

Unlike studio.py's stateless sidecar proxy, this router persists durable state
(music_assets, music_generation_jobs — see backend/db.py) and coordinates GPU
access via the same gpu_queue/_free_sd_vram_for_job machinery tools.py/lora.py/
video.py already use, since ACE-Step is far more VRAM-hungry than the RVC/
Demucs sidecars studio.py proxies. Mirrors lora.py's pattern: a background
asyncio.create_task() runner that opens its own aiosqlite connection (via
_update_job/_create_asset) because it outlives the request-scoped `db` dependency.
"""

import asyncio
import json
import os
import uuid
from typing import Optional

import aiosqlite
import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from backend._frozen import user_data_dir
from backend.db import DB_PATH, get_db
from backend.routers.studio import _ping, _sidecar_url
from backend.services.gpu_jobs import _free_sd_vram_for_job, _restore_sd_vram_after_job, gpu_queue

router = APIRouter()

# User recordings and generated audio: must live in the writable data dir, not the
# bundle (a packaged build's bundle root is a temp dir wiped on every quit).
ASSETS_DIR = os.path.join(user_data_dir(), "music", "assets")
os.makedirs(ASSETS_DIR, exist_ok=True)

# Generous but bounded — generation here is turn-based, not real-time (see
# MusicStudio/CLAUDE.md's song-gen section), so a short instrument clip can
# take tens of seconds and an audio-conditioned Jam response can run 1-2 min.
_POLL_INTERVAL_SECONDS = 1.0
_MAX_POLL_ATTEMPTS = 600  # ~10 minutes


# ── DB helpers (mirrors lora.py's _db_update — background tasks can't reuse
# the request-scoped `db` dependency since it closes when the request returns) ──

async def _create_job(job_id: str, *, kind: str, provider: str, sidecar: str, params: dict):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO music_generation_jobs (id, kind, provider, sidecar, status, params_json) "
            "VALUES (?,?,?,?, 'queued', ?)",
            (job_id, kind, provider, sidecar, json.dumps(params)),
        )
        await db.commit()


async def _update_job(job_id: str, **fields):
    if not fields:
        return
    set_clause = ", ".join(f"{k}=?" for k in fields) + ", updated_at=datetime('now')"
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(f"UPDATE music_generation_jobs SET {set_clause} WHERE id=?",
                          [*fields.values(), job_id])
        await db.commit()


async def _create_asset(asset_id: str, **fields) -> dict:
    columns = ["id", *fields.keys()]
    placeholders = ",".join("?" for _ in columns)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            f"INSERT INTO music_assets ({','.join(columns)}) VALUES ({placeholders})",
            [asset_id, *fields.values()],
        )
        await db.commit()
    return {"id": asset_id, **fields}


async def _get_asset_or_404(db, asset_id: str) -> dict:
    async with db.execute("SELECT * FROM music_assets WHERE id=?", (asset_id,)) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Asset not found")
    return dict(row)


async def _get_job_or_404(db, job_id: str) -> dict:
    async with db.execute("SELECT * FROM music_generation_jobs WHERE id=?", (job_id,)) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Job not found")
    return dict(row)


async def _next_idea_label(instrument: Optional[str], provider: str) -> str:
    """Produces "Bass Idea 01", "Bass Idea 02", ... — counts existing generated
    assets for the same instrument so results read as a numbered take, not a UUID."""
    base = (instrument or provider or "Idea").strip().title()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT COUNT(*) AS n FROM music_assets WHERE kind='generated' AND instrument IS ?",
            (instrument,),
        ) as cur:
            row = await cur.fetchone()
    n = (row["n"] if row else 0) + 1
    return f"{base} Idea {n:02d}"


# ── Capabilities ─────────────────────────────────────────────────────────────

@router.get("/capabilities")
async def get_capabilities():
    """Merge song-gen's dynamically-probed provider capabilities with the
    already-working Demucs stem-separation facts, so the frontend can disable
    an uninstalled/unavailable provider rather than failing at generate time."""
    providers = []
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{_sidecar_url('song-gen')}/capabilities")
            r.raise_for_status()
            providers = r.json().get("providers", [])
    except Exception:
        pass  # song-gen sidecar not running — report no providers, not an error
    return {
        "providers": providers,
        "stems": {
            "provider": "demucs",
            "sidecar_status": await _ping("stem-sep"),
            "engines": ["demucs", "spleeter"],
            "stem_counts": [2, 4, 6],
        },
    }


# ── Instrument Generator ─────────────────────────────────────────────────────

@router.post("/generate")
async def generate(
    provider: str = Form(...),
    prompt: Optional[str] = Form(default=None),
    instrument: Optional[str] = Form(default=None),
    genre: Optional[str] = Form(default=None),
    style: Optional[str] = Form(default=None),
    mood: Optional[str] = Form(default=None),
    energy: Optional[str] = Form(default=None),
    complexity: Optional[str] = Form(default=None),
    bpm: Optional[float] = Form(default=None),
    key: Optional[str] = Form(default=None),
    duration_seconds: float = Form(default=15.0),
    mode: str = Form(default="generate"),
    seed: Optional[int] = Form(default=None),
    label: Optional[str] = Form(default=None),
    reference_audio: Optional[UploadFile] = File(default=None),
    melody_audio: Optional[UploadFile] = File(default=None),
):
    """POST /generate — Instrument Generator. Returns {job_id} immediately;
    poll GET /jobs/{job_id} for status, then find the result via GET /assets."""
    if provider not in ("acestep", "musicgen"):
        raise HTTPException(400, f"Unknown provider: {provider}")

    job_id = uuid.uuid4().hex
    params = {
        "prompt": prompt, "instrument": instrument, "genre": genre, "style": style,
        "mood": mood, "energy": energy, "complexity": complexity, "bpm": bpm, "key": key,
        "duration_seconds": duration_seconds, "mode": mode, "seed": seed,
    }
    await _create_job(job_id, kind="generate", provider=provider, sidecar="song-gen", params=params)

    resolved_label = label or await _next_idea_label(instrument, provider)
    reference_bytes = await reference_audio.read() if reference_audio else None
    reference_name = reference_audio.filename if reference_audio else None
    melody_bytes = await melody_audio.read() if melody_audio else None
    melody_name = melody_audio.filename if melody_audio else None

    asyncio.create_task(_run_generate(
        job_id, kind="generated", provider=provider, params=params, label=resolved_label,
        source_asset_id=None, reference_bytes=reference_bytes, reference_name=reference_name,
        melody_bytes=melody_bytes, melody_name=melody_name,
    ))
    return {"job_id": job_id}


@router.post("/assets/{asset_id}/regenerate")
async def regenerate_asset(asset_id: str, db=Depends(get_db)):
    """POST /assets/{id}/regenerate — re-submits the asset's stored params as a
    fresh job. Produces a new asset; never overwrites the original."""
    asset = await _get_asset_or_404(db, asset_id)
    if asset["kind"] not in ("generated", "jam_response"):
        raise HTTPException(400, "Only song-gen results (generated/jam_response assets) can be regenerated — "
                                  "stems and recordings aren't produced by a provider call.")
    if not asset.get("provider"):
        raise HTTPException(400, "Asset has no recorded provider/params to regenerate from")
    params = json.loads(asset["params_json"] or "{}")
    job_id = uuid.uuid4().hex
    await _create_job(job_id, kind="generate", provider=asset["provider"], sidecar="song-gen", params=params)
    asyncio.create_task(_run_generate(
        job_id, kind=asset["kind"], provider=asset["provider"], params=params,
        label=asset["label"], source_asset_id=asset.get("source_asset_id"),
        reference_bytes=None, reference_name=None, melody_bytes=None, melody_name=None,
    ))
    return {"job_id": job_id}


async def _run_generate(job_id: str, *, kind: str, provider: str, params: dict, label: str,
                         source_asset_id: Optional[str], reference_bytes: Optional[bytes],
                         reference_name: Optional[str], melody_bytes: Optional[bytes],
                         melody_name: Optional[str]):
    try:
        async with gpu_queue.acquire(job_id, priority=False):
            await _update_job(job_id, status="running")
            await _free_sd_vram_for_job()
            try:
                await _call_sidecar_generate(
                    job_id, kind=kind, provider=provider, params=params, label=label,
                    source_asset_id=source_asset_id, reference_bytes=reference_bytes,
                    reference_name=reference_name, melody_bytes=melody_bytes, melody_name=melody_name,
                )
            finally:
                await _restore_sd_vram_after_job()
        await _update_job(job_id, status="done", result_asset_id=job_id)
    except Exception as e:
        await _update_job(job_id, status="error", error=str(e))


async def _call_sidecar_generate(job_id: str, *, kind: str, provider: str, params: dict, label: str,
                                  source_asset_id: Optional[str], reference_bytes: Optional[bytes],
                                  reference_name: Optional[str], melody_bytes: Optional[bytes],
                                  melody_name: Optional[str]) -> None:
    base_url = _sidecar_url("song-gen")
    form = {k: str(v) for k, v in {**params, "provider": provider}.items() if v is not None}
    files = {}
    if reference_bytes:
        files["reference_audio"] = (reference_name or "reference.wav", reference_bytes)
    if melody_bytes:
        files["melody_audio"] = (melody_name or "melody.wav", melody_bytes)

    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(f"{base_url}/generate", data=form, files=files or None)
        r.raise_for_status()
        sidecar_job_id = r.json()["job_id"]

        for _ in range(_MAX_POLL_ATTEMPTS):
            r = await client.get(f"{base_url}/generate/{sidecar_job_id}")
            r.raise_for_status()
            sidecar_job = r.json()
            await _update_job(job_id, progress=sidecar_job.get("progress", 0))
            if sidecar_job["status"] == "completed":
                break
            if sidecar_job["status"] == "failed":
                raise RuntimeError(sidecar_job.get("error") or "Generation failed")
            await asyncio.sleep(_POLL_INTERVAL_SECONDS)
        else:
            raise RuntimeError("Generation timed out")

        result = await client.get(f"{base_url}/generate/{sidecar_job_id}/result")
        result.raise_for_status()

    dest_path = os.path.join(ASSETS_DIR, f"{job_id}.wav")
    with open(dest_path, "wb") as f:
        f.write(result.content)

    await _create_asset(
        job_id, kind=kind, provider=provider, source_asset_id=source_asset_id,
        label=label, instrument=params.get("instrument"), prompt=params.get("prompt"),
        params_json=json.dumps(params), file_path=dest_path,
        duration_seconds=params.get("duration_seconds"), bpm=params.get("bpm"),
        musical_key=params.get("key"), favorite=0, project_id=None,
    )


# ── Jam with AI ───────────────────────────────────────────────────────────────
# A separate endpoint from /generate (different required shape: an input audio
# is mandatory, not optional) matching how studio.py already keeps /stems and
# /voice/convert distinct rather than one do-everything endpoint. Reuses
# _run_generate/_call_sidecar_generate as-is via melody_audio conditioning —
# only providers with supports.melody_conditioning actually respond to the
# input; the frontend restricts provider choice accordingly, and this endpoint
# doesn't hard-block an unsupported choice (it just produces an unconditioned
# generation in that case, not a crash).

@router.post("/jam")
async def jam(
    provider: str = Form(...),
    role: str = Form(...),
    style: Optional[str] = Form(default=None),
    bpm: Optional[float] = Form(default=None),
    key: Optional[str] = Form(default=None),
    duration_seconds: float = Form(default=15.0),
    label: Optional[str] = Form(default=None),
    input_audio: Optional[UploadFile] = File(default=None),
    input_asset_id: Optional[str] = Form(default=None),
    db=Depends(get_db),
):
    """POST /jam — provide either a fresh input_audio upload or an existing
    input_asset_id. Returns {job_id, source_asset_id}. The AI's response is
    always a separate asset (kind='jam_response'), never merged with the input."""
    if provider not in ("acestep", "musicgen"):
        raise HTTPException(400, f"Unknown provider: {provider}")
    if not input_audio and not input_asset_id:
        raise HTTPException(400, "Provide input_audio (upload) or input_asset_id (an existing asset)")

    if input_audio:
        input_bytes = await input_audio.read()
        input_name = input_audio.filename or "jam_input.wav"
        recording_id = uuid.uuid4().hex
        ext = os.path.splitext(input_name)[1] or ".wav"
        recording_path = os.path.join(ASSETS_DIR, f"{recording_id}{ext}")
        with open(recording_path, "wb") as f:
            f.write(input_bytes)
        await _create_asset(
            recording_id, kind="recording", provider=None, source_asset_id=None,
            label=os.path.splitext(input_name)[0], instrument=None, prompt=None,
            params_json="{}", file_path=recording_path, duration_seconds=None,
            bpm=None, musical_key=None, favorite=0, project_id=None,
        )
        source_asset_id = recording_id
    else:
        asset = await _get_asset_or_404(db, input_asset_id)
        if not asset.get("file_path") or not os.path.isfile(asset["file_path"]):
            raise HTTPException(404, "Input asset audio not found")
        with open(asset["file_path"], "rb") as f:
            input_bytes = f.read()
        input_name = os.path.basename(asset["file_path"])
        source_asset_id = input_asset_id

    job_id = uuid.uuid4().hex
    params = {
        "instrument": role, "style": style, "bpm": bpm, "key": key,
        "duration_seconds": duration_seconds, "mode": "respond",
    }
    await _create_job(job_id, kind="jam", provider=provider, sidecar="song-gen", params=params)

    resolved_label = label or f"{role} response"
    asyncio.create_task(_run_generate(
        job_id, kind="jam_response", provider=provider, params=params, label=resolved_label,
        source_asset_id=source_asset_id, reference_bytes=None, reference_name=None,
        melody_bytes=input_bytes, melody_name=input_name,
    ))
    return {"job_id": job_id, "source_asset_id": source_asset_id}


# ── Jobs ──────────────────────────────────────────────────────────────────────

@router.get("/jobs")
async def list_jobs(db=Depends(get_db)):
    """GET /jobs — recent jobs (DB-backed, survives a backend restart, unlike
    tools.py's in-memory _jobs), annotated with gpu_queue position."""
    async with db.execute("SELECT * FROM music_generation_jobs ORDER BY created_at DESC LIMIT 100") as cur:
        rows = await cur.fetchall()
    return {
        "jobs": [{**dict(r), "queue_position": gpu_queue.queue_position(r["id"])} for r in rows],
        "gpu_queue_depth": gpu_queue.queue_depth(),
    }


@router.get("/jobs/{job_id}")
async def get_job(job_id: str, db=Depends(get_db)):
    job = await _get_job_or_404(db, job_id)
    job["queue_position"] = gpu_queue.queue_position(job_id)
    return job


# ── Asset library ─────────────────────────────────────────────────────────────

@router.get("/assets")
async def list_assets(kind: Optional[str] = None, instrument: Optional[str] = None,
                       favorite: Optional[bool] = None, project_id: Optional[int] = None,
                       source_asset_id: Optional[str] = None, db=Depends(get_db)):
    query = "SELECT * FROM music_assets WHERE 1=1"
    args: list = []
    if kind:
        query += " AND kind=?"
        args.append(kind)
    if instrument:
        query += " AND instrument=?"
        args.append(instrument)
    if favorite is not None:
        query += " AND favorite=?"
        args.append(1 if favorite else 0)
    if project_id is not None:
        query += " AND project_id=?"
        args.append(project_id)
    if source_asset_id is not None:
        query += " AND source_asset_id=?"
        args.append(source_asset_id)
    query += " ORDER BY created_at DESC"
    async with db.execute(query, args) as cur:
        rows = await cur.fetchall()
    return [dict(r) for r in rows]


class AssetUpdate(BaseModel):
    label: Optional[str] = None
    favorite: Optional[bool] = None


@router.patch("/assets/{asset_id}")
async def update_asset(asset_id: str, body: AssetUpdate, db=Depends(get_db)):
    await _get_asset_or_404(db, asset_id)
    fields: dict = {}
    if body.label is not None:
        fields["label"] = body.label
    if body.favorite is not None:
        fields["favorite"] = 1 if body.favorite else 0
    if fields:
        set_clause = ", ".join(f"{k}=?" for k in fields) + ", updated_at=datetime('now')"
        await db.execute(f"UPDATE music_assets SET {set_clause} WHERE id=?", [*fields.values(), asset_id])
        await db.commit()
    return await _get_asset_or_404(db, asset_id)


@router.delete("/assets/{asset_id}")
async def delete_asset(asset_id: str, db=Depends(get_db)):
    asset = await _get_asset_or_404(db, asset_id)
    if asset.get("file_path") and os.path.isfile(asset["file_path"]):
        os.remove(asset["file_path"])
    await db.execute("DELETE FROM music_assets WHERE id=?", (asset_id,))
    await db.commit()
    return {"deleted": asset_id}


@router.get("/assets/{asset_id}/audio")
async def get_asset_audio(asset_id: str, db=Depends(get_db)):
    asset = await _get_asset_or_404(db, asset_id)
    if not asset.get("file_path") or not os.path.isfile(asset["file_path"]):
        raise HTTPException(404, "Audio file not found")
    return FileResponse(asset["file_path"], media_type="audio/wav",
                         filename=f"{asset.get('label') or asset_id}.wav")


# ── Stem separation → asset library (Phase 3) ────────────────────────────────
# Wraps the same stem-sep sidecar call studio.py's POST /stems already uses,
# but additionally persists the upload and each resulting stem as music_assets
# so stems become reusable library entries instead of an ephemeral one-off
# result. /api/studio/stems and StemSeparator.tsx are untouched by this —
# this is a parallel, additive path, not a replacement.

@router.post("/stems")
async def separate_stems(
    audio: UploadFile = File(...),
    engine: str = Form("demucs"),
    stems: int = Form(4),
    label: Optional[str] = Form(default=None),
):
    """POST /stems — returns {job_id, source_asset_id} immediately. Poll
    GET /jobs/{job_id}, then find results via GET /assets?source_asset_id=..."""
    content = await audio.read()
    original_name = audio.filename or "upload.wav"
    base_label = label or os.path.splitext(original_name)[0]

    recording_id = uuid.uuid4().hex
    ext = os.path.splitext(original_name)[1] or ".wav"
    recording_path = os.path.join(ASSETS_DIR, f"{recording_id}{ext}")
    with open(recording_path, "wb") as f:
        f.write(content)
    await _create_asset(
        recording_id, kind="recording", provider=None, source_asset_id=None,
        label=base_label, instrument=None, prompt=None, params_json="{}",
        file_path=recording_path, duration_seconds=None, bpm=None,
        musical_key=None, favorite=0, project_id=None,
    )

    job_id = uuid.uuid4().hex
    params = {"engine": engine, "stems": stems, "source_asset_id": recording_id}
    await _create_job(job_id, kind="stem_separate", provider="demucs", sidecar="stem-sep", params=params)

    asyncio.create_task(_run_stem_separation(job_id, content, original_name, engine, stems, base_label, recording_id))
    return {"job_id": job_id, "source_asset_id": recording_id}


async def _run_stem_separation(job_id: str, content: bytes, filename: str, engine: str,
                                stems: int, base_label: str, recording_id: str):
    try:
        async with gpu_queue.acquire(job_id, priority=False):
            await _update_job(job_id, status="running")
            await _free_sd_vram_for_job()
            try:
                await _call_sidecar_stems(job_id, content, filename, engine, stems, base_label, recording_id)
            finally:
                await _restore_sd_vram_after_job()
        await _update_job(job_id, status="done")
    except Exception as e:
        await _update_job(job_id, status="error", error=str(e))


async def _call_sidecar_stems(job_id: str, content: bytes, filename: str, engine: str,
                               stems: int, base_label: str, recording_id: str) -> None:
    base_url = _sidecar_url("stem-sep")
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(
            f"{base_url}/separate",
            files={"audio": (filename, content, "audio/wav")},
            params={"engine": engine, "stems": stems},
        )
        r.raise_for_status()
        sidecar_job_id = r.json()["job_id"]

        sidecar_job: dict = {}
        for _ in range(_MAX_POLL_ATTEMPTS):
            r = await client.get(f"{base_url}/separate/{sidecar_job_id}")
            r.raise_for_status()
            sidecar_job = r.json()
            await _update_job(job_id, progress=sidecar_job.get("progress", 0))
            if sidecar_job["status"] == "completed":
                break
            if sidecar_job["status"] == "failed":
                raise RuntimeError(sidecar_job.get("error") or "Stem separation failed")
            await asyncio.sleep(_POLL_INTERVAL_SECONDS)
        else:
            raise RuntimeError("Stem separation timed out")

        stem_names: list = list(sidecar_job.get("stems", {}).keys())
        for stem_name in stem_names:
            result = await client.get(f"{base_url}/stem/{sidecar_job_id}/{stem_name}")
            result.raise_for_status()
            asset_id = uuid.uuid4().hex
            dest_path = os.path.join(ASSETS_DIR, f"{asset_id}.wav")
            with open(dest_path, "wb") as f:
                f.write(result.content)
            await _create_asset(
                asset_id, kind="stem", provider="demucs", source_asset_id=recording_id,
                label=f"{base_label} — {stem_name}", instrument=stem_name, prompt=None,
                params_json=json.dumps({"engine": engine, "stems": stems}), file_path=dest_path,
                duration_seconds=None, bpm=None, musical_key=None, favorite=0, project_id=None,
            )
