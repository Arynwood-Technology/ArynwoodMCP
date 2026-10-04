"""The owner's conversations and other data must never be committable from this checkout.

Conversations live in SQLite (config/arynwood.db in a source checkout, the per-user data dir
when packaged); the gateway keeps MEMORY.md and daily notes; a source checkout also writes GPU
outputs (saved voices included) and social posts inside the repo. Each such path must be
ignored by git AND refused by the pre-push guard, so neither `git add -A` nor a forced add can
publish it."""

import importlib.util
import os
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]

OWNER_DATA = [
    "config/arynwood.db", "config/arynwood.db-wal", "config/arynwood.db-shm",
    "memory/MEMORY.md", "MEMORY.md", "memory/daily/2026-10-04.md", "gateway.json",
    "triggers/gpu_watch/chatterbox_voices/my-voice.wav", "triggers/gpu_watch/wan2_output/clip.mp4",
    "static/social-media/post.png", "music/assets/take1.wav", "generated/spreadsheets/notes.xlsx",
    ".env", "mcp/config/mcp_servers.json", "personas.local.json",
]


def _guard():
    spec = importlib.util.spec_from_file_location("push_guard", ROOT / "scripts" / "push-guard.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("path", OWNER_DATA)
def test_owner_data_is_ignored_by_git(path):
    result = subprocess.run(["git", "check-ignore", "-q", path], cwd=ROOT)
    assert result.returncode == 0, f"{path} is not ignored by .gitignore"


@pytest.mark.parametrize("path", OWNER_DATA)
def test_owner_data_is_refused_by_the_push_guard(path):
    assert any(p.search(path) for p in _guard().FORBIDDEN_PATHS), f"push guard would let {path} through"


def test_no_owner_data_is_tracked():
    tracked = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True).stdout.splitlines()
    patterns = [p for p in _guard().FORBIDDEN_PATHS]
    offenders = [f for f in tracked if any(p.search(f) for p in patterns)]
    assert offenders == []


def test_the_conversation_database_is_ignored_or_outside_the_checkout():
    from backend import db
    path = Path(db._default_db_path()).resolve()
    if ROOT in path.parents:
        rel = path.relative_to(ROOT)
        assert subprocess.run(["git", "check-ignore", "-q", str(rel)], cwd=ROOT).returncode == 0
