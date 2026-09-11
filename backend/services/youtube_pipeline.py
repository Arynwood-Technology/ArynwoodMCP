"""
Hands-off YouTube publish pipeline: drop a video into a project's `incoming/`
folder and it gets titled, tagged, thumbnailed, and published with no further
clicks.

Multiple projects share this one watcher — any number of independent series or
sub-channels, each getting a row in `content_projects` (slug, name, base_dir,
youtube_account_id). Each project has its own incoming/published/failed/
metadata tree under its own base_dir, and publishes to whichever connected
YouTube channel it's linked to — so different projects really can post to
different channels. A project with no linked channel yet fails loudly (moved
to failed/ with a clear message) rather than guessing which account to use.

The one guardrail: automation only ever acts on files placed in a project's
`incoming/` (never anywhere else on the Desktop) — that's the deliberate
human act that triggers a live publish to a public channel. Everything after
that point is fully automatic, including the default `privacyStatus: "public"`
below.

Uses the same connected-account machinery as the manual upload flow in
`backend/routers/social.py` (`_refresh_google_token`) and the same ffprobe
helper already used for duration/stream probing in `backend/routers/video.py`
(`_ffprobe_json`). Uploads go through YouTube's resumable protocol rather
than the simple multipart upload `social.py` uses for the manual Social-page
flow — that one is fine for a person watching a single upload; this one runs
unattended, so a dropped connection gets one resume-from-offset retry instead
of silently failing.
"""

import asyncio
import json
import os
import re
import shutil

import aiosqlite
import httpx

from backend.db import DB_PATH
from backend.routers.social import _refresh_google_token
from backend.routers.video import _ffprobe_json

VIDEO_EXTS = (".mp4", ".mov", ".avi", ".mkv", ".webm")

OLLAMA_BASE = os.environ.get("YOUTUBE_PIPELINE_OLLAMA", "http://localhost:11434")
OLLAMA_MODEL = "mistral"


def _dirs(project: dict) -> dict:
    base = project["base_dir"]
    return {
        "incoming": os.path.join(base, "incoming"),
        "published": os.path.join(base, "published"),
        "failed": os.path.join(base, "failed"),
        "metadata": os.path.join(base, "metadata"),
    }


async def _load_projects(db) -> list[dict]:
    """Re-read from DB on every tick so a newly-registered project (or a newly-linked
    channel) is picked up without restarting the watcher."""
    rows = await db.execute_fetchall("SELECT * FROM content_projects")
    return [dict(r) for r in rows]


async def _wait_until_stable(path: str, checks: int = 3, interval: float = 2.0, max_polls: int = 60) -> bool:
    """Guards against processing a still-copying drag-and-drop: waits for size to stop changing."""
    last_size = -1
    stable_count = 0
    for _ in range(max_polls):
        try:
            size = os.path.getsize(path)
        except OSError:
            return False  # vanished mid-copy or was never a real file
        if size == last_size and size > 0:
            stable_count += 1
            if stable_count >= checks:
                return True
        else:
            stable_count = 0
        last_size = size
        await asyncio.sleep(interval)
    return False


async def _extract_thumbnail(video_path: str, out_path: str) -> bool:
    info = await _ffprobe_json(video_path)
    duration = float(info.get("format", {}).get("duration", 0) or 0)
    ts = max(1.0, duration * 0.1)
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-y", "-ss", str(ts), "-i", video_path, "-vframes", "1", "-q:v", "3", out_path,
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
    )
    await proc.communicate()
    return os.path.isfile(out_path)


async def _generate_metadata(filename: str, notes: str, project_name: str) -> dict:
    """Title/description/tags via local Ollama. Falls back to the filename if the model
    doesn't return parseable JSON — a bad LLM response can't be allowed to halt a
    'fully automatic' pipeline."""
    basename = os.path.splitext(filename)[0]
    clean_name = re.sub(r"[_\-]+", " ", basename).strip()

    prompt = (
        f"Video filename: {clean_name}\n"
        + (f"Creator notes: {notes}\n" if notes else "")
        + f"This is for the '{project_name}' YouTube channel. Write a YouTube title "
          "(under 100 characters), a 2-3 sentence description, and 8-12 tags.\n"
          'Respond with ONLY JSON in this exact shape: {"title": "...", "description": "...", "tags": ["...", "..."]}'
    )

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(f"{OLLAMA_BASE}/api/chat", json={
                "model": OLLAMA_MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
                "options": {"temperature": 0.6},
            })
            r.raise_for_status()
            content = r.json().get("message", {}).get("content", "")
        match = re.search(r"\{.*\}", content, re.DOTALL)
        data = json.loads(match.group(0)) if match else {}
    except Exception:
        data = {}

    title = str(data.get("title") or clean_name)[:100]
    description = str(data.get("description") or f"{clean_name} — {project_name}")
    tags = data.get("tags") or []
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",") if t.strip()]
    return {"title": title, "description": description, "tags": [str(t) for t in tags][:15]}


async def _resumable_upload(token: str, title: str, description: str, tags: list, video_path: str, size: int) -> str:
    metadata = {
        "snippet": {"title": title, "description": description, "tags": tags, "categoryId": "22"},
        "status": {"privacyStatus": "public"},
    }

    async with httpx.AsyncClient(timeout=30) as client:
        init_r = await client.post(
            "https://www.googleapis.com/upload/youtube/v3/videos",
            params={"uploadType": "resumable", "part": "snippet,status"},
            headers={
                "Authorization": f"Bearer {token}",
                "X-Upload-Content-Type": "video/mp4",
                "X-Upload-Content-Length": str(size),
            },
            json=metadata,
        )
        init_r.raise_for_status()
        upload_url = init_r.headers["Location"]

    with open(video_path, "rb") as f:
        video_bytes = f.read()

    async with httpx.AsyncClient(timeout=600) as client:
        put_r = await client.put(upload_url, content=video_bytes, headers={"Content-Type": "video/mp4"})
        if put_r.status_code in (200, 201):
            return put_r.json()["id"]

        # One resume attempt: ask YouTube how many bytes it actually received, send the rest.
        status_r = await client.put(upload_url, headers={"Content-Range": f"bytes */{size}"})
        if status_r.status_code in (200, 201):
            return status_r.json()["id"]
        if status_r.status_code == 308:
            range_header = status_r.headers.get("Range", "")
            received = int(range_header.split("-")[1]) + 1 if range_header else 0
            resume_r = await client.put(upload_url, content=video_bytes[received:], headers={
                "Content-Type": "video/mp4",
                "Content-Range": f"bytes {received}-{size - 1}/{size}",
            })
            resume_r.raise_for_status()
            return resume_r.json()["id"]

        put_r.raise_for_status()
    raise RuntimeError("YouTube upload failed with no resumable status available")


async def _set_thumbnail(token: str, video_id: str, thumb_path: str) -> None:
    with open(thumb_path, "rb") as f:
        thumb_bytes = f.read()
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            "https://www.googleapis.com/upload/youtube/v3/thumbnails/set",
            params={"videoId": video_id},
            headers={"Authorization": f"Bearer {token}", "Content-Type": "image/jpeg"},
            content=thumb_bytes,
        )
        r.raise_for_status()


async def process_video(path: str, db, project: dict) -> None:
    filename = os.path.basename(path)
    basename = os.path.splitext(filename)[0]
    dirs = _dirs(project)

    if not await _wait_until_stable(path):
        return  # vanished or never stopped growing — leave it for the next scan

    try:
        if not project.get("youtube_account_id"):
            raise RuntimeError(
                f"No YouTube channel linked to project '{project['name']}' yet — "
                "link one from the Social page's Projects panel."
            )
        rows = await db.execute_fetchall(
            "SELECT * FROM social_accounts WHERE id = ? AND platform = 'youtube'",
            (project["youtube_account_id"],),
        )
        if not rows:
            raise RuntimeError(
                f"Project '{project['name']}' is linked to a YouTube account that's no longer connected."
            )
        acct = dict(rows[0])

        token = acct["access_token"]
        if acct.get("refresh_token"):
            token = await _refresh_google_token(acct["refresh_token"])
            await db.execute(
                "UPDATE social_accounts SET access_token = ?, updated_at = datetime('now') WHERE id = ?",
                (token, acct["id"]),
            )
            await db.commit()

        notes_path = os.path.join(os.path.dirname(path), f"{basename}.txt")
        notes = ""
        if os.path.isfile(notes_path):
            with open(notes_path, "r", encoding="utf-8", errors="ignore") as f:
                notes = f.read().strip()

        meta = await _generate_metadata(filename, notes, project["name"])

        os.makedirs(dirs["metadata"], exist_ok=True)
        thumb_path = os.path.join(dirs["metadata"], f"{basename}.jpg")
        has_thumb = await _extract_thumbnail(path, thumb_path)

        size = os.path.getsize(path)
        video_id = await _resumable_upload(token, meta["title"], meta["description"], meta["tags"], path, size)

        if has_thumb:
            try:
                await _set_thumbnail(token, video_id, thumb_path)
            except Exception:
                pass  # a bad thumbnail shouldn't fail an otherwise-successful publish

        os.makedirs(dirs["published"], exist_ok=True)
        shutil.move(path, os.path.join(dirs["published"], filename))
        with open(os.path.join(dirs["metadata"], f"{basename}.json"), "w") as f:
            json.dump({"video_id": video_id, **meta}, f, indent=2)

        await db.execute(
            "INSERT INTO youtube_uploads (filename, status, video_id, title, project_slug) VALUES (?,?,?,?,?)",
            (filename, "published", video_id, meta["title"], project["slug"]),
        )
        await db.execute(
            "INSERT INTO social_posts (platform, account_id, content, media_url, post_id, status) VALUES (?,?,?,?,?,?)",
            ("youtube", acct["account_id"], meta["title"], "", video_id, "published"),
        )
        await db.commit()
        print(f"[youtube_pipeline] [{project['slug']}] published {filename} -> {video_id}")

    except Exception as e:
        os.makedirs(dirs["failed"], exist_ok=True)
        try:
            shutil.move(path, os.path.join(dirs["failed"], filename))
        except Exception:
            pass
        with open(os.path.join(dirs["failed"], f"{basename}.error.txt"), "w") as f:
            f.write(str(e))
        await db.execute(
            "INSERT INTO youtube_uploads (filename, status, error, project_slug) VALUES (?,?,?,?)",
            (filename, "failed", str(e), project["slug"]),
        )
        await db.commit()
        print(f"[youtube_pipeline] [{project['slug']}] FAILED {filename}: {e}")


async def run_watch_loop(poll_interval: float = 5.0) -> None:
    """Polls every project's `incoming/` rather than using the repo's watchdog
    convention (`triggers/forge_filewatch.py`) — the stable-size check needs polling
    anyway, and this avoids handing off from watchdog's threaded callback into
    asyncio. Projects are re-read from the DB each tick, so adding a new project or
    linking a channel takes effect without restarting the watcher."""
    known: dict = {}  # slug -> set of filenames already seen
    announced: set = set()
    while True:
        db = await aiosqlite.connect(DB_PATH)
        db.row_factory = aiosqlite.Row
        try:
            projects = await _load_projects(db)

            for project in projects:
                slug = project["slug"]
                incoming_dir = _dirs(project)["incoming"]
                os.makedirs(incoming_dir, exist_ok=True)
                if slug not in announced:
                    print(f"[youtube_pipeline] watching [{slug}] {incoming_dir}")
                    announced.add(slug)

                try:
                    entries = {f for f in os.listdir(incoming_dir) if f.lower().endswith(VIDEO_EXTS)}
                except FileNotFoundError:
                    entries = set()

                seen = known.setdefault(slug, set())
                for f in entries - seen:
                    path = os.path.join(incoming_dir, f)
                    if not os.path.isfile(path):
                        continue
                    seen.add(f)
                    await process_video(path, db, project)

                known[slug] = seen & entries  # a re-dropped filename (after publish/fail) gets reprocessed
        finally:
            await db.close()

        await asyncio.sleep(poll_interval)
