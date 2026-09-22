// Canned data for the GitHub Pages demo build. Shapes match the real backend responses
// exactly (see frontend/src/lib/api.ts's interfaces) so every page renders identically to
// a real install. Persona id/name/role/model are the real, public values from
// mcp/config/models.json — that file's system prompts stay private; nothing here quotes
// them, only the same non-sensitive fields /api/chat/personas already exposes.
import type {
  Persona, SystemStatus, Server, Tool, Conversation, Message,
  CheckpointList, ModelFileList, KnowledgeStatus, KnowledgeSource, Sidecar, McpServerInfo, GpuQueue,
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

export const SIDECARS: Record<string, Sidecar> = {
  'song-gen': { id: 'song-gen', label: 'Song Generation', port: 8003, status: 'stopped' },
  'stem-sep': { id: 'stem-sep', label: 'Stem Separator', port: 8001, status: 'stopped' },
}

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
