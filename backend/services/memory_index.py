"""
Semantic index for Arynwood's persistent memory (the arynwood_memory table), so chat.py can
retrieve memories relevant to the current turn instead of dumping all of them into
every system prompt regardless of topic (Arynwood Runtime Roadmap, item 1.1).

Mirrors backend/services/knowledge.py's embed-then-Qdrant-REST pattern in a separate
collection: this is personal-assistant memory, not taught/learned documents, and a
memory row maps to exactly one point (unlike a knowledge source, which is chunked
into many) — so this reuses each memory's own integer id as its Qdrant point id
instead of knowledge.py's per-chunk uuid4() scheme.

Every function here degrades to "no semantic ranking" (empty list / False / 0) on any
Ollama/Qdrant failure rather than raising — same philosophy as knowledge.py's search():
a down embedding service should never break saving or reading a memory, only make
retrieval dumber until it's back.
"""

import os

import httpx

from backend.services import ollama_client

OLLAMA_URL_DEFAULT = "http://localhost:11434"
QDRANT_URL_DEFAULT = os.getenv("QDRANT_URL", "http://localhost:6333")
COLLECTION = "arynwood_memory_index"
EMBED_MODEL = "nomic-embed-text"


async def _ensure_collection(qdrant_url: str, dim: int) -> bool:
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(f"{qdrant_url}/collections/{COLLECTION}")
        if r.status_code == 200:
            return True
        r = await client.put(
            f"{qdrant_url}/collections/{COLLECTION}",
            json={"vectors": {"size": dim, "distance": "Cosine"}},
        )
        return r.status_code in (200, 201)


async def index_memory(
    memory_id: int, title: str, content: str,
    ollama_url: str = OLLAMA_URL_DEFAULT, qdrant_url: str = QDRANT_URL_DEFAULT,
) -> bool:
    """Embed one memory (title+content) and upsert it into the index, keyed by its
    own SQLite id. Call this after every create/update; call delete_memory_index()
    after every delete."""
    text = f"{title}\n{content}"
    try:
        embs = await ollama_client.aembed_texts([text], model=EMBED_MODEL, host=ollama_url, timeout=15.0)
    except Exception:
        return False
    if not embs or not embs[0]:
        return False
    vector = embs[0]

    if not await _ensure_collection(qdrant_url, len(vector)):
        return False
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.put(
                f"{qdrant_url}/collections/{COLLECTION}/points",
                json={"points": [{"id": memory_id, "vector": vector, "payload": {"memory_id": memory_id}}]},
            )
            return r.status_code in (200, 201)
    except Exception:
        return False


async def delete_memory_index(memory_id: int, qdrant_url: str = QDRANT_URL_DEFAULT) -> None:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(
                f"{qdrant_url}/collections/{COLLECTION}/points/delete",
                json={"points": [memory_id]},
            )
    except Exception:
        pass


async def search_relevant_memory_ids(
    query: str, top_k: int = 8, min_score: float = 0.45,
    ollama_url: str = OLLAMA_URL_DEFAULT, qdrant_url: str = QDRANT_URL_DEFAULT,
) -> list[int]:
    """Return memory ids ranked by relevance to query, most relevant first."""
    try:
        embs = await ollama_client.aembed_texts([query], model=EMBED_MODEL, host=ollama_url, timeout=10.0)
        if not embs or not embs[0]:
            return []
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(
                f"{qdrant_url}/collections/{COLLECTION}/points/search",
                json={"vector": embs[0], "limit": top_k, "score_threshold": min_score},
            )
            if r.status_code != 200:
                return []
            return [int(pt["id"]) for pt in r.json().get("result", [])]
    except Exception:
        return []


async def backfill_all(
    db, ollama_url: str = OLLAMA_URL_DEFAULT, qdrant_url: str = QDRANT_URL_DEFAULT,
) -> int:
    """Re-embed every memory into the index. Idempotent (upsert-by-id), so it's safe
    to run on every backend startup — memory tables are personal-assistant scale
    (tens to low hundreds of rows), not bulk document storage, so a full refresh is
    simpler and about as fast as tracking which rows changed since last time.
    Returns the number successfully indexed; 0 (not an exception) if Ollama isn't
    reachable at all.
    """
    if not await ollama_client.is_reachable(ollama_url):
        return 0
    async with db.execute("SELECT id, title, content FROM arynwood_memory") as cur:
        rows = await cur.fetchall()
    ok = 0
    for row in rows:
        if await index_memory(row["id"], row["title"], row["content"], ollama_url, qdrant_url):
            ok += 1
    return ok
