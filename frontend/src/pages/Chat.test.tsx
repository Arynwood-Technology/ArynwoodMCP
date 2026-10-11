import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentConfigPanel } from './Chat'

afterEach(() => vi.unstubAllGlobals())

describe('Agent Config tools preference', () => {
  it('loads, saves and reloads the plain-chat preference', async () => {
    let stored = { context: 'Keep my notes.', max_history: 4, tools_enabled: true }
    const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === 'PUT') {
        stored = JSON.parse(options.body as string)
        return { ok: true }
      }
      return { ok: true, json: async () => stored }
    })
    vi.stubGlobal('fetch', fetchMock)
    const view = render(<AgentConfigPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Agent Config' }))
    const checkbox = await screen.findByRole('checkbox', { name: 'Use tools' })
    await waitFor(() => expect(screen.getByLabelText('Context / notes injected into every system prompt')).toHaveValue('Keep my notes.'))
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('button', { name: 'Saved' })
    expect(stored).toEqual({ context: 'Keep my notes.', max_history: 4, tools_enabled: false })
    view.unmount()
    render(<AgentConfigPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Agent Config' }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Use tools' })).not.toBeChecked())
  })

  it('reports a failed save without claiming the preference was saved', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => options?.method === 'PUT'
      ? { ok: false }
      : { ok: true, json: async () => ({ context: '', max_history: 30, tools_enabled: true }) }))
    render(<AgentConfigPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Agent Config' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Use tools' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save Agent Config')
    expect(screen.queryByRole('button', { name: 'Saved' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })
})
