import asyncio
import json
import os
import shutil
import tempfile
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from backend.db import get_db
from backend.services import knowledge
from backend import external_paths
from backend.services.gpu_jobs import APP_DIR, gpu_queue, _jobs, _new_job

router = APIRouter()

# Sycamore's local PDF partitioner (DETR layout model + optional OCR/table structure,
# no Aryn Cloud account needed) lives in its own dev checkout/venv, not the main
# project venv — same reasoning as scripts/run_whisper.py's dedicated whisper-venv:
# it pulls in its own torch/transformers/timm/easyocr/paddleocr stack. See
# docs/sycamore-integration-plan.md for the full rationale.
_SYCAMORE_REPO_DIR = external_paths.SYCAMORE_REPO_DIR
_SYCAMORE_VENV_PYTHON = os.path.join(_SYCAMORE_REPO_DIR, ".venv", "bin", "python3")
_SYCAMORE_PARTITION_SCRIPT = os.path.join(APP_DIR, "scripts", "run_sycamore_partition.py")


class ChunkIn(BaseModel):
    text: str
    page_start: Optional[int] = None
    page_end: Optional[int] = None
    has_table: bool = False


class LearnRequest(BaseModel):
    source_type: str               # "url" | "text" | "file"
    source: str                    # URL, filename, or short label
    text: Optional[str] = None     # required for "text" / "file", unless `chunks` is given
    chunks: Optional[list[ChunkIn]] = None  # pre-chunked, page/table-aware (e.g. Sycamore) — takes priority over `text`
    title: Optional[str] = None
    added_by: str = "dashboard"
    ollama_url: str = knowledge.OLLAMA_URL_DEFAULT
    qdrant_url: str = knowledge.QDRANT_URL_DEFAULT


@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    """POST /upload — extract full text from a file for Learn.

    Dedicated to knowledge-base ingestion: unlike /api/chat/upload (built for
    injecting a snippet into the current chat's context window), this does not
    truncate the extracted text and allows much larger files.
    """
    data = await file.read(knowledge.MAX_INGEST_FILE_BYTES + 1)
    if len(data) > knowledge.MAX_INGEST_FILE_BYTES:
        limit_mb = knowledge.MAX_INGEST_FILE_BYTES // (1024 * 1024)
        raise HTTPException(413, f"File too large (max {limit_mb} MB)")
    filename = file.filename or "file"
    text = knowledge.extract_text_from_bytes(filename, data)
    return {"filename": filename, "text": text, "chars": len(text)}


@router.post("/sycamore/jobs")
async def sycamore_partition_start_job(
    file: UploadFile = File(...),
    ocr: bool = Form(False),
    tables: bool = Form(True),
):
    """POST /sycamore/jobs — parse a PDF locally via Sycamore's DETR layout model
    (+ optional OCR / table-structure extraction, no Aryn Cloud account needed) and
    return Markdown text, ready to hand to POST /learn as source_type=file.

    Runs as a background job, not a plain request/response: OCR on a long scanned
    PDF can run well past a typical HTTP client timeout, and it needs to serialize
    behind the same GPU lock as Stable Diffusion/video jobs (backend/services/gpu_jobs.py)
    to avoid a concurrent-VRAM OOM on this box's single GPU. Poll GET /jobs/{id}.

    ocr defaults False: verified against a real digital-text PDF that forcing OCR on
    introduces real misreads (periods -> colons, dropped hyphens/quotes, digit/letter
    swaps) on documents that already have a clean embedded text layer. Only turn it on
    for genuinely scanned/image-only PDFs.
    """
    if not os.path.exists(_SYCAMORE_VENV_PYTHON):
        raise HTTPException(
            404,
            f"Sycamore local-inference venv not found — expected {_SYCAMORE_VENV_PYTHON}. "
            "See docs/sycamore-integration-plan.md.",
        )
    filename = file.filename or "file"
    if os.path.splitext(filename.lower())[1] != ".pdf":
        raise HTTPException(400, "Sycamore parsing is for PDFs — use the plain /upload for other file types.")

    tmp = tempfile.mkdtemp()
    pdf_path = os.path.join(tmp, f"input_{uuid.uuid4().hex}.pdf")
    data = await file.read()
    with open(pdf_path, "wb") as f:
        f.write(data)

    job_id = _new_job("sycamore_partition")

    async def _run():
        try:
            async with gpu_queue.acquire(job_id):
                _jobs[job_id]["status"] = "running"
                cmd = [
                    _SYCAMORE_VENV_PYTHON, _SYCAMORE_PARTITION_SCRIPT, pdf_path,
                    "--output_dir", tmp,
                    "--ocr" if ocr else "--no-ocr",
                    "--tables" if tables else "--no-tables",
                ]
                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                    env={**os.environ, "PYTHONPATH": _SYCAMORE_REPO_DIR},
                )
                out, _ = await proc.communicate()
            log = out.decode(errors="replace")
            if proc.returncode != 0:
                _jobs[job_id].update(status="error", error=log[-2000:])
                return
            lines = log.splitlines()
            result_path = next((l.split("=", 1)[1] for l in lines if l.startswith("RESULT_PATH=")), None)
            chunks_path = next((l.split("=", 1)[1] for l in lines if l.startswith("CHUNKS_PATH=")), None)
            if not result_path or not os.path.exists(result_path):
                _jobs[job_id].update(status="error", error="Sycamore finished but produced no output.")
                return
            with open(result_path, encoding="utf-8") as f:
                markdown = f.read()
            if not markdown.strip():
                _jobs[job_id].update(
                    status="error",
                    error="Sycamore found no content on this PDF. If it's a scanned "
                          "document, make sure OCR is enabled.",
                )
                return
            chunks = None
            if chunks_path and os.path.exists(chunks_path):
                with open(chunks_path, encoding="utf-8") as f:
                    chunks = json.load(f)
            _jobs[job_id].update(status="done", result_text=markdown, result_chunks=chunks, filename=filename)
        except Exception as e:
            _jobs[job_id].update(status="error", error=str(e))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    asyncio.create_task(_run())
    return {"job_id": job_id, "status": "queued"}


@router.get("/jobs/{job_id}")
async def get_knowledge_job(job_id: str):
    """GET /jobs/{id} — poll a Sycamore parsing job. Shares the same job registry as
    /api/tools/jobs/{id} (backend/services/gpu_jobs.py); this copy just keeps the
    knowledge-domain frontend from reaching into /api/tools for something unrelated."""
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return {"id": job_id, **job}


class PreviewRequest(BaseModel):
    text: str


@router.post("/preview")
async def preview_chunks(req: PreviewRequest):
    """POST /preview — show how text WOULD be chunked before committing to an
    ingest (roadmap 1.9). Pure computation (no embedding/Qdrant call), so a
    frontend can let the user sanity-check chunk boundaries first, for free.
    """
    chunks = knowledge.chunk_text(req.text)[:knowledge.MAX_CHUNKS_PER_SOURCE]
    return {
        "chunk_count": len(chunks),
        "chunks": [{"index": i, "chars": len(c), "preview": c[:200]} for i, c in enumerate(chunks)],
    }


@router.post("/learn")
async def learn(req: LearnRequest, db=Depends(get_db)):
    """Ingest a URL, plain text, or file into the Qdrant knowledge base.

    If `chunks` is given (element-aware PDF chunks from POST /sycamore/jobs), it
    takes priority over `text` — chunking already happened upstream, so this skips
    straight to embed+store instead of re-cutting by character count.
    """
    source_type = req.source_type.lower()

    if source_type == "url":
        try:
            fetched_title, text = await knowledge.fetch_url_text(req.source)
        except ValueError as e:
            raise HTTPException(400, str(e))
        except Exception as e:
            raise HTTPException(502, f"Could not fetch URL: {e}")
        title = req.title or fetched_title
        source = req.source
    elif source_type in ("text", "file"):
        if not req.text and not req.chunks:
            raise HTTPException(400, "`text` or `chunks` is required for source_type 'text'/'file'")
        text = req.text
        title = req.title or req.source
        source = req.source
    else:
        raise HTTPException(400, "source_type must be 'url', 'file', or 'text'")

    try:
        if req.chunks:
            return await knowledge.ingest_chunks(
                db, title=title, source=source, source_type=source_type,
                chunks=[c.model_dump() for c in req.chunks],
                ollama_url=req.ollama_url, qdrant_url=req.qdrant_url, added_by=req.added_by,
            )
        return await knowledge.ingest_text(
            db, title=title, source=source, source_type=source_type, text=text,
            ollama_url=req.ollama_url, qdrant_url=req.qdrant_url, added_by=req.added_by,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(503, str(e))


@router.get("/sources")
async def get_sources(db=Depends(get_db)):
    """Return all indexed knowledge sources."""
    return await knowledge.list_sources(db)


@router.delete("/sources/{source_id}")
async def remove_source(source_id: int, db=Depends(get_db)):
    """Delete a knowledge source and its embedded chunks."""
    ok = await knowledge.delete_source(db, source_id)
    if not ok:
        raise HTTPException(404, "Source not found")
    return {"deleted": source_id}


@router.get("/search")
async def search(q: str, top_k: int = 5):
    """Semantic search against the Qdrant vector store."""
    return {"results": await knowledge.search(q, top_k=top_k)}


@router.get("/status")
async def status():
    """Report Qdrant reachability and embedding model availability."""
    return {
        "qdrant": await knowledge.qdrant_status(),
        "embedding_model": knowledge.EMBED_MODEL,
        "embedding_model_available": await knowledge.embedding_model_available(),
    }
