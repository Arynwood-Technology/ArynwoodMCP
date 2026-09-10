from backend.routers import models as models_router


def test_checkpoints_lists_files_and_flags_known_vs_missing(tmp_path, monkeypatch):
    (tmp_path / "Known-Style.safetensors").write_bytes(b"x" * 100)
    (tmp_path / "Unlisted.safetensors").write_bytes(b"y" * 50)
    (tmp_path / "not-a-model.txt").write_bytes(b"ignore me")

    monkeypatch.setattr(models_router, "A1111_CHECKPOINTS_DIR", str(tmp_path))
    monkeypatch.setattr(models_router, "SD_CHECKPOINTS", {
        "realistic": {"checkpoint": "Known-Style.safetensors"},
        "legacy": {"checkpoint": "Also-Missing.safetensors"},
    })

    import asyncio
    result = asyncio.run(models_router.list_checkpoints())

    names = {f["filename"] for f in result["files"]}
    assert names == {"Known-Style.safetensors", "Unlisted.safetensors"}  # .txt excluded

    known = next(f for f in result["files"] if f["filename"] == "Known-Style.safetensors")
    assert known["known"] is True
    assert known["style"] == "realistic"

    unlisted = next(f for f in result["files"] if f["filename"] == "Unlisted.safetensors")
    assert unlisted["known"] is False
    assert unlisted["style"] is None

    assert result["missing_from_styles"] == [{"style": "legacy", "filename": "Also-Missing.safetensors"}]
    assert result["total_bytes"] == 150


def test_checkpoints_missing_directory_returns_empty(monkeypatch):
    monkeypatch.setattr(models_router, "A1111_CHECKPOINTS_DIR", "/nonexistent/path/xyz")
    monkeypatch.setattr(models_router, "SD_CHECKPOINTS", {})

    import asyncio
    result = asyncio.run(models_router.list_checkpoints())
    assert result == {"files": [], "missing_from_styles": [], "total_bytes": 0}


def test_loras_lists_safetensor_files(tmp_path, monkeypatch):
    (tmp_path / "my_style.safetensors").write_bytes(b"z" * 40)
    monkeypatch.setattr(models_router, "A1111_LORA_DIR", str(tmp_path))

    import asyncio
    result = asyncio.run(models_router.list_loras())
    assert len(result["files"]) == 1
    assert result["files"][0]["filename"] == "my_style.safetensors"
    assert result["total_bytes"] == 40
