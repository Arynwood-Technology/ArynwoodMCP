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

Chat models differ widely at tool calling (some only describe the JSON instead of
sending it; measured in local-ai-benchmarks' TOOL-CALLING.md), so this always uses a fixed, known-good local model for the tool-calling
step regardless of which model/server the user picked for the conversation
itself. That model does the tool-calling legwork; the persona's own model
still writes the reply the user sees.

Two loops share the per-call rules (_CallRunner: repeat short-circuit and stall
escalation, schema validation, tiers and approval, evidence):

- run_tool_loop: the pre-chat side loop above, one server at a time, returning a
  context block. The desktop chat (chat.py) uses it.
- run_agent_loop: the conversational loop. The tools are attached to the
  conversation itself, and the model calls them mid-reply, round after round,
  until it decides it's done and answers. Native tools and every gated server's
  tools share one call; the headless gateway uses it (backend/gateway/turn.py).
"""

from __future__ import annotations
from backend.services import runtime_context, run_store

import json
import asyncio
import secrets
import sys
import os
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Awaitable, Callable, Iterable, Optional

from backend.routers.mcp_proxy import _load_servers, _mcp_post
from backend.services import ollama_client, telemetry
from backend.services.context_budget import fit_request
from backend.services.gpu_jobs import gpu_queue

# (tool_name, arguments, tier) -> True to allow a destructive/external-publish call. It may
# instead return (approved, reason) so a "no" can say why: APPROVAL_TIMED_OUT or
# APPROVAL_UNAVAILABLE get their own wording; any other reason reads as a decline.
ApprovalCallback = Callable[[str, dict, str], Awaitable["bool | tuple[bool, str]"]]
APPROVAL_TIMED_OUT = "timed out"
APPROVAL_UNAVAILABLE = "no approver attached"

# Config + per-server instructions live in mcp/config/local_agent/ as plain
# JSON/Markdown, not Python constants — see that directory's README for why.
_LOCAL_AGENT_DIR = Path(__file__).resolve().parents[2] / "mcp" / "config" / "local_agent"


def _load_config() -> dict:
    try:
        return json.loads((_LOCAL_AGENT_DIR / "config.json").read_text())
    except Exception:
        return {}


_CONFIG = _load_config()
DEFAULT_AGENT_MODEL = _CONFIG.get("model", "hermes3:8b")
DEFAULT_AGENT_OLLAMA_URL = _CONFIG.get("ollama_url", "http://localhost:11434")
MAX_TOOL_ROUNDS = _CONFIG.get("max_tool_rounds", 6)
# The conversational loop's backstop. It normally ends when the model answers instead of
# calling a tool; this only stops a model that never does.
MAX_AGENT_ROUNDS = _CONFIG.get("max_agent_rounds", 10)
# Optional (roadmap 2.6) — no default guessed here, unlike model/ollama_url above.
# A fallback has to fit beside whatever else uses the GPU: gpt-oss:20b (~16GB at
# num_ctx 8192) spilled onto the CPU and froze the desktop on this 12GB card in the
# 2026-10-04 benchmark, so picking one blind risks trading a stall for an OOM. Set "fallback_model" in config.json only once you know it fits
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


# MCP tiering and argument validation live in tool_policy and are shared with
# direct proxy and codebase RPC entry points. Re-export names for existing callers.
from backend.services import tool_policy
from backend.services.tool_policy import (
    TIER_READ_ONLY, TIER_REVERSIBLE, TIER_DESTRUCTIVE, TIER_EXTERNAL_PUBLISH,
    classify_tool_tier, _validate_tool_arguments,
)


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
    return _rank_tools(tools, message)[:MAX_TOOLS_PER_CALL]


def _rank_tools(tools: list[dict], message: str) -> list[dict]:
    """tools, most relevant to message first (stable, so ties keep catalog order)."""
    message_words = set(re.findall(r"[a-z]+", message.lower()))

    def score(tool: dict) -> int:
        fn = tool["function"]
        name_words = set(re.findall(r"[a-z]+", fn["name"].replace("_", " ").lower()))
        desc_words = set(re.findall(r"[a-z]+", (fn.get("description") or "").lower()))
        return 2 * len(name_words & message_words) + len(desc_words & message_words)

    return sorted(tools, key=score, reverse=True)


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
    against the earlier 14B tool model at temperature 0, "How many clips are on my Kdenlive
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
    return name != "codebase" or (os.environ.get("ARYNWOOD_ENABLE_CODEBASE_TOOLS") == "1" and not getattr(sys, "frozen", False))


def available_servers() -> list[str]:
    """Labels of tool servers that are both registered on this machine and gated —
    i.e. what gather_context_for_message could actually reach this turn. Used to
    describe real capabilities in the system prompt instead of a fixed list."""
    gates = _load_gates() or {}
    servers = _load_servers()
    return [gate.get("label", name) for name, gate in gates.items() if name in servers and _server_enabled(name)]


async def select_servers(message: str) -> list[str]:
    """gates.json dispatch: which registered, enabled servers this message needs, in
    gates.json order. One candidate is asked YES/NO; several are routed side by side in a
    single call (_route). Fails closed: a classifier error selects nothing."""
    gates = _load_gates()
    if not gates:
        return []
    servers = _load_servers()

    candidates = {n: g for n, g in gates.items() if n in servers and _server_enabled(n)}
    if len(candidates) == 1:
        (only, gate), = candidates.items()
        selected = {only} if await _gate_matches(message, gate) else set()
    elif candidates:
        selected = await _route(message, candidates)
    else:
        selected = set()
    return [name for name in gates if name in selected]


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
    blocks: list[str] = []
    used: list[str] = []
    for server_name in await select_servers(message):
        label = gates[server_name].get("label", server_name)
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
    # Prefer content inside a code fence — unambiguous, whereas a prose lead-in could in
    # principle contain a stray '{' of its own. Every fenced block is tried, not just the
    # first: a reply can quote a file in one block and put the call in the next (seen live:
    # the last line of docs/gateway.md, then the apply_patch call, which went unexecuted
    # and was shown to the user as raw JSON).
    for block in re.findall(r"```(?:json)?\s*\n?(.*?)```", content, re.DOTALL):
        calls = _parse_call_objects(block.strip())
        if calls:
            return calls
    return _parse_call_objects(content)


def _parse_call_objects(content: str) -> list[tuple[str, dict]]:
    """Back-to-back {"name":..., "arguments":...} objects, starting at the first '{'."""
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




@dataclass
class NativeTool:
    """An in-process tool offered next to MCP servers' tools in run_agent_loop (web_search,
    search_memory, ...). The caller curates these, so the tier is declared, not guessed
    from the name."""
    schema: dict
    handler: Callable[[dict], Awaitable[str]]
    tier: str = TIER_READ_ONLY

    @property
    def name(self) -> str:
        return self.schema["function"]["name"]


class _CallRunner:
    """Runs one model-requested tool call under the rules both loops share.

    - A verbatim repeat is short-circuited with a nudge. Small local models at temperature
      0 sometimes re-issue the exact same call every round (observed: the earlier 14B tool
      model calling get_active_sequence 6x straight rather than moving on to get_timeline_summary), and
      they don't reliably self-correct from prose alone. After STALL_ESCALATION_THRESHOLD
      repeats it escalates to FALLBACK_MODEL (roadmap 2.6), if one is configured and nothing
      else is queued for the GPU.
    - Arguments are validated against the tool's schema before anything else (roadmap 2.4).
    - Destructive and external-publish calls run only if approve() says yes (roadmap 2.3).
      With no approve callback they are denied, never silently allowed.
    - Whatever actually runs is recorded as telemetry, a run step and run evidence. A
      successful write clears the read cache, so reads after it aren't treated as repeats.

    run() returns (text, is_output). is_output is False for the loop's own messages to the
    model (DENIED, INVALID CALL, "you already called"): those are instructions, and must not
    be framed as untrusted tool data the way real tool output is.
    """

    def __init__(self, *, schemas: dict, servers: dict, native: Optional[dict] = None,
                 approve: Optional[ApprovalCallback] = None, model: str, ollama_url: str,
                 num_ctx: int, ctx_ceiling: int):
        self.schemas = schemas          # tool name -> inputSchema, for every tool that may be called
        self.servers = servers          # MCP tool name -> (server name, server config)
        self.native = native or {}      # tool name -> NativeTool
        self.approve = approve
        self.model, self.ollama_url = model, ollama_url
        self.num_ctx, self.ctx_ceiling = num_ctx, ctx_ceiling
        self.seen_calls: set[str] = set()
        self.read_calls: set[str] = set()
        self.stall_count = 0
        self.escalated = False
        self._policy_caller = runtime_context.run_id.get() or secrets.token_hex(16)
        self.log: list[dict] = []       # every call the model asked for, and what became of it

    def source(self, name: str) -> str:
        return "native" if name in self.native else self.servers.get(name, ("unknown",))[0]

    def tier(self, name: str) -> str:
        if name in self.native:
            return self.native[name].tier
        server, config = self.servers.get(name, ("unknown", {}))
        return tool_policy.classify_mcp_tool(server, config, name)

    def _note(self, name: str, tier: str, outcome: str) -> None:
        self.log.append({"tool": name, "server": self.source(name), "tier": tier, "outcome": outcome})

    async def run(self, name: str, arguments: dict) -> tuple[str, bool]:
        key = f"{name}:{json.dumps(arguments, sort_keys=True)}"
        tier = self.tier(name)
        source = self.source(name)
        schema_problems = (
            [f'no tool named "{name}" — check the exact name and try again']
            if name not in self.schemas
            else _validate_tool_arguments(arguments, self.schemas[name])
        )
        if key in self.seen_calls:
            self.stall_count += 1
            text = (f"(You already called {name} with these exact arguments — "
                    "see its result earlier in this conversation. Call a "
                    "different tool, or give your final answer now.)")
            # Escalate to a bigger/different model rather than keep nudging the same one
            # indefinitely — but only if nothing else is already contending for this
            # machine's one GPU, so an escalation doesn't collide with a running SD/LoRA job.
            if not self.escalated and FALLBACK_MODEL and self.stall_count >= STALL_ESCALATION_THRESHOLD:
                if gpu_queue.queue_depth() == 0:
                    self.model = FALLBACK_MODEL
                    self.escalated = True
                    fallback_ctx = await ollama_client.context_length(self.model, self.ollama_url)
                    self.num_ctx = min(fallback_ctx, self.ctx_ceiling)
                    text += f" (Switching to {FALLBACK_MODEL} to break the loop.)"
            self._note(name, tier, "repeat")
            return text, False

        if schema_problems:
            # Validated before the approval check below — no point asking the user to
            # approve a malformed call.
            self.seen_calls.add(key)
            telemetry.record_tool_call(source, name, "invalid")
            self._note(name, tier, "invalid")
            return f"INVALID CALL to {name}: {'; '.join(schema_problems)}. Fix the arguments and call it again.", False

        # Freeze the reviewed operation before invoking a callback. No mutable
        # callback argument or caller-supplied bool becomes execution authority.
        try:
            reviewed_arguments = json.loads(tool_policy.canonical(arguments))
            intent = (tool_policy.make_intent(source, self.servers[name][1], name,
                      reviewed_arguments, self.schemas[name], self._policy_caller)
                      if name not in self.native else None)
        except tool_policy.InvalidToolCall as exc:
            self._note(name, tier, "invalid")
            return f"INVALID CALL to {name}: {exc}", False
        grant = None
        decision = True
        approval_context = tool_policy.approval_intent.set(intent)
        try:
            if tool_policy.requires_approval(tier):
                decision = (await asyncio.wait_for(self.approve(name, reviewed_arguments, tier),
                            timeout=tool_policy.APPROVAL_TTL_SECONDS) if self.approve else False)
        except asyncio.TimeoutError:
            decision = (False, APPROVAL_TIMED_OUT)
        finally:
            tool_policy.approval_intent.reset(approval_context)
        approved, reason = decision if isinstance(decision, tuple) and len(decision) == 2 else (decision, None)
        approved = approved is True
        if approved and intent is not None and tool_policy.requires_approval(tier):
            try:
                # Re-read owner configuration after the await. A changed endpoint,
                # credential, tier, schema or callback argument requires new review.
                current_config = _load_servers().get(source)
                if current_config is None:
                    raise tool_policy.PolicyDenied("Tool server is no longer registered")
                current = tool_policy.make_intent(source, current_config, name, reviewed_arguments,
                                                  self.schemas[name], self._policy_caller)
                if current.binding != intent.binding:
                    raise tool_policy.PolicyDenied("Reviewed tool call or configuration changed")
                grant = tool_policy.authority.issue(intent)
            except (tool_policy.PolicyDenied, tool_policy.InvalidToolCall) as exc:
                self.seen_calls.add(key)
                telemetry.record_tool_call(source, name, "denied")
                self._note(name, tier, "denied")
                return f"DENIED: {name} was NOT run: {exc}. Request a new approval.", False
        if not approved:
            self.seen_calls.add(key)
            tier_label = tier.replace("_", " ")
            if self.approve and reason == APPROVAL_TIMED_OUT:
                # Nobody answered. "The user declined" would be untrue, and the user may still want it.
                text = (
                    f"DENIED: {name} (a {tier_label} action) needed the user's approval, and the request "
                    f"timed out without an answer. {name} was NOT run and nothing was changed. Do not "
                    "retry it now. In your reply, say plainly that you didn't do it because the approval "
                    "request wasn't answered in time, and that they can ask again."
                )
            elif self.approve and reason != APPROVAL_UNAVAILABLE:
                # A person was shown this call and said no. Saying "needs approval" here made
                # the model answer "please confirm — shall I proceed?" right after an explicit
                # Deny (seen in a live run).
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
            telemetry.record_tool_call(source, name, "denied")
            self._note(name, tier, "denied")
            return text, False

        self.seen_calls.add(key)
        call_start = time.monotonic()
        step_id = await run_store.start_step(f'{source}.{name}', arguments)
        try:
            if name in self.native:
                text = await self.native[name].handler(arguments)
                outcome = 'success'
            else:
                result = await tool_policy.dispatch(intent, _mcp_post, grant)
                text = _result_to_text(result or {})
                outcome = 'error' if result and result.get('isError') else 'success'
            telemetry.record_tool_call(source, name, outcome, time.monotonic() - call_start)
            await run_store.finish_step(step_id, 'failed' if outcome == 'error' else 'unverified', text)
            runtime_context.record_evidence('tool', server=source, tool=name, outcome=outcome, result=text[:12000])
            if tier == TIER_READ_ONLY:
                self.read_calls.add(key)
            elif outcome == 'success':
                self.seen_calls.difference_update(self.read_calls)
                self.read_calls.clear()
        except Exception as exc:
            text = f"ERROR: {exc}"
            outcome = 'error'
            telemetry.record_tool_call(source, name, "error")
            await run_store.finish_step(step_id, 'failed', text)
            runtime_context.record_evidence('tool', server=source, tool=name, outcome='error', result=text)
        self._note(name, tier, outcome)
        return text, True


def _action_line(name: str, arguments: dict, text: str, ok: bool) -> tuple[str, str]:
    """One line of the factual call record run_tool_loop hands the persona, and its outcome:
    done, denied, rejected or failed."""
    args = json.dumps(arguments, ensure_ascii=False, sort_keys=True)
    args = args if len(args) <= 160 else args[:159] + "…"
    first = (text or "").strip().splitlines()[0][:160] if (text or "").strip() else ""
    if first.startswith("DENIED"):
        kind, outcome = "denied", "DENIED, so it was not run"
    elif first.startswith("INVALID CALL"):
        kind, outcome = "rejected", "rejected for invalid arguments, not run"
    elif ok and not first.upper().startswith("ERROR"):
        # mcp-kdenlive reports failures as successful MCP results with an "ERROR:" text; seen
        # live, a crashed editor's "ERROR: Cutroom isn't running" was recorded as done.
        kind, outcome = "done", (f"done: {first}" if first else "done")
    else:
        kind, outcome = "failed", (f"failed: {first}" if first else "failed")
    return f"- {name} {args}: {outcome}", kind


def tool_outcome_facts(evidence: list[dict] | None) -> str:
    """Plain statements of what the tool loop really did this turn, built from the run evidence
    rather than any model's words. chat_ws puts them last before the reply: seen live, hermes3:8b
    answered a DENIED delete with "has been successfully deleted", echoing its previous reply."""
    actions = [e for e in (evidence or []) if e.get("kind") == "tool_action"]
    if not actions:
        return ""
    said = {
        "done": "ran and succeeded",
        "denied": "was DENIED by the user, so it did not run and nothing changed",
        "rejected": "was rejected for invalid arguments, so it did not run and nothing changed",
        "failed": "failed, so it did not complete",
    }
    lines = [f"- {a['tool']} {a['arguments']}: {said.get(a['outcome'], a['outcome'])}"
             + (f" ({a['detail']})" if a["outcome"] in ("done", "failed") and a.get("detail") else "")
             for a in actions]
    return ("What actually happened with your tools this turn (recorded by Arynwood, not written by a "
            "model):\n" + "\n".join(lines) + "\nReport exactly this. Never say a denied, rejected or "
            "failed action happened.")


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
    tools = [_as_function(t) for t in (tools_result or {}).get("tools", [])]
    if not tools:
        return ""
    tools = _filter_relevant_tools(tools, message)
    tool_schemas = {t["function"]["name"]: t["function"]["parameters"] for t in tools}

    native_ctx = await ollama_client.context_length(model, ollama_url)
    runner = _CallRunner(
        schemas=tool_schemas, servers={name: (server_name, server_cfg) for name in tool_schemas},
        approve=approve, model=model, ollama_url=ollama_url,
        num_ctx=min(native_ctx, MAX_TOOL_NUM_CTX), ctx_ceiling=MAX_TOOL_NUM_CTX,
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": message},
    ]
    # What actually ran, recorded from the runner rather than taken from the model's summary:
    # a model can end the loop with no summary (seen live with hermes3:8b after a successful
    # delete), and the persona replying to the user must still know the action happened.
    actions: list[str] = []

    def block(content: str) -> str:
        parts = [f"[{label} — live results]"]
        if actions:
            parts.append("Tool calls made for this request:\n" + "\n".join(actions))
        if content:
            parts.append(("Summary: " if actions else "") + content)
        if len(parts) == 1:
            parts.append(f"No {label} tool was called for this request, so nothing was changed.")
        return "\n".join(parts)

    async def _chat(with_tools: bool) -> dict:
        # 300s: 120s was too tight once real tool-result data is in context — a
        # second round with e.g. a full get_timeline_summary table plus the
        # tool schema list resent (required so the model can keep calling tools)
        # could exceed it on this hardware, silently killing the whole loop
        # (caught by the bare except below). _filter_relevant_tools() above and
        # explicit num_ctx (vs. Ollama's silent 2048 default) both shrink how
        # often that actually happens, but 300s stays as the margin.
        result = await ollama_client.chat(
            model=runner.model, messages=messages, host=ollama_url,
            options={"temperature": 0, "num_ctx": runner.num_ctx},  # temp 0: favor the most likely (real) tool name over creative guesses
            tools=tools if with_tools else None,
            timeout=300.0,
        )
        return {"content": result["output"], "tool_calls": result.get("tool_calls")}

    try:
        for _ in range(max_rounds):
            msg = await _chat(with_tools=True)
            calls = _extract_tool_calls(msg)
            if not calls:
                return block((msg.get("content") or "").strip())

            messages.append({
                "role": "assistant", "content": msg.get("content") or "",
                "tool_calls": [{"function": {"name": n, "arguments": a}} for n, a in calls],
            })
            for name, arguments in calls:
                text, ok = await runner.run(name, arguments)
                messages.append({"role": "tool", "content": text, "tool_name": name})
                line, kind = _action_line(name, arguments, text, ok)
                actions.append(line)
                runtime_context.record_evidence(
                    "tool_action", server=server_name, tool=name, outcome=kind,
                    arguments=json.dumps(arguments, ensure_ascii=False, sort_keys=True)[:160],
                    detail=((text or "").strip().splitlines() or [""])[0][:160])

        # Round cap hit — force a tool-free final turn instead of
        # silently returning nothing.
        messages.append({
            "role": "user",
            "content": "Stop calling tools. Summarize what you found or did, in plain text.",
        })
        msg = await _chat(with_tools=False)
        return block((msg.get("content") or "").strip())
    except Exception as exc:
        runtime_context.record_evidence("tool_service", server=server_name, outcome="unavailable", error=str(exc))
        return f"[{label} — unavailable] {exc}"


def _as_function(tool: dict) -> dict:
    """An MCP tools/list entry in Ollama's function-tool shape."""
    return {
        "type": "function",
        "function": {
            "name": tool["name"],
            "description": tool.get("description", ""),
            "parameters": tool["inputSchema"],
        },
    }


# ── Conversational loop ──────────────────────────────────────────────────────────


def untrusted_block(source: str, content: str) -> str:
    """Same delimiter as chat._untrusted_block (that module imports this one, so it can't be
    imported from here): marks text that came from outside as data, never instructions."""
    return f'<untrusted-data source="{source}">\n{content}\n</untrusted-data>'


@dataclass
class Toolset:
    """Everything one agent turn may call, prepared before the turn's prompt is sized (the
    schemas take real context space)."""
    schemas: list[dict] = field(default_factory=list)    # sent to the model: at most MAX_TOOLS_PER_CALL
    callable: dict = field(default_factory=dict)         # tool name -> inputSchema, whole catalogs
    servers: dict = field(default_factory=dict)          # MCP tool name -> (server name, server config)
    native: dict = field(default_factory=dict)           # tool name -> NativeTool
    labels: list[str] = field(default_factory=list)      # labels of the servers whose tools are attached
    instructions: str = ""                               # tool rules + per-server notes, for the system prompt

    def __bool__(self) -> bool:
        return bool(self.schemas)


async def prepare_toolset(server_names: Iterable[str], native_tools: Iterable[NativeTool] = (),
                          focus: str = "") -> Toolset:
    """Collect the tools for one agent turn: the native tools, then each selected server's
    catalog. Native tools are always sent; the rest of MAX_TOOLS_PER_CALL is shared round-robin
    between the servers, each contributing its most relevant tools to `focus` first, so one
    big catalog (Kdenlive's ~180) can't crowd out a small one.

    The cap is on schemas *sent*, not tools *callable*: a server tool that didn't make the cut
    can still be called by its exact name (the server notes list the common ones), and it is
    validated against its real schema and tiered like any other.
    """
    gates = _load_gates()
    registered = _load_servers()
    toolset = Toolset(native={t.name: t for t in native_tools})
    toolset.callable = {name: t.schema["function"]["parameters"] for name, t in toolset.native.items()}
    ranked: list[list[dict]] = []
    notes: list[str] = []
    unavailable: list[str] = []
    for name in server_names:
        if name not in registered or not _server_enabled(name):
            continue
        label = gates.get(name, {}).get("label", name)
        try:
            listed = await _mcp_post(registered[name], "tools/list", {})
        except Exception as exc:
            runtime_context.record_evidence("tool_service", server=name, outcome="unavailable", error=str(exc))
            unavailable.append(f"{label}: {exc}")
            continue
        # First registration wins a name clash, so a call always has exactly one target.
        tools = [t for t in map(_as_function, (listed or {}).get("tools", []))
                 if t["function"]["name"] not in toolset.callable]
        if not tools:
            continue
        for tool in tools:
            tool_name = tool["function"]["name"]
            toolset.callable[tool_name] = tool["function"]["parameters"]
            toolset.servers[tool_name] = (name, registered[name])
        ranked.append(_rank_tools(tools, focus))
        toolset.labels.append(label)
        try:
            notes.append((_LOCAL_AGENT_DIR / f"{name}.md").read_text().strip())
        except OSError:
            pass

    toolset.schemas = [t.schema for t in toolset.native.values()]
    while len(toolset.schemas) < MAX_TOOLS_PER_CALL and any(ranked):
        for queue in ranked:
            if queue and len(toolset.schemas) < MAX_TOOLS_PER_CALL:
                toolset.schemas.append(queue.pop(0))

    sections = []
    if toolset.labels:
        sections.append(
            "## Tools for this turn\n\n"
            f"You can operate {', '.join(toolset.labels)} directly with tool calls. Call them "
            "yourself, as many rounds as the request needs, and read each result before deciding "
            "the next step. When you have what you need, stop calling tools and answer the user in "
            "plain prose. Tool results arrive inside <untrusted-data> tags."
        )
        try:
            sections.append((_LOCAL_AGENT_DIR / "AGENT.md").read_text().strip())
        except OSError:
            pass
        sections += notes
    if unavailable:
        sections.append(
            "These tool systems couldn't be reached this turn, so you can't use them; if the "
            "user asks for them, say so rather than guessing:\n" + "\n".join(f"- {u}" for u in unavailable)
        )
    toolset.instructions = "\n\n".join(sections)
    return toolset


# A reply that ends by announcing its next step ("Now I'll create the patch.") instead of
# taking it. Seen live: after read_file, the earlier 14B tool model said exactly that and stopped, so a
# requested change silently never happened. "Let me know ..." is a sign-off, not a step.
_ANNOUNCED_STEP = re.compile(
    r"(?:^|[.!?:]\s+|\n)\s*(?:(?:now|next|first|then),?\s+)?"
    r"(?:i'll|i will|i'm going to|i am going to|let me(?!\s+know))\s+\w[^.!?\n]*[.:…]?\s*$",
    re.IGNORECASE)
ANNOUNCED_STEP_NUDGE = (
    "You said what you'd do next but didn't call a tool. If the request needs that step, make the "
    "tool call now. If it doesn't, give your final answer instead of describing a next step."
)


@dataclass
class AgentResult:
    text: str
    rounds: int
    calls: list[dict]
    model: str
    escalated: bool = False
    forced_final: bool = False


async def run_agent_loop(
    messages: list[dict],
    toolset: Toolset,
    *,
    num_ctx: int,
    reserve: int = 1024,
    num_predict: Optional[int] = None,
    approve: Optional[ApprovalCallback] = None,
    on_event: Optional[Callable[[dict], Awaitable[None]]] = None,
    model: str = DEFAULT_AGENT_MODEL,
    ollama_url: str = DEFAULT_AGENT_OLLAMA_URL,
    max_rounds: int = MAX_AGENT_ROUNDS,
) -> AgentResult:
    """The conversational tool loop. The toolset is attached to the conversation itself
    (system prompt, history, current request), and each round the model either calls tools,
    whose results are added to the conversation, or answers, which ends the turn. There is
    no fixed number of tool rounds: the model decides when it's done, and max_rounds only
    stops one that never does (then it gets one tool-free round to answer from what it has).

    Always runs on the pinned tool-calling model (config.json `model`): many chat models
    describe the JSON instead of sending it. Every round goes through fit_request so growing
    tool results evict the oldest history, then get shortened, before the context overflows.
    Raises ContextBudgetError if even the current request can't fit.

    Tool results are framed as <untrusted-data>; the loop's own notes (DENIED, INVALID CALL)
    are not. on_event receives {"type": "status", "label": ...} before each call.
    """
    messages = list(messages)
    runner = _CallRunner(
        schemas=toolset.callable, servers=toolset.servers, native=toolset.native,
        approve=approve, model=model, ollama_url=ollama_url, num_ctx=num_ctx, ctx_ceiling=num_ctx,
    )
    rounds = 0
    nudged = False

    async def ask(with_tools: bool) -> dict:
        tools = toolset.schemas if with_tools else None
        fitted, budget = fit_request(messages, tools, runner.num_ctx, reserve=reserve, model=runner.model)
        runtime_context.record_evidence("context_budget", round=rounds, **budget)
        options = {"temperature": 0, "num_ctx": runner.num_ctx}  # temp 0: real tool names over creative guesses
        if num_predict:
            options["num_predict"] = num_predict
        result = await ollama_client.chat(
            model=runner.model, messages=fitted, host=ollama_url, options=options, tools=tools, timeout=300.0,
        )
        return {"content": result.get("output") or "", "tool_calls": result.get("tool_calls")}

    def finish(text: str, forced: bool = False) -> AgentResult:
        return AgentResult(text=text.strip(), rounds=rounds, calls=runner.log, model=runner.model,
                           escalated=runner.escalated, forced_final=forced)

    while rounds < max_rounds:
        rounds += 1
        msg = await ask(with_tools=True)
        calls = _extract_tool_calls(msg)
        if not calls:
            # Mid-task (tools already used this turn), an answer that ends by announcing a step
            # gets one nudge to take it or finish; a chatty "I'll remember that" never does.
            if runner.log and not nudged and rounds < max_rounds and _ANNOUNCED_STEP.search(msg["content"][-300:]):
                nudged = True
                messages += [{"role": "assistant", "content": msg["content"]},
                             {"role": "system", "content": ANNOUNCED_STEP_NUDGE}]
                continue
            return finish(msg["content"])
        messages.append({
            # Keep the content only when the calls came in the native field; otherwise the
            # content *is* the call JSON (often after a prose lead-in) and would be sent twice.
            "role": "assistant", "content": msg["content"] if msg.get("tool_calls") else "",
            "tool_calls": [{"function": {"name": n, "arguments": a}} for n, a in calls],
        })
        for name, arguments in calls:
            if on_event:
                await on_event({"type": "status", "label": f"Using {name}…"})
            text, is_output = await runner.run(name, arguments)
            messages.append({
                "role": "tool", "tool_name": name,
                "content": untrusted_block(f"{runner.source(name)}.{name}", text) if is_output else text,
            })

    # A system note rather than a synthetic user turn: fit_request treats user turns as
    # boundaries and could evict the real request and its tool exchanges as old history.
    messages.append({"role": "system", "content": (
        "Tool calls are finished for this turn. Answer the user's request using what the tools "
        "returned, and say plainly what you couldn't finish."
    )})
    msg = await ask(with_tools=False)
    return finish(msg["content"], forced=True)
