import { useEffect, useRef, useState } from 'react'
import { describeMicError } from '../../lib/mic'

import { makeLiveGraph, type ActiveEffect } from './liveAudioGraph'

export function LiveVoiceMonitor({ chain }: { chain: ActiveEffect[] }) {
  const [active, setActive] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)

  function stop() {
    streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null
    ctxRef.current?.close(); ctxRef.current = null
    setActive(false)
  }
  async function start() {
    stop(); setStarting(true); setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
      const ctx = new AudioContext(); await ctx.resume()
      const source = ctx.createMediaStreamSource(stream)
      const { tail } = makeLiveGraph(ctx, source, chain)
      tail.connect(ctx.destination)
      streamRef.current = stream; ctxRef.current = ctx; setActive(true)
    } catch (cause: unknown) { setError(describeMicError(cause)) }
    finally { setStarting(false) }
  }
  useEffect(() => () => stop(), [])
  useEffect(() => {
    // Rebuild the Web Audio graph whenever a slider changes so monitoring matches the chain.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (active) void start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain])
  const renderedOnly: string[] = []

  return <section style={{ padding: 14, borderRadius: 10, border: active ? '1px solid var(--accent2)' : '1px solid var(--border)', background: active ? 'rgba(94,234,212,.05)' : 'var(--surface)' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}><div style={{ flex: 1 }}><div style={{ fontSize: 11, color: 'var(--accent2)', fontWeight: 700, letterSpacing: '.06em' }}>LIVE MONITOR</div><strong style={{ display: 'block', marginTop: 3, fontSize: 13 }}>Talk through your current character effects</strong></div><button onClick={active ? stop : start} disabled={starting} style={{ padding: '8px 12px', border: 'none', borderRadius: 7, background: active ? 'var(--danger-solid)' : 'var(--accent-solid)', color: '#fff', cursor: starting ? 'wait' : 'pointer', fontWeight: 700, fontSize: 12 }}>{starting ? 'Connecting…' : active ? 'Stop monitor' : 'Start live monitor'}</button></div>
    <p style={{ margin: '8px 0 0', color: 'var(--text-muted)', fontSize: 11, lineHeight: 1.45 }}><strong style={{ color: 'var(--warning)' }}>Use headphones.</strong> Speaker monitoring can create feedback. Filters, EQ, compression, distortion, delay, chorus, reverb, bitcrush, resampling, gating, and pitch shifting update live. Live pitch uses a low-latency granular processor; use <strong>Apply Chain</strong> for the final high-quality Pedalboard WAV.</p>
    {renderedOnly.length > 0 && <p style={{ margin: '6px 0 0', color: 'var(--text-muted)', fontSize: 11 }}>Render-only in this monitor (true pitch/formant shifting needs the RVC render path): {renderedOnly.join(', ')}.</p>}
    {error && <p style={{ margin: '8px 0 0', color: 'var(--danger)', fontSize: 11 }}>{error}</p>}
  </section>
}
