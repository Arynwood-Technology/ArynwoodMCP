import { useEffect, useState } from 'react'
import { Mic, Scissors, Mic2, Sliders, Play, Square, RefreshCw, Loader2, Radio, Sparkles, Guitar } from 'lucide-react'
import { AudioRecorder } from '../components/studio/AudioRecorder'
import { StemSeparator } from '../components/studio/StemSeparator'
import { VoiceConversion } from '../components/studio/VoiceConversion'
import { EffectsRack } from '../components/studio/EffectsRack'
import { VocalBooth } from '../components/studio/VocalBooth'
import { InstrumentGenerator } from '../components/studio/InstrumentGenerator'
import { JamWithAI } from '../components/studio/JamWithAI'
import { request } from '../lib/api'

type Tab = 'booth' | 'record' | 'generate' | 'jam' | 'stems' | 'voice' | 'effects'

interface SidecarInfo {
  id: string; label: string; port: number; status: 'running' | 'starting' | 'stopped'
}

const TABS: { id: Tab; label: string; icon: React.FC<{ size?: number }> }[] = [
  { id: 'booth',    label: 'Vocal Booth',      icon: Radio },
  { id: 'record',   label: 'Record',           icon: Mic },
  { id: 'generate', label: 'Generate',         icon: Sparkles },
  { id: 'jam',      label: 'Jam with AI',      icon: Guitar },
  { id: 'stems',    label: 'Stem Separation',  icon: Scissors },
  { id: 'voice',    label: 'Voice Conversion', icon: Mic2 },
  { id: 'effects',  label: 'Effects Rack',     icon: Sliders },
]

const STATUS_COLOR: Record<string, string> = {
  running:  '#22c55e',
  starting: '#f59e0b',
  stopped:  '#6b7280',
}

export function Studio() {
  const [tab, setTab] = useState<Tab>('booth')
  const [sidecars, setSidecars] = useState<Record<string, SidecarInfo>>({})
  const [loadingSidecar, setLoadingSidecar] = useState<string | null>(null)
  const [sidecarError, setSidecarError] = useState<string | null>(null)
  const [pendingEffectsFile, setPendingEffectsFile] = useState<Blob | null>(null)
  const [pendingVoiceFile, setPendingVoiceFile] = useState<Blob | null>(null)

  async function fetchSidecars() {
    try {
      const data = await request<Record<string, SidecarInfo>>('/studio/sidecars')
      setSidecars(data)
    } catch { /* backend down */ }
  }

  useEffect(() => {
    fetchSidecars()
    const t = setInterval(fetchSidecars, 5000)
    return () => clearInterval(t)
  }, [])

  async function startSidecar(id: string) {
    setLoadingSidecar(id)
    setSidecarError(null)
    try {
      await request(`/studio/sidecars/${id}/start`, { method: 'POST' })
      await new Promise(r => setTimeout(r, 1500))
      await fetchSidecars()
    } catch (error) {
      setSidecarError(error instanceof Error ? error.message : 'Unable to start this service.')
    }
    setLoadingSidecar(null)
  }

  async function stopSidecar(id: string) {
    setLoadingSidecar(id)
    setSidecarError(null)
    try {
      await request(`/studio/sidecars/${id}/stop`, { method: 'POST' })
      await fetchSidecars()
    } catch (error) {
      setSidecarError(error instanceof Error ? error.message : 'Unable to stop this service.')
    }
    setLoadingSidecar(null)
  }

  const tabSidecarMap: Partial<Record<Tab, string>> = {
    generate: 'song-gen',
    jam:      'song-gen',
    stems:    'stem-sep',
    voice:    'voice',
    effects:  'audio-fx',
  }
  const activeSidecarId = tabSidecarMap[tab]
  const activeSidecar = activeSidecarId ? sidecars[activeSidecarId] : undefined

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg)' }}>

      {/* Sidecar status bar */}
      <div style={{ padding: '8px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginRight: 4 }}>Sidecars</span>
        {Object.values(sidecars).map(sc => (
          <div key={sc.id} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface2)', borderRadius: 6, padding: '4px 10px' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_COLOR[sc.status] ?? '#6b7280', display: 'inline-block', flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sc.label}</span>
            {loadingSidecar === sc.id ? (
              <Loader2 size={12} style={{ color: 'var(--text-muted)', animation: 'spin 1s linear infinite' }} />
            ) : sc.status === 'running' ? (
              <button onClick={() => stopSidecar(sc.id)} title="Stop" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, lineHeight: 1 }}>
                <Square size={10} />
              </button>
            ) : (
              <button onClick={() => startSidecar(sc.id)} title="Start" style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, lineHeight: 1 }}>
                <Play size={10} />
              </button>
            )}
          </div>
        ))}
        <button onClick={fetchSidecars} title="Refresh" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2, marginLeft: 'auto' }}>
          <RefreshCw size={13} />
        </button>
      </div>

      {/* Tab navigation */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--surface)', paddingLeft: 16 }}>
        {TABS.map(t => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px',
              background: 'none', border: 'none', borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
              color: active ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer', fontSize: 13, fontWeight: active ? 600 : 400,
            }}>
              <Icon size={14} />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Sidecar offline banner */}
      {activeSidecar && activeSidecar.status !== 'running' && (
        <div style={{ padding: '8px 20px', background: 'rgba(245,158,11,0.08)', borderBottom: '1px solid rgba(245,158,11,0.2)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--warning)' }}>
          <span>{activeSidecar.label} sidecar is {activeSidecar.status}.</span>
          <button onClick={() => startSidecar(activeSidecar.id)} style={{ padding: '3px 10px', border: '1px solid var(--warning)', borderRadius: 4, background: 'transparent', color: 'var(--warning)', cursor: 'pointer', fontSize: 11 }}>
            Start
          </button>
        </div>
      )}
      {sidecarError && (
        <div role="alert" style={{ padding: '8px 20px', background: 'rgba(239,68,68,0.09)', borderBottom: '1px solid rgba(239,68,68,0.24)', color: '#fca5a5', fontSize: 12 }}>
          Service action failed: {sidecarError}
        </div>
      )}

      {/* Panel content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 24, maxWidth: 860 }}>
        {tab === 'booth' && (
          <VocalBooth
            onSendToEffects={blob => { setPendingEffectsFile(blob); setTab('effects') }}
            onSendToVoice={blob => { setPendingVoiceFile(blob); setTab('voice') }}
            onOpenEffects={() => setTab('effects')}
            onOpenVoice={() => setTab('voice')}
          />
        )}
        {tab === 'record' && (
          <AudioRecorder onSendToEffects={blob => { setPendingEffectsFile(blob); setTab('effects') }} onSendToVoice={blob => { setPendingVoiceFile(blob); setTab('voice') }} />
        )}
        {tab === 'generate' && <InstrumentGenerator sidecarReady={activeSidecar?.status === 'running'} />}
        {tab === 'jam' && <JamWithAI sidecarReady={activeSidecar?.status === 'running'} />}
        {tab === 'stems' && <StemSeparator sidecarReady={activeSidecar?.status === 'running'} />}
        {tab === 'voice' && <VoiceConversion sidecarReady={activeSidecar?.status === 'running'} externalFile={pendingVoiceFile} onExternalFileConsumed={() => setPendingVoiceFile(null)} onSendToEffects={blob => { setPendingEffectsFile(blob); setTab('effects') }} />}
        {tab === 'effects' && (
          <EffectsRack
            sidecarReady={activeSidecar?.status === 'running'}
            externalFile={pendingEffectsFile}
            onExternalFileConsumed={() => setPendingEffectsFile(null)}
          />
        )}
      </div>
    </div>
  )
}
