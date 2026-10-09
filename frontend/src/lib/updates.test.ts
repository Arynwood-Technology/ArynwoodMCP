import { describe, it, expect, vi, afterEach } from 'vitest'
import { checkForUpdate, parseUpdate, openRelease, UPDATE_API } from './updates'

const desktop = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => false) }))
vi.mock('@tauri-apps/api/core', () => desktop)
const release = (tag_name: string) => ({ tag_name, draft: false, prerelease: false })
afterEach(() => { vi.restoreAllMocks(); desktop.invoke.mockReset(); desktop.isTauri.mockReturnValue(false) })

describe('stable update discovery', () => {
  it('compares numeric major, minor and patch versions', () => {
    for (const tag of ['v0.4.10', 'v0.5.0', 'v1.0.0']) {
      expect(parseUpdate(release(tag), '0.4.8')?.version).toBe(tag.slice(1))
    }
    for (const tag of ['v0.4.8', 'v0.4.7', 'v0.3.99']) {
      expect(parseUpdate(release(tag), '0.4.8')).toBeNull()
    }
  })
  it('ignores drafts, prereleases and malformed metadata', () => {
    for (const value of [null, [], {}, { ...release('v0.4.9'), draft: true },
      { ...release('v0.4.9'), prerelease: true }, release('v0.4.9-beta.1'),
      release('https://evil.example'), release('v999999999999999999999.0.0')]) {
      expect(parseUpdate(value, '0.4.8')).toBeNull()
    }
  })
  it('constructs only the official release URL even with hostile remote URLs', () => {
    expect(parseUpdate({ ...release('v0.4.9'), html_url: 'javascript:alert(1)' }, '0.4.8')?.url)
      .toBe('https://github.com/Arynwood-Technology/ArynwoodMCP/releases/tag/v0.4.9')
  })
  it('uses a public request without credentials and honors cancellation', async () => {
    const signal = new AbortController().signal
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(release('v99.0.0'))))
    expect((await checkForUpdate(signal))?.version).toBe('99.0.0')
    expect(fetch).toHaveBeenCalledWith(UPDATE_API, expect.objectContaining({ signal, credentials: 'omit', referrerPolicy: 'no-referrer' }))
    fetch.mockResolvedValue(new Response('', { status: 403 }))
    await expect(checkForUpdate(signal)).rejects.toThrow('unavailable')
  })
  it('rejects oversized and malformed responses', async () => {
    const signal = new AbortController().signal
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('x'.repeat(256 * 1024 + 1)))
    await expect(checkForUpdate(signal)).rejects.toThrow('too large')
    fetch.mockResolvedValue(new Response('invalid json'))
    await expect(checkForUpdate(signal)).rejects.toThrow()
  })
  it('opens the system browser through desktop IPC and refuses foreign destinations', async () => {
    desktop.isTauri.mockReturnValue(true)
    const url = 'https://github.com/Arynwood-Technology/ArynwoodMCP/releases/tag/v0.4.9'
    await openRelease(url)
    expect(desktop.invoke).toHaveBeenCalledWith('plugin:shell|open', { path: url })
    await expect(openRelease('https://evil.example')).rejects.toThrow('Invalid release URL')
    await expect(openRelease(`${url}/../../evil`)).rejects.toThrow('Invalid release URL')
  })
})
