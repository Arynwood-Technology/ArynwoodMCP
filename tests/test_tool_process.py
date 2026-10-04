import asyncio
import os
import sys
from unittest.mock import AsyncMock

import pytest

from backend.services import tool_process
from backend.routers import mcp_codebase


def test_only_runtime_environment_is_inherited():
    env = tool_process.child_environment({'PATH': '/usr/bin', 'HOME': '/home/test', 'LANG': 'C.UTF-8',
        'ARYNWOOD_API_KEY': 'secret', 'FACEBOOK_APP_SECRET': 'secret', 'SSH_AUTH_SOCK': '/agent',
        'PYTHONPATH': '/injected', 'LD_PRELOAD': '/injected', 'UNKNOWN_VENDOR_TOKEN': 'secret'})
    assert env == {'PATH': '/usr/bin', 'HOME': '/home/test', 'LANG': 'C.UTF-8'}


async def test_actual_codebase_child_has_no_owner_tokens(monkeypatch):
    monkeypatch.setenv('ARYNWOOD_API_KEY', 'test-secret')
    monkeypatch.setenv('UNKNOWN_VENDOR_TOKEN', 'test-secret')
    code, out, err = await mcp_codebase._run_subprocess([sys.executable, '-c',
        'import os; print("ARYNWOOD_API_KEY" in os.environ, "UNKNOWN_VENDOR_TOKEN" in os.environ)'])
    assert code == 0 and out.strip() == 'False False' and not err


async def test_output_limit_stops_process_without_retaining_output(monkeypatch):
    monkeypatch.setattr(tool_process, 'MAX_OUTPUT_BYTES', 1024)
    code, out, err = await tool_process.run_developer_process([sys.executable, '-c',
        'import sys; sys.stdout.write("x" * 1000000); sys.stdout.flush()'])
    assert code == -1 and out == '' and 'output limit' in err


async def test_timeout_returns_failure():
    code, out, err = await tool_process.run_developer_process([sys.executable, '-c',
        'import time; time.sleep(30)'], timeout=0.1)
    assert code == -1 and 'timed out' in err


async def test_cancellation_cleans_up_child(tmp_path):
    started = tmp_path / 'started'
    late = tmp_path / 'late'
    script = f'import pathlib,time; pathlib.Path({str(started)!r}).write_text("started"); time.sleep(1); pathlib.Path({str(late)!r}).write_text("late")'
    task = asyncio.create_task(tool_process.run_developer_process([sys.executable, '-c', script]))
    for _ in range(100):
        if started.exists():
            break
        await asyncio.sleep(0.01)
    assert started.exists()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    await asyncio.sleep(1.1)
    assert not late.exists()


@pytest.mark.skipif(os.name != 'posix', reason='POSIX process group containment')
async def test_timeout_also_stops_descendants(tmp_path):
    late = tmp_path / 'late'
    child = f'import time,pathlib; time.sleep(1); pathlib.Path({str(late)!r}).write_text("late")'
    parent = f'import subprocess,sys,time; subprocess.Popen([sys.executable,"-c",{child!r}]); time.sleep(30)'
    code, _, err = await tool_process.run_developer_process([sys.executable, '-c', parent], timeout=0.2)
    assert code == -1 and 'timed out' in err
    await asyncio.sleep(1.1)
    assert not late.exists()


async def test_git_diff_disables_executable_helpers(monkeypatch):
    run = AsyncMock(return_value=(0, '', ''))
    monkeypatch.setattr(mcp_codebase, '_run_subprocess', run)
    await mcp_codebase._git_diff({})
    command = run.call_args.args[0]
    assert '--no-ext-diff' in command and '--no-textconv' in command
    assert 'core.fsmonitor=false' in command


async def test_read_only_symbol_lookup_does_not_start_background_index(monkeypatch):
    spawn = AsyncMock()
    monkeypatch.setattr(asyncio, 'create_subprocess_exec', spawn)
    monkeypatch.setattr(mcp_codebase, '_run_orbit_sql', AsyncMock(return_value=(True, [], '')))
    monkeypatch.setattr(mcp_codebase, '_run_git', AsyncMock(return_value=(0, 'abc123', '')))
    fallback = AsyncMock(return_value={'content': [{'type': 'text', 'text': 'fallback'}]})
    monkeypatch.setattr(mcp_codebase, '_find_symbol_fallback', fallback)
    result = await mcp_codebase._find_symbol({'name': 'example'})
    await asyncio.sleep(0)
    spawn.assert_not_awaited()
    assert result['content'][0]['text'] == 'fallback'
    assert 'refresh the index explicitly' in fallback.call_args.args[1]
