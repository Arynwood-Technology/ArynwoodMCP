"""
Arynwood's knowledge base — semantic memory built from learned files and URLs.

Pipeline: text -> chunks -> Ollama embeddings (nomic-embed-text) -> Qdrant.
Qdrant is talked to over its plain REST API (no qdrant-client dependency,
consistent with how the rest of this codebase calls external services via httpx).
Embeddings go through backend.services.ollama_client, which batches all chunks
of a source into a single /api/embed request instead of one call per chunk.
"""

import os
import json
import aiosqlite
import re
import uuid
from typing import Optional

import httpx

from backend.services import ollama_client, runtime_context, index_jobs

OLLAMA_URL_DEFAULT = "http://localhost:11434"
QDRANT_URL_DEFAULT = os.getenv("QDRANT_URL", "http://localhost:6333")

COLLECTION = "arynwood_knowledge"
EMBED_MODEL = "nomic-embed-text"

CHUNK_SIZE = 1200
CHUNK_OVERLAP = 200
MAX_TEXT_CHARS = 1_500_000
MAX_CHUNKS_PER_SOURCE = 1500


# ── File text extraction (shared with chat.py /upload and knowledge.py /upload) ──

TEXT_EXTENSIONS = {
    ".txt", ".md", ".markdown", ".rst", ".csv", ".tsv", ".log",
    ".py", ".js", ".ts", ".jsx", ".tsx", ".json", ".yaml", ".yml",
    ".toml", ".ini", ".cfg", ".sh", ".bash", ".env", ".html", ".htm",
    ".css", ".xml", ".sql", ".r", ".go", ".rs", ".java", ".c", ".cpp",
    ".h", ".cs", ".rb", ".php", ".swift", ".kt", ".dart",
}

# Chat's /upload injects a file into the current conversation's context window, so it
# stays small on purpose. Learn's /upload ingests a whole document into the knowledge
# base and needs real headroom — PDFs routinely run several MB.
MAX_FILE_BYTES = 1 * 1024 * 1024  # 1 MB hard cap — chat context injection only
MAX_INGEST_FILE_BYTES = 50 * 1024 * 1024  # 50 MB hard cap — knowledge base ingestion


def _extract_epub_text(data: bytes) -> str:
    """Extract chapter text from an EPUB, in spine reading order.

    An EPUB is a zip file: META-INF/container.xml points at an OPF package
    document, whose <manifest> maps ids to content-file hrefs and whose <spine>
    lists those ids in reading order. Walk that structure directly (stdlib
    zipfile + ElementTree) rather than depend on a parsing library for it.
    """
    import io
    import zipfile
    import xml.etree.ElementTree as ET
    from urllib.parse import unquote
    from bs4 import BeautifulSoup

    OPF_NS = "{http://www.idpf.org/2007/opf}"
    CONTAINER_NS = "{urn:oasis:names:tc:opendocument:xmlns:container}"

    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        container = ET.fromstring(zf.read("META-INF/container.xml"))
        rootfile = container.find(f".//{CONTAINER_NS}rootfile")
        opf_path = rootfile.get("full-path")
        opf_dir = os.path.dirname(opf_path)

        opf = ET.fromstring(zf.read(opf_path))
        manifest = {
            item.get("id"): unquote(item.get("href"))
            for item in opf.find(f"{OPF_NS}manifest")
        }
        spine = opf.find(f"{OPF_NS}spine")

        parts = []
        for itemref in spine:
            href = manifest.get(itemref.get("idref"))
            if not href:
                continue
            path = os.path.normpath(os.path.join(opf_dir, href)).replace(os.sep, "/")
            try:
                content = zf.read(path)
            except KeyError:
                continue
            soup = BeautifulSoup(content, "html.parser")
            for tag in soup(["script", "style", "nav"]):
                tag.decompose()
            text = soup.get_text("\n")
            text = re.sub(r"[ \t]+", " ", text)
            text = re.sub(r"\n[ \t]*\n+", "\n\n", text).strip()
            if text:
                parts.append(text)
        return "\n\n".join(parts)


def extract_text_from_bytes(filename: str, data: bytes) -> str:
    ext = os.path.splitext(filename.lower())[1]

    # Plain text / code
    if ext in TEXT_EXTENSIONS:
        return data.decode("utf-8", errors="replace")

    # PDF — try pdfminer, fall back to pypdf, fall back to raw decode
    if ext == ".pdf":
        try:
            from pdfminer.high_level import extract_text as pdf_extract
            import io
            return pdf_extract(io.BytesIO(data))
        except ImportError:
            pass
        try:
            import pypdf, io
            reader = pypdf.PdfReader(io.BytesIO(data))
            return "\n".join(p.extract_text() or "" for p in reader.pages)
        except ImportError:
            pass
        return data.decode("utf-8", errors="replace")

    # Word .docx
    if ext == ".docx":
        try:
            import docx, io
            doc = docx.Document(io.BytesIO(data))
            return "\n".join(p.text for p in doc.paragraphs)
        except ImportError:
            pass

    # EPUB — walk the spine in reading order, strip HTML per chapter.
    # Hand-rolled rather than via the `ebooklib` package: EPUB is just a zip of
    # XHTML files plus an OPF manifest/spine, and parsing that directly with
    # stdlib zipfile/ElementTree + the bs4 already used just below avoids a
    # dependency (ebooklib is AGPLv3+ — see docs/third-party-notices.md) that was
    # in real tension with this app's own license for a distributed build.
    if ext == ".epub":
        return _extract_epub_text(data)

    # Fallback: try UTF-8
    return data.decode("utf-8", errors="replace")


# ── URL scraping ─────────────────────────────────────────────────────────────────

_URL_RE = re.compile(r"^https?://", re.IGNORECASE)


async def fetch_url_text(url: str) -> tuple[str, str]:
    """Fetch a URL and return (title, plain_text). Raises on network/parse errors."""
    if not _URL_RE.match(url.strip()):
        raise ValueError("URL must start with http:// or https://")

    async with httpx.AsyncClient(
        timeout=30.0, follow_redirects=True,
        headers={"User-Agent": "Mozilla/5.0 (compatible; ArynBot/1.0; +local)"},
    ) as client:
        r = await client.get(url.strip())
        if r.status_code == 403 and r.headers.get("cf-mitigated") == "challenge":
            raise RuntimeError(
                "blocked by a Cloudflare bot-check (JS challenge) that no automated "
                "request can pass. Save the page from your browser instead, drop it in "
                "config/knowledge_uploads/, and run !learn <filename>."
            )
        r.raise_for_status()
        html = r.text

    try:
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html, "html.parser")
        title_tag = soup.find("title")
        title = title_tag.get_text(strip=True) if title_tag else url
        for tag in soup(["script", "style", "nav", "footer", "header", "aside", "noscript", "form", "svg"]):
            tag.decompose()
        text = soup.get_text("\n")
    except ImportError:
        title = (re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL) or [None, url])[1] or url
        title = re.sub(r"\s+", " ", title).strip()
        text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.IGNORECASE | re.DOTALL)
        text = re.sub(r"<[^>]+>", "\n", text)

    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n[ \t]*\n+", "\n\n", text)
    text = "\n".join(line.strip() for line in text.split("\n"))
    text = re.sub(r"\n{3,}", "\n\n", text).strip()

    return title, text


# ── Chunking ───────────────────────────────────────────────────────────────────────

def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Split text into overlapping chunks, preferring paragraph/sentence/word boundaries."""
    text = text.strip()
    if not text:
        return []

    chunks: list[str] = []
    start = 0
    n = len(text)
    while start < n:
        end = min(start + chunk_size, n)
        if end < n:
            cut = text.rfind("\n\n", start, end)
            if cut == -1 or cut <= start + chunk_size // 2:
                cut = text.rfind(". ", start, end)
            if cut == -1 or cut <= start + chunk_size // 2:
                cut = text.rfind(" ", start, end)
            if cut != -1 and cut > start:
                end = cut + 1
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= n:
            break
        start = max(end - overlap, start + 1)
    return chunks


# ── Ollama embeddings ────────────────────────────────────────────────────────────

async def get_embedding(text: str, ollama_url: str = OLLAMA_URL_DEFAULT,
                         model: str = EMBED_MODEL, timeout: float = 60.0) -> list[float] | None:
    try:
        embs = await ollama_client.aembed_texts([text], model=model, host=ollama_url, timeout=timeout)
        return embs[0] if embs and embs[0] else None
    except Exception:
        return None


EMBED_BATCH_SIZE = 100  # chunks per Ollama /api/embed request


async def get_embeddings(texts: list[str], ollama_url: str = OLLAMA_URL_DEFAULT,
                          model: str = EMBED_MODEL, timeout: float = 120.0) -> list[list[float]] | None:
    """Embed texts in batched Ollama requests (EMBED_BATCH_SIZE per call). Returns None on any failure."""
    if not texts:
        return []
    out: list[list[float]] = []
    try:
        for i in range(0, len(texts), EMBED_BATCH_SIZE):
            batch = texts[i:i + EMBED_BATCH_SIZE]
            embs = await ollama_client.aembed_texts(batch, model=model, host=ollama_url, timeout=timeout)
            if not embs or any(not e for e in embs):
                return None
            out.extend(embs)
    except Exception:
        return None
    return out


async def embedding_model_available(ollama_url: str = OLLAMA_URL_DEFAULT, model: str = EMBED_MODEL) -> bool:
    try:
        names = await ollama_client.list_models(host=ollama_url, timeout=5.0)
        return any(model in n for n in names)
    except Exception:
        return False


# ── Qdrant (plain REST) ──────────────────────────────────────────────────────────

async def qdrant_status(qdrant_url: str = QDRANT_URL_DEFAULT) -> dict:
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{qdrant_url}/collections")
            r.raise_for_status()
            names = [c["name"] for c in r.json().get("result", {}).get("collections", [])]
            return {"online": True, "collection_ready": COLLECTION in names}
    except Exception:
        return {"online": False, "collection_ready": False}


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


# ── Ingest ────────────────────────────────────────────────────────────────────────

async def _embed_and_store(
    db, title: str, source: str, source_type: str,
    chunk_texts: list[str], chunk_extra: Optional[list[dict]],
    ollama_url: str, qdrant_url: str, added_by: str,
) -> dict:
    """Shared tail of ingest_text()/ingest_chunks(): embed, ensure the Qdrant
    collection exists, record the source, and upsert points. chunk_extra, if given,
    is a same-length list of extra per-chunk payload fields (e.g. page_start/
    page_end/has_table from element-aware chunking) merged into each point."""
    embeddings = await get_embeddings(chunk_texts, ollama_url)
    if not embeddings or any(not e for e in embeddings):
        raise RuntimeError(
            f"Could not reach embedding model '{EMBED_MODEL}' at {ollama_url}. "
            f"Run: ollama pull {EMBED_MODEL}"
        )
    dim = len(embeddings[0])

    if not await _ensure_collection(qdrant_url, dim):
        raise RuntimeError(
            f"Could not reach Qdrant at {qdrant_url}. Start it with: docker run -p 6333:6333 qdrant/qdrant"
        )

    if len(embeddings) != len(chunk_texts):
        raise RuntimeError("Embedding count does not match source chunks; previous source preserved")
    scope = runtime_context.project_id.get()
    cur = await db.execute(
        "INSERT INTO knowledge_sources (title,source,source_type,chunk_count,added_by,project_id,index_state) VALUES (?,?,?,?,?,?,'staging')",
        (title, source, source_type, len(chunk_texts), added_by, scope))
    source_id = cur.lastrowid
    points = []
    for i, (chunk, emb) in enumerate(zip(chunk_texts, embeddings)):
        payload = {"source_id": source_id, "title": title, "source": source,
                   "source_type": source_type, "chunk_index": i, "text": chunk,
                   "project_id": scope, **(chunk_extra[i] if chunk_extra is not None else {})}
        point_id = str(uuid.uuid4())
        points.append({"id": point_id, "vector": emb, "payload": payload})
        await db.execute("INSERT INTO knowledge_chunks(id,source_id,text,payload) VALUES (?,?,?,?)",
                         (point_id, source_id, chunk, json.dumps(payload)))
    await db.commit()
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            r = await client.put(f"{qdrant_url}/collections/{COLLECTION}/points?wait=true", json={"points": points})
            r.raise_for_status()
        # Serialize activation: concurrent ingests are versioned in completion order.
        await db.execute("BEGIN IMMEDIATE")
        async with db.execute(
            "SELECT id,version FROM knowledge_sources WHERE source=? AND source_type=? AND project_id IS ? "
            "AND index_state='active' AND superseded_by IS NULL ORDER BY version DESC LIMIT 1",
            (source, source_type, scope)) as cur:
            prior = await cur.fetchone()
        next_version = prior['version'] + 1 if prior else 1
        await db.execute("UPDATE knowledge_sources SET index_state='active',version=? WHERE id=?", (next_version, source_id))
        if prior:
            await db.execute("UPDATE knowledge_sources SET superseded_by=? WHERE id=?", (source_id, prior['id']))
            await index_jobs.enqueue(db, 'knowledge_delete', prior['id'], {'qdrant_url': qdrant_url})
        await db.commit()
    except BaseException:
        await db.rollback()
        await db.execute("UPDATE knowledge_sources SET index_state='failed' WHERE id=?", (source_id,))
        await index_jobs.enqueue(db, 'knowledge_delete', source_id, {'qdrant_url': qdrant_url})
        await db.commit()
        raise
    result = {"id": source_id, "title": title, "chunks": len(chunk_texts), "version": next_version}
    if prior:
        result['superseded_source_id'] = prior['id']
    return result


async def ingest_text(
    db, title: str, source: str, source_type: str, text: str,
    ollama_url: str = OLLAMA_URL_DEFAULT, qdrant_url: str = QDRANT_URL_DEFAULT,
    added_by: str = "",
) -> dict:
    """Chunk, embed, and store text in Qdrant. Returns {id, title, chunks}."""
    text = text.strip()
    if not text:
        raise ValueError("Nothing to learn — no text content found.")
    if len(text) > MAX_TEXT_CHARS:
        text = text[:MAX_TEXT_CHARS]

    chunks = chunk_text(text)[:MAX_CHUNKS_PER_SOURCE]
    if not chunks:
        raise ValueError("Nothing to learn — no text content found.")

    return await _embed_and_store(db, title, source, source_type, chunks, None, ollama_url, qdrant_url, added_by)


async def ingest_chunks(
    db, title: str, source: str, source_type: str, chunks: list[dict],
    ollama_url: str = OLLAMA_URL_DEFAULT, qdrant_url: str = QDRANT_URL_DEFAULT,
    added_by: str = "",
) -> dict:
    """Embed and store already-chunked content (e.g. Sycamore's page/table-aware
    PDF chunks — see scripts/run_sycamore_partition.py) in Qdrant. Unlike
    ingest_text(), chunking already happened upstream; each chunk dict is
    {text, page_start?, page_end?, has_table?}. Returns {id, title, chunks}."""
    chunks = [c for c in chunks if (c.get("text") or "").strip()][:MAX_CHUNKS_PER_SOURCE]
    if not chunks:
        raise ValueError("Nothing to learn — no chunk content found.")

    texts = [c["text"] for c in chunks]
    extra = [
        {
            "page_start": c.get("page_start"),
            "page_end": c.get("page_end"),
            "has_table": bool(c.get("has_table", False)),
        }
        for c in chunks
    ]
    return await _embed_and_store(db, title, source, source_type, texts, extra, ollama_url, qdrant_url, added_by)


# ── Search ────────────────────────────────────────────────────────────────────────

# Hybrid reranking (roadmap 1.7): pure cosine similarity over dense embeddings can
# miss an exact match on a name, file path, or error string that scores
# unremarkably on similarity alone. Rather than standing up a separate sparse-vector
# index in Qdrant, this pulls a wider candidate pool at a lower similarity floor and
# reranks by blending in lexical term overlap — simpler, and it doesn't touch the
# ingest/embedding path at all.
LEXICAL_WEIGHT = 0.25
LEXICAL_POOL_FLOOR_RATIO = 0.7  # how far below min_score a candidate may sit and still be reranking-eligible


def _lexical_overlap(query_words: set[str], text: str) -> float:
    text_words = set(re.findall(r"[a-z0-9]+", text.lower()))
    if not text_words or not query_words:
        return 0.0
    return len(query_words & text_words) / len(query_words)


async def search(
    query: str, ollama_url: str = OLLAMA_URL_DEFAULT, qdrant_url: str = QDRANT_URL_DEFAULT,
    top_k: int = 5, min_score: float = 0.55, all_projects: bool = False,
) -> list[dict]:
    """Independent lexical/vector candidates fused by rank; SQLite controls visibility.

    Scoped to global sources plus the active project, unless all_projects (an explicit
    cross-project search, e.g. the Knowledge page's search box)."""
    from backend.db import DB_PATH
    scope = runtime_context.project_id.get()
    everywhere = 1 if all_projects else 0
    words = set(re.findall(r"\w+", query.lower()))
    # Always query the local corpus, including when the embedding server is offline.
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM knowledge_sources WHERE superseded_by IS NULL AND index_state='active' "
            "AND (? OR project_id IS NULL OR project_id=?)", (everywhere, scope)) as cur:
            active = {r['id']: dict(r) for r in await cur.fetchall()}
        lexical = []
        if words:
            match = ' OR '.join('"' + w.replace('"', '""') + '"' for w in sorted(words)[:40])
            async with db.execute(
                "SELECT c.id,c.payload FROM knowledge_chunks_fts f JOIN knowledge_chunks c ON c.rowid=f.rowid "
                "JOIN knowledge_sources s ON s.id=c.source_id WHERE knowledge_chunks_fts MATCH ? "
                "AND s.superseded_by IS NULL AND s.index_state='active' AND (? OR s.project_id IS NULL OR s.project_id=?) "
                "ORDER BY bm25(knowledge_chunks_fts) LIMIT ?", (match, everywhere, scope, max(20, top_k * 4))) as cur:
                lexical = [(r['id'], json.loads(r['payload'])) for r in await cur.fetchall()]
    vector = []
    available = True
    # Nothing learned (in scope) means nothing to find — skip the embedding round-trip,
    # and don't report the vector index as offline just because it was never created.
    emb = await get_embedding(query, ollama_url, timeout=10.0) if active else None
    if not active:
        pass
    elif emb is None:
        available = False
    else:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(f"{qdrant_url}/collections/{COLLECTION}/points/search", json={
                    "vector": emb, "limit": max(20, top_k * 4), "with_payload": True,
                    "score_threshold": min_score,
                })
                if response.status_code == 404:
                    response = None  # collection not created yet: no vectors, not an outage
                else:
                    response.raise_for_status()
                vector = [] if response is None else [
                    (str(r['id']), r.get('payload', {})) for r in response.json().get('result', [])
                    if r.get('payload', {}).get('source_id') in active]
        except Exception:
            available = False
    combined = {}
    for ranking in (lexical, vector):
        for rank, (key, payload) in enumerate(ranking):
            if payload.get('source_id') not in active:
                continue
            entry = combined.setdefault(key, {'score': 0.0, **payload})
            entry['score'] += 1 / (60 + rank + 1)
    out = []
    seen = set()
    for item in sorted(combined.values(), key=lambda r: r['score'], reverse=True):
        key = (item.get('source_id'), item.get('text'))
        if key in seen:
            continue
        seen.add(key)
        item.setdefault('page_start', None)
        item.setdefault('page_end', None)
        item.setdefault('has_table', False)
        out.append(item)
        if len(out) >= top_k:
            break
    runtime_context.record_evidence('knowledge', semantic_available=available,
                                    sources=[{'source_id': r['source_id'], 'source': r.get('source'),
                                              'title': r.get('title'), 'score': r['score']} for r in out])
    return out


def _page_citation(r: dict) -> str:
    start, end = r.get("page_start"), r.get("page_end")
    if not start:
        return ""
    return f", p.{start}" if start == end else f", p.{start}-{end}"


def format_context(results: list[dict]) -> str:
    """Format search results as a context block to inject into a system/user prompt."""
    if not results:
        return ""
    lines = ["[Knowledge base — relevant excerpts Arynwood has learned]"]
    for r in results:
        lines.append(f"\nFrom \"{r['title']}\" ({r['source']}{_page_citation(r)}):\n{r['text']}")
    return "\n".join(lines)


# ── Sources management ──────────────────────────────────────────────────────────

async def list_sources(db) -> list[dict]:
    async with db.execute("SELECT * FROM knowledge_sources ORDER BY created_at DESC") as cur:
        rows = await cur.fetchall()
    return [dict(r) for r in rows]


async def delete_source(db, source_id: int, qdrant_url: str = QDRANT_URL_DEFAULT) -> bool:
    cur = await db.execute("DELETE FROM knowledge_sources WHERE id=?", (source_id,))
    await db.execute("DELETE FROM knowledge_chunks WHERE source_id=?", (source_id,))
    await index_jobs.enqueue(db, 'knowledge_delete', source_id, {'qdrant_url': qdrant_url})
    await db.commit()
    return cur.rowcount > 0
