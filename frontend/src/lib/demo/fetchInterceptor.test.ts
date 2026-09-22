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
})
