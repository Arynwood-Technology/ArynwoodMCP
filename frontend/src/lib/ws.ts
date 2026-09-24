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
  | { type: 'cancelled' }
  | { type: 'turn_completed'; run_id: string; status: string; evidence: Record<string, unknown>[] }

export type ChatPayload = {
  message: string
  persona: string
  model: string
  server_host: string
  server_port: number
  conversation_id?: number
  server_id?: number
  project_id?: number
}

// Reconnect delay: 1s, 2s, 4s, 8s, then 10s. Starting quickly matters — in the packaged
// app the frontend can load a few seconds before the bundled backend is accepting
// connections, and without a retry the composer would sit at "Connecting…" forever.
const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 10_000

export class ChatSocket {
  private ws: WebSocket | null = null
  private onMessage: (msg: WsMessage) => void
  private onOpen?: () => void
  private onClose?: () => void
  private closedByCaller = false
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private attempt = 0

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
    this.closedByCaller = false
    this.open()
  }

  private open() {
    // In production (Tauri) the page is served from file:// or tauri://,
    // so we must use an absolute WebSocket URL pointing at the backend.
    const base = import.meta.env.PROD
      ? 'ws://localhost:8010'
      : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
    const ws = new WebSocket(`${base}/api/chat/ws`)
    this.ws = ws
    // Every handler ignores events from a socket that is no longer `this.ws` — a close
    // event arriving late from a discarded socket must not flip the UI to "disconnected"
    // while its replacement is healthy (React StrictMode's mount/unmount/mount hits this).
    ws.onopen = () => {
      if (this.ws !== ws) return
      this.attempt = 0
      this.onOpen?.()
    }
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.ws = null
      this.onClose?.()
      this.scheduleReconnect()
    }
    ws.onmessage = (e) => {
      if (this.ws !== ws) return
      try {
        this.onMessage(JSON.parse(e.data))
      } catch (err) {
        console.warn('Failed to parse chat WS message:', err, e.data)
      }
    }
  }

  private scheduleReconnect() {
    if (this.closedByCaller) return
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.attempt, RECONNECT_MAX_MS)
    this.attempt++
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      if (!this.closedByCaller) this.open()
    }, delay)
  }

  send(payload: ChatPayload) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload))
    }
  }

  cancel() {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'cancel' }))
  }

  // Response to an 'approval_request' (roadmap 2.3) — a distinct send path from
  // send() because this doesn't start a new turn, it answers one already in
  // progress. The backend is paused mid-turn waiting for exactly this shape.
  sendApprovalResponse(requestId: string, approved: boolean) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'approval_response', request_id: requestId, approved }))
    }
  }

  /** Intentional teardown (unmount): stops reconnecting and silences the old socket. */
  disconnect() {
    this.closedByCaller = true
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null }
    const ws = this.ws
    this.ws = null
    if (!ws) return
    ws.onmessage = null
    ws.onclose = null
    ws.onerror = null
    if (ws.readyState === WebSocket.CONNECTING) {
      // close() on a still-connecting socket makes the browser log "WebSocket is closed
      // before the connection is established" — wait for it to open, then close quietly.
      ws.onopen = () => ws.close()
    } else {
      ws.onopen = null
      ws.close()
    }
  }

  get ready() {
    return this.ws?.readyState === WebSocket.OPEN
  }
}
