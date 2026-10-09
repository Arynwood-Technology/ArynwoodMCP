import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UpdateNotice } from './UpdateNotice'
import { checkForUpdate, openRelease, UPDATE_INTERVAL_MS } from '../../lib/updates'

vi.mock('../../lib/updates', () => ({ checkForUpdate: vi.fn(), openRelease: vi.fn(), UPDATE_INTERVAL_MS: 21600000 }))
const demo = vi.hoisted(() => ({ DEMO: false }))
vi.mock('../../lib/demo/flag', () => demo)
const update = { version: '0.4.9', url: 'https://github.com/Arynwood-Technology/ArynwoodMCP/releases/tag/v0.4.9' }
const flush = async () => { await act(async () => { await Promise.resolve() }) }

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  demo.DEMO = false
  vi.mocked(checkForUpdate).mockReset().mockResolvedValue(update)
  vi.mocked(openRelease).mockReset().mockResolvedValue()
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('automatic update notice', () => {
  it('checks at startup and periodically, opens on click, and remembers dismissal', async () => {
    const view = render(<UpdateNotice />)
    await flush()
    expect(screen.getByRole('status')).toHaveTextContent('0.4.9 is available')
    fireEvent.click(screen.getByText('View update'))
    expect(openRelease).toHaveBeenCalledWith(update.url)
    fireEvent.click(screen.getByLabelText('Dismiss update notification'))
    expect(screen.queryByRole('status')).toBeNull()
    view.unmount()
    render(<UpdateNotice />)
    await flush()
    expect(screen.queryByRole('status')).toBeNull()
    vi.mocked(checkForUpdate).mockResolvedValue({ ...update, version: '0.4.10' })
    await act(async () => { await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS) })
    expect(screen.getByRole('status')).toHaveTextContent('0.4.10 is available')
  })
  it('stays quiet when current or offline and retries later', async () => {
    vi.mocked(checkForUpdate).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(null)
    render(<UpdateNotice />)
    await flush()
    expect(screen.queryByRole('status')).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS) })
    expect(checkForUpdate).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('status')).toBeNull()
  })
  it('aborts slow requests after ten seconds and on unmount', async () => {
    vi.mocked(checkForUpdate).mockImplementation(() => new Promise(() => {}))
    const view = render(<UpdateNotice />)
    const signal = vi.mocked(checkForUpdate).mock.calls[0][0]
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(signal.aborted).toBe(true)
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('aborts an active request on unmount and ignores a late response', async () => {
    let finish!: (value: typeof update) => void
    vi.mocked(checkForUpdate).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const view = render(<UpdateNotice />)
    const signal = vi.mocked(checkForUpdate).mock.calls[0][0]
    view.unmount()
    expect(signal.aborted).toBe(true)
    await act(async () => { finish(update) })
    expect(screen.queryByRole('status')).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('surfaces browser failures without navigating the app', async () => {
    vi.mocked(openRelease).mockRejectedValue(new Error('browser unavailable'))
    render(<UpdateNotice />)
    await flush()
    fireEvent.click(screen.getByText('View update'))
    await flush()
    expect(screen.getByRole('alert')).toHaveTextContent(update.url)
  })
  it('does not contact GitHub in the public demo', async () => {
    demo.DEMO = true
    render(<UpdateNotice />)
    await flush()
    expect(checkForUpdate).not.toHaveBeenCalled()
  })
})
