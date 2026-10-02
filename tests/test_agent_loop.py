"""The conversational tool loop (mcp_tool_agent.run_agent_loop / prepare_toolset) and the
in-process codebase server. Ollama and MCP servers are stubbed; the loop logic is real."""

import json

import pytest

from backend.routers import mcp_proxy
from backend.services import mcp_tool_agent
from backend.services.mcp_tool_agent import NativeTool, Toolset, prepare_toolset, run_agent_loop


def _tool(name: str, description: str = "", required=None, props=None) -> dict:
    return {"name": name, "description": description,
            "inputSchema": {"type": "object", "properties": props or {}, "required": required or []}}


class FakeServers:
    """Two MCP servers answering tools/list and tools/call, recording every call."""

    def __init__(self, catalogs: dict[str, list[dict]], fail: set[str] = frozenset()):
        self.catalogs = catalogs
        self.fail = fail
        self.calls: list[tuple[str, str, dict]] = []

    def registry(self) -> dict:
        return {name: {"url": f"http://{name}"} for name in self.catalogs}

    async def post(self, cfg, method, params, req_id=1):
        server = cfg["url"].removeprefix("http://")
        if server in self.fail:
            raise ConnectionError(f"{server} is down")
        if method == "tools/list":
            return {"tools": self.catalogs[server]}
        self.calls.append((server, params["name"], params["arguments"]))
        return {"content": [{"type": "text", "text": f"{params['name']} result"}]}


class ScriptedModel:
    """Stands in for ollama_client.chat: answers each round from a script and records what
    it was sent."""

    def __init__(self, outputs: list[str]):
        self.outputs = list(outputs)
        self.requests: list[dict] = []

    async def chat(self, *, model, messages, host=None, port=None, options=None, tools=None, timeout=None):
        self.requests.append({"model": model, "messages": messages, "tools": tools, "options": options})
        return {"output": self.outputs.pop(0), "tool_calls": None}


def call(name: str, **arguments) -> str:
    return json.dumps({"name": name, "arguments": arguments})


@pytest.fixture()
def servers(monkeypatch):
    fake = FakeServers({
        "kdenlive": [_tool("get_timeline_summary", "list clips on the timeline"),
                     _tool("delete_clip", "delete a clip", ["clip_id"], {"clip_id": {"type": "integer"}})],
        "codebase": [_tool("read_file", "read a file", ["path"], {"path": {"type": "string"}})],
    })
    monkeypatch.setattr(mcp_tool_agent, "_load_servers", fake.registry)
    monkeypatch.setattr(mcp_tool_agent, "_mcp_post", fake.post)
    monkeypatch.setenv("ARYNWOOD_ENABLE_CODEBASE_TOOLS", "1")
    return fake


def _model(monkeypatch, outputs):
    model = ScriptedModel(outputs)
    monkeypatch.setattr(mcp_tool_agent.ollama_client, "chat", model.chat)
    return model


CONVERSATION = [{"role": "system", "content": "You are helpful."},
                {"role": "user", "content": "what's on my timeline?"}]


async def test_model_keeps_calling_tools_until_it_answers(servers, monkeypatch):
    toolset = await prepare_toolset(["kdenlive"], focus="timeline clips")
    model = _model(monkeypatch, [call("get_timeline_summary"), call("delete_clip", clip_id=1), "All done."])
    result = await run_agent_loop(CONVERSATION, toolset, num_ctx=12288, approve=_yes)

    assert result.text == "All done." and result.rounds == 3 and not result.forced_final
    assert [c[1] for c in servers.calls] == ["get_timeline_summary", "delete_clip"]
    assert [(c["tool"], c["outcome"]) for c in result.calls] == [("get_timeline_summary", "success"), ("delete_clip", "success")]
    # Each round sees the earlier results, framed as untrusted data, and keeps the tools attached.
    last = model.requests[-1]
    tool_messages = [m for m in last["messages"] if m["role"] == "tool"]
    assert tool_messages[0]["content"].startswith('<untrusted-data source="kdenlive.get_timeline_summary">')
    assert all(r["tools"] for r in model.requests)
    assert all(r["options"]["temperature"] == 0 and r["options"]["num_ctx"] == 12288 for r in model.requests)


async def _yes(*args):
    return True


async def test_destructive_call_without_approver_is_denied_and_not_framed_as_data(servers, monkeypatch):
    toolset = await prepare_toolset(["kdenlive"])
    model = _model(monkeypatch, [call("delete_clip", clip_id=3), "I couldn't delete it."])
    result = await run_agent_loop(CONVERSATION, toolset, num_ctx=8192, approve=None)

    assert servers.calls == []
    assert result.calls == [{"tool": "delete_clip", "server": "kdenlive", "tier": "destructive", "outcome": "denied"}]
    denial = [m for m in model.requests[-1]["messages"] if m["role"] == "tool"][0]["content"]
    assert denial.startswith("DENIED:")   # the loop's own instruction, not wrapped as untrusted data


async def test_approver_saying_no_is_reported_as_a_decline(servers, monkeypatch):
    asked = []

    async def no(tool, arguments, tier):
        asked.append((tool, arguments, tier))
        return False

    toolset = await prepare_toolset(["kdenlive"])
    model = _model(monkeypatch, [call("delete_clip", clip_id=3), "Okay, I left it."])
    await run_agent_loop(CONVERSATION, toolset, num_ctx=8192, approve=no)
    assert asked == [("delete_clip", {"clip_id": 3}, "destructive")]
    assert "declined" in [m for m in model.requests[-1]["messages"] if m["role"] == "tool"][0]["content"]


async def test_native_and_server_tools_share_one_loop(servers, monkeypatch):
    seen = []

    async def remember(arguments):
        seen.append(arguments)
        return "Memory #1: teal"

    native = NativeTool({"type": "function", "function": {
        "name": "search_memory", "description": "search saved memories",
        "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}}}, remember)
    toolset = await prepare_toolset(["codebase"], [native])
    _model(monkeypatch, [call("search_memory", query="cover"), call("read_file", path="README.md"), "Teal, per README."])
    result = await run_agent_loop(CONVERSATION, toolset, num_ctx=8192)

    assert seen == [{"query": "cover"}]
    assert servers.calls == [("codebase", "read_file", {"path": "README.md"})]
    assert [c["server"] for c in result.calls] == ["native", "codebase"]


async def test_native_tool_tier_is_declared_not_guessed(servers, monkeypatch):
    ran = []

    async def handler(arguments):
        ran.append(arguments)
        return "made"

    # "generate_spreadsheet" would fall through classify_tool_tier to destructive.
    native = NativeTool({"type": "function", "function": {"name": "generate_spreadsheet", "parameters": {}}},
                        handler, tier=mcp_tool_agent.TIER_REVERSIBLE)
    toolset = await prepare_toolset([], [native])
    _model(monkeypatch, [call("generate_spreadsheet"), "Here it is."])
    result = await run_agent_loop(CONVERSATION, toolset, num_ctx=8192, approve=None)
    assert ran == [{}] and result.calls[0]["outcome"] == "success"


async def test_tool_not_sent_but_in_the_catalog_is_still_callable(monkeypatch):
    catalog = [_tool(f"get_thing_{i}", "unrelated") for i in range(40)] + [_tool("get_project_info", "project")]
    fake = FakeServers({"kdenlive": catalog})
    monkeypatch.setattr(mcp_tool_agent, "_load_servers", fake.registry)
    monkeypatch.setattr(mcp_tool_agent, "_mcp_post", fake.post)
    toolset = await prepare_toolset(["kdenlive"], focus="nothing in common")
    assert "get_project_info" not in [t["function"]["name"] for t in toolset.schemas]
    _model(monkeypatch, [call("get_project_info"), call("get_projekt_info"), "Done."])
    result = await run_agent_loop(CONVERSATION, toolset, num_ctx=8192)
    assert [c["outcome"] for c in result.calls] == ["success", "invalid"]


async def test_schema_cap_counts_native_tools_and_shares_between_servers(monkeypatch):
    fake = FakeServers({
        "kdenlive": [_tool(f"kd_{i}") for i in range(100)],
        "codebase": [_tool(f"cb_{i}") for i in range(5)],
    })
    monkeypatch.setattr(mcp_tool_agent, "_load_servers", fake.registry)
    monkeypatch.setattr(mcp_tool_agent, "_mcp_post", fake.post)
    monkeypatch.setenv("ARYNWOOD_ENABLE_CODEBASE_TOOLS", "1")
    natives = [NativeTool({"type": "function", "function": {"name": f"n{i}", "parameters": {}}}, _yes) for i in range(4)]
    toolset = await prepare_toolset(["kdenlive", "codebase"], natives)
    names = [t["function"]["name"] for t in toolset.schemas]
    assert len(names) == mcp_tool_agent.MAX_TOOLS_PER_CALL
    assert names[:4] == ["n0", "n1", "n2", "n3"]
    assert sum(n.startswith("cb_") for n in names) == 5          # the small catalog isn't crowded out
    assert len(toolset.callable) == 4 + 100 + 5                  # everything stays callable
    assert toolset.labels == ["Kdenlive", "Codebase"]


async def test_unreachable_server_is_disclosed_not_silently_dropped(servers, monkeypatch):
    servers.fail = {"kdenlive"}
    toolset = await prepare_toolset(["kdenlive", "codebase"])
    assert toolset.labels == ["Codebase"]
    assert "couldn't be reached" in toolset.instructions and "kdenlive is down" in toolset.instructions


async def test_round_cap_forces_a_tool_free_answer(servers, monkeypatch):
    toolset = await prepare_toolset(["kdenlive"])
    model = _model(monkeypatch, [call("get_timeline_summary"), call("delete_clip", clip_id=1), "Partial answer."])
    result = await run_agent_loop(CONVERSATION, toolset, num_ctx=8192, max_rounds=2, approve=_yes)
    assert result.forced_final and result.text == "Partial answer."
    final = model.requests[-1]
    assert final["tools"] is None
    assert final["messages"][-1]["role"] == "system" and "finished" in final["messages"][-1]["content"]


async def test_repeated_call_stalls_then_escalates(servers, monkeypatch):
    monkeypatch.setattr(mcp_tool_agent, "FALLBACK_MODEL", "bigger-model:70b")
    monkeypatch.setattr(mcp_tool_agent, "STALL_ESCALATION_THRESHOLD", 2)
    monkeypatch.setattr(mcp_tool_agent.gpu_queue, "queue_depth", lambda: 0)

    async def ctx(model, host=None, port=None, timeout=5.0):
        return 32768
    monkeypatch.setattr(mcp_tool_agent.ollama_client, "context_length", ctx)
    toolset = await prepare_toolset(["kdenlive"])
    same = call("get_timeline_summary")
    model = _model(monkeypatch, [same, same, same, "Finally."])
    result = await run_agent_loop(CONVERSATION, toolset, num_ctx=12288)
    assert result.escalated and result.model == "bigger-model:70b"
    assert model.requests[-1]["model"] == "bigger-model:70b"
    assert model.requests[-1]["options"]["num_ctx"] == 12288   # never above the turn's ceiling
    assert len(servers.calls) == 1                              # repeats were never re-run


async def test_empty_toolset_is_falsy():
    assert not Toolset()


# ── the daemon hosts its own codebase tools ──────────────────────────────────────


def test_codebase_server_is_built_in_and_overrides_a_port_bound_entry(tmp_path, monkeypatch):
    registry = tmp_path / "mcp_servers.json"
    registry.write_text(json.dumps({"mcpServers": {
        "kdenlive": {"url": "http://127.0.0.1:8420/mcp"},
        "codebase": {"url": "http://127.0.0.1:8010/api/mcp-codebase"},
    }}))
    monkeypatch.setattr(mcp_proxy, "_CONFIG_PATH", str(registry))
    monkeypatch.setenv("ARYNWOOD_ENABLE_CODEBASE_TOOLS", "1")
    assert mcp_proxy._load_servers() == {"kdenlive": {"url": "http://127.0.0.1:8420/mcp"},
                                         "codebase": {"in_process": "codebase"}}
    monkeypatch.delenv("ARYNWOOD_ENABLE_CODEBASE_TOOLS")
    assert "in_process" not in mcp_proxy._load_servers()["codebase"]   # opt-in, as before


async def test_in_process_server_answers_without_http(monkeypatch):
    async def no_http(*args, **kwargs):
        raise AssertionError("in-process dispatch must not open an HTTP client")
    monkeypatch.setattr(mcp_proxy.httpx, "AsyncClient", no_http)
    listed = await mcp_proxy._mcp_post({"in_process": "codebase"}, "tools/list", {})
    assert {"read_file", "search_code", "apply_patch"} <= {t["name"] for t in listed["tools"]}
    called = await mcp_proxy._mcp_post({"in_process": "codebase"}, "tools/call", {"name": "nope", "arguments": {}})
    assert called["content"][0]["text"].startswith('ERROR: no tool named "nope"')


async def test_an_announced_but_untaken_step_gets_one_nudge(servers, monkeypatch):
    """Seen live: read_file, then "Now I'll create a patch ..." and nothing, so the change
    never reached the approval gate. One nudge, and the call is made."""
    toolset = await prepare_toolset(["kdenlive"])
    model = _model(monkeypatch, [call("get_timeline_summary"),
                                 "The clip is on track 2.\n\nNow I'll delete it.",
                                 call("delete_clip", clip_id=1), "Deleted."])
    result = await run_agent_loop(CONVERSATION, toolset, num_ctx=8192, approve=_yes)
    assert result.text == "Deleted." and [c[1] for c in servers.calls] == ["get_timeline_summary", "delete_clip"]
    nudge = model.requests[2]["messages"][-1]
    assert nudge["role"] == "system" and "didn't call a tool" in nudge["content"]


async def test_the_nudge_happens_once_and_never_for_sign_offs(servers, monkeypatch):
    toolset = await prepare_toolset(["kdenlive"])
    model = _model(monkeypatch, [call("get_timeline_summary"), "Next, I'll check it.", "I'll check it."])
    assert (await run_agent_loop(CONVERSATION, toolset, num_ctx=8192)).text == "I'll check it."
    assert len(model.requests) == 3   # one nudge, then the answer stands

    model = _model(monkeypatch, [call("get_timeline_summary"), "Three clips. Let me know if you need more."])
    assert (await run_agent_loop(CONVERSATION, toolset, num_ctx=8192)).text.startswith("Three clips.")
    assert len(model.requests) == 2

    model = _model(monkeypatch, ["Got it, I'll remember that."])   # no tools used: no nudge
    await run_agent_loop(CONVERSATION, toolset, num_ctx=8192)
    assert len(model.requests) == 1


async def test_find_symbol_fallback_finds_module_constants_and_points_onward():
    from backend.routers import mcp_codebase
    found = (await mcp_codebase._find_symbol_fallback("SESSION_KEY_RE", "test"))["content"][0]["text"]
    assert "backend/gateway/sessions.py" in found
    missing = (await mcp_codebase._find_symbol_fallback("NO_SUCH_SYMBOL_XYZZY", "test"))["content"][0]["text"]
    assert "(no matches)" in missing and "search_code" in missing
