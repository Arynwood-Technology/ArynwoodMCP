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


def test_connection_failure_closes_ssh(monkeypatch):
    ssh = MagicMock()
    ssh.connect.side_effect = deploy.paramiko.SSHException('Unknown server host key')
    monkeypatch.setattr(deploy.paramiko, 'SSHClient', lambda: ssh)
    with pytest.raises(deploy.paramiko.SSHException):
        deploy._open_sftp({'host': 'example.com'})
    ssh.close.assert_called_once_with()
    ssh.open_sftp.assert_not_called()
