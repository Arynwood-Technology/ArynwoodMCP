import { useEffect, useRef, useState, useCallback } from 'react'
import { groveUrl } from '../lib/grove'
import { TopBar } from '../components/layout/TopBar'
import { useAppStore } from '../store/useAppStore'
import type { IRCMsg, WhoisInfo } from '../store/useAppStore'
import {
  ircConnect, ircDisconnect, ircSwitchChannel,
  ircProcess, IRC_COMMANDS,
} from '../lib/irc-manager'

// ── Helpers ────────────────────────────────────────────────────────────────────

function nickColor(n: string) {
  const COLORS = ['#6fe0dc','#c9a3f0','#f4a970','#7fdca8','#e3a6c9','#f0d06a','#8fb8f0','#ff9d9d']
  let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) & 0xffff
  return COLORS[h % COLORS.length]
}

function fmtIdle(secs: number) {
  if (secs < 60) return `${secs}s`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`
}

function fmtTime(unix: number) {
  return new Date(unix * 1000).toLocaleString()
}

// ── Shared input style ─────────────────────────────────────────────────────────

const inp: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)',
  color: 'var(--text)', borderRadius: 6, padding: '7px 10px', fontSize: 13,
  outline: 'none', width: '100%', boxSizing: 'border-box',
}

// ── WHOIS Modal ────────────────────────────────────────────────────────────────

function WhoisModal({ info, onClose }: { info: WhoisInfo; onClose: () => void }) {
  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(10,12,16,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  }
  const box: React.CSSProperties = {
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
    padding: 24, width: 380, maxWidth: '90vw', boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
  }
  const row = (label: string, val?: string | number | boolean) =>
    val !== undefined && val !== '' && (
      <div key={label} style={{ display: 'flex', gap: 8, marginBottom: 6, fontSize: 13 }}>
        <span style={{ color: 'var(--text-muted)', minWidth: 90 }}>{label}</span>
        <span style={{ color: 'var(--text)' }}>{String(val)}</span>
      </div>
    )

  return (
    <div style={overlay} onClick={onClose}>
      <div style={box} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: nickColor(info.nick) }}>{info.nick}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
        {row('Nick', info.nick)}
        {row('User', info.user)}
        {row('Host', info.host)}
        {row('Real name', info.realname)}
        {row('Server', info.server)}
        {row('Server info', info.serverInfo)}
        {row('Account', info.account)}
        {row('Channels', info.channels)}
        {info.oper && row('IRC Op', '✓ Yes')}
        {info.idleSecs !== undefined && row('Idle', fmtIdle(info.idleSecs))}
        {info.signonTime && row('Signed on', fmtTime(info.signonTime))}
        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          <button onClick={() => { ircProcess(`/msg ${info.nick} `); onClose() }}
            style={{ ...btnStyle('var(--plum-mid)') }}>Message</button>
          <button onClick={() => { ircProcess(`/whois ${info.nick}`); onClose() }}
            style={{ ...btnStyle('var(--slate)') }}>Refresh</button>
          <button onClick={() => { ircProcess(`/ignore ${info.nick}`); onClose() }}
            style={{ ...btnStyle('var(--danger-fill)') }}>Ignore</button>
        </div>
      </div>
    </div>
  )
}

function btnStyle(bg: string): React.CSSProperties {
  return { background: bg, border: 'none', color: '#fff', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }
}

// ── Nick context menu ──────────────────────────────────────────────────────────

interface CtxMenu { nick: string; x: number; y: number }

function NickContextMenu({ menu, onClose }: { menu: CtxMenu; onClose: () => void }) {
  const items: { label: string; action: () => void; color?: string }[] = [
    { label: 'Whois',   action: () => ircProcess(`/whois ${menu.nick}`) },
    { label: 'Message', action: () => ircProcess(`/msg ${menu.nick}`) },
    { label: 'Op',      action: () => ircProcess(`/op ${menu.nick}`) },
    { label: 'Deop',    action: () => ircProcess(`/deop ${menu.nick}`) },
    { label: 'Voice',   action: () => ircProcess(`/voice ${menu.nick}`) },
    { label: 'Devoice', action: () => ircProcess(`/devoice ${menu.nick}`) },
    { label: 'Kick',    action: () => ircProcess(`/kick ${menu.nick}`), color: '#f59e0b' },
    { label: 'Ban',     action: () => ircProcess(`/ban ${menu.nick}`),  color: '#ef4444' },
    { label: 'Ignore',  action: () => ircProcess(`/ignore ${menu.nick}`), color: '#ef4444' },
  ]
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 900 }} onClick={onClose} />
      <div style={{
        position: 'fixed', top: menu.y, left: menu.x, zIndex: 901,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.4)', overflow: 'hidden', minWidth: 140,
      }}>
        <div style={{ padding: '6px 12px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {menu.nick}
        </div>
        {items.map(it => (
          <button key={it.label} onClick={() => { it.action(); onClose() }} style={{
            display: 'block', width: '100%', textAlign: 'left',
            background: 'none', border: 'none', color: it.color ?? 'var(--text)',
            padding: '7px 12px', cursor: 'pointer', fontSize: 13,
          }}
            onMouseEnter={e => (e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 12%, transparent)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >{it.label}</button>
        ))}
      </div>
    </>
  )
}

// ── Message row ────────────────────────────────────────────────────────────────

function MsgRow({ m }: { m: IRCMsg }) {
  const isMention = m.type === 'mention'
  const isAction  = m.type === 'action'
  const isChat    = m.type === 'chat' || m.type === 'self'
  const color = m.type === 'self' ? 'var(--accent)'
    : m.type === 'join' ? 'var(--success)'
    : (m.type === 'part' || m.type === 'quit') ? 'var(--warning)'
    : m.type === 'notice' ? '#8fb8f0'
    : m.type === 'error' ? 'var(--danger)'
    : m.type === 'action' ? '#c9a3f0'
    : m.type === 'server' ? 'var(--text-muted)'
    : 'var(--text)'

  return (
    <div style={{
      fontSize: 13, lineHeight: 1.6,
      padding: isMention ? '1px 6px' : '0',
      background: isMention ? 'rgba(142,42,102,0.25)' : 'transparent',
      borderLeft: isMention ? '2px solid var(--accent2)' : '2px solid transparent',
      borderRadius: 2,
    }}>
      <span style={{ color: 'var(--text-muted)', fontSize: 11, marginRight: 8, userSelect: 'none', fontFamily: 'monospace' }}>{m.ts}</span>
      {isChat
        ? <>
            <span style={{ color: m.type === 'self' ? 'var(--accent)' : nickColor(m.nick), fontWeight: 600, marginRight: 5 }}>&lt;{m.nick}&gt;</span>
            <span style={{ color: 'var(--text)' }}>{m.text}</span>
          </>
        : isAction
        ? <span style={{ color, fontStyle: 'italic' }}>{m.text}</span>
        : <span style={{ color, fontStyle: m.type === 'server' ? 'italic' : 'normal' }}>
            {m.type !== 'server' && m.nick ? `${m.nick} ` : ''}{m.text}
          </span>
      }
    </div>
  )
}

// ── Main IRC page ──────────────────────────────────────────────────────────────

export function IRC() {
  const connected      = useAppStore(s => s.ircConnected)
  const connecting     = useAppStore(s => s.ircConnecting)
  const channelList    = useAppStore(s => s.ircChannelList)
  const activeChannel  = useAppStore(s => s.ircActiveChannel)
  const messages       = useAppStore(s => s.ircMessages)
  const users          = useAppStore(s => s.ircUsers)
  const userPrefixes   = useAppStore(s => s.ircUserPrefixes)
  const unreadByChannel = useAppStore(s => s.ircUnreadByChannel)
  const topics         = useAppStore(s => s.ircTopics)
  const whoisInfo      = useAppStore(s => s.ircWhois)
  const ircNick        = useAppStore(s => s.ircNick)
  const ircAway        = useAppStore(s => s.ircAway)
  const setIrcState    = useAppStore(s => s.setIrcState)

  // Mark page visible
  useEffect(() => {
    setIrcState({ ircPageVisible: true })
    if (activeChannel) ircSwitchChannel(activeChannel)
    return () => setIrcState({ ircPageVisible: false })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Connection config — persisted to localStorage
  const savedCfg = (() => { try { return JSON.parse(localStorage.getItem('grove_irc_config') ?? '{}') } catch { return {} } })()
  const [host, setHost]               = useState<string>(savedCfg.host         ?? 'irc.arynwood.com')
  const [port, setPort]               = useState<string>(savedCfg.port         ?? '6697')
  const [nick, setNick]               = useState<string>(savedCfg.nick         ?? 'arynwood-hub')
  const [nickPassword, setNickPassword] = useState<string>(savedCfg.nickPassword ?? '')
  const [channels, setChannels]       = useState<string>(savedCfg.channels     ?? '#general')

  const saveCfg = (h = host, p = port, n = nick, ch = channels, pw = nickPassword) =>
    localStorage.setItem('grove_irc_config', JSON.stringify({ host: h, port: p, nick: n, channels: ch, nickPassword: pw }))

  // Load backend client config to prefill the connect form — does NOT auto-connect
  useEffect(() => {
    const { ircConnected, ircConnecting } = useAppStore.getState()
    if (ircConnected || ircConnecting) return

    fetch(groveUrl('/irc/client-config'))
      .then(r => r.json())
      .then((cfg: { host?: string; port?: number; nick?: string; nick_password?: string; channels?: string[]; socks5_proxy?: string }) => {
        if (cfg.host && cfg.nick && cfg.nick_password && cfg.channels?.length) {
          if (cfg.host)          setHost(cfg.host)
          if (cfg.port)          setPort(String(cfg.port))
          if (cfg.nick)          setNick(cfg.nick)
          if (cfg.nick_password) setNickPassword(cfg.nick_password)
          if (cfg.channels)      setChannels(cfg.channels.join(', '))
        }
      })
      .catch(() => {})
  }, [])

  // Input + autocomplete
  const [input, setInput]           = useState('')
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)
  const [completeIdx, setCompleteIdx]   = useState(0)

  // Context menu
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null)

  const scrollRef  = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLInputElement>(null)

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, activeChannel])

  // Autocomplete candidates
  const completions = input.startsWith('/')
    ? IRC_COMMANDS.filter(c => c.cmd.startsWith(input.split(' ')[0]))
    : []
  const showComplete = input.startsWith('/') && completions.length > 0 && !input.includes(' ') && dismissedFor !== input
  const typed = (value: string) => { setInput(value); setCompleteIdx(0) }
  const pick = (cmd: string) => { typed(cmd + ' '); inputRef.current?.focus() }

  const connect = () => {
    saveCfg()
    const chList = channels.split(',').map(c => c.trim()).filter(Boolean)
    ircConnect({ host, port: Number(port), nick, nick_password: nickPassword, channels: chList })
  }

  const send = useCallback(() => {
    const text = input.trim()
    if (!text) return
    if (!text.startsWith('/') && (!activeChannel || activeChannel === 'server')) return
    setInput('')
    ircProcess(text)
  }, [input, activeChannel])

  // Tab-complete nicks
  const tabComplete = () => {
    if (!activeChannel) return
    const channelUsers = users[activeChannel] ?? []
    const words = input.split(' ')
    const last = words[words.length - 1].toLowerCase()
    if (!last) return
    const match = channelUsers.find(u => u.toLowerCase().startsWith(last))
    if (match) {
      words[words.length - 1] = words.length === 1 ? `${match}: ` : match
      typed(words.join(' '))
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (showComplete) {
        pick(completions[completeIdx].cmd)
        e.preventDefault()
        return
      }
      send()
    } else if (e.key === 'Tab') {
      e.preventDefault()
      if (showComplete) {
        pick(completions[completeIdx].cmd)
      } else {
        tabComplete()
      }
    } else if (e.key === 'ArrowUp' && showComplete) {
      e.preventDefault()
      setCompleteIdx(i => Math.max(0, i - 1))
    } else if (e.key === 'ArrowDown' && showComplete) {
      e.preventDefault()
      setCompleteIdx(i => Math.min(completions.length - 1, i + 1))
    } else if (e.key === 'Escape') {
      setDismissedFor(input)
    }
  }

  const currentMsgs  = messages[activeChannel] ?? []
  const currentUsers = activeChannel && activeChannel !== 'server' ? (users[activeChannel] ?? []) : []
  const currentTopic = activeChannel && topics[activeChannel]
  const currentPfx   = activeChannel ? (userPrefixes[activeChannel] ?? {}) : {}

  return (
    <div className="connection-page irc">
      <TopBar title="IRC" />

      {whoisInfo && (
        <WhoisModal info={whoisInfo} onClose={() => setIrcState({ ircWhois: null })} />
      )}

      {ctxMenu && (
        <NickContextMenu menu={ctxMenu} onClose={() => setCtxMenu(null)} />
      )}

      <div className="irc-layout" style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ── Left: config + channel list ──────────────────────────────────── */}
        <div className="irc-side" style={{ width: 200, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>

          <div style={{ padding: 12, borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 7 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Server</div>
            <input aria-label="Server" value={host} onChange={e => { setHost(e.target.value); saveCfg(e.target.value) }} placeholder="host" style={{ ...inp, fontSize: 12 }} disabled={connected} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 64px', gap: 6 }}>
              <input aria-label="Nickname" value={nick} onChange={e => { setNick(e.target.value); saveCfg(host, port, e.target.value) }} placeholder="nick" style={{ ...inp, fontSize: 12 }} disabled={connected} />
              <input aria-label="Port" inputMode="numeric" value={port} onChange={e => { setPort(e.target.value); saveCfg(host, e.target.value) }} placeholder="6697" style={{ ...inp, fontSize: 12 }} disabled={connected} />
            </div>
            <input aria-label="NickServ password" autoComplete="off" value={nickPassword} onChange={e => { setNickPassword(e.target.value); saveCfg(host, port, nick, channels, e.target.value) }} placeholder="nickserv password" type="password" style={{ ...inp, fontSize: 12 }} disabled={connected} />
            <input aria-label="Channels" value={channels} onChange={e => { setChannels(e.target.value); saveCfg(host, port, nick, e.target.value) }} placeholder="#channel" style={{ ...inp, fontSize: 12 }} disabled={connected} />
            <button onClick={connected ? ircDisconnect : connect} disabled={connecting} style={{
              background: connected ? 'var(--danger-fill)' : 'var(--accent)',
              border: 'none', color: connected ? '#fff' : 'var(--on-accent)', borderRadius: 6, padding: '7px 0',
              cursor: connecting ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 600,
            }}>
              {connecting ? 'Connecting…' : connected ? 'Disconnect' : 'Connect'}
            </button>
          </div>

          {/* Channel list */}
          <div style={{ flex: 1, overflow: 'auto', padding: '6px 0' }}>
            {channelList.map(ch => {
              const u = unreadByChannel[ch] ?? 0
              return (
                <button key={ch} onClick={() => ircSwitchChannel(ch)} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', textAlign: 'left',
                  background: activeChannel === ch ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                  border: 'none',
                  color: activeChannel === ch ? 'var(--accent-text)' : u > 0 ? 'var(--text)' : 'var(--text-muted)',
                  padding: '7px 12px', cursor: 'pointer', fontSize: 13,
                  fontWeight: u > 0 ? 600 : 400,
                  borderLeft: `2px solid ${activeChannel === ch ? 'var(--accent)' : 'transparent'}`,
                }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ch === 'server' ? '⚡ server' : ch}
                  </span>
                  {u > 0 && (
                    <span style={{
                      minWidth: 18, height: 18, borderRadius: 9, background: 'var(--plum-mid)', color: '#fff',
                      fontSize: 10, fontWeight: 700, lineHeight: '18px', textAlign: 'center', padding: '0 4px', flexShrink: 0,
                    }}>{u > 99 ? '99+' : u}</span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Nick / away status footer */}
          {connected && (
            <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: ircAway ? 'var(--warning)' : 'var(--success)', flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{ircNick}</span>
              <button
                title={ircAway ? 'Back (remove away)' : 'Set away'}
                onClick={() => ircProcess(ircAway ? '/back' : '/away')}
                style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: 4, padding: '2px 5px', fontSize: 10, cursor: 'pointer' }}
              >
                {ircAway ? 'back' : 'away'}
              </button>
            </div>
          )}
        </div>

        {/* ── Center: messages ─────────────────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>

          {/* Header */}
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <span>{activeChannel || '—'}</span>
            {currentUsers.length > 0 && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>{currentUsers.length} users</span>
            )}
            {connected && (
              <span style={{ fontSize: 9, background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 7px', fontWeight: 700, textTransform: 'uppercase', marginLeft: 'auto' }}>
                connected
              </span>
            )}
          </div>

          {/* Topic bar */}
          {currentTopic && (
            <div style={{
              padding: '5px 16px', borderBottom: '1px solid var(--border)',
              fontSize: 12, color: 'var(--text-muted)', background: 'color-mix(in srgb, var(--accent) 4%, transparent)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0,
            }} title={currentTopic}>
              📌 {currentTopic}
            </div>
          )}

          {/* Messages */}
          <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 1 }}>
            {currentMsgs.length === 0 && (
              <div style={{ color: 'var(--text-muted)', fontSize: 12, fontStyle: 'italic', marginTop: 20, textAlign: 'center' }}>
                {connected ? 'No messages yet.' : 'Configure a server and click Connect.'}
              </div>
            )}
            {currentMsgs.map(m => <MsgRow key={m.id} m={m} />)}
          </div>

          {/* Command autocomplete dropdown */}
          {showComplete && completions.length > 0 && (
            <div style={{
              position: 'absolute', bottom: 60, left: 16, right: 16, zIndex: 50,
              background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
              boxShadow: '0 4px 20px rgba(0,0,0,0.3)', overflow: 'hidden', maxHeight: 240, overflowY: 'auto',
            }}>
              {completions.map((c, i) => (
                <div key={c.cmd}
                  onClick={() => pick(c.cmd)}
                  style={{
                    padding: '7px 12px', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'baseline',
                    background: i === completeIdx ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'transparent',
                  }}
                  onMouseEnter={() => setCompleteIdx(i)}
                >
                  <span style={{ fontWeight: 700, color: 'var(--accent)', fontSize: 13, fontFamily: 'monospace', minWidth: 100 }}>{c.cmd}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{c.args}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 'auto' }}>{c.desc}</span>
                </div>
              ))}
            </div>
          )}

          {/* Input bar */}
          <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, flexShrink: 0 }}>
            <input
              ref={inputRef}
              value={input}
              onChange={e => typed(e.target.value)}
              onKeyDown={onKeyDown}
              aria-label="Message"
              maxLength={450}
              placeholder={
                !connected ? 'Connect first…'
                : (!activeChannel || activeChannel === 'server') ? 'Type /join #channel to enter a room'
                : `Message ${activeChannel}  —  type / for commands`
              }
              disabled={!connected}
              style={{ ...inp, flex: 1 }}
            />
            <button onClick={send} disabled={!connected || !input.trim() || (!input.startsWith('/') && (!activeChannel || activeChannel === 'server'))} style={{
              background: 'var(--accent)', border: 'none', color: 'var(--on-accent)',
              borderRadius: 6, padding: '0 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              opacity: !connected || !input.trim() || (!input.startsWith('/') && (!activeChannel || activeChannel === 'server')) ? 0.5 : 1,
            }}>Send</button>
          </div>
        </div>

        {/* ── Right: user list ─────────────────────────────────────────────── */}
        {currentUsers.length > 0 && (
          <div className="irc-users" style={{ width: 160, borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Users — {currentUsers.length}
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '6px 0' }}>
              {currentUsers.map(u => {
                const pfx = currentPfx[u] ?? ''
                const pfxColor = pfx === '@' ? '#f0d06a' : pfx === '+' ? 'var(--success)' : 'var(--text-muted)'
                return (
                  <button
                    key={u}
                    className="irc-user"
                    title={`Right-click for options`}
                    onContextMenu={e => { e.preventDefault(); setCtxMenu({ nick: u, x: e.clientX, y: e.clientY }) }}
                    onClick={() => ircProcess(`/whois ${u}`)}
                    style={{ padding: '4px 12px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', width: '100%', background: 'none', border: 'none', textAlign: 'left' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 8%, transparent)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    {pfx && <span style={{ color: pfxColor, fontWeight: 700, fontSize: 11, width: 10, flexShrink: 0 }}>{pfx}</span>}
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: nickColor(u), flexShrink: 0 }} />
                    <span style={{ color: nickColor(u), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
