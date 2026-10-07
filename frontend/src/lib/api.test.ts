import { describe, it, expect, afterEach, vi } from 'vitest'
import { apiUrl, BACKEND_ORIGIN, modelFor, type Server } from './api'

describe('apiUrl', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('leaves paths alone in dev, where Vite proxies /api', () => {
    vi.stubEnv('PROD', false)
    expect(apiUrl('/api/music/assets/a1/audio')).toBe('/api/music/assets/a1/audio')
  })

  it('points /api paths at the backend in a production build (the packaged app is not served by it)', () => {
    vi.stubEnv('PROD', true)
    expect(apiUrl('/api/music/assets/a1/audio')).toBe(`${BACKEND_ORIGIN}/api/music/assets/a1/audio`)
    expect(BACKEND_ORIGIN).toBe('http://localhost:8010')
  })

  it('does not touch blob:, data: or already-absolute URLs', () => {
    vi.stubEnv('PROD', true)
    for (const u of ['blob:tauri://localhost/abc', 'data:audio/wav;base64,AAAA', 'http://localhost:7851/out.wav', 'https://example.com/api/x']) {
      expect(apiUrl(u)).toBe(u)
    }
  })
})

describe('modelFor', () => {
  const server = (model?: string | null): Server =>
    ({ id: 2, name: 'Remote', host: 'https://api.example.com/v1', port: 443, type: 'openai-compatible', enabled: 1, created_at: '', model })

  it("uses an endpoint's own model: a persona's Ollama model name means nothing to it", () => {
    expect(modelFor(server('chat-model'), 'hermes3:8b')).toBe('chat-model')
  })

  it("keeps the persona's model on a server without one (Ollama, or no server chosen yet)", () => {
    expect(modelFor(server(null), 'hermes3:8b')).toBe('hermes3:8b')
    expect(modelFor(null, 'hermes3:8b')).toBe('hermes3:8b')
  })
})
