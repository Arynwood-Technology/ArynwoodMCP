"""A `~/.ssh/id_rsa` typed into a Publish target's key-path field used to be silently ignored
(os.path.exists on an unexpanded "~" is False), so the connection quietly fell back to a
password or the agent instead of using the key the user chose."""
from backend.routers import deploy


class _FakeSSH:
    def __init__(self):
        self.connect_kwargs = None

    def set_missing_host_key_policy(self, _policy):
        pass

    def connect(self, **kwargs):
        self.connect_kwargs = kwargs

    def open_sftp(self):
        return object()


def _connect(monkeypatch, target):
    fake = _FakeSSH()
    monkeypatch.setattr(deploy.paramiko, "SSHClient", lambda: fake)
    deploy._open_sftp(target)
    return fake.connect_kwargs


def test_tilde_key_path_is_expanded_and_used(monkeypatch, tmp_path):
    key = tmp_path / ".ssh" / "id_test"
    key.parent.mkdir()
    key.write_text("dummy")
    monkeypatch.setenv("HOME", str(tmp_path))
    kwargs = _connect(monkeypatch, {"host": "example.com", "ssh_key_path": "~/.ssh/id_test"})
    assert kwargs["key_filename"] == str(key)


def test_missing_key_falls_back_to_password(monkeypatch, tmp_path):
    monkeypatch.setenv("HOME", str(tmp_path))
    kwargs = _connect(monkeypatch, {"host": "example.com", "ssh_key_path": "~/nope", "password": "pw"})
    assert "key_filename" not in kwargs and kwargs["password"] == "pw"
