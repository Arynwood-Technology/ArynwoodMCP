import asyncio
import glob
import os
import time
import uuid
from contextlib import asynccontextmanager
from typing import Optional

import httpx

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SD_BASE = "http://localhost:7860"
_jobs: dict[str, dict] = {}


class GPUJobCancelled(Exception):
    """Raised inside a GPUJobQueue.acquire() waiter when it's cancelled before its turn."""
    def __init__(self, job_id: str):
        self.job_id = job_id
        super().__init__(f"GPU job {job_id} was cancelled while queued")


class GPUJobQueue:
    """Serializes GPU-heavy work with queue-position visibility, cancellation, and
    priority (roadmap 4.2 verified this against the actual call sites, not just this
    docstring — see backend/routers/tools.py's SD generate endpoint, which passes
    `priority=True` for exactly the reason below).

    This machine has one GPU (12GB), so true parallelism was never on the table -
    the old code already forced everything through a single `asyncio.Lock`, which
    gave up visibility into how many jobs are waiting and any way to cancel a
    queued job before it starts — both fixed here. A 20-second SD generate no
    longer has to wait behind a multi-hour LoRA training run: acquire(priority=True)
    lets a short interactive job jump the line (never ahead of whatever's already
    running) — see docstring on `acquire` below.

    `async with gpu_queue.acquire(job_id):` is a drop-in replacement for the old
    `async with _gpu_lock:` - same exclusive-access guarantee, same call-site shape.
    """

    def __init__(self):
        self._condition = asyncio.Condition()
        self._queue: list[str] = []  # FIFO of job_ids waiting or currently running
        self._running: Optional[str] = None
        self._cancelled: set[str] = set()

    def queue_position(self, job_id: str) -> Optional[int]:
        """0 = running or about to run next; None = not queued."""
        return self._queue.index(job_id) if job_id in self._queue else None

    def queue_depth(self) -> int:
        return len(self._queue)

    async def cancel(self, job_id: str) -> bool:
        """Cancel a job that hasn't started running yet.

        Returns False if it's already running (too late to cancel) or unknown.
        """
        async with self._condition:
            if job_id in self._queue and job_id != self._running:
                self._cancelled.add(job_id)
                self._condition.notify_all()
                return True
            return False

    @asynccontextmanager
    async def acquire(self, job_id: str, priority: bool = False):
        """Hold exclusive GPU access for the wrapped block.

        `priority=True` inserts ahead of the rest of the queue (but never ahead of
        whatever's already running) - for short interactive jobs like a single SD
        generate that shouldn't have to wait behind a multi-hour training run.
        """
        async with self._condition:
            if priority:
                insert_at = 1 if self._running is not None else 0
                self._queue.insert(insert_at, job_id)
            else:
                self._queue.append(job_id)
            try:
                while self._running is not None or self._queue[0] != job_id:
                    if job_id in self._cancelled:
                        self._cancelled.discard(job_id)
                        self._queue.remove(job_id)
                        raise GPUJobCancelled(job_id)
                    await self._condition.wait()
                self._running = job_id
            except asyncio.CancelledError:
                # Caller's own task was cancelled (not via .cancel()) while queued.
                if job_id in self._queue:
                    self._queue.remove(job_id)
                raise
        try:
            yield
        finally:
            async with self._condition:
                self._running = None
                if job_id in self._queue:
                    self._queue.remove(job_id)
                self._condition.notify_all()


gpu_queue = GPUJobQueue()


def _new_job(tool_id: str) -> str:
    job_id = uuid.uuid4().hex
    _jobs[job_id] = {"tool": tool_id, "status": "queued", "error": None, "result_path": None, "result_text": None, "created_at": time.time()}
    return job_id


def _newest_file(root: str, exts: tuple, since: float) -> Optional[str]:
    candidates: list[str] = []
    for ext in exts:
        candidates += glob.glob(os.path.join(root, "**", f"*{ext}"), recursive=True)
    candidates = [path for path in candidates if os.path.getmtime(path) >= since - 1]
    return max(candidates, key=os.path.getmtime) if candidates else None


async def _sd_unload_checkpoint():
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(f"{SD_BASE}/sdapi/v1/unload-checkpoint")
    response.raise_for_status()


async def _sd_reload_checkpoint():
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(f"{SD_BASE}/sdapi/v1/reload-checkpoint")
    response.raise_for_status()


async def _sd_active_bytes() -> int:
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(f"{SD_BASE}/sdapi/v1/memory")
    response.raise_for_status()
    return int(response.json().get("cuda", {}).get("active", {}).get("current", 0))


async def _free_sd_vram_for_job():
    """Give video jobs the GPU instead of silently attempting an OOM-prone run.

    A1111 normally keeps ~7 GB of this 12 GB card resident. If it is available,
    unload it and verify the release. A missing A1111 is fine; an A1111 that
    refuses to release memory stops the job with an actionable error.
    """
    try:
        await _sd_unload_checkpoint()
    except httpx.ConnectError:
        return
    except Exception as exc:
        raise RuntimeError(f"Could not unload Stable Diffusion before this GPU job: {exc}") from exc

    await asyncio.sleep(1)
    try:
        active_bytes = await _sd_active_bytes()
    except Exception as exc:
        raise RuntimeError(f"Stable Diffusion unloaded but GPU memory could not be verified: {exc}") from exc
    if active_bytes > 1_000_000_000:
        raise RuntimeError(
            f"Stable Diffusion is still holding {active_bytes / 1024**3:.1f} GB of VRAM. "
            "Unload or restart it, then retry the video job."
        )


async def _restore_sd_vram_after_job():
    try:
        await _sd_reload_checkpoint()
    except Exception:
        pass
