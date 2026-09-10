"""backend/routers/projects.py (roadmap 4.1)."""

import os

import aiosqlite

from backend.routers.chat import ensure_conversation


def test_create_list_update_delete_project(client):
    r = client.post("/api/projects", json={"name": "Terminal Pulse novel", "description": "The manuscript"})
    assert r.status_code == 200
    project = r.json()
    assert project["name"] == "Terminal Pulse novel"
    assert project["description"] == "The manuscript"

    r = client.get("/api/projects")
    assert any(p["id"] == project["id"] for p in r.json())

    r = client.put(f"/api/projects/{project['id']}", json={"name": "Terminal Pulse", "description": "updated"})
    assert r.status_code == 200
    assert r.json()["name"] == "Terminal Pulse"

    r = client.delete(f"/api/projects/{project['id']}")
    assert r.status_code == 200
    r = client.get("/api/projects")
    assert not any(p["id"] == project["id"] for p in r.json())


def test_update_missing_project_404s(client):
    r = client.put("/api/projects/999999", json={"name": "x"})
    assert r.status_code == 404


def test_project_summary_counts_linked_records(client):
    project = client.post("/api/projects", json={"name": "Summary Test Project"}).json()

    client.post("/api/memory", json={
        "type": "fact", "title": "Summary-Test-Memory", "content": "x", "project_id": project["id"],
    })

    r = client.get(f"/api/projects/{project['id']}/summary")
    assert r.status_code == 200
    body = r.json()
    assert body["project"]["id"] == project["id"]
    assert body["memories"] >= 1
    assert body["conversations"] == 0
    assert body["knowledge_sources"] == 0


def test_summary_404s_for_missing_project(client):
    r = client.get("/api/projects/999999/summary")
    assert r.status_code == 404


async def test_ensure_conversation_stores_project_id(client):
    project = client_sync_create_project()
    db = await aiosqlite.connect(os.environ["ARYNWOOD_DB_PATH"])
    db.row_factory = aiosqlite.Row
    try:
        conv_id = await ensure_conversation(db, "central", "qwen2.5-coder:14b", project_id=project)
        async with db.execute("SELECT project_id FROM conversations WHERE id=?", (conv_id,)) as cur:
            row = await cur.fetchone()
        assert row["project_id"] == project
    finally:
        await db.close()


def client_sync_create_project() -> int:
    """ensure_conversation needs a real project_id to point at, and this test
    doesn't otherwise need the `client` fixture's HTTP surface for it — a direct
    insert keeps this test focused on ensure_conversation, not the projects router
    (already covered above)."""
    import sqlite3
    conn = sqlite3.connect(os.environ["ARYNWOOD_DB_PATH"])
    cur = conn.execute("INSERT INTO projects (name) VALUES ('ensure_conversation test project')")
    conn.commit()
    project_id = cur.lastrowid
    conn.close()
    return project_id
