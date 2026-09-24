// Canned data for the GitHub Pages demo build. Shapes match the real backend responses
// exactly (see frontend/src/lib/api.ts's interfaces) so every page renders identically to
// a real install. Persona id/name/role/model are the real, public values from
// mcp/config/models.json — that file's system prompts stay private; nothing here quotes
// them, only the same non-sensitive fields /api/chat/personas already exposes.
import type {
  Persona, SystemStatus, Server, Tool, Conversation, Message,
  CheckpointList, ModelFileList, KnowledgeStatus, KnowledgeSource, Sidecar, McpServerInfo, GpuQueue,
  DjTool, DjSession, MusicProviderCapability,
} from '../api'

export const PERSONAS: Persona[] = [
  { id: 'central', name: 'Arynwood', role: 'MCP Interface and Coordinator', model: 'qwen2.5-coder:14b' },
  { id: 'doc', name: 'Doc', role: 'Senior Mentor and Technical Architect', model: 'qwen2.5-coder:14b' },
  { id: 'kona', name: 'Kona', role: 'Creative AI Assistant', model: 'hermes3:8b' },
  { id: 'glyph', name: 'Glyph', role: 'Automation Expert and Data Bot', model: 'qwen2.5-coder:14b' },
  { id: 'estra', name: 'Estra', role: 'Writer, Editor, Fact-checker', model: 'qwen2.5-coder:14b' },
]

export const STATUS: SystemStatus = {
  ollama: true,
  tortoise_tts: true,
  stable_diffusion: true,
  prometheus: true,
  gpu: {
    available: true,
    name: 'NVIDIA GeForce RTX 3060',
    temp: '52',
    utilization: '18',
    memory_used: '3421',
    memory_total: '12288',
  },
  platform: 'Linux',
  can_restart: false, // matches the real value in a packaged build — this demo isn't one, but "no restart button" is the honest answer here too
}

export const GPU_QUEUE: GpuQueue = { running: null, depth: 0, waiting: [] }

export const SERVERS: Server[] = [
  {
    id: 1, name: 'Local Ollama', host: 'localhost', port: 11434, type: 'ollama',
    enabled: 1, created_at: '2026-01-01 00:00:00',
  },
]

export const TOOLS: Tool[] = [
  { id: 'stable_diffusion', name: 'Stable Diffusion (A1111)', description: 'Image generation', type: 'gpu', category: 'image', port: 7860, status: 'online' },
  { id: 'tortoise_tts', name: 'TortoiseTTS', description: 'Text-to-speech', type: 'gpu', category: 'audio', port: 5003, status: 'online' },
  { id: 'rembg', name: 'Background Removal', description: 'Remove image backgrounds', type: 'gpu', category: 'image', status: 'available' },
  { id: 'realesrgan', name: 'Real-ESRGAN', description: 'Image upscaling', type: 'gpu', category: 'image', status: 'available' },
  { id: 'searxng', name: 'SearXNG', description: 'Private web search', type: 'service', category: 'search', status: 'online' },
  { id: 'qdrant', name: 'Qdrant', description: 'Vector database', type: 'service', category: 'storage', status: 'online' },
]

export const CHECKPOINTS: CheckpointList = {
  files: [
    { filename: 'sd_xl_base_1.0.safetensors', size_bytes: 6_938_078_334, modified_at: 1_735_000_000, known: true, style: 'photoreal' },
    { filename: 'dreamshaper_8.safetensors', size_bytes: 2_132_625_894, modified_at: 1_735_100_000, known: true, style: 'illustrated' },
  ],
  missing_from_styles: [],
  total_bytes: 6_938_078_334 + 2_132_625_894,
}

export const LORAS: ModelFileList = {
  files: [
    { filename: 'phosphor-noir-v1.safetensors', size_bytes: 151_000_000, modified_at: 1_735_200_000 },
  ],
  total_bytes: 151_000_000,
}

export const OLLAMA_MODELS = [
  { name: 'qwen2.5-coder:14b', size: 9_012_345_678, digest: 'sha256:demo1', modified_at: '2026-08-01T00:00:00Z', details: { parameter_size: '14B', quantization_level: 'Q4_K_M' } },
  { name: 'hermes3:8b', size: 4_912_345_678, digest: 'sha256:demo2', modified_at: '2026-08-01T00:00:00Z', details: { parameter_size: '8B', quantization_level: 'Q4_K_M' } },
  { name: 'nomic-embed-text', size: 274_000_000, digest: 'sha256:demo3', modified_at: '2026-08-01T00:00:00Z', details: { parameter_size: '137M', quantization_level: 'F16' } },
]

export const KNOWLEDGE_STATUS: KnowledgeStatus = {
  qdrant: { online: true, collection_ready: true },
  embedding_model: 'nomic-embed-text',
  embedding_model_available: true,
}

export const KNOWLEDGE_SOURCES: KnowledgeSource[] = [
  { id: 1, title: 'Project style guide', source: 'style-guide.md', source_type: 'file', chunk_count: 14, added_by: 'central', created_at: '2026-08-01 00:00:00', version: 1, superseded_by: null },
  { id: 2, title: 'Kdenlive MCP tool reference', source: 'kdenlive.md', source_type: 'file', chunk_count: 22, added_by: 'central', created_at: '2026-08-03 00:00:00', version: 1, superseded_by: null },
]

export const MCP_SERVERS: McpServerInfo[] = [
  { name: 'Kdenlive', url: 'http://127.0.0.1:8420/mcp' },
]

// All four "running" — this demo genuinely processes real audio (Effects Rack, Voice
// Conversion's pitch-shift, Stem Separator's frequency split all run real Web Audio DSP;
// Instrument Generator/Jam with AI/Vocal Booth's script-to-voice synthesize a real
// placeholder clip) rather than showing a permanent "sidecar not running" wall.
export const SIDECARS: Record<string, Sidecar> = {
  'song-gen': { id: 'song-gen', label: 'Song Generation', port: 8003, status: 'running' },
  'stem-sep': { id: 'stem-sep', label: 'Stem Separator', port: 8004, status: 'running' },
  'voice': { id: 'voice', label: 'Voice Conversion', port: 8001, status: 'running' },
  'audio-fx': { id: 'audio-fx', label: 'Effects Rack', port: 8002, status: 'running' },
}

export const MUSIC_PROVIDERS: MusicProviderCapability[] = [
  {
    id: 'acestep', label: 'ACE-Step', installed: true, message: null, license: 'Apache-2.0',
    supports: { text_to_music: true, instrumental: true, audio_conditioning: false, continuation: false, melody_conditioning: false },
    max_duration_seconds: 30, vram_estimate_gb: 6,
  },
  {
    id: 'musicgen', label: 'MusicGen', installed: true, message: null, license: 'CC-BY-NC-4.0',
    supports: { text_to_music: true, instrumental: true, audio_conditioning: true, continuation: true, melody_conditioning: true },
    max_duration_seconds: 30, vram_estimate_gb: 4,
  },
]

export const VOICE_MODELS: { name: string; has_index: boolean }[] = [
  { name: 'demo-narrator', has_index: true },
  { name: 'demo-character', has_index: false },
]

// Chat: one seed conversation so the sidebar isn't empty on first load. Its messages are
// intentionally the opening exchange of the Glyph approval scenario (see chatScenarios.ts)
// so a visitor who never sends a message still sees what a real exchange looks like.
export const SEED_CONVERSATION: Conversation = {
  id: 1,
  title: 'Clean up my timeline',
  persona: 'glyph',
  model: 'qwen2.5-coder:14b',
  server_id: 1,
  created_at: '2026-09-20 14:02:00',
  updated_at: '2026-09-20 14:02:41',
}

export const SEED_MESSAGES: Message[] = [
  { id: 1, conversation_id: 1, role: 'user', content: 'Clean up the old draft tracks in my Kdenlive timeline', created_at: '2026-09-20 14:02:00' },
  {
    id: 2, conversation_id: 1, role: 'assistant',
    content: "Found one leftover draft track — an unused voiceover take (\"draft-vo-2\") that isn't referenced anywhere else in the timeline. I'd like to delete it. Deleted draft-vo-2 — timeline is clean.",
    created_at: '2026-09-20 14:02:41',
  },
]

// DJ Toolkit — the real catalog from backend/routers/dj.py's DJ_TOOLS/SESSIONS (public
// reference content: real manuals, real tips, no personal paths or install state — that
// file was already scrubbed for exactly this kind of general distribution). status is
// always 'stopped' here since nothing is actually running on a demo visitor's machine —
// the point of showing this page is the catalog/manual, not a live launcher.

export const DJ_TOOLS: DjTool[] = [
  {
    id: "mixxx", name: "Mixxx", version: null,
    category: "dj", role: "DJ mixing — beatmatching, EQ blending, live sets",
    description: "Two-deck+ DJ mixing software with waveform display, headphone cueing, 3-band EQ, looping, and library management (crates, BPM/key analysis, cue points). The only actively-maintained DJ application with genuine native Linux support.",
    kind: "flatpak", standalone: true, host: null,
    launchable: true,
    manual_url: "https://manual.mixxx.org/2.5/en/chapters/djing_with_mixxx.html", manual_label: "Mixxx Manual — DJing With Mixxx",
    tutorial_url: null, tutorial_label: null,
    quickstart: ["Drag tracks from the file browser panel (left side) into Deck 1 and Deck 2.", "Use each deck's headphone-cue icon to preview a track before bringing it into the main mix.", "Practice with Sync OFF first — manual beatmatching by ear is the core skill. Turn Sync on later, once you don't need it.", "Your track library isn't in the DJ project folder — Mixxx keeps its own library DB. Import from ~/Music or ~/Downloads."],
    tips: ["Skill order: waveform reading + manual beatmatching -> phrase matching (8/16/32-bar counts) -> 3-band EQ blending (bass-swap transitions — the actual techno-DJ technique, not just crossfading) -> long/quick transitions -> a tagged, crated library -> reading set energy.", "If Mixxx can't see ~/Downloads (Flatpak sandbox), grant it read-only: flatpak override --user --filesystem=xdg-download:ro org.mixxx.Mixxx", "Launch with tracks preloaded into both decks: flatpak run org.mixxx.Mixxx track1.mp3 track2.mp3"],
    status: 'stopped',
  },
  {
    id: "ardour", name: "Ardour", version: null,
    category: "daw", role: "DAW — arrangement, mixing, automation, export",
    description: "Full production DAW. Genuinely free with no track/feature limits via this Flathub build (the official ardour.org binary nags for a donation or mutes audio after 10 min — Flathub's doesn't).",
    kind: "flatpak", standalone: true, host: null,
    launchable: true,
    manual_url: null, manual_label: null,
    tutorial_url: null, tutorial_label: null,
    quickstart: ["Program drum patterns in Hydrogen first, then build the rest of the arrangement, automation, mixing and export here.", "Hit play in either Ardour or Hydrogen and both start together — shared transport over PipeWire's JACK layer, no manual routing.", "If a newly-installed plugin doesn't show up: Window -> Plugin Manager -> rescan."],
    tips: ["Flatpak sandboxing can hide ~/.vst3 / ~/.lv2 plugins from Ardour. Fix it with: flatpak override --user --filesystem=home/.vst3:ro --filesystem=home/.lv2:ro org.ardour.Ardour — re-run after installing a new plugin folder Ardour still can't see.", "Calf, LSP, and Dragonfly Reverb are installed as system LV2 packages (apt), so Ardour finds them with no override needed.", "Techno arrangement shape: intro -> build -> drop/peak -> breakdown -> outro, in 8/16-bar blocks."],
    status: 'stopped',
  },
  {
    id: "hydrogen", name: "Hydrogen", version: null,
    category: "daw", role: "Drum machine / pattern sequencer",
    description: "Standalone pattern-based drum machine — the primary tool for programming techno grooves: 4-on-the-floor kicks, off-beat hats, clap/percussion layering, swing.",
    kind: "flatpak", standalone: true, host: null,
    launchable: true,
    manual_url: null, manual_label: null,
    tutorial_url: null, tutorial_label: null,
    quickstart: ["Program a basic 4-on-the-floor kick + closed-hat pattern in the pattern editor to start.", "Layer claps/snares and other percussion once the kick+hat groove feels right.", "Export the pattern/song and continue arranging it in Ardour — both share transport automatically."],
    tips: ["Groove refinement (swing, velocity variation, micro-timing) is what separates a flat loop from a groovy one — revisit a pattern after the rest of the arrangement exists, not just once."],
    status: 'stopped',
  },
  {
    id: "surge_xt", name: "Surge XT", version: null,
    category: "synth", role: "Synth — basslines & leads (VST3/CLAP/standalone)",
    description: "Deep subtractive/hybrid synthesis, a strong all-rounder for techno basslines and pads.",
    kind: "flatpak", standalone: true, host: null,
    launchable: true,
    manual_url: null, manual_label: null,
    tutorial_url: "https://www.youtube.com/c/loopop", tutorial_label: "Sound design deep-dives (loopop)",
    quickstart: ["Run standalone for quick sound design/noodling, or load it as a plugin on an Ardour track for a real bassline.", "Learn subtractive synthesis fundamentals here (oscillators, filters, envelopes) — the same fundamentals carry over to Vital."],
    tips: [],
    status: 'stopped',
  },
  {
    id: "vital", name: "Vital", version: null,
    category: "synth", role: "Synth — wavetable, leads & basslines (VST3/LV2/standalone)",
    description: "Wavetable synth, excellent for modulated leads and basslines. The free 'Basic' tier is permanent, not a trial — full synth engine, just fewer bundled presets/wavetables than the paid tiers.",
    kind: "binary", standalone: true, host: null,
    launchable: true,
    manual_url: "https://vital.audio/", manual_label: "vital.audio",
    tutorial_url: "https://www.youtube.com/c/loopop", tutorial_label: "Sound design deep-dives (loopop)",
    quickstart: ["Run standalone for sound design, or load it as a plugin inside Ardour.", "Reinstalling is manual only — the developer blocks scripted downloads — grab the .deb from vital.audio again, not a package manager."],
    tips: [],
    status: 'stopped',
  },
  {
    id: "geonkick", name: "Geonkick", version: null,
    category: "synth", role: "Percussion synth — kicks, claps, hats (VST3/LV2/standalone)",
    description: "Purpose-built percussion synthesizer (not sample-based) for designing kicks, claps and hats from scratch.",
    kind: "binary", standalone: true, host: null,
    launchable: true,
    manual_url: null, manual_label: null,
    tutorial_url: null, tutorial_label: null,
    quickstart: ["Run standalone to design a kick/clap/hat from scratch, or drop it directly onto a drum track in Ardour as a plugin."],
    tips: [],
    status: 'stopped',
  },
  {
    id: "flatseal", name: "Flatseal", version: null,
    category: "utility", role: "Utility — Flatpak sandbox permissions GUI",
    description: "GUI for adjusting what a Flatpak app can see on disk. Reach for this the moment a Flatpak app (Ardour, Mixxx) can't see a folder, drive, or plugin directory it should.",
    kind: "flatpak", standalone: true, host: null,
    launchable: true,
    manual_url: null, manual_label: null,
    tutorial_url: null, tutorial_label: null,
    quickstart: ["Open Flatseal, pick the app (e.g. Ardour) from the list, then add or edit its Filesystem permissions.", "CLI equivalent, for one-off overrides: flatpak override --user --filesystem=/path/to/folder:ro org.example.App"],
    tips: ["Typical grants: Ardour -> ~/.vst3 and ~/.lv2 (read-only); Mixxx -> ~/Downloads (read-only)."],
    status: 'stopped',
  },
  {
    id: "calf", name: "Calf Studio Gear", version: null,
    category: "plugin", role: "Plugin — EQ / compression / mixing (LV2)",
    description: "EQ, compressor, multiband, limiter, gate. Installed as a system LV2 package (apt), so Ardour finds it automatically with no sandbox override needed.",
    kind: "plugin", standalone: false, host: "ardour",
    launchable: false,
    manual_url: null, manual_label: null,
    tutorial_url: null, tutorial_label: null,
    quickstart: ["Open Ardour and add it to a track or bus from the plugin browser — nothing to launch separately."],
    tips: [],
    status: 'stopped',
  },
  {
    id: "lsp", name: "LSP Plugins", version: null,
    category: "plugin", role: "Plugin — dynamics / filters / reverb (LV2/VST3)",
    description: "Comprehensive dynamics, filter, and impulse-reverb suite. Installed as a system LV2 package.",
    kind: "plugin", standalone: false, host: "ardour",
    launchable: false,
    manual_url: null, manual_label: null,
    tutorial_url: null, tutorial_label: null,
    quickstart: ["Open Ardour and add it to a track or bus from the plugin browser — nothing to launch separately."],
    tips: [],
    status: 'stopped',
  },
  {
    id: "dragonfly_reverb", name: "Dragonfly Reverb", version: null,
    category: "plugin", role: "Plugin — reverb (LV2/VST3)",
    description: "Clean, low-CPU reverb for space and depth. Installed as a system LV2 package.",
    kind: "plugin", standalone: false, host: "ardour",
    launchable: false,
    manual_url: null, manual_label: null,
    tutorial_url: null, tutorial_label: null,
    quickstart: ["Open Ardour and add it to a track or bus from the plugin browser — nothing to launch separately."],
    tips: [],
    status: 'stopped',
  },
]

export const DJ_SESSIONS: DjSession[] = [
  {
    id: "dj_mixing", label: "DJ Mixing Session", description: "Beatmatching practice or a live mix.",
    tool_ids: ["mixxx"],
  },
  {
    id: "production", label: "Production Session", description: "Ardour + Hydrogen together — shared transport over PipeWire/JACK, hit play in either and both start.",
    tool_ids: ["ardour", "hydrogen"],
  },
  {
    id: "sound_design", label: "Sound Design Session", description: "Surge XT + Vital standalone, for patch noodling before dropping a sound into Ardour.",
    tool_ids: ["surge_xt", "vital"],
  },
]