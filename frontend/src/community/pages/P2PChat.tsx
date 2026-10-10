import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { groveSocketUrl, groveUrl } from '../lib/grove'
import {
  Radio, Copy, Check, Send, UserPlus, Trash2, Wifi, WifiOff,
  Users, Plus, X, Image as ImageIcon, Clock, CheckCheck, KeyRound,
} from 'lucide-react'
import { decodeAttachment, encodeAttachment } from '../lib/attachments'
import { useAppStore } from '../store/useAppStore'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MsgStatus = 'sending' | 'sent' | 'receipt'

interface P2PMessage {
  id: string
  from: 'me' | 'them'
  sender?: string        // group messages — who said it
  contentType: 'text' | 'image' | 'file'
  content: string        // text body or base64 data-URL
  timestamp: number
  status?: MsgStatus     // outbound messages only
}

interface Contact {
  addr: string
  label: string
  color: string
}

interface Group {
  id: string
  name: string
  members: string[]
}

type WsEvent =
  | { type: 'status';       connected: boolean; addr: string | null }
  | { type: 'connected';    addr: string }
  | { type: 'disconnected' }
  | { type: 'message';      id?: string; src: string; contentType?: string; content?: string; text?: string; timestamp: number }
  | { type: 'receipt';      targetId: string; src: string; timestamp: number }
  | { type: 'error';        message: string }

// ---------------------------------------------------------------------------
// Avatar helpers
// ---------------------------------------------------------------------------

const AVATAR_COLORS = [
  '#176b57', '#1d4a47', '#26716e', '#147c78',
  '#3f7d5c', '#2c6e8a', '#3a7558', '#25605a',
]

function addrColor(addr: string): string {
  let h = 0
  for (const c of addr) h = ((h << 5) - h) + c.charCodeAt(0)
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

function Avatar({ label, color, size = 28 }: { label: string; color: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: color, color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.42, fontWeight: 700, flexShrink: 0,
      userSelect: 'none',
    }}>
      {label.charAt(0).toUpperCase()}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Message status icon
// ---------------------------------------------------------------------------

function StatusIcon({ status }: { status?: MsgStatus }) {
  if (!status || status === 'sending') return <Clock size={11} style={{ opacity: 0.5 }} />
  if (status === 'sent')    return <Check size={11} style={{ opacity: 0.6 }} />
  return <CheckCheck size={11} style={{ color: '#22c55e' }} />
}

// ---------------------------------------------------------------------------
// Local-storage helpers
// ---------------------------------------------------------------------------

const LS_CONTACTS = 'grove_p2p_contacts'
const LS_HISTORY  = 'grove_p2p_history'
const LS_GROUPS   = 'grove_p2p_groups'

function loadContacts(): Contact[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_CONTACTS) || '[]')
    return raw.map((c: Contact) => ({ ...c, color: c.color || addrColor(c.addr) }))
  } catch { return [] }
}
// Browser storage is small (about 5 MB) and images are large, so a failed write must never crash the page.
function store(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true } catch { return false }
}
function saveContacts(c: Contact[]) { store(LS_CONTACTS, c) }

function loadHistory(): Record<string, P2PMessage[]> {
  try { return JSON.parse(localStorage.getItem(LS_HISTORY) || '{}') } catch { return {} }
}
const HISTORY_LIMIT = 500
function saveHistory(h: Record<string, P2PMessage[]>) {
  const trimmed = Object.fromEntries(Object.entries(h).map(([k, v]) => [k, v.slice(-HISTORY_LIMIT)]))
  if (store(LS_HISTORY, trimmed)) return
  // Over quota: keep text and drop stored image data, which is what fills storage.
  const textOnly = Object.fromEntries(Object.entries(trimmed).map(([k, v]) => [k, v.map(m => m.contentType !== 'text' ? { ...m, contentType: 'text' as const, content: '[Attachment not saved: browser storage is full]' } : m)]))
  store(LS_HISTORY, textOnly)
}

// Only inline raster images are displayed; anything else a peer sends is shown as text.
const SAFE_IMAGE = /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/

function loadGroups(): Group[] {
  try { return JSON.parse(localStorage.getItem(LS_GROUPS) || '[]') } catch { return [] }
}
function saveGroups(g: Group[]) { store(LS_GROUPS, g) }

// Normalise legacy messages that used `text` instead of `content`
function normalise(msg: P2PMessage & { text?: string }): P2PMessage {
  return {
    ...msg,
    contentType: msg.contentType || 'text',
    content:     msg.content ?? msg.text ?? '',
  }
}

function genId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

// ---------------------------------------------------------------------------
// Shared input style
// ---------------------------------------------------------------------------

const inputStyle: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 8,
  border: '1px solid var(--border)', background: 'var(--surface)',
  color: 'inherit', fontSize: 13, outline: 'none',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function P2PChat() {
  const wsRef        = useRef<WebSocket | null>(null)
  const bottomRef    = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const activeKeyRef = useRef<string | null>(null)
  const visibleRef   = useRef<HTMLDivElement>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const connectRef   = useRef<() => void>(() => {})

  const p2pUnread    = useAppStore(s => s.p2pUnread)
  const setP2pUnread = useAppStore(s => s.setP2pUnread)

  const [connected,   setConnected]   = useState(false)
  const [connecting,  setConnecting]  = useState(false)
  const [myAddr,      setMyAddr]      = useState<string | null>(null)
  const [contacts,    setContacts]    = useState<Contact[]>(loadContacts)
  const [groups,      setGroups]      = useState<Group[]>(loadGroups)
  const groupsRef = useRef(groups)
  useEffect(() => { groupsRef.current = groups }, [groups])
  const [history,     setHistory]     = useState<Record<string, P2PMessage[]>>(loadHistory)
  const [activeKey,   setActiveKey]   = useState<string | null>(null)
  const [input,       setInput]       = useState('')
  const [copied,      setCopied]      = useState(false)
  const [errMsg,      setErrMsg]      = useState<string | null>(null)

  const [addContactOpen,   setAddContactOpen]   = useState(false)
  const [newAddr,          setNewAddr]          = useState('')
  const [newLabel,         setNewLabel]         = useState('')

  const [createGroupOpen,  setCreateGroupOpen]  = useState(false)
  const [newGroupName,     setNewGroupName]     = useState('')
  const [selectedMembers,  setSelectedMembers]  = useState<Set<string>>(new Set())

  const [manageGroupId,    setManageGroupId]    = useState<string | null>(null)
  const [addMemberAddr,    setAddMemberAddr]    = useState('')

  const [walletOpen,       setWalletOpen]       = useState(false)
  const [walletInput,      setWalletInput]      = useState('')
  const [walletSaving,     setWalletSaving]     = useState(false)

  // -------------------------------------------------------------------------
  // Active-key switch — clear unread and sync ref
  // -------------------------------------------------------------------------

  function switchActiveKey(key: string | null) {
    activeKeyRef.current = key
    setActiveKey(key)
    if (key) setP2pUnread({ ...useAppStore.getState().p2pUnread, [key]: 0 })
  }

  const bumpUnread = useCallback((key: string) => {
    // Hidden while you are on another page: count it even for the open conversation.
    if (activeKeyRef.current === key && visibleRef.current?.offsetParent) return
    const cur = useAppStore.getState().p2pUnread
    setP2pUnread({ ...cur, [key]: (cur[key] ?? 0) + 1 })
  }, [setP2pUnread])

  // -------------------------------------------------------------------------
  // Receipt: find message by id across all history and update status
  // -------------------------------------------------------------------------

  function applyReceipt(targetId: string) {
    setHistory(prev => {
      let changed = false
      const updated = { ...prev }
      for (const key of Object.keys(updated)) {
        const idx = updated[key].findIndex(m => m.id === targetId)
        if (idx !== -1) {
          updated[key] = updated[key].map((m, i) =>
            i === idx ? { ...m, status: 'receipt' as MsgStatus } : m
          )
          changed = true
          break
        }
      }
      if (changed) saveHistory(updated)
      return changed ? updated : prev
    })
  }

  // -------------------------------------------------------------------------
  // WebSocket
  // -------------------------------------------------------------------------

  const connectWs = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState <= 1) return
    const ws = new WebSocket(groveSocketUrl('/p2p/ws'))
    wsRef.current = ws

    ws.onmessage = (ev) => {
      let data: WsEvent
      try { data = JSON.parse(ev.data) } catch { return }

      if (data.type === 'status') {
        setConnected(data.connected); setMyAddr(data.addr)
        if (data.connected) setConnecting(false)

      } else if (data.type === 'connected') {
        setConnected(true); setConnecting(false); setMyAddr(data.addr)

      } else if (data.type === 'disconnected') {
        setConnected(false); setConnecting(false); setMyAddr(null)

      } else if (data.type === 'receipt') {
        applyReceipt(data.targetId)

      } else if (data.type === 'message') {
        const src         = data.src
        const raw         = String(data.content ?? data.text ?? '')
        const contentType = (data.contentType === 'file' && decodeAttachment(raw) ? 'file' : data.contentType === 'image' && SAFE_IMAGE.test(raw) ? 'image' : 'text') as 'text' | 'image' | 'file'
        const content     = contentType === 'image' || contentType === 'file' ? raw : data.contentType === 'image' ? '[Unsupported image]' : data.contentType === 'file' ? '[Unsupported attachment]' : raw.slice(0, 20000)
        const baseMsg: P2PMessage = {
          id: data.id || genId(),
          from: 'them',
          contentType,
          content,
          timestamp: data.timestamp,
        }

        setHistory(prev => {
          const updated = { ...prev, [src]: [...(prev[src] || []), baseMsg] }
          saveHistory(updated)
          return updated
        })
        bumpUnread(src)

        const matching = groupsRef.current.filter(g => g.members.includes(src))
        if (matching.length > 0) {
          setHistory(prev => {
            let updated = { ...prev }
            for (const g of matching) {
              const gKey     = `group:${g.id}`
              const groupMsg = { ...baseMsg, id: `${baseMsg.id}-${g.id}`, sender: src }
              updated = { ...updated, [gKey]: [...(updated[gKey] || []), groupMsg] }
            }
            saveHistory(updated)
            return updated
          })
          for (const g of matching) bumpUnread(`group:${g.id}`)
        }

        setContacts(prev => {
          if (prev.some(c => c.addr === src)) return prev
          const updated = [...prev, { addr: src, label: src.slice(0, 16) + '…', color: addrColor(src) }]
          saveContacts(updated)
          return updated
        })

      } else if (data.type === 'error') {
        setConnecting(false)
        setErrMsg(data.message)
        setTimeout(() => setErrMsg(null), 4000)
      }
    }

    ws.onclose = () => { reconnectRef.current = setTimeout(() => connectRef.current(), 3000) }
  }, [bumpUnread])
  useEffect(() => { connectRef.current = connectWs }, [connectWs])

  useEffect(() => {
    connectWs()
    return () => {
      clearTimeout(reconnectRef.current)
      if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); wsRef.current = null }
    }
  }, [connectWs])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [history, activeKey])

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  function wsSend(obj: object) {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(obj))
  }

  function handleStartStop() {
    if (wsRef.current?.readyState !== WebSocket.OPEN) { setErrMsg('Still connecting to the local service. Try again shortly.'); return }
    if (connected) { wsSend({ type: 'stop' }) }
    else if (!connecting) { setConnecting(true); wsSend({ type: 'start' }) }
  }

  function addToHistory(key: string, msg: P2PMessage) {
    setHistory(prev => {
      const updated = { ...prev, [key]: [...(prev[key] || []), msg] }
      saveHistory(updated)
      return updated
    })
  }

  function handleSend() {
    const text = input.trim()
    if (!text || !activeKey || !connected) return
    sendContent('text', text)
    setInput('')
  }

  function sendContent(contentType: 'text' | 'image' | 'file', content: string) {
    if (!activeKey || !connected) return
    const id  = genId()
    const msg: P2PMessage = {
      id, from: 'me', contentType, content,
      timestamp: Date.now(), status: 'sent',
    }

    if (activeKey.startsWith('group:')) {
      const group = groups.find(g => `group:${g.id}` === activeKey)
      if (!group || group.members.length === 0) return
      wsSend({ type: 'send_multi', dests: group.members, content, contentType, id })
    } else {
      wsSend({ type: 'send', dest: activeKey, content, contentType, id })
    }

    addToHistory(activeKey, msg)
  }

  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    if (file.size > 2 * 1024 * 1024) {
      setErrMsg('Image too large — max 2 MB')
      setTimeout(() => setErrMsg(null), 4000)
      return
    }
    const reader = new FileReader()
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string
      sendContent('image', dataUrl)
    }
    reader.readAsDataURL(file)
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file=e.target.files?.[0];e.target.value='';if(!file)return
    try { sendContent('file',await encodeAttachment(file)) } catch(e) { setErrMsg((e as Error).message) }
  }

  function handleCopyAddr() {
    if (!myAddr) return
    navigator.clipboard.writeText(myAddr).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }, () => {})
  }

  function handleAddContact() {
    const addr  = newAddr.trim()
    const label = newLabel.trim() || addr.slice(0, 16) + '…'
    if (!addr) return
    setContacts(prev => {
      if (prev.some(c => c.addr === addr)) return prev
      const updated = [...prev, { addr, label, color: addrColor(addr) }]
      saveContacts(updated); return updated
    })
    setNewAddr(''); setNewLabel(''); setAddContactOpen(false)
    switchActiveKey(addr)
  }

  function handleDeleteContact(addr: string) {
    setContacts(prev => { const u = prev.filter(c => c.addr !== addr); saveContacts(u); return u })
    if (activeKey === addr) switchActiveKey(null)
  }

  function handleCreateGroup() {
    const name = newGroupName.trim()
    if (!name) return
    const group: Group = { id: Date.now().toString(), name, members: Array.from(selectedMembers) }
    setGroups(prev => { const u = [...prev, group]; saveGroups(u); return u })
    setNewGroupName(''); setSelectedMembers(new Set()); setCreateGroupOpen(false)
    switchActiveKey(`group:${group.id}`)
  }

  function handleDeleteGroup(id: string) {
    setGroups(prev => { const u = prev.filter(g => g.id !== id); saveGroups(u); return u })
    if (activeKey === `group:${id}`) switchActiveKey(null)
  }

  function addMemberToGroup(groupId: string, addr: string) {
    if (!addr) return
    setGroups(prev => {
      const updated = prev.map(g =>
        g.id === groupId
          ? { ...g, members: g.members.includes(addr) ? g.members : [...g.members, addr] }
          : g
      )
      saveGroups(updated); return updated
    })
    setContacts(prev => {
      if (prev.some(c => c.addr === addr)) return prev
      const updated = [...prev, { addr, label: addr.slice(0, 16) + '…', color: addrColor(addr) }]
      saveContacts(updated); return updated
    })
  }

  function handleAddMemberFromInput(groupId: string) {
    const addr = addMemberAddr.trim()
    if (!addr) return
    addMemberToGroup(groupId, addr); setAddMemberAddr('')
  }

  function handleRemoveMember(groupId: string, addr: string) {
    setGroups(prev => {
      const updated = prev.map(g =>
        g.id === groupId ? { ...g, members: g.members.filter(m => m !== addr) } : g
      )
      saveGroups(updated); return updated
    })
  }

  async function handleWalletImport() {
    const raw = walletInput.trim()
    if (!raw) return
    setWalletSaving(true)
    try {
      const body = raw.startsWith('{')
        ? { wallet_json: raw }
        : { seed: raw }
      const res = await fetch(groveUrl('/p2p/wallet'), {
        method: 'POST',
        // The Grove refuses a change without this header (its cross-site request guard).
        headers: { 'Content-Type': 'application/json', 'X-Community-Request': '1' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'That identity could not be used.')
      }
      setWalletOpen(false)
      setWalletInput('')
      setConnected(false); setConnecting(false); setMyAddr(null)
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : 'That identity could not be used.')
      setTimeout(() => setErrMsg(null), 4000)
    } finally {
      setWalletSaving(false)
    }
  }

  // -------------------------------------------------------------------------
  // Derived
  // -------------------------------------------------------------------------

  const rawMessages  = activeKey ? (history[activeKey] || []) : []
  const activeMessages = rawMessages.map(normalise)
  const activeContact  = activeKey && !activeKey.startsWith('group:')
    ? contacts.find(c => c.addr === activeKey) : null
  const activeGroup    = activeKey?.startsWith('group:')
    ? groups.find(g => `group:${g.id}` === activeKey) : null
  const manageGroup    = manageGroupId ? groups.find(g => g.id === manageGroupId) : null

  function contactLabel(addr: string) {
    return contacts.find(c => c.addr === addr)?.label || addr.slice(0, 16) + '…'
  }
  function contactColor(addr: string) {
    return contacts.find(c => c.addr === addr)?.color || addrColor(addr)
  }
  function fmtTime(ts: number) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div ref={visibleRef} className="connection-page p2p" style={{ display: 'flex', height: '100%', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Top bar */}
      <div style={{
        padding: '12px 20px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
      }}>
        <Radio size={18} style={{ color: 'var(--accent)' }} />
        <h1 style={{ fontWeight: 600, fontSize: 15, margin: 0 }}>Message</h1>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>private and direct</span>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {myAddr && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 8, padding: '4px 10px', fontSize: 12,
            }}>
              <span style={{ color: 'var(--text-muted)' }}>Your address:</span>
              <span style={{ fontFamily: 'monospace', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {myAddr}
              </span>
              <button onClick={handleCopyAddr} title="Copy address" aria-label="Copy address"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
                {copied ? <Check size={13} style={{ color: 'var(--success)' }} /> : <Copy size={13} />}
              </button>
            </div>
          )}
          <button onClick={() => setWalletOpen(true)} title="Use an existing identity" aria-label="Use an existing identity"
            style={{
              background: 'none', border: '1px solid var(--border)', borderRadius: 8,
              cursor: 'pointer', color: 'var(--text-muted)', display: 'flex',
              alignItems: 'center', padding: '6px 8px',
            }}>
            <KeyRound size={14} />
          </button>
          <button onClick={handleStartStop} disabled={connecting} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 14px', borderRadius: 8, border: 'none',
            cursor: connecting ? 'default' : 'pointer', fontSize: 13, fontWeight: 600,
            background: connected ? 'rgba(239,68,68,0.12)' : connecting ? 'color-mix(in srgb, var(--accent) 20%, transparent)' : 'var(--accent)',
            color: connected ? 'var(--danger)' : connecting ? 'var(--accent)' : 'var(--on-accent)',
          }}>
            {connected
              ? <><WifiOff size={14} /> Go offline</>
              : connecting
              ? <><Wifi size={14} style={{ animation: 'pulse 1.2s ease-in-out infinite' }} /> Going online…</>
              : <><Wifi size={14} /> Go online</>
            }
          </button>
        </div>
      </div>

      {/* Error banner */}
      {errMsg && (
        <div style={{
          background: 'rgba(239,68,68,0.12)', color: 'var(--danger)',
          padding: '8px 20px', fontSize: 13, borderBottom: '1px solid var(--border)',
        }}>{errMsg}</div>
      )}

      {/* Body */}
      <div className="p2p-layout" style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Sidebar */}
        <div className="p2p-side" style={{
          width: 240, flexShrink: 0, borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>

          {/* — Contacts — */}
          <div style={{
            padding: '10px 12px', borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
          }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>CONTACTS</span>
            <button onClick={() => setAddContactOpen(true)} title="Add contact"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', display: 'flex' }}>
              <UserPlus size={16} />
            </button>
          </div>

          <div style={{ overflowY: 'auto', maxHeight: '45%' }}>
            {contacts.length === 0 && (
              <div style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-muted)' }}>No contacts yet.</div>
            )}
            {contacts.map(c => (
              <div key={c.addr} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') switchActiveKey(c.addr) }} onClick={() => switchActiveKey(c.addr)} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: 'pointer',
                background: activeKey === c.addr ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                borderLeft: activeKey === c.addr ? '2px solid var(--accent)' : '2px solid transparent',
              }}>
                <Avatar label={c.label} color={c.color} size={28} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{c.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.addr}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                  {(p2pUnread[c.addr] ?? 0) > 0 && (
                    <span style={{ minWidth: 18, height: 18, borderRadius: 9, background: 'var(--plum-mid)', color: '#fff', fontSize: 10, fontWeight: 700, lineHeight: '18px', textAlign: 'center', padding: '0 4px' }}>
                      {p2pUnread[c.addr] > 99 ? '99+' : p2pUnread[c.addr]}
                    </span>
                  )}
                  <button onClick={e => { e.stopPropagation(); handleDeleteContact(c.addr) }} title="Remove"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', opacity: 0.6 }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* — Groups — */}
          <div style={{
            padding: '10px 12px', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
          }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>GROUPS</span>
            <button onClick={() => setCreateGroupOpen(true)} title="Create group"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', display: 'flex' }}>
              <Plus size={16} />
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {groups.length === 0 && (
              <div style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-muted)' }}>No groups yet.</div>
            )}
            {groups.map(g => (
              <div key={g.id} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') switchActiveKey(`group:${g.id}`) }} onClick={() => switchActiveKey(`group:${g.id}`)} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 12px', cursor: 'pointer',
                background: activeKey === `group:${g.id}` ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                borderLeft: activeKey === `group:${g.id}` ? '2px solid var(--accent)' : '2px solid transparent',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <Users size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{g.members.length} member{g.members.length !== 1 ? 's' : ''}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                  {(p2pUnread[`group:${g.id}`] ?? 0) > 0 && (
                    <span style={{ minWidth: 18, height: 18, borderRadius: 9, background: 'var(--plum-mid)', color: '#fff', fontSize: 10, fontWeight: 700, lineHeight: '18px', textAlign: 'center', padding: '0 4px' }}>
                      {p2pUnread[`group:${g.id}`] > 99 ? '99+' : p2pUnread[`group:${g.id}`]}
                    </span>
                  )}
                  <button onClick={e => { e.stopPropagation(); setManageGroupId(g.id) }} title="Manage"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', opacity: 0.6 }}>
                    <UserPlus size={13} />
                  </button>
                  <button onClick={e => { e.stopPropagation(); handleDeleteGroup(g.id) }} title="Delete"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', opacity: 0.6 }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Chat window */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {!activeKey ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', flexDirection: 'column', gap: 8 }}>
              <Radio size={32} style={{ opacity: 0.3 }} />
              <span style={{ fontSize: 14 }}>Choose someone to message</span>
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                {activeGroup
                  ? <Users size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                  : activeContact && <Avatar label={activeContact.label} color={activeContact.color} size={30} />
                }
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{activeGroup ? activeGroup.name : activeContact?.label}</div>
                  {activeGroup
                    ? <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                        {activeGroup.members.length === 0 ? 'No members' : activeGroup.members.map(contactLabel).join(', ')}
                      </div>
                    : <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeKey}</div>
                  }
                </div>
              </div>

              {/* Messages */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {activeMessages.length === 0 && (
                  <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', marginTop: 20 }}>No messages yet</div>
                )}
                {activeMessages.map(msg => (
                  <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.from === 'me' ? 'flex-end' : 'flex-start' }}>

                    {/* Sender label + avatar for group incoming */}
                    {msg.from === 'them' && activeGroup && msg.sender && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, paddingLeft: 4 }}>
                        <Avatar label={contactLabel(msg.sender)} color={contactColor(msg.sender)} size={18} />
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{contactLabel(msg.sender)}</span>
                      </div>
                    )}

                    <div style={{
                      maxWidth: '70%',
                      background: msg.from === 'me' ? 'var(--accent)' : 'var(--surface2)',
                      color: msg.from === 'me' ? 'var(--on-accent)' : 'inherit',
                      border: msg.from === 'me' ? 'none' : '1px solid var(--border)',
                      borderRadius: msg.from === 'me' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                      padding: '8px 12px',
                    }}>
                      {msg.contentType === 'file' ? <FileAttachment content={msg.content}/> : msg.contentType === 'image' ? (
                        <img
                          src={msg.content}
                          alt="shared image"
                          style={{ maxWidth: '100%', maxHeight: 240, borderRadius: 6, display: 'block' }}
                        />
                      ) : (
                        <div style={{ fontSize: 14, lineHeight: 1.4, wordBreak: 'break-word' }}>{msg.content}</div>
                      )}
                      <div style={{ fontSize: 11, marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4, opacity: 0.7 }}>
                        <span>{fmtTime(msg.timestamp)}</span>
                        {msg.from === 'me' && <StatusIcon status={msg.status} />}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>

              {/* Input bar */}
              <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  ref={fileInputRef}
                  style={{ display: 'none' }}
                  onChange={handleImageSelect}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!connected}
                  title="Send image"
                  style={{
                    background: 'none', border: '1px solid var(--border)', borderRadius: 8,
                    padding: '8px 10px', cursor: connected ? 'pointer' : 'not-allowed',
                    color: 'var(--text-muted)', display: 'flex', alignItems: 'center',
                    opacity: connected ? 1 : 0.4,
                  }}>
                  <ImageIcon size={15} />
                </button>
                <input type="file" ref={attachmentInputRef} style={{display:'none'}} onChange={e=>void handleFileSelect(e)}/>
                <button title="Send file (up to 1 MB)" disabled={!connected} onClick={()=>attachmentInputRef.current?.click()} style={{background:'none',border:'1px solid var(--border)',borderRadius:8,padding:'8px 10px',color:'var(--text-muted)',cursor:'pointer'}}>File</button>
                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                  aria-label="Message" maxLength={20000}
                  placeholder={!connected ? 'Go online to send' : activeGroup ? `Message ${activeGroup.name}…` : 'Type a message…'}
                  style={{
                    flex: 1, padding: '8px 12px', borderRadius: 8,
                    border: '1px solid var(--border)', background: 'var(--surface)',
                    color: 'inherit', fontSize: 14, outline: 'none',
                  }}
                />
                <button onClick={handleSend} disabled={!connected || !input.trim()} style={{
                  padding: '8px 16px', borderRadius: 8, border: 'none',
                  background: 'var(--accent)', color: 'var(--on-accent)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                  opacity: (!connected || !input.trim()) ? 0.5 : 1,
                }}>
                  <Send size={15} aria-label="Send" />
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Add-contact dialog ── */}
      {addContactOpen && (
        <div onClick={() => setAddContactOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(10,12,16,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, width: 380, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>Add contact</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Their address</label>
              <input autoFocus value={newAddr} onChange={e => setNewAddr(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddContact() }}
                placeholder="Paste the address they shared" style={inputStyle} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Name (optional)</label>
              <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddContact() }}
                placeholder="Nickname" style={inputStyle} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setAddContactOpen(false)} style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
              <button onClick={handleAddContact} disabled={!newAddr.trim()} style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: 'var(--on-accent)', cursor: 'pointer', fontSize: 13, opacity: !newAddr.trim() ? 0.5 : 1 }}>Add</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create-group dialog ── */}
      {createGroupOpen && (
        <div onClick={() => { setCreateGroupOpen(false); setSelectedMembers(new Set()) }} style={{ position: 'fixed', inset: 0, background: 'rgba(10,12,16,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, width: 400, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>New group</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Group name</label>
              <input autoFocus value={newGroupName} onChange={e => setNewGroupName(e.target.value)} placeholder="e.g. Family" style={inputStyle} />
            </div>
            {contacts.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Add people</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
                  {contacts.map(c => (
                    <label key={c.addr} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, background: 'var(--surface)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={selectedMembers.has(c.addr)} onChange={e => {
                        const next = new Set(selectedMembers)
                        if (e.target.checked) next.add(c.addr); else next.delete(c.addr)
                        setSelectedMembers(next)
                      }} />
                      <Avatar label={c.label} color={c.color} size={20} />
                      <span style={{ fontSize: 13, flex: 1 }}>{c.label}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.addr}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setCreateGroupOpen(false); setSelectedMembers(new Set()) }} style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
              <button onClick={handleCreateGroup} disabled={!newGroupName.trim()} style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: 'var(--on-accent)', cursor: 'pointer', fontSize: 13, opacity: !newGroupName.trim() ? 0.5 : 1 }}>Create</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Manage-group dialog ── */}
      {manageGroup && (
        <div onClick={() => { setManageGroupId(null); setAddMemberAddr('') }} style={{ position: 'fixed', inset: 0, background: 'rgba(10,12,16,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, width: 440, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>{manageGroup.name}</h3>
              <button onClick={() => { setManageGroupId(null); setAddMemberAddr('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}><X size={18} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>MEMBERS</span>
              {manageGroup.members.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No members yet.</div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
                {manageGroup.members.map(addr => (
                  <div key={addr} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', borderRadius: 8, background: 'var(--surface)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <Avatar label={contactLabel(addr)} color={contactColor(addr)} size={22} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13 }}>{contactLabel(addr)}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{addr}</div>
                      </div>
                    </div>
                    <button onClick={() => handleRemoveMember(manageGroup.id, addr)} title="Remove" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', display: 'flex', flexShrink: 0, opacity: 0.8 }}><X size={14} /></button>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>ADD MEMBER</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={addMemberAddr} onChange={e => setAddMemberAddr(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddMemberFromInput(manageGroup.id) }}
                  placeholder="Their address" style={{ ...inputStyle, flex: 1 }} />
                <button onClick={() => handleAddMemberFromInput(manageGroup.id)} disabled={!addMemberAddr.trim()}
                  style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: 'var(--on-accent)', cursor: 'pointer', fontSize: 13, opacity: !addMemberAddr.trim() ? 0.5 : 1 }}>
                  Add
                </button>
              </div>
              {contacts.filter(c => !manageGroup.members.includes(c.addr)).length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {contacts.filter(c => !manageGroup.members.includes(c.addr)).map(c => (
                    <button key={c.addr} onClick={() => addMemberToGroup(manageGroup.id, c.addr)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20, border: '1px solid var(--border)', background: 'var(--surface)', color: 'inherit', cursor: 'pointer', fontSize: 12 }}>
                      <Avatar label={c.label} color={c.color} size={14} />
                      + {c.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Wallet import modal ── */}
      {walletOpen && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(10,12,16,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }} onClick={() => setWalletOpen(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 14, padding: 24, width: 440, maxWidth: '95vw',
            display: 'flex', flexDirection: 'column', gap: 16,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <KeyRound size={16} style={{ color: 'var(--accent)' }} />
                <span style={{ fontWeight: 600, fontSize: 15 }}>Use an existing identity</span>
              </div>
              <button onClick={() => setWalletOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
                <X size={18} />
              </button>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Paste your <strong>secret key</strong> (64 characters) or a saved <strong>identity file</strong> to keep the same address.
              This replaces the identity on this computer.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>SECRET KEY OR IDENTITY FILE</label>
              <textarea
                value={walletInput}
                onChange={e => setWalletInput(e.target.value)}
                placeholder={'Secret key, or the contents of an identity file'}
                rows={5}
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setWalletOpen(false)} style={{
                padding: '7px 16px', borderRadius: 8, border: '1px solid var(--border)',
                background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13,
              }}>Cancel</button>
              <button onClick={handleWalletImport} disabled={!walletInput.trim() || walletSaving} style={{
                padding: '7px 16px', borderRadius: 8, border: 'none',
                background: 'var(--accent)', color: 'var(--on-accent)',
                cursor: walletInput.trim() && !walletSaving ? 'pointer' : 'not-allowed',
                fontSize: 13, fontWeight: 600, opacity: !walletInput.trim() || walletSaving ? 0.5 : 1,
              }}>
                {walletSaving ? 'Saving…' : 'Use this identity'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FileAttachment({content}:{content:string}) {
 const attachment=useMemo(()=>decodeAttachment(content),[content])
 const url=useMemo(()=>attachment?URL.createObjectURL(new Blob([new Uint8Array(attachment.bytes)],{type:'application/octet-stream'})):null,[attachment])
 useEffect(()=>()=>{if(url)URL.revokeObjectURL(url)},[url])
 return attachment&&url?<a href={url} download={attachment.name} style={{color:'inherit'}}>Download {attachment.name} ({Math.ceil(attachment.bytes.length/1024)} KB)</a>:<span>Unsupported attachment</span>
}
