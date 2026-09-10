export type WsMessage =
  | { type: 'token'; token: string; done: boolean }
  | { type: 'conversation_id'; id: number }
  | { type: 'error'; message: string }
  | { type: 'action_result'; name: string; ok: boolean; status?: number; response?: string; error?: string }
  | { type: 'memory_saved'; items: { title: string; type: string; status?: string; conflict_with?: string }[] }
  | {
      type: 'context_used'
      web_search: boolean
      kb_sources: { title: string; source: string; source_id: number; score: number; page_start: number | null; page_end: number | null }[]
      tool_servers: string[]
    }
  | { type: 'approval_request'; request_id: string; tool: string; arguments: Record<string, unknown>; tier: string }
  | { type: 'status'; label: string }

export type ChatPayload = {
  message: string
  persona: string
  model: string
  server_host: string
  server_port: number
  conversation_id?: number
}

export class ChatSocket {
  private ws: WebSocket | null = null
  private onMessage: (msg: WsMessage) => void
  private onOpen?: () => void
  private onClose?: () => void

  constructor(
    onMessage: (msg: WsMessage) => void,
    onOpen?: () => void,
    onClose?: () => void,
  ) {
    this.onMessage = onMessage
    this.onOpen = onOpen
    this.onClose = onClose
  }

  connect() {
    // In production (Tauri) the page is served from file:// or tauri://,
    // so we must use an absolute WebSocket URL pointing at the backend.
    const base = import.meta.env.PROD
      ? 'ws://localhost:8010'
      : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
    this.ws = new WebSocket(`${base}/api/chat/ws`)
    this.ws.onopen = () => this.onOpen?.()
    this.ws.onclose = () => this.onClose?.()
    this.ws.onmessage = (e) => {
      try {
        this.onMessage(JSON.parse(e.data))
      } catch {}
    }
  }

  send(payload: ChatPayload) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload))
    }
  }

  // Response to an 'approval_request' (roadmap 2.3) — a distinct send path from
  // send() because this doesn't start a new turn, it answers one already in
  // progress. The backend is paused mid-turn waiting for exactly this shape.
  sendApprovalResponse(requestId: string, approved: boolean) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'approval_response', request_id: requestId, approved }))
    }
  }

  disconnect() {
    this.ws?.close()
    this.ws = null
  }

  get ready() {
    return this.ws?.readyState === WebSocket.OPEN
  }
}
