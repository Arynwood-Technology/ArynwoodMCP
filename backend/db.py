import aiosqlite
import os
import sys

from backend._frozen import user_data_dir


def _default_db_path() -> str:
    # Source checkout: DB lives in config/ under the repo root, unchanged from
    # before packaging existed. Packaged build: config/ isn't a meaningful
    # subdirectory of the XDG user data dir user_data_dir() already returns for
    # this case — put the DB straight in it.
    d = user_data_dir() if getattr(sys, "frozen", False) else os.path.join(user_data_dir(), "config")
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, "arynwood.db")
    # One-time carryover for any install from before this product's internal name
    # was "aryncore" — rename the file in place rather than leave existing users'
    # conversations/memories orphaned under the old filename.
    old_path = os.path.join(d, "aryncore.db")
    if not os.path.exists(path) and os.path.exists(old_path):
        os.rename(old_path, path)
    return path


DB_PATH = os.environ.get("ARYNWOOD_DB_PATH") or _default_db_path()

SCHEMA = """
CREATE TABLE IF NOT EXISTS servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'ollama',
    auth_token TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    persona TEXT NOT NULL DEFAULT 'central',
    model TEXT NOT NULL DEFAULT 'mistral',
    server_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS deploy_targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 22,
    username TEXT NOT NULL DEFAULT 'root',
    ssh_key_path TEXT,
    password TEXT,
    web_root TEXT NOT NULL DEFAULT '/var/www/html',
    public_url TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS arynwood_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL DEFAULT 'note',
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS knowledge_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    source TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'url',
    chunk_count INTEGER NOT NULL DEFAULT 0,
    added_by TEXT NOT NULL DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
);

"""

SEED = """
INSERT OR IGNORE INTO servers (id, name, host, port, type) VALUES
    (1, 'Local Ollama', 'localhost', 11434, 'ollama');

INSERT OR IGNORE INTO settings (key, value) VALUES
    ('default_model', 'mistral'),
    ('default_persona', 'central'),
    ('default_server_id', '1'),
    ('theme', 'dark');
"""


_MIGRATIONS = [
    """CREATE TABLE IF NOT EXISTS social_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL,
        account_id TEXT NOT NULL,
        account_name TEXT NOT NULL,
        account_type TEXT DEFAULT 'user',
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        token_expires_at TEXT,
        meta_json TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(platform, account_id)
    )""",
    """CREATE TABLE IF NOT EXISTS social_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL,
        account_id TEXT,
        content TEXT,
        media_url TEXT,
        post_id TEXT,
        status TEXT DEFAULT 'pending',
        error TEXT,
        created_at TEXT DEFAULT (datetime('now'))
    )""",
    """CREATE TABLE IF NOT EXISTS lora_projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        trigger_word TEXT NOT NULL,
        repeats INTEGER NOT NULL DEFAULT 10,
        resolution INTEGER NOT NULL DEFAULT 1024,
        source_dir TEXT NOT NULL,
        dataset_dir TEXT,
        output_dir TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        prep_status TEXT,
        prep_log TEXT,
        base_model_path TEXT,
        network_dim INTEGER NOT NULL DEFAULT 32,
        network_alpha INTEGER NOT NULL DEFAULT 16,
        learning_rate REAL NOT NULL DEFAULT 1e-4,
        max_train_epochs INTEGER NOT NULL DEFAULT 10,
        train_batch_size INTEGER NOT NULL DEFAULT 1,
        training_status TEXT,
        training_progress TEXT,
        output_lora_path TEXT,
        error TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    )""",
    "ALTER TABLE lora_projects ADD COLUMN a1111_lora_filename TEXT",
    """CREATE TABLE IF NOT EXISTS youtube_uploads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL,
        status TEXT NOT NULL,
        video_id TEXT,
        title TEXT,
        error TEXT,
        created_at TEXT DEFAULT (datetime('now'))
    )""",
    "ALTER TABLE youtube_uploads ADD COLUMN project_slug TEXT",
    """CREATE TABLE IF NOT EXISTS content_projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        base_dir TEXT NOT NULL,
        youtube_account_id INTEGER,
        created_at TEXT DEFAULT (datetime('now'))
    )""",
    # No seeded rows here — this table backs the YouTube auto-publish watcher
    # (triggers/youtube_watch.py), and previously shipped with the original
    # author's own personal project names and desktop paths as default data for
    # every install. Add your own via the Social/Publish UI or a direct INSERT;
    # nothing in this codebase depends on any particular slug existing.
    """CREATE TABLE IF NOT EXISTS music_assets (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        provider TEXT,
        source_asset_id TEXT,
        label TEXT NOT NULL DEFAULT '',
        instrument TEXT,
        prompt TEXT,
        params_json TEXT NOT NULL DEFAULT '{}',
        file_path TEXT,
        duration_seconds REAL,
        bpm REAL,
        musical_key TEXT,
        favorite INTEGER NOT NULL DEFAULT 0,
        project_id INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    )""",
    """CREATE TABLE IF NOT EXISTS music_generation_jobs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        provider TEXT NOT NULL,
        sidecar TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        progress INTEGER NOT NULL DEFAULT 0,
        params_json TEXT NOT NULL DEFAULT '{}',
        result_asset_id TEXT,
        error TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    )""",
    # 'confirmed' by default so every memory that predates this column (and every
    # memory created directly through the API, e.g. a human editing it by hand)
    # counts as already-reviewed. Only chat.py's _process_memories() — the path that
    # saves a model-authored <remember> block with no human in the loop — writes
    # 'provisional' explicitly.
    "ALTER TABLE arynwood_memory ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed'",
    # Running compressed summary of messages that have aged out of a conversation's
    # live context window (see chat.py's _summarize_aged_out_history, roadmap 1.4) —
    # history_summary_through_id is the highest message id already folded in, so a
    # later pass only needs to summarize what's new since then.
    "ALTER TABLE conversations ADD COLUMN history_summary TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE conversations ADD COLUMN history_summary_through_id INTEGER NOT NULL DEFAULT 0",
    # 'durable' (a project fact, decision, or idea meant to persist) vs 'transient'
    # (this-week task state, e.g. "currently debugging the LoRA training crash") —
    # separate from `status` (provenance/trust): a memory can be durable-and-
    # provisional or transient-and-confirmed, the two axes are independent. See
    # chat.py's _load_relevant_memories, which lets stale transient memories age
    # out of retrieval instead of lingering like a permanent fact would.
    "ALTER TABLE arynwood_memory ADD COLUMN volatility TEXT NOT NULL DEFAULT 'durable'",
    # Set when a new memory looked like it might contradict an existing pinned/
    # confirmed one (see chat.py's _detect_memory_conflict, roadmap 1.3) — surfaced
    # in the UI instead of letting the two silently coexist with retrieval ranking
    # deciding by accident which one the model sees.
    "ALTER TABLE arynwood_memory ADD COLUMN conflict_with_id INTEGER",
    # Source versioning (roadmap 1.9): re-learning the same `source` string used to
    # create an unrelated second row with the older content still searchable
    # alongside it. superseded_by points at the newer source once that happens —
    # the old row (and its history) stays for the record, but its Qdrant points get
    # removed so search only ever surfaces the current version.
    "ALTER TABLE knowledge_sources ADD COLUMN version INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE knowledge_sources ADD COLUMN superseded_by INTEGER",
    # Project linkage (roadmap 4.1): conversations, memories, and knowledge sources
    # previously had no way to connect to each other or to the app's other,
    # already-existing per-domain project concepts (lora_projects, content_projects,
    # music_assets.project_id) — a chat about a LoRA training run had no link to
    # the lora_projects row it was discussing. This is deliberately additive and
    # narrow: a new, minimal projects table plus nullable FK columns on the three
    # tables that had none, not a migration merging the existing per-domain project
    # tables into it — those already work, and merging them is a separate,
    # larger initiative of its own.
    """CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    )""",
    "ALTER TABLE conversations ADD COLUMN project_id INTEGER",
    "ALTER TABLE arynwood_memory ADD COLUMN project_id INTEGER",
    "ALTER TABLE knowledge_sources ADD COLUMN project_id INTEGER",
]

async def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    async with aiosqlite.connect(DB_PATH) as db:
        # One-time rename for any DB from before this product's internal table name
        # was "arynwood_memory" — must run before the CREATE TABLE IF NOT EXISTS below,
        # or that statement would silently create a fresh empty arynwood_memory
        # table alongside the old arynwood_memory one still holding all the real data.
        cur = await db.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = {row[0] for row in await cur.fetchall()}
        if "arynwood_memory" in tables and "arynwood_memory" not in tables:
            await db.execute("ALTER TABLE arynwood_memory RENAME TO arynwood_memory")
            await db.commit()
        await db.executescript(SCHEMA)
        await db.executescript(SEED)
        for migration in _MIGRATIONS:
            try:
                await db.execute(migration)
            except Exception:
                pass  # column already exists
        await db.commit()


async def get_db():
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    try:
        yield db
    finally:
        await db.close()
