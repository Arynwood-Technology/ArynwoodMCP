# Studio setup and working roadmap

Music Lab is Tier 2; stem separation, RVC and audio FX are Tier 3.
The roadmap below is a working list, not a scope commitment.
TODO(Lorelei): reconcile this older implementation-status table with current source.
The old https://github.com/arynwood/MusicStudio link returned 404 on 2026-10-24;
TODO(Lorelei): supply a public MusicStudio source/setup location.

### One-time venv setup

Each sidecar needs its own Python virtual environment. These are set up once in the MusicStudio directory at `~/GitHub/MusicStudio`.

#### audio-fx sidecar (port 8002)

Provides: Pedalboard effects, Matchering mastering, Basic Pitch MIDI transcription, librosa BPM/chord analysis.

> **Must use Python 3.11** - Basic Pitch requires tensorflow <2.15.1 which tops out at Python 3.11.

```bash
cd ~/GitHub/MusicStudio
python3.11 -m venv sidecars/audio-fx/venv
source sidecars/audio-fx/venv/bin/activate
pip install setuptools<70
pip install -r sidecars/audio-fx/requirements.txt
```

Note: install `pedalboard>=0.7.7,<0.9.0` - newer versions require AVX2 CPU instructions and may fail on some hardware.

#### stem-sep sidecar (port 8004)

Provides: Demucs v4 stem separation, Spleeter (2/4/6 stems).

```bash
cd ~/GitHub/MusicStudio
python3 -m venv sidecars/stem-sep/venv
source sidecars/stem-sep/venv/bin/activate
pip install -r sidecars/stem-sep/requirements.txt
```

Demucs downloads model weights (~1.5 GB) on the first separation job - this is automatic.

#### voice sidecar (port 8001)

Provides: RVC v3 voice conversion.

> **Must use Python 3.11** - rvc-python pins numpy ≤1.23.5 and fairseq == 0.12.2, neither builds on Python 3.12.

```bash
cd ~/GitHub/MusicStudio
python3.11 -m venv sidecars/voice/venv
source sidecars/voice/venv/bin/activate
pip install "pip<24.1"
pip install -r sidecars/voice/requirements.txt
```

Voice models are not included - import your own trained RVC `.pth` checkpoints via the Studio → Voice Conversion tab.

#### video-ai sidecar (port 8005)

Provides: faster-whisper captions, silence/auto-cut detection.

```bash
cd ~/GitHub/MusicStudio
python3 -m venv sidecars/video-ai/venv
source sidecars/video-ai/venv/bin/activate
pip install -r sidecars/video-ai/requirements.txt
```

#### song-gen sidecar (port 8003)

Provides: AI music generation - ACE-Step v1 (text-to-music, Apache-2.0) and MusicGen (also melody-conditioned generation, CC-BY-NC 4.0 - **non-commercial use only**).

> **Two separate venvs, not one.** MusicGen's own torch pin (2.1.x) is incompatible with the torch 2.10.x ACE-Step needs - installing both into one venv breaks ACE-Step outright. `setup_song_gen.sh` builds `venv/` (ACE-Step) and `venv-musicgen/` (MusicGen) separately; MusicGen runs as a subprocess dispatched from the main sidecar process, not imported in-process.

```bash
cd ~/GitHub/MusicStudio/sidecars/song-gen
./setup_song_gen.sh                  # base only - sidecar starts, both providers report installed:false
./setup_song_gen.sh --with-acestep   # + ACE-Step v1 checkpoint (multi-GB download, confirmed before starting)
./setup_song_gen.sh --with-musicgen  # + MusicGen checkpoint (~1.2GB, confirmed before starting)
```

Neither model downloads automatically - each `--with-*` flag prints what it's about to fetch and asks for confirmation first. See `MusicStudio/CLAUDE.md`'s song-gen section for the full setup history (the exact torch/torchcodec/numpy/transformers pins needed, all hands-on-verified against a real generation).

### Starting sidecars

**From the UI:** Open Studio → sidecar status bar at the top → click ▶ next to any stopped sidecar. The backend launches it as a background subprocess and polls `/health` until it responds.

**Manually (for debugging output):**
```bash
cd ~/GitHub/MusicStudio

# Run each in a separate terminal with its venv active:
source sidecars/audio-fx/venv/bin/activate && PORT=8002 python3 sidecars/audio-fx/main.py
source sidecars/stem-sep/venv/bin/activate && PORT=8004 python3 sidecars/stem-sep/main.py
source sidecars/voice/venv/bin/activate   && PORT=8001 python3 sidecars/voice/main.py
source sidecars/video-ai/venv/bin/activate && PORT=8005 python3 sidecars/video-ai/main.py
source sidecars/song-gen/venv/bin/activate && PORT=8003 python3 sidecars/song-gen/main.py
```

### What's built and what isn't

| Feature | Sidecar | Status | Notes |
|---------|---------|--------|-------|
| Stem Separation (Demucs/Spleeter) | stem-sep :8004 | ✅ Done | 2/4/6 stems, engine choice, inline playback |
| Voice Conversion (RVC) | voice :8001 | ✅ Done | Import .pth models, convert audio, pitch shift |
| Effects Rack (6 effects, chaining) | audio-fx :8002 | ✅ Done | Reverb, Comp, Chorus, Delay, Distortion, EQ |
| Reference Mastering (Matchering) | audio-fx :8002 | ⬜ Not ported | Source: `MasterPanel.svelte` |
| BPM & Chord Analysis (librosa) | audio-fx :8002 | ⬜ Not ported | Source: `MasterPanel.svelte` (analyzeAudio) |
| Audio → MIDI Transcription (Basic Pitch) | audio-fx :8002 | ⬜ Not ported | Source: `Transcribe.svelte` |
| Whisper Captions / Auto-cut | video-ai :8005 | ⬜ Not ported | Source: `Captions.svelte` |
| Timeline / Track Arranger | none (browser) | ⬜ Not ported | Source: `Timeline.svelte`, uses WaveSurfer.js |
| Transport (Play/Pause/Stop/BPM) | none (browser) | ⬜ Not ported | Source: `Transport.svelte`, uses Tone.js |
| Piano Roll (MIDI editor) | none (browser) | ⬜ Not ported | Source: `PianoRoll.svelte`, uses @tonejs/midi |
| AI Instrument Generation (ACE-Step / MusicGen) | song-gen :8003 | ✅ Done | Text-to-music from structured fields; results land in the shared asset library |
| Jam with AI (melody-conditioned response) | song-gen :8003 | ✅ Done | MusicGen only - see the melody-conditioning caveat under [Jam with AI](features.md#jam-with-ai); response is always a separate asset, never merged |
| Stems → shared asset library | song-gen + stem-sep | ✅ Backend, ⬜ not wired to UI | `POST /api/music/stems` persists each stem as a reusable asset with source lineage; `StemSeparator.tsx` above still only calls the original `/api/studio/stems`, which stays ephemeral |

### What to build next

**Mastering + Analysis tab** (audio-fx sidecar already running, no new backend work needed)
- Port `MasterPanel.svelte` → `frontend/src/components/studio/Mastering.tsx`
- Two file pickers (target track + reference track)
- POST both to `/api/studio/effects/master` (already wired) → download mastered WAV
- GET `/api/studio/effects/analyze` → show BPM and chord detection results (need to add backend endpoint proxying `:8002/analyze`)

**Transcribe tab** (audio-fx sidecar already running)
- Add backend endpoint: `POST /api/studio/effects/transcribe` → proxies to `:8002/transcribe/basic` or `/transcribe/multitrack`, returns MIDI blob
- Port `Transcribe.svelte` → `frontend/src/components/studio/Transcribe.tsx`
- Install `npm install @tonejs/midi` in `frontend/` to parse and display note count
- Output: MIDI file download + note count display

**Timeline + Transport** (no sidecar - pure browser audio)
1. `cd frontend && npm install tone wavesurfer.js`
2. Copy `MusicStudio/src/lib/audio/engine.ts` → `frontend/src/lib/audio/engine.ts` verbatim (already pure TypeScript, no Tauri dependencies)
3. Port `Transport.svelte` → `frontend/src/components/studio/Transport.tsx`
   - Replace Svelte `$store` → `useState` / `useEffect`
   - Same logic, same BPM/position display
4. Port `Timeline.svelte` → `frontend/src/components/studio/Timeline.tsx`
   - Replace Tauri `open()` → `<input type="file" ref>` with `.click()`
   - Replace `convertFileSrc(path)` → `URL.createObjectURL(file)` (the browser equivalent)
   - Replace Tauri `invoke('probe_media_duration')` → a new backend endpoint `GET /api/studio/probe?url=...` using ffprobe
   - WaveSurfer.js API is identical between web and Tauri (it's a web library)

**Piano Roll** (no sidecar - pure browser)
1. `cd frontend && npm install @tonejs/midi`
2. Add a Zustand slice for MIDI state (port `midiStore` from Svelte)
3. Port `PianoRoll.svelte` → `frontend/src/components/studio/PianoRoll.tsx`
