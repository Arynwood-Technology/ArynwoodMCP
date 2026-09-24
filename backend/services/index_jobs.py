"""Durable index work; SQLite is authoritative, vectors are a rebuildable cache."""
import asyncio
import json
import logging
import httpx
import aiosqlite
from backend.services import memory_index

logger = logging.getLogger(__name__)


async def enqueue(db, kind: str, entity_id: int, payload=None):
    await db.execute(
        'INSERT INTO index_jobs(kind,entity_id,payload) VALUES (?,?,?) '
        'ON CONFLICT(kind,entity_id) DO UPDATE SET payload=excluded.payload, attempts=0, error=NULL',
        (kind, entity_id, json.dumps(payload or {})))


async def process_pending(db, limit=20):
    async with db.execute('SELECT * FROM index_jobs ORDER BY attempts,id LIMIT ?', (limit,)) as cur:
        jobs = [dict(r) for r in await cur.fetchall()]
    for job in jobs:
        try:
            if job['kind'] == 'memory':
                async with db.execute('SELECT * FROM arynwood_memory WHERE id=?', (job['entity_id'],)) as cur:
                    row = await cur.fetchone()
                if row:
                    if not await memory_index.index_memory(row['id'], row['title'], row['content']):
                        raise RuntimeError('Embedding or memory index unavailable')
                else:
                    async with httpx.AsyncClient(timeout=15) as client:
                        r = await client.post(f'{memory_index.QDRANT_URL_DEFAULT}/collections/{memory_index.COLLECTION}/points/delete',
                                              json={'points': [job['entity_id']]})
                        if r.status_code != 404:
                            r.raise_for_status()
            elif job['kind'] == 'knowledge_delete':
                from backend.services.knowledge import QDRANT_URL_DEFAULT, COLLECTION
                payload = json.loads(job['payload'])
                async with httpx.AsyncClient(timeout=15) as client:
                    r = await client.post(f"{payload.get('qdrant_url', QDRANT_URL_DEFAULT)}/collections/{COLLECTION}/points/delete",
                                          json={'filter': {'must': [{'key':'source_id','match':{'value':job['entity_id']}}]}})
                    if r.status_code != 404:
                        r.raise_for_status()
            else:
                raise ValueError('Unknown index job kind')
            # A concurrent write may have refreshed this job. Don't remove newer work.
            await db.execute('DELETE FROM index_jobs WHERE id=? AND payload=?', (job['id'], job['payload']))
        except Exception as exc:
            await db.execute('UPDATE index_jobs SET attempts=attempts+1,error=? WHERE id=?', (str(exc)[:500], job['id']))
        await db.commit()


async def worker():
    from backend.db import DB_PATH
    while True:
        try:
            async with aiosqlite.connect(DB_PATH) as db:
                db.row_factory = aiosqlite.Row
                await process_pending(db)
        except Exception:
            logger.exception('Index retry worker failed')
        await asyncio.sleep(30)
