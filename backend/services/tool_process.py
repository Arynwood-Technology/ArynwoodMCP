"""Bounded developer subprocesses with a minimal inherited environment.

This limits environment leakage, output, and lifetime. It is not an OS sandbox:
children retain the parent's filesystem/network privileges and can read HOME.
GPU sidecars and installers do not use this developer-only helper yet.
"""
from __future__ import annotations

import asyncio
import os
import signal

MAX_OUTPUT_BYTES = 64 * 1024
_ALLOWED_ENV = {'PATH', 'HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM',
                'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP',
                'TMPDIR', 'USERPROFILE'}


def child_environment(environ=None) -> dict[str, str]:
    source = os.environ if environ is None else environ
    return {name: value for name, value in source.items() if (name.upper() if os.name == 'nt' else name) in _ALLOWED_ENV}


class _OutputLimit(Exception):
    pass


async def run_developer_process(cmd: list[str], *, cwd=None, timeout: float = 10.0) -> tuple[int, str, str]:
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd, cwd=cwd, env=child_environment(), stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            start_new_session=os.name == 'posix',
        )
    except FileNotFoundError:
        return -1, '', 'command not found'
    total = 0

    async def drain(stream):
        nonlocal total
        data = bytearray()
        while chunk := await stream.read(4096):
            total += len(chunk)
            if total > MAX_OUTPUT_BYTES:
                raise _OutputLimit
            data.extend(chunk)
        return bytes(data)

    async def stop():
        if os.name == 'posix':
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        elif proc.returncode is None:
            proc.kill()
        # A killed producer can leave paused pipe readers with buffered output.
        # Stop the original readers, then discard rather than retain remaining
        # bytes before waiting for the process transport to finish closing.
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        async def discard(stream):
            while await stream.read(4096):
                pass
        try:
            await asyncio.wait_for(asyncio.gather(discard(proc.stdout), discard(proc.stderr), proc.wait()), timeout=2.0)
        except asyncio.TimeoutError:
            # A descendant that deliberately detaches can retain a pipe. Closing
            # our transports bounds cleanup; it does not contain that descendant.
            for stream in (proc.stdout, proc.stderr):
                transport = getattr(stream, '_transport', None)
                if transport is not None:
                    transport.close()
            await asyncio.wait_for(proc.wait(), timeout=2.0)

    tasks = [asyncio.create_task(drain(proc.stdout)), asyncio.create_task(drain(proc.stderr)),
             asyncio.create_task(proc.wait())]
    try:
        out, err, code = await asyncio.wait_for(asyncio.gather(*tasks), timeout=timeout)
        return code, out.decode(errors='replace'), err.decode(errors='replace')
    except asyncio.TimeoutError:
        await stop()
        return -1, '', f'command timed out after {timeout:g}s'
    except _OutputLimit:
        await stop()
        return -1, '', f'command exceeded the {MAX_OUTPUT_BYTES} byte output limit'
    except asyncio.CancelledError:
        await stop()
        raise
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
