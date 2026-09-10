import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { CommandPalette } from './CommandPalette'
import { useAppStore } from '../../store/useAppStore'

function LocationProbe() {
  const loc = useLocation()
  return <span data-testid="path">{loc.pathname}</span>
}

function renderPalette() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <CommandPalette />
      <LocationProbe />
      <Routes><Route path="*" element={null} /></Routes>
    </MemoryRouter>,
  )
}

const openPalette = () => useAppStore.getState().setPaletteOpen(true)

describe('CommandPalette', () => {
  beforeEach(() => {
    localStorage.clear()
    useAppStore.setState(useAppStore.getInitialState())
  })

  it('stays closed until asked for', () => {
    renderPalette()
    expect(screen.queryByRole('listbox', { name: 'Commands' })).not.toBeInTheDocument()
  })

  it('opens on Ctrl/Cmd+K from anywhere', async () => {
    renderPalette()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    await waitFor(() => expect(screen.getByRole('listbox', { name: 'Commands' })).toBeInTheDocument())
    expect(useAppStore.getState().paletteOpen).toBe(true)
  })

  it('lists pages and actions, grouped', async () => {
    openPalette()
    renderPalette()
    await waitFor(() => expect(screen.getByRole('option', { name: /New chat/ })).toBeInTheDocument())
    expect(screen.getByRole('option', { name: /Design Center/ })).toBeInTheDocument()
    expect(screen.getByText('Actions')).toBeInTheDocument()
    expect(screen.getByText('Pages')).toBeInTheDocument()
  })

  it('filters as you type', async () => {
    openPalette()
    renderPalette()
    const input = await screen.findByRole('textbox', { name: 'Search commands' })

    fireEvent.change(input, { target: { value: 'knowledge' } })
    await waitFor(() => expect(screen.getByRole('option', { name: /Knowledge/ })).toBeInTheDocument())
    expect(screen.queryByRole('option', { name: /Design Center/ })).not.toBeInTheDocument()
  })

  it('reports when nothing matches', async () => {
    openPalette()
    renderPalette()
    const input = await screen.findByRole('textbox', { name: 'Search commands' })
    fireEvent.change(input, { target: { value: 'zzzznope' } })
    await waitFor(() => expect(screen.getByText(/Nothing matches/)).toBeInTheDocument())
  })

  it('navigates on Enter and closes itself', async () => {
    openPalette()
    renderPalette()
    const input = await screen.findByRole('textbox', { name: 'Search commands' })

    fireEvent.change(input, { target: { value: 'publish' } })
    await waitFor(() => expect(screen.getByRole('option', { name: /Publish/ })).toBeInTheDocument())
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/publish'))
    expect(useAppStore.getState().paletteOpen).toBe(false)
  })

  it('moves the selection with the arrow keys', async () => {
    openPalette()
    renderPalette()
    const input = await screen.findByRole('textbox', { name: 'Search commands' })
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(1))

    const first = screen.getAllByRole('option')[0]
    expect(first).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    await waitFor(() => {
      const opts = screen.getAllByRole('option')
      expect(opts[0]).toHaveAttribute('aria-selected', 'false')
      expect(opts[1]).toHaveAttribute('aria-selected', 'true')
    })
  })

  it('runs a store action without navigating', async () => {
    openPalette()
    renderPalette()
    const input = await screen.findByRole('textbox', { name: 'Search commands' })

    fireEvent.change(input, { target: { value: 'system status' } })
    await waitFor(() => expect(screen.getByRole('option', { name: /Open system status/ })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('option', { name: /Open system status/ }))

    expect(useAppStore.getState().statusDrawerOpen).toBe(true)
    expect(useAppStore.getState().paletteOpen).toBe(false)
  })
})
