import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar } from './components/layout/Sidebar'

// Not a full <App/> render: the default "/" route mounts Dashboard, which opens
// a real WebSocket (lib/ws.ts) for the embedded Arynwood chat - jsdom never resolves
// that connection, which hung the test runner indefinitely. Sidebar alone has no
// network/WS/interval side effects, so it's a safe, fast smoke check that the
// nav shell renders and its routes are wired up.
//
// Behaviour coverage lives elsewhere now — components/layout/Sidebar.test.tsx for
// expand/collapse, persistence and the breakpoint, AppShell.test.tsx for routing
// and titles. This stays as the cheap "does the nav render at all" canary.
describe('Sidebar (smoke)', () => {
  it('renders the top-level nav items', () => {
    render(<MemoryRouter><Sidebar /></MemoryRouter>)
    expect(screen.getByTitle('Dashboard')).toBeInTheDocument()
    expect(screen.getByTitle('Publish')).toBeInTheDocument()
    expect(screen.getByTitle('Tools')).toBeInTheDocument()
  })
})
