"""The database holds OAuth tokens, server tokens and the owner's Grove session, so only the owner may read it.

Found 2026-10-23 in the security pass: config/arynwood.db (and the packaged build's copy) was 0644."""
import asyncio
import os
import stat
import sys

import pytest

from backend import db

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="chmod only toggles read-only on Windows")


def mode(path):
    return stat.S_IMODE(os.stat(path).st_mode)


def test_a_new_database_is_created_owner_only(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", str(tmp_path / "arynwood.db"))
    asyncio.run(db.init_db())
    assert mode(tmp_path / "arynwood.db") == 0o600


def test_an_existing_database_and_its_wal_files_become_owner_only(tmp_path, monkeypatch):
    path = tmp_path / "arynwood.db"
    for name in ("arynwood.db", "arynwood.db-wal", "arynwood.db-shm"):
        (tmp_path / name).write_bytes(b"")
        os.chmod(tmp_path / name, 0o644)
    monkeypatch.setattr(db, "DB_PATH", str(path))
    asyncio.run(db.init_db())
    for name in ("arynwood.db", "arynwood.db-wal", "arynwood.db-shm"):
        assert mode(tmp_path / name) == 0o600, name


def test_the_default_data_folder_is_closed_but_a_chosen_one_is_left_alone(tmp_path, monkeypatch):
    chosen = tmp_path / "chosen"; chosen.mkdir(); os.chmod(chosen, 0o755)
    db.restrict_to_owner(str(chosen / "arynwood.db"))      # ARYNWOOD_DB_PATH is set for the test suite
    assert mode(chosen) == 0o755
    default = tmp_path / "default"; default.mkdir(); os.chmod(default, 0o755)
    monkeypatch.delenv("ARYNWOOD_DB_PATH")
    db.restrict_to_owner(str(default / "arynwood.db"))
    assert mode(default) == 0o700 and mode(default / "arynwood.db") == 0o600
