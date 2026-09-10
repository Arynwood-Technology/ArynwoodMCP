"""run_tool_loop's fallback-model escalation on repeated stalls (roadmap 2.6)."""

import json
from unittest.mock import AsyncMock

from backend.services import mcp_tool_agent

TOOLS_LIST_RESULT = {
    "tools": [{"name": "get_track_list", "description": "", "inputSchema": {"type": "object"}}]
}


def _decision(tool_name: str, arguments: dict | None = None):
    return {"output": json.dumps({"name": tool_name, "arguments": arguments or {}}), "tool_calls": None}


def _final(text: str):
    return {"output": text, "tool_calls": None}


async def test_escalates_after_threshold_stalls_when_gpu_is_free(monkeypatch):
    monkeypatch.setattr(mcp_tool_agent, "_load_servers", lambda: {"kdenlive": {"url": "http://x"}})
    monkeypatch.setattr(mcp_tool_agent, "FALLBACK_MODEL", "bigger-model:70b")
    monkeypatch.setattr(mcp_tool_agent, "STALL_ESCALATION_THRESHOLD", 2)
    monkeypatch.setattr(mcp_tool_agent.gpu_queue, "queue_depth", lambda: 0)

    context_length_calls = []

    async def fake_context_length(model, host=None):
        context_length_calls.append(model)
        return 32768

    monkeypatch.setattr(mcp_tool_agent.ollama_client, "context_length", fake_context_length)

    models_used = []

    async def fake_chat(*, model, messages, host, options, tools, timeout):
        models_used.append(model)
        # Repeat the exact same call every round to force stalls.
        if len(models_used) <= 3:
            return _decision("get_track_list")
        return _final("Got the tracks eventually.")

    mcp_post = AsyncMock(return_value=TOOLS_LIST_RESULT)
    monkeypatch.setattr(mcp_tool_agent, "_mcp_post", mcp_post)
    monkeypatch.setattr(mcp_tool_agent.ollama_client, "chat", fake_chat)

    result = await mcp_tool_agent.run_tool_loop(
        "kdenlive", "sys", "what tracks do I have", "Kdenlive", max_rounds=6,
    )

    # First call establishes the pattern, second is the first stall, third crosses
    # the threshold (2) and escalates — from then on the fallback model is used.
    assert "bigger-model:70b" in models_used
    assert models_used[0] != "bigger-model:70b"  # started on the original model
    assert "Got the tracks eventually." in result


async def test_does_not_escalate_when_gpu_is_busy(monkeypatch):
    monkeypatch.setattr(mcp_tool_agent, "_load_servers", lambda: {"kdenlive": {"url": "http://x"}})
    monkeypatch.setattr(mcp_tool_agent, "FALLBACK_MODEL", "bigger-model:70b")
    monkeypatch.setattr(mcp_tool_agent, "STALL_ESCALATION_THRESHOLD", 2)
    monkeypatch.setattr(mcp_tool_agent.gpu_queue, "queue_depth", lambda: 1)  # something else is using the GPU

    async def fake_context_length(model, host=None):
        return 32768
    monkeypatch.setattr(mcp_tool_agent.ollama_client, "context_length", fake_context_length)

    models_used = []

    async def fake_chat(*, model, messages, host, options, tools, timeout):
        models_used.append(model)
        return _decision("get_track_list")  # stalls forever — never gives a final answer

    mcp_post = AsyncMock(return_value=TOOLS_LIST_RESULT)
    monkeypatch.setattr(mcp_tool_agent, "_mcp_post", mcp_post)
    monkeypatch.setattr(mcp_tool_agent.ollama_client, "chat", fake_chat)

    await mcp_tool_agent.run_tool_loop("kdenlive", "sys", "what tracks do I have", "Kdenlive", max_rounds=4)

    assert "bigger-model:70b" not in models_used
    assert all(m == models_used[0] for m in models_used)  # stayed on the original model throughout


async def test_no_escalation_when_fallback_model_not_configured(monkeypatch):
    monkeypatch.setattr(mcp_tool_agent, "_load_servers", lambda: {"kdenlive": {"url": "http://x"}})
    monkeypatch.setattr(mcp_tool_agent, "FALLBACK_MODEL", None)
    monkeypatch.setattr(mcp_tool_agent.gpu_queue, "queue_depth", lambda: 0)

    async def fake_context_length(model, host=None):
        return 32768
    monkeypatch.setattr(mcp_tool_agent.ollama_client, "context_length", fake_context_length)

    models_used = []

    async def fake_chat(*, model, messages, host, options, tools, timeout):
        models_used.append(model)
        return _decision("get_track_list")

    mcp_post = AsyncMock(return_value=TOOLS_LIST_RESULT)
    monkeypatch.setattr(mcp_tool_agent, "_mcp_post", mcp_post)
    monkeypatch.setattr(mcp_tool_agent.ollama_client, "chat", fake_chat)

    await mcp_tool_agent.run_tool_loop("kdenlive", "sys", "what tracks do I have", "Kdenlive", max_rounds=4)

    assert len(set(models_used)) == 1  # never changed models
