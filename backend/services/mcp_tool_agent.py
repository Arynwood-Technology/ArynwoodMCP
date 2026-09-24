"""
Shared tool-calling loop for bridging Arynwood's chat to any MCP server
registered in mcp/config/mcp_servers.json.

chat.py has no native Ollama tool-calling loop — it only supports auto-
injected context blocks for web search / the knowledge base. This follows
that pattern: run a small bounded tool-calling loop *before* the user's
message reaches the persona, then hand back a plain-text context block the
normal streaming call can use — same shape as knowledge.format_context() or
the web-search injection in chat.py.

Originally built single-purpose for Kdenlive (multi-JSON tool-call parsing,
tool_name tagging, forced final answer once the round cap is hit — the same
design proven out in mcp-kdenlive/ollama_agent.py), then generalized to
dispatch across every registered server via gates.json (see
gather_context_for_message) rather than one hardcoded keyword list per
server. Wiring up a new server no longer needs a new Python module — just
mcp_servers.json + <server>.md + a gates.json entry.

Empirically (see mcp-kdenlive testing), qwen2.5-coder reliably calls real
tools while plain qwen2.5 mostly just describes JSON instead of sending it —
so this always uses a fixed, known-good local model for the tool-calling
step regardless of which model/server the user picked for the conversation
itself. That model does the tool-calling legwork; the persona's own model
still writes the reply the user sees.
"""

from __future__ import annotations
from backend.services import runtime_context, run_store

import json
import os
import re
import time
from pathlib import Path
from typing import Awaitable, Callable, Optional

from backend.routers.mcp_proxy import _load_servers, _mcp_post
from backend.services import ollama_client, telemetry
from backend.services.gpu_jobs import gpu_queue

# (tool_name, arguments, tier) -> True to allow a destructive/external-publish call.
ApprovalCallback = Callable[[str, dict, str], Awaitable[bool]]

# Config + per-server instructions live in mcp/config/local_agent/ as plain
# JSON/Markdown, not Python constants — see that directory's README for why.
_LOCAL_AGENT_DIR = Path(__file__).resolve().parents[2] / "mcp" / "config" / "local_agent"


def _load_config() -> dict:
    try:
        return json.loads((_LOCAL_AGENT_DIR / "config.json").read_text())
    except Exception:
        return {}


_CONFIG = _load_config()
DEFAULT_AGENT_MODEL = _CONFIG.get("model", "qwen2.5-coder:14b")
DEFAULT_AGENT_OLLAMA_URL = _CONFIG.get("ollama_url", "http://localhost:11434")
MAX_TOOL_ROUNDS = _CONFIG.get("max_tool_rounds", 6)
# Optional (roadmap 2.6) — no default guessed here, unlike model/ollama_url above.
# This machine's other installed models are either similar-sized to the default
# (qwen2.5-coder:14b, ~9GB) or meaningfully bigger (deepseek-coder:33b at ~19GB,
# gpt-oss:20b at ~14GB) — picking one blind risks trading a stall for an OOM on a
# 12GB card. Set "fallback_model" in config.json only once you know it fits
# alongside whatever else might be using the GPU.
FALLBACK_MODEL = _CONFIG.get("fallback_model")
STALL_ESCALATION_THRESHOLD = 2  # verbatim-repeat stalls before trying the fallback model

# A server can expose far more tools than are ever relevant to one message (Kdenlive
# alone has ~180) — _filter_relevant_tools() below caps how many schemas get sent.
MAX_TOOLS_PER_CALL = 24

# This loop's own prompts run larger than a normal chat turn (tool schemas plus
# multi-round tool results — a single get_timeline_summary result can be sizeable),
# so it gets a higher num_ctx ceiling than chat.py's MAX_NUM_CTX. Same underlying
# caveat applies: this machine has one 12GB GPU already contending with A1111/SD for
# VRAM, and num_ctx drives Ollama's KV-cache size — this is a deliberate ceiling
# below any of these models' native max, not a measurement of it.
MAX_TOOL_NUM_CTX = 12288


# ── Tool permission tiers (roadmap 2.3) ──────────────────────────────────────────
# run_tool_loop used to call whatever tool name the model produced with no
# distinction between a read (get_timeline_summary) and a destructive or external
# action (delete_track, render_video, and — the moment any MCP server wraps one — a
# real social-media publish). Classified by name pattern rather than a per-server
# config file, since no such config format exists yet and ~180 Kdenlive tools follow
# consistent naming (get_*/list_* read, add_*/set_*/insert_*/move_*/split_*/trim_*
# reversible via Kdenlive's own undo, delete_*/remove_*/ripple_* and anything that
# renders/exports a real file destructive). Defaults to destructive for anything
# unrecognized — fail toward requiring approval, not toward silently allowing it.
TIER_READ_ONLY = "read_only"
TIER_REVERSIBLE = "reversible_write"
TIER_DESTRUCTIVE = "destructive"
TIER_EXTERNAL_PUBLISH = "external_publish"  # nothing maps here yet — no registered server publishes anywhere today

_READ_ONLY_PREFIXES = ("get_", "list_", "screenshot_", "render_frame", "render_bin_frame", "render_contact_sheet", "render_crop")
_DESTRUCTIVE_PREFIXES = ("delete_", "remove_", "ripple_delete", "render_video", "new_project", "abort_render_job")
_REVERSIBLE_PREFIXES = (
    "add_", "set_", "insert_", "move_", "split_", "trim_", "slip_", "slide_", "roll_",
    "cut_", "copy_", "paste_", "group_", "ungroup_", "import_", "append_", "replace_",
    "update_", "clear_", "edit_", "select_", "seek_", "play", "pause", "undo", "redo",
    "save_project", "open_project", "load_project", "create_", "enable_", "rename_",
    "checkpoint_", "go_to_", "ripple_",  # ripple_trim — ripple_delete already caught above, checked first
)
# Names that don't share a clean prefix with the buckets above — checked against
# the exact tool name rather than forcing an awkward prefix match. Verified against
# the real ~180-tool Kdenlive manifest (see roadmap 2.3) rather than guessed:
# anything that fell through to the destructive catch-all below got looked up here.
# read_file/search_code/find_symbol/git_status/git_diff (mcp_codebase.py) added
# alongside detect_scenes for the same reason: analysis only, touches nothing.
_READ_ONLY_NAMES = {"detect_scenes", "read_file", "search_code", "find_symbol", "git_status", "git_diff"}
_REVERSIBLE_NAMES = {
    "build_timeline", "export_subtitles", "extract_zone", "fill_frame",
    "rebuild_clip_proxy", "relink_clip", "resize_composition", "resize_subtitle",
    "speech_recognition",
    # mcp_codebase.py: don't mutate source, but write cache artifacts (__pycache__,
    # eslint cache) — reversible, not destructive, so they auto-proceed.
    "run_tests", "run_lint",
}
# mcp_codebase.py's apply_patch mutates source and gets no entry here — it falls
# through every table above to the TIER_DESTRUCTIVE catch-all below, which is
# correct (approval required) and self-documenting: an unrecognized name failing
# toward "requires approval" is exactly the behavior a write tool needs.


def classify_tool_tier(tool_name: str) -> str:
    name = tool_name.lower()
    if name in _READ_ONLY_NAMES:
        return TIER_READ_ONLY
    if name in _REVERSIBLE_NAMES:
        return TIER_REVERSIBLE
    if name.startswith(_DESTRUCTIVE_PREFIXES):
        return TIER_DESTRUCTIVE
    if name.startswith(_READ_ONLY_PREFIXES):
        return TIER_READ_ONLY
    if name.startswith(_REVERSIBLE_PREFIXES):
        return TIER_REVERSIBLE
    return TIER_DESTRUCTIVE  # unrecognized name — fail toward requiring approval


def _filter_relevant_tools(tools: list[dict], message: str) -> list[dict]:
    """Cut a large tool catalog down to the ones plausibly relevant to this message.

    Sending every schema on every gated call (previously unconditional here) is most
    of why run_tool_loop's own 120s timeout had to become 300s — see the comment on
    _chat() below — and a longer tool list makes a 14B model's selection worse, not
    better. This is lexical overlap, not semantic search: good enough to cut ~180
    candidates down to a couple dozen without adding an embeddings dependency to this
    loop. Upgrade to real embedding similarity (matching the approach used for
    knowledge-base retrieval) if this proves too coarse in practice.
    """
    if len(tools) <= MAX_TOOLS_PER_CALL:
        return tools
    message_words = set(re.findall(r"[a-z]+", message.lower()))

    def score(tool: dict) -> int:
        fn = tool["function"]
        name_words = set(re.findall(r"[a-z]+", fn["name"].replace("_", " ").lower()))
        desc_words = set(re.findall(r"[a-z]+", (fn.get("description") or "").lower()))
        return 2 * len(name_words & message_words) + len(desc_words & message_words)

    return sorted(tools, key=score, reverse=True)[:MAX_TOOLS_PER_CALL]


def load_system_prompt(server_name: str) -> str:
    """Load mcp/config/local_agent/AGENT.md (shared rules) + <server_name>.md
    (server-specific tool/schema hints), concatenated as one system prompt."""
    shared = (_LOCAL_AGENT_DIR / "AGENT.md").read_text().strip()
    specific = (_LOCAL_AGENT_DIR / f"{server_name}.md").read_text().strip()
    return f"{specific}\n\n{shared}"


def _load_gates() -> dict:
    """Load mcp/config/local_agent/gates.json — server_name -> {label, hints}."""
    try:
        return json.loads((_LOCAL_AGENT_DIR / "gates.json").read_text())
    except Exception:
        return {}


async def _gate_matches(message: str, gate: dict) -> bool:
    """Confidence-scored classification instead of keyword substring matching
    (roadmap 2.2). gates.json's hints used to be matched as bare substrings —
    workable for one carefully-scoped server, but a bare substring can't tell two
    servers with an overlapping hint word apart, and it has no notion of
    confidence, just presence. This asks the same fixed local model the
    tool-calling loop already trusts for mechanical judgment calls, using the
    gate's own hints as descriptive context rather than as a hard pre-filter.
    """
    label = gate.get("label", "")
    hints = gate.get("hints", [])
    hint_str = ", ".join(hints[:8])
    try:
        result = await ollama_client.chat(
            model=DEFAULT_AGENT_MODEL, host=DEFAULT_AGENT_OLLAMA_URL, timeout=15.0,
            options={"temperature": 0},
            messages=[{
                "role": "user",
                "content": (
                    f'A message is being checked for whether it\'s about "{label}" '
                    f"(topics like: {hint_str}).\n\n"
                    f'Message: "{message}"\n\n'
                    "Is this message clearly asking to inspect or control that system? "
                    "Answer with exactly one word: YES or NO."
                ),
            }],
        )
        return (result.get("output") or "").strip().upper().startswith("YES")
    except Exception:
        return False


async def _route(message: str, candidates: dict[str, dict]) -> set[str]:
    """Pick which of several tool systems a message needs, in ONE classifier call.

    Asking each gate an isolated YES/NO misroutes whenever systems overlap: measured
    against qwen2.5-coder:14b at temperature 0, "How many clips are on my Kdenlive
    timeline?" was a YES for the Codebase gate 4/4 times (it *is* "inspecting a
    system"), running a pointless codebase tool loop on every Kdenlive question.
    Offering the systems side by side makes the choice discriminative, and costs one
    model call per turn instead of one per registered server. Fails closed (no tools).
    """
    lines = []
    for name, gate in candidates.items():
        hints = ", ".join(gate.get("hints", [])[:8])
        lines.append(f"- {name}: {gate.get('label', name)} (topics like: {hints})")
    try:
        result = await ollama_client.chat(
            model=DEFAULT_AGENT_MODEL, host=DEFAULT_AGENT_OLLAMA_URL, timeout=15.0,
            options={"temperature": 0},
            messages=[{
                "role": "user",
                "content": (
                    "Route a user's message to the tool systems it needs.\n\nSystems:\n" + "\n".join(lines) +
                    f'\n\nMessage: "{message}"\n\n'
                    "Which systems does the message clearly ask to inspect or control? Most messages need "
                    "at most one, and ordinary conversation, general questions, or help with unrelated "
                    "code need none. Reply with only the system names, comma-separated, or NONE."
                ),
            }],
        )
    except Exception:
        return set()
    words = set(re.findall(r"[a-z0-9_-]+", (result.get("output") or "").lower()))
    return {name for name in candidates if name.lower() in words}


def _server_enabled(name: str) -> bool:
    # The codebase server is an opt-in developer feature: its router is only mounted
    # with ARYNWOOD_ENABLE_CODEBASE_TOOLS=1, so a leftover mcp_servers.json entry must
    # not make the gate fire (and the tool loop 404) or the prompt advertise it.
    return name != "codebase" or os.environ.get("ARYNWOOD_ENABLE_CODEBASE_TOOLS") == "1"


def available_servers() -> list[str]:
    """Labels of tool servers that are both registered on this machine and gated —
    i.e. what gather_context_for_message could actually reach this turn. Used to
    describe real capabilities in the system prompt instead of a fixed list."""
    gates = _load_gates() or {}
    servers = _load_servers()
    return [gate.get("label", name) for name, gate in gates.items() if name in servers and _server_enabled(name)]


async def gather_context_for_message(
    message: str, approve: Optional[ApprovalCallback] = None,
) -> tuple[str, list[str]]:
    """Run the tool-calling loop for every registered MCP server whose gate
    classifies this message as relevant, and concatenate whatever comes back.

    A server only fires if it's BOTH registered in mcp_servers.json (present
    on this machine) AND its gate classifies the message as a match — an
    unregistered or ungated server is silently skipped, same no-op-by-design
    behavior the old per-server modules had (a down tool server never breaks
    normal chat).

    approve is passed straight through to run_tool_loop (roadmap 2.3) — see its
    docstring for the fail-safe-without-one behavior.

    Returns (context_text, server_labels_used) — the label list is evidence for
    the caller to disclose "ran N tools against these servers" (roadmap 1.8)
    rather than the model's context injection being entirely invisible to the user.
    """
    gates = _load_gates()
    if not gates:
        return "", []
    servers = _load_servers()

    candidates = {n: g for n, g in gates.items() if n in servers and _server_enabled(n)}
    if len(candidates) == 1:
        (only, gate), = candidates.items()
        selected = {only} if await _gate_matches(message, gate) else set()
    elif candidates:
        selected = await _route(message, candidates)
    else:
        selected = set()

    blocks: list[str] = []
    used: list[str] = []
    for server_name, gate in gates.items():
        if server_name not in servers or not _server_enabled(server_name):
            continue
        if server_name not in selected:
            continue
        label = gate.get("label", server_name)
        try:
            system_prompt = load_system_prompt(server_name)
        except Exception:
            continue  # missing <server_name>.md — misconfigured gate, skip rather than 500
        block = await run_tool_loop(server_name, system_prompt, message, label, approve=approve)
        if block:
            blocks.append(block)
            used.append(label)
    return "\n\n".join(blocks), used


def _extract_tool_calls(msg: dict) -> list[tuple[str, dict]]:
    """Some models don't populate the native tool_calls field and instead
    emit one or more {"name":..., "arguments":...} objects as plain text
    content — sometimes several back to back, sometimes fenced in a ```json
    block, and (confirmed empirically against a long, conversational system
    prompt — not just a short task-focused one) sometimes prefaced with a full
    lead-in sentence before the JSON even starts. So this scans for the first
    '{' rather than requiring the whole content to start with one, and is
    parsed with a streaming JSON decoder rather than a single json.loads
    (which chokes on "extra data" from a second object)."""
    tool_calls = msg.get("tool_calls") or []
    if tool_calls:
        calls = []
        for tc in tool_calls:
            fn = tc['function']
            arguments = fn.get('arguments', {})
            if isinstance(arguments, str):
                try:
                    arguments = json.loads(arguments)
                except ValueError:
                    arguments = {'__invalid_arguments__': arguments}
            calls.append((fn['name'], arguments))
        return calls

    content = (msg.get("content") or "").strip()
    # Prefer content inside a ```json fence if there is one — unambiguous, whereas
    # a prose lead-in could in principle contain a stray '{' of its own.
    fence_match = re.search(r"```(?:json)?\s*\n?(.*?)```", content, re.DOTALL)
    if fence_match:
        content = fence_match.group(1).strip()

    brace_idx = content.find("{")
    if brace_idx == -1:
        return []
    content = content[brace_idx:]

    calls: list[tuple[str, dict]] = []
    decoder = json.JSONDecoder()
    idx, n = 0, len(content)
    while idx < n:
        while idx < n and content[idx].isspace():
            idx += 1
        if idx >= n:
            break
        try:
            obj, end = decoder.raw_decode(content, idx)
        except json.JSONDecodeError:
            break
        if isinstance(obj, dict) and "name" in obj and "arguments" in obj:
            calls.append((obj["name"], obj["arguments"]))
        idx = end
    return calls


def _result_to_text(result: dict) -> str:
    parts = [c.get("text", "") for c in result.get("content", []) if c.get("type") == "text"]
    if result.get('structuredContent') is not None:
        parts.append(json.dumps(result['structuredContent'], ensure_ascii=False))
    for item in result.get('content', []):
        if item.get('type') == 'resource_link':
            parts.append(f"Resource: {item.get('name', '')} {item.get('uri', '')}")
        elif item.get('type') == 'resource':
            resource = item.get('resource', {})
            parts.append(f"Resource {resource.get('uri', '')}: {resource.get('text', '[binary resource]')}")
        elif item.get('type') in ('image', 'audio'):
            parts.append(f"[{item['type']} result ({item.get('mimeType', '')}); visual/audio inspection has not been performed by this text agent]")
    text = "\n".join(parts) if parts else "(no output)"
    return ('ERROR: ' if result.get('isError') else '') + text


_JSON_TYPE_CHECKS = {
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    "boolean": lambda v: isinstance(v, bool),
    "string": lambda v: isinstance(v, str),
    "array": lambda v: isinstance(v, list),
    "object": lambda v: isinstance(v, dict),
}


def _validate_tool_arguments(arguments: dict, schema: dict) -> list[str]:
    """Lightweight validation against a tool's inputSchema (roadmap 2.4) — checks
    required-argument presence and basic type matching for the property types JSON
    Schema actually uses. Not a full JSON Schema implementation (no oneOf/anyOf/
    $ref/pattern/etc.): these ~180 tool schemas are generated from plain Python
    function signatures, not hand-authored complex schemas, so this covers what
    actually goes wrong — a missing required arg or a value of the wrong basic
    type — without pulling in a dependency for the cases that don't occur here.
    Returns a list of human-readable problems; empty if nothing's wrong.
    """
    if not isinstance(schema, dict):
        return []
    problems = []
    props = schema.get("properties", {}) or {}
    for field in schema.get("required", []) or []:
        if field not in (arguments or {}):
            problems.append(f'missing required argument "{field}"')
    for name, value in (arguments or {}).items():
        prop_schema = props.get(name)
        if not isinstance(prop_schema, dict):
            continue
        expected = prop_schema.get("type")
        check = _JSON_TYPE_CHECKS.get(expected)
        if check is not None and not check(value):
            problems.append(f'argument "{name}" should be {expected}, got {type(value).__name__}')
    return problems


async def run_tool_loop(
    server_name: str,
    system_prompt: str,
    message: str,
    label: str,
    model: str = DEFAULT_AGENT_MODEL,
    ollama_url: str = DEFAULT_AGENT_OLLAMA_URL,
    max_rounds: int = MAX_TOOL_ROUNDS,
    approve: Optional[ApprovalCallback] = None,
) -> str:
    """Run a bounded tool-calling loop against a registered MCP server.

    Returns a "[<label> — live results]\\n<summary>" context block to inject
    into the user's message, or '' if the server / Ollama isn't reachable,
    or nothing useful came back.

    approve (roadmap 2.3): called before executing any destructive or
    external-publish tier tool (see classify_tool_tier) — read-only and
    reversible-write calls always proceed unprompted. With no approve callback
    given, destructive/publish calls are denied by default (fail toward requiring
    approval, never toward silently allowing it); the model is told why so it can
    explain that to the user rather than silently doing nothing.
    """
    servers = _load_servers()
    if server_name not in servers:
        return ""
    server_cfg = servers[server_name]

    try:
        tools_result = await _mcp_post(server_cfg, "tools/list", {})
    except Exception as exc:
        runtime_context.record_evidence("tool_service", server=server_name, outcome="unavailable", error=str(exc))
        return f"[{label} — unavailable] {exc}"
    tools = [
        {
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t.get("description", ""),
                "parameters": t["inputSchema"],
            },
        }
        for t in (tools_result or {}).get("tools", [])
    ]
    if not tools:
        return ""
    tools = _filter_relevant_tools(tools, message)
    tool_schemas = {t["function"]["name"]: t["function"]["parameters"] for t in tools}

    native_ctx = await ollama_client.context_length(model, ollama_url)
    num_ctx = min(native_ctx, MAX_TOOL_NUM_CTX)

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": message},
    ]

    async def _chat(with_tools: bool) -> dict:
        # 300s: 120s was too tight once real tool-result data is in context — a
        # second round with e.g. a full get_timeline_summary table plus the
        # tool schema list resent (required so the model can keep calling tools)
        # could exceed it on this hardware, silently killing the whole loop
        # (caught by the bare except below). _filter_relevant_tools() above and
        # explicit num_ctx (vs. Ollama's silent 2048 default) both shrink how
        # often that actually happens, but 300s stays as the margin.
        result = await ollama_client.chat(
            model=model, messages=messages, host=ollama_url,
            options={"temperature": 0, "num_ctx": num_ctx},  # temp 0: favor the most likely (real) tool name over creative guesses
            tools=tools if with_tools else None,
            timeout=300.0,
        )
        return {"content": result["output"], "tool_calls": result.get("tool_calls")}

    try:
        # Small local models at temperature 0 sometimes get stuck
        # re-issuing the exact same call every round (observed with
        # qwen2.5-coder repeating get_active_sequence 6x straight rather
        # than moving on to get_timeline_summary) — they don't reliably
        # self-correct from prose instructions alone, so short-circuit
        # verbatim repeats with a nudge instead of re-running them.
        seen_calls: set[str] = set()
        read_calls: set[str] = set()
        stall_count = 0
        escalated = False
        for _ in range(max_rounds):
            msg = await _chat(with_tools=True)
            calls = _extract_tool_calls(msg)
            if not calls:
                content = (msg.get("content") or "").strip()
                return f"[{label} — live results]\n{content}" if content else ""

            messages.append({
                "role": "assistant", "content": msg.get("content") or "",
                "tool_calls": [{"function": {"name": n, "arguments": a}} for n, a in calls],
            })
            for name, arguments in calls:
                key = f"{name}:{json.dumps(arguments, sort_keys=True)}"
                tier = classify_tool_tier(name)
                schema_problems = (
                    [f'no tool named "{name}" — check the exact name and try again']
                    if name not in tool_schemas
                    else _validate_tool_arguments(arguments, tool_schemas[name])
                )
                if key in seen_calls:
                    stall_count += 1
                    text = (f"(You already called {name} with these exact arguments — "
                            "see its result earlier in this conversation. Call a "
                            "different tool, or give your final answer now.)")
                    # Escalate to a bigger/different model rather than keep nudging
                    # the same one indefinitely (roadmap 2.6) — but only if nothing
                    # else is already contending for this machine's one GPU, so an
                    # escalation doesn't collide with a running SD/LoRA job.
                    if not escalated and FALLBACK_MODEL and stall_count >= STALL_ESCALATION_THRESHOLD:
                        if gpu_queue.queue_depth() == 0:
                            model = FALLBACK_MODEL
                            escalated = True
                            fallback_ctx = await ollama_client.context_length(model, ollama_url)
                            num_ctx = min(fallback_ctx, MAX_TOOL_NUM_CTX)
                            text += f" (Switching to {FALLBACK_MODEL} to break the loop.)"
                elif schema_problems:
                    # Validated before the approval check below — no point asking the
                    # user to approve a malformed call (roadmap 2.4).
                    seen_calls.add(key)
                    text = f"INVALID CALL to {name}: {'; '.join(schema_problems)}. Fix the arguments and call it again."
                    telemetry.record_tool_call(server_name, name, "invalid")
                elif tier in (TIER_DESTRUCTIVE, TIER_EXTERNAL_PUBLISH) and not (
                    approve and await approve(name, arguments, tier)
                ):
                    seen_calls.add(key)
                    tier_label = tier.replace("_", " ")
                    if approve:
                        # A person was shown this call and said no. Saying "needs approval"
                        # here made the model answer "please confirm — shall I proceed?"
                        # right after an explicit Deny (seen in a live run).
                        text = (
                            f"DENIED: the user was asked to approve {name} (a {tier_label} action) "
                            f"and declined. {name} was NOT run and nothing was changed. Do not retry "
                            "it and do not ask for confirmation again — the answer is no. In your "
                            "reply, say plainly that you did not do it because the user declined."
                        )
                    else:
                        text = (
                            f"DENIED: {name} is a {tier_label} action and requires user "
                            "approval, which was not granted in this context. Do not retry it — tell "
                            "the user what you were trying to do and that it needs their explicit "
                            "approval first."
                        )
                    telemetry.record_tool_call(server_name, name, "denied")
                else:
                    seen_calls.add(key)
                    call_start = time.monotonic()
                    step_id = await run_store.start_step(f'{server_name}.{name}', arguments)
                    try:
                        result = await _mcp_post(server_cfg, "tools/call", {"name": name, "arguments": arguments})
                        text = _result_to_text(result or {})
                        outcome = 'error' if result and result.get('isError') else 'success'
                        telemetry.record_tool_call(server_name, name, outcome, time.monotonic() - call_start)
                        await run_store.finish_step(step_id, 'failed' if outcome == 'error' else 'unverified', text)
                        runtime_context.record_evidence('tool', server=server_name, tool=name, outcome=outcome, result=text[:12000])
                        if tier == TIER_READ_ONLY:
                            read_calls.add(key)
                        elif outcome == 'success':
                            seen_calls.difference_update(read_calls)
                            read_calls.clear()
                    except Exception as exc:
                        text = f"ERROR: {exc}"
                        telemetry.record_tool_call(server_name, name, "error")
                        await run_store.finish_step(step_id, 'failed', text)
                        runtime_context.record_evidence('tool', server=server_name, tool=name, outcome='error', result=text)
                messages.append({"role": "tool", "content": text, "tool_name": name})

        # Round cap hit — force a tool-free final turn instead of
        # silently returning nothing.
        messages.append({
            "role": "user",
            "content": "Stop calling tools. Summarize what you found or did, in plain text.",
        })
        msg = await _chat(with_tools=False)
        content = (msg.get("content") or "").strip()
        return f"[{label} — live results]\n{content}" if content else ""
    except Exception as exc:
        runtime_context.record_evidence("tool_service", server=server_name, outcome="unavailable", error=str(exc))
        return f"[{label} — unavailable] {exc}"
