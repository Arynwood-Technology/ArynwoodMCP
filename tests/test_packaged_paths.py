"""Portability contract for a packaged/other-machine install.

Two things used to break on any machine but the original developer's: (1) external
tool locations (kohya_ss, Whisper, A1111 dirs, MusicStudio, Sycamore...) were hardcoded
to one home directory, and (2) several routers found the repo root with a hand-rolled
`dirname(dirname(dirname(__file__)))`, which in a PyInstaller build lands in a temp
extraction dir wiped on every quit — silently losing generated files. The guard tests
below keep both from creeping back in.
"""
import importlib.util
import os
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
EXTERNAL_PATHS_FILE = ROOT / "backend" / "external_paths.py"


@pytest.fixture()
def frozen(monkeypatch):
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", "/tmp/fake-meipass", raising=False)


def _fresh_external_paths():
    """Load a private copy of the module so env changes take effect without disturbing
    the instance the routers already imported constants from."""
    spec = importlib.util.spec_from_file_location("external_paths_under_test", EXTERNAL_PATHS_FILE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ── restart contract ────────────────────────────────────────────────────────────


def test_status_reports_can_restart_in_source_checkout(client):
    assert client.get("/api/system/status").json()["can_restart"] is True


def test_status_reports_cannot_restart_when_frozen(client, frozen):
    assert client.get("/api/system/status").json()["can_restart"] is False


def test_restart_refused_when_frozen(client, frozen):
    r = client.post("/api/system/restart")
    assert r.status_code == 501
    assert "relaunch" in r.json()["detail"]


# ── external_paths resolution order: own env var > group root env var > $HOME default ──


@pytest.fixture()
def clean_env(monkeypatch):
    for name in list(os.environ):
        if name.startswith("ARYNWOOD_") and name.endswith(("_DIR", "_VENV", "_PYTHON")):
            monkeypatch.delenv(name, raising=False)
    return monkeypatch


def test_defaults_live_under_home(clean_env):
    ep = _fresh_external_paths()
    home = os.path.expanduser("~")
    assert ep.KOHYA_SS_DIR == os.path.join(home, "tools", "kohya_ss")
    assert ep.A1111_LORA_DIR == os.path.join(home, "services", "a1111", "data", "models", "Lora")
    assert ep.MUSICSTUDIO_DIR == os.path.join(home, "GitHub", "MusicStudio")
    assert ep.SYCAMORE_REPO_DIR == os.path.join(home, "GitHub", "sycamore", "lib", "sycamore")


def test_group_root_env_moves_everything_under_it(clean_env):
    clean_env.setenv("ARYNWOOD_TOOLS_DIR", "/opt/ai-tools")
    ep = _fresh_external_paths()
    assert ep.KOHYA_SS_DIR == "/opt/ai-tools/kohya_ss"
    assert ep.WHISPER_VENV == "/opt/ai-tools/whisper-venv"
    assert ep.venv_python(ep.CHATTERBOX_VENV) == "/opt/ai-tools/chatterbox-venv/bin/python"


def test_specific_env_beats_group_root(clean_env):
    clean_env.setenv("ARYNWOOD_TOOLS_DIR", "/opt/ai-tools")
    clean_env.setenv("ARYNWOOD_KOHYA_DIR", "/srv/kohya")
    ep = _fresh_external_paths()
    assert ep.KOHYA_SS_DIR == "/srv/kohya"
    assert ep.ANIMATEDIFF_DIR == "/opt/ai-tools/AnimateDiff"  # untouched sibling


def test_a1111_subdirs_follow_a1111_dir(clean_env):
    clean_env.setenv("ARYNWOOD_A1111_DIR", "/data/sd")
    ep = _fresh_external_paths()
    assert ep.A1111_CHECKPOINTS_DIR == "/data/sd/data/models/Stable-diffusion"
    assert ep.A1111_LORA_DIR == "/data/sd/data/models/Lora"


def test_empty_env_var_falls_back_to_default(clean_env):
    # `.env` files commonly contain `FOO=` placeholders — that must not become "".
    clean_env.setenv("ARYNWOOD_KOHYA_DIR", "")
    ep = _fresh_external_paths()
    assert ep.KOHYA_SS_DIR == os.path.join(os.path.expanduser("~"), "tools", "kohya_ss")


# ── guards against regressing to non-portable paths ─────────────────────────────


def _shipped_python_files():
    for sub in ("backend", "scripts"):
        for path in (ROOT / sub).rglob("*.py"):
            if "__pycache__" in path.parts:
                continue
            yield path


def test_no_hardcoded_home_directories_in_shipped_code():
    pattern = re.compile(r"/home/[A-Za-z0-9_.-]+/")
    offenders = []
    for path in _shipped_python_files():
        for lineno, line in enumerate(path.read_text(errors="replace").splitlines(), 1):
            if pattern.search(line):
                offenders.append(f"{path.relative_to(ROOT)}:{lineno}: {line.strip()[:100]}")
    assert not offenders, (
        "hardcoded /home/<user>/ path(s) — resolve via backend/external_paths.py "
        "(or the env-then-default lookup in standalone scripts):\n" + "\n".join(offenders)
    )


def test_no_file_relative_repo_root_chains_in_backend():
    # Resolve bundled payload with app_base_dir() and writable state with user_data_dir()
    # (backend/_frozen.py) — a __file__ chain points into a temp dir in a packaged build.
    chain = "os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))"
    offenders = [
        str(p.relative_to(ROOT)) for p in (ROOT / "backend").rglob("*.py")
        if chain in p.read_text(errors="replace")
    ]
    assert not offenders, f"use app_base_dir()/user_data_dir() instead of a __file__ chain: {offenders}"
