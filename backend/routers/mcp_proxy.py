"""
MCP proxy router — forwards JSON-RPC calls to configured MCP servers.
Config loaded from mcp/config/mcp_servers.json.
"""
import json
import os
import sys
from typing import Any, Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend._frozen import user_data_dir

router = APIRouter()


def _config_path() -> str:
    # Unlike models.json/local_agent/* (bundled app payload, read via
    # app_base_dir()), mcp_servers.json is personal/gitignored per-install
    # config (bearer tokens, host-specific URLs) — mutable state, not
    # something baked into a build. Same split as db.py's _default_db_path():
    # source checkout keeps the existing mcp/config/ path under the repo
    # root; a packaged build's install location is read-only (AppImage
    # squashfs mount, or a non-writable .deb path), so it goes straight in
    # the writable XDG data dir instead, with no meaningful "mcp/config"
    # subdir once you're already in a per-app data directory.
    d = user_data_dir() if getattr(sys, "frozen", False) else os.path.join(user_data_dir(), "mcp", "config")
    return os.path.join(d, "mcp_servers.json")


_CONFIG_PATH = _config_path()


# Servers this backend hosts itself, dispatched in-process (see _mcp_post) rather than over
# HTTP. "codebase" used to be registered in mcp_servers.json as http://127.0.0.1:8010/...,
# which only works in the process that owns :8010 — the headless gateway daemon (another
# port) would have called into the desktop backend, or into nothing when it isn't running.
# A built-in entry replaces any mcp_servers.json entry of the same name.
_IN_PROCESS_HANDLERS = {
    "codebase": "backend.routers.mcp_codebase:handle_rpc",
}


def _builtin_servers() -> dict:
    if os.environ.get("ARYNWOOD_ENABLE_CODEBASE_TOOLS") == "1":  # same opt-in as its router
        return {"codebase": {"in_process": "codebase"}}
    return {}


def _load_servers() -> dict:
    """Load the MCP server registry from mcp/config/mcp_servers.json, plus this backend's
    own built-in servers."""
    servers = {}
    if os.path.exists(_CONFIG_PATH):
        with open(_CONFIG_PATH) as f:
            servers = json.load(f).get("mcpServers", {})
    return {**servers, **_builtin_servers()}


async def _in_process_post(name: str, body: dict) -> Any:
    import importlib
    module_name, func_name = _IN_PROCESS_HANDLERS[name].split(":")
    handler = getattr(importlib.import_module(module_name), func_name)
    return await handler(body)


class ToolCallRequest(BaseModel):
    server: str
    tool: str
    arguments: dict = {}


def _parse_mcp_response(text: str, content_type: str) -> Any:
    """Parse MCP response — handles both plain JSON and SSE (text/event-stream)."""
    if "text/event-stream" in content_type or text.startswith("event:"):
        for line in text.splitlines():
            if line.startswith("data:"):
                return json.loads(line[5:].strip())
        raise HTTPException(502, "Empty SSE response from MCP server")
    return json.loads(text)


async def _mcp_post(server_cfg: dict, method: str, params: dict, req_id: int = 1) -> Any:
    """Send a JSON-RPC 2.0 request to an MCP server and return the result."""
    body = {"jsonrpc": "2.0", "method": method, "params": params, "id": req_id}
    if server_cfg.get("in_process"):
        data = await _in_process_post(server_cfg["in_process"], body)
        if "error" in data:
            raise HTTPException(502, f"MCP error: {data['error']}")
        return data.get("result")
    url = server_cfg["url"]
    headers = {
        **server_cfg.get("headers", {}),
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.post(url, json=body, headers=headers)
        r.raise_for_status()
        data = _parse_mcp_response(r.text, r.headers.get("content-type", ""))
    if "error" in data:
        raise HTTPException(502, f"MCP error: {data['error']}")
    return data.get("result")


@router.get("/servers")
async def list_mcp_servers():
    """List all configured MCP servers with their names and base URLs."""
    servers = _load_servers()
    return [{"name": k, "url": v.get("url") or "in-process"} for k, v in servers.items()]


@router.get("/servers/{server_name}/tools")
async def list_tools(server_name: str):
    """Fetch the tool manifest from a specific MCP server via tools/list."""
    servers = _load_servers()
    if server_name not in servers:
        raise HTTPException(404, f"MCP server '{server_name}' not found")
    result = await _mcp_post(servers[server_name], "tools/list", {})
    return result


@router.post("/call")
async def call_tool(body: ToolCallRequest):
    """Invoke a named tool on a configured MCP server and return its result."""
    servers = _load_servers()
    if body.server not in servers:
        raise HTTPException(404, f"MCP server '{body.server}' not found")
    result = await _mcp_post(
        servers[body.server],
        "tools/call",
        {"name": body.tool, "arguments": body.arguments},
    )
    return result
