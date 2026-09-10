"""
Social Media router — OAuth connection management and cross-platform posting.

Supported platforms:
  Facebook  — posts to connected Pages via Graph API v19
  Instagram — photo/video posts to IG Business accounts (image must be at a public URL)
  YouTube   — video uploads via YouTube Data API v3
  LinkedIn  — text/image posts to personal profile via UGC Posts API

OAuth flow (popup-based):
  GET /api/social/connect/{platform}   → redirect to platform OAuth page
  GET /api/social/callback/{platform}  → receives code, stores token, closes popup

Credentials (in .env):
  FACEBOOK_APP_ID / FACEBOOK_APP_SECRET
  GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
  LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET
  SOCIAL_REDIRECT_BASE  (default: http://localhost:8010)
"""

import json
import os
import secrets
import time
from typing import Optional
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, File
from fastapi.responses import HTMLResponse, RedirectResponse, Response

from backend.db import get_db
from backend._frozen import user_data_dir

router = APIRouter()

# ── Config from env ───────────────────────────────────────────────────────────

def _e(key: str, default: str = "") -> str:
    """Read an environment variable with an optional default."""
    return os.environ.get(key, default)

REDIRECT_BASE = _e("SOCIAL_REDIRECT_BASE", "http://localhost:8010")

PLATFORM_CFG = {
    "facebook": {
        "auth_url": "https://www.facebook.com/v19.0/dialog/oauth",
        "token_url": "https://graph.facebook.com/v19.0/oauth/access_token",
        "client_id_env": "FACEBOOK_APP_ID",
        "client_secret_env": "FACEBOOK_APP_SECRET",
        "scope": "pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish",
    },
    "instagram": {
        # Instagram uses the same Facebook OAuth app
        "auth_url": "https://www.facebook.com/v19.0/dialog/oauth",
        "token_url": "https://graph.facebook.com/v19.0/oauth/access_token",
        "client_id_env": "FACEBOOK_APP_ID",
        "client_secret_env": "FACEBOOK_APP_SECRET",
        "scope": "instagram_basic,instagram_content_publish,pages_read_engagement",
    },
    "youtube": {
        "auth_url": "https://accounts.google.com/o/oauth2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "client_id_env": "GOOGLE_CLIENT_ID",
        "client_secret_env": "GOOGLE_CLIENT_SECRET",
        "scope": "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly",
    },
    "linkedin": {
        "auth_url": "https://www.linkedin.com/oauth/v2/authorization",
        "token_url": "https://www.linkedin.com/oauth/v2/accessToken",
        "client_id_env": "LINKEDIN_CLIENT_ID",
        "client_secret_env": "LINKEDIN_CLIENT_SECRET",
        "scope": "r_liteprofile w_member_social",
    },
}

# In-memory CSRF state tokens (platform → state)
_pending_states: dict[str, str] = {}

_OAUTH_CLOSE_HTML = """<!DOCTYPE html><html><body>
<p style="font-family:sans-serif;text-align:center;margin-top:40px;color:#888">
  {msg}<br><small>You can close this window.</small>
</p>
<script>
  if (window.opener) {{
    window.opener.postMessage({{type:'oauth_complete',platform:'{platform}',ok:{ok}}}, '*');
    setTimeout(() => window.close(), 800);
  }}
</script>
</body></html>"""


def _callback_url(platform: str) -> str:
    """Build the OAuth redirect URI for a platform."""
    return f"{REDIRECT_BASE}/api/social/callback/{platform}"


def _cfg(platform: str) -> dict:
    """Return the PLATFORM_CFG entry for a platform, raising 404 if unknown."""
    if platform not in PLATFORM_CFG:
        raise HTTPException(404, f"Unknown platform: {platform}")
    return PLATFORM_CFG[platform]


# ── Account listing ───────────────────────────────────────────────────────────

@router.get("/accounts")
async def list_accounts(db=Depends(get_db)):
    """GET /accounts — list all connected social media accounts."""
    rows = await db.execute_fetchall(
        "SELECT id, platform, account_id, account_name, account_type, token_expires_at, meta_json, created_at FROM social_accounts ORDER BY platform, account_name"
    )
    return [dict(r) for r in rows]


@router.delete("/accounts/{account_id}")
async def delete_account(account_id: int, db=Depends(get_db)):
    """DELETE /accounts/{id} — disconnect and remove a social account."""
    await db.execute("DELETE FROM social_accounts WHERE id = ?", (account_id,))
    await db.commit()
    return {"ok": True}


# ── OAuth connect ─────────────────────────────────────────────────────────────

@router.get("/connect/{platform}")
async def connect_platform(platform: str):
    """GET /connect/{platform} — redirect the user to the platform's OAuth authorization page."""
    cfg = _cfg(platform)
    client_id = _e(cfg["client_id_env"])
    if not client_id:
        raise HTTPException(400, f"{cfg['client_id_env']} not set in environment")

    state = secrets.token_urlsafe(16)
    _pending_states[state] = platform

    params = {
        "client_id": client_id,
        "redirect_uri": _callback_url(platform),
        "scope": cfg["scope"],
        "response_type": "code",
        "state": state,
    }
    if platform == "youtube":
        params["access_type"] = "offline"
        params["prompt"] = "consent"

    return RedirectResponse(f"{cfg['auth_url']}?{urlencode(params)}")


# ── OAuth callbacks ───────────────────────────────────────────────────────────

@router.get("/callback/{platform}", response_class=HTMLResponse)
async def oauth_callback(platform: str, code: str = "", state: str = "", error: str = "", db=Depends(get_db)):
    """GET /callback/{platform} — receive OAuth code, exchange for tokens, and store the account."""
    if error:
        return HTMLResponse(_OAUTH_CLOSE_HTML.format(msg=f"Authorization denied: {error}", platform=platform, ok="false"))

    if state not in _pending_states or _pending_states.pop(state) != platform:
        return HTMLResponse(_OAUTH_CLOSE_HTML.format(msg="Invalid state — possible CSRF. Try reconnecting.", platform=platform, ok="false"))

    cfg = _cfg(platform)
    client_id = _e(cfg["client_id_env"])
    client_secret = _e(cfg["client_secret_env"])

    # Exchange code for tokens
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            token_params = {
                "client_id": client_id,
                "client_secret": client_secret,
                "code": code,
                "redirect_uri": _callback_url(platform),
                "grant_type": "authorization_code",
            }
            r = await client.post(cfg["token_url"], data=token_params)
            r.raise_for_status()
            tok = r.json()
    except Exception as e:
        return HTMLResponse(_OAUTH_CLOSE_HTML.format(msg=f"Token exchange failed: {e}", platform=platform, ok="false"))

    access_token = tok.get("access_token", "")
    refresh_token = tok.get("refresh_token")
    expires_in = tok.get("expires_in")
    expires_at = None
    if expires_in:
        expires_at = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(time.time() + int(expires_in)))

    # Platform-specific: fetch account info and store
    try:
        if platform in ("facebook", "instagram"):
            await _store_facebook_accounts(db, access_token, platform)
        elif platform == "youtube":
            await _store_youtube_account(db, access_token, refresh_token, expires_at)
        elif platform == "linkedin":
            await _store_linkedin_account(db, access_token, refresh_token, expires_at)
    except Exception as e:
        return HTMLResponse(_OAUTH_CLOSE_HTML.format(msg=f"Account fetch failed: {e}", platform=platform, ok="false"))

    return HTMLResponse(_OAUTH_CLOSE_HTML.format(msg="Connected successfully!", platform=platform, ok="true"))


async def _store_facebook_accounts(db, access_token: str, platform: str):
    """Fetch user pages (Facebook) and linked IG accounts, store tokens."""
    # Exchange short-lived token for long-lived
    app_id = _e("FACEBOOK_APP_ID")
    app_secret = _e("FACEBOOK_APP_SECRET")
    async with httpx.AsyncClient(timeout=15) as client:
        ll = await client.get("https://graph.facebook.com/v19.0/oauth/access_token", params={
            "grant_type": "fb_exchange_token",
            "client_id": app_id,
            "client_secret": app_secret,
            "fb_exchange_token": access_token,
        })
        ll.raise_for_status()
        long_token = ll.json().get("access_token", access_token)

        # Fetch pages
        pages_r = await client.get("https://graph.facebook.com/v19.0/me/accounts", params={
            "access_token": long_token,
            "fields": "id,name,access_token,instagram_business_account",
        })
        pages_r.raise_for_status()
        pages = pages_r.json().get("data", [])

    for page in pages:
        page_token = page.get("access_token", long_token)
        meta = {"page_id": page["id"]}
        await db.execute(
            """INSERT INTO social_accounts (platform, account_id, account_name, account_type, access_token, meta_json, updated_at)
               VALUES ('facebook', ?, ?, 'page', ?, ?, datetime('now'))
               ON CONFLICT(platform, account_id) DO UPDATE SET
                 account_name=excluded.account_name, access_token=excluded.access_token,
                 meta_json=excluded.meta_json, updated_at=excluded.updated_at""",
            (page["id"], page["name"], page_token, json.dumps(meta)),
        )

        # Instagram Business account linked to this page
        ig = page.get("instagram_business_account")
        if ig and platform == "instagram":
            async with httpx.AsyncClient(timeout=10) as client:
                ig_r = await client.get(f"https://graph.facebook.com/v19.0/{ig['id']}", params={
                    "fields": "id,username",
                    "access_token": page_token,
                })
                if ig_r.status_code == 200:
                    ig_data = ig_r.json()
                    ig_meta = {"ig_user_id": ig_data["id"], "page_id": page["id"], "page_token": page_token}
                    await db.execute(
                        """INSERT INTO social_accounts (platform, account_id, account_name, account_type, access_token, meta_json, updated_at)
                           VALUES ('instagram', ?, ?, 'business', ?, ?, datetime('now'))
                           ON CONFLICT(platform, account_id) DO UPDATE SET
                             account_name=excluded.account_name, access_token=excluded.access_token,
                             meta_json=excluded.meta_json, updated_at=excluded.updated_at""",
                        (ig_data["id"], ig_data.get("username", ig_data["id"]), page_token, json.dumps(ig_meta)),
                    )

    await db.commit()


async def _store_youtube_account(db, access_token: str, refresh_token: Optional[str], expires_at: Optional[str]):
    """Fetch the user's YouTube channel and upsert it into social_accounts."""
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get("https://www.googleapis.com/youtube/v3/channels", params={
            "part": "snippet",
            "mine": "true",
            "access_token": access_token,
        })
        r.raise_for_status()
        items = r.json().get("items", [])
    if not items:
        raise ValueError("No YouTube channel found for this account")
    ch = items[0]
    meta = {"channel_id": ch["id"]}
    await db.execute(
        """INSERT INTO social_accounts (platform, account_id, account_name, account_type, access_token, refresh_token, token_expires_at, meta_json, updated_at)
           VALUES ('youtube', ?, ?, 'channel', ?, ?, ?, ?, datetime('now'))
           ON CONFLICT(platform, account_id) DO UPDATE SET
             account_name=excluded.account_name, access_token=excluded.access_token,
             refresh_token=excluded.refresh_token, token_expires_at=excluded.token_expires_at,
             meta_json=excluded.meta_json, updated_at=excluded.updated_at""",
        (ch["id"], ch["snippet"]["title"], access_token, refresh_token, expires_at, json.dumps(meta)),
    )
    await db.commit()


async def _store_linkedin_account(db, access_token: str, refresh_token: Optional[str], expires_at: Optional[str]):
    """Fetch the LinkedIn profile and upsert it into social_accounts."""
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get("https://api.linkedin.com/v2/me", headers={
            "Authorization": f"Bearer {access_token}",
        })
        r.raise_for_status()
        profile = r.json()
    person_id = profile.get("id", "")
    first = profile.get("localizedFirstName", "")
    last = profile.get("localizedLastName", "")
    name = f"{first} {last}".strip() or person_id
    meta = {"person_urn": f"urn:li:person:{person_id}"}
    await db.execute(
        """INSERT INTO social_accounts (platform, account_id, account_name, account_type, access_token, refresh_token, token_expires_at, meta_json, updated_at)
           VALUES ('linkedin', ?, ?, 'user', ?, ?, ?, ?, datetime('now'))
           ON CONFLICT(platform, account_id) DO UPDATE SET
             account_name=excluded.account_name, access_token=excluded.access_token,
             refresh_token=excluded.refresh_token, token_expires_at=excluded.token_expires_at,
             meta_json=excluded.meta_json, updated_at=excluded.updated_at""",
        (person_id, name, access_token, refresh_token, expires_at, json.dumps(meta)),
    )
    await db.commit()


# ── Token refresh (Google only — others require re-auth) ──────────────────────

async def _refresh_google_token(refresh_token: str) -> str:
    """Exchange a Google refresh token for a new access token."""
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post("https://oauth2.googleapis.com/token", data={
            "client_id": _e("GOOGLE_CLIENT_ID"),
            "client_secret": _e("GOOGLE_CLIENT_SECRET"),
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        })
        r.raise_for_status()
        return r.json()["access_token"]


# ── YouTube channel analytics ─────────────────────────────────────────────────
# Multiple channels can be connected at once (Arynwood Technology, Terminal Pulse,
# Apothecary After Dark, the kids' channel, ...) — each project links to one of them
# via content_projects.youtube_account_id. Analytics are fetched per-account and
# returned as a list so the frontend can show one card per connected channel.

@router.get("/youtube/analytics")
async def youtube_analytics(account_id: Optional[int] = None, db=Depends(get_db)):
    """GET /youtube/analytics[?account_id=] — channel totals + per-video stats + insights.

    Without account_id, returns analytics for every connected YouTube channel."""
    if account_id is not None:
        rows = await db.execute_fetchall("SELECT * FROM social_accounts WHERE id = ? AND platform = 'youtube'", (account_id,))
    else:
        rows = await db.execute_fetchall("SELECT * FROM social_accounts WHERE platform = 'youtube'")
    if not rows:
        raise HTTPException(404, "No YouTube channel connected. Connect one from the Social page first.")

    channels = []
    for row in rows:
        acct = dict(row)
        try:
            channels.append(await _fetch_youtube_analytics_for_account(db, acct))
        except Exception as e:
            channels.append({"account_id": acct["id"], "account_name": acct["account_name"], "error": str(e)})
    return {"channels": channels}


async def _fetch_youtube_analytics_for_account(db, acct: dict) -> dict:
    token = acct["access_token"]
    if acct.get("refresh_token"):
        try:
            token = await _refresh_google_token(acct["refresh_token"])
            await db.execute(
                "UPDATE social_accounts SET access_token = ?, updated_at = datetime('now') WHERE id = ?",
                (token, acct["id"]),
            )
            await db.commit()
        except Exception:
            pass  # fall back to the stored token; the calls below will surface any auth error

    async with httpx.AsyncClient(timeout=15) as client:
        ch_r = await client.get("https://www.googleapis.com/youtube/v3/channels", params={
            "part": "snippet,statistics,contentDetails",
            "mine": "true",
        }, headers={"Authorization": f"Bearer {token}"})
        ch_r.raise_for_status()
        ch_items = ch_r.json().get("items", [])
        if not ch_items:
            raise HTTPException(502, "YouTube returned no channel for this account.")
        channel = ch_items[0]
        uploads_playlist = channel["contentDetails"]["relatedPlaylists"]["uploads"]

        video_ids: list[str] = []
        page_token = ""
        while True:
            pl_r = await client.get("https://www.googleapis.com/youtube/v3/playlistItems", params={
                "part": "contentDetails",
                "playlistId": uploads_playlist,
                "maxResults": 50,
                **({"pageToken": page_token} if page_token else {}),
            }, headers={"Authorization": f"Bearer {token}"})
            pl_r.raise_for_status()
            pl_data = pl_r.json()
            video_ids += [i["contentDetails"]["videoId"] for i in pl_data.get("items", [])]
            page_token = pl_data.get("nextPageToken", "")
            if not page_token:
                break

        videos: list[dict] = []
        for i in range(0, len(video_ids), 50):
            batch = video_ids[i:i + 50]
            v_r = await client.get("https://www.googleapis.com/youtube/v3/videos", params={
                "part": "snippet,statistics,contentDetails",
                "id": ",".join(batch),
            }, headers={"Authorization": f"Bearer {token}"})
            v_r.raise_for_status()
            for v in v_r.json().get("items", []):
                stats = v.get("statistics", {})
                videos.append({
                    "video_id": v["id"],
                    "title": v["snippet"]["title"],
                    "published_at": v["snippet"]["publishedAt"],
                    "duration": v["contentDetails"].get("duration", ""),
                    "views": int(stats.get("viewCount", 0)),
                    "likes": int(stats.get("likeCount", 0)),
                    "comments": int(stats.get("commentCount", 0)),
                })

    videos.sort(key=lambda v: v["published_at"], reverse=True)

    return {
        "account_id": acct["id"],
        "account_name": acct["account_name"],
        "channel": {
            "id": channel["id"],
            "title": channel["snippet"]["title"],
            "subscribers": int(channel["statistics"].get("subscriberCount", 0)),
            "total_views": int(channel["statistics"].get("viewCount", 0)),
            "video_count": int(channel["statistics"].get("videoCount", 0)),
        },
        "videos": videos,
        "insights": _compute_insights(videos),
    }


def _compute_insights(videos: list[dict]) -> dict:
    """Descriptive (not predictive) stats — a new channel has too little data for anything fancier."""
    if not videos:
        return {"note": "No videos published yet — nothing to analyze."}

    n = len(videos)
    avg_views = sum(v["views"] for v in videos) / n
    avg_likes = sum(v["likes"] for v in videos) / n
    best = max(videos, key=lambda v: v["views"])
    worst = min(videos, key=lambda v: v["views"])

    insights = {
        "video_count": n,
        "avg_views": round(avg_views, 1),
        "avg_likes": round(avg_likes, 1),
        "best_performer": {"title": best["title"], "views": best["views"]},
        "worst_performer": {"title": worst["title"], "views": worst["views"]} if n > 1 else None,
        "above_average": [v["title"] for v in videos if v["views"] > avg_views],
        "low_sample_warning": n < 5,
    }
    if n < 5:
        insights["note"] = (
            f"Only {n} video(s) published — averages and 'best/worst' aren't statistically "
            "meaningful yet. Treat this as a snapshot, not a pattern, until there are more data points."
        )
    return insights


@router.get("/youtube/uploads")
async def youtube_upload_log(project: Optional[str] = None, db=Depends(get_db)):
    """GET /youtube/uploads[?project=<slug>] — recent auto-publish pipeline activity across all projects."""
    if project:
        rows = await db.execute_fetchall(
            "SELECT id, filename, status, video_id, title, error, project_slug, created_at FROM youtube_uploads "
            "WHERE project_slug = ? ORDER BY created_at DESC LIMIT 50",
            (project,),
        )
    else:
        rows = await db.execute_fetchall(
            "SELECT id, filename, status, video_id, title, error, project_slug, created_at FROM youtube_uploads "
            "ORDER BY created_at DESC LIMIT 50"
        )
    return [dict(r) for r in rows]


# ── Content projects (multi-channel/multi-series pipeline) ───────────────────
# One project = one folder tree (incoming/published/failed/metadata) + one linked
# YouTube channel. Lets Arynwood Technology, Terminal Pulse, Apothecary After Dark,
# the kids' channel, and any future series/sub-channel share the same watcher.

@router.get("/projects")
async def list_projects(db=Depends(get_db)):
    """GET /projects — all content projects, with the linked YouTube channel name if any."""
    rows = await db.execute_fetchall(
        """SELECT p.id, p.slug, p.name, p.base_dir, p.youtube_account_id, p.created_at,
                  a.account_name AS youtube_account_name
           FROM content_projects p
           LEFT JOIN social_accounts a ON a.id = p.youtube_account_id
           ORDER BY p.id"""
    )
    return [dict(r) for r in rows]


@router.post("/projects")
async def create_project(slug: str = Form(...), name: str = Form(...), base_dir: str = Form(...), db=Depends(get_db)):
    """POST /projects — register a new project (its own incoming/published/failed/metadata folders)."""
    try:
        await db.execute(
            "INSERT INTO content_projects (slug, name, base_dir) VALUES (?, ?, ?)",
            (slug, name, os.path.expanduser(base_dir)),
        )
        await db.commit()
    except Exception as e:
        raise HTTPException(400, f"Could not create project (slug must be unique): {e}")
    return {"ok": True}


@router.post("/projects/{project_id}/link")
async def link_project_account(project_id: int, account_id: Optional[int] = Form(None), db=Depends(get_db)):
    """POST /projects/{id}/link — assign (or clear, with no account_id) which connected YouTube channel this project publishes to."""
    await db.execute("UPDATE content_projects SET youtube_account_id = ? WHERE id = ?", (account_id, project_id))
    await db.commit()
    return {"ok": True}


# ── Post history ──────────────────────────────────────────────────────────────

@router.get("/posts")
async def list_posts(db=Depends(get_db)):
    """GET /posts — return the 100 most recent cross-platform post records."""
    rows = await db.execute_fetchall(
        "SELECT * FROM social_posts ORDER BY created_at DESC LIMIT 100"
    )
    return [dict(r) for r in rows]


# ── Unified post endpoint ─────────────────────────────────────────────────────

@router.post("/post")
async def create_post(
    platforms: str = Form(...),        # JSON list: ["facebook","instagram","youtube","linkedin"]
    text: str = Form(""),
    title: str = Form(""),             # YouTube video title
    media_url: str = Form(""),         # public image URL (Facebook, Instagram, LinkedIn)
    video: Optional[UploadFile] = File(None),   # YouTube video file
    image: Optional[UploadFile] = File(None),   # image file (uploaded to serve as media_url)
    db=Depends(get_db),
):
    """POST /post — publish content to one or more platforms in a single call."""
    try:
        target_platforms: list[str] = json.loads(platforms)
    except Exception:
        raise HTTPException(400, "platforms must be a JSON array")

    # If image file uploaded, save it and create a URL for it
    served_media_url = media_url
    if image and not media_url:
        # Save uploaded image to static dir and serve it
        import uuid as _uuid
        static_dir = os.path.join(user_data_dir(), "static", "social-media")
        os.makedirs(static_dir, exist_ok=True)
        ext = (image.filename or "image.jpg").rsplit(".", 1)[-1]
        fname = f"{_uuid.uuid4().hex}.{ext}"
        fpath = os.path.join(static_dir, fname)
        with open(fpath, "wb") as f:
            f.write(await image.read())
        served_media_url = f"{REDIRECT_BASE}/social-media/{fname}"

    results = []
    for platform in target_platforms:
        accounts = await db.execute_fetchall(
            "SELECT * FROM social_accounts WHERE platform = ?", (platform,)
        )
        accounts = [dict(a) for a in accounts]
        if not accounts:
            results.append({"platform": platform, "status": "failed", "error": "No connected account"})
            continue

        for acct in accounts:
            try:
                post_id = await _dispatch_post(platform, acct, text, title, served_media_url, video, db)
                await _log_post(db, platform, acct["account_id"], text, served_media_url, post_id, "published")
                results.append({"platform": platform, "account": acct["account_name"], "status": "published", "post_id": post_id})
            except Exception as e:
                err = str(e)
                await _log_post(db, platform, acct["account_id"], text, served_media_url, None, "failed", err)
                results.append({"platform": platform, "account": acct["account_name"], "status": "failed", "error": err})

    return {"results": results}


async def _dispatch_post(platform, acct, text, title, media_url, video, db):
    """Route a post to the correct platform-specific publish function."""
    token = acct["access_token"]
    meta = json.loads(acct.get("meta_json") or "{}")

    if platform == "facebook":
        return await _post_facebook(token, acct["account_id"], text, media_url)
    elif platform == "instagram":
        if not media_url:
            raise ValueError("Instagram requires an image URL. Upload an image or provide a public URL.")
        return await _post_instagram(token, meta.get("ig_user_id", acct["account_id"]), text, media_url)
    elif platform == "youtube":
        if not video:
            raise ValueError("YouTube requires a video file upload.")
        vbytes = await video.read()
        # Refresh token if needed
        if acct.get("refresh_token"):
            try:
                token = await _refresh_google_token(acct["refresh_token"])
                await db.execute(
                    "UPDATE social_accounts SET access_token = ?, updated_at = datetime('now') WHERE id = ?",
                    (token, acct["id"])
                )
                await db.commit()
            except Exception:
                pass
        return await _post_youtube(token, title or text[:100] or "Untitled", text, vbytes, video.filename or "video.mp4")
    elif platform == "linkedin":
        person_urn = meta.get("person_urn", f"urn:li:person:{acct['account_id']}")
        return await _post_linkedin(token, person_urn, text, media_url)
    else:
        raise ValueError(f"Unknown platform: {platform}")


async def _log_post(db, platform, account_id, content, media_url, post_id, status, error=None):
    """Insert a post record into social_posts to track publish history."""
    await db.execute(
        "INSERT INTO social_posts (platform, account_id, content, media_url, post_id, status, error) VALUES (?,?,?,?,?,?,?)",
        (platform, account_id, content, media_url, post_id, status, error),
    )
    await db.commit()


# ── Platform posting functions ────────────────────────────────────────────────

async def _post_facebook(token: str, page_id: str, message: str, media_url: str) -> str:
    """Publish a photo or text post to a Facebook Page; returns the created post ID."""
    async with httpx.AsyncClient(timeout=30) as client:
        if media_url:
            r = await client.post(f"https://graph.facebook.com/v19.0/{page_id}/photos", data={
                "url": media_url,
                "caption": message,
                "access_token": token,
            })
        else:
            r = await client.post(f"https://graph.facebook.com/v19.0/{page_id}/feed", data={
                "message": message,
                "access_token": token,
            })
        r.raise_for_status()
        return r.json().get("id", "")


async def _post_instagram(token: str, ig_user_id: str, caption: str, image_url: str) -> str:
    """Create and publish an Instagram media container; returns the media ID."""
    async with httpx.AsyncClient(timeout=30) as client:
        # Step 1: create container
        cr = await client.post(f"https://graph.facebook.com/v19.0/{ig_user_id}/media", data={
            "image_url": image_url,
            "caption": caption,
            "access_token": token,
        })
        cr.raise_for_status()
        container_id = cr.json().get("id")
        if not container_id:
            raise ValueError(f"IG container creation failed: {cr.text}")

        # Step 2: publish
        pr = await client.post(f"https://graph.facebook.com/v19.0/{ig_user_id}/media_publish", data={
            "creation_id": container_id,
            "access_token": token,
        })
        pr.raise_for_status()
        return pr.json().get("id", "")


async def _post_youtube(token: str, title: str, description: str, video_bytes: bytes, filename: str) -> str:
    """Upload a video to YouTube via multipart upload; returns the video ID."""
    ext = filename.rsplit(".", 1)[-1].lower()
    mime = {"mp4": "video/mp4", "webm": "video/webm", "mov": "video/quicktime", "avi": "video/x-msvideo"}.get(ext, "video/mp4")
    metadata = {
        "snippet": {"title": title[:100], "description": description, "categoryId": "22"},
        "status": {"privacyStatus": "public"},
    }
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(
            "https://www.googleapis.com/upload/youtube/v3/videos",
            params={"uploadType": "multipart", "part": "snippet,status"},
            content=_build_multipart_body(metadata, video_bytes, mime),
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "multipart/related; boundary=boundary123",
            },
        )
        r.raise_for_status()
        return r.json().get("id", "")


def _build_multipart_body(metadata: dict, video_bytes: bytes, mime: str) -> bytes:
    """Serialize a YouTube multipart/related upload body with JSON metadata and video bytes."""
    meta_json = json.dumps(metadata).encode()
    boundary = b"boundary123"
    body = (
        b"--" + boundary + b"\r\n"
        b"Content-Type: application/json; charset=UTF-8\r\n\r\n"
        + meta_json + b"\r\n"
        b"--" + boundary + b"\r\n"
        b"Content-Type: " + mime.encode() + b"\r\n\r\n"
        + video_bytes + b"\r\n"
        b"--" + boundary + b"--"
    )
    return body


async def _post_linkedin(token: str, person_urn: str, text: str, media_url: str) -> str:
    """Publish a UGC post to LinkedIn; returns the post URN/ID."""
    async with httpx.AsyncClient(timeout=30) as client:
        body: dict = {
            "author": person_urn,
            "lifecycleState": "PUBLISHED",
            "specificContent": {
                "com.linkedin.ugc.ShareContent": {
                    "shareCommentary": {"text": text},
                    "shareMediaCategory": "NONE" if not media_url else "IMAGE",
                }
            },
            "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"},
        }
        if media_url:
            body["specificContent"]["com.linkedin.ugc.ShareContent"]["media"] = [
                {"status": "READY", "originalUrl": media_url}
            ]
        r = await client.post(
            "https://api.linkedin.com/v2/ugcPosts",
            headers={"Authorization": f"Bearer {token}", "X-Restli-Protocol-Version": "2.0.0"},
            json=body,
        )
        r.raise_for_status()
        post_id = r.headers.get("x-restli-id", r.json().get("id", ""))
        return str(post_id)


# ── Static serving of uploaded social media images ───────────────────────────

from fastapi.staticfiles import StaticFiles
from fastapi import Request
from fastapi.responses import FileResponse
import os as _os

@router.get("/media/{filename}")
async def serve_social_media(filename: str):
    """GET /media/{filename} — serve an uploaded social media image from the static dir."""
    static_dir = _os.path.join(user_data_dir(), "static", "social-media")
    path = _os.path.join(static_dir, filename)
    if not _os.path.isfile(path):
        raise HTTPException(404)
    return FileResponse(path)
