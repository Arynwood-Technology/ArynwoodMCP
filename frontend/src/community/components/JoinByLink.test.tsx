import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { JoinByLink } from './JoinByLink'
afterEach(cleanup)

function paste(text: string) {
  const go = vi.fn()
  render(<JoinByLink go={go} />)
  fireEvent.change(screen.getByLabelText('Invitation link'), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: /Join/ }))
  return go
}

it('opens an invitation link to any Grove', () => {
  expect(paste('  https://grove.example.com/community?invite=abc123  ')).toHaveBeenCalledWith('https://grove.example.com/community?invite=abc123')
})
it('treats a bare code as an invitation to this Grove', () => {
  expect(paste('0123456789abcdef0123')).toHaveBeenCalledWith('/community?invite=0123456789abcdef0123')
})
it('refuses anything that is not an invitation', () => {
  for (const text of ['https://example.com/no-invite', 'javascript:alert(1)?invite=x', 'hello']) {
    const go = paste(text)
    expect(go).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Paste the whole invitation link')
    cleanup()
  }
})
