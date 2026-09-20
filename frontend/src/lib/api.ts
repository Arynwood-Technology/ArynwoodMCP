const BASE = '/api'

/**
 * Where the backend is when the UI isn't served by it — the packaged desktop app's page origin is
 * tauri://localhost. In dev, Vite proxies /api, so relative paths work. `VITE_BACKEND_ORIGIN` exists for
 * testing a production build against a backend on another port; the shipped app doesn't set it.
 */
export const BACKEND_ORIGIN: string = import.meta.env.VITE_BACKEND_ORIGIN || 'http://localhost:8010'

/**
 * `/api/...` → an absolute backend URL in a production build, unchanged otherwise. main.tsx patches `fetch()`
 * for this, but that can't reach `<audio src>`, `<video src>`, `<img src>`, `new Audio()`, `<a href>` or
 * `window.open()` — a relative /api path there resolves against tauri://localhost, which answers with the
 * app's own index.html. (That is why nothing played in the packaged app.)
 */
export function apiUrl(path: string): string {
  return import.meta.env.PROD && path.startsWith('/api') ? `${BACKEND_ORIGIN}${path}` : path
}

export async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const isFormData = opts?.body instanceof FormData
  const r = await fetch(`${BASE}${path}`, {
    headers: isFormData ? { ...opts?.headers } : { 'Content-Type': 'application/json', ...opts?.headers },
    ...opts,
  })
  if (!r.ok) {
    const err = await r.text()
    throw new Error(err || `HTTP ${r.status}`)
  }
  return r.json()
}

// System
export const getStatus = () => request<SystemStatus>('/system/status')
export const restartBackend = () => request<{ status: string }>('/system/restart', { method: 'POST' })

export interface GpuQueue { running: string | null; depth: number; waiting: string[] }
export const getGpuQueue = () => request<GpuQueue>('/system/gpu-queue')

// MCP tool servers. Returns [] when mcp/config/mcp_servers.json is absent — that
// file is gitignored/per-install, and its absence silently disables all MCP tool
// dispatch, so the status drawer calls that out explicitly rather than showing
// an empty section that reads like "nothing wrong here".
export interface McpServerInfo { name: string; url: string }
export const getMcpServers = () => request<McpServerInfo[]>('/mcp/servers')

// MusicStudio sidecars (stem separation, RVC, effects, song-gen)
/** `failed` = it started and died; `error` is the tail of its log, so the UI can say why. */
export interface Sidecar { id: string; label: string; port: number; status: 'running' | 'starting' | 'failed' | 'stopped'; error?: string }
export const getSidecars = () => request<Record<string, Sidecar>>('/studio/sidecars')
export const startSidecar = (id: string) =>
  request<{ status: string }>(`/studio/sidecars/${id}/start`, { method: 'POST' })

// Ollama
export const getModels = (host = 'localhost', port = 11434) =>
  request<{ models: OllamaModel[] }>(`/ollama/models?host=${host}&port=${port}`)
export const getRunning = (host = 'localhost', port = 11434) =>
  request<any>(`/ollama/running?host=${host}&port=${port}`)
export const deleteModel = (model: string, host = 'localhost', port = 11434) =>
  request<any>('/ollama/model', { method: 'DELETE', body: JSON.stringify({ model, server_host: host, server_port: port }) })
export const showModel = (model: string, host = 'localhost', port = 11434) =>
  request<any>(`/ollama/show?model=${encodeURIComponent(model)}&host=${host}&port=${port}`)

// Servers
export const getServers = () => request<Server[]>('/servers')
export const createServer = (data: Partial<Server>) =>
  request<Server>('/servers', { method: 'POST', body: JSON.stringify(data) })
export const updateServer = (id: number, data: Partial<Server>) =>
  request<Server>(`/servers/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
export const deleteServer = (id: number) =>
  request<any>(`/servers/${id}`, { method: 'DELETE' })
export const pingServer = (id: number) =>
  request<{ online: boolean }>(`/servers/${id}/ping`)

// Chat
export const getPersonas = () => request<Persona[]>('/chat/personas')
export const getConversations = () => request<Conversation[]>('/chat/conversations')
export const uploadFile = async (file: File): Promise<{ filename: string; text: string; chars: number }> => {
  const form = new FormData()
  form.append('file', file)
  const r = await fetch(`${BASE}/chat/upload`, { method: 'POST', body: form })
  if (!r.ok) { const e = await r.text(); throw new Error(e || `HTTP ${r.status}`) }
  return r.json()
}
export const getMessages = (id: number) => request<Message[]>(`/chat/conversations/${id}/messages`)
export const deleteConversation = (id: number) =>
  request<any>(`/chat/conversations/${id}`, { method: 'DELETE' })

// Models (SD checkpoints / LoRAs beyond Ollama)
export const getCheckpoints = () => request<CheckpointList>('/models/checkpoints')
export const getLoras = () => request<ModelFileList>('/models/loras')

// Tools
export const getTools = () => request<Tool[]>('/tools')
export const generateImage = (data: object) =>
  request<{ images: string[] }>('/tools/stable_diffusion/generate', { method: 'POST', body: JSON.stringify(data) })
export const generateTTS = (data: object) =>
  request<any>('/tools/tortoise_tts/generate', { method: 'POST', body: JSON.stringify(data) })

// Types
export interface SystemStatus {
  ollama: boolean
  tortoise_tts: boolean
  stable_diffusion: boolean
  prometheus: boolean
  gpu: { available: boolean; name?: string; temp?: string; utilization?: string; memory_used?: string; memory_total?: string }
  platform: string
  /** false in a packaged build, which can't respawn its own backend (absent on older backends). */
  can_restart?: boolean
}

export interface OllamaModel {
  name: string
  size: number
  digest: string
  modified_at: string
  details?: { parameter_size?: string; quantization_level?: string }
}

export interface Server {
  id: number
  name: string
  host: string
  port: number
  type: string
  auth_token?: string
  enabled: number
  created_at: string
}

export interface Persona {
  id: string
  name: string
  role: string
  model: string
}

export interface Conversation {
  id: number
  title?: string
  persona: string
  model: string
  server_id?: number
  created_at: string
  updated_at: string
}

export interface Message {
  id: number
  conversation_id: number
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export interface ModelFile {
  filename: string
  size_bytes: number
  modified_at: number
}

export interface ModelFileList {
  files: ModelFile[]
  total_bytes: number
}

export interface CheckpointFile extends ModelFile {
  known: boolean
  style: string | null
}

export interface CheckpointList {
  files: CheckpointFile[]
  missing_from_styles: { style: string; filename: string }[]
  total_bytes: number
}

export interface Tool {
  id: string
  name: string
  description: string
  type: string
  category: string
  port?: number
  homepage?: string
  install?: string
  local_html?: boolean
  status: 'online' | 'offline' | 'available' | 'unavailable' | 'error'
}

export const openTool = (id: string) =>
  fetch(`/api/tools/${id}/open`, { method: 'POST' }).then(r => r.json())

export const installToolStream = (id: string) =>
  fetch(`/api/tools/${id}/install/stream`)

// Tool-specific API calls
export const removeBg    = (form: FormData) => fetch('/api/tools/rembg/remove',    { method: 'POST', body: form }).then(r => r.json())
export const upscaleImg  = (form: FormData) => fetch('/api/tools/realesrgan/upscale', { method: 'POST', body: form }).then(r => r.json())
export const searchSearx = (q: string, engines = '') =>
  request<SearXResult>(`/tools/searxng/search?q=${encodeURIComponent(q)}&engines=${engines}`)
export const listQdrant  = () => request<{ collections: { name: string }[] }>('/tools/qdrant/collections')
export const generateAlltalk = (data: object) =>
  request<any>('/tools/alltalk_tts/generate', { method: 'POST', body: JSON.stringify(data) })
export const generateKokoro = (data: object) =>
  request<any>('/tools/kokoro/generate', { method: 'POST', body: JSON.stringify(data) })
export const scrapeFetch = (data: { url: string; selector?: string; fetcher?: string; output?: string }) =>
  request<ScraplingResult>('/tools/scrapling/fetch', { method: 'POST', body: JSON.stringify(data) })

export interface ScraplingResult {
  url: string
  selector: string
  fetcher: string
  count: number
  results: { text: string; html: string }[]
}

export interface SearXResult {
  query: string
  results: { title: string; url: string; content: string; engine: string }[]
  suggestions: string[]
  answers: string[]
}

// Knowledge base
export interface KnowledgeSource {
  id: number
  title: string
  source: string
  source_type: string
  chunk_count: number
  added_by: string
  created_at: string
  version: number
  superseded_by: number | null
}

export interface KnowledgeStatus {
  qdrant: { online: boolean; collection_ready: boolean }
  embedding_model: string
  embedding_model_available: boolean
}

export interface KnowledgeSearchResult {
  score: number
  title: string
  source: string
  source_id: number
  text: string
  // Only present for element-aware PDF chunks (see PartitionChunk) — plain text/URL
  // sources and points ingested before Phase 3 simply omit these.
  page_start?: number | null
  page_end?: number | null
  has_table?: boolean
}

export const getKnowledgeStatus = () => request<KnowledgeStatus>('/knowledge/status')
export const getKnowledgeSources = () => request<KnowledgeSource[]>('/knowledge/sources')
export const deleteKnowledgeSource = (id: number) =>
  request<{ deleted: number }>(`/knowledge/sources/${id}`, { method: 'DELETE' })
export const searchKnowledge = (q: string, topK = 5) =>
  request<{ results: KnowledgeSearchResult[] }>(`/knowledge/search?q=${encodeURIComponent(q)}&top_k=${topK}`)
export const learnUrl = (url: string) =>
  request<{ id: number; title: string; chunks: number }>('/knowledge/learn', {
    method: 'POST', body: JSON.stringify({ source_type: 'url', source: url }),
  })
export const learnText = (source: string, text: string, title?: string) =>
  request<{ id: number; title: string; chunks: number }>('/knowledge/learn', {
    method: 'POST', body: JSON.stringify({ source_type: 'text', source, text, title }),
  })
export const learnFile = (filename: string, text: string) =>
  request<{ id: number; title: string; chunks: number }>('/knowledge/learn', {
    method: 'POST', body: JSON.stringify({ source_type: 'file', source: filename, text, title: filename }),
  })
// Element-aware chunks from a Sycamore parse (see PartitionChunk) — page_start/
// page_end/has_table ride along into the Qdrant payload instead of being lost to a
// blind character-count re-chunk.
export interface PartitionChunk {
  text: string
  page_start: number | null
  page_end: number | null
  has_table: boolean
}
export const learnChunks = (filename: string, chunks: PartitionChunk[]) =>
  request<{ id: number; title: string; chunks: number }>('/knowledge/learn', {
    method: 'POST', body: JSON.stringify({ source_type: 'file', source: filename, chunks, title: filename }),
  })
// Dedicated to Learn's file path — unlike chat's uploadFile(), this doesn't truncate
// to a chat-context window and allows much larger files (see knowledge.py MAX_INGEST_FILE_BYTES).
export const uploadKnowledgeFile = async (file: File): Promise<{ filename: string; text: string; chars: number }> => {
  const form = new FormData()
  form.append('file', file)
  const r = await fetch(`${BASE}/knowledge/upload`, { method: 'POST', body: form })
  if (!r.ok) { const e = await r.text(); throw new Error(e || `HTTP ${r.status}`) }
  return r.json()
}

// PDF parsing via Sycamore's local layout model + OCR + table-structure extraction
// (see docs/sycamore-integration-plan.md). Runs as a background job — a scanned,
// multi-page PDF can take well past a normal request timeout — so this is a
// start-then-poll pair sharing the same job registry as /api/tools/jobs/{id}.
export interface KnowledgeJob {
  id: string
  status: 'queued' | 'running' | 'done' | 'error'
  error: string | null
  result_text: string | null
  result_chunks: PartitionChunk[] | null
  filename?: string
}
export const startSycamorePartitionJob = async (file: File, ocr = false): Promise<{ job_id: string; status: string }> => {
  const form = new FormData()
  form.append('file', file)
  // OCR defaults off: verified against a real digital-text PDF that forcing OCR on
  // introduces real misreads (periods -> colons, "097" -> "O97", dropped hyphens/
  // quotes) on documents that already have a clean embedded text layer. Sycamore's
  // layout model + table-structure extraction still run either way — OCR only helps
  // (and should only be turned on for) genuinely scanned/image-only pages.
  form.append('ocr', String(ocr))
  form.append('tables', 'true')
  const r = await fetch(`${BASE}/knowledge/sycamore/jobs`, { method: 'POST', body: form })
  if (!r.ok) { const e = await r.text(); throw new Error(e || `HTTP ${r.status}`) }
  return r.json()
}
export const getKnowledgeJob = (jobId: string) => request<KnowledgeJob>(`/knowledge/jobs/${jobId}`)

// Filesystem browser (home-sandboxed; shared with Design Center's save dialog)
export const browseHome = (path = '~') =>
  request<{ path: string; parent: string | null; home: string; dirs: string[] }>(
    `/fs/browse-home?path=${encodeURIComponent(path)}`
  )

// Video Studio — generation/edit/caption jobs are multipart, kicked off via
// direct fetch() from useJobPoll (same convention as ToolLibrary's job
// panels); this covers the one plain-JSON endpoint, reused across all three tabs.
export interface VideoLibraryItem { job_id: string; tool: string; created_at: number; result_path: string }
export const getVideoLibrary = () => request<VideoLibraryItem[]>('/video/library')

// Music Lab — Instrument Generator / Jam with AI, backed by the song-gen
// sidecar (ACE-Step/MusicGen) and proxied+persisted via backend/routers/music.py.
// Unlike studio.ts's stateless voice/stem-sep proxies, generation here is
// DB-backed (music_assets/music_generation_jobs), so job starts are kicked off
// via direct fetch() from useMusicJobPoll (components/studio/useMusicJobPoll.ts)
// polling GET /api/music/jobs/{id} — not /api/tools/jobs/{id}. This section
// covers the plain CRUD/read endpoints only.
export interface MusicProviderCapability {
  id: string
  label: string
  installed: boolean
  message: string | null
  license: string
  supports: {
    text_to_music: boolean
    instrumental: boolean
    audio_conditioning: boolean
    continuation: boolean
    melody_conditioning: boolean
  }
  max_duration_seconds: number
  vram_estimate_gb: number
}
export interface MusicCapabilities {
  providers: MusicProviderCapability[]
  stems: {
    provider: string
    sidecar_status: 'running' | 'starting' | 'stopped'
    engines: string[]
    stem_counts: number[]
  }
}
export const getMusicCapabilities = () => request<MusicCapabilities>('/music/capabilities')

export interface MusicAsset {
  id: string
  kind: 'generated' | 'stem' | 'jam_response' | 'recording'
  provider: string | null
  source_asset_id: string | null
  label: string
  instrument: string | null
  prompt: string | null
  params_json: string
  file_path: string | null
  duration_seconds: number | null
  bpm: number | null
  musical_key: string | null
  favorite: number
  project_id: number | null
  created_at: string
  updated_at: string
}
export const getMusicAssets = (params?: { kind?: string; instrument?: string; favorite?: boolean; project_id?: number }) => {
  const qs = new URLSearchParams()
  if (params?.kind) qs.set('kind', params.kind)
  if (params?.instrument) qs.set('instrument', params.instrument)
  if (params?.favorite !== undefined) qs.set('favorite', String(params.favorite))
  if (params?.project_id !== undefined) qs.set('project_id', String(params.project_id))
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  return request<MusicAsset[]>(`/music/assets${suffix}`)
}
export const renameMusicAsset = (id: string, label: string) =>
  request<MusicAsset>(`/music/assets/${id}`, { method: 'PATCH', body: JSON.stringify({ label }) })
export const favoriteMusicAsset = (id: string, favorite: boolean) =>
  request<MusicAsset>(`/music/assets/${id}`, { method: 'PATCH', body: JSON.stringify({ favorite }) })
export const deleteMusicAsset = (id: string) =>
  request<{ deleted: string }>(`/music/assets/${id}`, { method: 'DELETE' })
export const regenerateMusicAsset = (id: string) =>
  request<{ job_id: string }>(`/music/assets/${id}/regenerate`, { method: 'POST' })

export interface MusicJob {
  id: string
  kind: string
  provider: string
  sidecar: string
  status: 'queued' | 'running' | 'done' | 'error'
  progress: number
  params_json: string
  result_asset_id: string | null
  error: string | null
  created_at: string
  updated_at: string
  queue_position: number | null
}
export const getMusicJob = (jobId: string) => request<MusicJob>(`/music/jobs/${jobId}`)

// DJ Toolkit — Mixxx/Ardour/Hydrogen/Surge XT/Vital/Flatseal/Calf/LSP/Dragonfly/
// Geonkick. These are desktop GUI apps with no HTTP surface of their own, unlike
// every other section above — status comes from `flatpak ps`/`pgrep` on the
// backend host (see backend/routers/dj.py), and "launch" just spawns and forgets.
export interface DjTool {
  id: string
  name: string
  version: string | null
  category: 'dj' | 'daw' | 'synth' | 'utility' | 'plugin'
  role: string
  description: string
  kind: 'flatpak' | 'binary' | 'plugin'
  standalone: boolean
  host: string | null
  launchable: boolean
  manual_url: string | null
  manual_label: string | null
  tutorial_url: string | null
  tutorial_label: string | null
  quickstart: string[]
  tips: string[]
  status: 'running' | 'stopped' | 'plugin' | 'unknown'
}
export const getDjTools = () => request<DjTool[]>('/dj/tools')
export const launchDjTool = (id: string) =>
  request<{ launched: boolean; tool_id: string; pid: number }>(`/dj/tools/${id}/launch`, { method: 'POST' })

export interface DjSession {
  id: string
  label: string
  description: string
  tool_ids: string[]
}
export const getDjSessions = () => request<DjSession[]>('/dj/sessions')
export const startDjSession = (id: string) =>
  request<{ session_id: string; results: { tool_id: string; launched: boolean; pid?: number; reason?: string }[] }>(
    `/dj/sessions/${id}/start`, { method: 'POST' }
  )
