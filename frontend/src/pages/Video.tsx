import { useCallback, useEffect, useState } from 'react'
import { Wand2, Scissors, Captions, Clapperboard, type LucideIcon } from 'lucide-react'
import { GeneratePanel } from '../components/video/GeneratePanel'
import { TimelineEditor } from '../components/video/TimelineEditor'
import { CaptionsPanel, type CaptionSegment } from '../components/video/CaptionsPanel'
import { getVideoLibrary, type VideoLibraryItem } from '../lib/api'

type Tab = 'generate' | 'editor' | 'captions'

const TABS: { id: Tab; label: string; eyebrow: string; description: string; icon: LucideIcon }[] = [
  { id: 'editor', label: '1. Assemble', eyebrow: 'Your project', description: 'Import clips, arrange the story, add voice and music.', icon: Scissors },
  { id: 'captions', label: '2. Caption', eyebrow: 'Make it readable', description: 'Transcribe a clip, edit the cues, then send them to the timeline.', icon: Captions },
  { id: 'generate', label: '3. Generate', eyebrow: 'Create shots', description: 'Make a new talking-head or AI video shot and add it from the library.', icon: Wand2 },
]

const LAST_SEEN_KEY = 'video-editor-last-seen-at'

export function Video() {
  const [tab, setTab] = useState<Tab>('editor')
  const [library, setLibrary] = useState<VideoLibraryItem[]>([])
  const [pendingCaptions, setPendingCaptions] = useState<CaptionSegment[] | null>(null)
  const [lastSeenAt, setLastSeenAt] = useState<number>(() => {
    const stored = localStorage.getItem(LAST_SEEN_KEY)
    return stored ? Number(stored) : Date.now() / 1000
  })

  useEffect(() => {
    let cancelled = false
    function poll() { getVideoLibrary().then(items => { if (!cancelled) setLibrary(items) }).catch(() => {}) }
    poll()
    const id = setInterval(poll, 20000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  const newClipCount = library.filter(item => item.created_at > lastSeenAt).length
  const activeTab = TABS.find(item => item.id === tab)!
  const openTab = useCallback((next: Tab) => {
    setTab(next)
    if (next === 'editor') {
      const now = Date.now() / 1000
      setLastSeenAt(now)
      localStorage.setItem(LAST_SEEN_KEY, String(now))
    }
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--bg)' }}>

      <div style={{ padding: '18px 24px 0', background: 'linear-gradient(180deg, var(--surface), var(--bg))', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap', maxWidth: 1280, margin: '0 auto' }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'rgba(124,110,247,.18)', color: 'var(--accent)' }}><Clapperboard size={20} /></div>
            <div><div style={{ color: 'var(--accent2)', fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' }}>{activeTab.eyebrow}</div><div style={{ fontSize: 15, fontWeight: 700, marginTop: 3 }}>{activeTab.description}</div></div>
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 12, paddingTop: 6 }}>{library.length} clip{library.length === 1 ? '' : 's'} in your library</div>
        </div>
        <nav aria-label="Video workflow" style={{ display: 'flex', gap: 4, maxWidth: 1280, margin: '18px auto 0', overflowX: 'auto' }}>
          {TABS.map(item => {
            const Icon = item.icon
            const active = tab === item.id
            const badge = item.id === 'editor' ? newClipCount : 0
            return <button key={item.id} onClick={() => openTab(item.id)} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '11px 15px', border: 'none', borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent', background: active ? 'rgba(124,110,247,.08)' : 'transparent', color: active ? 'var(--text)' : 'var(--text-muted)', cursor: 'pointer', fontSize: 13, fontWeight: active ? 700 : 500, whiteSpace: 'nowrap' }}><Icon size={15} color={active ? 'var(--accent)' : undefined} />{item.label}{badge > 0 && <span title={`${badge} new clip${badge === 1 ? '' : 's'} ready`} style={{ minWidth: 17, height: 17, padding: '0 5px', display: 'inline-grid', placeItems: 'center', borderRadius: 10, background: 'var(--accent)', color: '#fff', fontSize: 10 }}>{badge}</span>}</button>
          })}
        </nav>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 20, maxWidth: 1320, width: '100%', margin: '0 auto' }}>
        <div style={{ display: tab === 'generate' ? 'block' : 'none', minHeight: '100%' }}><GeneratePanel onOpenEditor={() => openTab('editor')} /></div>
        <div style={{ display: tab === 'editor' ? 'flex' : 'none', flexDirection: 'column', minHeight: '100%' }}><TimelineEditor active={tab === 'editor'} pendingCaptions={pendingCaptions} onCaptionsImported={() => setPendingCaptions(null)} onOpenCaptions={() => openTab('captions')} onOpenGenerate={() => openTab('generate')} /></div>
        <div style={{ display: tab === 'captions' ? 'block' : 'none', minHeight: '100%' }}><CaptionsPanel onSendToEditor={segments => { setPendingCaptions(segments); openTab('editor') }} /></div>
      </div>
    </div>
  )
}
