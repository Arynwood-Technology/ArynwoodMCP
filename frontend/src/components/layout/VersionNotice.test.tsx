import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { VersionNotice } from './VersionNotice'
import { useAppStore } from '../../store/useAppStore'
import { APP_VERSION } from '../../lib/updates'
import type { SystemStatus } from '../../lib/api'

const status = (version?: string): SystemStatus => ({
  ollama: true, tortoise_tts: false, stable_diffusion: false, prometheus: false,
  gpu: { available: false }, platform: 'Linux', ...(version === undefined ? {} : { version }),
})

describe('VersionNotice', () => {
  beforeEach(() => { useAppStore.setState(useAppStore.getInitialState()) })
  afterEach(cleanup)

  it('stays hidden before the first status and when the backend is this release', () => {
    const { rerender } = render(<VersionNotice />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    useAppStore.getState().setStatus(status(APP_VERSION))
    rerender(<VersionNotice />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('names both releases when the backend is another one, and opens System status', () => {
    useAppStore.getState().setStatus(status('0.0.1'))
    render(<VersionNotice />)
    expect(screen.getByRole('alert')).toHaveTextContent(
      `These screens are Arynwood MCP ${APP_VERSION}, but the backend answering them is 0.0.1.`)
    fireEvent.click(screen.getByRole('button', { name: 'What to do' }))
    expect(useAppStore.getState().statusDrawerOpen).toBe(true)
  })

  it('counts a backend that reports no version as another release (it predates the report)', () => {
    useAppStore.getState().setStatus(status())
    render(<VersionNotice />)
    expect(screen.getByRole('alert')).toHaveTextContent('the backend answering them is an older release')
  })
})
