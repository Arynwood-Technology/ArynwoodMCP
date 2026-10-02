# Customizing Personas

Arynwood ships five personas (Arynwood, Doc, Kona, Glyph, Estra) in `mcp/config/models.json`.
You can add your own, or replace a bundled one, without touching that file or the app's source:
put them in a **personas file** in your per-user data directory.

## Where it lives

    ~/.local/share/arynwood-mcp/personas.local.json      (or $XDG_DATA_HOME/arynwood-mcp/)

The same location for a source checkout and the packaged app, and deliberately **outside the
repository**, so a private persona can't be committed or shipped by accident. To keep it
elsewhere, set `ARYNWOOD_PERSONAS_FILE=/path/to/file.json` in your `.env`. A symlink works,
which is handy if you keep the file in its own private repo.

## Format

A JSON object of persona id → persona, the same shape as `models.json`:

    {
      "editor": {
        "name": "Editor",
        "role": "Line editor",
        "personality": "Dry, exact, unsentimental.",
        "llm": { "model": "hermes3:8b", "host": "http://localhost:11434", "num_ctx": 8192 },
        "system": "You are a line editor. Cut filler, name what's weak, and stop.",
        "app_aware": false
      }
    }

- `name` and `llm.model` are required for it to appear in the persona picker.
- `app_aware: false` drops the app-capabilities preamble for a persona that has no use for it.
- `llm.num_ctx` raises the context ceiling for one persona (mind your VRAM).
- Optional `llm.num_predict` sets the maximum reply tokens, overriding a model's
  baked-in output limit. Positive integers only; the app clamps it to one quarter
  of the active context window and reserves that space when fitting history. For
  example, `"num_ctx": 16384, "num_predict": 2048` leaves room for longer scenes
  without increasing the context window. It is a token ceiling, not a word-count target.
- An entry with the same id as a bundled persona **replaces** it.

## Behaviour

- Changes take effect on the next request — no restart.
- A missing file is normal. A malformed one is ignored (one warning in the backend log) and
  never affects chat; the bundled personas keep working.

## Testing a private writing persona

With Ollama running, opt into synthetic writing tests for your own persona IDs:

```bash
ARYNWOOD_WRITER_PERSONAS=writer_a,writer_b venv/bin/python -m pytest tests/test_evals_live_private_writers.py -m eval -v -s
```

The tests exercise a complete scene, a narrowly scoped revision, an explicitly
requested list, and honesty about an unavailable manuscript. They use your local
persona settings but do not store test conversations or copy private instructions
into the repository. Live-model behavior can vary between runs.
