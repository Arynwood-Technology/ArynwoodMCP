"""Shared execution policy: approvals authorize an exact operation once."""
import asyncio
from dataclasses import replace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI

from backend.services import tool_policy as policy, mcp_tool_agent as agent
from backend.routers import mcp_proxy, mcp_codebase


SCHEMA = {'type': 'object', 'properties': {'id': {'type': 'integer'}}, 'required': ['id']}
CONFIG = {'url': 'http://test/mcp'}


def intent(**changes):
    values = {'server': 'kdenlive', 'config': CONFIG, 'tool': 'delete_clip', 'arguments': {'id': 1}, 'schema': SCHEMA, 'caller': 'owner-turn-1'}
    values.update(changes)
    return policy.make_intent(**values)


async def test_grant_is_single_use_and_context_is_cleared():
    call = intent()
    grant = policy.authority.issue(call)
    post = AsyncMock(return_value={'content': []})
    await policy.dispatch(call, post, grant)
    assert policy.execution_intent.get() is None
    with pytest.raises(policy.PolicyDenied):
        await policy.dispatch(call, post, grant)
    assert post.await_count == 1


@pytest.mark.parametrize('changes', [
    {'caller': 'another-turn'}, {'server': 'another-server'}, {'tool': 'delete_track'},
    {'arguments': {'id': 2}}, {'config': {'url': 'http://another/mcp'}},
    {'schema': {**SCHEMA, 'description': 'changed catalog'}},
])
async def test_changed_operation_never_reuses_approval(changes):
    call = intent()
    grant = policy.authority.issue(call)
    post = AsyncMock()
    with pytest.raises(policy.PolicyDenied):
        await policy.dispatch(intent(**changes), post, grant)
    post.assert_not_awaited()


async def test_forged_tier_cannot_downgrade_policy():
    call = replace(intent(), tier='read_only')
    post = AsyncMock()
    with pytest.raises(policy.PolicyDenied):
        await policy.dispatch(call, post)
    post.assert_not_awaited()


async def test_expired_grant_never_dispatches(monkeypatch):
    call = intent()
    grant = policy.authority.issue(call)
    monkeypatch.setattr(policy.time, 'monotonic', lambda: call.created_at + policy.APPROVAL_TTL_SECONDS + 1)
    post = AsyncMock()
    with pytest.raises(policy.PolicyDenied):
        await policy.dispatch(call, post, grant)
    post.assert_not_awaited()


async def test_failed_execution_still_consumes_grant():
    call = intent()
    grant = policy.authority.issue(call)
    post = AsyncMock(side_effect=RuntimeError('tool failed'))
    with pytest.raises(RuntimeError):
        await policy.dispatch(call, post, grant)
    with pytest.raises(policy.PolicyDenied):
        await policy.dispatch(call, post, grant)
    assert policy.execution_intent.get() is None
    assert post.await_count == 1


async def test_parallel_replay_executes_once():
    call = intent()
    grant = policy.authority.issue(call)
    post = AsyncMock(return_value={})
    results = await asyncio.gather(policy.dispatch(call, post, grant), policy.dispatch(call, post, grant), return_exceptions=True)
    assert sum(isinstance(result, policy.PolicyDenied) for result in results) == 1
    assert post.await_count == 1


def test_intent_is_an_immutable_snapshot():
    arguments = {'id': 1}
    config = dict(CONFIG)
    call = intent(arguments=arguments, config=config)
    arguments['id'] = 9
    config['url'] = 'http://changed'
    assert call.arguments == {'id': 1} and call.config == CONFIG


@pytest.mark.parametrize('arguments', [[], None, {'id': float('nan')}, {'id': float('inf')}])
def test_invalid_json_and_argument_shapes_rejected(arguments):
    with pytest.raises(policy.InvalidToolCall):
        intent(arguments=arguments)


@pytest.mark.parametrize('tool', ['delete_clip', 'get_secret_and_publish'])
async def test_direct_proxy_cannot_claim_approval(client, monkeypatch, tool):
    monkeypatch.setattr(mcp_proxy, '_load_servers', lambda: {'unreviewed': CONFIG})
    post = AsyncMock(return_value={'tools': [{'name': tool, 'inputSchema': SCHEMA}]})
    monkeypatch.setattr(mcp_proxy, '_mcp_post', post)
    response = client.post('/api/mcp/call', json={'server': 'unreviewed', 'tool': tool, 'arguments': {'id': 1}, 'approved': True})
    assert response.status_code == 403
    assert all(call.args[1] == 'tools/list' for call in post.call_args_list)


async def test_direct_read_uses_the_same_tier_and_schema(client, monkeypatch):
    monkeypatch.setattr(mcp_proxy, '_load_servers', lambda: {'kdenlive': CONFIG})
    post = AsyncMock(side_effect=[{'tools': [{'name': 'get_clip', 'inputSchema': SCHEMA}]}, {'content': [{'type': 'text', 'text': 'clip'}]}])
    monkeypatch.setattr(mcp_proxy, '_mcp_post', post)
    response = client.post('/api/mcp/call', json={'server': 'kdenlive', 'tool': 'get_clip', 'arguments': {'id': 1}})
    assert response.status_code == 200
    assert post.call_args_list[-1].args[1] == 'tools/call'


async def test_direct_invalid_arguments_never_execute(client, monkeypatch):
    monkeypatch.setattr(mcp_proxy, '_load_servers', lambda: {'kdenlive': CONFIG})
    post = AsyncMock(return_value={'tools': [{'name': 'get_clip', 'inputSchema': SCHEMA}]})
    monkeypatch.setattr(mcp_proxy, '_mcp_post', post)
    response = client.post('/api/mcp/call', json={'server': 'kdenlive', 'tool': 'get_clip', 'arguments': {'id': 'wrong'}})
    assert response.status_code == 422
    assert post.await_count == 1


@pytest.mark.parametrize('tool,arguments', [('run_tests', {}), ('run_lint', {}), ('apply_patch', {'diff': 'malicious patch'})])
async def test_raw_http_codebase_cannot_execute_risky_tools(monkeypatch, tool, arguments):
    handler = AsyncMock()
    monkeypatch.setitem(mcp_codebase.TOOL_HANDLERS, tool, handler)
    app = FastAPI()
    app.include_router(mcp_codebase.router, prefix='/rpc')
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://localhost') as client:
        response = await client.post('/rpc', json={'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'approved': True, 'params': {'name': tool, 'arguments': arguments}})
    assert response.json()['result']['isError'] is True
    assert 'DENIED' in response.json()['result']['content'][0]['text']
    handler.assert_not_awaited()


async def test_approved_codebase_dispatch_reaches_handler(monkeypatch):
    handler = AsyncMock(return_value={'content': []})
    monkeypatch.setitem(mcp_codebase.TOOL_HANDLERS, 'run_tests', handler)
    schema = next(t['inputSchema'] for t in mcp_codebase.TOOLS if t['name'] == 'run_tests')
    call = intent(server='codebase', config={'in_process': 'codebase'}, tool='run_tests', arguments={}, schema=schema)
    grant = policy.authority.issue(call)
    await policy.dispatch(call, mcp_proxy._mcp_post, grant)
    handler.assert_awaited_once_with({})


@pytest.mark.parametrize('body', [[], None, {'jsonrpc': '2.0', 'params': []}, {'jsonrpc': '2.0', 'method': 'tools/call', 'params': {'name': 'run_tests', 'arguments': []}}])
async def test_malformed_rpc_never_runs_handler(monkeypatch, body):
    handler = AsyncMock()
    monkeypatch.setitem(mcp_codebase.TOOL_HANDLERS, 'run_tests', handler)
    result = await mcp_codebase.handle_rpc(body)
    assert 'error' in result or result['result']['isError']
    handler.assert_not_awaited()


async def test_model_callback_mutation_is_denied(monkeypatch):
    monkeypatch.setattr(agent, '_load_servers', lambda: {'kdenlive': CONFIG})
    post = AsyncMock()
    monkeypatch.setattr(agent, '_mcp_post', post)
    async def approve(name, arguments, tier):
        arguments['id'] = 999
        return True
    runner = agent._CallRunner(schemas={'delete_clip': SCHEMA}, servers={'delete_clip': ('kdenlive', CONFIG)}, approve=approve, model='test', ollama_url='http://localhost', num_ctx=4096, ctx_ceiling=4096)
    result, output = await runner.run('delete_clip', {'id': 1})
    assert result.startswith('DENIED') and not output
    post.assert_not_awaited()


async def test_owner_config_change_during_review_is_denied(monkeypatch):
    monkeypatch.setattr(agent, '_load_servers', lambda: {'kdenlive': {'url': 'http://changed'}})
    post = AsyncMock()
    monkeypatch.setattr(agent, '_mcp_post', post)
    runner = agent._CallRunner(schemas={'delete_clip': SCHEMA}, servers={'delete_clip': ('kdenlive', CONFIG)}, approve=AsyncMock(return_value=True), model='test', ollama_url='http://localhost', num_ctx=4096, ctx_ceiling=4096)
    result, output = await runner.run('delete_clip', {'id': 1})
    assert result.startswith('DENIED') and not output
    post.assert_not_awaited()


async def test_callback_truthy_nonboolean_does_not_grant_authority(monkeypatch):
    monkeypatch.setattr(agent, '_load_servers', lambda: {'kdenlive': CONFIG})
    post = AsyncMock()
    monkeypatch.setattr(agent, '_mcp_post', post)
    for value in ['true', 'false', 1, ('true', 'approved')]:
        runner = agent._CallRunner(schemas={'delete_clip': SCHEMA}, servers={'delete_clip': ('kdenlive', CONFIG)}, approve=AsyncMock(return_value=value), model='test', ollama_url='http://localhost', num_ctx=4096, ctx_ceiling=4096)
        text, output = await runner.run('delete_clip', {'id': 1})
        assert text.startswith('DENIED') and not output
    post.assert_not_awaited()


async def test_model_approval_wait_is_bounded(monkeypatch):
    monkeypatch.setattr(policy, 'APPROVAL_TTL_SECONDS', 0.01)
    post = AsyncMock()
    monkeypatch.setattr(agent, '_mcp_post', post)
    async def approve(*args):
        await asyncio.sleep(30)
        return True
    runner = agent._CallRunner(schemas={'delete_clip': SCHEMA}, servers={'delete_clip': ('kdenlive', CONFIG)}, approve=approve, model='test', ollama_url='http://localhost', num_ctx=4096, ctx_ceiling=4096)
    text, output = await runner.run('delete_clip', {'id': 1})
    assert 'timed out' in text and not output
    post.assert_not_awaited()


async def test_packaged_build_has_no_codebase_execution(monkeypatch):
    monkeypatch.setattr(mcp_codebase.sys, 'frozen', True, raising=False)
    monkeypatch.setenv('ARYNWOOD_ENABLE_CODEBASE_TOOLS', '1')
    assert not mcp_proxy._builtin_servers()
    assert not agent._server_enabled('codebase')
    result = await mcp_codebase.handle_rpc({'jsonrpc': '2.0', 'method': 'tools/list'})
    assert 'error' in result
