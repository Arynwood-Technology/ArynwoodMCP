import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ArynwoodMark } from './ArynwoodMark'

describe('ArynwoodMark', () => {
  it('layers the light under the original drawing', () => {
    const { container } = render(<ArynwoodMark size={40} />)
    const mark = container.firstElementChild as HTMLElement
    expect(mark).toHaveClass('aw-mark')
    expect(mark.style.getPropertyValue('--aw-size')).toBe('40px')
    const layers = Array.from(mark.children).map(el => el.className)
    expect(layers).toEqual(['aw-mark__under', 'aw-mark__halo', 'aw-mark__core', 'aw-mark__tree'])
    // The drawing is the last layer, so it always sits on top of the light.
    expect((mark.lastElementChild as HTMLImageElement).src).toMatch(/arynwood-tree/)
  })

  it('is decorative unless it is given a name', () => {
    const { container, getByRole } = render(
      <><ArynwoodMark /><ArynwoodMark label="Arynwood" /></>,
    )
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
    expect(getByRole('img', { name: 'Arynwood' })).toBeInTheDocument()
  })

  it('switches to the eclipse and breathes on request', () => {
    const { container } = render(<ArynwoodMark variant="eclipse" breathe="thinking" size="2rem" />)
    const mark = container.firstElementChild as HTMLElement
    expect(mark).toHaveClass('aw-mark--eclipse', 'aw-mark--thinking')
    expect(mark.style.getPropertyValue('--aw-size')).toBe('2rem')
  })
})
