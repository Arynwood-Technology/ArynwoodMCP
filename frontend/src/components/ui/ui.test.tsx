import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Button, IconButton, StatusBadge, EmptyState, SectionCard } from './index'

describe('Button', () => {
  it('defaults to type="button" so it never submits a surrounding form', () => {
    render(<Button>Save</Button>)
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button')
  })

  it('lets a caller override a built-in class instead of stacking both', () => {
    render(<Button className="px-9">Wide</Button>)
    const cls = screen.getByRole('button', { name: 'Wide' }).className
    expect(cls).toContain('px-9')
    expect(cls).not.toContain('px-3')
  })

  it('does not fire onClick while disabled', () => {
    const onClick = vi.fn()
    render(<Button disabled onClick={onClick}>Go</Button>)
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('IconButton', () => {
  it('exposes its label as the accessible name', () => {
    render(<IconButton label="Delete conversation"><span aria-hidden="true">x</span></IconButton>)
    expect(screen.getByRole('button', { name: 'Delete conversation' })).toBeInTheDocument()
  })
})

describe('StatusBadge', () => {
  it('renders an internal route as a link, not a click-handling div', () => {
    render(<MemoryRouter><StatusBadge online label="Ollama" to="/models" /></MemoryRouter>)
    const link = screen.getByRole('link', { name: 'Ollama: online' })
    expect(link).toHaveAttribute('href', '/models')
  })

  it('renders an external URL as a safe new-tab anchor', () => {
    render(<MemoryRouter><StatusBadge online={false} label="Metrics" href="http://localhost:9090" /></MemoryRouter>)
    const link = screen.getByRole('link', { name: 'Metrics: offline' })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
  })

  it('announces state without being focusable when it is not actionable', () => {
    render(<MemoryRouter><StatusBadge online={false} label="SD" /></MemoryRouter>)
    expect(screen.getByRole('status')).toHaveAccessibleName('SD: offline')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})

describe('EmptyState', () => {
  it('renders title, description and action', () => {
    render(
      <EmptyState
        title="No conversations yet"
        description="Start one to see it here."
        action={<Button>New chat</Button>}
      />,
    )
    expect(screen.getByText('No conversations yet')).toBeInTheDocument()
    expect(screen.getByText('Start one to see it here.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New chat' })).toBeInTheDocument()
  })
})

describe('SectionCard', () => {
  it('renders its title as a heading and omits the header when unused', () => {
    const { rerender } = render(<SectionCard title="Quick links">body</SectionCard>)
    expect(screen.getByRole('heading', { name: 'Quick links' })).toBeInTheDocument()

    rerender(<SectionCard>body only</SectionCard>)
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })
})
