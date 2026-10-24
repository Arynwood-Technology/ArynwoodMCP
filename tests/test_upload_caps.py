"""Studio and Music Lab uploads are read into memory before they go to a sidecar, so each read is capped.

Found 2026-10-23 in the security pass: `await upload.read()` took whatever arrived, all at once."""
import asyncio
import io

import pytest
from fastapi import HTTPException, UploadFile

from backend.services import uploads


def upload(data: bytes, size=None):
    return UploadFile(io.BytesIO(data), filename="take.wav", size=size)


def test_reads_up_to_the_limit_and_refuses_past_it():
    assert asyncio.run(uploads.read_capped(upload(b"x" * 10), limit=10)) == b"x" * 10
    with pytest.raises(HTTPException) as refused:
        asyncio.run(uploads.read_capped(upload(b"x" * 11), limit=10))
    assert refused.value.status_code == 413 and "take.wav" in refused.value.detail


def test_a_declared_size_over_the_limit_is_refused_before_reading():
    stream = upload(b"x" * 5, size=11)
    with pytest.raises(HTTPException):
        asyncio.run(uploads.read_capped(stream, limit=10))
    assert stream.file.tell() == 0


def test_saving_past_the_limit_leaves_no_partial_file(tmp_path, monkeypatch):
    monkeypatch.setattr(uploads, "MB", 4)          # read in 4-byte pieces so the limit falls mid-file
    target = tmp_path / "voice.pth"
    with pytest.raises(HTTPException):
        asyncio.run(uploads.save_capped(upload(b"x" * 13), target, limit=10))
    assert not target.exists()
    asyncio.run(uploads.save_capped(upload(b"y" * 10), target, limit=10))
    assert target.read_bytes() == b"y" * 10


def test_the_studio_refuses_an_oversized_take_before_calling_its_sidecar(client, monkeypatch):
    monkeypatch.setattr(uploads, "AUDIO_MAX_BYTES", 10)
    r = client.post("/api/studio/effects/chain", files={"audio": ("take.wav", b"x" * 11, "audio/wav")}, data={"effects": "[]"})
    assert r.status_code == 413


@pytest.mark.parametrize("name", ["../../.ssh/x", "a/b", ".hidden", "", "x" * 81])
def test_a_voice_model_name_must_be_a_plain_name(client, name):
    r = client.post("/api/studio/voice/models/import", data={"name": name}, files={"pth": ("m.pth", b"pth", "application/octet-stream")})
    assert r.status_code in (400, 422), name
