"""An empty in-scope corpus needs no model or vector service request."""
from unittest.mock import AsyncMock

import aiosqlite
import pytest

from backend.services import memory_store, runtime_context


@pytest.mark.parametrize('other_project', [False, True])
async def test_empty_scope_skips_embedding_and_records_evidence(monkeypatch, other_project):
    search = AsyncMock(side_effect=AssertionError('empty memory must not contact embeddings'))
    monkeypatch.setattr(memory_store.memory_index, 'search_relevant_memory_ids', search)
    scope_token = runtime_context.project_id.set(1)
    evidence_token = runtime_context.evidence.set([])
    try:
        async with aiosqlite.connect(':memory:') as db:
            db.row_factory = aiosqlite.Row
            await db.execute('CREATE TABLE arynwood_memory (id INTEGER, project_id INTEGER, pinned INTEGER, updated_at TEXT)')
            if other_project:
                await db.execute("INSERT INTO arynwood_memory VALUES (1,2,0,'2026-10-09')")
            assert await memory_store.retrieve(db, 'hello') == []
        search.assert_not_awaited()
        assert runtime_context.evidence.get()[-1]['ids'] == []
        assert runtime_context.evidence.get()[-1]['project_id'] == 1
    finally:
        runtime_context.project_id.reset(scope_token)
        runtime_context.evidence.reset(evidence_token)
