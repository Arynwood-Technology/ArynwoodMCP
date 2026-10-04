"""Adversarial URL-learning tests: no network or owner data required."""
import asyncio
import socket
from unittest.mock import AsyncMock

import httpx
import pytest

from backend.services import public_web, knowledge


class Body(httpx.AsyncByteStream):
    def __init__(self, *chunks):
        self.chunks = chunks

    async def __aiter__(self):
        for chunk in self.chunks:
            yield chunk


def mock_client(monkeypatch, handler):
    original = httpx.AsyncClient
    def make(**kwargs):
        assert kwargs['trust_env'] is False
        assert kwargs['follow_redirects'] is False
        return original(transport=httpx.MockTransport(handler), **kwargs)
    monkeypatch.setattr(public_web.httpx, 'AsyncClient', make)


@pytest.mark.parametrize('url', [
    'file:///etc/passwd', 'ftp://example.com/a', 'http://user:secret@example.com',
    'http://example.com:8010', 'http:///missing', 'https://[::1]:bad',
])
async def test_invalid_urls_rejected_before_network(monkeypatch, url):
    resolver = AsyncMock()
    monkeypatch.setattr(public_web, '_resolve_public', resolver)
    with pytest.raises(ValueError):
        await public_web.fetch_public_url(url)
    resolver.assert_not_awaited()


@pytest.mark.parametrize('host', [
    '127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.1.1', '0.0.0.0',
    '100.64.0.1', '224.0.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1',
    '2002:7f00:1::', '64:ff9b::7f00:1',
])
async def test_nonpublic_addresses_rejected(host):
    with pytest.raises(ValueError):
        await public_web._resolve_public(host, 80)


async def test_mixed_dns_answers_rejected(monkeypatch):
    resolver = AsyncMock(return_value=[
        (socket.AF_INET, socket.SOCK_STREAM, 6, '', ('93.184.215.14', 443)),
        (socket.AF_INET, socket.SOCK_STREAM, 6, '', ('127.0.0.1', 443)),
    ])
    monkeypatch.setattr(asyncio.get_running_loop(), 'getaddrinfo', resolver)
    with pytest.raises(ValueError):
        await public_web._resolve_public('example.com', 443)


async def test_tls_identity_preserved_while_connection_is_pinned(monkeypatch):
    resolver = AsyncMock(return_value='93.184.215.14')
    monkeypatch.setattr(public_web, '_resolve_public', resolver)
    def handle(request):
        assert request.url.host == '93.184.215.14'
        assert request.headers['host'] == 'example.com'
        assert request.extensions['sni_hostname'] == 'example.com'
        return httpx.Response(200, stream=Body(b'<title>Example</title><p>Hello</p>'))
    mock_client(monkeypatch, handle)
    title, text = await knowledge.fetch_url_text('https://example.com/page')
    assert title == 'Example' and 'Hello' in text
    resolver.assert_awaited_once_with('example.com', 443)


async def test_redirect_to_private_destination_never_connects(monkeypatch):
    async def resolve(host, port):
        if host == 'example.com':
            return '93.184.215.14'
        return await original(host, port)
    original = public_web._resolve_public
    monkeypatch.setattr(public_web, '_resolve_public', resolve)
    calls = []
    def handle(request):
        calls.append(request)
        return httpx.Response(302, headers={'Location': 'http://169.254.169.254/latest/meta-data/'})
    mock_client(monkeypatch, handle)
    with pytest.raises(ValueError, match='public internet'):
        await public_web.fetch_public_url('http://example.com')
    assert len(calls) == 1


async def test_relative_redirect_is_validated_and_resolved_again(monkeypatch):
    resolver = AsyncMock(side_effect=['93.184.215.14', ValueError('DNS changed to private')])
    monkeypatch.setattr(public_web, '_resolve_public', resolver)
    mock_client(monkeypatch, lambda request: httpx.Response(302, headers={'Location': '/other'}))
    with pytest.raises(ValueError, match='DNS changed'):
        await public_web.fetch_public_url('https://example.com')
    assert resolver.await_count == 2


@pytest.mark.parametrize('headers,chunks', [
    ({'content-length': '99999999'}, [b'a']),
    ({}, [b'12345678', b'1234']),
    ({'content-encoding': 'gzip'}, [b'compressed']),
])
async def test_oversized_or_compressed_responses_rejected(monkeypatch, headers, chunks):
    monkeypatch.setattr(public_web, 'MAX_RESPONSE_BYTES', 10)
    monkeypatch.setattr(public_web, '_resolve_public', AsyncMock(return_value='93.184.215.14'))
    mock_client(monkeypatch, lambda request: httpx.Response(200, headers=headers, stream=Body(*chunks)))
    with pytest.raises(ValueError):
        await public_web.fetch_public_url('https://example.com')


@pytest.mark.parametrize('location', ['http://example.com', 'file:///etc/passwd'])
async def test_downgrade_and_scheme_redirect_rejected(monkeypatch, location):
    monkeypatch.setattr(public_web, '_resolve_public', AsyncMock(return_value='93.184.215.14'))
    mock_client(monkeypatch, lambda request: httpx.Response(302, headers={'Location': location}))
    with pytest.raises(ValueError):
        await public_web.fetch_public_url('https://example.com')


async def test_redirect_loop_is_bounded(monkeypatch):
    resolver = AsyncMock(return_value='93.184.215.14')
    monkeypatch.setattr(public_web, '_resolve_public', resolver)
    mock_client(monkeypatch, lambda request: httpx.Response(302, headers={'Location': '/again'}))
    with pytest.raises(ValueError, match='Too many redirects'):
        await public_web.fetch_public_url('https://example.com')
    assert resolver.await_count == public_web.MAX_REDIRECTS + 1


async def test_total_time_budget(monkeypatch):
    async def timeout_fetch(url):
        raise asyncio.TimeoutError
    monkeypatch.setattr(public_web, '_fetch', timeout_fetch)
    with pytest.raises(ValueError, match='time limit'):
        await public_web.fetch_public_url('https://example.com')
