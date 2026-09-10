import pytest

from backend.services.gpu_jobs import gpu_queue


def test_root(client):
    r = client.get("/")
    assert r.status_code == 200
    assert r.json()["status"] == "Arynwood MCP running"


def test_system_status(client):
    r = client.get("/api/system/status")
    assert r.status_code == 200


def test_metrics_exposed(client):
    r = client.get("/metrics")
    assert r.status_code == 200


# ── GPU queue ────────────────────────────────────────────────────────────────
# Read-only view of gpu_jobs.gpu_queue, consumed by the UI's status drawer to
# explain why a generate is waiting rather than looking hung.


def test_gpu_queue_idle(client):
    r = client.get("/api/system/gpu-queue")
    assert r.status_code == 200
    assert r.json() == {"running": None, "depth": 0, "waiting": []}


@pytest.fixture()
def clean_queue():
    """Restore queue internals — it's a module-level singleton shared with the
    rest of the suite, so a test that seeds it must put it back."""
    yield
    gpu_queue._queue.clear()
    gpu_queue._running = None


def test_gpu_queue_reports_running_job_and_waiters(client, clean_queue):
    gpu_queue._queue.extend(["job-running", "job-a", "job-b"])
    gpu_queue._running = "job-running"

    body = client.get("/api/system/gpu-queue").json()

    assert body["running"] == "job-running"
    assert body["depth"] == 3
    # The running job is reported separately, not repeated in the wait list.
    assert body["waiting"] == ["job-a", "job-b"]


def test_gpu_queue_waiting_excludes_running_when_nothing_runs(client, clean_queue):
    # A job can sit in the queue before acquire() promotes it to running.
    gpu_queue._queue.append("job-queued")

    body = client.get("/api/system/gpu-queue").json()

    assert body["running"] is None
    assert body["depth"] == 1
    assert body["waiting"] == ["job-queued"]
