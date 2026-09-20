import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { Studio } from './Studio'

function Where() { return <div data-testid="where">{useLocation().pathname}</div> }

function renderStudio() {
  return render(
    <MemoryRouter initialEntries={['/studio']}>
      <Routes>
        <Route path="/studio" element={<Studio />} />
        <Route path="/dj" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Studio', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('offers the DJ Toolkit as a small tool button, not as one of the tabs', () => {
    renderStudio()
    const tool = screen.getByRole('button', { name: /DJ Toolkit/ })
    expect(tool).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Vocal Booth/ })).toBeInTheDocument() // the real tabs are still there
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
  })

  it('opens the DJ Toolkit page when clicked', () => {
    renderStudio()
    fireEvent.click(screen.getByRole('button', { name: /DJ Toolkit/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/dj')
  })
})
