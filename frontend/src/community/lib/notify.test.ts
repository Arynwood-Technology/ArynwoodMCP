import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { chooseNotify, notify, notifyBlocked, notifyPrefs, OPEN } from './notify'
import { ircConnect, ircDisconnect } from './irc-manager'
import { useAppStore } from '../store/useAppStore'

const shown: { title: string; options: NotificationOptions; onclick: (() => void) | null; close: () => void }[] = []
class FakeNotification {
  static permission: NotificationPermission = 'default'
  static requestPermission = vi.fn(async () => { FakeNotification.permission = 'granted'; return 'granted' as NotificationPermission })
  onclick: (() => void) | null = null
  close = vi.fn()
  title: string
  options: NotificationOptions
  constructor(title: string, options: NotificationOptions) { this.title = title; this.options = options; shown.push(this) }
}
// Stands in for the Grove's chat connection, so a line can arrive from the room.
class FakeSocket {
  static last: FakeSocket
  static OPEN = 1
  readyState = 1
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  send = vi.fn()
  close = vi.fn()
  constructor() { FakeSocket.last = this }
  say(raw: string) { this.onmessage!({ data: JSON.stringify({ type: 'irc', msg: { raw } }) }) }
}
beforeEach(() => {
  localStorage.clear(); shown.length = 0
  FakeNotification.permission = 'default'; FakeNotification.requestPermission.mockClear()
  vi.stubGlobal('Notification', FakeNotification); vi.stubGlobal('WebSocket', FakeSocket)
  vi.spyOn(window, 'focus').mockImplementation(() => {})
})
afterEach(async () => { await chooseNotify({ messages: false, chat: 'off' }); ircDisconnect(); vi.unstubAllGlobals() })

it('asks the browser once something is turned on, and remembers the choice', async () => {
  expect(notifyPrefs()).toEqual({ messages: false, chat: 'off' })
  notify('Ann', 'Hello', '/community/inbox', 't')
  expect(shown).toHaveLength(0)
  await chooseNotify({ messages: true })
  expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1)
  expect(JSON.parse(localStorage.getItem('grove_notifications')!)).toEqual({ messages: true, chat: 'off' })
  await chooseNotify({ chat: 'mentions' })
  expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1)
  expect(notifyPrefs()).toEqual({ messages: true, chat: 'mentions' })
  // A click brings the Grove forward at the right page.
  const opened = vi.fn()
  window.addEventListener(OPEN, e => opened((e as CustomEvent).detail), { once: true })
  notify('Ann', 'Hello', '/community/inbox', 'grove-message-c1')
  expect(shown[0]).toMatchObject({ title: 'Ann', options: { body: 'Hello', tag: 'grove-message-c1' } })
  shown[0].onclick!()
  expect(opened).toHaveBeenCalledWith('/community/inbox')
  FakeNotification.permission = 'denied'
  expect(notifyBlocked()).toBe(true)
  notify('Ann', 'Again', '/community/inbox', 't')
  expect(shown).toHaveLength(1)
})

it('tells of chat messages as chosen, unless that room is already open', async () => {
  FakeNotification.permission = 'granted'
  ircConnect({ host: 'irc.arynwood.com', port: 0, nick: 'Holly', channels: ['#RogueFest'], publicChat: true })
  const room = FakeSocket.last
  room.say(':Ann!a@h PRIVMSG #RogueFest :hello all')
  expect(shown).toHaveLength(0)
  await chooseNotify({ chat: 'mentions' })
  room.say(':Ann!a@h PRIVMSG #RogueFest :hello all')
  room.say(':Ann!a@h PRIVMSG #RogueFest :holly, can you check the doors?')
  room.say(':Bo!b@h PRIVMSG Holly :just you')
  expect(shown.map(n => [n.title, n.options.body])).toEqual([['Ann in #RogueFest', 'holly, can you check the doors?'], ['Bo wrote to you', 'just you']])
  await chooseNotify({ chat: 'all' })
  room.say(':Ann!a@h PRIVMSG #RogueFest :doors at 7')
  expect(shown).toHaveLength(3)
  // Reading the room already: nothing to tell.
  useAppStore.setState({ ircPageVisible: true, ircActiveChannel: '#RogueFest' })
  room.say(':Ann!a@h PRIVMSG #RogueFest :see you there')
  expect(shown).toHaveLength(3)
  useAppStore.setState({ ircPageVisible: false })
})
