import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import { DEVICES, samePage, type Device, type Pin, type Spot } from '../lib/site'
import { previewUrl } from '../lib/grove'

export interface PreviewHandle {
  /** Loads the page again, back where it was scrolled. */
  reload: () => void
  /** Fetches the page's stylesheets again, without reloading it. */
  restyle: () => void
  /** Opens a page, and points at a note's pin once it's there. */
  show: (address: string, pin?: string) => void
}
const join = (url: string, address: string) => url.replace(/\/$/, '') + '/' + address.replace(/^\/+/, '')
const words = (value: unknown, max: number) => typeof value === 'string' ? value.slice(0, max) : ''
const fraction = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0

/** A website's preview inside the Grove. The page's own scripts run sandboxed, apart from the Grove;
 *  a small script the preview adds to each page tells this pane where it is, finds the spot someone
 *  points at, and draws notes' pins. What it sends is only ever treated as words. */
export function PreviewFrame({ url, start = '/', device, title, pins, picking = false, onPage, onPicked, onPickEnd, onPin, ref }: {
  url: string; start?: string; device: Device; title: string; pins: Pin[]; picking?: boolean
  onPage?: (address: string, title: string) => void; onPicked?: (spot: Spot) => void; onPickEnd?: () => void; onPin?: (id: string) => void
  ref?: React.Ref<PreviewHandle>
}) {
  const frame = useRef<HTMLIFrameElement>(null), stage = useRef<HTMLDivElement>(null)
  const [target, setTarget] = useState({ src: join(url, start), load: 0 }), [room, setRoom] = useState({ width: 0, height: 0 })
  // Where the page is, whether its script answers, where each page was scrolled, and what to do once it's loaded.
  const page = useRef(start), alive = useRef(false), heard = useRef(false), scrolled = useRef(new Map<string, { x: number; y: number }>())
  const restore = useRef(false), pending = useRef('')
  const latest = useRef({ url, pins, picking, onPage, onPicked, onPickEnd, onPin })
  useEffect(() => { latest.current = { url, pins, picking, onPage, onPicked, onPickEnd, onPin } })
  const send = (message: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ grove: 'host', ...message }, '*')
  const open = (address: string) => { alive.current = false; page.current = address; setTarget(t => ({ src: join(latest.current.url, address), load: t.load + 1 })) }

  useImperativeHandle(ref, () => {
    const reload = () => {
      restore.current = true
      if (alive.current) { alive.current = false; send({ type: 'reload' }) } else open(page.current)
    }
    return {
      reload,
      restyle() { if (alive.current) send({ type: 'styles' }); else reload() },
      show(address, pin) {
        if (alive.current && samePage(address, page.current)) { if (pin) send({ type: 'focus', id: pin }); return }
        pending.current = pin ?? ''; restore.current = false; open(address)
      },
    }
  }, [])
  // A fresh address for the preview (they last an hour): the same page, under it.
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    restore.current = true
    open(page.current)
  }, [url])
  useEffect(() => {
    function heardFrom(event: MessageEvent) {
      const m = event.data
      if (event.source !== frame.current?.contentWindow || !m || typeof m !== 'object' || m.grove !== 'preview') return
      const l = latest.current
      if (m.type === 'page') {
        alive.current = heard.current = true
        const address = words(m.page, 2000) || '/', again = restore.current && samePage(address, page.current)
        page.current = address; restore.current = false
        send({ type: 'pins', pins: l.pins })
        if (l.picking) send({ type: 'pick', on: true })
        const spot = scrolled.current.get(address)
        if (again && spot) send({ type: 'scroll', ...spot })
        if (pending.current) { send({ type: 'focus', id: pending.current }); pending.current = '' }
        l.onPage?.(address, words(m.title, 300))
      } else if (m.type === 'scrolled') scrolled.current.set(words(m.page, 2000), { x: Number(m.x) || 0, y: Number(m.y) || 0 })
      else if (m.type === 'picked') l.onPicked?.({ page: words(m.page, 2000) || '/', selector: words(m.selector, 2000), quote: words(m.quote, 1000), tag: words(m.tag, 40), x: fraction(m.x), y: fraction(m.y) })
      else if (m.type === 'pick-cancelled') l.onPickEnd?.()
      else if (m.type === 'pin' && typeof m.id === 'string') l.onPin?.(m.id)
    }
    window.addEventListener('message', heardFrom)
    return () => window.removeEventListener('message', heardFrom)
  }, [])
  const pinned = JSON.stringify(pins)
  useEffect(() => { send({ type: 'pins', pins: JSON.parse(pinned) }) }, [pinned])
  useEffect(() => { send({ type: 'pick', on: picking }) }, [picking])
  useEffect(() => {
    const el = stage.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(([entry]) => setRoom({ width: entry.contentRect.width, height: entry.contentRect.height }))
    watch.observe(el)
    return () => watch.disconnect()
  }, [])

  // A phone or tablet keeps its width, shrunk to fit when the pane is narrower.
  const width = DEVICES[device], scale = width && room.width ? Math.min(1, room.width / width) : 1
  const sized = width ? { width, height: room.height ? room.height / scale : '100%', transform: scale < 1 ? `scale(${scale})` : undefined, transformOrigin: 'top left' } : undefined
  return <div className={'preview-stage' + (picking ? ' picking' : '')} ref={stage}>
    <div className={'preview-device preview-' + device} style={width ? { width: width * scale } : undefined}>
      <iframe key={target.load} ref={frame} title={title} src={previewUrl(target.src)} style={sized} referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
        // A page without the preview's script, such as a picture opened from a link, can't be told to reload itself.
        onLoad={() => { alive.current = heard.current; heard.current = false }} />
    </div>
  </div>
}
