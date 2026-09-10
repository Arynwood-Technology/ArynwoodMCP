import asyncio
import glob
import json
import os
import re
import shutil
import signal
import sys
from typing import Literal, Optional

import aiosqlite
import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from backend.db import DB_PATH, get_db
from backend.routers.tools import (
    A1111_CONTAINER,
    SD_BASE,
    SD_CHECKPOINTS,
    _free_sd_vram_for_job,
    gpu_queue,
    _restore_sd_vram_after_job,
    run_florence2,
)

router = APIRouter()

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
KOHYA_SS_DIR = "/home/lorelei/tools/kohya_ss"
A1111_CHECKPOINTS_DIR = "/home/lorelei/services/a1111/data/models/Stable-diffusion"
# A1111 runs in A1111_CONTAINER (see tools.py) as root with no UID remapping, so its
# bind-mounted ./data/models/Lora (host: /home/lorelei/services/a1111/data/models/Lora) is
# root:root on the host — this process (running as the regular user) can't write or delete
# there directly. Go through `docker cp`/`docker exec` instead, which the docker daemon
# (running as root) can do regardless of our own filesystem permissions.
PREP_SCRIPT = os.path.join(BASE_DIR, "scripts", "prepare_lora_dataset.py")
TRAIN_SCRIPT = os.path.join(BASE_DIR, "scripts", "run_lora_training.py")

UPLOAD_EXTS = (".png", ".jpg", ".jpeg", ".webp")

# kohya's tqdm progress bar ("steps:  12%|#1        | 195/1600 [...,  avr_loss=0.0823]")
# and its plain `accelerator.print(f"epoch {n}/{total}")` lines are what we parse for
# live progress. Both come back on the wire as raw text, not JSON.
STEP_RE = re.compile(r"steps:\s*\d+%\|.*?\|\s*(\d+)/(\d+)\s*\[.*?,\s*avr_loss=([\d.]+)")
EPOCH_RE = re.compile(r"epoch (\d+)/(\d+)")

# Keyed by project id (not a random job id) since only one job runs per project at a time.
_jobs: dict[int, dict] = {}


class ProjectCreate(BaseModel):
    name: str
    trigger_word: str
    repeats: int = 10
    resolution: int = 1024
    source_dir: Optional[str] = None


class PrepRequest(BaseModel):
    dry_run: bool = False
    device: Literal["cpu", "cuda"] = "cpu"


class TrainRequest(BaseModel):
    base_model_path: str
    network_dim: int = 32
    network_alpha: int = 16
    learning_rate: float = 1e-4
    max_train_epochs: int = 10
    train_batch_size: int = 1


class CaptionUpdate(BaseModel):
    caption: str


class PhotoRename(BaseModel):
    new_name: str


_UNSAFE_NAME_CHARS = re.compile(r"[^A-Za-z0-9._ -]+")


def _default_source_dir(trigger_word: str) -> str:
    return os.path.join(KOHYA_SS_DIR, "dataset", "source", trigger_word)


def _default_dataset_root(trigger_word: str) -> str:
    return os.path.join(KOHYA_SS_DIR, "dataset", "images", trigger_word)


def _default_output_dir(project_id: int, trigger_word: str) -> str:
    return os.path.join(KOHYA_SS_DIR, "dataset", "outputs", f"{project_id}_{trigger_word}")


def _resolve_in_dir(base_dir: str, filename: str) -> str:
    """Join filename onto base_dir and refuse anything that escapes it."""
    safe_name = os.path.basename(filename)
    path = os.path.realpath(os.path.join(base_dir, safe_name))
    if not path.startswith(os.path.realpath(base_dir) + os.sep):
        raise HTTPException(400, "Invalid filename")
    return path


async def _get_project_or_404(db, project_id: int) -> dict:
    async with db.execute("SELECT * FROM lora_projects WHERE id=?", (project_id,)) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Project not found")
    return dict(row)


def _count_images(dir_path: Optional[str]) -> int:
    if not dir_path or not os.path.isdir(dir_path):
        return 0
    return len([p for p in os.listdir(dir_path) if os.path.splitext(p)[1].lower() in UPLOAD_EXTS])


def _with_image_count(project: dict) -> dict:
    project["source_image_count"] = _count_images(project.get("source_dir"))
    return project


async def _db_update(project_id: int, **fields):
    """Small helper used only from background tasks, which can't reuse the
    request-scoped `db` dependency since it closes when the request returns."""
    if not fields:
        return
    set_clause = ", ".join(f"{k}=?" for k in fields) + ", updated_at=datetime('now')"
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(f"UPDATE lora_projects SET {set_clause} WHERE id=?",
                          [*fields.values(), project_id])
        await db.commit()


@router.get("/projects")
async def list_projects(db=Depends(get_db)):
    """GET /projects — list all LoRA training projects, newest first."""
    async with db.execute("SELECT * FROM lora_projects ORDER BY created_at DESC") as cur:
        rows = await cur.fetchall()
    return [_with_image_count(dict(r)) for r in rows]


@router.post("/projects")
async def create_project(body: ProjectCreate, db=Depends(get_db)):
    """POST /projects — create a project, either against a fresh upload folder or an existing one on disk."""
    trigger = body.trigger_word.strip()
    if not trigger:
        raise HTTPException(400, "trigger_word is required")

    if body.source_dir:
        source_dir = os.path.expanduser(body.source_dir)
        if not os.path.isdir(source_dir):
            raise HTTPException(400, f"Folder does not exist: {source_dir}")
    else:
        source_dir = _default_source_dir(trigger)
        os.makedirs(source_dir, exist_ok=True)

    cur = await db.execute(
        "INSERT INTO lora_projects (name, trigger_word, repeats, resolution, source_dir, status) "
        "VALUES (?,?,?,?,?, 'draft')",
        (body.name, trigger, body.repeats, body.resolution, source_dir),
    )
    await db.commit()
    async with db.execute("SELECT * FROM lora_projects WHERE id=?", (cur.lastrowid,)) as c2:
        row = await c2.fetchone()
    return dict(row)


@router.post("/projects/{project_id}/upload")
async def upload_photos(project_id: int, files: list[UploadFile] = File(...), db=Depends(get_db)):
    """POST /projects/{id}/upload — add photos into the project's source folder."""
    project = await _get_project_or_404(db, project_id)
    source_dir = project["source_dir"]
    os.makedirs(source_dir, exist_ok=True)

    saved = []
    for f in files:
        ext = os.path.splitext(f.filename or "")[1].lower()
        if ext not in UPLOAD_EXTS:
            continue
        name = os.path.basename(f.filename)
        base, extn = os.path.splitext(name)
        dest_path = os.path.join(source_dir, name)
        n = 1
        while os.path.exists(dest_path):
            n += 1
            dest_path = os.path.join(source_dir, f"{base}_{n}{extn}")
        content = await f.read()
        with open(dest_path, "wb") as out:
            out.write(content)
        saved.append(os.path.basename(dest_path))

    image_count = len([p for p in os.listdir(source_dir) if os.path.splitext(p)[1].lower() in UPLOAD_EXTS])
    return {"saved": saved, "image_count": image_count}


@router.get("/projects/{project_id}/photos")
async def list_photos(project_id: int, db=Depends(get_db)):
    """GET /projects/{id}/photos — every raw source photo uploaded so far, for review/cleanup
    before dataset prep (dedup, rename) rather than after."""
    project = await _get_project_or_404(db, project_id)
    source_dir = project.get("source_dir")
    if not source_dir or not os.path.isdir(source_dir):
        return []
    return [
        {"filename": name, "image_url": f"/api/lora/projects/{project_id}/source-images/{name}"}
        for name in sorted(os.listdir(source_dir))
        if os.path.splitext(name)[1].lower() in UPLOAD_EXTS
    ]


@router.get("/projects/{project_id}/source-images/{filename}")
async def get_source_image(project_id: int, filename: str, db=Depends(get_db)):
    """GET /projects/{id}/source-images/{filename} — serve a raw source photo for thumbnails."""
    project = await _get_project_or_404(db, project_id)
    source_dir = project.get("source_dir")
    if not source_dir:
        raise HTTPException(404, "No source directory")
    path = _resolve_in_dir(source_dir, filename)
    if not os.path.isfile(path):
        raise HTTPException(404, "Image not found")
    return FileResponse(path)


@router.delete("/projects/{project_id}/photos/{filename}")
async def delete_photo(project_id: int, filename: str, db=Depends(get_db)):
    """DELETE /projects/{id}/photos/{filename} — remove a duplicate/unwanted source photo."""
    project = await _get_project_or_404(db, project_id)
    source_dir = project.get("source_dir")
    if not source_dir:
        raise HTTPException(404, "No source directory")
    path = _resolve_in_dir(source_dir, filename)
    if not os.path.isfile(path):
        raise HTTPException(404, "Image not found")
    os.remove(path)
    return {"deleted": os.path.basename(path)}


@router.put("/projects/{project_id}/photos/{filename}")
async def rename_photo(project_id: int, filename: str, body: PhotoRename, db=Depends(get_db)):
    """PUT /projects/{id}/photos/{filename} — rename a source photo (extension is kept as-is;
    only the name before it is editable)."""
    project = await _get_project_or_404(db, project_id)
    source_dir = project.get("source_dir")
    if not source_dir:
        raise HTTPException(404, "No source directory")
    old_path = _resolve_in_dir(source_dir, filename)
    if not os.path.isfile(old_path):
        raise HTTPException(404, "Image not found")

    ext = os.path.splitext(old_path)[1]
    new_stem = _UNSAFE_NAME_CHARS.sub("", body.new_name).strip()
    if not new_stem:
        raise HTTPException(400, "Invalid name")
    new_path = _resolve_in_dir(source_dir, new_stem + ext)
    if os.path.exists(new_path) and os.path.realpath(new_path) != os.path.realpath(old_path):
        raise HTTPException(409, f"{os.path.basename(new_path)} already exists")

    os.rename(old_path, new_path)
    return {"filename": os.path.basename(new_path)}


@router.get("/projects/{project_id}")
async def get_project(project_id: int, db=Depends(get_db)):
    """GET /projects/{id} — project row, merged with live job status if one is running."""
    project = await _get_project_or_404(db, project_id)
    job = _jobs.get(project_id)
    if job:
        project["live_job"] = {k: v for k, v in job.items() if k != "proc"}
    return _with_image_count(project)


@router.post("/projects/{project_id}/prep")
async def start_prep(project_id: int, body: PrepRequest, db=Depends(get_db)):
    """POST /projects/{id}/prep — run prepare_lora_dataset.py as a background job."""
    project = await _get_project_or_404(db, project_id)
    if not os.path.exists(PREP_SCRIPT):
        raise HTTPException(404, "LoRA dataset prep isn't available in this build — "
                             "it requires scripts/prepare_lora_dataset.py from a source "
                             "checkout, not present in a packaged install. See "
                             "docs/troubleshooting.md.")
    if _jobs.get(project_id, {}).get("status") == "running":
        raise HTTPException(409, "A job is already running for this project")

    trigger = project["trigger_word"]
    dataset_root = _default_dataset_root(trigger)
    dataset_dir = os.path.join(dataset_root, f"{project['repeats']}_{trigger}")

    _jobs[project_id] = {"kind": "prep", "status": "running", "error": None, "log_tail": ""}
    if not body.dry_run:
        await db.execute("UPDATE lora_projects SET status='prepping', updated_at=datetime('now') WHERE id=?",
                          (project_id,))
        await db.commit()

    async def _run():
        try:
            cmd = [
                sys.executable, PREP_SCRIPT, project["source_dir"],
                "--trigger-word", trigger,
                "--repeats", str(project["repeats"]),
                "--resolution", str(project["resolution"]),
                "--output-root", dataset_root,
                "--device", body.device,
            ]
            if body.dry_run:
                cmd.append("--dry-run")
            proc = await asyncio.create_subprocess_exec(
                *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
            )
            out, _ = await proc.communicate()
            log = out.decode(errors="replace")
            _jobs[project_id]["log_tail"] = log[-4000:]

            if proc.returncode != 0:
                _jobs[project_id].update(status="error", error=log[-2000:])
                if not body.dry_run:
                    await _db_update(project_id, status="error", prep_status="error", error=log[-2000:])
                return

            _jobs[project_id]["status"] = "done"
            if not body.dry_run:
                await _db_update(project_id, status="prepped", prep_status="done",
                                  prep_log=log[-4000:], dataset_dir=dataset_dir)
        except Exception as e:
            _jobs[project_id].update(status="error", error=str(e))
            if not body.dry_run:
                await _db_update(project_id, status="error", prep_status="error", error=str(e))

    asyncio.create_task(_run())
    return {"status": "queued"}


@router.get("/projects/{project_id}/captions")
async def list_captions(project_id: int, db=Depends(get_db)):
    """GET /projects/{id}/captions — every dataset image with its current caption."""
    project = await _get_project_or_404(db, project_id)
    dataset_dir = project.get("dataset_dir")
    if not dataset_dir or not os.path.isdir(dataset_dir):
        raise HTTPException(400, "Dataset not prepared yet")

    items = []
    for name in sorted(os.listdir(dataset_dir)):
        if not name.lower().endswith(".png"):
            continue
        txt_path = os.path.join(dataset_dir, os.path.splitext(name)[0] + ".txt")
        caption = ""
        if os.path.exists(txt_path):
            with open(txt_path) as f:
                caption = f.read()
        items.append({
            "filename": name,
            "caption": caption,
            "image_url": f"/api/lora/projects/{project_id}/images/{name}",
        })
    return items


@router.put("/projects/{project_id}/captions/{filename}")
async def update_caption(project_id: int, filename: str, body: CaptionUpdate, db=Depends(get_db)):
    """PUT /projects/{id}/captions/{filename} — hand-edit a single caption."""
    project = await _get_project_or_404(db, project_id)
    dataset_dir = project.get("dataset_dir")
    if not dataset_dir:
        raise HTTPException(400, "Dataset not prepared yet")
    txt_path = _resolve_in_dir(dataset_dir, os.path.splitext(os.path.basename(filename))[0] + ".txt")
    with open(txt_path, "w") as f:
        f.write(body.caption)
    return {"filename": os.path.basename(filename), "caption": body.caption}


@router.post("/projects/{project_id}/captions/{filename}/auto")
async def auto_caption(project_id: int, filename: str, db=Depends(get_db)):
    """POST /projects/{id}/captions/{filename}/auto — one-click Florence-2 caption
    for a single dataset image (roadmap 4.3's first concrete instance: wiring an
    already-generated-media GPU tool back into a flow that can use it, rather than
    Florence-2 captioning and LoRA dataset prep being two unconnected features).
    Writes the result to the same .txt file update_caption() writes to, and returns
    it the same shape — the frontend can treat this as "pre-fill, then let the user
    edit," not a black box.
    """
    project = await _get_project_or_404(db, project_id)
    dataset_dir = project.get("dataset_dir")
    if not dataset_dir:
        raise HTTPException(400, "Dataset not prepared yet")
    image_path = _resolve_in_dir(dataset_dir, filename)
    if not os.path.isfile(image_path):
        raise HTTPException(404, "Image not found")

    try:
        from PIL import Image as PILImage
        job_id = f"florence2_caption:{project_id}:{filename}"
        async with gpu_queue.acquire(job_id, priority=True):  # one image — interactive, shouldn't queue behind training
            img = PILImage.open(image_path).convert("RGB")
            parsed = run_florence2(img, task="caption")
    except ImportError:
        raise HTTPException(503, "Florence-2 requires: pip install transformers timm einops")
    except Exception as e:
        raise HTTPException(500, f"Florence-2 error: {e}")

    caption = next(iter(parsed.values())) if isinstance(parsed, dict) else str(parsed)
    txt_path = _resolve_in_dir(dataset_dir, os.path.splitext(os.path.basename(filename))[0] + ".txt")
    with open(txt_path, "w") as f:
        f.write(caption)
    return {"filename": os.path.basename(filename), "caption": caption}


@router.get("/projects/{project_id}/images/{filename}")
async def get_dataset_image(project_id: int, filename: str, db=Depends(get_db)):
    """GET /projects/{id}/images/{filename} — serve a dataset image for thumbnails."""
    project = await _get_project_or_404(db, project_id)
    dataset_dir = project.get("dataset_dir")
    if not dataset_dir:
        raise HTTPException(404, "Dataset not prepared yet")
    path = _resolve_in_dir(dataset_dir, filename)
    if not os.path.isfile(path):
        raise HTTPException(404, "Image not found")
    return FileResponse(path)


@router.get("/styles")
async def list_styles(db=Depends(get_db)):
    """GET /styles — trained LoRAs available for use as a Design Center style chip.

    Only projects that finished training AND were successfully copied into A1111's
    Lora dir (a1111_lora_filename set) qualify — that's what makes <lora:name:weight>
    actually resolve in a generation call.
    """
    async with db.execute(
        "SELECT id, name, trigger_word, a1111_lora_filename FROM lora_projects "
        "WHERE status='done' AND a1111_lora_filename IS NOT NULL ORDER BY updated_at DESC"
    ) as cur:
        rows = await cur.fetchall()
    return [
        {"id": r["id"], "label": r["trigger_word"], "lora_name": r["a1111_lora_filename"]}
        for r in rows
    ]


@router.get("/base-models")
async def list_base_models():
    """GET /base-models — SDXL checkpoints available for training (reuses tools.py's SD_CHECKPOINTS)."""
    models = []
    for key, info in SD_CHECKPOINTS.items():
        if key == "legacy":
            continue  # SD1.5 — incompatible with the SDXL trainer
        path = os.path.join(A1111_CHECKPOINTS_DIR, info["checkpoint"])
        models.append({
            "key": key,
            "label": info["label"],
            "description": info["description"],
            "path": path,
            "available": os.path.exists(path),
        })
    return models


async def _stream_process_lines(proc):
    """Yield decoded segments from a subprocess's stdout, splitting on both \\n and \\r —
    tqdm redraws its bar with carriage returns, and a plain readline() loop would stall
    for the entire duration of a bar segment waiting for a newline that never comes."""
    buf = b""
    while True:
        chunk = await proc.stdout.read(4096)
        if not chunk:
            break
        buf += chunk
        while b"\n" in buf or b"\r" in buf:
            candidates = [i for i in (buf.find(b"\n"), buf.find(b"\r")) if i != -1]
            idx = min(candidates)
            line, buf = buf[:idx], buf[idx + 1:]
            yield line.decode(errors="replace")
    if buf:
        yield buf.decode(errors="replace")


async def _copy_lora_to_a1111(src_path: str, filename: str) -> bool:
    """Copy a trained LoRA into the A1111 container's Lora dir and hot-refresh its cache,
    so it shows up as a Style chip without a container restart. See A1111_CONTAINER above
    for why this goes through docker instead of a plain filesystem copy."""
    try:
        mkdir_proc = await asyncio.create_subprocess_exec(
            "docker", "exec", A1111_CONTAINER, "mkdir", "-p", "/data/models/Lora",
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        )
        await mkdir_proc.wait()
        cp_proc = await asyncio.create_subprocess_exec(
            "docker", "cp", src_path, f"{A1111_CONTAINER}:/data/models/Lora/{filename}",
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        )
        if await cp_proc.wait() != 0:
            return False
    except Exception:
        return False

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            await client.post(f"{SD_BASE}/sdapi/v1/refresh-loras")
    except Exception:
        pass  # file is in place either way — A1111 will pick it up on its next restart
    return True


async def _remove_lora_from_a1111(filename: str) -> None:
    try:
        proc = await asyncio.create_subprocess_exec(
            "docker", "exec", A1111_CONTAINER, "rm", "-f", f"/data/models/Lora/{filename}",
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        )
        await proc.wait()
    except Exception:
        pass


@router.post("/projects/{project_id}/train")
async def start_training(project_id: int, body: TrainRequest, db=Depends(get_db)):
    """POST /projects/{id}/train — launch SDXL LoRA training with live progress tracking."""
    project = await _get_project_or_404(db, project_id)
    if not project.get("dataset_dir") or not os.path.isdir(project["dataset_dir"]):
        raise HTTPException(400, "Dataset not prepared yet — run prep first")
    if not os.path.exists(TRAIN_SCRIPT):
        raise HTTPException(404, "LoRA training isn't available in this build — "
                             "it requires scripts/run_lora_training.py from a source "
                             "checkout, not present in a packaged install. See "
                             "docs/troubleshooting.md.")
    if _jobs.get(project_id, {}).get("status") == "running":
        raise HTTPException(409, "A job is already running for this project")

    trigger = project["trigger_word"]
    output_dir = _default_output_dir(project_id, trigger)
    train_data_dir = _default_dataset_root(trigger)  # parent of the {repeats}_{trigger} folder

    _jobs[project_id] = {
        "kind": "train", "status": "queued", "error": None, "proc": None, "log_tail": "",
        "progress": {"epoch": 0, "total_epochs": body.max_train_epochs,
                     "step": 0, "total_steps": None, "loss": None},
    }
    await db.execute("UPDATE lora_projects SET status='training', training_status='running', "
                      "base_model_path=?, network_dim=?, network_alpha=?, learning_rate=?, "
                      "max_train_epochs=?, train_batch_size=?, output_dir=?, updated_at=datetime('now') "
                      "WHERE id=?",
                      (body.base_model_path, body.network_dim, body.network_alpha, body.learning_rate,
                       body.max_train_epochs, body.train_batch_size, output_dir, project_id))
    await db.commit()

    async def _run():
        job = _jobs[project_id]
        log_lines: list[str] = []
        proc = None
        try:
            async with gpu_queue.acquire(project_id):
                job["status"] = "running"
                await _free_sd_vram_for_job()
                try:
                    env = {**os.environ, "PYTHONUNBUFFERED": "1"}
                    proc = await asyncio.create_subprocess_exec(
                        sys.executable, TRAIN_SCRIPT,
                        "--base_model", body.base_model_path,
                        "--train_data_dir", train_data_dir,
                        "--output_dir", output_dir,
                        "--output_name", f"{trigger}_lora",
                        "--resolution", str(project["resolution"]),
                        "--network_dim", str(body.network_dim),
                        "--network_alpha", str(body.network_alpha),
                        "--train_batch_size", str(body.train_batch_size),
                        "--max_train_epochs", str(body.max_train_epochs),
                        "--learning_rate", str(body.learning_rate),
                        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                        env=env, start_new_session=True,
                    )
                    job["proc"] = proc
                    async for line in _stream_process_lines(proc):
                        log_lines.append(line)
                        del log_lines[:-200]
                        job["log_tail"] = "\n".join(log_lines)
                        m = STEP_RE.search(line)
                        if m:
                            job["progress"].update(step=int(m.group(1)), total_steps=int(m.group(2)),
                                                    loss=float(m.group(3)))
                        m2 = EPOCH_RE.search(line)
                        if m2:
                            job["progress"].update(epoch=int(m2.group(1)), total_epochs=int(m2.group(2)))
                    await proc.wait()
                finally:
                    await _restore_sd_vram_after_job()

            progress_json = json.dumps(job["progress"])
            if job["status"] == "cancelled":
                await _db_update(project_id, status="prepped", training_status="cancelled",
                                  training_progress=progress_json)
                return
            if proc.returncode != 0:
                err = "\n".join(log_lines[-50:])
                job.update(status="error", error=err)
                await _db_update(project_id, status="error", training_status="error",
                                  error=err, training_progress=progress_json)
                return

            output_files = glob.glob(os.path.join(output_dir, "*.safetensors"))
            output_path = max(output_files, key=os.path.getmtime) if output_files else ""
            job["status"] = "done"

            a1111_lora_filename = None
            if output_path:
                candidate = f"{trigger}_lora"
                if await _copy_lora_to_a1111(output_path, f"{candidate}.safetensors"):
                    a1111_lora_filename = candidate
                # else: LoRA file still lives in output_dir either way — just won't show up
                # as a Style chip until this is retried (e.g. by retraining).

            await _db_update(project_id, status="done", training_status="done",
                              output_lora_path=output_path, training_progress=progress_json,
                              a1111_lora_filename=a1111_lora_filename)
        except Exception as e:
            job.update(status="error", error=str(e))
            await _db_update(project_id, status="error", training_status="error", error=str(e))

    asyncio.create_task(_run())
    return {"status": "queued"}


@router.get("/projects/{project_id}/train/status")
async def training_status(project_id: int, db=Depends(get_db)):
    """GET /projects/{id}/train/status — poll live training progress."""
    project = await _get_project_or_404(db, project_id)
    job = _jobs.get(project_id)
    if job and job.get("kind") == "train":
        return {"status": job["status"], "progress": job.get("progress", {}),
                "log_tail": job.get("log_tail", ""), "error": job.get("error")}
    return {
        "status": project.get("training_status") or "idle",
        "progress": json.loads(project["training_progress"]) if project.get("training_progress") else {},
        "log_tail": "",
        "error": project.get("error"),
    }


@router.post("/projects/{project_id}/train/cancel")
async def cancel_training(project_id: int):
    """POST /projects/{id}/train/cancel — SIGTERM the training process group, SIGKILL after a grace period."""
    job = _jobs.get(project_id)
    if not job or job.get("status") != "running":
        raise HTTPException(400, "No running training job for this project")
    proc = job.get("proc")
    job["status"] = "cancelled"
    if proc and proc.returncode is None:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except ProcessLookupError:
            pass

        async def _force_kill_if_needed():
            await asyncio.sleep(15)
            if proc.returncode is None:
                try:
                    os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                except ProcessLookupError:
                    pass
        asyncio.create_task(_force_kill_if_needed())
    return {"status": "cancelling"}


@router.get("/projects/{project_id}/output")
async def list_output(project_id: int, db=Depends(get_db)):
    """GET /projects/{id}/output — list trained LoRA files."""
    project = await _get_project_or_404(db, project_id)
    output_dir = project.get("output_dir")
    if not output_dir or not os.path.isdir(output_dir):
        return {"files": []}
    files = []
    for name in sorted(os.listdir(output_dir)):
        if name.endswith(".safetensors"):
            path = os.path.join(output_dir, name)
            files.append({"filename": name, "size": os.path.getsize(path),
                          "download_url": f"/api/lora/projects/{project_id}/output/{name}"})
    return {"files": files}


@router.get("/projects/{project_id}/output/{filename}")
async def download_output(project_id: int, filename: str, db=Depends(get_db)):
    """GET /projects/{id}/output/{filename} — download a trained LoRA file."""
    project = await _get_project_or_404(db, project_id)
    output_dir = project.get("output_dir")
    if not output_dir:
        raise HTTPException(404, "No output")
    path = _resolve_in_dir(output_dir, filename)
    if not os.path.isfile(path):
        raise HTTPException(404, "File not found")
    return FileResponse(path, filename=os.path.basename(path))


@router.delete("/projects/{project_id}")
async def delete_project(project_id: int, delete_files: bool = False, db=Depends(get_db)):
    """DELETE /projects/{id} — remove a project; optionally delete its files too."""
    project = await _get_project_or_404(db, project_id)
    if _jobs.get(project_id, {}).get("status") == "running":
        raise HTTPException(409, "Cannot delete a project with a running job")
    if delete_files:
        for d in (project.get("source_dir"), project.get("dataset_dir"), project.get("output_dir")):
            if d and os.path.isdir(d):
                shutil.rmtree(d, ignore_errors=True)
        a1111_name = project.get("a1111_lora_filename")
        if a1111_name:
            await _remove_lora_from_a1111(f"{a1111_name}.safetensors")
    await db.execute("DELETE FROM lora_projects WHERE id=?", (project_id,))
    await db.commit()
    _jobs.pop(project_id, None)
    return {"deleted": project_id}
