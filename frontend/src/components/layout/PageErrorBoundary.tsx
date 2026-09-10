import { Component, type ReactNode } from 'react'
import { Button } from '../ui'

/** Prevents a crashing page from blacking out the whole app — the shell
 *  (sidebar, top bar) stays usable so you can navigate away. */
export class PageErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div
        role="alert"
        className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center"
      >
        <span aria-hidden="true" className="text-[32px]">⚠️</span>
        <p className="m-0 text-[15px] font-bold text-text">Page crashed</p>
        <pre className="m-0 max-w-md overflow-auto whitespace-pre-wrap rounded-md border border-border bg-surface px-3 py-2 text-left font-mono text-xs leading-relaxed text-muted">
          {error.message}
        </pre>
        <Button variant="primary" onClick={() => this.setState({ error: null })}>
          Retry
        </Button>
      </div>
    )
  }
}
