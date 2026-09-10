"""_validate_tool_arguments and its wiring into run_tool_loop (roadmap 2.4)."""

import json
from unittest.mock import AsyncMock

from backend.services.mcp_tool_agent import _validate_tool_arguments, run_tool_loop

SCHEMA = {
    "type": "object",
    "properties": {
        "track_id": {"type": "integer"},
        "name": {"type": "string"},
        "enabled": {"type": "boolean"},
    },
    "required": ["track_id"],
}


def test_valid_arguments_produce_no_problems():
    assert _validate_tool_arguments({"track_id": 1, "name": "Intro"}, SCHEMA) == []


def test_missing_required_argument():
    problems = _validate_tool_arguments({"name": "Intro"}, SCHEMA)
    assert any("track_id" in p for p in problems)


def test_wrong_type_string_instead_of_integer():
    problems = _validate_tool_arguments({"track_id": "one"}, SCHEMA)
    assert any("track_id" in p and "integer" in p for p in problems)


def test_bool_does_not_satisfy_integer():
    """Python's bool is a subclass of int — a naive isinstance(x, int) check would
    wrongly accept True/False for an integer argument."""
    problems = _validate_tool_arguments({"track_id": True}, SCHEMA)
    assert any("track_id" in p for p in problems)


def test_real_bool_satisfies_boolean():
    assert _validate_tool_arguments({"track_id": 1, "enabled": True}, SCHEMA) == []


def test_unknown_property_is_ignored():
    """Extra arguments not declared in the schema aren't this validator's job to
    reject — the MCP server itself can do that; this only checks what it recognizes."""
    assert _validate_tool_arguments({"track_id": 1, "mystery_field": "x"}, SCHEMA) == []


def test_non_dict_schema_returns_no_problems():
    assert _validate_tool_arguments({"anything": 1}, None) == []


def _decision(tool_name: str, arguments: dict):
    return {"output": json.dumps({"name": tool_name, "arguments": arguments}), "tool_calls": None}


def _final(text: str):
    return {"output": text, "tool_calls": None}


async def test_invalid_call_never_reaches_the_server_and_model_gets_repair_message(monkeypatch):
    import backend.services.mcp_tool_agent as mod

    monkeypatch.setattr(mod, "_load_servers", lambda: {"kdenlive": {"url": "http://x"}})
    monkeypatch.setattr(mod.ollama_client, "context_length", AsyncMock(return_value=8192))

    tools_list = {"tools": [{"name": "set_track_mute", "description": "", "inputSchema": {
        "type": "object", "properties": {"track_id": {"type": "integer"}}, "required": ["track_id"],
    }}]}
    mcp_post = AsyncMock(side_effect=[tools_list])  # tools/call must never be reached
    chat = AsyncMock(side_effect=[
        _decision("set_track_mute", {"track_id": "not-a-number"}),
        _final("Sorry, I had trouble with that."),
    ])
    monkeypatch.setattr(mod, "_mcp_post", mcp_post)
    monkeypatch.setattr(mod.ollama_client, "chat", chat)

    result = await run_tool_loop("kdenlive", "sys", "mute track 1", "Kdenlive")

    assert mcp_post.call_count == 1  # only tools/list
    second_round_messages = chat.call_args_list[1].kwargs["messages"]
    repair_msg = next(m for m in second_round_messages if m["role"] == "tool")
    assert "INVALID CALL" in repair_msg["content"]
    assert "integer" in repair_msg["content"]
    assert "Sorry, I had trouble with that." in result


async def test_unknown_tool_name_gets_a_repair_message_not_a_server_error(monkeypatch):
    import backend.services.mcp_tool_agent as mod

    monkeypatch.setattr(mod, "_load_servers", lambda: {"kdenlive": {"url": "http://x"}})
    monkeypatch.setattr(mod.ollama_client, "context_length", AsyncMock(return_value=8192))

    tools_list = {"tools": [{"name": "get_track_list", "description": "", "inputSchema": {"type": "object"}}]}
    mcp_post = AsyncMock(side_effect=[tools_list])
    chat = AsyncMock(side_effect=[
        _decision("delete_all_tracks_forever", {}),  # hallucinated tool name
        _final("I couldn't find that tool."),
    ])
    monkeypatch.setattr(mod, "_mcp_post", mcp_post)
    monkeypatch.setattr(mod.ollama_client, "chat", chat)

    result = await run_tool_loop("kdenlive", "sys", "do something", "Kdenlive")

    assert mcp_post.call_count == 1
    second_round_messages = chat.call_args_list[1].kwargs["messages"]
    repair_msg = next(m for m in second_round_messages if m["role"] == "tool")
    assert "no tool named" in repair_msg["content"]
    assert "I couldn't find that tool." in result
