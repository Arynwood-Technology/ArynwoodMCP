"""
MCP proxy router — forwards JSON-RPC calls to configured MCP servers.
Config loaded from mcp/config/mcp_servers.json.
"""
import json
import os
from typing import Any, Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

_CONFIG_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "mcp", "config", "mcp_servers.json"
)


def _load_servers() -> dict:
    """Load the MCP server registry from mcp/config/mcp_servers.json."""
    if not os.path.exists(_CONFIG_PATH):
        return {}
    with open(_CONFIG_PATH) as f:
        return json.load(f).get("mcpServers", {})


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
    url = server_cfg["url"]
    headers = {
        **server_cfg.get("headers", {}),
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    body = {"jsonrpc": "2.0", "method": method, "params": params, "id": req_id}
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
    return [{"name": k, "url": v["url"]} for k, v in servers.items()]


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
