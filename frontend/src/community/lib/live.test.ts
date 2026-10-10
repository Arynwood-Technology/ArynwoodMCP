import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useSpaceRefresh } from './live'

class FakeEventSource {
  static CONNECTING = 0; static OPEN = 1; static CLOSED = 2
  static opened: FakeEventSource[] = []
  readyState = FakeEventSource.CONNECTING
  listeners: Record<string, (() => void)[]> = {}
  closed = false
  url: string
  constructor(url: string) { this.url = url; FakeEventSource.opened.push(this) }
  addEventListener(name: string, fn: () => void) { (this.listeners[name] ??= []).push(fn) }
  emit(name: string) { if (name === 'open') this.readyState = FakeEventSource.OPEN; this.listeners[name]?.forEach(fn => fn()) }
  close() { this.closed = true; this.readyState = FakeEventSource.CLOSED }
}

beforeEach(() => { vi.useFakeTimers(); FakeEventSource.opened = []; vi.stubGlobal('EventSource', FakeEventSource) })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

it('refetches once per burst of changes another member makes', () => {
  const refresh = vi.fn()
  renderHook(() => useSpaceRefresh('home', refresh, 3000))
  const [source] = FakeEventSource.opened
  // Through Arynwood's backend, which holds the Grove sign-in.
  expect(source.url).toBe('/api/community/grove/community/spaces/home/events')
  source.emit('open')
  source.emit('changed'); source.emit('changed'); source.emit('changed')
  vi.advanceTimersByTime(200)
  expect(refresh).toHaveBeenCalledTimes(1)
})

it('polls only as a safety net while notices are arriving', () => {
  const refresh = vi.fn()
  renderHook(() => useSpaceRefresh('home', refresh, 3000))
  FakeEventSource.opened[0].emit('open')
  vi.advanceTimersByTime(57_000)
  expect(refresh).not.toHaveBeenCalled()
  vi.advanceTimersByTime(3_000)
  expect(refresh).toHaveBeenCalledTimes(1)
})

it('rides out the routine reconnect but polls when the connection is lost', () => {
  const refresh = vi.fn()
  renderHook(() => useSpaceRefresh('home', refresh, 3000))
  const [source] = FakeEventSource.opened
  source.emit('open')
  source.readyState = FakeEventSource.CONNECTING; source.emit('error')
  vi.advanceTimersByTime(3_000)
  expect(refresh).not.toHaveBeenCalled()
  source.readyState = FakeEventSource.CLOSED  // e.g. removed from the space
  vi.advanceTimersByTime(3_000)
  expect(refresh).toHaveBeenCalledTimes(1)
})

it('refetches at once when the server refuses the stream, so a removed member finds out', () => {
  const refresh = vi.fn()
  renderHook(() => useSpaceRefresh('home', refresh, 15000))
  const [source] = FakeEventSource.opened
  source.emit('open')
  source.readyState = FakeEventSource.CLOSED; source.emit('error')
  expect(refresh).toHaveBeenCalledTimes(1)
})

it('polls on its own where the browser has no EventSource', () => {
  vi.stubGlobal('EventSource', undefined)
  const refresh = vi.fn()
  renderHook(() => useSpaceRefresh('home', refresh, 3000))
  vi.advanceTimersByTime(9_000)
  expect(refresh).toHaveBeenCalledTimes(3)
})

it('closes the stream when the space changes or the page leaves', () => {
  const { rerender, unmount } = renderHook(({ id }) => useSpaceRefresh(id, () => {}, 3000), { initialProps: { id: 'home' } })
  rerender({ id: 'team' })
  expect(FakeEventSource.opened.map(s => [s.url.match(/spaces\/([^/]+)\/events/)?.[1], s.closed])).toEqual([['home', true], ['team', false]])
  unmount()
  expect(FakeEventSource.opened[1].closed).toBe(true)
})
