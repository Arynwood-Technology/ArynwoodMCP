def test_list_conversations_empty(client):
    r = client.get("/api/chat/conversations")
    assert r.status_code == 200
    assert r.json() == []


def test_servers_seeded(client):
    r = client.get("/api/servers")
    assert r.status_code == 200
    names = {s["name"] for s in r.json()}
    assert "local" in names or len(r.json()) > 0
