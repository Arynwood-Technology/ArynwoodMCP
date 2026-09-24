import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installDemoFetch } from './fetchInterceptor'
import { apiUrl } from '../api'

describe('installDemoFetch', () => {
  let realFetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // Stand-in for the innermost "real network" fetch — if any /api/* call ever
    // reaches this, the outermost-wrap ordering guarantee has been violated.
    realFetchSpy = vi.fn(async () => new Response('should never be called', { status: 599 }))
    vi.stubGlobal('fetch', realFetchSpy)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('answers a static GET route from fixture data', async () => {
    installDemoFetch()
    const r = await fetch('/api/chat/personas')
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body.find((p: { id: string }) => p.id === 'central')?.name).toBe('Arynwood')
    // The real network fetch must never have been reached for a matched /api/* path.
    expect(realFetchSpy).not.toHaveBeenCalled()
  })

  it('answers a dynamic :id route', async () => {
    installDemoFetch()
    const r = await fetch('/api/chat/conversations/1/messages')
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThan(0)
  })

  it('denies a mutating call with no fixture instead of silently no-opping or erroring opaquely', async () => {
    installDemoFetch()
    const r = await fetch('/api/servers', { method: 'POST', body: JSON.stringify({ name: 'x' }) })
    expect(r.status).toBe(403)
    const body = await r.json()
    expect(body.detail).toMatch(/not available in this demo/i)
  })

  it('404s an unmatched read instead of hanging or erroring opaquely', async () => {
    installDemoFetch()
    const r = await fetch('/api/something/nonexistent')
    expect(r.status).toBe(404)
  })

  it('lets a non-/api request pass through untouched', async () => {
    installDemoFetch()
    await fetch('https://fonts.googleapis.com/css2?family=Inter')
    expect(realFetchSpy).toHaveBeenCalledTimes(1)
  })

  it('the outermost-wrap ordering: apiUrl()-rewritten calls never leak to the real backend origin', async () => {
    // Reproduces main.tsx's exact sequence: the PROD-gated apiUrl() patch installs
    // first, installDemoFetch() installs second (wrapping outermost) — exactly the
    // order the real bootstrap uses.
    vi.stubEnv('PROD', true)
    const _fetch = window.fetch.bind(window)
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof input === 'string') input = apiUrl(input)
      return _fetch(input, init)
    }
    installDemoFetch()

    await fetch('/api/chat/personas')

    // If ordering were wrong, this would have been called with an absolute
    // http://localhost:8010/... URL instead of never being called at all.
    expect(realFetchSpy).not.toHaveBeenCalled()
  })

  it('an already apiUrl()-resolved absolute URL (DownloadButton/lib/download.ts calls apiUrl() itself) is still intercepted, not just a bare relative /api/... string', async () => {
    // Regression test for a real bug found while building Music Studio's mocking: vite
    // build --mode demo sets PROD=true (Vite ties PROD/DEV to the build command, not
    // --mode), so apiUrl() resolves to an absolute BACKEND_ORIGIN + path string before
    // DownloadButton/MusicAssetCard's manual fetch() ever call fetch() themselves — the
    // "outermost-wrap ordering" test above doesn't cover this case, since there the demo
    // patch itself intercepts before any apiUrl() rewrite runs at all.
    vi.stubEnv('PROD', true)
    installDemoFetch()
    const r = await fetch(apiUrl('/api/chat/personas'))
    expect(r.status).toBe(200)
    expect(realFetchSpy).not.toHaveBeenCalled()
  })

  it('returns a real binary response (not JSON) for a route backed by a registered demo audio blob', async () => {
    // Preserves the real URL class (new URL()/instanceof URL elsewhere keep working) —
    // same pattern lib/download.test.ts uses, since jsdom has no real
    // createObjectURL/revokeObjectURL. Deliberately does NOT exercise the real
    // OfflineAudioContext-based synthesis/DSP path (audioSynth.ts/audioDsp.ts) — jsdom
    // implements no Web Audio API at all, consistent with why LiveVoiceMonitor/
    // EffectsRack/AudioRecorder have no existing test files either; that path is
    // verified by hand in a real browser instead (see the plan's manual checklist).
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:mock-url'), revokeObjectURL: vi.fn() }))
    const { registerDemoAudio } = await import('./audioAssets')
    const bytes = new Uint8Array([1, 2, 3, 4])
    registerDemoAudio('test-job-id', new Blob([bytes], { type: 'audio/wav' }))

    installDemoFetch()
    const r = await fetch('/api/studio/voice/convert/test-job-id/result')
    expect(r.status).toBe(200)
    expect(r.headers.get('Content-Type')).toBe('audio/wav')
    // Not asserting exact body bytes here: confirmed via a standalone Node script that
    // `new Response(blob).arrayBuffer()` roundtrips correctly under Node's real fetch,
    // but jsdom's own Blob/Response polyfill (this test's environment) does not — the
    // body comes back as the literal string "[object Blob]" instead of the blob's
    // bytes, a jsdom-only gap unrelated to the interceptor's actual (correct) behavior
    // in a real browser. Content-Type and status are what's reliably verifiable here.
    const text = await r.text()
    expect(text).not.toContain('"detail"') // not the JSON error-fallback shape
  })
})
