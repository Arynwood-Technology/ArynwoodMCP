import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ChatSocket } from './ws'

/** Minimal controllable stand-in for the browser WebSocket. */
class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: FakeWebSocket[] = []

  readyState = FakeWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []
  closeCalls = 0

  url: string
  constructor(url: string) { this.url = url; FakeWebSocket.instances.push(this) }

  send(data: string) { this.sent.push(data) }
  close() { this.closeCalls++; this.readyState = FakeWebSocket.CLOSED }

  // Test drivers
  serverOpens() { this.readyState = FakeWebSocket.OPEN; this.onopen?.() }
  serverDrops() { this.readyState = FakeWebSocket.CLOSED; this.onclose?.() }
}

const latest = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1]

describe('ChatSocket', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', FakeWebSocket)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function make() {
    const onMessage = vi.fn()
    const onOpen = vi.fn()
    const onClose = vi.fn()
    const sock = new ChatSocket(onMessage, onOpen, onClose)
    return { sock, onMessage, onOpen, onClose }
  }

  it('reports open and delivers parsed messages', () => {
    const { sock, onOpen, onMessage } = make()
    sock.connect()
    latest().serverOpens()
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(sock.ready).toBe(true)
    latest().onmessage?.({ data: JSON.stringify({ type: 'token', token: 'hi', done: false }) })
    expect(onMessage).toHaveBeenCalledWith({ type: 'token', token: 'hi', done: false })
  })

  it('reconnects with growing backoff after an unexpected drop, and resets once open', () => {
    const { sock, onClose, onOpen } = make()
    sock.connect()
    latest().serverOpens()

    latest().serverDrops()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(FakeWebSocket.instances).toHaveLength(1)   // not immediate
    vi.advanceTimersByTime(999)
    expect(FakeWebSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)                          // 1s
    expect(FakeWebSocket.instances).toHaveLength(2)

    latest().serverDrops()                             // never opened: backoff grows
    vi.advanceTimersByTime(1999)
    expect(FakeWebSocket.instances).toHaveLength(2)
    vi.advanceTimersByTime(1)                          // 2s
    expect(FakeWebSocket.instances).toHaveLength(3)

    latest().serverOpens()                             // success resets the backoff
    expect(onOpen).toHaveBeenCalledTimes(2)
    latest().serverDrops()
    vi.advanceTimersByTime(1000)
    expect(FakeWebSocket.instances).toHaveLength(4)
  })

  it('caps the backoff at 10s', () => {
    const { sock } = make()
    sock.connect()
    for (let i = 0; i < 8; i++) { latest().serverDrops(); vi.advanceTimersByTime(10_000) }
    const before = FakeWebSocket.instances.length
    latest().serverDrops()
    vi.advanceTimersByTime(9_999)
    expect(FakeWebSocket.instances).toHaveLength(before)
    vi.advanceTimersByTime(1)
    expect(FakeWebSocket.instances).toHaveLength(before + 1)
  })

  it('does not reconnect, or notify, after an intentional disconnect()', () => {
    const { sock, onClose } = make()
    sock.connect()
    const ws = latest()
    ws.serverOpens()
    sock.disconnect()
    expect(ws.closeCalls).toBe(1)
    ws.serverDrops()                                   // late close event from the torn-down socket
    vi.advanceTimersByTime(60_000)
    expect(onClose).not.toHaveBeenCalled()
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(sock.ready).toBe(false)
  })

  it('cancels a pending reconnect when disconnect() is called', () => {
    const { sock } = make()
    sock.connect()
    latest().serverOpens()
    latest().serverDrops()                             // reconnect now scheduled
    sock.disconnect()
    vi.advanceTimersByTime(60_000)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('defers closing a still-CONNECTING socket until it opens (no "closed before established" warning)', () => {
    const { sock, onOpen } = make()
    sock.connect()
    const ws = latest()
    sock.disconnect()                                  // e.g. React StrictMode's mount/unmount/mount
    expect(ws.closeCalls).toBe(0)
    ws.serverOpens()
    expect(ws.closeCalls).toBe(1)
    expect(onOpen).not.toHaveBeenCalled()              // caller has already moved on
  })

  it('a stale socket from a previous connect() cannot clobber the current one', () => {
    const { sock, onClose } = make()
    sock.connect()
    const first = latest()
    sock.disconnect()
    sock.connect()                                     // StrictMode-style remount on the same instance
    const second = latest()
    second.serverOpens()
    first.serverDrops()                                // late close from the discarded socket
    expect(onClose).not.toHaveBeenCalled()
    expect(sock.ready).toBe(true)
  })

  it('send() and sendApprovalResponse() only write to an open socket', () => {
    const { sock } = make()
    sock.connect()
    const payload = { message: 'hi', persona: 'central', model: 'm', server_host: 'h', server_port: 1 }
    sock.send(payload)
    sock.sendApprovalResponse('r1', true)
    expect(latest().sent).toEqual([])
    latest().serverOpens()
    sock.send(payload)
    sock.sendApprovalResponse('r1', false)
    expect(latest().sent.map(s => JSON.parse(s))).toEqual([
      payload,
      { type: 'approval_response', request_id: 'r1', approved: false },
    ])
  })
})
