"""What this computer can run, and whether CPU mode is on.

One program for every machine. Features stay visible and are marked with what they need;
CPU mode switches off the sidecars that need an NVIDIA GPU and tunes local chat for a CPU.
An endpoint (a remote model or image server, see the Servers page) bridges what's missing.

The owner sets CPU mode in Tools: "auto" (the default) turns it on when no NVIDIA GPU
answers nvidia-smi, "on"/"off" force it. An installer can preset the default with
ARYNWOOD_CPU_MODE=auto|on|off in the backend's .env; a choice made in Tools wins over it.
"""
import os
import shutil
import subprocess
from urllib.parse import urlparse

CPU_MODE_SETTING = "cpu_mode"
CPU_MODE_CHOICES = ("auto", "on", "off")

# Local chat on a CPU. The KV cache is held in RAM and grows with the context, and a
# smaller context sends less history to read, so CPU mode lowers the default ceiling
# (chat.MAX_NUM_CTX); a persona's own llm.num_ctx still wins. It can't go much lower:
# central's fixed request (persona prompt + tool definitions) is ~3,800 tokens by the
# uncalibrated estimate a fresh install uses, and 4096 refused every turn
# (tests/test_cpu_mode_and_endpoints.py checks the fit). The model stays loaded for an
# hour, because loading it from disk takes a minute or more on a small server. Background
# calls (history summaries, the memory conflict check) get CPU-sized timeouts.
CPU_NUM_CTX = 6144
CPU_KEEP_ALIVE = "60m"
CPU_TIMEOUT_SCALE = 10

_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "0.0.0.0"}

_gpu_present: bool | None = None
_setting: str | None = None          # the stored choice, loaded once and updated by set_setting


def nvidia_gpu_present() -> bool:
    """True when nvidia-smi lists at least one GPU. Checked once per process: a GPU doesn't
    come and go while the app runs, and nvidia-smi takes a noticeable moment."""
    global _gpu_present
    if _gpu_present is None:
        _gpu_present = False
        if shutil.which("nvidia-smi"):
            try:
                result = subprocess.run(["nvidia-smi", "-L"], capture_output=True, text=True, timeout=5)
                _gpu_present = result.returncode == 0 and "GPU" in result.stdout
            except Exception:
                _gpu_present = False
    return _gpu_present


def _env_default() -> str:
    value = os.environ.get("ARYNWOOD_CPU_MODE", "auto").strip().lower()
    return value if value in CPU_MODE_CHOICES else "auto"


async def load_setting(db) -> str:
    """The owner's choice (auto/on/off), falling back to the installer default."""
    global _setting
    try:
        async with db.execute("SELECT value FROM settings WHERE key=?", (CPU_MODE_SETTING,)) as cur:
            row = await cur.fetchone()
        stored = row["value"] if row else None
    except Exception:
        stored = None
    _setting = stored if stored in CPU_MODE_CHOICES else _env_default()
    return _setting


async def set_setting(db, value: str) -> None:
    global _setting
    if value not in CPU_MODE_CHOICES:
        raise ValueError(f"CPU mode must be one of {', '.join(CPU_MODE_CHOICES)}")
    await db.execute(
        "INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (CPU_MODE_SETTING, value))
    await db.commit()
    _setting = value


def enabled() -> bool:
    """Whether CPU mode is on right now. Uses the cached setting (load_setting runs at
    startup); before that, the installer default."""
    setting = _setting or _env_default()
    if setting == "auto":
        return not nvidia_gpu_present()
    return setting == "on"


def state() -> dict:
    return {"enabled": enabled(), "setting": _setting or _env_default(), "nvidia_gpu": nvidia_gpu_present()}


def is_local_host(host: str | None) -> bool:
    """Whether an Ollama host string (a bare name or a URL) is this computer."""
    if not host:
        return True
    name = urlparse(host).hostname if "://" in host else host.split(":")[0]
    return (name or "").strip("[]") in _LOCAL_HOSTS


def local_cpu(host: str | None) -> bool:
    """CPU mode applies to this call: it's on, and the model runs on this computer."""
    return enabled() and is_local_host(host)


def timeout(seconds: float, host: str | None = None) -> float:
    """A background call's timeout, stretched when the model runs on this computer's CPU."""
    return seconds * CPU_TIMEOUT_SCALE if local_cpu(host) else seconds


GPU_REQUIRED_DETAIL = ("{name} needs an NVIDIA GPU, and CPU mode is on. Turn CPU mode off in Tools "
                       "if this computer has one.")


def gpu_feature_refusal(name: str) -> str | None:
    """The message for a GPU-only feature while CPU mode is on, else None."""
    return GPU_REQUIRED_DETAIL.format(name=name) if enabled() else None
