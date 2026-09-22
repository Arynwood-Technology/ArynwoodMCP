// Curated, scripted chat conversations for the demo build. Exact-string matched (via
// pickScenario, in prompts.ts) against the same prompts rendered as clickable chips in
// Chat.tsx — no fuzzy matching, one source of truth for "what the demo can answer."
// Glyph's scenario is the showcase: it drives a real approval_request/approval_response
// round-trip through Chat.tsx's actual, unmodified approval UI.
//
// Deliberately NOT imported by Chat.tsx (only by DemoWebSocket.ts, reached solely via
// main.tsx's dynamic bootstrap import) — the prompt *labels* live in the tiny prompts.ts
// instead, so the real app's bundle never carries this scripted reply content.
import type { WsMessage, ChatPayload } from '../ws'
import { pickScenario } from './prompts'

// --- Step vocabulary -------------------------------------------------------

type ContextUsedMsg = Extract<WsMessage, { type: 'context_used' }>
type KbSource = ContextUsedMsg['kb_sources'][number]

type Step =
  | { kind: 'status'; label: string }
  | { kind: 'tokens'; text: string }
  | { kind: 'context_used'; web_search?: boolean; kb_sources?: KbSource[]; tool_servers?: string[] }
  | { kind: 'memory_saved'; items: { title: string; type: string; status?: string }[] }
  | { kind: 'approval'; tool: string; arguments: Record<string, unknown>; tier: string; onApprove: Step[]; onDeny: Step[] }
  | { kind: 'action_result'; name: string; ok: boolean; response?: string }

interface Scenario { steps: Step[] }

const REPO_LINK = 'https://github.com/Arynwood-Technology/ArynwoodMCP'

const SCENARIOS: Record<string, Scenario> = {
  'central-overview': {
    steps: [
      { kind: 'status', label: 'Thinking…' },
      {
        kind: 'tokens',
        text:
          "I coordinate the rest of the app: I can search the web, search your knowledge base and memory, " +
          "and drive tool-calling into a running Kdenlive instance — cutting, trimming, adding transitions, " +
          "the whole timeline. Doc, Kona, Glyph and Estra each specialize further — architecture, creative " +
          "brainstorming, automation, and writing. Everything you see in this demo is scripted, but the real " +
          `app runs entirely on your own machine against your own local models. See it on GitHub: ${REPO_LINK}`,
      },
      { kind: 'context_used', tool_servers: ['Kdenlive'] },
    ],
  },
  'doc-review': {
    steps: [
      { kind: 'status', label: 'Checking your knowledge base…' },
      {
        kind: 'tokens',
        text:
          "Structurally this looks like a fairly standard 4-layer app — frontend, backend, config, external " +
          "services. The thing I'd flag first in a real review is coupling: anywhere a router reaches directly " +
          "into another domain's tables instead of going through its own service layer is where changes get " +
          "expensive later. Want me to point at a specific file or module next time you're in the real app?",
      },
      { kind: 'context_used', kb_sources: [{ title: 'Project style guide', source: 'style-guide.md', source_id: 1, score: 0.81, page_start: null, page_end: null }] },
    ],
  },
  'kona-moodboard': {
    steps: [
      { kind: 'status', label: 'Thinking…' },
      {
        kind: 'tokens',
        text:
          '1. **Phosphor Noir** — deep violet-black backgrounds, a single hot-pink scanline glow, chunky ' +
          'CRT-bloom type. 2. **Chromewave** — brushed-metal gradients, thin neon wireframe grids, a cooler ' +
          'cyan-and-magenta split. 3. **Sunset Circuit** — warmer, more analog: orange-to-purple sky gradient ' +
          'behind a stark black grid horizon, less glow, more print-poster flat color. I can generate real ' +
          'mockups of any of these in the full app — it has Stable Diffusion built in.',
      },
    ],
  },
  'glyph-approval': {
    steps: [
      { kind: 'status', label: 'Checking your Kdenlive project…' },
      { kind: 'tokens', text: "Found one leftover draft track — an unused voiceover take (\"draft-vo-2\") that isn't referenced anywhere else in the timeline. I'd like to delete it." },
      {
        kind: 'approval',
        tool: 'delete_track',
        tier: 'destructive',
        arguments: { track_id: 'draft-vo-2', reason: 'unused voiceover draft, not referenced elsewhere in the timeline' },
        onApprove: [
          { kind: 'action_result', name: 'delete_track', ok: true, response: 'Deleted draft-vo-2' },
          { kind: 'tokens', text: ' Deleted draft-vo-2 — timeline is clean.' },
        ],
        onDeny: [
          { kind: 'tokens', text: " Understood, I won't touch it. Let me know if you want me to look at anything else." },
        ],
      },
    ],
  },
  'estra-edit': {
    steps: [
      { kind: 'status', label: 'Thinking…' },
      {
        kind: 'tokens',
        text:
          'Paste the paragraph and I\'ll tighten it — in the real app I\'d cut filler words, collapse ' +
          'passive constructions, and flag anywhere the rhythm goes flat. For this demo, here\'s the kind of ' +
          'edit I mean, applied to a sample sentence: "The system, which was designed by the team, is ' +
          'currently being used by many users" → "The team\'s system now serves thousands of users." Fewer ' +
          "words, an actual subject, no throat-clearing.",
      },
    ],
  },
  fallback: {
    steps: [
      { kind: 'status', label: 'Thinking…' },
      {
        kind: 'tokens',
        text:
          "This demo only replays a few scripted conversations — free-text replies aren't simulated. Try one " +
          `of the prompts above, or install Arynwood locally (${REPO_LINK}) to chat with a real model over ` +
          'your own data.',
      },
    ],
  },
}

// --- Runner ------------------------------------------------------------------

const TOKEN_DELAY_MS = [15, 35] as const
const STEP_PAUSE_MS = 220

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

function randDelay(): number {
  const [lo, hi] = TOKEN_DELAY_MS
  return lo + Math.random() * (hi - lo)
}

// Splits into small chunks (~1-3 words) so streaming looks like real token output
// without needing a real tokenizer.
function chunkTokens(text: string): string[] {
  const words = text.split(/(\s+)/) // keep whitespace as its own chunk
  const chunks: string[] = []
  let buf = ''
  let wordCount = 0
  for (const w of words) {
    buf += w
    if (w.trim() !== '') wordCount++
    if (wordCount >= 2 && w.trim() !== '') {
      chunks.push(buf)
      buf = ''
      wordCount = 0
    }
  }
  if (buf) chunks.push(buf)
  return chunks
}

type Emit = (msg: WsMessage) => void

// Paused approval steps, keyed by request_id, so a later approval_response can resume
// the right scenario from the right point.
const pending = new Map<string, { emit: Emit; onApprove: Step[]; onDeny: Step[]; assembled: string; appendAssistant: (text: string) => void }>()

let requestCounter = 0

async function runSteps(steps: Step[], emit: Emit, assembledRef: { text: string }, appendAssistant: (text: string) => void) {
  for (const step of steps) {
    switch (step.kind) {
      case 'status':
        emit({ type: 'status', label: step.label })
        await sleep(STEP_PAUSE_MS)
        break
      case 'tokens':
        for (const chunk of chunkTokens(step.text)) {
          emit({ type: 'token', token: chunk, done: false })
          assembledRef.text += chunk
          await sleep(randDelay())
        }
        break
      case 'context_used':
        emit({
          type: 'context_used',
          web_search: step.web_search ?? false,
          kb_sources: step.kb_sources ?? [],
          tool_servers: step.tool_servers ?? [],
        })
        await sleep(STEP_PAUSE_MS)
        break
      case 'memory_saved':
        emit({ type: 'memory_saved', items: step.items })
        await sleep(STEP_PAUSE_MS)
        break
      case 'action_result':
        emit({ type: 'action_result', name: step.name, ok: step.ok, response: step.response })
        await sleep(STEP_PAUSE_MS)
        break
      case 'approval': {
        const requestId = `demo-${++requestCounter}`
        emit({ type: 'approval_request', request_id: requestId, tool: step.tool, arguments: step.arguments, tier: step.tier })
        pending.set(requestId, { emit, onApprove: step.onApprove, onDeny: step.onDeny, assembled: assembledRef.text, appendAssistant })
        return // pause here — resumeApproval() continues when the response arrives
      }
    }
  }
  // Reached the natural end of this step list (no pending approval) — finish the turn.
  appendAssistant(assembledRef.text)
  emit({ type: 'token', token: '', done: true })
}

export function runScenario(payload: ChatPayload, emit: Emit, appendAssistant: (text: string) => void) {
  const id = pickScenario(payload.message)
  const scenario = SCENARIOS[id] ?? SCENARIOS.fallback
  void runSteps(scenario.steps, emit, { text: '' }, appendAssistant)
}

export function resumeApproval(requestId: string, approved: boolean) {
  const paused = pending.get(requestId)
  if (!paused) return
  pending.delete(requestId)
  const { emit, onApprove, onDeny, assembled, appendAssistant } = paused
  const steps = approved ? onApprove : onDeny
  void runSteps(steps, emit, { text: assembled }, appendAssistant)
}
