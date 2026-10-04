"""Bounded public-web fetching for untrusted knowledge URLs.

Connect to a validated IP, preserving the original Host and TLS identity. Never
use environment proxies or automatically follow redirects. Local service clients
(Ollama, Qdrant, configured MCP) deliberately do not use this public-web boundary.
"""
from __future__ import annotations

import asyncio
import ipaddress
import socket
from urllib.parse import urljoin

import httpx

MAX_RESPONSE_BYTES = 5 * 1024 * 1024
MAX_REDIRECTS = 5
TOTAL_TIMEOUT = 30.0
_REDIRECT_CODES = {301, 302, 303, 307, 308}


def _public_address(value: str) -> str:
    address = ipaddress.ip_address(value)
    # IPv4-mapped IPv6 must obey the same policy as its underlying address.
    underlying = getattr(address, 'ipv4_mapped', None) or address
    if not underlying.is_global or underlying.is_multicast or underlying.is_unspecified:
        raise ValueError('URL destination must be a public internet address')
    # Transition addresses can encode internal IPv4 destinations.
    if address.version == 6 and (address.sixtofour is not None or address.teredo is not None
                                 or address in ipaddress.ip_network('64:ff9b::/96')):
        raise ValueError('IPv6 transition addresses are not supported for URL learning')
    return str(address)


async def _resolve_public(host: str, port: int) -> str:
    try:
        return _public_address(host)
    except ValueError:
        # A literal private address must not be treated as a hostname on failure.
        try:
            ipaddress.ip_address(host)
        except ValueError:
            pass
        else:
            raise
    if '%' in host:
        raise ValueError('Scoped addresses are not supported for URL learning')
    records = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
    if not records:
        raise ValueError('URL destination has no addresses')
    # Reject mixed public/private DNS results rather than picking a convenient one.
    addresses = [_public_address(record[4][0]) for record in records]
    return addresses[0]


def _parse_url(value: str) -> httpx.URL:
    try:
        url = httpx.URL(value.strip())
    except (httpx.InvalidURL, ValueError) as exc:
        raise ValueError('Invalid URL') from exc
    if url.scheme not in ('http', 'https') or not url.host:
        raise ValueError('URL must start with http:// or https:// and include a hostname')
    if url.userinfo:
        raise ValueError('Credentials in knowledge URLs are not allowed')
    if url.port not in (None, 80, 443):
        raise ValueError('URL learning supports only standard web ports 80 and 443')
    return url.copy_with(fragment=None)


async def _fetch(url: str) -> httpx.Response:
    current = _parse_url(url)
    async with httpx.AsyncClient(timeout=10.0, follow_redirects=False, trust_env=False) as client:
        for hop in range(MAX_REDIRECTS + 1):
            port = current.port or (443 if current.scheme == 'https' else 80)
            address = await _resolve_public(current.host, port)
            # httpcore connects to this numeric address, avoiding a second DNS lookup.
            pinned = current.copy_with(host=address)
            async with client.stream(
                'GET', pinned,
                headers={'Host': current.netloc.decode('ascii'),
                         'User-Agent': 'Mozilla/5.0 (compatible; ArynBot/1.0; +local)',
                         'Accept-Encoding': 'identity'},
                extensions={'sni_hostname': current.host},
            ) as response:
                if response.status_code in _REDIRECT_CODES:
                    location = response.headers.get('location')
                    if not location:
                        raise ValueError('Redirect has no destination')
                    if hop == MAX_REDIRECTS:
                        raise ValueError('Too many redirects while learning URL')
                    destination = _parse_url(urljoin(str(current), location))
                    if current.scheme == 'https' and destination.scheme != 'https':
                        raise ValueError('HTTPS to HTTP redirects are not allowed')
                    current = destination
                    continue
                length = response.headers.get('content-length')
                if length is not None:
                    try:
                        size = int(length)
                    except ValueError as exc:
                        raise ValueError('Invalid response size') from exc
                    if size < 0 or size > MAX_RESPONSE_BYTES:
                        raise ValueError('URL response exceeds the 5 MiB limit')
                # Refuse compressed bodies: incremental decompression can allocate a
                # huge buffer before an application size check sees the output.
                if response.headers.get('content-encoding', 'identity').lower() != 'identity':
                    raise ValueError('Compressed URL responses are not supported; upload a saved page instead')
                body = bytearray()
                async for chunk in response.aiter_raw():
                    if len(body) + len(chunk) > MAX_RESPONSE_BYTES:
                        raise ValueError('URL response exceeds the 5 MiB limit')
                    body.extend(chunk)
                return httpx.Response(response.status_code, headers=response.headers,
                                      content=bytes(body), request=httpx.Request('GET', current))
    raise ValueError('Unable to fetch URL')


async def fetch_public_url(url: str) -> httpx.Response:
    """Fetch one bounded response; redirects share a total time budget."""
    try:
        return await asyncio.wait_for(_fetch(url), timeout=TOTAL_TIMEOUT)
    except asyncio.TimeoutError as exc:
        raise ValueError('URL fetch exceeded the 30 second time limit') from exc
