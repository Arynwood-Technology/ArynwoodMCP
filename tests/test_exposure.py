from unittest.mock import AsyncMock

import pytest

from backend.services.auth import ApiKeyMiddleware
from backend.services.exposure import allowed_hosts, request_host_allowed, validate_bind_host


@pytest.mark.parametrize('host', ['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1'])
def test_local_bind_does_not_require_key(monkeypatch, host):
    monkeypatch.delenv('ARYNWOOD_API_KEY', raising=False)
    validate_bind_host(host)


@pytest.mark.parametrize('host', ['0.0.0.0', '::', '192.168.1.4', 'public.example'])
def test_remote_bind_requires_key(monkeypatch, host):
    monkeypatch.delenv('ARYNWOOD_API_KEY', raising=False)
    with pytest.raises(RuntimeError, match='requires ARYNWOOD_API_KEY'):
        validate_bind_host(host)
    monkeypatch.setenv('ARYNWOOD_API_KEY', 'owner-secret')
    validate_bind_host(host)


@pytest.mark.parametrize('header', ['evil.example:8010', 'localhost.evil.example', 'user@localhost', 'localhost/path', 'localhost:bad', 'localhost:99999'])
def test_host_rebinding_and_malformed_headers_rejected(header):
    assert not request_host_allowed(header, {'localhost', '127.0.0.1', '::1'})


@pytest.mark.parametrize('header', ['localhost:8010', '127.0.0.1:8020', '[::1]:8010'])
def test_loopback_host_headers_allowed(header):
    assert request_host_allowed(header, {'localhost', '127.0.0.1', '::1'})


def test_custom_hosts_need_auth_and_no_wildcards(monkeypatch):
    monkeypatch.setenv('ARYNWOOD_ALLOWED_HOSTS', 'agent.example')
    monkeypatch.delenv('ARYNWOOD_API_KEY', raising=False)
    with pytest.raises(RuntimeError):
        allowed_hosts()
    monkeypatch.setenv('ARYNWOOD_API_KEY', 'owner-secret')
    assert 'agent.example' in allowed_hosts()
    monkeypatch.setenv('ARYNWOOD_ALLOWED_HOSTS', '*.example')
    with pytest.raises(RuntimeError):
        allowed_hosts()


async def invoke(monkeypatch, *, peer='192.168.1.4', key=None, headers=(), path='/api/memory', kind='http'):
    monkeypatch.delenv('ARYNWOOD_ALLOWED_HOSTS', raising=False)
    monkeypatch.delenv('ARYNWOOD_API_KEY', raising=False)
    if key:
        monkeypatch.setenv('ARYNWOOD_API_KEY', key)
    inner, send = AsyncMock(), AsyncMock()
    scope = {'type': kind, 'path': path, 'client': (peer, 1234), 'headers': list(headers)}
    await ApiKeyMiddleware(inner)(scope, None, send)
    return inner, send


@pytest.mark.parametrize('path', ['/api/memory', '/metrics', '/social-media/private.png', '/docs', '/html-tools/terminal.html'])
async def test_remote_clients_cannot_bypass_keyless_gate(monkeypatch, path):
    inner, send = await invoke(monkeypatch, path=path)
    inner.assert_not_awaited()
    assert send.call_args_list[0].args[0]['status'] == 401


async def test_remote_websocket_requires_key(monkeypatch):
    inner, send = await invoke(monkeypatch, kind='websocket')
    inner.assert_not_awaited()
    assert send.call_args.args[0]['code'] == 4401


async def test_authenticated_remote_client_allowed(monkeypatch):
    inner, send = await invoke(monkeypatch, key='secret', headers=[(b'authorization', b'Bearer secret')])
    inner.assert_awaited_once()
    send.assert_not_awaited()


async def test_spoofed_forwarded_for_does_not_grant_access(monkeypatch):
    inner, send = await invoke(monkeypatch, headers=[(b'x-forwarded-for', b'127.0.0.1')])
    inner.assert_not_awaited()


async def test_cross_site_get_without_origin_cannot_start_install(monkeypatch):
    inner, send = await invoke(monkeypatch, peer='127.0.0.1', path='/api/tools/tool/install/stream', headers=[(b'sec-fetch-site', b'cross-site')])
    inner.assert_not_awaited()
    assert send.call_args_list[0].args[0]['status'] == 403


def test_host_validation_applies_to_actual_app(client):
    assert client.get('/api/system/status', headers={'Host': 'evil.example'}).status_code == 400
    assert client.get('/metrics', headers={'Host': 'localhost:8010'}).status_code == 200
