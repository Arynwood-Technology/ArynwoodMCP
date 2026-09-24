import asyncio
from unittest.mock import AsyncMock, patch

from backend.services import mcp_tool_agent, ollama_client


# ── gather_context_for_message dispatch logic (gate matching mocked directly —
# _gate_matches' own classification behavior is covered separately below) ────────

def test_no_gates_configured_returns_empty(tmp_path, monkeypatch):
    monkeypatch.setattr(mcp_tool_agent, "_LOCAL_AGENT_DIR", tmp_path)
    assert asyncio.run(mcp_tool_agent.gather_context_for_message("anything")) == ("", [])


def test_unregistered_server_is_skipped_even_if_gate_would_match():
    with patch.object(mcp_tool_agent, "_load_gates", return_value={
        "kdenlive": {"label": "Kdenlive", "hints": ["kdenlive"]},
    }), patch.object(mcp_tool_agent, "_load_servers", return_value={}), \
         patch.object(mcp_tool_agent, "_gate_matches", new_callable=AsyncMock, return_value=True), \
         patch.object(mcp_tool_agent, "run_tool_loop", new_callable=AsyncMock) as run_loop:
        result, used = asyncio.run(mcp_tool_agent.gather_context_for_message("help me with kdenlive"))
    assert result == ""
    assert used == []
    run_loop.assert_not_called()


def test_registered_server_fires_when_gate_matches():
    with patch.object(mcp_tool_agent, "_load_gates", return_value={
        "kdenlive": {"label": "Kdenlive", "hints": ["kdenlive", "video timeline"]},
    }), patch.object(mcp_tool_agent, "_load_servers", return_value={"kdenlive": {"url": "http://x"}}), \
         patch.object(mcp_tool_agent, "_gate_matches", new_callable=AsyncMock, return_value=True), \
         patch.object(mcp_tool_agent, "load_system_prompt", return_value="sys prompt"), \
         patch.object(mcp_tool_agent, "run_tool_loop", new_callable=AsyncMock) as run_loop:
        run_loop.return_value = "[Kdenlive — live results]\nsomething happened"
        result, used = asyncio.run(mcp_tool_agent.gather_context_for_message("edit my video timeline"))

    run_loop.assert_called_once_with("kdenlive", "sys prompt", "edit my video timeline", "Kdenlive", approve=None)
    assert result == "[Kdenlive — live results]\nsomething happened"
    assert used == ["Kdenlive"]


def test_gate_does_not_fire_when_classifier_says_no():
    with patch.object(mcp_tool_agent, "_load_gates", return_value={
        "kdenlive": {"label": "Kdenlive", "hints": ["kdenlive"]},
    }), patch.object(mcp_tool_agent, "_load_servers", return_value={"kdenlive": {"url": "http://x"}}), \
         patch.object(mcp_tool_agent, "_gate_matches", new_callable=AsyncMock, return_value=False), \
         patch.object(mcp_tool_agent, "run_tool_loop", new_callable=AsyncMock) as run_loop:
        result, used = asyncio.run(mcp_tool_agent.gather_context_for_message("what's the weather today"))
    assert result == ""
    assert used == []
    run_loop.assert_not_called()


def test_multiple_matching_servers_concatenate():
    with patch.object(mcp_tool_agent, "_load_gates", return_value={
        "kdenlive": {"label": "Kdenlive", "hints": ["render"]},
        "orbit": {"label": "Orbit", "hints": ["render"]},
    }), patch.object(mcp_tool_agent, "_load_servers", return_value={
        "kdenlive": {"url": "http://x"}, "orbit": {"url": "http://y"},
    }), patch.object(mcp_tool_agent, "_route", new_callable=AsyncMock, return_value={"kdenlive", "orbit"}), \
         patch.object(mcp_tool_agent, "load_system_prompt", return_value="sys"), \
         patch.object(mcp_tool_agent, "run_tool_loop", new_callable=AsyncMock) as run_loop:
        run_loop.side_effect = ["[Kdenlive — live results]\nA", "[Orbit — live results]\nB"]
        result, used = asyncio.run(mcp_tool_agent.gather_context_for_message("render this"))

    assert "[Kdenlive — live results]\nA" in result
    assert "[Orbit — live results]\nB" in result
    assert used == ["Kdenlive", "Orbit"]


def test_only_the_routed_server_fires():
    """Two gates sharing a hint word no longer have to collide — with more than one
    server registered, a single routing call picks between them side by side."""
    async def fake_route(message, candidates):
        assert set(candidates) == {"kdenlive", "orbit"}
        return {"kdenlive"}

    with patch.object(mcp_tool_agent, "_load_gates", return_value={
        "kdenlive": {"label": "Kdenlive", "hints": ["render"]},
        "orbit": {"label": "Orbit", "hints": ["render"]},
    }), patch.object(mcp_tool_agent, "_load_servers", return_value={
        "kdenlive": {"url": "http://x"}, "orbit": {"url": "http://y"},
    }), patch.object(mcp_tool_agent, "_route", side_effect=fake_route), \
         patch.object(mcp_tool_agent, "load_system_prompt", return_value="sys"), \
         patch.object(mcp_tool_agent, "run_tool_loop", new_callable=AsyncMock) as run_loop:
        run_loop.return_value = "[Kdenlive — live results]\nA"
        result, used = asyncio.run(mcp_tool_agent.gather_context_for_message("render this"))

    assert used == ["Kdenlive"]
    run_loop.assert_called_once()


# ── _gate_matches itself ──────────────────────────────────────────────────────────

def test_gate_matches_true_on_yes_response(monkeypatch):
    async def fake_chat(**kwargs):
        return {"output": "YES"}
    monkeypatch.setattr(ollama_client, "chat", fake_chat)
    assert asyncio.run(mcp_tool_agent._gate_matches("edit my timeline", {"label": "Kdenlive", "hints": []})) is True


def test_gate_matches_false_on_no_response(monkeypatch):
    async def fake_chat(**kwargs):
        return {"output": "NO"}
    monkeypatch.setattr(ollama_client, "chat", fake_chat)
    assert asyncio.run(mcp_tool_agent._gate_matches("what's the weather", {"label": "Kdenlive", "hints": []})) is False


def test_gate_matches_false_on_classifier_failure(monkeypatch):
    async def fake_chat(**kwargs):
        raise ConnectionError("ollama unreachable")
    monkeypatch.setattr(ollama_client, "chat", fake_chat)
    assert asyncio.run(mcp_tool_agent._gate_matches("anything", {"label": "Kdenlive", "hints": []})) is False


def test_gate_matches_tolerates_extra_words_around_yes(monkeypatch):
    async def fake_chat(**kwargs):
        return {"output": "Yes, this is about Kdenlive."}
    monkeypatch.setattr(ollama_client, "chat", fake_chat)
    assert asyncio.run(mcp_tool_agent._gate_matches("edit my timeline", {"label": "Kdenlive", "hints": []})) is True


# ── _route (multi-server) ─────────────────────────────────────────────────────────

_TWO = {"kdenlive": {"label": "Kdenlive", "hints": ["timeline"]}, "codebase": {"label": "Codebase", "hints": ["source"]}}


def test_route_parses_named_systems(monkeypatch):
    async def fake_chat(**kwargs):
        return {"output": "kdenlive"}
    monkeypatch.setattr(ollama_client, "chat", fake_chat)
    assert asyncio.run(mcp_tool_agent._route("how many clips on my timeline", _TWO)) == {"kdenlive"}


def test_route_none_and_failure_select_nothing(monkeypatch):
    async def none_chat(**kwargs):
        return {"output": "NONE"}
    monkeypatch.setattr(ollama_client, "chat", none_chat)
    assert asyncio.run(mcp_tool_agent._route("hi there", _TWO)) == set()

    async def broken_chat(**kwargs):
        raise ConnectionError("ollama unreachable")
    monkeypatch.setattr(ollama_client, "chat", broken_chat)
    assert asyncio.run(mcp_tool_agent._route("anything", _TWO)) == set()


def test_disabled_codebase_server_is_never_offered(monkeypatch):
    monkeypatch.delenv("ARYNWOOD_ENABLE_CODEBASE_TOOLS", raising=False)
    with patch.object(mcp_tool_agent, "_load_gates", return_value=_TWO), \
         patch.object(mcp_tool_agent, "_load_servers", return_value={"kdenlive": {"url": "x"}, "codebase": {"url": "y"}}), \
         patch.object(mcp_tool_agent, "_gate_matches", new_callable=AsyncMock, return_value=False) as gate, \
         patch.object(mcp_tool_agent, "_route", new_callable=AsyncMock) as route:
        assert mcp_tool_agent.available_servers() == ["Kdenlive"]
        asyncio.run(mcp_tool_agent.gather_context_for_message("where is the websocket code"))
    route.assert_not_called()          # only one enabled server left → single gate
    assert gate.await_args.args[1]["label"] == "Kdenlive"
