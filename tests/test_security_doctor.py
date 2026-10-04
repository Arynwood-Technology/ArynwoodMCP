import json

from backend.security import inspect_security


def test_doctor_reports_blockers_without_exposing_secrets(monkeypatch):
    secret = 'very-sensitive-owner-token'
    monkeypatch.setenv('ARYNWOOD_API_KEY', secret)
    monkeypatch.delenv('ARYNWOOD_ALLOWED_HOSTS', raising=False)
    monkeypatch.setenv('ARYNWOOD_ENABLE_CODEBASE_TOOLS', '1')
    report = inspect_security('0.0.0.0')
    text = json.dumps(report)
    assert secret not in text
    assert report['release_ready'] is False
    assert any(c['id'] == 'tools.codebase_enabled' and c['severity'] == 'warning' for c in report['checks'])
    assert any(c['id'] == 'tools.execution_isolation' and c['severity'] == 'warning' for c in report['checks'])


def test_doctor_reports_unauthenticated_remote_binding(monkeypatch):
    monkeypatch.delenv('ARYNWOOD_API_KEY', raising=False)
    monkeypatch.delenv('ARYNWOOD_ALLOWED_HOSTS', raising=False)
    report = inspect_security('0.0.0.0')
    assert any(c['id'] == 'network.remote_auth' and c['severity'] == 'error' for c in report['checks'])


def test_doctor_flags_unattended_publishing(monkeypatch):
    monkeypatch.setenv('ARYNWOOD_ENABLE_AUTO_PUBLISH', '1')
    monkeypatch.delenv('ARYNWOOD_ALLOWED_HOSTS', raising=False)
    checks = inspect_security('127.0.0.1')['checks']
    assert any(c['id'] == 'publishing.unattended_enabled' and c['severity'] == 'warning' for c in checks)
