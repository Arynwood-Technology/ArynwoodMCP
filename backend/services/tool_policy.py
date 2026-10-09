"""Shared MCP policy and single-use, process-local execution authorizations.

No client-supplied boolean or JSON-RPC field is an execution grant. Owner code
issues grants only after the existing trusted approval channel confirms an intent.
This is application policy, not OS isolation or a boundary against local Python.
"""
from __future__ import annotations

import hashlib
import json
import logging
import secrets
import time
from contextvars import ContextVar
from dataclasses import dataclass

from jsonschema import validators
from jsonschema.exceptions import SchemaError, ValidationError
from referencing import Registry
from referencing.exceptions import NoSuchResource

log = logging.getLogger('mcp.security')

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


def _deny_schema_fetch(uri):
    # Untrusted schemas must never initiate filesystem or network retrieval.
    raise NoSuchResource(ref=uri)


def _validate_tool_arguments(arguments: dict, schema: dict) -> list[str]:
    """Validate full JSON Schema without including argument values in errors."""
    if not isinstance(arguments, dict):
        return ['tool arguments must be an object']
    if not isinstance(schema, dict):
        return ['tool input schema must be an object']
    try:
        canonical(arguments)
        canonical(schema)
        validator_class = validators.validator_for(schema)
        validator_class.check_schema(schema)
        validator_class(schema, registry=Registry(retrieve=_deny_schema_fetch)).validate(arguments)
    except ValidationError as exc:
        # Preserve useful locations/keywords, but never interpolate secret values.
        if exc.validator == 'required':
            missing = [field for field in exc.validator_value if field not in exc.instance]
            return [f'missing required argument {field!r}' for field in missing]
        expected = f', expected {exc.validator_value}' if exc.validator == 'type' else ''
        return [f'argument validation failed at {list(exc.absolute_path)} ({exc.validator}{expected})']
    except (SchemaError, ValueError, TypeError, RecursionError):
        return ['invalid or unsupported tool input schema']
    except Exception:
        # Includes unresolved references. Fail closed rather than fetch a remote schema.
        return ['tool input schema could not be resolved or validated']
    return []


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
    definition_json: str | None = None

    @property
    def binding(self) -> str:
        data = [self.server, self.tool, self.config_json, self.arguments_json,
                self.schema_json, self.tier, self.caller, self.definition_json]
        return hashlib.sha256(canonical(data).encode('utf-8')).hexdigest()

    @property
    def arguments(self) -> dict:
        return json.loads(self.arguments_json)

    @property
    def config(self) -> dict:
        return json.loads(self.config_json)


def make_intent(server: str, config: dict, tool: str, arguments: dict,
                schema: dict, caller: str, definition: dict | None = None) -> CallIntent:
    if not isinstance(arguments, dict):
        raise InvalidToolCall('Tool arguments must be an object')
    if not isinstance(schema, dict):
        raise InvalidToolCall('Tool input schema must be an object')
    if definition is not None:
        entry = tool_catalog({'tools': [definition]}).get(tool)
        if entry is None or canonical(entry['inputSchema']) != canonical(schema):
            raise InvalidToolCall('Tool definition does not match the call schema')
    problems = _validate_tool_arguments(arguments, schema)
    if problems:
        raise InvalidToolCall('; '.join(problems))
    return CallIntent(server, tool, canonical(config), canonical(arguments), canonical(schema),
                      classify_mcp_tool(server, config, tool), caller, time.monotonic(),
                      canonical(definition) if definition is not None else None)


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
    # Digests correlate attempts without logging arguments, endpoints or credentials.
    log.info('MCP dispatch attempt', extra={'intent_digest': intent.binding})
    # Rebuild from immutable JSON to validate again and prevent handcrafted intents
    # from downgrading server policy or skipping argument validation.
    checked = make_intent(intent.server, intent.config, intent.tool, intent.arguments,
                          json.loads(intent.schema_json), intent.caller,
                          json.loads(intent.definition_json) if intent.definition_json is not None else None)
    if checked.binding != intent.binding:
        raise PolicyDenied('Tool policy or intent changed')
    if requires_approval(intent.tier):
        authority.consume(grant, intent)
    if intent.definition_json is not None:
        # A fresh remote observation, not a comparison of the snapshot with itself.
        from backend.routers.mcp_proxy import _load_servers
        if canonical(_load_servers().get(intent.server)) != intent.config_json:
            raise PolicyDenied('Tool server configuration changed or was removed')
        listed = await transport(intent.config, 'tools/list', {})
        catalog = tool_catalog(listed)
        if canonical(_load_servers().get(intent.server)) != intent.config_json:
            raise PolicyDenied('Tool server configuration changed during definition recheck')
        if intent.tool not in catalog or canonical(catalog[intent.tool]) != intent.definition_json:
            raise PolicyDenied('Tool definition changed or was removed; start a new review')
    token = execution_intent.set(intent)
    try:
        result = await transport(intent.config, 'tools/call', {'name': intent.tool, 'arguments': intent.arguments})
        log.info('MCP dispatch returned', extra={'intent_digest': intent.binding})
        return result
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


def tool_catalog(listed: dict) -> dict[str, dict]:
    """Reject ambiguous/malformed catalogs before exposing any of their tools."""
    if not isinstance(listed, dict) or not isinstance(listed.get('tools'), list):
        raise InvalidToolCall('Invalid tool catalog')
    catalog = {}
    for tool in listed['tools']:
        if (not isinstance(tool, dict) or not isinstance(tool.get('name'), str)
                or not tool['name'] or not isinstance(tool.get('inputSchema'), dict)
                or not isinstance(tool.get('description', ''), str)):
            raise InvalidToolCall('Invalid tool definition')
        name = tool['name']
        if name in catalog:
            raise InvalidToolCall('Duplicate tool name in server catalog')
        # Include annotations and all other metadata, even though they grant no authority.
        canonical(tool)
        catalog[name] = json.loads(canonical(tool))
    return catalog
