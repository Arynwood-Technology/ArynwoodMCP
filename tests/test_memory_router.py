def test_created_memory_defaults_to_confirmed(client):
    r = client.post("/api/memory", json={"type": "fact", "title": "T1", "content": "C1"})
    assert r.status_code == 200
    assert r.json()["status"] == "confirmed"


def test_confirm_endpoint_promotes_provisional_memory(client):
    r = client.post("/api/memory", json={"type": "fact", "title": "T2", "content": "C2", "status": "provisional"})
    mem_id = r.json()["id"]
    assert r.json()["status"] == "provisional"

    r = client.post(f"/api/memory/{mem_id}/confirm")
    assert r.status_code == 200
    assert r.json()["status"] == "confirmed"

    r = client.get("/api/memory")
    saved = next(m for m in r.json() if m["id"] == mem_id)
    assert saved["status"] == "confirmed"


def test_confirm_endpoint_404_for_missing_memory(client):
    r = client.post("/api/memory/999999/confirm")
    assert r.status_code == 404


def test_update_preserves_explicit_status(client):
    r = client.post("/api/memory", json={"type": "note", "title": "T3", "content": "C3"})
    mem = r.json()
    mem["content"] = "C3 updated"
    mem["status"] = "provisional"
    r = client.put(f"/api/memory/{mem['id']}", json=mem)
    assert r.json()["status"] == "provisional"
    assert r.json()["content"] == "C3 updated"
