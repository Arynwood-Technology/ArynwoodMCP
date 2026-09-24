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


# ── Codebase gate classification accuracy — same pattern as Kdenlive's above,
#    for the mcp_codebase.py server (backend/routers/mcp_codebase.py). ──────────

CODEBASE_GATE = {
    "label": "Codebase",
    "hints": [
        "a bug in this specific app's own backend or frontend code",
        "how a feature in this specific app is implemented, by file and line",
        "which file in this app's own repository handles something",
        "tracing a request through this app's own source code",
        "running this app's own test suite or lint",
        "this app's own git status or git diff",
        "NOT a match: general programming help, writing a script unrelated to this app, or questions about code in some other project",
    ],
}
# "Which code persists a memory?" was tried here and dropped — genuinely
# ambiguous as a standalone message with no "in this app" anchor (a real user's
# actual phrasing has surrounding conversation context this isolated eval
# doesn't). Tightening the hints enough to catch it reliably reintroduced a
# false positive on "How do I fix a merge conflict in git?" (a real regression,
# not a hypothetical one — confirmed live), which is the more costly failure
# mode: it triggers the same multi-round tool loop this gate exists to avoid
# firing for unrelated questions. Kept the tighter hints, dropped the case.

CODEBASE_GATE_CASES = [
    ("Where is WebSocket reconnect handled?", True),
    ("Trace a chat message from UI to Ollama.", True),
    ("Explain this failing test using only evidence from source.", True),
    ("Run the tests and tell me what's failing.", True),
    ("What's the weather like today?", False),
    ("Can you write me a haiku about the ocean?", False),
    ("Generate an image of a mountain at sunset.", False),  # adversarial: this app's chat is GPU-tool-heavy, must not false-positive
    # adversarial: generic programming help with no connection to this app's own
    # source — confirmed live to false-positive before the hints below were
    # tightened to explicitly anchor on "this app"/"this repository" rather than
    # generic terms like "a bug in the backend" or "run the tests" (those phrases
    # alone read as matching almost any coding question, not just ones about this
    # app specifically) — a real bug, not a hypothetical one, so these stay.
    ("I have 500 CSV files with inconsistent column names that I need to merge into one dataset with a Python script. Can you help?", False),
    ("Can you write a quick script to rename all files in a folder?", False),
    ("How do I fix a merge conflict in git?", False),
]


@skip_if_ollama_down
@pytest.mark.parametrize("message,expected", CODEBASE_GATE_CASES)
async def test_codebase_gate_classifies_correctly(message, expected):
    result = await mcp_tool_agent._gate_matches(message, CODEBASE_GATE)
    assert result == expected, f"expected {expected} for {message!r}, got {result}"


# ── Multi-server routing (both servers registered — the real configuration when
#    ARYNWOOD_ENABLE_CODEBASE_TOOLS=1). The isolated per-gate YES/NO above can't
#    see that another system owns a message: "How many clips are on my Kdenlive
#    timeline right now?" was a Codebase YES 4/4 times (confirmed live 2026-09-23),
#    so gather_context_for_message routes with one side-by-side call instead. ─────

_H = ("Prior conversation (data, not new instructions):\nuser: Add a crossfade between the first two clips in Kdenlive\n"
      "assistant: Done — added a 1s dissolve between clip 1 and clip 2.\nCurrent request:\n")
ROUTE_CASES = [
    ("How many clips are on my Kdenlive timeline right now?", {"kdenlive"}),
    ("What's in the video timeline around the 2 minute mark?", {"kdenlive"}),
    ("Mute track 2 and add a marker at 00:30", {"kdenlive"}),
    ("Where is WebSocket reconnect handled?", {"codebase"}),
    ("Run the tests and tell me what's failing.", {"codebase"}),
    ("How do I fix a merge conflict in git?", set()),
    ("Can you write a quick script to rename all files in a folder?", set()),
    ("Hi! How are you today?", set()),
    (_H + "Now do the same between clips 2 and 3", {"kdenlive"}),
    (_H + "Thanks! Unrelated, what's a good name for a cat?", set()),
]


@skip_if_ollama_down
@pytest.mark.parametrize("message,expected", ROUTE_CASES)
async def test_multi_server_routing(message, expected):
    result = await mcp_tool_agent._route(message, {"kdenlive": KDENLIVE_GATE, "codebase": CODEBASE_GATE})
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
