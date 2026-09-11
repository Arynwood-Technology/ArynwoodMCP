import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AppShell } from './AppShell'
import { usePageTitle } from './usePageTitle'
import { useAppStore } from '../../store/useAppStore'

// DesignCenter mounts an iframe pointing at the backend's html-tools; the shell
// keeps it alive at all times, so stub it out rather than loading it per test.
vi.mock('../../pages/DesignCenter', () => ({
  DesignCenter: () => <div data-testid="design-center" />,
}))

function Page({ title }: { title?: string }) {
  return <p>{title ?? 'page body'}</p>
}

function DynamicTitlePage() {
  usePageTitle('Chat · Doc')
  return <p>chat body</p>
}

function renderAt(path: string, dynamic = false) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Page />} />
          <Route path="/chat" element={dynamic ? <DynamicTitlePage /> : <Page />} />
          <Route path="/models" element={<Page />} />
          <Route path="/design" element={null} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('AppShell', () => {
  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState())
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('titles the page from the route table', () => {
    renderAt('/models')
    expect(screen.getByRole('heading', { name: 'Model Manager' })).toBeInTheDocument()
  })

  it('lets a page override the route title via usePageTitle', () => {
    renderAt('/chat', true)
    expect(screen.getByRole('heading', { name: 'Chat · Doc' })).toBeInTheDocument()
  })

  it('falls back to a default title for an unmapped route', () => {
    // '/' maps to Dashboard; an unknown path should not render an empty heading.
    renderAt('/')
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
  })

  it('renders the nav landmark once, outside the routed content', () => {
    renderAt('/models')
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
  })

  it('keeps Design Center mounted on other routes and drops the top bar on its own', () => {
    const { unmount } = renderAt('/models')
    // Mounted (but hidden) even when the route is elsewhere — this is what
    // preserves its iframe/canvas state across navigation.
    expect(screen.getByTestId('design-center')).toBeInTheDocument()
    expect(screen.getByRole('banner')).toBeInTheDocument()
    unmount()

    renderAt('/design')
    expect(screen.getByTestId('design-center')).toBeInTheDocument()
    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
  })

  it('clears the title override when the overriding page unmounts', () => {
    const { unmount } = renderAt('/chat', true)
    expect(useAppStore.getState().pageTitle).toBe('Chat · Doc')
    unmount()
    expect(useAppStore.getState().pageTitle).toBeNull()
  })
})
