def test_list_personas_excludes_non_persona_entries(client):
    r = client.get("/api/chat/personas")
    assert r.status_code == 200
    personas = r.json()
    ids = {p["id"] for p in personas}

    # The five real personas from mcp/config/models.json
    assert {"central", "doc", "kona", "glyph", "estra"} <= ids
    # "sad-talker" is a GPU-tool config block living in the same file, not a persona
    assert "sad-talker" not in ids

    for p in personas:
        assert p["name"]
        assert p["model"]


def test_central_persona_has_its_configured_model(client):
    r = client.get("/api/chat/personas")
    central = next(p for p in r.json() if p["id"] == "central")
    assert central["model"] == "qwen2.5-coder:14b"
