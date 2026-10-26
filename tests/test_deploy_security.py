from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from backend.routers import deploy


@pytest.mark.parametrize('path', ['/var/www/html-other/key', '/var/www/html/../secret', '../secret'])
def test_remote_sibling_and_traversal_rejected(path):
    with pytest.raises(HTTPException) as exc:
        deploy._safe_path('/var/www/html', path)
    assert exc.value.status_code == 403


@pytest.mark.parametrize('path,expected', [
    ('assets/a.png', '/var/www/html/assets/a.png'),
    ('/var/www/html/a/../b', '/var/www/html/b'),
    ('', '/var/www/html'),
])
def test_valid_remote_paths(path, expected):
    assert deploy._safe_path('/var/www/html/', path) == expected


def test_root_and_posix_semantics():
    assert deploy._safe_path('/', '/index.html') == '/index.html'
    with pytest.raises(HTTPException):
        deploy._safe_path('/var/www', r'..\secret')
    with pytest.raises(HTTPException):
        deploy._safe_path('relative-root', 'a')


@pytest.mark.parametrize('name', ['../key', '/key', 'a/b', r'a\b', '.', '..', 'bad\x00name'])
def test_upload_filename_cannot_supply_a_path(name):
    with pytest.raises(HTTPException):
        deploy._safe_filename(name)


def test_ssh_uses_known_hosts_and_rejects_unknown_keys(monkeypatch):
    ssh = MagicMock()
    monkeypatch.setattr(deploy.paramiko, 'SSHClient', lambda: ssh)
    deploy._open_sftp({'host': 'example.com'})
    ssh.load_system_host_keys.assert_called_once_with()
    policy = ssh.set_missing_host_key_policy.call_args.args[0]
    assert isinstance(policy, deploy.paramiko.RejectPolicy)


def test_weak_trusted_rsa_host_key_is_rejected_before_authentication(monkeypatch):
    ssh = MagicMock()
    weak_key = paramiko.RSAKey.generate(1024)
    ssh._system_host_keys.lookup.return_value = {'ssh-rsa': weak_key}
    ssh._host_keys.lookup.return_value = None
    monkeypatch.setattr(deploy.paramiko, 'SSHClient', lambda: ssh)

    with pytest.raises(paramiko.SSHException, match='minimum strength'):
        deploy._open_sftp({'host': 'example.com'})

    ssh.connect.assert_not_called()
    ssh.close.assert_called_once_with()


def test_strong_trusted_rsa_host_key_meets_minimum(host_key):
    ssh = MagicMock()
    ssh._system_host_keys.lookup.return_value = {'ssh-rsa': host_key}
    ssh._host_keys.lookup.return_value = None

    deploy._validate_trusted_host_keys(ssh, 'example.com')


def test_connection_failure_closes_ssh(monkeypatch):
    ssh = MagicMock()
    ssh.connect.side_effect = deploy.paramiko.SSHException('Unknown server host key')
    monkeypatch.setattr(deploy.paramiko, 'SSHClient', lambda: ssh)
    with pytest.raises(deploy.paramiko.SSHException):
        deploy._open_sftp({'host': 'example.com'})
    ssh.close.assert_called_once_with()
    ssh.open_sftp.assert_not_called()


# ── SSH algorithms ─────────────────────────────────────────────────────────────

import os
import socket
import threading
import warnings

import paramiko


def _offered(kind: str, preferred: tuple) -> list:
    disabled = deploy._disabled_algorithms()[kind]
    return [a for a in preferred if a not in disabled]


def test_ssh_offers_only_modern_ciphers_and_macs(monkeypatch):
    ssh = MagicMock()
    monkeypatch.setattr(deploy.paramiko, 'SSHClient', lambda: ssh)
    deploy._open_sftp({'host': 'example.com'})
    assert ssh.connect.call_args.kwargs['disabled_algorithms'] == deploy._disabled_algorithms()
    ciphers = _offered('ciphers', paramiko.Transport._preferred_ciphers)
    macs = _offered('macs', paramiko.Transport._preferred_macs)
    assert ciphers and set(ciphers) <= set(deploy.SSH_CIPHERS)
    assert macs and set(macs) <= set(deploy.SSH_MACS)
    assert not any(weak in a for a in ciphers + macs for weak in ('cbc', '3des', 'sha1', 'md5'))


def test_every_allowed_algorithm_is_one_paramiko_still_offers():
    # A Paramiko upgrade that renames or drops one would shrink what servers can be reached with.
    assert set(deploy.SSH_CIPHERS) <= set(paramiko.Transport._preferred_ciphers)
    assert set(deploy.SSH_MACS) <= set(paramiko.Transport._preferred_macs)


def test_paramiko_key_exchange_and_host_keys_stay_modern():
    # Left at Paramiko's defaults on purpose; this fails if an upgrade brings back SHA-1 or DSA.
    assert not any('sha1' in a for a in paramiko.Transport._preferred_kex)
    for keys in (paramiko.Transport._preferred_keys, paramiko.Transport._preferred_pubkeys):
        assert 'ssh-rsa' not in keys and 'ssh-dss' not in keys
        assert not any('sha1' in a for a in keys)


class _Server(paramiko.ServerInterface):
    def get_allowed_auths(self, username): return 'password'
    def check_auth_password(self, username, password):
        return paramiko.AUTH_SUCCESSFUL if (username, password) == ('deploy', 'secret') else paramiko.AUTH_FAILED
    def check_channel_request(self, kind, chanid):
        return paramiko.OPEN_SUCCEEDED if kind == 'session' else paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED


def _ssh_server(host_key, ciphers=None, macs=None):
    """A one-connection SSH + SFTP server on loopback; ciphers/macs restrict what it accepts."""
    listener = socket.socket()
    listener.bind(('127.0.0.1', 0))
    listener.listen(1)

    def serve():
        conn, _ = listener.accept()
        transport = paramiko.Transport(conn)
        transport.add_server_key(host_key)
        options = transport.get_security_options()
        if ciphers: options.ciphers = ciphers
        if macs: options.digests = macs
        transport.set_subsystem_handler('sftp', paramiko.SFTPServer, paramiko.SFTPServerInterface)
        try:
            transport.start_server(server=_Server())
            channel = transport.accept(5)  # held: a dropped Channel closes itself
            transport.join(10)
            del channel
        except Exception:
            pass
        finally:
            transport.close()
            listener.close()

    threading.Thread(target=serve, daemon=True).start()
    return listener.getsockname()[1]


@pytest.fixture()
def ssh_home(tmp_path, monkeypatch):
    """HOME with a known_hosts the test fills in, and no SSH agent or keys of the person running it."""
    (tmp_path / '.ssh').mkdir()
    monkeypatch.setenv('HOME', str(tmp_path))
    monkeypatch.delenv('SSH_AUTH_SOCK', raising=False)
    return tmp_path


def _trust(home, port, key):
    hosts = paramiko.HostKeys()
    hosts.add(f'[127.0.0.1]:{port}', key.get_name(), key)
    hosts.save(str(home / '.ssh' / 'known_hosts'))


@pytest.fixture(scope='module')
def host_key():
    return paramiko.RSAKey.generate(2048)


def _target(port):
    return {'host': '127.0.0.1', 'port': port, 'username': 'deploy', 'password': 'secret'}


def test_a_modern_server_connects_with_a_modern_cipher(ssh_home, host_key):
    port = _ssh_server(host_key)
    _trust(ssh_home, port, host_key)
    ssh, sftp = deploy._open_sftp(_target(port))
    try:
        transport = ssh.get_transport()
        assert transport.local_cipher in deploy.SSH_CIPHERS and transport.remote_cipher in deploy.SSH_CIPHERS
        assert transport.local_mac in deploy.SSH_MACS + ('',)  # an AEAD cipher (GCM) needs no separate MAC
    finally:
        sftp.close(); ssh.close()


def test_a_server_offering_only_legacy_algorithms_is_refused(ssh_home, host_key):
    legacy = {'ciphers': ('aes128-cbc', 'aes256-cbc'), 'macs': ('hmac-sha1', 'hmac-md5')}
    # Control: Paramiko's own defaults would have connected to this server.
    port = _ssh_server(host_key, **legacy)
    _trust(ssh_home, port, host_key)
    control = paramiko.SSHClient()
    control.load_system_host_keys()
    control.set_missing_host_key_policy(paramiko.RejectPolicy())
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        control.connect('127.0.0.1', port=port, username='deploy', password='secret', allow_agent=False, look_for_keys=False, timeout=12)
    control.close()

    port = _ssh_server(host_key, **legacy)
    _trust(ssh_home, port, host_key)
    with pytest.raises(paramiko.SSHException, match='[Ii]ncompatible'):
        deploy._open_sftp(_target(port))


def test_an_unknown_host_key_is_refused_on_a_real_connection(ssh_home, host_key):
    port = _ssh_server(host_key)  # nothing in known_hosts
    with pytest.raises(paramiko.SSHException):
        deploy._open_sftp(_target(port))
