"""Regression coverage for browser, filesystem, and MCP trust boundaries."""
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from backend.services.auth import ApiKeyMiddleware, TRUSTED_BROWSER_ORIGINS
from backend.services import mcp_tool_agent as agent
from backend.routers import fs, mcp_codebase


@pytest.mark.parametrize('kind', ['http', 'websocket'])
@pytest.mark.parametrize('origin', ['https://evil.example', 'null', 'http://localhost:5180.evil.example'])
async def test_hostile_browser_never_reaches_api(monkeypatch, kind, origin):
    monkeypatch.delenv('ARYNWOOD_API_KEY', raising=False)
    inner, send = AsyncMock(), AsyncMock()
    scope = {'type': kind, 'path': '/api/mcp/call', 'headers': [(b'origin', origin.encode())]}
    await ApiKeyMiddleware(inner)(scope, None, send)
    inner.assert_not_awaited()
    event = send.call_args_list[0].args[0]
    assert event.get('status') == 403 if kind == 'http' else event.get('code') == 4403


@pytest.mark.parametrize('origin', TRUSTED_BROWSER_ORIGINS)
async def test_application_origins_remain_usable(monkeypatch, origin):
    monkeypatch.delenv('ARYNWOOD_API_KEY', raising=False)
    inner = AsyncMock()
    await ApiKeyMiddleware(inner)({'type': 'http', 'path': '/api/memory', 'headers': [(b'origin', origin.encode())]}, None, None)
    inner.assert_awaited_once()


async def test_token_does_not_override_hostile_origin(monkeypatch):
    monkeypatch.setenv('ARYNWOOD_API_KEY', 'secret')
    inner, send = AsyncMock(), AsyncMock()
    await ApiKeyMiddleware(inner)({'type': 'websocket', 'path': '/api/chat/ws', 'headers': [(b'origin', b'https://evil.example')], 'query_string': b'token=secret'}, None, send)
    inner.assert_not_awaited()
    assert send.call_args.args[0]['code'] == 4403


def test_project_path_rejects_sibling_prefix_and_symlink(monkeypatch, tmp_path):
    root = tmp_path / 'project'
    root.mkdir()
    sibling = tmp_path / 'project-secrets'
    sibling.mkdir()
    (root / 'escape').symlink_to(sibling, target_is_directory=True)
    monkeypatch.setattr(fs, 'BASE_DIR', str(root))
    assert fs._safe_path('.') == str(root)
    assert fs._safe_path('src/file.py') == str(root / 'src/file.py')
    for path in ['../project-secrets/key', 'escape/key']:
        with pytest.raises(HTTPException) as exc:
            fs._safe_path(path)
        assert exc.value.status_code == 403


def runner(server, config=None, name='get_secrets', approve=None):
    return agent._CallRunner(schemas={name: {'type': 'object'}}, servers={name: (server, config or {})}, approve=approve, model='test', ollama_url='http://localhost', num_ctx=4096, ctx_ceiling=4096)


@pytest.mark.parametrize('name', ['get_secrets', 'list_and_publish', 'set_cloud_credentials', 'run_tests'])
async def test_unknown_server_names_cannot_bypass_approval(monkeypatch, name):
    post = AsyncMock()
    monkeypatch.setattr(agent, '_mcp_post', post)
    text, is_output = await runner('unreviewed', name=name).run(name, {})
    assert text.startswith('DENIED') and not is_output
    post.assert_not_awaited()


def test_policy_is_scoped_to_owner_config():
    assert runner('unreviewed').tier('get_secrets') == agent.TIER_DESTRUCTIVE
    assert runner('unreviewed', {'tool_tiers': {'get_secrets': 'read_only'}}).tier('get_secrets') == agent.TIER_READ_ONLY
    assert runner('unreviewed', {'tool_tiers': {'get_secrets': 'typo'}}).tier('get_secrets') == agent.TIER_DESTRUCTIVE
    assert runner('codebase', name='run_tests').tier('run_tests') == agent.TIER_DESTRUCTIVE
    assert runner('codebase', name='read_file').tier('read_file') == agent.TIER_READ_ONLY
    assert runner('kdenlive', name='get_track_list').tier('get_track_list') == agent.TIER_READ_ONLY


def test_codebase_failure_is_machine_readable():
    result = mcp_codebase._tool_error('Missing file')
    assert result['isError'] is True
    assert agent._result_to_text(result).startswith('ERROR:')


def test_cors_and_gate_share_origin_list(client):
    for origin in ['https://evil.example', 'null']:
        response = client.post('/api/mcp/call', headers={'Origin': origin}, json={'server': 'missing', 'tool': 'get_secrets'})
        assert response.status_code == 403
        assert 'access-control-allow-origin' not in response.headers
    response = client.options('/api/memory', headers={'Origin': 'tauri://localhost', 'Access-Control-Request-Method': 'GET'})
    assert response.status_code == 200
    assert response.headers['access-control-allow-origin'] == 'tauri://localhost'


@pytest.mark.parametrize('tool', [mcp_codebase._run_tests, mcp_codebase._run_lint])
async def test_subprocess_failure_is_not_reported_as_success(monkeypatch, tool):
    monkeypatch.setattr(mcp_codebase, '_run_subprocess', AsyncMock(return_value=(1, 'checks failed', '')))
    monkeypatch.setattr(mcp_codebase.os.path, 'isdir', lambda path: True)
    result = await tool({})
    assert result['isError'] is True
    assert 'checks failed' in result['content'][0]['text']
