"""Live-model behavior evals (roadmap 3.3) — distinct from the rest of this suite:
these assert on actual Ollama output, not mocked responses, so they cover the parts
of the system that are genuinely probabilistic instead of just the deterministic
wiring around them. Slower, and technically non-deterministic (though temperature=0
keeps results close from run to run) — excluded from the default test run (see
pytest.ini's `-m "not eval"`). Run explicitly when Ollama is up and you want to
check the probabilistic behavior hasn't regressed:

    pytest tests/test_evals_live_behavior.py -m eval -v

Each case is a real, plausible message a user would actually type — not a synthetic
prompt-engineering exercise — because that's the only thing worth measuring here.
"""

import asyncio

import pytest

from backend.routers.chat import _stream_reply, _NATIVE_TOOLS, build_system_prompt, get_personas
from backend.services import mcp_tool_agent, ollama_client

pytestmark = pytest.mark.eval


def _ollama_is_up() -> bool:
    try:
        return asyncio.run(ollama_client.is_reachable(timeout=2.0))
    except Exception:
        return False


skip_if_ollama_down = pytest.mark.skipif(not _ollama_is_up(), reason="Ollama is not reachable on localhost:11434")


class _RecordingWebSocket:
    def __init__(self):
        self.sent = []

    async def send_json(self, msg):
        self.sent.append(msg)


# ── Kdenlive gate classification accuracy (roadmap 2.2) ─────────────────────────

KDENLIVE_GATE = {
    "label": "Kdenlive",
    "hints": [
        "kdenlive", "video timeline", "video editor", "video editing",
        "video clip", "video track", "video marker", "video project",
        "render the video", "cross-dissolve", "crossdissolve",
        "subtitle track", "proxy clip", "b-roll",
    ],
}

GATE_CASES = [
    ("Can you cross-dissolve between my clips on the timeline?", True),
    ("Render the video to mp4 please", True),
    ("How do I add a proxy clip in my project?", True),
    ("What's the weather like today?", False),
    ("Can you write me a haiku about the ocean?", False),
    ("What is the best way to loop this DJ track?", False),  # adversarial: video-adjacent wording, wrong domain
]


@skip_if_ollama_down
@pytest.mark.parametrize("message,expected", GATE_CASES)
async def test_kdenlive_gate_classifies_correctly(message, expected):
    result = await mcp_tool_agent._gate_matches(message, KDENLIVE_GATE)
    assert result == expected, f"expected {expected} for {message!r}, got {result}"


# ── Native web_search: does the model reach for it when it should, and only then
#    (roadmap 2.1) — the point of native tool-calling is that this is a judgment
#    call, not a keyword match, so it's evaluated here rather than unit-tested. ──

WEB_SEARCH_CASES = [
    ("What is the current price of Bitcoin in USD right now?", True),
    ("What's the weather in Seattle right now?", True),
    ("Write a haiku about autumn leaves.", False),
    ("What is 7 times 6?", False),
]
# "Who won the most recent Super Bowl?" was tried here and dropped — confirmed
# genuinely flaky at the model level (2 passes, 2 fails across 4 runs with zero
# code changes in between), not a regression signal: sports results can partially
# predate a training cutoff, so the model's decide-to-search judgment sits right on
# a coin-flip for that one. Weather can never be answered from training data, so it
# doesn't have that ambiguity. A flaky case teaches the suite to cry wolf — better
# to swap it for one that actually discriminates real regressions from noise.


@skip_if_ollama_down
@pytest.mark.parametrize("message,expected_search", WEB_SEARCH_CASES)
async def test_native_web_search_decision(monkeypatch, message, expected_search):
    called_tools = []

    async def fake_call_native_tool(name, arguments, db):
        called_tools.append(name)
        return "mocked result — not a real search, this eval only checks the *decision* to call it"

    monkeypatch.setattr("backend.routers.chat._call_native_tool", fake_call_native_tool)

    # The real system prompt central actually ships with, not a hand-rolled stand-in
    # — a bare-bones prompt with nothing but a tool list measurably over-triggers
    # tool use (confirmed while building this eval: it called web_search on "What is
    # 7 times 6?"), while the real prompt's fuller framing does not. Testing the
    # stand-in would have been evaluating a scenario that doesn't ship.
    central = get_personas()["central"]
    system_prompt = build_system_prompt(central, "", [], "", has_native_tools=True)

    ws = _RecordingWebSocket()
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": message},
    ]
    await _stream_reply(ws, messages, "qwen2.5-coder:14b", "localhost", 11434, 8192, db=None, tools=_NATIVE_TOOLS)

    called_search = "web_search" in called_tools
    assert called_search == expected_search, (
        f"message={message!r} expected web_search called={expected_search}, got {called_search} "
        f"(tools called: {called_tools})"
    )
