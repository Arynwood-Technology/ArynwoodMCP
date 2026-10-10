/**
 * IRC singleton manager — lives outside React so state survives navigation.
 * All state is written to Zustand; components read from the store directly.
 */
import { useAppStore, type IRCMsg, type WhoisInfo } from '../store/useAppStore'
import { groveSocketUrl } from './grove'

let ws: WebSocket | null = null
let selfNick = 'mcp'
let whoisAccum: Partial<WhoisInfo> = {}

function store() { return useAppStore.getState() }
function set(p: Partial<ReturnType<typeof useAppStore.getState>>) { useAppStore.setState(p) }

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getSelfNick() { return selfNick }

function stripPrefix(n: string) { return n.replace(/^[@+~&%]/, '') }
function getPrefix(n: string) { return /^[@+~&%]/.test(n) ? n[0] : '' }

function ts() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Strip mIRC color/format codes from text */
export function stripIRC(text: string) {
  // IRC formatting is made of control characters, so matching them is the point here.
  return text
    // eslint-disable-next-line no-control-regex
    .replace(/\x03\d{0,2}(,\d{1,2})?/g, '')   // color codes
    // eslint-disable-next-line no-control-regex
    .replace(/[\x02\x1D\x1F\x16\x0F]/g, '')    // bold/italic/underline/reverse/reset
}

function sysMsg(text: string, channel = 'server'): IRCMsg {
  return { id: Date.now() + Math.random(), type: 'server', nick: '', channel, text, ts: ts() }
}

function pushMsg(channel: string, m: IRCMsg) {
  // Ignore messages from ignored nicks
  if (m.nick && store().ircIgnored.includes(m.nick)) return

  const prev = store().ircMessages
  set({ ircMessages: { ...prev, [channel]: [...(prev[channel] ?? []).slice(-800), m] } })

  // Unread: fire when page isn't open OR message is on a non-active channel
  if ((m.type === 'chat' || m.type === 'action' || m.type === 'mention') &&
      (!store().ircPageVisible || channel !== store().ircActiveChannel)) {
    const byChannel = store().ircUnreadByChannel
    set({
      ircUnreadByChannel: { ...byChannel, [channel]: (byChannel[channel] ?? 0) + 1 },
      ircUnread: store().ircUnread + 1,
    })
  }
}

function ensureChannel(ch: string) {
  if (!store().ircChannelList.includes(ch))
    set({ ircChannelList: [...store().ircChannelList, ch] })
}

function addUser(channel: string, rawNick: string) {
  const n = stripPrefix(rawNick)
  const prefix = getPrefix(rawNick)
  const prev = store().ircUsers
  const prevPfx = store().ircUserPrefixes
  if ((prev[channel] ?? []).includes(n)) return
  const sorted = [...(prev[channel] ?? []), n]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  set({
    ircUsers: { ...prev, [channel]: sorted },
    ircUserPrefixes: { ...prevPfx, [channel]: { ...(prevPfx[channel] ?? {}), [n]: prefix } },
  })
}

function removeUser(channel: string, rawNick: string) {
  const n = stripPrefix(rawNick)
  const prev = store().ircUsers
  const prevPfx = store().ircUserPrefixes
  const pfxCh = { ...(prevPfx[channel] ?? {}) }
  delete pfxCh[n]
  set({
    ircUsers: { ...prev, [channel]: (prev[channel] ?? []).filter(u => u !== n) },
    ircUserPrefixes: { ...prevPfx, [channel]: pfxCh },
  })
}

function removeUserAll(rawNick: string) {
  const n = stripPrefix(rawNick)
  const prevU = store().ircUsers
  const prevP = store().ircUserPrefixes
  const nextU: Record<string, string[]> = {}
  const nextP: Record<string, Record<string, string>> = {}
  for (const ch of Object.keys(prevU)) {
    nextU[ch] = prevU[ch].filter(u => u !== n)
    nextP[ch] = { ...(prevP[ch] ?? {}) }
    delete nextP[ch][n]
  }
  set({ ircUsers: nextU, ircUserPrefixes: nextP })
}

function renameUserAll(oldNick: string, newNick: string) {
  const prevU = store().ircUsers
  const prevP = store().ircUserPrefixes
  const nextU: Record<string, string[]> = {}
  const nextP: Record<string, Record<string, string>> = {}
  for (const ch of Object.keys(prevU)) {
    nextU[ch] = prevU[ch]
      .map(u => u === oldNick ? newNick : u)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    const pfx = prevP[ch]?.[oldNick] ?? ''
    nextP[ch] = { ...(prevP[ch] ?? {}) }
    delete nextP[ch][oldNick]
    nextP[ch][newNick] = pfx
  }
  set({ ircUsers: nextU, ircUserPrefixes: nextP })
}

function mergeChannelUsers(channel: string, rawNicks: string[]) {
  const prev = store().ircUsers
  const prevPfx = store().ircUserPrefixes
  const chPfx = { ...(prevPfx[channel] ?? {}) }
  const existing = prev[channel] ?? []
  const toAdd: string[] = []
  for (const raw of rawNicks) {
    const n = stripPrefix(raw)
    const p = getPrefix(raw)
    chPfx[n] = p
    if (!existing.includes(n)) toAdd.push(n)
  }
  const merged = [...existing, ...toAdd]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  set({
    ircUsers: { ...prev, [channel]: merged },
    ircUserPrefixes: { ...prevPfx, [channel]: chPfx },
  })
}

// ── IRC line parser ───────────────────────────────────────────────────────────

function parseIRC(raw: string) {
  let prefix = '', rest = raw
  if (raw.startsWith(':')) {
    const i = raw.indexOf(' ')
    prefix = raw.slice(1, i)
    rest = raw.slice(i + 1)
  }
  const spaceIdx = rest.indexOf(' ')
  const cmd = spaceIdx === -1 ? rest : rest.slice(0, spaceIdx)
  const command = cmd.toUpperCase()
  let trailing = '', params_raw = spaceIdx === -1 ? '' : rest.slice(spaceIdx + 1)
  if (params_raw.includes(' :')) {
    const i = params_raw.indexOf(' :')
    trailing = params_raw.slice(i + 2)
    params_raw = params_raw.slice(0, i)
  } else if (params_raw.startsWith(':')) {
    trailing = params_raw.slice(1)
    params_raw = ''
  }
  const params = params_raw ? params_raw.split(' ') : []
  if (trailing) params.push(trailing)
  const nick = prefix.includes('!') ? prefix.split('!')[0] : prefix
  return { raw, prefix, nick, command, params, trailing }
}

const SHOW_RAW_NUMERICS = new Set(['004', '005'])
const IGNORED_NUMERICS = new Set([
  '002','003','251','252','253','254','255','265','266',
  '375','376','372','366','354','315','368',
])

function handleIRCLine(raw: string) {
  const msg = parseIRC(raw)
  const { command, nick, params } = msg
  const now = ts()

  if (command === 'PING') {
    ws?.send(JSON.stringify({ cmd: `PONG :${params[0] ?? ''}` }))
    return
  }

  // ── Connection / registration ────────────────────────────────────────────
  if (command === '001') {
    selfNick = params[0] ?? selfNick
    set({ ircConnected: true, ircConnecting: false, ircNick: selfNick })
    pushMsg('server', sysMsg(params[1] ?? 'Welcome to IRC'))
    return
  }

  // Nick in use. During registration the backend retries with a new nick and 001 reports the
  // one that stuck; afterwards (a /nick change) the old nick simply stays.
  if (command === '433') {
    pushMsg(store().ircActiveChannel || 'server', sysMsg(`The nickname ${params[1] ?? ''} is already in use.`, store().ircActiveChannel || 'server'))
    return
  }

  // ── NAMES list ────────────────────────────────────────────────────────────
  if (command === '353') {
    const ch = params[2] ?? params[1] ?? ''
    const names = (params[3] ?? '').split(' ').filter(Boolean)
    if (ch) mergeChannelUsers(ch, names)
    return
  }

  // ── Topic ─────────────────────────────────────────────────────────────────
  if (command === '332') {
    const ch = params[1]; const topic = params[2] ?? ''
    if (ch) set({ ircTopics: { ...store().ircTopics, [ch]: stripIRC(topic) } })
    pushMsg(ch ?? 'server', sysMsg(`Topic: ${topic}`, ch))
    return
  }
  if (command === 'TOPIC') {
    const ch = params[0]; const topic = params[1] ?? ''
    if (ch) set({ ircTopics: { ...store().ircTopics, [ch]: stripIRC(topic) } })
    pushMsg(ch ?? 'server', { ...sysMsg(`${nick} changed topic to: ${topic}`, ch), nick })
    return
  }

  // ── WHOIS accumulation ────────────────────────────────────────────────────
  if (command === '311') {
    whoisAccum = { nick: params[1], user: params[2], host: params[3], realname: params[5] ?? '' }
    return
  }
  if (command === '312') { whoisAccum.server = params[2]; whoisAccum.serverInfo = params[3]; return }
  if (command === '313') { whoisAccum.oper = true; return }
  if (command === '317') { whoisAccum.idleSecs = Number(params[2]); whoisAccum.signonTime = Number(params[3]); return }
  if (command === '319') { whoisAccum.channels = params[2]; return }
  if (command === '320' || command === '330') { whoisAccum.account = params[2] ?? params[1]; return }
  if (command === '338') { return }  // IP address
  if (command === '318') {
    set({ ircWhois: whoisAccum as WhoisInfo })
    whoisAccum = {}
    return
  }

  // ── Away responses ────────────────────────────────────────────────────────
  if (command === '306') { set({ ircAway: true }); pushMsg('server', sysMsg('You are now away')); return }
  if (command === '305') { set({ ircAway: false }); pushMsg('server', sysMsg('You are no longer away')); return }
  if (command === '301') {
    pushMsg('server', sysMsg(`${params[1]} is away: ${params[2] ?? ''}`))
    return
  }

  // ── MODE ──────────────────────────────────────────────────────────────────
  if (command === 'MODE') {
    const target = params[0]; const modeStr = params.slice(1).join(' ')
    pushMsg(target?.startsWith('#') ? target : 'server',
      sysMsg(`Mode ${modeStr} set by ${nick}`, target?.startsWith('#') ? target : 'server'))
    return
  }

  if (IGNORED_NUMERICS.has(command)) return
  if (SHOW_RAW_NUMERICS.has(command)) {
    pushMsg('server', sysMsg(params.slice(1).join(' ')))
    return
  }

  // ── User list maintenance ─────────────────────────────────────────────────
  if (command === 'JOIN') {
    const ch = params[0]?.replace(':', '')
    if (ch) { ensureChannel(ch); addUser(ch, nick) }
    if (nick === selfNick) {
      ircSwitchChannel(ch)
      return
    }
  }
  if (command === 'PART' || command === 'KICK') {
    const ch = params[0]
    if (ch) removeUser(ch, nick)
  }
  if (command === 'QUIT') removeUserAll(nick)
  if (command === 'NICK') {
    renameUserAll(nick, params[0] ?? nick)
    if (nick === selfNick) { selfNick = params[0] ?? nick; set({ ircNick: selfNick }) }
  }

  // ── Display messages ──────────────────────────────────────────────────────
  let m: IRCMsg | null = null

  if (command === 'PRIVMSG') {
    const target = params[0] ?? ''
    const rawText = params[1] ?? ''
    const text = stripIRC(rawText)
    const isDM = !target.startsWith('#') && !target.startsWith('&')
    const channel = isDM ? (nick === selfNick ? target : nick) : target
    if (isDM) ensureChannel(channel)

    if (rawText.startsWith('\x01ACTION ') && rawText.endsWith('\x01')) {
      m = { id: Date.now() + Math.random(), type: 'action', nick, channel, text: `* ${nick} ${text.slice(8, -1)}`, ts: now }
    } else {
      const isMention = text.toLowerCase().includes(selfNick.toLowerCase())
      m = { id: Date.now() + Math.random(), type: isMention ? 'mention' : 'chat', nick, channel, text, ts: now }
    }
  } else if (command === 'NOTICE') {
    const target = params[0] ?? 'server'
    const text = stripIRC(params[1] ?? '')
    const ch = target.startsWith('#') ? target : 'server'
    m = { id: Date.now() + Math.random(), type: 'notice', nick, channel: ch, text: `[${nick}] ${text}`, ts: now }
  } else if (command === 'JOIN') {
    const ch = params[0]?.replace(':', '')
    m = { id: Date.now() + Math.random(), type: 'join', nick, channel: ch, text: `→ ${nick} joined`, ts: now }
  } else if (command === 'PART') {
    m = { id: Date.now() + Math.random(), type: 'part', nick, channel: params[0],
      text: `← ${nick} left${params[1] ? ` (${params[1]})` : ''}`, ts: now }
  } else if (command === 'KICK') {
    m = { id: Date.now() + Math.random(), type: 'part', nick: params[1], channel: params[0],
      text: `← ${params[1]} was kicked by ${nick}${params[2] ? ` (${params[2]})` : ''}`, ts: now }
  } else if (command === 'QUIT') {
    // Show in all channels the user was in
    const channels = Object.keys(store().ircUsers).filter(ch => (store().ircUsers[ch] ?? []).includes(nick))
    for (const ch of channels) {
      pushMsg(ch, { id: Date.now() + Math.random(), type: 'quit', nick, channel: ch,
        text: `⟵ ${nick} quit${params[0] ? ` (${params[0]})` : ''}`, ts: now })
    }
    return
  } else if (command === 'NICK') {
    m = { id: Date.now() + Math.random(), type: 'server', nick, text: `${nick} is now known as ${params[0]}`, ts: now }
  } else {
    // Show unhandled lines in server tab
    m = sysMsg(raw)
  }

  if (!m) return
  const ch = m.channel ?? 'server'
  if (m.channel) ensureChannel(ch)
  pushMsg(ch, m)
}

// ── Command processor ─────────────────────────────────────────────────────────

export function ircProcess(input: string) {
  const active = store().ircActiveChannel

  if (!input.startsWith('/')) {
    if (active && active !== 'server') ircSendMsg(active, input)
    return
  }

  const spaceIdx = input.indexOf(' ')
  const cmd = (spaceIdx === -1 ? input.slice(1) : input.slice(1, spaceIdx)).toLowerCase()
  const rest = spaceIdx === -1 ? '' : input.slice(spaceIdx + 1).trim()
  const args = rest ? rest.split(' ') : []
  const now = ts()

  switch (cmd) {
    case 'me':
      if (active && active !== 'server' && rest) {
        ircSend(`PRIVMSG ${active} :\x01ACTION ${rest}\x01`)
        pushMsg(active, { id: Date.now(), type: 'action', nick: selfNick, channel: active,
          text: `* ${selfNick} ${rest}`, ts: now })
      }
      break

    case 'msg': case 'query': {
      const target = args[0]; const text = args.slice(1).join(' ')
      if (!target) break
      ensureChannel(target)
      ircSwitchChannel(target)
      if (text) ircSendMsg(target, text)
      break
    }

    case 'ns': case 'nickserv':
      ircSend(`PRIVMSG NickServ :${rest}`)
      pushMsg('server', sysMsg(`→ NickServ: ${rest}`))
      break

    case 'cs': case 'chanserv':
      ircSend(`PRIVMSG ChanServ :${rest}`)
      pushMsg('server', sysMsg(`→ ChanServ: ${rest}`))
      break

    case 'whois':
      if (args[0]) ircSend(`WHOIS ${args[0]} ${args[0]}`)
      break

    case 'nick':
      // The server's NICK echo updates selfNick once the change is accepted.
      if (args[0]) ircSend(`NICK ${args[0]}`)
      break

    case 'join':
      if (args[0]) { ircSend(`JOIN ${args[0]}`); ensureChannel(args[0]); ircSwitchChannel(args[0]) }
      break

    case 'part': case 'leave':
      ircSend(`PART ${active}${rest ? ' :' + rest : ''}`)
      break

    case 'topic':
      if (active && rest) ircSend(`TOPIC ${active} :${rest}`)
      break

    case 'kick':
      if (active && args[0]) ircSend(`KICK ${active} ${args[0]} :${args.slice(1).join(' ') || 'Kicked'}`)
      break

    case 'ban':
      if (active && args[0]) ircSend(`MODE ${active} +b ${args[0]}`)
      break

    case 'unban':
      if (active && args[0]) ircSend(`MODE ${active} -b ${args[0]}`)
      break

    case 'op':
      if (active && args[0]) ircSend(`MODE ${active} +o ${args[0]}`)
      break

    case 'deop':
      if (active && args[0]) ircSend(`MODE ${active} -o ${args[0]}`)
      break

    case 'voice':
      if (active && args[0]) ircSend(`MODE ${active} +v ${args[0]}`)
      break

    case 'devoice':
      if (active && args[0]) ircSend(`MODE ${active} -v ${args[0]}`)
      break

    case 'mode':
      if (active) ircSend(`MODE ${active} ${rest}`)
      break

    case 'invite':
      if (args[0] && active) ircSend(`INVITE ${args[0]} ${active}`)
      break

    case 'away':
      ircSend(`AWAY :${rest || 'Away'}`)
      break

    case 'back':
      ircSend('AWAY')
      break

    case 'ignore':
      if (args[0]) {
        set({ ircIgnored: [...store().ircIgnored, args[0]] })
        pushMsg(active || 'server', sysMsg(`Now ignoring ${args[0]}`))
      }
      break

    case 'unignore':
      if (args[0]) {
        set({ ircIgnored: store().ircIgnored.filter(n => n !== args[0]) })
        pushMsg(active || 'server', sysMsg(`Unignoring ${args[0]}`))
      }
      break

    case 'clear':
      set({ ircMessages: { ...store().ircMessages, [active]: [] } })
      break

    case 'names':
      ircSend(`NAMES ${active}`)
      break

    case 'list':
      ircSend('LIST')
      break

    case 'quote': case 'raw':
      ircSend(rest)
      break

    case 'quit':
      ircSend(`QUIT :${rest || 'Arynwood Hub'}`)
      setTimeout(ircDisconnect, 500)
      break

    case 'help':
      pushMsg(active || 'server', sysMsg(
        '/me /msg /query /ns /cs /whois /nick /join /part /topic /kick /ban /op /deop ' +
        '/voice /devoice /mode /invite /away /back /ignore /unignore /clear /names /list /quote /quit'
      ))
      break

    default:
      // Pass raw to server as-is
      ircSend(`${cmd.toUpperCase()} ${rest}`)
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function ircConnect(config: {
  host: string; port: number; nick: string; channels: string[]; realname?: string; socks5_proxy?: string; nick_password?: string
}) {
  if (ws) { ws.onclose = null; ws.close() }
  selfNick = config.nick

  set({
    ircConnecting: true, ircConnected: false, ircNick: config.nick, ircAway: false,
    ircMessages: {}, ircUsers: {}, ircUserPrefixes: {}, ircTopics: {},
    ircUnreadByChannel: {}, ircWhois: null,
    ircChannelList: ['server', ...config.channels],
    ircActiveChannel: config.channels[0] ?? 'server',
  })

  ws = new WebSocket(groveSocketUrl('/irc/ws'))

  ws.onopen = () => ws!.send(JSON.stringify({
    host: config.host, port: config.port, nick: config.nick,
    channels: config.channels, realname: config.realname ?? 'Arynwood Grove',
    ...(config.socks5_proxy ? { socks5_proxy: config.socks5_proxy } : {}),
    ...(config.nick_password ? { nick_password: config.nick_password } : {}),
  }))

  ws.onmessage = (e) => {
    let data
    try { data = JSON.parse(e.data) } catch { return }
    if (data.type === 'status')     pushMsg('server', sysMsg(data.message))
    else if (data.type === 'error') { pushMsg('server', { ...sysMsg(`Error: ${data.message}`), type: 'error' }); set({ ircConnecting: false, ircConnected: false }) }
    else if (data.type === 'disconnect') { pushMsg('server', { ...sysMsg(data.message), type: 'error' }); set({ ircConnected: false }) }
    else if (data.type === 'irc')   handleIRCLine(data.msg.raw)
  }

  ws.onerror = () => {
    pushMsg('server', { ...sysMsg('Lost contact with Arynwood Grove. Check that it is still running.'), type: 'error' })
    set({ ircConnecting: false, ircConnected: false })
  }
  ws.onclose = () => set({ ircConnected: false, ircConnecting: false })
}

export function ircDisconnect() {
  if (ws) { ws.onclose = null; ws.close(); ws = null }
  set({ ircConnected: false, ircConnecting: false })
}

export function ircSend(cmd: string) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ cmd }))
}

export function ircSendMsg(channel: string, text: string) {
  ircSend(`PRIVMSG ${channel} :${text}`)
  pushMsg(channel, { id: Date.now(), type: 'self', nick: selfNick, channel, text: stripIRC(text), ts: ts() })
}

export function ircSwitchChannel(ch: string) {
  const { ircUnreadByChannel, ircUnread } = store()
  const cleared = ircUnreadByChannel[ch] ?? 0
  set({
    ircActiveChannel: ch,
    ircUnreadByChannel: { ...ircUnreadByChannel, [ch]: 0 },
    ircUnread: Math.max(0, ircUnread - cleared),
  })
}

export const IRC_COMMANDS = [
  { cmd: '/me',       args: '<action>',          desc: 'Send action' },
  { cmd: '/msg',      args: '<nick> [text]',      desc: 'Open PM / send message' },
  { cmd: '/query',    args: '<nick>',             desc: 'Open private chat' },
  { cmd: '/whois',    args: '<nick>',             desc: 'Look up user info' },
  { cmd: '/ns',       args: '<cmd>',              desc: 'NickServ shortcut' },
  { cmd: '/cs',       args: '<cmd>',              desc: 'ChanServ shortcut' },
  { cmd: '/nick',     args: '<newnick>',          desc: 'Change your nick' },
  { cmd: '/join',     args: '<#channel>',         desc: 'Join a channel' },
  { cmd: '/part',     args: '[reason]',           desc: 'Leave current channel' },
  { cmd: '/topic',    args: '<text>',             desc: 'Set channel topic' },
  { cmd: '/kick',     args: '<nick> [reason]',    desc: 'Kick user' },
  { cmd: '/ban',      args: '<nick/mask>',        desc: 'Ban from channel' },
  { cmd: '/unban',    args: '<mask>',             desc: 'Remove ban' },
  { cmd: '/op',       args: '<nick>',             desc: 'Give op' },
  { cmd: '/deop',     args: '<nick>',             desc: 'Remove op' },
  { cmd: '/voice',    args: '<nick>',             desc: 'Give voice' },
  { cmd: '/devoice',  args: '<nick>',             desc: 'Remove voice' },
  { cmd: '/mode',     args: '[+/-mode]',          desc: 'Set channel mode' },
  { cmd: '/invite',   args: '<nick>',             desc: 'Invite to channel' },
  { cmd: '/away',     args: '[message]',          desc: 'Set away status' },
  { cmd: '/back',     args: '',                   desc: 'Clear away status' },
  { cmd: '/ignore',   args: '<nick>',             desc: 'Ignore a user' },
  { cmd: '/unignore', args: '<nick>',             desc: 'Unignore a user' },
  { cmd: '/clear',    args: '',                   desc: 'Clear current channel' },
  { cmd: '/names',    args: '',                   desc: 'List channel users' },
  { cmd: '/list',     args: '',                   desc: 'List server channels' },
  { cmd: '/quote',    args: '<raw>',              desc: 'Send raw IRC command' },
  { cmd: '/quit',     args: '[reason]',           desc: 'Disconnect from IRC' },
  { cmd: '/help',     args: '',                   desc: 'Show all commands' },
]
