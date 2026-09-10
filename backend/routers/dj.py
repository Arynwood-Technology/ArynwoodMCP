"""
DJ Toolkit router — launcher + built-in manual for the native Linux DJ/production
stack (Mixxx, Ardour, Hydrogen, Surge XT, Vital, Flatseal, Calf/LSP/Dragonfly,
Geonkick). Unlike tools.py's TOOLS (web-UI services proxied over HTTP) or
studio.py's SIDECARS (backend-managed Python subprocesses with a /health
endpoint), these are desktop GUI apps with no HTTP surface at all — status is
read by asking the OS what's running (`flatpak ps` for Flatpak apps, `pgrep`
for native binaries), and "launch" just spawns the app and forgets it.

Content (descriptions/quickstart/tips) is sourced from this machine's own
DJ/README.md and DJ/techno-learning-plan.md — install state and free-tier
claims there were verified firsthand, not guessed.
"""

import asyncio
import os
import subprocess
from fastapi import APIRouter, HTTPException

router = APIRouter()

# Local reference docs this router can open on request (xdg-open, same idiom as
# tools.py's /open). Paths are outside this repo — the DJ project lives in a
# separate working directory on this machine.
_DJ_PROJECT_DIR = os.path.expanduser("~/Desktop/Music Album/DJ")
REFERENCE_DOCS = {
    "readme": {
        "label": "DJ Toolkit README",
        "description": "What's installed on this machine and day-to-day launch commands.",
        "path": os.path.join(_DJ_PROJECT_DIR, "README.md"),
    },
    "learning_plan": {
        "label": "8-Week Learning Plan",
        "description": "Full techno DJ + production curriculum: skills in order, free tutorials, sample packs, weekly milestones.",
        "path": os.path.join(_DJ_PROJECT_DIR, "techno-learning-plan.md"),
    },
}

# Each entry: id -> tool metadata + manual content.
#   kind: "flatpak" | "binary" | "plugin"
#     flatpak — launched via `flatpak run <app_id>`, status via `flatpak ps`
#     binary  — launched via the bare command, status via `pgrep -x`
#     plugin  — no standalone launcher; loads inside a host DAW (Ardour)
#   standalone: for synths that are both a plugin AND a standalone app
DJ_TOOLS: dict[str, dict] = {
    "mixxx": {
        "name": "Mixxx", "version": "2.5.6", "category": "dj",
        "role": "DJ mixing — beatmatching, EQ blending, live sets",
        "description": "Two-deck+ DJ mixing software with waveform display, headphone cueing, "
                        "3-band EQ, looping, and library management (crates, BPM/key analysis, cue points). "
                        "The only actively-maintained DJ application with genuine native Linux support.",
        "kind": "flatpak", "app_id": "org.mixxx.Mixxx",
        "launch_cmd": ["flatpak", "run", "org.mixxx.Mixxx"],
        "manual_url": "https://manual.mixxx.org/2.5/en/chapters/djing_with_mixxx.html",
        "manual_label": "Mixxx Manual — DJing With Mixxx",
        "quickstart": [
            "Drag tracks from the file browser panel (left side) into Deck 1 and Deck 2.",
            "Use each deck's headphone-cue icon to preview a track before bringing it into the main mix.",
            "Practice with Sync OFF first — manual beatmatching by ear is the core skill. Turn Sync on later, once you don't need it.",
            "Your track library isn't in the DJ project folder — Mixxx keeps its own library DB. Import from ~/Music or ~/Downloads.",
        ],
        "tips": [
            "Skill order: waveform reading + manual beatmatching -> phrase matching (8/16/32-bar counts) -> "
            "3-band EQ blending (bass-swap transitions — the actual techno-DJ technique, not just crossfading) "
            "-> long/quick transitions -> a tagged, crated library -> reading set energy.",
            "Flatpak sandbox override already applied on this machine so ~/Downloads is visible: "
            "flatpak override --user --filesystem=xdg-download:ro org.mixxx.Mixxx",
            "Launch with tracks preloaded into both decks: flatpak run org.mixxx.Mixxx track1.mp3 track2.mp3",
        ],
    },
    "ardour": {
        "name": "Ardour", "version": "9.7.0", "category": "daw",
        "role": "DAW — arrangement, mixing, automation, export",
        "description": "Full production DAW. Genuinely free with no track/feature limits via this Flathub build "
                        "(the official ardour.org binary nags for a donation or mutes audio after 10 min — Flathub's doesn't).",
        "kind": "flatpak", "app_id": "org.ardour.Ardour",
        "launch_cmd": ["flatpak", "run", "org.ardour.Ardour"],
        "quickstart": [
            "Program drum patterns in Hydrogen first, then build the rest of the arrangement, automation, mixing and export here.",
            "Hit play in either Ardour or Hydrogen and both start together — shared transport over PipeWire's JACK layer, no manual routing.",
            "If a newly-installed plugin doesn't show up: Window -> Plugin Manager -> rescan.",
        ],
        "tips": [
            "Flatpak sandboxing can hide ~/.vst3 / ~/.lv2 plugins from Ardour. Fixed on this machine via: "
            "flatpak override --user --filesystem=home/.vst3:ro --filesystem=home/.lv2:ro org.ardour.Ardour — "
            "re-run after installing a new plugin folder Ardour still can't see.",
            "Calf, LSP, and Dragonfly Reverb are installed as system LV2 packages (apt), so Ardour finds them with no override needed.",
            "Techno arrangement shape: intro -> build -> drop/peak -> breakdown -> outro, in 8/16-bar blocks.",
        ],
    },
    "hydrogen": {
        "name": "Hydrogen", "version": "1.2.6", "category": "daw",
        "role": "Drum machine / pattern sequencer",
        "description": "Standalone pattern-based drum machine — the primary tool for programming techno grooves: "
                        "4-on-the-floor kicks, off-beat hats, clap/percussion layering, swing.",
        "kind": "flatpak", "app_id": "org.hydrogenmusic.Hydrogen",
        "launch_cmd": ["flatpak", "run", "org.hydrogenmusic.Hydrogen"],
        "quickstart": [
            "Program a basic 4-on-the-floor kick + closed-hat pattern in the pattern editor to start.",
            "Layer claps/snares and other percussion once the kick+hat groove feels right.",
            "Export the pattern/song and continue arranging it in Ardour — both share transport automatically.",
        ],
        "tips": [
            "Groove refinement (swing, velocity variation, micro-timing) is what separates a flat loop from a groovy one — "
            "revisit a pattern after the rest of the arrangement exists, not just once.",
        ],
    },
    "surge_xt": {
        "name": "Surge XT", "version": "1.3.4", "category": "synth",
        "role": "Synth — basslines & leads (VST3/CLAP/standalone)",
        "description": "Deep subtractive/hybrid synthesis, a strong all-rounder for techno basslines and pads.",
        "kind": "flatpak", "app_id": "org.surge_synth_team.surge-xt", "standalone": True,
        "launch_cmd": ["flatpak", "run", "org.surge_synth_team.surge-xt"],
        "tutorial_url": "https://www.youtube.com/c/loopop",
        "tutorial_label": "Sound design deep-dives (loopop)",
        "quickstart": [
            "Run standalone for quick sound design/noodling, or load it as a plugin on an Ardour track for a real bassline.",
            "Learn subtractive synthesis fundamentals here (oscillators, filters, envelopes) — the same fundamentals carry over to Vital.",
        ],
        "tips": [],
    },
    "vital": {
        "name": "Vital", "version": "1.6.4", "category": "synth",
        "role": "Synth — wavetable, leads & basslines (VST3/LV2/standalone)",
        "description": "Wavetable synth, excellent for modulated leads and basslines. The free 'Basic' tier is permanent, "
                        "not a trial — full synth engine, just fewer bundled presets/wavetables than the paid tiers.",
        "kind": "binary", "bin": "Vital", "standalone": True,
        "launch_cmd": ["Vital"],
        "manual_url": "https://vital.audio/",
        "manual_label": "vital.audio",
        "tutorial_url": "https://www.youtube.com/c/loopop",
        "tutorial_label": "Sound design deep-dives (loopop)",
        "quickstart": [
            "Run standalone for sound design, or load it as a plugin inside Ardour.",
            "Reinstalling is manual only — the developer blocks scripted downloads — grab the .deb from vital.audio again, not a package manager.",
        ],
        "tips": [],
    },
    "geonkick": {
        "name": "Geonkick", "version": None, "category": "synth",
        "role": "Percussion synth — kicks, claps, hats (VST3/LV2/standalone)",
        "description": "Purpose-built percussion synthesizer (not sample-based) for designing kicks, claps and hats from scratch.",
        "kind": "binary", "bin": "geonkick", "standalone": True,
        "launch_cmd": ["geonkick"],
        "quickstart": [
            "Run standalone to design a kick/clap/hat from scratch, or drop it directly onto a drum track in Ardour as a plugin.",
        ],
        "tips": [],
    },
    "flatseal": {
        "name": "Flatseal", "version": "2.4.1", "category": "utility",
        "role": "Utility — Flatpak sandbox permissions GUI",
        "description": "GUI for adjusting what a Flatpak app can see on disk. Reach for this the moment a Flatpak app "
                        "(Ardour, Mixxx) can't see a folder, drive, or plugin directory it should.",
        "kind": "flatpak", "app_id": "com.github.tchx84.Flatseal",
        "launch_cmd": ["flatpak", "run", "com.github.tchx84.Flatseal"],
        "quickstart": [
            "Open Flatseal, pick the app (e.g. Ardour) from the list, then add or edit its Filesystem permissions.",
            "CLI equivalent, for one-off overrides: flatpak override --user --filesystem=/path/to/folder:ro org.example.App",
        ],
        "tips": [
            "Already applied on this machine: Ardour -> ~/.vst3 and ~/.lv2 (read-only); Mixxx -> ~/Downloads (read-only).",
        ],
    },
    "calf": {
        "name": "Calf Studio Gear", "version": None, "category": "plugin",
        "role": "Plugin — EQ / compression / mixing (LV2)",
        "description": "EQ, compressor, multiband, limiter, gate. Installed as a system LV2 package (apt), "
                        "so Ardour finds it automatically with no sandbox override needed.",
        "kind": "plugin", "host": "ardour",
        "quickstart": ["Open Ardour and add it to a track or bus from the plugin browser — nothing to launch separately."],
        "tips": [],
    },
    "lsp": {
        "name": "LSP Plugins", "version": None, "category": "plugin",
        "role": "Plugin — dynamics / filters / reverb (LV2/VST3)",
        "description": "Comprehensive dynamics, filter, and impulse-reverb suite. Installed as a system LV2 package.",
        "kind": "plugin", "host": "ardour",
        "quickstart": ["Open Ardour and add it to a track or bus from the plugin browser — nothing to launch separately."],
        "tips": [],
    },
    "dragonfly_reverb": {
        "name": "Dragonfly Reverb", "version": None, "category": "plugin",
        "role": "Plugin — reverb (LV2/VST3)",
        "description": "Clean, low-CPU reverb for space and depth. Installed as a system LV2 package.",
        "kind": "plugin", "host": "ardour",
        "quickstart": ["Open Ardour and add it to a track or bus from the plugin browser — nothing to launch separately."],
        "tips": [],
    },
}

# "Way of starting" — bundles that launch more than one tool at once, for the
# handful of workflows that actually need it (Ardour+Hydrogen's shared transport
# is the whole point of that pairing; the others are just one-click conveniences).
SESSIONS: dict[str, dict] = {
    "dj_mixing": {
        "label": "DJ Mixing Session",
        "description": "Beatmatching practice or a live mix.",
        "tool_ids": ["mixxx"],
    },
    "production": {
        "label": "Production Session",
        "description": "Ardour + Hydrogen together — shared transport over PipeWire/JACK, hit play in either and both start.",
        "tool_ids": ["ardour", "hydrogen"],
    },
    "sound_design": {
        "label": "Sound Design Session",
        "description": "Surge XT + Vital standalone, for patch noodling before dropping a sound into Ardour.",
        "tool_ids": ["surge_xt", "vital"],
    },
}


# ── Status ───────────────────────────────────────────────────────────────────

async def _flatpak_running_ids() -> set[str]:
    try:
        proc = await asyncio.create_subprocess_exec(
            "flatpak", "ps", "--columns=application",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
        out, _ = await proc.communicate()
        return {line.strip() for line in out.decode().splitlines() if line.strip()}
    except FileNotFoundError:
        return set()


async def _binary_running(bin_name: str) -> bool:
    try:
        proc = await asyncio.create_subprocess_exec(
            "pgrep", "-x", bin_name,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        )
        code = await proc.wait()
        return code == 0
    except FileNotFoundError:
        return False


async def _tool_status(tool_id: str, info: dict, flatpak_running: set[str]) -> str:
    if info["kind"] == "plugin":
        return "plugin"
    if info["kind"] == "flatpak":
        return "running" if info["app_id"] in flatpak_running else "stopped"
    if info["kind"] == "binary":
        return "running" if await _binary_running(info["bin"]) else "stopped"
    return "unknown"


def _public_tool(tool_id: str, info: dict, status: str) -> dict:
    return {
        "id": tool_id,
        "name": info["name"],
        "version": info.get("version"),
        "category": info["category"],
        "role": info["role"],
        "description": info["description"],
        "kind": info["kind"],
        "standalone": info.get("standalone", info["kind"] != "plugin"),
        "host": info.get("host"),
        "launchable": info.get("launch_cmd") is not None,
        "manual_url": info.get("manual_url"),
        "manual_label": info.get("manual_label"),
        "tutorial_url": info.get("tutorial_url"),
        "tutorial_label": info.get("tutorial_label"),
        "quickstart": info.get("quickstart", []),
        "tips": info.get("tips", []),
        "status": status,
    }


@router.get("/tools")
async def list_dj_tools():
    """GET /dj/tools — every registered DJ/production tool with live running status."""
    flatpak_running = await _flatpak_running_ids()
    statuses = await asyncio.gather(*[
        _tool_status(tid, info, flatpak_running) for tid, info in DJ_TOOLS.items()
    ])
    return [_public_tool(tid, info, status) for (tid, info), status in zip(DJ_TOOLS.items(), statuses)]


@router.get("/tools/{tool_id}")
async def get_dj_tool(tool_id: str):
    """GET /dj/tools/{id} — full manual + live status for a single tool."""
    if tool_id not in DJ_TOOLS:
        raise HTTPException(404, "Unknown DJ tool")
    info = DJ_TOOLS[tool_id]
    flatpak_running = await _flatpak_running_ids() if info["kind"] == "flatpak" else set()
    status = await _tool_status(tool_id, info, flatpak_running)
    return _public_tool(tool_id, info, status)


# ── Launch ───────────────────────────────────────────────────────────────────

def _spawn(cmd: list[str]) -> int:
    # start_new_session detaches the child from this process's session, so a
    # `--reload` restart of the backend (or the backend exiting entirely)
    # doesn't take a running Ardour/Mixxx instance down with it — these are
    # user-facing GUI apps meant to outlive the API server, unlike studio.py's
    # sidecars which are deliberately tied to backend lifecycle.
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    return proc.pid


@router.post("/tools/{tool_id}/launch")
async def launch_dj_tool(tool_id: str):
    """POST /dj/tools/{id}/launch — spawn the tool's GUI app (fire-and-forget)."""
    if tool_id not in DJ_TOOLS:
        raise HTTPException(404, "Unknown DJ tool")
    info = DJ_TOOLS[tool_id]
    cmd = info.get("launch_cmd")
    if not cmd:
        raise HTTPException(400, f"{info['name']} has no standalone launcher — it loads as a plugin inside {info.get('host', 'a host DAW')}.")
    try:
        pid = _spawn(cmd)
    except FileNotFoundError:
        raise HTTPException(500, f"Launch command not found: {' '.join(cmd)}")
    return {"launched": True, "tool_id": tool_id, "pid": pid}


@router.get("/sessions")
async def list_sessions():
    """GET /dj/sessions — bundle definitions for the 'start a session' shortcuts."""
    return [{"id": sid, **sess} for sid, sess in SESSIONS.items()]


@router.post("/sessions/{session_id}/start")
async def start_session(session_id: str):
    """POST /dj/sessions/{id}/start — launch every tool in a session bundle, skipping any already running."""
    if session_id not in SESSIONS:
        raise HTTPException(404, "Unknown session")
    flatpak_running = await _flatpak_running_ids()
    results = []
    for tool_id in SESSIONS[session_id]["tool_ids"]:
        info = DJ_TOOLS[tool_id]
        status = await _tool_status(tool_id, info, flatpak_running)
        if status == "running":
            results.append({"tool_id": tool_id, "launched": False, "reason": "already running"})
            continue
        try:
            pid = _spawn(info["launch_cmd"])
            results.append({"tool_id": tool_id, "launched": True, "pid": pid})
        except FileNotFoundError:
            results.append({"tool_id": tool_id, "launched": False, "reason": "launch command not found"})
    return {"session_id": session_id, "results": results}


# ── Reference docs ───────────────────────────────────────────────────────────

@router.get("/docs")
async def list_reference_docs():
    """GET /dj/docs — reference docs this router can open on the desktop."""
    return [
        {"id": did, "label": d["label"], "description": d["description"], "exists": os.path.isfile(d["path"])}
        for did, d in REFERENCE_DOCS.items()
    ]


@router.post("/docs/{doc_id}/open")
async def open_reference_doc(doc_id: str):
    """POST /dj/docs/{id}/open — open a local markdown reference doc in the desktop's default app."""
    if doc_id not in REFERENCE_DOCS:
        raise HTTPException(404, "Unknown reference doc")
    path = REFERENCE_DOCS[doc_id]["path"]
    if not os.path.isfile(path):
        raise HTTPException(404, f"File not found: {path}")
    await asyncio.create_subprocess_exec("xdg-open", path)
    return {"opened": path}
