import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NotifyMessages, NotifyPanel } from './NotifySettings'
import { chooseNotify } from '../lib/notify'

const ask = vi.fn(async () => 'granted' as NotificationPermission)
beforeEach(() => { localStorage.clear(); ask.mockClear(); vi.stubGlobal('Notification', { permission: 'default', requestPermission: ask }) })
afterEach(async () => { cleanup(); await chooseNotify({ messages: false, chat: 'off' }); vi.unstubAllGlobals() })

it('turns message and chat notifications on and off from People & identity', async () => {
  render(<><NotifyPanel /><NotifyMessages /></>)
  const messages = screen.getByLabelText('New messages')
  expect(messages).not.toBeChecked()
  expect(screen.getByRole('button', { name: 'Notify me' })).toHaveAttribute('aria-pressed', 'false')
  await act(async () => { fireEvent.click(messages) })
  expect(ask).toHaveBeenCalled()
  expect(messages).toBeChecked()
  // The bell beside Messages shows the same choice, and turns it off again.
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Notifying' })) })
  expect(messages).not.toBeChecked()
  await act(async () => { fireEvent.change(screen.getByLabelText('Public chat notifications'), { target: { value: 'mentions' } }) })
  expect(screen.getByLabelText('Public chat notifications')).toHaveValue('mentions')
  expect(JSON.parse(localStorage.getItem('grove_notifications')!)).toEqual({ messages: false, chat: 'mentions' })
})

it('says when the browser blocks notifications, and hides the bell where there are none', () => {
  vi.stubGlobal('Notification', { permission: 'denied', requestPermission: ask })
  render(<NotifyPanel />)
  expect(screen.getByRole('alert')).toHaveTextContent('blocking notifications')
  cleanup()
  vi.unstubAllGlobals()
  render(<><NotifyPanel /><NotifyMessages /></>)
  expect(screen.getByText('This browser can’t show notifications.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Notify/ })).toBeNull()
})
