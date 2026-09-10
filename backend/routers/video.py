import asyncio
import json
import os
import shutil
import sys
import tempfile
import time
import uuid
from typing import Optional
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.services.gpu_jobs import (
    BASE_DIR, _jobs, gpu_queue, _new_job, _newest_file,
    _free_sd_vram_for_job, _restore_sd_vram_after_job,
)
from backend.routers.tools import _WHISPER_PYTHON

# Video Studio: new capabilities layered on top of the existing GPU-tool job
# system in tools.py (SadTalker/AnimateDiff/LTX-Video already have working job
# endpoints there and are left untouched — ToolLibrary and Design Center both
# depend on those exact paths). Everything here is additive and shares the same
# _jobs dict / gpu_queue from gpu_jobs.py, so GET /api/tools/jobs/{id} and
# GET /api/tools/jobs/{id}/file (already generic, keyed only by job_id) work for
# jobs started here too — no need to duplicate polling/download endpoints.

router = APIRouter()

_WAN2_SCRIPT = os.path.join(BASE_DIR, "scripts", "run_wan2.py")
_WHISPER_SCRIPT = os.path.join(BASE_DIR, "scripts", "run_whisper.py")

_VIDEO_TOOLS = {"sadtalker", "animatediff", "ltx_video", "wan2"}

# Every clip gets normalized to a common canvas before concatenation —
# AnimateDiff (gif), LTX-Video/Wan2.1/SadTalker (mp4, differing resolutions)
# can't otherwise be stream-copy-concatenated. SadTalker in particular tends to
# be portrait (a talking-head crop), so landscape can't be the only option.
_CANVAS_PRESETS = {
    "vertical": (720, 1280),
    "square": (720, 720),
    "landscape": (1280, 720),
}
# xfade transition names to expose in the UI — a small curated subset of
# ffmpeg's full list, picked for being visually distinct and broadly flattering.
_XFADE_TYPES = {"fade", "slideleft", "slideup"}

# Per-clip cinematic look presets — curated color-grade recipes rather than
# raw sliders, applied inside each clip's own normalization filter chain (so
# different shots in the same timeline can carry different moods, like real
# grading). Verified by eye against real footage, not just filter-syntax
# validity — "vintage_film" originally used ffmpeg's built-in
# curves=preset=vintage, which turned out to skew cool/purple rather than the
# warm faded look the name implies, so it's hand-built instead.
_LOOK_PRESETS = {
    "none": "",
    "cinematic": "curves=preset=medium_contrast,colorbalance=rs=0.08:gs=0.02:bs=-0.08:rm=0.06:bm=-0.06:rh=0.04:bh=-0.02,eq=saturation=1.1:contrast=1.08",
    "teal_orange": "colorbalance=rs=0.1:bs=-0.15:rm=0.15:bm=-0.1:rh=0.1:bh=-0.05,eq=saturation=1.25:contrast=1.1",
    "golden_hour": "colorbalance=rs=0.12:gs=0.05:bs=-0.1:rm=0.1:gm=0.02:bm=-0.08,eq=saturation=1.15:gamma=1.05",
    "noir": "hue=s=0,eq=contrast=1.35:brightness=-0.02,curves=preset=strong_contrast",
    "bleach_bypass": "eq=saturation=0.3:contrast=1.3:brightness=0.03,curves=preset=increase_contrast",
    "vintage_film": "eq=contrast=0.85:brightness=0.05:saturation=0.75,colorbalance=rs=0.15:gs=0.05:bs=-0.1:rh=0.1:gh=0.05:bh=-0.15,vignette=PI/5,noise=alls=10:allf=t",
    "dreamy": "eq=contrast=0.9:brightness=0.05:saturation=0.9,gblur=sigma=1.2",
    "cyberpunk": "colorbalance=rs=-0.05:bs=0.2:rm=-0.05:bm=0.15:rh=0.02:bh=0.1,eq=saturation=1.3:contrast=1.15",
}


def _atempo_chain(speed: float) -> str:
    """ffmpeg's atempo filter only accepts a 0.5-2.0 ratio per instance —
    decompose an arbitrary positive speed into a chain of atempo stages
    whose product equals it (e.g. 4.0 -> atempo=2.0,atempo=2.0)."""
    stages = []
    remaining = speed
    while remaining > 2.0:
        stages.append(2.0)
        remaining /= 2.0
    while remaining < 0.5:
        stages.append(0.5)
        remaining /= 0.5
    stages.append(remaining)
    return ",".join(f"atempo={s}" for s in stages)


async def _ffprobe_json(path: str) -> dict:
    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", path,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
    )
    out, _ = await proc.communicate()
    try:
        return json.loads(out or b"{}")
    except json.JSONDecodeError:
        return {}


async def _has_audio_stream(path: str) -> bool:
    info = await _ffprobe_json(path)
    return any(s.get("codec_type") == "audio" for s in info.get("streams", []))


async def _resolve_canvas(canvas: str, first_source: str) -> tuple[int, int]:
    if canvas in _CANVAS_PRESETS:
        return _CANVAS_PRESETS[canvas]
    # "auto" — match the first clip's own aspect ratio, longest side capped at
    # 1280 to keep render time reasonable on this box.
    info = await _ffprobe_json(first_source)
    vstream = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), None)
    if not vstream:
        return _CANVAS_PRESETS["landscape"]
    w, h = int(vstream["width"]), int(vstream["height"])
    scale = 1280 / max(w, h)
    return round(w * scale / 2) * 2, round(h * scale / 2) * 2


# ── Wan2.1 (text → video) ────────────────────────────────────────────────────

@router.post("/wan2/jobs")
async def wan2_start_job(
    prompt: str = Form(...),
    negative_prompt: str = Form(""),
    num_frames: int = Form(49),
    fps: float = Form(16.0),
    width: int = Form(832),
    height: int = Form(480),
):
    """POST /wan2/jobs — start a Wan2.1 text-to-video render."""
    if not os.path.exists(_WAN2_SCRIPT):
        raise HTTPException(404, "Wan2.1 wrapper script not found. Check scripts/run_wan2.py")

    output_dir = os.path.join(BASE_DIR, "triggers", "gpu_watch", "wan2_output")
    os.makedirs(output_dir, exist_ok=True)

    job_id = _new_job("wan2")
    started_at = time.time()

    async def _run():
        try:
            cmd = [
                sys.executable, _WAN2_SCRIPT,
                "--prompt", prompt,
                "--negative_prompt", negative_prompt,
                "--num_frames", str(num_frames),
                "--fps", str(fps),
                "--width", str(width),
                "--height", str(height),
                "--output_dir", output_dir,
            ]
            async with gpu_queue.acquire(job_id):
                _jobs[job_id]["status"] = "running"
                await _free_sd_vram_for_job()
                try:
                    proc = await asyncio.create_subprocess_exec(
                        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                    )
                    out, _ = await proc.communicate()
                finally:
                    await _restore_sd_vram_after_job()
            if proc.returncode != 0:
                _jobs[job_id].update(status="error", error=out.decode(errors="replace")[-2000:])
                return
            result = _newest_file(output_dir, (".mp4",), started_at)
            if not result:
                _jobs[job_id].update(status="error", error="Wan2.1 finished but produced no video.")
                return
            _jobs[job_id].update(status="done", result_path=result)
        except Exception as e:
            _jobs[job_id].update(status="error", error=str(e))

    asyncio.create_task(_run())
    return {"job_id": job_id, "status": "queued"}


# ── Library ───────────────────────────────────────────────────────────────────

@router.get("/library")
async def video_library():
    """GET /library — completed video-generation jobs, newest first. Lets the
    Editor/Captions tabs pick already-generated clips instead of forcing a
    download-then-reupload round trip."""
    items = [
        {
            "job_id": jid,
            "tool": job["tool"],
            "created_at": job["created_at"],
            "result_path": job["result_path"],
        }
        for jid, job in _jobs.items()
        if job["tool"] in _VIDEO_TOOLS and job["status"] == "done" and job.get("result_path")
    ]
    items.sort(key=lambda i: i["created_at"], reverse=True)
    return items


# ── Music (Jamendo — free Creative Commons tracks) ──────────────────────────
# Free instant signup at https://devportal.jamendo.com/ for a client_id; set
# JAMENDO_CLIENT_ID in .env and restart the backend. Kept server-side (never
# sent to the frontend) rather than exposed in client JS.
JAMENDO_CLIENT_ID = os.environ.get("JAMENDO_CLIENT_ID", "")


def _is_jamendo_host(url: str) -> bool:
    try:
        host = urlparse(url).hostname or ""
    except ValueError:
        return False
    return host.endswith("jamendo.com")


@router.get("/music/search")
async def music_search(q: str = "", tags: str = "", order: str = "popularity_total", limit: int = 24):
    """GET /music/search — search Jamendo's Creative Commons catalog for
    background music. `tags` is a Jamendo genre/mood tag (e.g. "chill",
    "cinematic", "electronic"); `order` is "popularity_total" or "releasedate"."""
    if not JAMENDO_CLIENT_ID:
        raise HTTPException(
            503, "Jamendo isn't configured — get a free client_id at "
                 "https://devportal.jamendo.com/, set JAMENDO_CLIENT_ID in .env, and restart the backend.")
    params = {
        "client_id": JAMENDO_CLIENT_ID, "format": "json", "limit": str(max(1, min(limit, 50))),
        "order": order, "audioformat": "mp32", "include": "musicinfo",
    }
    if q: params["search"] = q
    if tags: params["tags"] = tags
    # Jamendo's API intermittently returns a genuinely empty `results` list
    # (still HTTP 200, status "success", no error_message) for a request that
    # returns two dozen tracks moments later with identical params — confirmed
    # directly by repeating the exact same request several times in a row.
    # Since a real "no matches" case will just as validly return empty again
    # on retry, a couple of quick retries only ever costs a few cheap extra
    # requests and turns "search silently returns nothing" into "search works."
    data: dict = {}
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                r = await client.get("https://api.jamendo.com/v3.0/tracks/", params=params)
                r.raise_for_status()
                data = r.json()
        except httpx.HTTPStatusError as e:
            raise HTTPException(e.response.status_code, f"Jamendo error: {e.response.text[:300]}")
        except httpx.RequestError as e:
            raise HTTPException(502, f"Couldn't reach Jamendo: {e}")
        if data.get("results") or attempt == 2:
            break
        await asyncio.sleep(0.4)
    return [
        {
            "id": t["id"], "name": t["name"], "artist": t["artist_name"],
            "duration": t["duration"], "image": t.get("image", ""),
            "audio_url": t["audio"], "license_url": t.get("license_ccurl", ""),
        }
        for t in data.get("results", [])
    ]


@router.get("/music/proxy")
async def music_proxy(url: str):
    """GET /music/proxy — stream a Jamendo track's audio through our backend
    (sidesteps any client-side CORS/mixed-content issues). `url` is
    allowlisted to jamendo.com hosts so this can't become an open proxy."""
    if not _is_jamendo_host(url):
        raise HTTPException(400, "Only jamendo.com audio URLs are allowed")

    async def _stream():
        async with httpx.AsyncClient(timeout=30.0) as client:
            async with client.stream("GET", url) as resp:
                resp.raise_for_status()
                async for chunk in resp.aiter_bytes():
                    yield chunk

    return StreamingResponse(_stream(), media_type="audio/mpeg")


# ── Editor (trim + stitch) ───────────────────────────────────────────────────

class EditClip(BaseModel):
    source_type: str  # "job" | "upload"
    source_id: str    # job_id, or upload index (as a string) into `files`
    trim_start: Optional[float] = None
    trim_end: Optional[float] = None
    is_photo: bool = False  # static image (jpeg/png/webp) — looped to fill trim duration, never has audio
    look: str = "none"      # cinematic look preset id, see _LOOK_PRESETS
    speed: float = 1.0      # playback rate; trim_start/trim_end stay in source time, on-timeline duration is (trim_end-trim_start)/speed


class EditTransition(BaseModel):
    type: str = "cut"  # "cut" | "fade" | "slideleft" | "slideup"
    duration: float = 0.5


class EditAudioTrack(BaseModel):
    source_id: str              # index into audio_files, as a string
    offset: float = 0.0         # seconds from timeline start
    trim_start: Optional[float] = None
    trim_end: Optional[float] = None
    volume: float = 1.0


@router.post("/edit/jobs")
async def edit_start_job(
    timeline: str = Form(...),
    files: list[UploadFile] = File(default=[]),
    canvas: str = Form("landscape"),
    transitions: str = Form("[]"),
    audio_tracks: str = Form("[]"),
    audio_files: list[UploadFile] = File(default=[]),
    mute_clip_audio: bool = Form(False),
    captions_srt: str = Form(""),
):
    """POST /edit/jobs — trim and concatenate an ordered list of clips (each
    either a library job's output or a freshly uploaded file) into one video.
    `timeline` is a JSON-encoded list of EditClip objects; `source_id` for an
    "upload" clip is the index into `files` (as a string). `canvas` is one of
    "vertical"/"square"/"landscape"/"auto" (match the first clip's own aspect).
    `transitions` is a JSON list of {"type","duration"} objects, one per
    junction between adjacent clips (length must be len(clips)-1) — every
    junction defaults to a hard cut unless given a real transition type.
    `audio_tracks` is a JSON list of EditAudioTrack objects (independently
    positioned/trimmed/volumed audio layers — background music, a recorded
    voiceover, etc.), each resolved by `source_id` (index, as a string) into
    `audio_files`; every track is mixed together and layered starting at its
    own `offset` (seconds from timeline start). Every clip's own audio is
    preserved through the concat and mixed in under the tracks unless
    `mute_clip_audio` is true, in which case it's dropped entirely. Each
    EditClip's `speed` (default 1.0) rescales that clip's on-timeline
    duration and pitch-corrects its own audio via ffmpeg's atempo filter;
    `trim_start`/`trim_end` always stay in source time regardless of speed.
    `captions_srt`, if non-empty, is a complete .srt document (as produced by
    the Editor's caption track, already reflecting any manual text/timing
    edits) burned into the final output as a last ffmpeg pass, after audio
    mixing."""
    try:
        clips = [EditClip(**c) for c in json.loads(timeline)]
    except Exception as e:
        raise HTTPException(400, f"Invalid timeline: {e}")
    if not clips:
        raise HTTPException(400, "Timeline is empty")
    try:
        junctions = [EditTransition(**t) for t in json.loads(transitions)]
    except Exception as e:
        raise HTTPException(400, f"Invalid transitions: {e}")
    if junctions and len(junctions) != len(clips) - 1:
        raise HTTPException(400, "transitions must have exactly len(clips)-1 entries")
    try:
        tracks = [EditAudioTrack(**t) for t in json.loads(audio_tracks)]
    except Exception as e:
        raise HTTPException(400, f"Invalid audio_tracks: {e}")

    tmp = tempfile.mkdtemp()
    upload_paths = []
    for i, f in enumerate(files):
        ext = os.path.splitext(f.filename or "")[1] or ".mp4"
        p = os.path.join(tmp, f"upload_{i}{ext}")
        with open(p, "wb") as out:
            shutil.copyfileobj(f.file, out)
        upload_paths.append(p)

    audio_track_paths = []
    for i, f in enumerate(audio_files):
        aext = os.path.splitext(f.filename or "")[1] or ".mp3"
        p = os.path.join(tmp, f"audio_track_{i}{aext}")
        with open(p, "wb") as out:
            shutil.copyfileobj(f.file, out)
        audio_track_paths.append(p)

    resolved_tracks: list[tuple[str, EditAudioTrack]] = []
    for track in tracks:
        idx = int(track.source_id)
        if idx < 0 or idx >= len(audio_track_paths):
            shutil.rmtree(tmp, ignore_errors=True)
            raise HTTPException(400, f"Audio track index {idx} out of range")
        resolved_tracks.append((audio_track_paths[idx], track))

    sources = []
    for clip in clips:
        if clip.source_type == "job":
            job = _jobs.get(clip.source_id)
            if not job or not job.get("result_path"):
                shutil.rmtree(tmp, ignore_errors=True)
                raise HTTPException(404, f"Job {clip.source_id} has no result")
            sources.append((job["result_path"], clip.trim_start, clip.trim_end, clip.is_photo, clip.look, clip.speed))
        elif clip.source_type == "upload":
            idx = int(clip.source_id)
            if idx < 0 or idx >= len(upload_paths):
                shutil.rmtree(tmp, ignore_errors=True)
                raise HTTPException(400, f"Upload index {idx} out of range")
            sources.append((upload_paths[idx], clip.trim_start, clip.trim_end, clip.is_photo, clip.look, clip.speed))
        else:
            shutil.rmtree(tmp, ignore_errors=True)
            raise HTTPException(400, f"Unknown source_type {clip.source_type!r}")

    output_dir = os.path.join(BASE_DIR, "triggers", "gpu_watch", "video_edit_output")
    os.makedirs(output_dir, exist_ok=True)

    job_id = _new_job("video_edit")

    async def _run():
        try:
            _jobs[job_id]["status"] = "running"
            canvas_w, canvas_h = await _resolve_canvas(canvas, sources[0][0])
            canvas_filter = (
                f"scale={canvas_w}:{canvas_h}:force_original_aspect_ratio=decrease,"
                f"pad={canvas_w}:{canvas_h}:(ow-iw)/2:(oh-ih)/2,setsar=1"
            )

            # Normalize each clip to the common canvas, keeping its own audio
            # (synthesizing silence for clips that have none, e.g. AnimateDiff's
            # gif output) so every segment has a uniform video+audio layout —
            # required for both the concat-demuxer path and the xfade path below.
            normalized = []
            durations = []
            for i, (src, start, end, is_photo, look, speed) in enumerate(sources):
                norm_path = os.path.join(tmp, f"norm_{i}.mp4")
                clip_duration = max((end - (start or 0)) if end is not None else 3.0, 0.1)
                # trim_start/trim_end stay in source time; speed only rescales
                # how much of the timeline that trimmed segment occupies once
                # played back — this is what feeds the xfade offset math below.
                on_timeline_duration = clip_duration / speed
                look_filter = _LOOK_PRESETS.get(look, "")
                # Applying setpts to a looped still image has no visible effect
                # (every frame is identical) — skip it for photos; the frontend
                # never exposes speed control for them anyway (always 1.0).
                speed_filter = f"setpts={1 / speed}*PTS" if speed != 1.0 and not is_photo else ""
                # fps=24 lives in the filter graph, not as a trailing -r 24
                # output flag — -r alone doesn't reliably duplicate frames
                # when setpts has stretched a clip's timing to need MORE
                # frames than the source decoded (observed directly: a 0.5x
                # slow-mo clip came out at its original un-slowed duration
                # with -r; an explicit fps filter fixes it).
                video_filter = ",".join(f for f in (canvas_filter, look_filter, speed_filter, "fps=24") if f)
                audio_speed_filter = _atempo_chain(speed) if speed != 1.0 and not is_photo else ""

                # -ar 44100 -ac 2 is forced on every segment's audio output
                # below regardless of source — mixing a real clip's native
                # rate (e.g. SadTalker's 16kHz) with anullsrc's 44100Hz in the
                # same concat produced a segment with a wildly wrong reported
                # duration (16.6s instead of 6s in testing) even though each
                # normalized file looked correct in isolation; forcing a
                # uniform rate on both branches fixed it.
                if is_photo:
                    # Stills have no intrinsic duration or audio — loop the
                    # single frame to fill the requested on-screen time.
                    cmd = [
                        "ffmpeg", "-y", "-loop", "1", "-i", src,
                        "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
                        "-t", str(clip_duration),
                        "-filter_complex", f"[0:v]{video_filter}[v]",
                        "-map", "[v]", "-map", "1:a",
                        "-c:v", "libx264", "-pix_fmt", "yuv420p",
                        "-c:a", "aac", "-ar", "44100", "-ac", "2", "-shortest",
                        norm_path,
                    ]
                else:
                    has_audio = await _has_audio_stream(src)
                    cmd = ["ffmpeg", "-y"]
                    if start:
                        cmd += ["-ss", str(start)]
                    # -t must precede its -i to be genuinely input-scoped (read
                    # only clip_duration seconds of SOURCE time) — an ffmpeg
                    # option only binds to a specific input when placed BEFORE
                    # that input's -i; placed after (even immediately after,
                    # with no other -i in between) it's an OUTPUT-duration
                    # limit instead, measured in the post-filter timebase.
                    # That silently no-oped setpts-based slow-mo entirely
                    # (confirmed directly: a 0.5x clip rendered at its
                    # original un-slowed length until this was fixed).
                    if end is not None:
                        cmd += ["-t", str(clip_duration)]
                    cmd += ["-i", src]
                    if not has_audio:
                        cmd += ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"]
                    audio_in = "0:a" if has_audio else "1:a"
                    filter_parts = [f"[0:v]{video_filter}[v]"]
                    if audio_speed_filter:
                        filter_parts.append(f"[{audio_in}]{audio_speed_filter}[a]")
                        audio_map = "[a]"
                    else:
                        audio_map = audio_in
                    cmd += [
                        "-filter_complex", ";".join(filter_parts),
                        "-map", "[v]", "-map", audio_map,
                        "-c:v", "libx264", "-pix_fmt", "yuv420p",
                        "-c:a", "aac", "-ar", "44100", "-ac", "2", "-shortest",
                        norm_path,
                    ]
                proc = await asyncio.create_subprocess_exec(
                    *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                )
                out, _ = await proc.communicate()
                if proc.returncode != 0 or not os.path.exists(norm_path):
                    _jobs[job_id].update(status="error", error=out.decode(errors="replace")[-2000:])
                    return
                normalized.append(norm_path)
                durations.append(on_timeline_duration)

            concat_out = os.path.join(tmp, "concat_out.mp4")
            uses_transitions = any(j.type != "cut" for j in junctions)

            if not uses_transitions:
                # Fast path: identical codec/canvas across all segments makes a
                # stream-copy concat safe — this is the common case (no
                # transitions requested) and stays as cheap as it was before.
                concat_list = os.path.join(tmp, "concat.txt")
                with open(concat_list, "w") as f:
                    for p in normalized:
                        escaped = p.replace("'", "'\\''")
                        f.write(f"file '{escaped}'\n")
                proc = await asyncio.create_subprocess_exec(
                    "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat_list,
                    "-c", "copy", concat_out,
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                )
                out, _ = await proc.communicate()
                if proc.returncode != 0 or not os.path.exists(concat_out):
                    _jobs[job_id].update(status="error", error=out.decode(errors="replace")[-2000:])
                    return
            else:
                # At least one real transition — chain xfade/acrossfade across
                # every junction instead (re-encode; concat demuxer can't cross-
                # fade). "offset" for each merge is measured against the running
                # merged stream's own timeline: offset_i = running - d_i, then
                # running becomes running + duration(clip_i) - d_i.
                cmd = ["ffmpeg", "-y"]
                for p in normalized:
                    cmd += ["-i", p]
                filters = []
                running = durations[0]
                v_label, a_label = "0:v", "0:a"
                for i in range(1, len(normalized)):
                    j = junctions[i - 1] if junctions else EditTransition()
                    xfade_type = j.type if j.type in _XFADE_TYPES else "fade"
                    d = max(j.duration, 0.05) if j.type != "cut" else 0.05
                    offset = max(running - d, 0)
                    v_out, a_out = f"v{i}", f"a{i}"
                    filters.append(f"[{v_label}][{i}:v]xfade=transition={xfade_type}:duration={d}:offset={offset}[{v_out}]")
                    filters.append(f"[{a_label}][{i}:a]acrossfade=d={d}[{a_out}]")
                    running = running + durations[i] - d
                    v_label, a_label = v_out, a_out
                cmd += [
                    "-filter_complex", ";".join(filters),
                    "-map", f"[{v_label}]", "-map", f"[{a_label}]",
                    "-c:v", "libx264", "-c:a", "aac",
                    concat_out,
                ]
                proc = await asyncio.create_subprocess_exec(
                    *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                )
                out, _ = await proc.communicate()
                if proc.returncode != 0 or not os.path.exists(concat_out):
                    _jobs[job_id].update(status="error", error=out.decode(errors="replace")[-2000:])
                    return

            # job_id suffix guarantees uniqueness even when two renders finish
            # within the same second — a bare timestamp let one silently
            # overwrite the other's output file on disk.
            dest = os.path.join(output_dir, f"edit_{time.strftime('%Y_%m_%d_%H.%M.%S')}_{job_id[:8]}.mp4")
            # When captions are being burned in, the audio-mixing stage below
            # writes to an intermediate file instead of `dest` directly, so
            # the subtitles pass afterward can read from it and produce the
            # true final output at `dest` — keeps `result_path=dest` valid
            # for every branch, captioned or not.
            has_captions = bool(captions_srt.strip())
            audio_dest = os.path.join(tmp, "audio_mixed.mp4") if has_captions else dest

            if not resolved_tracks and not mute_clip_audio:
                # No extra audio requested — pass the concatenated clips' own
                # audio straight through, no re-encode needed.
                shutil.copy2(concat_out, audio_dest)
            elif not resolved_tracks:
                # mute_clip_audio with nothing to mix in — swap the
                # concatenated video's own audio for silence of the same length.
                info = await _ffprobe_json(concat_out)
                video_duration = float(info.get("format", {}).get("duration") or sum(durations))
                proc = await asyncio.create_subprocess_exec(
                    "ffmpeg", "-y", "-i", concat_out,
                    "-t", str(video_duration), "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
                    "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", audio_dest,
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                )
                out, _ = await proc.communicate()
                if proc.returncode != 0 or not os.path.exists(audio_dest):
                    _jobs[job_id].update(status="error", error=out.decode(errors="replace")[-2000:])
                    return
            else:
                # One or more audio tracks — delay each to its own offset,
                # normalize sample rate/channel layout, apply its volume, then
                # mix everything together. A silent anchor input of exactly
                # video_duration is always included first in the amix input
                # list so the mixed output's length matches the video
                # regardless of whether the tracks run shorter or longer.
                info = await _ffprobe_json(concat_out)
                video_duration = float(info.get("format", {}).get("duration") or sum(durations))

                cmd = ["ffmpeg", "-y", "-i", concat_out]
                for path, _track in resolved_tracks:
                    cmd += ["-i", path]
                anchor_idx = len(resolved_tracks) + 1
                cmd += ["-t", str(video_duration), "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"]

                filters = []
                mix_inputs = [f"{anchor_idx}:a"]
                if not mute_clip_audio:
                    mix_inputs.append("0:a")
                for i, (_path, track) in enumerate(resolved_tracks):
                    in_idx = i + 1
                    end_expr = f":end={track.trim_end}" if track.trim_end is not None else ""
                    delay_ms = max(round(track.offset * 1000), 0)
                    out_label = f"t{i}"
                    filters.append(
                        f"[{in_idx}:a]atrim=start={track.trim_start or 0}{end_expr},"
                        f"asetpts=PTS-STARTPTS,"
                        f"aformat=sample_rates=44100:channel_layouts=stereo,"
                        f"adelay={delay_ms}:all=1,volume={track.volume}[{out_label}]"
                    )
                    mix_inputs.append(out_label)
                mix_in = "".join(f"[{m}]" for m in mix_inputs)
                # normalize=0 — amix's default (normalize=1) divides every input's
                # volume by the input count to prevent clipping, which stacks with
                # the per-track `volume=` above: with just one music track plus the
                # silent anchor (and the clip's own audio, if not muted) that's
                # already a 1/3 gain cut nobody asked for, on top of whatever volume
                # was set in the UI. The user already controls each track's level
                # explicitly, so amix should just sum them, not re-attenuate.
                filters.append(f"{mix_in}amix=inputs={len(mix_inputs)}:duration=first:dropout_transition=0:normalize=0[aout]")

                cmd += [
                    "-filter_complex", ";".join(filters),
                    "-map", "0:v", "-map", "[aout]",
                    "-c:v", "copy", "-c:a", "aac",
                    audio_dest,
                ]
                proc = await asyncio.create_subprocess_exec(
                    *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                )
                out, _ = await proc.communicate()
                if proc.returncode != 0 or not os.path.exists(audio_dest):
                    _jobs[job_id].update(status="error", error=out.decode(errors="replace")[-2000:])
                    return

            if has_captions:
                srt_path = os.path.join(tmp, "captions.srt")
                with open(srt_path, "w") as f:
                    f.write(captions_srt)
                # ffmpeg's filtergraph syntax treats ':' and "'" as special —
                # escape both so the subtitles filter's path argument survives.
                escaped_srt = srt_path.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")
                proc = await asyncio.create_subprocess_exec(
                    "ffmpeg", "-y", "-i", audio_dest,
                    "-vf", f"subtitles='{escaped_srt}'",
                    "-c:a", "copy", dest,
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                )
                out, _ = await proc.communicate()
                if proc.returncode != 0 or not os.path.exists(dest):
                    _jobs[job_id].update(status="error", error=out.decode(errors="replace")[-2000:])
                    return

            _jobs[job_id].update(status="done", result_path=dest)
        except Exception as e:
            _jobs[job_id].update(status="error", error=str(e))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    asyncio.create_task(_run())
    return {"job_id": job_id, "status": "queued"}


# ── Captions ──────────────────────────────────────────────────────────────────

def _srt_timestamp(t: float) -> str:
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = int(t % 60)
    ms = int(round((t - int(t)) * 1000))
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _segments_to_srt(segments: list) -> str:
    lines = []
    for i, seg in enumerate(segments, start=1):
        lines.append(str(i))
        lines.append(f"{_srt_timestamp(seg['start'])} --> {_srt_timestamp(seg['end'])}")
        lines.append(seg["text"].strip())
        lines.append("")
    return "\n".join(lines)


@router.post("/captions/jobs")
async def captions_start_job(
    video: UploadFile = File(...),
    model: str = Form("base"),
    burn_in: bool = Form(True),
):
    """POST /captions/jobs — transcribe an uploaded/exported clip with Whisper
    and either return the .srt (result_text) or a captioned mp4 with the
    subtitles burned in (result_path), depending on `burn_in`. Runs its own
    Whisper pass (reusing the same isolated whisper venv as /api/tools/whisper)
    rather than reusing that endpoint's job, since it needs per-segment
    timestamps and that endpoint only keeps the joined text."""
    if not os.path.exists(_WHISPER_SCRIPT):
        raise HTTPException(404, "Whisper wrapper script not found. Check scripts/run_whisper.py")
    if not os.path.exists(_WHISPER_PYTHON):
        raise HTTPException(
            404, f"Whisper env not set up — expected {_WHISPER_PYTHON}.")

    tmp = tempfile.mkdtemp()
    vid_ext = os.path.splitext(video.filename or "")[1] or ".mp4"
    vid_path = os.path.join(tmp, f"video_{uuid.uuid4().hex}{vid_ext}")
    with open(vid_path, "wb") as f:
        shutil.copyfileobj(video.file, f)

    output_dir = os.path.join(BASE_DIR, "triggers", "gpu_watch", "captions_output")
    os.makedirs(output_dir, exist_ok=True)

    job_id = _new_job("captions")

    async def _run():
        try:
            async with gpu_queue.acquire(job_id):
                _jobs[job_id]["status"] = "running"
                proc = await asyncio.create_subprocess_exec(
                    "python3", _WHISPER_SCRIPT, vid_path,
                    "--model", model,
                    "--output_dir", tmp,
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                )
                out, _ = await proc.communicate()
            log = out.decode(errors="replace")
            if proc.returncode != 0:
                _jobs[job_id].update(status="error", error=log[-2000:])
                return
            result_line = next((l for l in log.splitlines() if l.startswith("RESULT_PATH=")), None)
            result_path = result_line.split("=", 1)[1] if result_line else None
            if not result_path or not os.path.exists(result_path):
                _jobs[job_id].update(status="error", error="Whisper finished but produced no transcript.")
                return
            with open(result_path) as f:
                data = json.load(f)
            srt_text = _segments_to_srt(data.get("segments", []))

            if not burn_in:
                _jobs[job_id].update(status="done", result_text=srt_text)
                return

            srt_path = os.path.join(tmp, "captions.srt")
            with open(srt_path, "w") as f:
                f.write(srt_text)
            # job_id suffix guarantees uniqueness even when two renders finish
            # within the same second — a bare timestamp let one silently
            # overwrite the other's output file on disk.
            dest = os.path.join(output_dir, f"captioned_{time.strftime('%Y_%m_%d_%H.%M.%S')}_{job_id[:8]}.mp4")
            # ffmpeg's filtergraph syntax treats ':' and "'" as special —
            # escape both so the subtitles filter's path argument survives.
            escaped_srt = srt_path.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")
            proc2 = await asyncio.create_subprocess_exec(
                "ffmpeg", "-y", "-i", vid_path,
                "-vf", f"subtitles='{escaped_srt}'",
                "-c:a", "copy", dest,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
            )
            out2, _ = await proc2.communicate()
            if proc2.returncode != 0 or not os.path.exists(dest):
                _jobs[job_id].update(status="error", error=out2.decode(errors="replace")[-2000:])
                return
            _jobs[job_id].update(status="done", result_path=dest, result_text=srt_text)
        except Exception as e:
            _jobs[job_id].update(status="error", error=str(e))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    asyncio.create_task(_run())
    return {"job_id": job_id, "status": "queued"}
