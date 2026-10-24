import { afterEach, expect, it, vi } from 'vitest'
import { ircConnect, ircDisconnect } from './irc-manager'
import { useAppStore } from '../store/useAppStore'

const sockets: FakeSocket[] = []
class FakeSocket { onopen?: () => void; onmessage?: (e: { data: string }) => void; onclose: (() => void) | null = null; onerror?: () => void; constructor() { sockets.push(this) } send() {} close() {} }
afterEach(() => { ircDisconnect(); vi.unstubAllGlobals() })

function line(raw: string) { sockets.at(-1)?.onmessage?.({ data: JSON.stringify({ type: 'irc', msg: { raw } }) }) }

it('treats nicknames such as constructor and __proto__ as ordinary names', () => {
  vi.stubGlobal('WebSocket', FakeSocket)
  ircConnect({ host: 'irc.example.test', port: 6697, nick: 'me', channels: ['#room'] })
  for (const nick of ['constructor', '__proto__', 'toString']) {
    expect(() => line(`:${nick}!u@h PRIVMSG me :hello from ${nick}`)).not.toThrow()
    expect(() => line(`:${nick}!u@h JOIN #room`)).not.toThrow()
  }
  const { ircMessages, ircUsers } = useAppStore.getState()
  expect(Object.prototype.hasOwnProperty.call(ircMessages, 'constructor')).toBe(true)
  expect(Object.prototype.hasOwnProperty.call(ircMessages, '__proto__')).toBe(true)
  expect(ircUsers['#room']).toEqual(expect.arrayContaining(['constructor', '__proto__', 'toString']))
  expect(({} as Record<string, unknown>).polluted).toBeUndefined()
})
