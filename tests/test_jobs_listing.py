from backend.services.gpu_jobs import _jobs


def test_list_jobs_empty(client):
    r = client.get("/api/tools/jobs")
    assert r.status_code == 200
    body = r.json()
    assert body["jobs"] == []
    assert body["gpu_queue_depth"] == 0


def test_list_jobs_reflects_tracked_jobs(client):
    _jobs["test-job-1"] = {"tool": "sadtalker", "status": "done", "error": None,
                            "result_path": None, "result_text": None, "created_at": 0}
    try:
        r = client.get("/api/tools/jobs")
        assert r.status_code == 200
        job_ids = {j["id"] for j in r.json()["jobs"]}
        assert "test-job-1" in job_ids
        entry = next(j for j in r.json()["jobs"] if j["id"] == "test-job-1")
        assert entry["status"] == "done"
        assert entry["queue_position"] is None  # not currently in the GPU queue
    finally:
        del _jobs["test-job-1"]
