"""Headless gateway: the always-on side of the backend.

Runs agent turns with no desktop window attached, keyed by persistent sessions (an API
client, an IRC user or channel, a scheduled job), and exposes them over HTTP and
WebSocket at /api/gateway (backend/routers/gateway.py). `python -m backend.gateway`
starts the backend headless as that daemon. See docs/gateway.md.
"""

from backend.gateway.runner import (  # noqa: F401
    Gateway, GatewayBusy, InboundMessage, TurnResult, get_gateway, shutdown_gateway,
)
from backend.gateway.sessions import InvalidSession  # noqa: F401


def is_enabled() -> bool:
    """The gateway is experimental and parked: its API is served only by the daemon, or by a
    desktop backend started with ARYNWOOD_ENABLE_GATEWAY=1. See docs/scope.md."""
    import os
    return is_daemon() or os.environ.get("ARYNWOOD_ENABLE_GATEWAY") == "1"


def is_daemon() -> bool:
    """True when this process was started as the headless daemon (python -m backend.gateway),
    not as the desktop app's backend. Things that must run in exactly one process (a chat
    network connection, a scheduler) start only here."""
    import os
    return os.environ.get("ARYNWOOD_GATEWAY_DAEMON") == "1"
