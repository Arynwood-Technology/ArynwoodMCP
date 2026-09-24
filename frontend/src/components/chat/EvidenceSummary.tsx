import { AlertTriangle } from 'lucide-react'
import { summarizeEvidence, type EvidenceItem } from './evidence'

/** "What informed this reply" for the latest turn: memory, sources, searches, tools, trimming. */
export function EvidenceSummary({ evidence }: { evidence: EvidenceItem[] }) {
  const lines = summarizeEvidence(evidence)
  if (!lines.length) return null
  const warnings = lines.filter(l => l.warn).length
  return (
    <details className="ml-11 max-w-[70%] text-[11px] text-muted">
      <summary className="cursor-pointer select-none">
        What informed this reply{warnings > 0 && <span className="text-warning"> · {warnings} warning{warnings === 1 ? '' : 's'}</span>}
      </summary>
      <ul className="m-0 mt-1 list-none space-y-0.5 p-0">
        {lines.map((line, i) => (
          <li key={i} className={line.warn ? 'flex items-center gap-1 text-warning' : undefined}>
            {line.warn && <AlertTriangle size={11} aria-hidden="true" />}
            {line.text}
          </li>
        ))}
      </ul>
    </details>
  )
}
