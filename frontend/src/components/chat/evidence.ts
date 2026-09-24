// Turns a chat run's evidence trail (backend runtime_context.record_evidence) into short,
// readable lines. Unknown kinds are ignored so a new backend evidence kind never breaks the UI.

export type EvidenceItem = Record<string, unknown> & { kind?: string }

export interface EvidenceLine {
  text: string
  /** Something degraded (a service offline, context trimmed) — worth drawing the eye to. */
  warn?: boolean
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

export function summarizeEvidence(evidence: EvidenceItem[]): EvidenceLine[] {
  const lines: EvidenceLine[] = []
  const memoryIds = new Set<number>()
  let memoryChecked = false
  const kbTitles = new Set<string>()
  let kbOffline = false
  let lastBudget: EvidenceItem | null = null
  let dropped = 0
  let shortened = 0

  for (const e of evidence) {
    switch (e.kind) {
      case 'memory':
        memoryChecked = true
        for (const id of arr(e.ids)) if (typeof id === 'number') memoryIds.add(id)
        break
      case 'knowledge':
        if (e.semantic_available === false) kbOffline = true
        for (const s of arr(e.sources)) {
          const title = str((s as EvidenceItem)?.title) || str((s as EvidenceItem)?.source)
          if (title) kbTitles.add(title)
        }
        break
      case 'web_search': {
        const query = str(e.query)
        const status = str(e.status) || (str(e.result) ? 'ok' : 'no_matches')
        const hits = str(e.result).split('\n').filter(l => l.startsWith('- ')).length
        if (status === 'unavailable') lines.push({ text: `Web search for “${query}” failed — search was unavailable`, warn: true })
        else if (status === 'no_matches' || hits === 0) lines.push({ text: `Web search for “${query}” found nothing` })
        else lines.push({ text: `Web search for “${query}”: ${hits} result${hits === 1 ? '' : 's'}` })
        break
      }
      case 'tool':
        lines.push({
          text: `${str(e.server) || 'Tool'} · ${str(e.tool)} — ${str(e.outcome) || 'done'}`,
          warn: e.outcome === 'error' || e.outcome === 'denied',
        })
        break
      case 'tool_service':
        lines.push({ text: `${str(e.server) || 'A tool server'} was unavailable`, warn: true })
        break
      case 'summary':
        if (e.status === 'unavailable') lines.push({ text: 'Older messages could not be summarized this turn', warn: true })
        break
      case 'context_budget':
        lastBudget = e
        dropped = Math.max(dropped, Number(e.dropped_turns) || 0)
        shortened = Math.max(shortened, Number(e.shortened_blocks) || 0)
        break
    }
  }

  const head: EvidenceLine[] = []
  if (memoryChecked) {
    head.push(memoryIds.size
      ? { text: `Memory: ${memoryIds.size} saved note${memoryIds.size === 1 ? '' : 's'} (${[...memoryIds].map(id => `#${id}`).join(', ')})` }
      : { text: 'Memory: nothing saved matched' })
  }
  if (kbTitles.size) head.push({ text: `Knowledge base: ${[...kbTitles].join(', ')}` })
  if (kbOffline) head.push({ text: 'Knowledge base semantic search was offline — keyword matches only', warn: true })

  const tail: EvidenceLine[] = []
  if (lastBudget) {
    const used = Number(lastBudget.estimated_tokens) || 0
    const limit = Number(lastBudget.budget_tokens) || 0
    if (used && limit) tail.push({ text: `Context: ~${used.toLocaleString()} of ${limit.toLocaleString()} tokens` })
  }
  if (dropped) tail.push({ text: `${dropped} older turn${dropped === 1 ? '' : 's'} left out to fit the model (summarized instead)`, warn: true })
  if (shortened) tail.push({ text: `${shortened} long evidence block${shortened === 1 ? ' was' : 's were'} shortened to fit`, warn: true })

  return [...head, ...lines, ...tail]
}
