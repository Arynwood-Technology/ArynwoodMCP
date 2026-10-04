"""The gateway is experimental and parked (docs/scope.md): an ordinary backend doesn't serve
/api/gateway. Only the daemon, or ARYNWOOD_ENABLE_GATEWAY=1, does."""

import os
import subprocess
import sys

import pytest

PROBE = "from backend.api import app; print(any(p.startswith('/api/gateway') for p in app.openapi()['paths']))"


def _serves_gateway(**env) -> bool:
    child = {k: v for k, v in os.environ.items() if k not in ("ARYNWOOD_ENABLE_GATEWAY", "ARYNWOOD_GATEWAY_DAEMON")}
    child.update(env)
    out = subprocess.run([sys.executable, "-c", PROBE], env=child, capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr[-2000:]
    return out.stdout.strip().splitlines()[-1] == "True"


@pytest.mark.parametrize("env, served", [
    ({}, False),
    ({"ARYNWOOD_ENABLE_GATEWAY": "1"}, True),
    ({"ARYNWOOD_GATEWAY_DAEMON": "1"}, True),
])
def test_gateway_api_is_served_only_when_enabled(env, served):
    assert _serves_gateway(**env) is served
