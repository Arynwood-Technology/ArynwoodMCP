import { describe, expect, it } from 'vitest'
import { summarizeEvidence } from './evidence'

describe('summarizeEvidence', () => {
  it('summarizes a typical run in reading order', () => {
    const lines = summarizeEvidence([
      { kind: 'memory', ids: [4, 5], project_id: 1 },
      { kind: 'knowledge', semantic_available: true, sources: [{ title: 'Studio Handbook v2', source_id: 10 }] },
      { kind: 'context_budget', estimated_tokens: 4205, budget_tokens: 7168, dropped_turns: 0, shortened_blocks: 0 },
      { kind: 'web_search', query: 'blender release', status: 'ok', result: 'Web search results for: x\n- a\n- b' },
      { kind: 'context_budget', round: 1, estimated_tokens: 4800, budget_tokens: 7168, dropped_turns: 0, shortened_blocks: 0 },
    ]).map(l => l.text)
    expect(lines).toEqual([
      'Memory: 2 saved notes (#4, #5)',
      'Knowledge base: Studio Handbook v2',
      'Web search for “blender release”: 2 results',
      `Context: ~${(4800).toLocaleString()} of ${(7168).toLocaleString()} tokens`,
    ])
  })

  it('flags degraded services and trimming instead of hiding them', () => {
    const lines = summarizeEvidence([
      { kind: 'memory', ids: [] },
      { kind: 'knowledge', semantic_available: false, sources: [] },
      { kind: 'web_search', query: 'q', status: 'unavailable', result: '' },
      { kind: 'tool_service', server: 'kdenlive', outcome: 'unavailable' },
      { kind: 'context_budget', estimated_tokens: 7000, budget_tokens: 7168, dropped_turns: 3, shortened_blocks: 1 },
    ])
    expect(lines.map(l => l.text)).toContain('Memory: nothing saved matched')
    expect(lines.filter(l => l.warn).map(l => l.text)).toEqual([
      'Knowledge base semantic search was offline — keyword matches only',
      'Web search for “q” failed — search was unavailable',
      'kdenlive was unavailable',
      '3 older turns left out to fit the model (summarized instead)',
      '1 long evidence block was shortened to fit',
    ])
  })

  it('treats pre-status web_search evidence by its result, and ignores unknown kinds', () => {
    const lines = summarizeEvidence([
      { kind: 'web_search', query: 'old', result: '' },
      { kind: 'something_new', whatever: 1 },
    ])
    expect(lines.map(l => l.text)).toEqual(['Web search for “old” found nothing'])
  })
})
