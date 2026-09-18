"""run_tool_loop's approval gate (roadmap 2.3) — the safety-critical property under
test throughout this file: a destructive-tier tool call must never reach the real
MCP server (_mcp_post) unless an approval callback explicitly says yes."""

import json
from unittest.mock import AsyncMock

import pytest

from backend.services import mcp_tool_agent

TOOLS_LIST_RESULT = {
    "tools": [
        {"name": "delete_track", "description": "Delete a track", "inputSchema": {"type": "object"}},
        {"name": "get_track_list", "description": "List tracks", "inputSchema": {"type": "object"}},
    ]
}


def _decision(tool_name: str, arguments: dict | None = None):
    """One non-streaming chat() response that calls the given tool."""
    return {"output": json.dumps({"name": tool_name, "arguments": arguments or {}}), "tool_calls": None}


def _final(text: str):
    return {"output": text, "tool_calls": None}


@pytest.fixture(autouse=True)
def _stub_server(monkeypatch):
    monkeypatch.setattr(mcp_tool_agent, "_load_servers", lambda: {"kdenlive": {"url": "http://x"}})
    monkeypatch.setattr(mcp_tool_agent.ollama_client, "context_length", AsyncMock(return_value=8192))


async def test_destructive_call_denied_by_default_with_no_approval_callback(monkeypatch):
    mcp_post = AsyncMock(side_effect=[
        TOOLS_LIST_RESULT,  # tools/list
        # tools/call must NEVER be reached — if it is, side_effect runs out and raises
    ])
    chat = AsyncMock(side_effect=[_decision("delete_track"), _final("I could not delete the track.")])
    monkeypatch.setattr(mcp_tool_agent, "_mcp_post", mcp_post)
    monkeypatch.setattr(mcp_tool_agent.ollama_client, "chat", chat)

    result = await mcp_tool_agent.run_tool_loop("kdenlive", "sys", "delete the intro track", "Kdenlive")

    assert mcp_post.call_count == 1  # only tools/list — tools/call was never attempted
    assert "I could not delete the track." in result
    # The model must have been told about the denial (appears in its next-round context).
    denial_seen_by_model = chat.call_args_list[1].kwargs["messages"]
    assert any("DENIED" in m.get("content", "") for m in denial_seen_by_model)


async def test_destructive_call_proceeds_when_approved(monkeypatch):
    mcp_post = AsyncMock(side_effect=[
        TOOLS_LIST_RESULT,
        {"content": [{"type": "text", "text": "Track deleted."}]},  # tools/call
    ])
    chat = AsyncMock(side_effect=[_decision("delete_track"), _final("Done — deleted the track.")])
    monkeypatch.setattr(mcp_tool_agent, "_mcp_post", mcp_post)
    monkeypatch.setattr(mcp_tool_agent.ollama_client, "chat", chat)

    approve = AsyncMock(return_value=True)
    result = await mcp_tool_agent.run_tool_loop("kdenlive", "sys", "delete the intro track", "Kdenlive", approve=approve)

    assert mcp_post.call_count == 2  # tools/list AND tools/call
    approve.assert_called_once_with("delete_track", {}, mcp_tool_agent.TIER_DESTRUCTIVE)
    assert "Done — deleted the track." in result


async def test_destructive_call_denied_when_approval_callback_says_no(monkeypatch):
    mcp_post = AsyncMock(side_effect=[TOOLS_LIST_RESULT])
    chat = AsyncMock(side_effect=[_decision("delete_track"), _final("Not deleted — you said no.")])
    monkeypatch.setattr(mcp_tool_agent, "_mcp_post", mcp_post)
    monkeypatch.setattr(mcp_tool_agent.ollama_client, "chat", chat)

    approve = AsyncMock(return_value=False)
    result = await mcp_tool_agent.run_tool_loop("kdenlive", "sys", "delete the intro track", "Kdenlive", approve=approve)

    assert mcp_post.call_count == 1  # tools/call never attempted
    approve.assert_called_once()
    assert "Not deleted" in result


async def test_read_only_call_never_consults_approval_callback(monkeypatch):
    mcp_post = AsyncMock(side_effect=[
        TOOLS_LIST_RESULT,
        {"content": [{"type": "text", "text": "track1, track2"}]},
    ])
    chat = AsyncMock(side_effect=[_decision("get_track_list"), _final("You have track1 and track2.")])
    monkeypatch.setattr(mcp_tool_agent, "_mcp_post", mcp_post)
    monkeypatch.setattr(mcp_tool_agent.ollama_client, "chat", chat)

    approve = AsyncMock(return_value=False)  # would deny if consulted — must not be consulted at all
    result = await mcp_tool_agent.run_tool_loop("kdenlive", "sys", "what tracks do I have", "Kdenlive", approve=approve)

    approve.assert_not_called()
    assert mcp_post.call_count == 2
    assert "track1 and track2" in result


def _tool_messages_seen_on_round_two(chat) -> list[str]:
    return [m["content"] for m in chat.call_args_list[1].kwargs["messages"] if m.get("role") == "tool"]


async def test_explicit_user_decline_is_reported_to_the_model_as_a_final_no(monkeypatch):
    """Found in a live run: after the user clicked Deny, the model replied "I need your
    confirmation to proceed — do you want to go ahead?", because the one shared DENIED
    text said the action "needs their explicit approval first". A real decline must tell
    the model the answer is no, nothing ran, and not to ask again."""
    mcp_post = AsyncMock(side_effect=[TOOLS_LIST_RESULT])
    chat = AsyncMock(side_effect=[_decision("delete_track"), _final("Okay, I did not delete it.")])
    monkeypatch.setattr(mcp_tool_agent, "_mcp_post", mcp_post)
    monkeypatch.setattr(mcp_tool_agent.ollama_client, "chat", chat)

    approve = AsyncMock(return_value=False)
    await mcp_tool_agent.run_tool_loop("kdenlive", "sys", "delete the intro track", "Kdenlive", approve=approve)

    (denial,) = _tool_messages_seen_on_round_two(chat)
    assert denial.startswith("DENIED")
    assert "declined" in denial
    assert "NOT run" in denial
    assert "do not ask" in denial.lower()
    # ...and must not invite the "please confirm" reply that a real decline should never get.
    assert "needs their explicit approval first" not in denial


async def test_no_approval_channel_is_worded_differently_from_a_user_decline(monkeypatch):
    """With no callback at all (a non-interactive caller) nobody was asked, so telling the
    model "the user declined" would be false — that path keeps the "needs approval" text."""
    mcp_post = AsyncMock(side_effect=[TOOLS_LIST_RESULT])
    chat = AsyncMock(side_effect=[_decision("delete_track"), _final("I could not delete the track.")])
    monkeypatch.setattr(mcp_tool_agent, "_mcp_post", mcp_post)
    monkeypatch.setattr(mcp_tool_agent.ollama_client, "chat", chat)

    await mcp_tool_agent.run_tool_loop("kdenlive", "sys", "delete the intro track", "Kdenlive")

    (denial,) = _tool_messages_seen_on_round_two(chat)
    assert denial.startswith("DENIED")
    assert "declined" not in denial
    assert "needs their explicit approval first" in denial
