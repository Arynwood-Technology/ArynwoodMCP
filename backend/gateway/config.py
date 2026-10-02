"""Gateway config: mcp/config/gateway/config.json with the user's overlay merged on top.

Same split as the personas: shared defaults ship with the app (app_base_dir()), anything
personal lives in the per-user data dir (xdg_data_dir()) in every build, so it can never be
committed. See mcp/config/gateway/README.md for the keys.
"""

from __future__ import annotations

import json
import logging
import os

from backend._frozen import app_base_dir, xdg_data_dir

logger = logging.getLogger(__name__)

CONFIG_PATH = os.path.join(app_base_dir(), "mcp", "config", "gateway", "config.json")

# Used only for keys missing from both files, the same way mcp_tool_agent falls back
# when local_agent/config.json is unreadable. The file is the source of truth.
_FALLBACK = {
    "bind_host": "127.0.0.1",
    "port": 8020,
    "session_defaults": {"persona": "central", "model": None, "server_id": None, "project_id": None},
    "max_concurrent_turns": 1,
    "max_queued_per_session": 8,
    "approval_timeout_seconds": 300,
    "turn_timeout_seconds": 1200,
    "trust_levels": {},  # nothing granted unless the config file grants it
    "file_memory": {"personas": []},  # no file memory unless the config file names personas
    "irc": {"enabled": False},
}


def overlay_path() -> str:
    return os.environ.get("ARYNWOOD_GATEWAY_CONFIG") or os.path.join(xdg_data_dir(), "gateway.json")


def _read(path: str) -> dict:
    try:
        with open(path) as f:
            data = json.load(f)
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as exc:
        logger.warning("gateway config %s ignored: %s", path, exc)
        return {}
    if not isinstance(data, dict):
        logger.warning("gateway config %s ignored: top level must be a JSON object", path)
        return {}
    return data


def _merge(base: dict, override: dict) -> dict:
    merged = dict(base)
    for key, value in override.items():
        if key.startswith("_"):
            continue  # "_comment" and friends
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def load_config() -> dict:
    return _merge(_merge(_FALLBACK, _read(CONFIG_PATH)), _read(overlay_path()))


def guest_note_path() -> str:
    return os.path.join(app_base_dir(), "mcp", "config", "gateway", "guest.md")


def trust_policy(config: dict, level: str) -> dict:
    """The capability switches for one trust level. A missing level or key is False, so a
    typo in the config withholds context instead of leaking it."""
    granted = (config.get("trust_levels") or {}).get(level) or {}
    return {key: granted.get(key) is True for key in CAPABILITIES}


CAPABILITIES = ("app_environment", "memories", "recent_conversations", "agent_notes", "knowledge_base",
                "web_search", "local_tools", "memory_writes")
