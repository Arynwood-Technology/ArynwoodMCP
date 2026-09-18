"""
Self-hosted MCP JSON-RPC server exposing read-only (and one approval-gated
write) codebase tools to central's tool-calling loop.

Registered in mcp/config/mcp_servers.json as "codebase" -> this app's own
loopback URL (same JSON-RPC shape mcp_proxy.py already speaks to the external
Kdenlive service) and gated in mcp/config/local_agent/gates.json. Dispatched
through the existing backend.services.mcp_tool_agent.run_tool_loop machinery,
so tiering/approval/schema-validation all come for free — this file only
implements tools/list + tools/call, nothing else.

Path-based tools reuse fs.py's sandboxing directly (_safe_path/_tree/BASE_DIR/
MAX_FILE_BYTES/SKIP) rather than duplicating this security-critical logic —
one boundary governs every path-based tool this app exposes, dev-checkout-only
(refuses outright in a packaged build, same as fs.py's own /tree, /read, /ls).
"""
from __future__ import annotations

import asyncio
import fnmatch
import json
import os
import re
import shutil
import tempfile
from typing import Optional

from fastapi import APIRouter, HTTPException, Request

from backend.routers.fs import BASE_DIR, MAX_FILE_BYTES, SKIP, _safe_path, _tree

router = APIRouter()  # mounted at /api/mcp-codebase by backend/api.py

# fs.py's SKIP is shared with the UI's File System Browser and only ever used for
# directory listing / single-file reads there, so a build-output dir missing from
# it never mattered. search_code/find_symbol's fallback actually reads file
# *contents* across the whole tree, and this repo's frontend/src-tauri/ (see
# CLAUDE.md's Tauri packaging section) produces a real target/ (Cargo build
# output — confirmed hands-on: walking into it without this exclusion took 7s to
# get through 500 files of binary build artifacts before being killed, nowhere
# near finishing). Kept local to this module rather than added to fs.py's SKIP,
# since that constant is shared with unrelated, unaffected UI behavior.
_GREP_SKIP_DIRS = SKIP | {"target"}
# Defense in depth beyond the directory-name blocklist above: any single file
# over this size gets skipped before being opened, regardless of which directory
# it's in — protects against whatever large/binary file the name-based skip list
# above hasn't anticipated, the same way MAX_FILE_BYTES already protects read_file.
_MAX_GREP_FILE_BYTES = 2 * 1024 * 1024

# Every subprocess this module runs must finish comfortably inside
# mcp_proxy.py's shared, non-overridable 15s httpx timeout on the JSON-RPC
# call that reaches us — there is no way to extend that ceiling per-server,
# so a run that would blow past it gets killed and reported as a timeout
# rather than silently eating the whole call.
_SUBPROCESS_TIMEOUT = 10.0
_TEST_TIMEOUT = 12.0  # run_tests/run_lint get a little more room, still < 15s
_MAX_OUTPUT_CHARS = 20000


def _cap(text: str) -> str:
    if len(text) <= _MAX_OUTPUT_CHARS:
        return text
    return text[:_MAX_OUTPUT_CHARS] + f"\n... (truncated, {len(text) - _MAX_OUTPUT_CHARS} more chars)"


def _tool_text(text: str) -> dict:
    return {"content": [{"type": "text", "text": text}]}


def _tool_error(message: str) -> dict:
    return _tool_text(f"ERROR: {message}")


async def _run_subprocess(cmd: list[str], cwd: Optional[str] = None, timeout: float = _SUBPROCESS_TIMEOUT) -> tuple[int, str, str]:
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd, cwd=cwd,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError as e:
        return -1, "", f"command not found: {e}"
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return -1, "", f"command timed out after {timeout:.0f}s"
    return proc.returncode, stdout.decode(errors="replace"), stderr.decode(errors="replace")


async def _run_git(args: list[str], timeout: float = _SUBPROCESS_TIMEOUT) -> tuple[int, str, str]:
    return await _run_subprocess(["git", "-C", BASE_DIR, *args], timeout=timeout)


# ── list_tree / read_file ────────────────────────────────────────────────────

async def _list_tree(arguments: dict) -> dict:
    path = arguments.get("path", ".")
    depth = max(1, min(int(arguments.get("depth", 2)), 4))
    try:
        real = _safe_path(path)
    except HTTPException as e:
        return _tool_error(str(e.detail))
    if not os.path.exists(real):
        return _tool_error(f"Path not found: {path}")
    return _tool_text(json.dumps(_tree(real, 0, depth), indent=2))


async def _read_file(arguments: dict) -> dict:
    path = arguments.get("path")
    if not path:
        return _tool_error('missing required argument "path"')
    try:
        real = _safe_path(path)
    except HTTPException as e:
        return _tool_error(str(e.detail))
    if not os.path.exists(real):
        return _tool_error(f"File not found: {path}")
    if not os.path.isfile(real):
        return _tool_error("Path is a directory — use list_tree")
    size = os.path.getsize(real)
    if size > MAX_FILE_BYTES:
        return _tool_error(f"File too large ({size // 1024} KB). Max is 256 KB.")
    try:
        with open(real, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except Exception as e:
        return _tool_error(f"Could not read file: {e}")

    start_line = arguments.get("start_line")
    end_line = arguments.get("end_line")
    if not start_line and not end_line:
        return _tool_text(content)

    lines = content.splitlines()
    start = max(1, int(start_line or 1))
    end = min(len(lines), int(end_line or len(lines)))
    header = f"(showing lines {start}-{end} of {len(lines)} total)\n"
    return _tool_text(header + "\n".join(lines[start - 1:end]))


# ── search_code / find_symbol ────────────────────────────────────────────────

async def _grep(query: str, path: str, glob: Optional[str], max_results: int, *, regex: bool) -> dict:
    try:
        real = _safe_path(path)
    except HTTPException as e:
        return _tool_error(str(e.detail))
    if not os.path.exists(real):
        return _tool_error(f"Path not found: {path}")
    rel_target = os.path.relpath(real, BASE_DIR)

    if shutil.which("rg"):
        cmd = ["rg", "--line-number", "--no-heading", "--color", "never"]
        if not regex:
            cmd.append("--fixed-strings")
        if glob:
            cmd += ["--glob", glob]
        cmd += ["--", query, rel_target]
        code, out, err = await _run_subprocess(cmd, cwd=BASE_DIR)
        if code not in (0, 1):  # 1 = ripgrep's "no matches" exit code, not an error
            return _tool_error(f"ripgrep failed: {err.strip()[:500]}")
        lines = out.splitlines()[:max_results]
        mode = "(ripgrep)"
        body = "\n".join(lines) if lines else "(no matches)"
    else:
        try:
            pattern = re.compile(query if regex else re.escape(query), re.IGNORECASE)
        except re.error as e:
            return _tool_error(f"invalid pattern: {e}")
        matches: list[str] = []
        for root, dirs, files in os.walk(real):
            dirs[:] = [d for d in dirs if d not in _GREP_SKIP_DIRS and not d.startswith(".")]
            for fname in files:
                if glob and not fnmatch.fnmatch(fname, glob):
                    continue
                fpath = os.path.join(root, fname)
                try:
                    if os.path.getsize(fpath) > _MAX_GREP_FILE_BYTES:
                        continue
                except OSError:
                    continue
                try:
                    with open(fpath, "r", encoding="utf-8", errors="replace") as f:
                        for i, line in enumerate(f, 1):
                            if pattern.search(line):
                                rel = os.path.relpath(fpath, BASE_DIR)
                                matches.append(f"{rel}:{i}:{line.rstrip()}")
                                if len(matches) >= max_results:
                                    break
                except OSError:
                    continue
                if len(matches) >= max_results:
                    break
            if len(matches) >= max_results:
                break
        mode = "(plain-text fallback — ripgrep is not installed on this machine)"
        body = "\n".join(matches) if matches else "(no matches)"
    return _tool_text(f"{mode}\n{body}")


async def _search_code(arguments: dict) -> dict:
    query = arguments.get("query")
    if not query:
        return _tool_error('missing required argument "query"')
    max_results = max(1, min(int(arguments.get("max_results", 50)), 200))
    return await _grep(query, arguments.get("path", "."), arguments.get("glob"), max_results, regex=False)


_ORBIT_QUERY_TIMEOUT = _SUBPROCESS_TIMEOUT
_BG_INDEX_STARTED: set[str] = set()  # "{repo_path}@{commit}" already kicked off this process


def _sql_escape(value: str) -> str:
    return value.replace("'", "''")


async def _run_orbit_sql(query: str) -> tuple[bool, list[dict], str]:
    """Returns (ok, rows, error_text). rows is [] on any failure."""
    if not shutil.which("orbit"):
        return False, [], "orbit is not installed on this machine"
    code, out, err = await _run_subprocess(["orbit", "sql", "-F", "json", query], timeout=_ORBIT_QUERY_TIMEOUT)
    if code != 0:
        return False, [], err.strip()[:300] or "orbit query failed"
    try:
        return True, json.loads(out or "[]"), ""
    except json.JSONDecodeError:
        return False, [], "orbit returned unparseable output"


def _start_background_index(commit: str) -> None:
    key = f"{BASE_DIR}@{commit}"
    if key in _BG_INDEX_STARTED:
        return
    _BG_INDEX_STARTED.add(key)

    async def _bg() -> None:
        try:
            proc = await asyncio.create_subprocess_exec(
                "orbit", "index", BASE_DIR,
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
            )
            await proc.wait()
        except Exception:
            pass

    asyncio.create_task(_bg())


async def _find_symbol_fallback(name: str, reason: str) -> dict:
    pattern = r"\b(def|class|function|const|let|var|interface|type)\s+" + re.escape(name) + r"\b"
    result = await _grep(pattern, ".", None, 20, regex=True)
    body = result["content"][0]["text"]
    note = f"[heuristic text match — not verified against a real symbol table ({reason})]\n"
    return _tool_text(note + body)


async def _find_symbol(arguments: dict) -> dict:
    name = arguments.get("name")
    if not name:
        return _tool_error('missing required argument "name"')

    ok, manifest, err = await _run_orbit_sql(
        f"SELECT project_id, commit_sha FROM _orbit_manifest WHERE repo_path = '{_sql_escape(BASE_DIR)}'"
    )
    if not ok:
        return await _find_symbol_fallback(name, err)

    _, git_out, _ = await _run_git(["rev-parse", "HEAD"])
    current_commit = git_out.strip() or None

    if not manifest:
        if current_commit:
            _start_background_index(current_commit)
        return await _find_symbol_fallback(
            name, "this repo has not been indexed by orbit yet — indexing just started in the background, try again shortly"
        )

    project_id = manifest[0]["project_id"]
    indexed_commit = manifest[0]["commit_sha"]
    stale_note = ""
    if current_commit and indexed_commit != current_commit:
        _start_background_index(current_commit)
        stale_note = (
            f"(orbit index is from commit {indexed_commit[:8]}, current is {current_commit[:8]} "
            "— a re-index just started in the background; symbols may have moved)\n"
        )

    ok, rows, err = await _run_orbit_sql(
        "SELECT file_path, name, fqn, definition_type, start_line, end_line FROM gl_definition "
        f"WHERE project_id = {int(project_id)} AND (name = '{_sql_escape(name)}' OR fqn LIKE '%{_sql_escape(name)}%') "
        "LIMIT 20"
    )
    if not ok:
        return await _find_symbol_fallback(name, err)
    if not rows:
        return await _find_symbol_fallback(name, "orbit's index has no symbol matching that name")

    lines = [
        f"{r['file_path']}:{r['start_line']}-{r['end_line']}  {r['definition_type']} {r.get('fqn') or r['name']}"
        for r in rows
    ]
    header = f"[orbit index, commit {indexed_commit[:8]}]\n"
    return _tool_text(stale_note + header + "\n".join(lines))


# ── git_status / git_diff ────────────────────────────────────────────────────

async def _git_status(arguments: dict) -> dict:
    code, out, err = await _run_git(["status", "--porcelain"])
    if code != 0:
        return _tool_error(err.strip() or "git status failed")
    return _tool_text(_cap(out) if out.strip() else "(clean working tree)")


async def _git_diff(arguments: dict) -> dict:
    path = arguments.get("path")
    staged = bool(arguments.get("staged", False))
    args = ["diff"]
    if staged:
        args.append("--cached")
    if path:
        try:
            real = _safe_path(path)
        except HTTPException as e:
            return _tool_error(str(e.detail))
        args += ["--", real]
    code, out, err = await _run_git(args)
    if code != 0:
        return _tool_error(err.strip() or "git diff failed")
    return _tool_text(_cap(out) if out.strip() else "(no differences)")


# ── run_tests / run_lint ─────────────────────────────────────────────────────

async def _run_tests(arguments: dict) -> dict:
    target = arguments.get("target")
    cmd = ["python", "-m", "pytest", "-q"]
    if target:
        try:
            real = _safe_path(target)
        except HTTPException as e:
            return _tool_error(str(e.detail))
        cmd.append(real)
    code, out, err = await _run_subprocess(cmd, cwd=BASE_DIR, timeout=_TEST_TIMEOUT)
    if code == -1 and "timed out" in err:
        return _tool_error(f"{err} — narrow the target and try again")
    return _tool_text(_cap(out + err))


async def _run_lint(arguments: dict) -> dict:
    frontend_dir = os.path.join(BASE_DIR, "frontend")
    if not os.path.isdir(frontend_dir):
        return _tool_error("no frontend/ directory found in this checkout")
    # A full `npm run lint` (bare `eslint .`) reliably exceeds the shared timeout
    # on this repo's real size (confirmed hands-on, not assumed) — target is not
    # optional in practice the way run_tests' is, so scope to it directly via
    # eslint's own CLI rather than npm's script wrapper (npm run lint -- <path>
    # still works, but calling eslint directly avoids npm's own startup overhead
    # eating further into an already-tight budget).
    target = arguments.get("target")
    if target:
        try:
            real = _safe_path(target)
        except HTTPException as e:
            return _tool_error(str(e.detail))
        cmd = ["npx", "eslint", real]
    else:
        cmd = ["npm", "run", "lint"]
    code, out, err = await _run_subprocess(cmd, cwd=frontend_dir, timeout=_TEST_TIMEOUT)
    if code == -1 and "timed out" in err:
        return _tool_error(f"{err} — a full run reliably exceeds this tool's time budget on this repo; pass a specific file or directory as `target` instead")
    return _tool_text(_cap(out + err))


# ── apply_patch (destructive tier — approval already granted by the time this runs) ─

_DIFF_HEADER_RE = re.compile(r"^(?:\+\+\+|---)\s+(?:[ab]/)?(\S+)", re.MULTILINE)


async def _apply_patch(arguments: dict) -> dict:
    diff = arguments.get("diff")
    if not diff:
        return _tool_error('missing required argument "diff"')

    touched = {p for p in _DIFF_HEADER_RE.findall(diff) if p != "/dev/null"}
    if not touched:
        return _tool_error("could not find any file paths in the diff — provide a unified diff with ---/+++ headers")
    for p in touched:
        try:
            _safe_path(p)
        except HTTPException as e:
            return _tool_error(f"patch touches a path outside the project root ({p}): {e.detail}")

    tmp_path = None
    try:
        fd, tmp_path = tempfile.mkstemp(suffix=".patch")
        with os.fdopen(fd, "w") as f:
            f.write(diff)

        code, _, err = await _run_git(["apply", "--check", tmp_path])
        if code != 0:
            return _tool_error(f"patch does not apply cleanly (dry run): {err.strip()[:1000]}")

        code, _, err = await _run_git(["apply", tmp_path])
        if code != 0:
            return _tool_error(f"git apply failed: {err.strip()[:1000]}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)

    return _tool_text(f"Patch applied successfully to: {', '.join(sorted(touched))}")


# ── MCP surface ───────────────────────────────────────────────────────────────

TOOLS: list[dict] = [
    {
        "name": "list_tree",
        "description": "List this app's own source directory structure as a JSON tree, up to a given depth. Use to orient yourself before reading files — not a substitute for actually reading one.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Relative path from the project root. Defaults to the root itself."},
                "depth": {"type": "integer", "description": "How many directory levels deep to list (1-4). Defaults to 2."},
            },
            "required": [],
        },
    },
    {
        "name": "read_file",
        "description": "Read the text content of one file in this app's own source tree, optionally a specific line range. Max 256 KB. Always cite the file path and line numbers you actually read when answering from this.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Relative path from the project root."},
                "start_line": {"type": "integer", "description": "1-indexed first line to include (optional)."},
                "end_line": {"type": "integer", "description": "1-indexed last line to include (optional)."},
            },
            "required": ["path"],
        },
    },
    {
        "name": "search_code",
        "description": "Search this app's own source code for a literal string, across files. Returns file:line:text matches. Use before read_file to find where something lives.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Text to search for (literal, not a regex)."},
                "path": {"type": "string", "description": "Relative path to scope the search to. Defaults to the whole project."},
                "glob": {"type": "string", "description": "Optional filename glob to restrict matches, e.g. '*.py'."},
                "max_results": {"type": "integer", "description": "Cap on returned matches. Defaults to 50."},
            },
            "required": ["query"],
        },
    },
    {
        "name": "find_symbol",
        "description": "Look up a function/class/component definition by name using a real code graph when available, falling back to a text heuristic otherwise. The result always states which mode answered — treat a heuristic match as unverified, never as confirmed.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Symbol name to look up, e.g. 'gather_context_for_message'."},
            },
            "required": ["name"],
        },
    },
    {
        "name": "git_status",
        "description": "Show this repo's current git status (porcelain format) — modified/staged/untracked files.",
        "inputSchema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "git_diff",
        "description": "Show a git diff for this repo, optionally scoped to one path and/or staged changes only.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Optional relative path to scope the diff to."},
                "staged": {"type": "boolean", "description": "Show staged (--cached) changes instead of the working tree. Defaults to false."},
            },
            "required": [],
        },
    },
    {
        "name": "run_tests",
        "description": "Run this repo's Python test suite (pytest; the slow live-model eval tests are excluded by default), optionally scoped to one file or directory. Capped at ~12 seconds — narrow the target if a full run would exceed that.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "target": {"type": "string", "description": "Optional relative path to a test file or directory to run instead of the whole suite."},
            },
            "required": [],
        },
    },
    {
        "name": "run_lint",
        "description": "Run this repo's frontend ESLint config. There is no configured Python linter in this repo. Capped at ~12 seconds — a full unscoped run reliably exceeds that on this repo's real size, so pass `target` (a specific file or directory under frontend/) to get a result that actually completes.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "target": {"type": "string", "description": "Relative path to a specific file or directory to lint instead of the whole frontend. Recommended — an unscoped run will very likely time out."},
            },
            "required": [],
        },
    },
    {
        "name": "apply_patch",
        "description": "Apply a unified diff (as 'git diff' or 'git apply' would expect) to this repo's own source tree. Every touched path must resolve inside the project root or the whole patch is rejected. Destructive — requires explicit user approval before it runs.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "diff": {"type": "string", "description": "A unified diff with ---/+++ file headers and @@ hunks."},
            },
            "required": ["diff"],
        },
    },
]

TOOL_HANDLERS = {
    "list_tree": _list_tree,
    "read_file": _read_file,
    "search_code": _search_code,
    "find_symbol": _find_symbol,
    "git_status": _git_status,
    "git_diff": _git_diff,
    "run_tests": _run_tests,
    "run_lint": _run_lint,
    "apply_patch": _apply_patch,
}


@router.post("")
async def mcp_codebase_rpc(request: Request):
    """Minimal MCP-over-HTTP JSON-RPC surface — tools/list and tools/call only,
    matching exactly what mcp_proxy.py's _mcp_post sends and _parse_mcp_response
    expects back (plain JSON, no SSE needed for a same-process loopback call)."""
    try:
        body = await request.json()
    except Exception:
        return {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}}

    req_id = body.get("id", 1)
    method = body.get("method")
    params = body.get("params") or {}

    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": req_id, "result": {"tools": TOOLS}}

    if method == "tools/call":
        name = params.get("name")
        arguments = params.get("arguments") or {}
        handler = TOOL_HANDLERS.get(name)
        if handler is None:
            return {"jsonrpc": "2.0", "id": req_id, "result": _tool_error(f'no tool named "{name}"')}
        try:
            result = await handler(arguments)
        except Exception as exc:
            result = _tool_error(f"internal error: {exc}")
        return {"jsonrpc": "2.0", "id": req_id, "result": result}

    return {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32601, "message": f"Method not found: {method}"}}
