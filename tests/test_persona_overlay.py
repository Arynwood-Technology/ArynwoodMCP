"""Personal personas are data, not code: they live in a file OUTSIDE the repo that is merged
over the bundled personas at runtime, so they can never be committed or shipped by accident."""
import json
import os
import sys
from pathlib import Path

import pytest

from backend.routers import chat

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_PERSONA_IDS = {"central", "doc", "kona", "glyph", "estra", "sad-talker"}


def _persona(name="Tester", model="test-model:1b", **extra):
    return {"name": name, "role": "Test", "llm": {"model": model}, "system": "be brief", **extra}


@pytest.fixture()
def overlay(monkeypatch, tmp_path):
    """Point the overlay at a temp file and return a writer for it."""
    path = tmp_path / "personas.local.json"
    monkeypatch.setenv("ARYNWOOD_PERSONAS_FILE", str(path))

    def write(content):
        path.write_text(content if isinstance(content, str) else json.dumps(content))
        return path
    return write


def test_bundled_personas_are_exactly_the_public_set():
    bundled = json.loads((ROOT / "mcp" / "config" / "models.json").read_text())
    assert set(bundled) == PUBLIC_PERSONA_IDS, (
        "mcp/config/models.json ships in the public app. A persona that is yours alone belongs in "
        "your personas.local.json (docs/customizing-personas.md); a new public one belongs here AND in "
        "PUBLIC_PERSONA_IDS above.")


def test_no_overlay_file_means_bundled_personas_only(client, monkeypatch, tmp_path):
    monkeypatch.setenv("ARYNWOOD_PERSONAS_FILE", str(tmp_path / "does-not-exist.json"))
    ids = {p["id"] for p in client.get("/api/chat/personas").json()}
    assert ids == PUBLIC_PERSONA_IDS - {"sad-talker"}


def test_overlay_adds_a_persona_to_the_picker(client, overlay):
    overlay({"mine": _persona("Mine", "my-model:7b")})
    mine = next(p for p in client.get("/api/chat/personas").json() if p["id"] == "mine")
    assert mine["name"] == "Mine" and mine["model"] == "my-model:7b"


def test_overlay_entry_replaces_a_bundled_persona_of_the_same_id(overlay):
    overlay({"doc": _persona("Doc", "swapped:3b")})
    personas = chat.load_personas()
    assert personas["doc"]["llm"]["model"] == "swapped:3b"
    assert "central" in personas                      # the rest of the bundle is untouched


@pytest.mark.parametrize("bad", ["{not json", "[1, 2, 3]", '"a string"', ""])
def test_malformed_overlay_is_ignored_and_never_breaks_chat(client, overlay, bad):
    overlay(bad)
    ids = {p["id"] for p in client.get("/api/chat/personas").json()}
    assert ids == PUBLIC_PERSONA_IDS - {"sad-talker"}


def test_non_object_entries_are_skipped_but_valid_ones_kept(overlay):
    overlay({"good": _persona(), "junk": "nope", "also_junk": [1]})
    personas = chat.load_personas()
    assert "good" in personas and "junk" not in personas and "also_junk" not in personas


def test_default_location_is_the_xdg_data_dir_not_the_repo(monkeypatch, tmp_path):
    monkeypatch.delenv("ARYNWOOD_PERSONAS_FILE", raising=False)
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path))
    expected = tmp_path / "arynwood-mcp" / "personas.local.json"
    assert Path(chat.personas_overlay_path()) == expected
    assert ROOT not in expected.parents               # outside the checkout => can't be committed


def test_same_location_when_packaged(monkeypatch, tmp_path):
    monkeypatch.delenv("ARYNWOOD_PERSONAS_FILE", raising=False)
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path))
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", "/tmp/fake-meipass", raising=False)
    assert Path(chat.personas_overlay_path()) == tmp_path / "arynwood-mcp" / "personas.local.json"


def test_a_symlinked_overlay_is_followed(monkeypatch, tmp_path):
    real = tmp_path / "private" / "personas.local.json"
    real.parent.mkdir()
    real.write_text(json.dumps({"linked": _persona("Linked")}))
    link = tmp_path / "data" / "personas.local.json"
    link.parent.mkdir()
    os.symlink(real, link)
    monkeypatch.setenv("ARYNWOOD_PERSONAS_FILE", str(link))
    assert "linked" in chat.load_personas()
