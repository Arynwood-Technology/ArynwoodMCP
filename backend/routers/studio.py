"""
Studio router — manages MusicStudio sidecars and proxies requests to them.

Sidecars (from the sibling MusicStudio repo's sidecars/, see external_paths.MUSICSTUDIO_DIR):
  voice    → :8001  (RVC voice conversion, Python 3.11 venv)
  audio-fx → :8002  (Pedalboard effects, Matchering, Basic Pitch)
  song-gen → :8003  (ACE-Step / MusicGen instrument generation, Python 3.11 venv)
  stem-sep → :8004  (Demucs / Spleeter stem separation)
  video-ai → :8005  (faster-whisper captions)

song-gen is lifecycle-managed here (start/stop/health, same as the others) but
its actual generate/job endpoints are proxied from backend/routers/music.py,
not this file — that work is DB-backed (music_assets/music_generation_jobs)
and GPU-queue-coordinated, unlike this router's stateless proxy pattern.
"""

import asyncio
import os
import subprocess
from typing import Literal

import httpx
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import Response, StreamingResponse

from backend import external_paths

router = APIRouter()

MUSICSTUDIO_DIR = external_paths.MUSICSTUDIO_DIR

SIDECARS: dict[str, dict] = {
    "voice": {
        "port": 8001,
        "script": "sidecars/voice/main.py",
        "venv": "sidecars/voice/venv/bin/python",
        "label": "Voice Conversion (RVC)",
    },
    "audio-fx": {
        "port": 8002,
        "script": "sidecars/audio-fx/main.py",
        "venv": "sidecars/audio-fx/venv/bin/python",
        "label": "Audio FX & Analysis",
    },
    "song-gen": {
        "port": 8003,
        "script": "sidecars/song-gen/main.py",
        "venv": "sidecars/song-gen/venv/bin/python",
        "label": "Song Generation (ACE-Step/MusicGen)",
    },
    "stem-sep": {
        "port": 8004,
        "script": "sidecars/stem-sep/main.py",
        "venv": "sidecars/stem-sep/venv/bin/python",
        "label": "Stem Separation",
    },
    "video-ai": {
        "port": 8005,
        "script": "sidecars/video-ai/main.py",
        "venv": "sidecars/video-ai/venv/bin/python",
        "label": "Video AI (Whisper)",
    },
}

# Running subprocess handles
_procs: dict[str, subprocess.Popen] = {}


def _sidecar_url(sidecar_id: str) -> str:
    """Return the localhost base URL for a named sidecar process."""
    port = SIDECARS[sidecar_id]["port"]
    return f"http://127.0.0.1:{port}"


async def _ping(sidecar_id: str) -> str:
    """Return 'running', 'starting', or 'stopped' for a sidecar by hitting its /health endpoint."""
    url = _sidecar_url(sidecar_id)
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            r = await client.get(f"{url}/health")
            if r.status_code == 200:
                return "running"
    except Exception:
        pass
    # Check if we launched it (may still be starting)
    proc = _procs.get(sidecar_id)
    if proc and proc.poll() is None:
        return "starting"
    return "stopped"


# ── Sidecar management ────────────────────────────────────────────────────────

@router.get("/sidecars")
async def get_sidecars():
    """GET /sidecars — return status of all MusicStudio sidecar processes."""
    results = {}
    for sid, cfg in SIDECARS.items():
        status = await _ping(sid)
        results[sid] = {"id": sid, "label": cfg["label"], "port": cfg["port"], "status": status}
    return results


@router.post("/sidecars/{sidecar_id}/start")
async def start_sidecar(sidecar_id: str):
    """POST /sidecars/{id}/start — launch a sidecar subprocess from its MusicStudio venv."""
    if sidecar_id not in SIDECARS:
        raise HTTPException(404, "Unknown sidecar")

    # Already running
    if await _ping(sidecar_id) == "running":
        return {"status": "already_running"}

    cfg = SIDECARS[sidecar_id]
    python = os.path.join(MUSICSTUDIO_DIR, cfg["venv"])
    script = os.path.join(MUSICSTUDIO_DIR, cfg["script"])

    if not os.path.exists(python):
        raise HTTPException(500, f"Sidecar venv not found: {python}. Run setup per MusicStudio CLAUDE.md.")
    if not os.path.exists(script):
        raise HTTPException(500, f"Sidecar script not found: {script}")

    env = os.environ.copy()
    env["PORT"] = str(cfg["port"])
    proc = subprocess.Popen(
        [python, script],
        cwd=MUSICSTUDIO_DIR,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    _procs[sidecar_id] = proc
    return {"status": "starting", "pid": proc.pid}


@router.post("/sidecars/{sidecar_id}/stop")
async def stop_sidecar(sidecar_id: str):
    """POST /sidecars/{id}/stop — terminate a running sidecar process."""
    if sidecar_id not in SIDECARS:
        raise HTTPException(404, "Unknown sidecar")
    proc = _procs.pop(sidecar_id, None)
    if proc and proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
    return {"status": "stopped"}


# ── Stem Separation (:8004) ───────────────────────────────────────────────────

@router.post("/stems")
async def start_stem_separation(
    audio: UploadFile = File(...),
    engine: str = Form("demucs"),
    stems: int = Form(4),
):
    """POST /stems — submit an audio file for stem separation; returns a job ID."""
    content = await audio.read()
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(
                f"{_sidecar_url('stem-sep')}/separate",
                files={"audio": (audio.filename or "audio.wav", content, audio.content_type or "audio/wav")},
                params={"engine": engine, "stems": stems},
            )
        r.raise_for_status()
        return r.json()
    except httpx.ConnectError:
        raise HTTPException(503, "Stem separation sidecar is not running. Start it from the Studio page.")
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, e.response.text)


@router.get("/stems/{job_id}")
async def poll_stem_job(job_id: str):
    """GET /stems/{job_id} — poll the status of a stem separation job."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(f"{_sidecar_url('stem-sep')}/separate/{job_id}")
        r.raise_for_status()
        return r.json()
    except httpx.ConnectError:
        raise HTTPException(503, "Stem separation sidecar is not running.")


@router.get("/stems/{job_id}/{stem_name}")
async def download_stem(job_id: str, stem_name: str):
    """GET /stems/{job_id}/{stem_name} — download a completed stem as a WAV file."""
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.get(f"{_sidecar_url('stem-sep')}/stem/{job_id}/{stem_name}")
        r.raise_for_status()
        return Response(
            content=r.content,
            media_type="audio/wav",
            headers={"Content-Disposition": f'attachment; filename="{stem_name}.wav"'},
        )
    except httpx.ConnectError:
        raise HTTPException(503, "Stem separation sidecar is not running.")


# ── Voice Conversion (:8001) ──────────────────────────────────────────────────

@router.get("/voice/status")
async def voice_status():
    """GET /voice/status — return RVC voice sidecar status and loaded model."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{_sidecar_url('voice')}/status")
        return r.json()
    except httpx.ConnectError:
        raise HTTPException(503, "Voice sidecar is not running.")


@router.get("/voice/models")
async def list_voice_models():
    """GET /voice/models — list available RVC voice conversion models."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{_sidecar_url('voice')}/models")
        return r.json()
    except httpx.ConnectError:
        raise HTTPException(503, "Voice sidecar is not running.")


@router.delete("/voice/models/{name}")
async def delete_voice_model(name: str):
    """DELETE /voice/models/{name} — remove a voice model from the sidecar."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.delete(f"{_sidecar_url('voice')}/models/{name}")
        return r.json()
    except httpx.ConnectError:
        raise HTTPException(503, "Voice sidecar is not running.")


@router.post("/voice/models/import")
async def import_voice_model(
    name: str = Form(...),
    pth: UploadFile = File(...),
    index: UploadFile = File(None),
):
    """Accept .pth (+ optional .index) upload, save to MusicStudio models dir, then register with sidecar."""
    from pathlib import Path as _Path
    models_dir = _Path.home() / ".local/share/musicstudio/models" / name
    models_dir.mkdir(parents=True, exist_ok=True)

    pth_path = models_dir / f"{name}.pth"
    pth_path.write_bytes(await pth.read())

    index_path = None
    if index and index.filename:
        index_path = models_dir / f"{name}.index"
        index_path.write_bytes(await index.read())

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            payload = {"name": name, "pth_path": str(pth_path)}
            if index_path:
                payload["index_path"] = str(index_path)
            r = await client.post(f"{_sidecar_url('voice')}/models/import", json=payload)
        r.raise_for_status()
        return r.json()
    except httpx.ConnectError:
        raise HTTPException(503, "Voice sidecar is not running.")


@router.post("/voice/convert")
async def start_voice_convert(
    audio: UploadFile = File(...),
    model_name: str = Form(...),
    pitch_shift: int = Form(0),
    index_rate: float = Form(0.5),
):
    """POST /voice/convert — submit audio for RVC voice conversion; returns a job ID."""
    content = await audio.read()
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(
                f"{_sidecar_url('voice')}/convert",
                files={"audio": (audio.filename or "audio.wav", content, audio.content_type or "audio/wav")},
                data={"model_name": model_name, "pitch_shift": str(pitch_shift), "index_rate": str(index_rate)},
            )
        r.raise_for_status()
        return r.json()
    except httpx.ConnectError:
        raise HTTPException(503, "Voice sidecar is not running.")


@router.get("/voice/convert/{job_id}")
async def poll_voice_job(job_id: str):
    """GET /voice/convert/{job_id} — poll the status of a voice conversion job."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(f"{_sidecar_url('voice')}/convert/{job_id}")
        return r.json()
    except httpx.ConnectError:
        raise HTTPException(503, "Voice sidecar is not running.")


@router.get("/voice/convert/{job_id}/result")
async def download_voice_result(job_id: str):
    """GET /voice/convert/{job_id}/result — download the converted audio as a WAV file."""
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.get(f"{_sidecar_url('voice')}/convert/{job_id}/result")
        r.raise_for_status()
        return Response(
            content=r.content,
            media_type="audio/wav",
            headers={"Content-Disposition": 'attachment; filename="converted.wav"'},
        )
    except httpx.ConnectError:
        raise HTTPException(503, "Voice sidecar is not running.")


# ── Effects / Analysis (:8002) ────────────────────────────────────────────────

@router.post("/effects/chain")
async def apply_effects_chain(
    audio: UploadFile = File(...),
    effects: str = Form("[]"),
):
    """POST /effects/chain — apply a JSON-encoded Pedalboard effects chain to an audio file."""
    content = await audio.read()
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.post(
                f"{_sidecar_url('audio-fx')}/fx/chain",
                files={"audio": (audio.filename or "audio.wav", content, audio.content_type or "audio/wav")},
                data={"effects": effects},
            )
        r.raise_for_status()
        return Response(content=r.content, media_type="audio/wav",
                        headers={"Content-Disposition": 'attachment; filename="processed.wav"'})
    except httpx.ConnectError:
        raise HTTPException(503, "Audio FX sidecar is not running.")


@router.post("/effects/master")
async def reference_master(
    target: UploadFile = File(...),
    reference: UploadFile = File(...),
):
    """POST /effects/master — master a target audio track to match the loudness/EQ of a reference track."""
    tc = await target.read()
    rc = await reference.read()
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            r = await client.post(
                f"{_sidecar_url('audio-fx')}/master",
                files={
                    "target": (target.filename or "target.wav", tc, "audio/wav"),
                    "reference": (reference.filename or "reference.wav", rc, "audio/wav"),
                },
            )
        r.raise_for_status()
        return Response(content=r.content, media_type="audio/wav",
                        headers={"Content-Disposition": 'attachment; filename="mastered.wav"'})
    except httpx.ConnectError:
        raise HTTPException(503, "Audio FX sidecar is not running.")
