"""Configuration checks for the single-owner network boundary."""
import ipaddress
import os
from urllib.parse import urlsplit


def is_loopback(host: str) -> bool:
    if host.lower().rstrip('.') == 'localhost':
        return True
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return False
    return (getattr(address, 'ipv4_mapped', None) or address).is_loopback


def validate_bind_host(host: str) -> None:
    """Non-loopback listeners require an owner-configured bearer key."""
    if not is_loopback(host) and not os.environ.get('ARYNWOOD_API_KEY', '').strip():
        raise RuntimeError('Non-loopback binding requires ARYNWOOD_API_KEY. Keep ARYNWOOD_BIND_HOST=127.0.0.1 for local use.')


def allowed_hosts() -> set[str]:
    configured = os.environ.get('ARYNWOOD_ALLOWED_HOSTS', '')
    hosts = {'localhost', '127.0.0.1', '::1'}
    for entry in configured.split(','):
        entry = entry.strip().lower().rstrip('.')
        if not entry:
            continue
        # Exact names only. A wildcard would defeat DNS-rebinding protection.
        if any(char in entry for char in '*/\\@?#') or any(char.isspace() for char in entry):
            raise RuntimeError('ARYNWOOD_ALLOWED_HOSTS must contain exact hostnames or IP addresses, without schemes, paths, or wildcards')
        if ':' in entry:
            try:
                ipaddress.IPv6Address(entry)
            except ValueError as exc:
                raise RuntimeError('ARYNWOOD_ALLOWED_HOSTS entries must not include ports') from exc
        if not is_loopback(entry) and not os.environ.get('ARYNWOOD_API_KEY', '').strip():
            raise RuntimeError('Non-loopback allowed hosts require ARYNWOOD_API_KEY')
        hosts.add(entry)
    # Explicit numeric listener addresses are safe identities; wildcard listeners
    # still require a concrete Host entry for the address/domain clients use.
    bind = os.environ.get('ARYNWOOD_BIND_HOST', '')
    try:
        address = ipaddress.ip_address(bind)
    except ValueError:
        pass
    else:
        if not address.is_unspecified and os.environ.get('ARYNWOOD_API_KEY', '').strip():
            hosts.add(str(address))
    return hosts


def request_host_allowed(header: str, hosts: set[str]) -> bool:
    try:
        url = urlsplit('//' + header)
        # Accessing .port also rejects malformed ports and malformed IPv6.
        port = url.port
        host = (url.hostname or '').lower().rstrip('.')
        if url.username is not None or url.path or url.query or url.fragment:
            return False
        if not header or any(char.isspace() for char in header):
            return False
        return (port is None or 0 < port <= 65535) and host in hosts
    except ValueError:
        return False
