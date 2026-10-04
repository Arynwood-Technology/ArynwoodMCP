import pytest
from fastapi import HTTPException

from backend.routers import fs, mcp_codebase


@pytest.mark.parametrize('path', ['.env', '.env.production', '.ssh/id_rsa', '.git/config', 'mcp/config/mcp_servers.json', 'config/arynwood.db', 'deploy.key', '.ENV', 'DEPLOY.KEY', 'MCP/CONFIG/MCP_SERVERS.JSON'])
def test_project_tools_cannot_read_known_credentials(monkeypatch, tmp_path, path):
    monkeypatch.setattr(fs, 'BASE_DIR', str(tmp_path))
    with pytest.raises(HTTPException) as exc:
        fs._safe_path(path)
    assert exc.value.status_code == 403


def test_source_and_env_template_remain_accessible(monkeypatch, tmp_path):
    monkeypatch.setattr(fs, 'BASE_DIR', str(tmp_path))
    assert fs._safe_path('.env.example') == str(tmp_path / '.env.example')
    assert fs._safe_path('backend/api.py') == str(tmp_path / 'backend/api.py')


async def test_fallback_search_skips_sensitive_and_escaping_symlinks(monkeypatch, tmp_path):
    root = tmp_path / 'repo'
    root.mkdir()
    outside = tmp_path / 'outside.txt'
    outside.write_text('needle PRIVATE')
    (root / 'escape.txt').symlink_to(outside)
    (root / '.env').write_text('needle TOKEN')
    (root / 'tokens.db').write_text('needle DB')
    (root / 'source.py').write_text('needle SOURCE')
    monkeypatch.setattr(fs, 'BASE_DIR', str(root))
    monkeypatch.setattr(mcp_codebase, 'BASE_DIR', str(root))
    monkeypatch.setattr(mcp_codebase.shutil, 'which', lambda name: None)
    result = await mcp_codebase._grep('needle', '.', None, 50, regex=False)
    text = result['content'][0]['text']
    assert 'SOURCE' in text
    assert 'PRIVATE' not in text and 'TOKEN' not in text and 'DB' not in text


async def test_ripgrep_glob_cannot_reinclude_credentials(monkeypatch, tmp_path):
    root = tmp_path / 'repo'
    root.mkdir()
    (root / 'tokens.db').write_text('needle PRIVATE_DB')
    (root / 'source.py').write_text('needle SOURCE')
    monkeypatch.setattr(fs, 'BASE_DIR', str(root))
    monkeypatch.setattr(mcp_codebase, 'BASE_DIR', str(root))
    if not mcp_codebase.shutil.which('rg'):
        pytest.skip('ripgrep is not installed')
    result = await mcp_codebase._grep('needle', '.', '*.db', 50, regex=False)
    assert not result.get('isError')
    text = result['content'][0]['text']
    assert 'PRIVATE_DB' not in text and '(no matches)' in text
    result = await mcp_codebase._grep('needle', '.', None, 50, regex=False)
    text = result['content'][0]['text']
    assert 'SOURCE' in text and 'PRIVATE_DB' not in text
