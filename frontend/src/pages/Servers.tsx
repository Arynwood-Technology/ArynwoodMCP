import { useEffect, useState } from 'react'
import { Plus, Trash2, Wifi, WifiOff, KeyRound, MessageSquare, Image as ImageIcon } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import {
  getServers, createServer, updateServer, deleteServer, pingServer, getImageConfig, setImageConfig, serverAddress,
  type ImageConfig, type Server,
} from '../lib/api'
import { useChooseServer } from '../lib/useChooseServer'
import { Button, IconButton, PageShell, PageBar, PageBody, SectionCard } from '../components/ui'

const GUIDE_URL = 'https://github.com/Arynwood-Technology/ArynwoodMCP/blob/main/docs/endpoints.md'
const SERVER_TYPES = ['ollama', 'openai-compatible', 'custom']
const EMPTY_FORM = { name: '', host: '', port: 11434, type: 'ollama', auth_token: '', model: '' }

const inputClass = 'rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-text'

export function Servers() {
  const { servers, setServers, activeServer } = useAppStore()
  const chooseServer = useChooseServer()
  const [pings, setPings] = useState<Record<number, boolean>>({})
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [error, setError] = useState('')
  const [images, setImages] = useState<ImageConfig | null>(null)
  // Per-row draft of the model fields, so typing doesn't save on every keystroke.
  const [modelDraft, setModelDraft] = useState<Record<number, string>>({})
  const [imageDraft, setImageDraft] = useState<Record<number, string>>({})

  const load = async () => {
    const list = await getServers()
    setServers(list)
    getImageConfig().then(setImages).catch(() => setImages(null))
    const results = await Promise.allSettled(list.map(s => pingServer(s.id)))
    const map: Record<number, boolean> = {}
    list.forEach((s, i) => {
      const r = results[i]
      map[s.id] = r.status === 'fulfilled' ? r.value.online : false
    })
    setPings(map)
  }

  // Fetch-on-mount only — intentionally not re-run when load's own closed-over
  // state changes later.
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { load() }, [])

  const add = async () => {
    if (!form.name || !form.host) return
    setError('')
    try {
      await createServer({ ...form, port: Number(form.port), enabled: 1, model: form.model || null })
      setAdding(false)
      setForm(EMPTY_FORM)
      load()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }

  const del = async (id: number) => {
    if (!confirm('Delete this server?')) return
    await deleteServer(id)
    load()
  }

  const saveModel = async (s: Server) => {
    const model = (modelDraft[s.id] ?? s.model ?? '').trim()
    if (model === (s.model ?? '')) return
    const updated = await updateServer(s.id, { model })
    setServers(servers.map(x => (x.id === s.id ? updated : x)))
    if (activeServer?.id === s.id) chooseServer(updated)
  }

  const pickForImages = async (s: Server) => {
    setError('')
    try {
      setImages(await setImageConfig(s.id, (imageDraft[s.id] ?? '').trim()))
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }

  const imagesHere = (s: Server) => images?.source === 'endpoint' && images.server?.id === s.id

  return (
    <PageShell>
      <PageBar className="justify-between">
        <Button variant="outline" onClick={() => setAdding(!adding)}><Plus size={14} /> Add server</Button>
        <p className="m-0 text-[11px] text-muted">
          A server elsewhere can run chat and images that this computer can't.{' '}
          <a href={GUIDE_URL} target="_blank" rel="noopener noreferrer" className="text-accent no-underline">How to connect one</a>
        </p>
      </PageBar>
      <PageBody>
        {error && <p role="alert" className="m-0 mb-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}

        {adding && (
          <SectionCard title="New server" className="mb-4" bodyClassName="grid grid-cols-2 gap-3">
            <input aria-label="Name" placeholder="Name" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={`${inputClass} col-span-2`} />
            <input aria-label="Host or URL" placeholder="Host or URL (192.168.1.10, or https://api.example.com/v1)" value={form.host}
              onChange={e => setForm(f => ({ ...f, host: e.target.value }))} className={inputClass} />
            <input aria-label="Port" placeholder="Port" type="number" value={form.port}
              onChange={e => setForm(f => ({ ...f, port: Number(e.target.value) }))} className={inputClass} />
            <select aria-label="Type" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className={inputClass}>
              {SERVER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input aria-label="Auth token" placeholder="Auth token or API key (optional)" type="password" autoComplete="off"
              value={form.auth_token} onChange={e => setForm(f => ({ ...f, auth_token: e.target.value }))} className={inputClass} />
            <input aria-label="Chat model" placeholder="Chat model on this server (optional; blank = each persona's own)"
              value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} className={`${inputClass} col-span-2`} />
            <p className="col-span-2 m-0 text-[11px] text-muted">
              The token stays in Arynwood's backend; this page never shows it again. With a full URL the port is ignored.
            </p>
            <div className="col-span-2 flex gap-2">
              <Button variant="primary" onClick={add}>Save</Button>
              <Button variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
            </div>
          </SectionCard>
        )}

        <div className="grid gap-2.5">
          {servers.map(s => {
            const active = activeServer?.id === s.id
            const online = pings[s.id]
            return (
              <div key={s.id} className={`rounded-xl border bg-surface2 px-4 py-3 ${active ? 'border-accent' : 'border-border'} ${s.enabled ? '' : 'opacity-50'}`}>
                <div className="flex items-center gap-3.5">
                  <div className={`flex size-9 items-center justify-center rounded-lg ${online ? 'bg-success/15' : 'bg-danger/15'}`}>
                    {online ? <Wifi size={16} className="text-success" /> : <WifiOff size={16} className="text-danger" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-text">{s.name}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-muted">
                      {s.type} · {serverAddress(s)}
                      {s.has_token && <span className="inline-flex items-center gap-0.5" title="Has a token"><KeyRound size={11} /> token</span>}
                      {imagesHere(s) && <span className="inline-flex items-center gap-0.5 text-accent"><ImageIcon size={11} /> images: {images?.model}</span>}
                    </div>
                  </div>
                  <Button size="sm" variant={active ? 'primary' : 'outline'} disabled={active || !s.enabled}
                    onClick={() => chooseServer(s)} title="Chat uses this server, now and after a restart">
                    <MessageSquare size={12} /> {active ? 'Chat uses this' : 'Use for chat'}
                  </Button>
                  <IconButton label={`Delete server ${s.name}`} variant="danger" size="sm" onClick={() => del(s.id)}>
                    <Trash2 size={15} />
                  </IconButton>
                </div>

                {s.type !== 'ollama' && (
                  <div className="mt-3 grid grid-cols-1 gap-2 border-t border-border/60 pt-3 sm:grid-cols-2">
                    <label className="flex items-center gap-2 text-[11px] text-muted">
                      Chat model
                      <input aria-label={`Chat model on ${s.name}`} className={`${inputClass} flex-1 py-1 text-xs`}
                        value={modelDraft[s.id] ?? s.model ?? ''} placeholder="e.g. the provider's chat model"
                        onChange={e => setModelDraft(d => ({ ...d, [s.id]: e.target.value }))}
                        onBlur={() => saveModel(s)} />
                    </label>
                    {s.type === 'openai-compatible' && (
                      <div className="flex items-center gap-2 text-[11px] text-muted">
                        Image model
                        <input aria-label={`Image model on ${s.name}`} className={`${inputClass} flex-1 py-1 text-xs`}
                          value={imageDraft[s.id] ?? (imagesHere(s) ? images?.model ?? '' : '')}
                          placeholder="e.g. the provider's image model"
                          onChange={e => setImageDraft(d => ({ ...d, [s.id]: e.target.value }))} />
                        {imagesHere(s)
                          ? <Button size="sm" variant="ghost" onClick={async () => setImages(await setImageConfig(null))}>Stop</Button>
                          : <Button size="sm" variant="outline" onClick={() => pickForImages(s)}><ImageIcon size={12} /> Use for images</Button>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </PageBody>
    </PageShell>
  )
}
