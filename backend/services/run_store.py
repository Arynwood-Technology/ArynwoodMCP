"""Persist execution evidence and side-effect attempts, independent of the socket."""
import json
import aiosqlite
from backend.services import runtime_context


async def start_step(tool, arguments):
    run = runtime_context.run_id.get()
    if not run:
        return None
    from backend.db import DB_PATH
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute('INSERT INTO run_steps(run_id,tool,arguments,status) VALUES (?,?,?,?)',
                               (run, tool, json.dumps(arguments), 'running'))
        await db.commit()
        return cur.lastrowid


async def finish_step(step_id, status, result):
    if step_id is None:
        return
    from backend.db import DB_PATH
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute('UPDATE run_steps SET status=?,result=? WHERE id=?', (status, result, step_id))
        await db.commit()
