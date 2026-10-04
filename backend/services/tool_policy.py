"""Shared MCP policy and single-use, process-local execution authorizations.

No client-supplied boolean or JSON-RPC field is an execution grant. Owner code
issues grants only after the existing trusted approval channel confirms an intent.
This is application policy, not OS isolation or a boundary against local Python.
"""
from __future__ import annotations

import hashlib
import json
import secrets
import time
from contextvars import ContextVar
from dataclasses import dataclass

TIER_READ_ONLY = "read_only"
TIER_REVERSIBLE = "reversible_write"
TIER_DESTRUCTIVE = "destructive"
TIER_EXTERNAL_PUBLISH = "external_publish"  # configurable only by trusted owner policy

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
_READ_ONLY_NAMES = {"detect_scenes", "find_clip", "read_file", "search_code", "find_symbol", "git_status", "git_diff"}
_REVERSIBLE_NAMES = {
    "build_timeline", "export_subtitles", "extract_zone", "fill_frame",
    "rebuild_clip_proxy", "relink_clip", "resize_composition", "resize_subtitle",
    "speech_recognition",
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
    if not isinstance(arguments, dict):
        return ["tool arguments must be an object"]
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
        check = _JSON_TYPE_CHECKS.get(expected) if isinstance(expected, str) else None
        if check is not None and not check(value):
            problems.append(f'argument "{name}" should be {expected}, got {type(value).__name__}')
    return problems


APPROVAL_TTL_SECONDS = 120.0
MAX_OUTSTANDING_GRANTS = 256
MAX_INTENT_BYTES = 256 * 1024


class PolicyDenied(Exception):
    """No valid authorization for this exact operation."""


class InvalidToolCall(ValueError):
    """Malformed arguments or schema mismatch; never dispatch."""


def canonical(value) -> str:
    try:
        encoded = json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)
    except (ValueError, TypeError, RecursionError) as exc:
        raise InvalidToolCall('Tool call must contain finite JSON values') from exc
    if len(encoded.encode('utf-8')) > MAX_INTENT_BYTES:
        raise InvalidToolCall('Tool call or configuration is too large')
    return encoded


def classify_mcp_tool(server: str, config: dict, name: str) -> str:
    overrides = config.get('tool_tiers', {})
    configured = overrides.get(name) if isinstance(overrides, dict) else None
    if configured in (TIER_READ_ONLY, TIER_REVERSIBLE, TIER_DESTRUCTIVE, TIER_EXTERNAL_PUBLISH):
        return configured
    if server == 'kdenlive':
        return classify_tool_tier(name)
    if server == 'codebase' and name in {'list_tree', 'read_file', 'search_code', 'find_symbol', 'git_status', 'git_diff'}:
        return TIER_READ_ONLY
    return TIER_DESTRUCTIVE


def requires_approval(tier: str) -> bool:
    return tier not in (TIER_READ_ONLY, TIER_REVERSIBLE)


@dataclass(frozen=True)
class CallIntent:
    server: str
    tool: str
    config_json: str
    arguments_json: str
    schema_json: str
    tier: str
    caller: str
    created_at: float

    @property
    def binding(self) -> str:
        data = [self.server, self.tool, self.config_json, self.arguments_json,
                self.schema_json, self.tier, self.caller]
        return hashlib.sha256(canonical(data).encode('utf-8')).hexdigest()

    @property
    def arguments(self) -> dict:
        return json.loads(self.arguments_json)

    @property
    def config(self) -> dict:
        return json.loads(self.config_json)


def make_intent(server: str, config: dict, tool: str, arguments: dict,
                schema: dict, caller: str) -> CallIntent:
    if not isinstance(arguments, dict):
        raise InvalidToolCall('Tool arguments must be an object')
    if not isinstance(schema, dict):
        raise InvalidToolCall('Tool input schema must be an object')
    problems = _validate_tool_arguments(arguments, schema)
    if problems:
        raise InvalidToolCall('; '.join(problems))
    return CallIntent(server, tool, canonical(config), canonical(arguments), canonical(schema),
                      classify_mcp_tool(server, config, tool), caller, time.monotonic())


class ApprovalAuthority:
    """Synchronous consume prevents concurrent reuse in this process's event loop.

    Grants vanish on restart, expire from intent creation, and are consumed before
    execution, including failed dispatch. They are never returned by an HTTP route.
    """
    def __init__(self):
        self._grants: dict[str, tuple[str, float]] = {}

    def issue(self, intent: CallIntent) -> str:
        now = time.monotonic()
        self._grants = {token: record for token, record in self._grants.items() if record[1] > now}
        expires = intent.created_at + APPROVAL_TTL_SECONDS
        if now >= expires:
            raise PolicyDenied('Approval expired; request a new review')
        if len(self._grants) >= MAX_OUTSTANDING_GRANTS:
            raise PolicyDenied('Too many outstanding approvals')
        token = secrets.token_urlsafe(32)
        self._grants[token] = (intent.binding, expires)
        return token

    def consume(self, token: str | None, intent: CallIntent) -> None:
        record = self._grants.pop(token, None) if isinstance(token, str) else None
        if record is None or record[1] <= time.monotonic() or record[0] != intent.binding:
            raise PolicyDenied('Missing, expired, changed, or already consumed approval')


authority = ApprovalAuthority()
execution_intent: ContextVar[CallIntent | None] = ContextVar('mcp_execution_intent', default=None)
approval_intent: ContextVar[CallIntent | None] = ContextVar('mcp_approval_intent', default=None)


def approval_metadata() -> dict:
    intent = approval_intent.get()
    if intent is None:
        return {}
    return {'server': intent.server, 'intent_digest': intent.binding,
            'expires_in_seconds': max(0, int(APPROVAL_TTL_SECONDS - (time.monotonic() - intent.created_at)))}


async def dispatch(intent: CallIntent, transport, grant: str | None = None):
    """The same authorization gate precedes model and direct-API MCP execution."""
    # Rebuild from immutable JSON to validate again and prevent handcrafted intents
    # from downgrading server policy or skipping argument validation.
    checked = make_intent(intent.server, intent.config, intent.tool, intent.arguments,
                          json.loads(intent.schema_json), intent.caller)
    if checked.binding != intent.binding:
        raise PolicyDenied('Tool policy or intent changed')
    if requires_approval(intent.tier):
        authority.consume(grant, intent)
    token = execution_intent.set(intent)
    try:
        return await transport(intent.config, 'tools/call', {'name': intent.tool, 'arguments': intent.arguments})
    finally:
        execution_intent.reset(token)


def authorize_codebase_rpc(name: str, arguments: dict, schema: dict) -> None:
    """Guard raw HTTP and in-process RPC; serialized approval fields grant nothing."""
    frame = execution_intent.get()
    if frame is not None:
        if frame.server != 'codebase' or frame.tool != name or frame.arguments_json != canonical(arguments) or frame.schema_json != canonical(schema):
            raise PolicyDenied('RPC does not match the authorized operation')
        return
    intent = make_intent('codebase', {'in_process': 'codebase'}, name, arguments, schema, 'direct-rpc')
    if requires_approval(intent.tier):
        raise PolicyDenied('This tool requires chat or gateway approval; direct RPC execution is refused')
