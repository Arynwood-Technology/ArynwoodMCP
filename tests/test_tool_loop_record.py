"""The persona must learn what the tool loop really did, whatever the model writes.

Found live on 2026-10-04 with hermes3:8b against Cutroom: the loop ran find_clip and an
approved delete_clip ("Deleted clip 5"), then ended with no summary, so run_tool_loop
returned "" and the persona told the user it had no access to the timeline and how to
delete the clip by hand. The loop now hands over a factual record of every call, and
chat_ws prefixes it with a note that those calls really ran."""

import json
from unittest.mock import AsyncMock

import pytest

from backend.services import mcp_tool_agent, tool_policy

TOOLS = {"tools": [
    {"name": "delete_clip", "description": "Delete a clip",
     "inputSchema": {"type": "object", "properties": {"clip_id": {"type": "integer"}}, "required": ["clip_id"]}},
    {"name": "find_clip", "description": "Find a clip's id by name",
     "inputSchema": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]}},
]}


def _call(tool, **arguments):
    return {"output": json.dumps({"name": tool, "arguments": arguments}), "tool_calls": None}


def _say(text):
    return {"output": text, "tool_calls": None}


@pytest.fixture(autouse=True)
def _stub(monkeypatch):
    monkeypatch.setattr(mcp_tool_agent, "_load_servers", lambda: {"kdenlive": {"url": "http://x"}})
    monkeypatch.setattr(mcp_tool_agent.ollama_client, "context_length", AsyncMock(return_value=8192))


async def test_an_approved_action_is_recorded_even_when_the_model_writes_no_summary(monkeypatch):
    monkeypatch.setattr(mcp_tool_agent, "_mcp_post", AsyncMock(side_effect=[
        TOOLS,
        {"content": [{"type": "text", "text": "red.mp4: clip_id 5"}]},
        {"content": [{"type": "text", "text": "Deleted clip 5"}]},
    ]))
    monkeypatch.setattr(mcp_tool_agent.ollama_client, "chat", AsyncMock(side_effect=[
        _call("find_clip", name="red.mp4"), _call("delete_clip", clip_id=5), _say("")]))

    block = await mcp_tool_agent.run_tool_loop("kdenlive", "sys", "delete the red clip", "Kdenlive",
                                               approve=AsyncMock(return_value=True))
    assert block.startswith("[Kdenlive — live results]")
    assert '- find_clip {"name": "red.mp4"}: done: red.mp4: clip_id 5' in block
    assert '- delete_clip {"clip_id": 5}: done: Deleted clip 5' in block


async def test_a_denied_action_is_recorded_as_not_run(monkeypatch):
    monkeypatch.setattr(mcp_tool_agent, "_mcp_post", AsyncMock(side_effect=[TOOLS]))
    monkeypatch.setattr(mcp_tool_agent.ollama_client, "chat", AsyncMock(side_effect=[
        _call("delete_clip", clip_id=11), _say("I didn't delete it.")]))

    block = await mcp_tool_agent.run_tool_loop("kdenlive", "sys", "delete the blue clip", "Kdenlive",
                                               approve=AsyncMock(return_value=False))
    assert '- delete_clip {"clip_id": 11}: DENIED, so it was not run' in block
    assert "Summary: I didn't delete it." in block


async def test_a_loop_that_calls_nothing_says_so(monkeypatch):
    """Returning "" here left the persona free to improvise; seen live, it made a spreadsheet."""
    monkeypatch.setattr(mcp_tool_agent, "_mcp_post", AsyncMock(side_effect=[TOOLS]))
    monkeypatch.setattr(mcp_tool_agent.ollama_client, "chat", AsyncMock(side_effect=[_say("")]))

    block = await mcp_tool_agent.run_tool_loop("kdenlive", "sys", "delete the blue clip", "Kdenlive")
    assert block == "[Kdenlive — live results]\nNo Kdenlive tool was called for this request, so nothing was changed."


def test_find_clip_is_a_read_only_lookup():
    assert tool_policy.classify_tool_tier("find_clip") == tool_policy.TIER_READ_ONLY


async def test_an_error_returned_as_a_successful_result_counts_as_failed(monkeypatch):
    """mcp-kdenlive returns errors as successful MCP results; the reply must not call them done."""
    from backend.services import runtime_context
    monkeypatch.setattr(mcp_tool_agent, "_mcp_post", AsyncMock(side_effect=[
        TOOLS, {"content": [{"type": "text", "text": "ERROR: Cutroom (Kdenlive) isn't running"}]}]))
    monkeypatch.setattr(mcp_tool_agent.ollama_client, "chat", AsyncMock(side_effect=[
        _call("delete_clip", clip_id=4), _say("The red clip has been deleted.")]))
    token = runtime_context.evidence.set([])
    try:
        block = await mcp_tool_agent.run_tool_loop("kdenlive", "sys", "delete the red clip", "Kdenlive",
                                                   approve=AsyncMock(return_value=True))
        facts = mcp_tool_agent.tool_outcome_facts(runtime_context.evidence.get())
    finally:
        runtime_context.evidence.reset(token)
    assert "failed: ERROR: Cutroom (Kdenlive) isn't running" in block
    assert "delete_clip {\"clip_id\": 4}: failed, so it did not complete" in facts
    assert "Never say a denied, rejected or failed action happened." in facts


def test_outcome_facts_say_a_denied_action_did_not_run():
    facts = mcp_tool_agent.tool_outcome_facts([
        {"kind": "tool_action", "tool": "delete_clip", "arguments": '{"clip_id": 11}', "outcome": "denied"},
        {"kind": "trust"}])
    assert 'delete_clip {"clip_id": 11}: was DENIED by the user, so it did not run and nothing changed' in facts
    assert mcp_tool_agent.tool_outcome_facts([{"kind": "memory"}]) == ""
