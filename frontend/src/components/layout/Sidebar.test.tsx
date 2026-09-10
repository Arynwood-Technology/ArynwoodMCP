import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { useAppStore } from '../../store/useAppStore'
import { setViewportMatches, resetViewport } from '../../test/setup'

function renderSidebar(path = '/') {
  return render(<MemoryRouter initialEntries={[path]}><Sidebar /></MemoryRouter>)
}

describe('Sidebar', () => {
  beforeEach(() => {
    localStorage.clear()
    useAppStore.setState(useAppStore.getInitialState())
    resetViewport()
  })
  afterEach(resetViewport)

  it('renders top-level destinations as links in the rail', () => {
    renderSidebar()
    expect(screen.getByRole('link', { name: /Dashboard/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Publish/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^Tools/ })).toBeInTheDocument()
  })

  it('keeps destination names accessible while collapsed', () => {
    renderSidebar()
    // Labels are sr-only in the rail, not removed — the accessible name must not
    // depend on whether the sidebar happens to be expanded.
    expect(screen.getByRole('link', { name: /Design Center/ })).toBeInTheDocument()
  })

  it('toggles between rail and labelled nav, and persists the choice', () => {
    renderSidebar()
    expect(useAppStore.getState().sidebarExpanded).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    expect(useAppStore.getState().sidebarExpanded).toBe(true)
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument()

    // Written through to storage so the preference survives a reload.
    expect(localStorage.getItem('arynwood-ui')).toContain('"sidebarExpanded":true')
  })

  it('marks the current route with aria-current', () => {
    renderSidebar('/publish')
    expect(screen.getByRole('link', { name: /Publish \(current page\)/ })).toBeInTheDocument()
  })

  it('forces the rail on a narrow viewport without discarding the preference', () => {
    useAppStore.getState().setSidebarExpanded(true)
    renderSidebar()
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument()

    act(() => setViewportMatches(true))

    // Collapsed to the rail, and the toggle is hidden — there is no room for it.
    expect(screen.queryByRole('button', { name: /sidebar/i })).not.toBeInTheDocument()
    // …but the saved preference is untouched, so it returns when there's room.
    expect(useAppStore.getState().sidebarExpanded).toBe(true)
  })

  it('exposes nav groups as expandable and opens the group owning the active route', () => {
    renderSidebar('/knowledge')
    const group = screen.getByRole('button', { name: 'Chat, Models & Servers' })
    expect(group).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: /Knowledge \(current page\)/ })).toBeInTheDocument()
  })

  it('opens the status drawer from the connectivity indicator', () => {
    renderSidebar()
    expect(useAppStore.getState().statusDrawerOpen).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: /System status/ }))
    expect(useAppStore.getState().statusDrawerOpen).toBe(true)
  })
})
