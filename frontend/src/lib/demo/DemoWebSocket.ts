// Stands in for the global `WebSocket` constructor in demo mode. ChatSocket (lib/ws.ts)
// does `new WebSocket(...)` directly with no injectable transport — but it only ever
// touches readyState/onopen/onmessage/onclose/onerror/send()/close(), so a class with
// that shape works transparently with zero changes to ws.ts. Same pattern ws.test.ts
// already proves via `vi.stubGlobal('WebSocket', FakeWebSocket)`.
import type { ChatPayload, WsMessage } from '../ws'
import { chatStore } from './chatStore'
import { runScenario, resumeApproval } from './chatScenarios'

type ApprovalResponse = { type: 'approval_response'; request_id: string; approved: boolean }

export class DemoWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  readyState = DemoWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  url: string

  constructor(url: string) {
    this.url = url
    // A brief delay so the composer's "Connecting…" state is visible for a beat,
    // same as a real connection — instant would look suspicious, not impressive.
    setTimeout(() => {
      this.readyState = DemoWebSocket.OPEN
      this.onopen?.()
    }, 150)
  }

  send(data: string) {
    const payload = JSON.parse(data) as ChatPayload | ApprovalResponse
    if ('type' in payload && payload.type === 'approval_response') {
      resumeApproval(payload.request_id, payload.approved)
      return
    }
    const chat = payload as ChatPayload
    const isNew = chat.conversation_id == null
    const conv = chatStore.ensureConversation(chat.conversation_id, chat.persona, chat.model, chat.message.slice(0, 60))
    chatStore.appendMessage(conv.id, 'user', chat.message)
    if (isNew) this.emit({ type: 'conversation_id', id: conv.id })
    runScenario(chat, (msg) => this.emit(msg), (text) => {
      if (text.trim()) chatStore.appendMessage(conv.id, 'assistant', text)
    })
  }

  private emit(msg: WsMessage) {
    this.onmessage?.({ data: JSON.stringify(msg) })
  }

  close() {
    this.readyState = DemoWebSocket.CLOSED
    this.onclose?.()
  }
}
