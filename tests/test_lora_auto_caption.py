"""POST /api/lora/projects/{id}/captions/{filename}/auto (roadmap 4.3) — Florence-2
itself is mocked (downloading/running the real model has no place in this suite),
so this only verifies the wiring: image resolved, caption written to the right
.txt file, GPU queue used, 404s behave correctly."""

import os
import sqlite3
import tempfile

from PIL import Image

import backend.routers.lora as lora_mod


def _make_project_with_dataset() -> tuple[int, str]:
    tmp_dir = tempfile.mkdtemp(prefix="lora_test_dataset_")
    image_path = os.path.join(tmp_dir, "0001.png")
    Image.new("RGB", (8, 8), color="red").save(image_path)

    conn = sqlite3.connect(os.environ["ARYNWOOD_DB_PATH"])
    cur = conn.execute(
        "INSERT INTO lora_projects (name, trigger_word, source_dir, dataset_dir, status) "
        "VALUES ('Auto Caption Test', 'trg', ?, ?, 'draft')",
        (tmp_dir, tmp_dir),
    )
    conn.commit()
    project_id = cur.lastrowid
    conn.close()
    return project_id, tmp_dir


def test_auto_caption_writes_the_txt_file_and_uses_the_gpu_queue(client, monkeypatch):
    project_id, dataset_dir = _make_project_with_dataset()

    acquire_calls = []
    real_acquire = lora_mod.gpu_queue.acquire

    def spy_acquire(job_id, priority=False):
        acquire_calls.append((job_id, priority))
        return real_acquire(job_id, priority=priority)

    monkeypatch.setattr(lora_mod.gpu_queue, "acquire", spy_acquire)
    monkeypatch.setattr(lora_mod, "run_florence2", lambda img, task="caption": {"<CAPTION>": "a red square"})

    r = client.post(f"/api/lora/projects/{project_id}/captions/0001.png/auto")
    assert r.status_code == 200
    body = r.json()
    assert body["filename"] == "0001.png"
    assert body["caption"] == "a red square"

    with open(os.path.join(dataset_dir, "0001.txt")) as f:
        assert f.read() == "a red square"

    assert len(acquire_calls) == 1
    assert acquire_calls[0][1] is True  # priority=True — a single interactive caption shouldn't queue behind training


def test_auto_caption_404s_for_missing_image(client):
    project_id, _ = _make_project_with_dataset()
    r = client.post(f"/api/lora/projects/{project_id}/captions/does_not_exist.png/auto")
    assert r.status_code == 404


def test_auto_caption_400s_when_dataset_not_prepared(client):
    conn = sqlite3.connect(os.environ["ARYNWOOD_DB_PATH"])
    cur = conn.execute(
        "INSERT INTO lora_projects (name, trigger_word, source_dir, status) "
        "VALUES ('No Dataset Yet', 'trg', '/tmp/nonexistent', 'draft')"
    )
    conn.commit()
    project_id = cur.lastrowid
    conn.close()

    r = client.post(f"/api/lora/projects/{project_id}/captions/0001.png/auto")
    assert r.status_code == 400


def test_auto_caption_handles_string_result_not_just_dict(client, monkeypatch):
    project_id, dataset_dir = _make_project_with_dataset()
    monkeypatch.setattr(lora_mod, "run_florence2", lambda img, task="caption": "a plain string caption")

    r = client.post(f"/api/lora/projects/{project_id}/captions/0001.png/auto")
    assert r.status_code == 200
    assert r.json()["caption"] == "a plain string caption"
