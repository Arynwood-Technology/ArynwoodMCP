"""Revisioned memory writes and consistent scoped retrieval policy."""
import json
import re
from datetime import datetime, timedelta, timezone
from backend.services import memory_index, runtime_context


def stale(memory: dict) -> bool:
    if memory.get('volatility') != 'transient' or memory.get('pinned'):
        return False
    try:
        updated = datetime.fromisoformat(memory['updated_at']).replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) - updated > timedelta(days=7)
    except (ValueError, KeyError):
        return False


async def snapshot(db, memory: dict, state='archived', **changes) -> int:
    value = {**memory, **changes}
    cur = await db.execute(
        'INSERT INTO memory_revisions (memory_id, content, type, title, status, volatility, state, source_message_id, base_content) VALUES (?,?,?,?,?,?,?,?,?)',
        (memory['id'], value['content'], value['type'], value['title'], value.get('status', 'provisional'),
         value.get('volatility', 'durable'), state, runtime_context.source_message_id.get(), memory['content']))
    return cur.lastrowid


async def propose(db, memory: dict, content: str, mem_type: str, volatility: str) -> int:
    # Preserve prior proposals for review history, but present only the latest one.
    await db.execute("UPDATE memory_revisions SET state='superseded' WHERE memory_id=? AND state='pending'", (memory['id'],))
    return await snapshot(db, memory, 'pending', content=content, type=mem_type,
                          status='provisional', volatility=volatility)


async def retrieve(db, query: str, limit=8, include_pinned=True) -> list[dict]:
    scope = runtime_context.project_id.get()
    async with db.execute(
        'SELECT * FROM arynwood_memory WHERE project_id IS NULL OR project_id=? ORDER BY pinned DESC, updated_at DESC', (scope,)
    ) as cur:
        rows = [dict(r) for r in await cur.fetchall()]
    rows = [r for r in rows if not stale(r)]
    pinned = [r for r in rows if r['pinned']] if include_pinned else []
    pinned_ids = {r['id'] for r in pinned}
    ids = await memory_index.search_relevant_memory_ids(query, top_k=max(32, limit * 4))
    ranks = {mid: 1 / (60 + i) for i, mid in enumerate(ids)}
    words = set(re.findall(r'\w+', query.lower()))
    scored = []
    for r in rows:
        if r['id'] in pinned_ids:
            continue
        overlap = len(words & set(re.findall(r'\w+', (r['title'] + ' ' + r['content']).lower())))
        score = ranks.get(r['id'], 0) + (overlap / max(1, len(words))) / 60
        if score > 0:
            scored.append((score, r))
    scored.sort(key=lambda item: item[0], reverse=True)
    result = pinned + [r for _, r in scored[:limit]]
    # Keep conflicts visible rather than letting a relevance rank settle truth.
    selected_ids = {r['id'] for r in result}
    conflicts = {r.get('conflict_with_id') for r in result}
    result += [r for r in rows if r['id'] in conflicts and r['id'] not in selected_ids]
    runtime_context.record_evidence('memory', ids=[r['id'] for r in result], project_id=scope)
    return result


def format_memories(rows: list[dict]) -> str:
    return '\n\n'.join(
        f"Memory #{r['id']} {r['title']} [{r['status']}; {r['volatility']}; updated {r['updated_at']}; "
        f"project={r.get('project_id')}; conflict={r.get('conflict_with_id')}]:\n{r['content']}" for r in rows
    ) or 'No matching active memories. Semantic search may be unavailable; lexical matching was also checked.'
