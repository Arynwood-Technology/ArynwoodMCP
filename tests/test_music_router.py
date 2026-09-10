import asyncio

import aiosqlite
import pytest

from backend.db import DB_PATH
from backend.routers import music


@pytest.fixture(autouse=True)
def isolated_assets_dir(tmp_path, monkeypatch):
    """Redirect music.ASSETS_DIR to a per-test temp dir. Without this, tests
    that upload audio (stems/jam) write real files into the repo's actual
    music/assets/ — the DB row gets cleaned up via _delete_asset, but the
    file doesn't, since that's a raw SQL delete, not the DELETE endpoint's
    file-removal path. Confirmed by finding stray fake-wav-bytes-sized .wav
    files in music/assets/ after a real end-to-end verification session."""
    monkeypatch.setattr(music, "ASSETS_DIR", str(tmp_path))


async def _always_stopped(sidecar_id: str) -> str:
    return "stopped"


def test_capabilities_gracefully_handles_sidecar_down(client, monkeypatch):
    """When the song-gen/stem-sep sidecars are unreachable, capabilities
    should degrade to an empty providers list / 'stopped', not 500. Points
    _sidecar_url at a guaranteed-unreachable port and stubs _ping, rather
    than assuming nothing happens to be listening on 8003/8004 in whatever
    environment the suite runs in — it may well be, e.g. during manual
    end-to-end testing on a dev machine, which is exactly how this test broke
    twice while writing this file."""
    monkeypatch.setattr(music, "_sidecar_url", lambda sidecar_id: "http://127.0.0.1:1")
    monkeypatch.setattr(music, "_ping", _always_stopped)
    r = client.get("/api/music/capabilities")
    assert r.status_code == 200
    body = r.json()
    assert body["providers"] == []
    assert body["stems"]["sidecar_status"] == "stopped"


async def _delete_asset(asset_id: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM music_assets WHERE id=?", (asset_id,))
        await db.commit()


def test_asset_crud_round_trip(client):
    asset_id = "test-asset-1"
    asyncio.run(music._create_asset(
        asset_id, kind="generated", provider="acestep", source_asset_id=None,
        label="Bass Idea 01", instrument="bass", prompt="dark synthwave bass",
        params_json="{}", file_path=None, duration_seconds=15.0, bpm=120.0,
        musical_key="A minor", favorite=0, project_id=None,
    ))
    try:
        r = client.get("/api/music/assets")
        assert r.status_code == 200
        assert asset_id in {a["id"] for a in r.json()}

        r = client.get("/api/music/assets", params={"instrument": "bass"})
        assert asset_id in {a["id"] for a in r.json()}

        r = client.get("/api/music/assets", params={"instrument": "drums"})
        assert asset_id not in {a["id"] for a in r.json()}

        r = client.patch(f"/api/music/assets/{asset_id}",
                          json={"label": "Renamed Bass", "favorite": True})
        assert r.status_code == 200
        assert r.json()["label"] == "Renamed Bass"
        assert r.json()["favorite"] == 1

        r = client.delete(f"/api/music/assets/{asset_id}")
        assert r.status_code == 200
        assert asset_id not in {a["id"] for a in client.get("/api/music/assets").json()}
    finally:
        asyncio.run(_delete_asset(asset_id))  # best-effort if an assertion failed early


def test_asset_audio_404_for_unknown_id(client):
    r = client.get("/api/music/assets/does-not-exist/audio")
    assert r.status_code == 404


def test_generate_rejects_unknown_provider(client):
    r = client.post("/api/music/generate", data={"provider": "not-a-real-provider"})
    assert r.status_code == 400


def test_jam_rejects_unknown_provider(client):
    r = client.post("/api/music/jam", data={"provider": "not-a-real-provider", "role": "Bass player"},
                     files={"input_audio": ("in.wav", b"fake-wav-bytes", "audio/wav")})
    assert r.status_code == 400


def test_jam_requires_input(client):
    r = client.post("/api/music/jam", data={"provider": "musicgen", "role": "Bass player"})
    assert r.status_code == 400


def test_jam_persists_input_as_recording_and_creates_job(client):
    r = client.post(
        "/api/music/jam",
        data={"provider": "musicgen", "role": "Drummer", "style": "post-punk", "duration_seconds": "8"},
        files={"input_audio": ("riff.wav", b"fake-wav-bytes", "audio/wav")},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["job_id"]
    recording_id = body["source_asset_id"]

    r2 = client.get("/api/music/assets", params={"kind": "recording"})
    assert recording_id in {a["id"] for a in r2.json()}

    r3 = client.get(f"/api/music/jobs/{body['job_id']}")
    assert r3.status_code == 200
    assert r3.json()["kind"] == "jam"

    asyncio.run(_delete_asset(recording_id))


def test_generate_creates_a_queryable_job(client):
    r = client.post("/api/music/generate", data={
        "provider": "acestep", "instrument": "bass", "duration_seconds": "10",
    })
    assert r.status_code == 200
    job_id = r.json()["job_id"]
    assert job_id

    r2 = client.get(f"/api/music/jobs/{job_id}")
    assert r2.status_code == 200
    # No sidecar is running in tests, so the background task may already have
    # failed by the time we poll — any of these is a correctly-created job.
    assert r2.json()["status"] in ("queued", "running", "error")


def test_stems_persists_the_upload_as_a_recording_asset(client):
    r = client.post(
        "/api/music/stems",
        files={"audio": ("my_song.wav", b"fake-wav-bytes", "audio/wav")},
        data={"engine": "demucs", "stems": "4"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["job_id"]
    recording_id = body["source_asset_id"]

    r2 = client.get("/api/music/assets", params={"kind": "recording"})
    assert recording_id in {a["id"] for a in r2.json()}

    r3 = client.get(f"/api/music/jobs/{body['job_id']}")
    assert r3.status_code == 200
    assert r3.json()["kind"] == "stem_separate"

    asyncio.run(_delete_asset(recording_id))


def test_jobs_list_has_expected_shape(client):
    r = client.get("/api/music/jobs")
    assert r.status_code == 200
    body = r.json()
    assert "jobs" in body
    assert "gpu_queue_depth" in body
