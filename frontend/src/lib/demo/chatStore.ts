// Shared in-memory conversation/message state for the demo build. Written by
// DemoWebSocket as a scenario streams, read by fetchInterceptor's conversation/message
// GET routes — one source of truth, so Chat.tsx's post-reply re-fetch (GET
// /chat/conversations/:id/messages) can never drift from what was just streamed and
// cause a visible flicker. Session-only: nothing here persists across a page reload,
// same as every other piece of demo state.
import type { Conversation, Message } from '../api'
import { SEED_CONVERSATION, SEED_MESSAGES } from './fixtures'

let nextConvId = SEED_CONVERSATION.id + 1
let nextMsgId = Math.max(...SEED_MESSAGES.map(m => m.id)) + 1

const conversations: Conversation[] = [SEED_CONVERSATION]
const messages: Record<number, Message[]> = { [SEED_CONVERSATION.id]: [...SEED_MESSAGES] }

function nowIso(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

export const chatStore = {
  get conversations(): Conversation[] {
    // Most-recently-updated first, matching the real backend's ORDER BY.
    return [...conversations].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  },

  getMessages(id: number): Message[] {
    return messages[id] ?? []
  },

  /** Reuses an existing conversation id if given one, otherwise mints a new one. */
  ensureConversation(id: number | undefined, persona: string, model: string, title: string): Conversation {
    if (id != null) {
      const existing = conversations.find(c => c.id === id)
      if (existing) return existing
    }
    const conv: Conversation = {
      id: nextConvId++,
      title,
      persona,
      model,
      server_id: 1,
      created_at: nowIso(),
      updated_at: nowIso(),
    }
    conversations.push(conv)
    messages[conv.id] = []
    return conv
  },

  appendMessage(convId: number, role: 'user' | 'assistant', content: string): Message {
    const msg: Message = { id: nextMsgId++, conversation_id: convId, role, content, created_at: nowIso() }
    ;(messages[convId] ??= []).push(msg)
    const conv = conversations.find(c => c.id === convId)
    if (conv) conv.updated_at = nowIso()
    return msg
  },

  deleteConversation(id: number): { deleted: number } {
    const idx = conversations.findIndex(c => c.id === id)
    if (idx !== -1) conversations.splice(idx, 1)
    delete messages[id]
    return { deleted: id }
  },
}
