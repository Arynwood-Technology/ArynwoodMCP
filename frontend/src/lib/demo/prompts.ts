// Just the curated prompt labels — deliberately split out from chatScenarios.ts (which
// holds the actual scripted reply content) so Chat.tsx can statically import this tiny
// list for its demo-mode prompt chips without pulling the heavier scenario/reply text
// into the real app's bundle. Chat.tsx only ever renders these chips when DEMO is true
// anyway, but the *import* itself is what would otherwise leak into every build.
export interface ScenarioPrompt { label: string; prompt: string; scenarioId: string }

export const PERSONA_SCENARIOS: Record<string, ScenarioPrompt[]> = {
  central: [
    { label: 'What can you do?', prompt: 'What can you help me with?', scenarioId: 'central-overview' },
  ],
  doc: [
    { label: 'Architecture review', prompt: 'Can you review my project structure?', scenarioId: 'doc-review' },
  ],
  kona: [
    { label: 'Brainstorm art style', prompt: 'Give me three moodboard directions for a synthwave album cover', scenarioId: 'kona-moodboard' },
  ],
  glyph: [
    { label: 'Clean up my timeline', prompt: 'Clean up the old draft tracks in my Kdenlive timeline', scenarioId: 'glyph-approval' },
  ],
  estra: [
    { label: 'Tighten this paragraph', prompt: 'Can you tighten up this paragraph for me?', scenarioId: 'estra-edit' },
  ],
}

const PROMPT_TO_SCENARIO = new Map<string, string>(
  Object.values(PERSONA_SCENARIOS).flat().map(s => [s.prompt.trim().toLowerCase(), s.scenarioId]),
)

export function pickScenario(message: string): string {
  return PROMPT_TO_SCENARIO.get(message.trim().toLowerCase()) ?? 'fallback'
}
