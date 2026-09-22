import { describe, it, expect } from 'vitest'
import { DemoWebSocket } from './DemoWebSocket'
import type { WsMessage, ChatPayload } from '../ws'

/** Polls until `predicate()` is true or times out — real timers, since DemoWebSocket's
 *  scripted delays are genuinely short (a few hundred ms worst case). */
async function waitFor(predicate: () => boolean, timeoutMs = 3000) {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise(r => setTimeout(r, 10))
  }
}

function makeSocket() {
  const events: WsMessage[] = []
  const sock = new DemoWebSocket('ws://ignored/api/chat/ws') as unknown as {
    readyState: number
    onopen: (() => void) | null
    onmessage: ((e: { data: string }) => void) | null
    send: (data: string) => void
    close: () => void
  }
  sock.onmessage = (e) => events.push(JSON.parse(e.data))
  return { sock, events }
}

const basePayload: ChatPayload = {
  message: '', persona: 'glyph', model: 'qwen2.5-coder:14b', server_host: 'localhost', server_port: 11434,
}

describe('DemoWebSocket', () => {
  it('opens asynchronously, matching the real WebSocket handshake feel', async () => {
    const { sock } = makeSocket()
    expect(sock.readyState).toBe(0) // CONNECTING
    let opened = false
    sock.onopen = () => { opened = true }
    await waitFor(() => opened)
    expect(sock.readyState).toBe(1) // OPEN
  })

  it('streams a curated scenario and ends with a final done token', async () => {
    const { sock, events } = makeSocket()
    sock.send(JSON.stringify({ ...basePayload, persona: 'estra', message: 'Can you tighten up this paragraph for me?' }))
    await waitFor(() => events.some(e => e.type === 'token' && e.done))
    expect(events.some(e => e.type === 'status')).toBe(true)
    expect(events.filter(e => e.type === 'token' && !e.done).length).toBeGreaterThan(0)
  })

  it('the Glyph approval showcase: pauses for approval, resumes on approve, emits action_result', async () => {
    const { sock, events } = makeSocket()
    sock.send(JSON.stringify({ ...basePayload, persona: 'glyph', message: 'Clean up the old draft tracks in my Kdenlive timeline' }))

    await waitFor(() => events.some(e => e.type === 'approval_request'))
    const approval = events.find(e => e.type === 'approval_request') as Extract<WsMessage, { type: 'approval_request' }>
    expect(approval.tier).toBe('destructive')
    expect(approval.tool).toBe('delete_track')
    // Turn must be paused — no completion yet.
    expect(events.some(e => e.type === 'token' && e.done)).toBe(false)

    sock.send(JSON.stringify({ type: 'approval_response', request_id: approval.request_id, approved: true }))
    await waitFor(() => events.some(e => e.type === 'token' && e.done))

    expect(events.some(e => e.type === 'action_result' && e.ok)).toBe(true)
  })

  it('a denied approval takes the deny branch instead, with no action_result', async () => {
    const { sock, events } = makeSocket()
    sock.send(JSON.stringify({ ...basePayload, persona: 'glyph', message: 'Clean up the old draft tracks in my Kdenlive timeline' }))
    await waitFor(() => events.some(e => e.type === 'approval_request'))
    const approval = events.find(e => e.type === 'approval_request') as Extract<WsMessage, { type: 'approval_request' }>

    sock.send(JSON.stringify({ type: 'approval_response', request_id: approval.request_id, approved: false }))
    await waitFor(() => events.some(e => e.type === 'token' && e.done))

    expect(events.some(e => e.type === 'action_result')).toBe(false)
  })

  it('free text that matches no curated prompt gets the honest scripted-fallback reply, not a fake answer', async () => {
    const { sock, events } = makeSocket()
    sock.send(JSON.stringify({ ...basePayload, persona: 'central', message: 'something nobody scripted' }))
    await waitFor(() => events.some(e => e.type === 'token' && e.done))

    const text = events.filter(e => e.type === 'token').map(e => (e as Extract<WsMessage, { type: 'token' }>).token).join('')
    expect(text).toMatch(/scripted conversations/i)
    expect(events.some(e => e.type === 'context_used')).toBe(false)
  })

  it('mints a conversation_id on the first turn only', async () => {
    const { sock, events } = makeSocket()
    sock.send(JSON.stringify({ ...basePayload, persona: 'central', message: 'What can you help me with?' }))
    await waitFor(() => events.some(e => e.type === 'conversation_id'))
    const first = events.find(e => e.type === 'conversation_id') as Extract<WsMessage, { type: 'conversation_id' }>
    expect(typeof first.id).toBe('number')

    await waitFor(() => events.some(e => e.type === 'token' && e.done))
    const countAfterFirstTurn = events.filter(e => e.type === 'conversation_id').length

    sock.send(JSON.stringify({ ...basePayload, persona: 'central', message: 'What can you help me with?', conversation_id: first.id }))
    await waitFor(() => events.filter(e => e.type === 'token' && e.done).length === 2)
    expect(events.filter(e => e.type === 'conversation_id').length).toBe(countAfterFirstTurn)
  })
})
