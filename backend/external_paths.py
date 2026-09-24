"""Where this app looks for tools that live *outside* the repo.

GPU tools (kohya_ss, AnimateDiff, Whisper, SadTalker, Chatterbox), the A1111 model
directories, the MusicStudio sidecars and the Sycamore PDF parser are all separate
checkouts/venvs with their own heavy torch stacks, so none of them can be bundled.
These paths used to be hardcoded to one developer's home directory, which meant every
one of those features failed on any other machine — even from a source checkout.

Every location resolves the same way, first hit wins:

1. its own env var (e.g. ``ARYNWOOD_KOHYA_DIR``)
2. the shared root env var for its group (``ARYNWOOD_TOOLS_DIR`` / ``ARYNWOOD_SERVICES_DIR``
   / ``ARYNWOOD_PROJECTS_DIR``)
3. a conventional default under ``$HOME`` (``~/tools``, ``~/services``, ``~/GitHub``)

Set overrides in the ``.env`` next to the app (repo root in a source checkout,
``~/.local/share/arynwood-mcp/.env`` in a packaged build); ``backend/api.py`` loads it
before any router imports this module, and subprocesses inherit the environment, so
the standalone ``scripts/run_*.py`` helpers see the same overrides. Those scripts can't
import this module (they run under a different interpreter), so they repeat the small
env-then-default lookup inline — keep the env var names in sync with the ones below.

Nothing here checks that a path exists: a missing tool should surface as that tool's own
"not installed" state, not as an import-time crash.
"""
import os


def _home(*parts: str) -> str:
    return os.path.join(os.path.expanduser("~"), *parts)


def _env(name: str, default: str) -> str:
    return os.environ.get(name) or default


TOOLS_DIR = _env("ARYNWOOD_TOOLS_DIR", _home("tools"))
SERVICES_DIR = _env("ARYNWOOD_SERVICES_DIR", _home("services"))
PROJECTS_DIR = _env("ARYNWOOD_PROJECTS_DIR", _home("GitHub"))

# ── Under TOOLS_DIR ────────────────────────────────────────────────────────────────
KOHYA_SS_DIR = _env("ARYNWOOD_KOHYA_DIR", os.path.join(TOOLS_DIR, "kohya_ss"))
ANIMATEDIFF_DIR = _env("ARYNWOOD_ANIMATEDIFF_DIR", os.path.join(TOOLS_DIR, "AnimateDiff"))
WHISPER_VENV = _env("ARYNWOOD_WHISPER_VENV", os.path.join(TOOLS_DIR, "whisper-venv"))
SADTALKER_DIR = _env("ARYNWOOD_SADTALKER_DIR", os.path.join(TOOLS_DIR, "sad-talker"))
SADTALKER_PYTHON = _env("ARYNWOOD_SADTALKER_PYTHON", _home("miniconda3", "envs", "sadtalker", "bin", "python"))
CHATTERBOX_VENV = _env("ARYNWOOD_CHATTERBOX_VENV", os.path.join(TOOLS_DIR, "chatterbox-venv"))

# ── Under SERVICES_DIR (the A1111 docker-compose project's bind mounts) ───────────
A1111_DIR = _env("ARYNWOOD_A1111_DIR", os.path.join(SERVICES_DIR, "a1111"))
A1111_CHECKPOINTS_DIR = _env(
    "ARYNWOOD_A1111_CHECKPOINTS_DIR", os.path.join(A1111_DIR, "data", "models", "Stable-diffusion"))
A1111_LORA_DIR = _env(
    "ARYNWOOD_A1111_LORA_DIR", os.path.join(A1111_DIR, "data", "models", "Lora"))

# ── Under PROJECTS_DIR (sibling repos) ─────────────────────────────────────────────
MUSICSTUDIO_DIR = _env("ARYNWOOD_MUSICSTUDIO_DIR", os.path.join(PROJECTS_DIR, "MusicStudio"))
SYCAMORE_REPO_DIR = _env(
    "ARYNWOOD_SYCAMORE_DIR", os.path.join(PROJECTS_DIR, "sycamore", "lib", "sycamore"))


# Arynwood Community (optional sidecar) — a local checkout of its official repo.
COMMUNITY_DIR = _env("ARYNWOOD_COMMUNITY_DIR", os.path.join(PROJECTS_DIR, "arynwood-community"))
# TODO(community-repo): PLACEHOLDER — the official repo under the Arynwood-Technology GitHub org
# hasn't been created yet. Once it exists, set the real URL here (the UI and docs read it from
# here) and update every other `TODO(community-repo)` marker (`grep -rn "TODO(community-repo)"`).
COMMUNITY_REPO_URL = "https://github.com/Arynwood-Technology/arynwood-community"


def venv_python(venv_dir: str) -> str:
    """Interpreter inside a venv directory (Linux layout — this app is Linux-only)."""
    return os.path.join(venv_dir, "bin", "python")
