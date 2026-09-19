import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useMusicCapabilities } from './useMusicCapabilities'
import type { MusicCapabilities } from '../../lib/api'

const getMusicCapabilities = vi.fn()
vi.mock('../../lib/api', () => ({ getMusicCapabilities: () => getMusicCapabilities() }))

const provider = { id: 'musicgen', label: 'MusicGen', installed: true, license: 'CC-BY-NC', supports: { melody_conditioning: true } }
const withProviders = { providers: [provider], stems: {} } as unknown as MusicCapabilities
const none = { providers: [], stems: {} } as unknown as MusicCapabilities
const FAST = [5, 5] // stable references — the hook keeps the delays as an effect dependency
const SLOW = [40, 40, 40]

describe('useMusicCapabilities', () => {
  beforeEach(() => getMusicCapabilities.mockReset())
  afterEach(() => vi.useRealTimers())

  it('does not ask until the sidecar is ready, then fetches when it becomes ready (the "started it after opening the tab" bug)', async () => {
    getMusicCapabilities.mockResolvedValue(withProviders)
    const { result, rerender } = renderHook(({ ready }) => useMusicCapabilities(ready, FAST), { initialProps: { ready: false } })
    expect(getMusicCapabilities).not.toHaveBeenCalled()
    expect(result.current.capabilities).toBeNull()
    expect(result.current.loading).toBe(false)

    rerender({ ready: true })
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.capabilities?.providers).toHaveLength(1))
    expect(result.current.loading).toBe(false)
    expect(result.current.failed).toBe(false)
  })

  it('treats an empty list from a running sidecar as "not up yet" and asks again', async () => {
    getMusicCapabilities.mockResolvedValueOnce(none).mockResolvedValueOnce(none).mockResolvedValue(withProviders)
    const { result } = renderHook(() => useMusicCapabilities(true, FAST))
    await waitFor(() => expect(result.current.capabilities?.providers).toHaveLength(1))
    expect(getMusicCapabilities).toHaveBeenCalledTimes(3)
  })

  it('survives request errors while retrying', async () => {
    getMusicCapabilities.mockRejectedValueOnce(new Error('502')).mockResolvedValue(withProviders)
    const { result } = renderHook(() => useMusicCapabilities(true, FAST))
    await waitFor(() => expect(result.current.capabilities).not.toBeNull())
  })

  it('gives up after its retries with failed=true, and retry() tries again', async () => {
    getMusicCapabilities.mockResolvedValue(none)
    const { result } = renderHook(() => useMusicCapabilities(true, FAST))
    await waitFor(() => expect(result.current.failed).toBe(true))
    expect(getMusicCapabilities).toHaveBeenCalledTimes(FAST.length + 1)
    expect(result.current.loading).toBe(false)

    getMusicCapabilities.mockResolvedValue(withProviders)
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.capabilities).not.toBeNull())
    expect(result.current.failed).toBe(false)
  })

  it('stops retrying once the sidecar goes away', async () => {
    getMusicCapabilities.mockResolvedValue(none)
    const { rerender } = renderHook(({ ready }) => useMusicCapabilities(ready, SLOW), { initialProps: { ready: true } })
    await waitFor(() => expect(getMusicCapabilities).toHaveBeenCalledTimes(1))
    rerender({ ready: false })
    const calls = getMusicCapabilities.mock.calls.length
    await new Promise(r => setTimeout(r, 200))
    expect(getMusicCapabilities.mock.calls.length).toBe(calls)
  })
})
