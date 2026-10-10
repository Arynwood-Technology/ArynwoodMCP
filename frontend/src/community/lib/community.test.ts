import { afterEach, expect, it, vi } from 'vitest'
import { api } from './community'
afterEach(() => vi.unstubAllGlobals())

it('explains an action an older Grove does not have', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'Method Not Allowed' }), { status: 405 })))
  await expect(api('/community/spaces/home', 'DELETE')).rejects.toThrow('older version')
})
