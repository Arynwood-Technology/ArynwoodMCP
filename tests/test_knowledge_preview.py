"""POST /preview is pure computation (chunk_text() only, no embedding/Qdrant call),
so it's tested through the real TestClient like any other router endpoint."""


def test_preview_returns_expected_chunk_count(client):
    text = "word " * 2000  # long enough to require multiple ~1200-char chunks
    r = client.post("/api/knowledge/preview", json={"text": text})
    assert r.status_code == 200
    body = r.json()
    assert body["chunk_count"] > 1
    assert len(body["chunks"]) == body["chunk_count"]
    assert body["chunks"][0]["index"] == 0
    assert "preview" in body["chunks"][0]


def test_preview_empty_text_returns_zero_chunks(client):
    r = client.post("/api/knowledge/preview", json={"text": ""})
    assert r.status_code == 200
    assert r.json() == {"chunk_count": 0, "chunks": []}


def test_preview_does_not_touch_qdrant_or_sources(client):
    before = client.get("/api/knowledge/sources").json()
    client.post("/api/knowledge/preview", json={"text": "some text to preview only"})
    after = client.get("/api/knowledge/sources").json()
    assert before == after
