import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { StatusDrawer } from './StatusDrawer'
import { useAppStore } from '../../store/useAppStore'

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

/** Route each endpoint the drawer calls, so a test can describe a whole system
 *  state rather than a single response. */
function mockApi(overrides: Record<string, unknown> = {}) {
  const routes: Record<string, unknown> = {
    '/api/system/status': {
      ollama: true, tortoise_tts: false, stable_diffusion: false, prometheus: false,
      gpu: { available: true, name: 'RTX 3060', temp: '55', utilization: '12', memory_used: '2048', memory_total: '12288' },
      platform: 'Linux',
    },
    '/api/system/gpu-queue': { running: null, depth: 0, waiting: [] },
    '/api/servers': [{ id: 1, name: 'Local Ollama', host: 'localhost', port: 11434, type: 'ollama', enabled: 1, created_at: '' }],
    '/api/servers/1/ping': { online: true },
    '/api/knowledge/status': {
      qdrant: { online: true, collection_ready: true },
      embedding_model: 'nomic-embed-text', embedding_model_available: true,
    },
    '/api/mcp/servers': [],
    '/api/studio/sidecars': {},
    '/api/ollama/models?host=localhost&port=11434': { models: [{ name: 'qwen2.5-coder:14b' }] },
    ...overrides,
  }

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    const key = Object.keys(routes).find(k => url.startsWith(k.split('?')[0]))
    return json(key ? routes[key] : [])
  }) as unknown as typeof fetch
}

describe('StatusDrawer', () => {
  const realFetch = globalThis.fetch

  beforeEach(() => {
    localStorage.clear()
    useAppStore.setState(useAppStore.getInitialState())
    mockApi()
  })
  afterEach(() => { globalThis.fetch = realFetch })

  it('renders nothing until opened', () => {
    render(<StatusDrawer />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('reports every subsystem once open', async () => {
    useAppStore.getState().setStatusDrawerOpen(true)
    render(<StatusDrawer />)

    await waitFor(() => expect(screen.getByRole('dialog', { name: 'System status' })).toBeInTheDocument())
    for (const section of ['Backend', 'Ollama & servers', 'GPU', 'Knowledge base', 'MCP tool servers', 'Other services']) {
      expect(screen.getByRole('heading', { name: section })).toBeInTheDocument()
    }
    await waitFor(() => expect(screen.getByText('RTX 3060 · 12% · 2048/12288MB · 55°C')).toBeInTheDocument())
  })

  it('calls out an empty MCP registry as the silent-failure mode it is', async () => {
    useAppStore.getState().setStatusDrawerOpen(true)
    render(<StatusDrawer />)

    await waitFor(() => expect(screen.getByText('No servers registered')).toBeInTheDocument())
    expect(screen.getByText(/mcp_servers\.json is absent/)).toBeInTheDocument()
  })

  it('lists a registered MCP server instead of the warning', async () => {
    mockApi({ '/api/mcp/servers': [{ name: 'kdenlive', url: 'http://localhost:8420' }] })
    useAppStore.getState().setStatusDrawerOpen(true)
    render(<StatusDrawer />)

    await waitFor(() => expect(screen.getByText('kdenlive')).toBeInTheDocument())
    expect(screen.queryByText('No servers registered')).not.toBeInTheDocument()
  })

  it('flags an active model that is not installed on the active server', async () => {
    useAppStore.getState().setActiveModel('not-a-real-model')
    useAppStore.getState().setStatusDrawerOpen(true)
    render(<StatusDrawer />)

    await waitFor(() => expect(screen.getByText('not-a-real-model')).toBeInTheDocument())
    expect(screen.getByText(/ollama pull not-a-real-model/)).toBeInTheDocument()
  })

  it('offers a fix only for the things that are actually down', async () => {
    useAppStore.getState().setStatusDrawerOpen(true)
    render(<StatusDrawer />)

    // TTS is down in the fixture, so its remedy shows...
    await waitFor(() => expect(screen.getByText(/docker compose up -d tortoise-tts/)).toBeInTheDocument())
    // ...while a healthy Qdrant keeps its remedy hidden.
    expect(screen.queryByText(/needs Qdrant up/)).not.toBeInTheDocument()
  })

  it('closes from its own control', async () => {
    useAppStore.getState().setStatusDrawerOpen(true)
    render(<StatusDrawer />)

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Close system status' }))
    await waitFor(() => expect(useAppStore.getState().statusDrawerOpen).toBe(false))
  })
})
