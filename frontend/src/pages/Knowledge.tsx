import { useEffect, useState } from 'react'
import { Trash2, Link as LinkIcon, FileText, Type, Search, CheckCircle2, XCircle } from 'lucide-react'
import {
  getKnowledgeStatus, getKnowledgeSources, deleteKnowledgeSource,
  searchKnowledge, learnUrl, learnText, learnFile, uploadKnowledgeFile,
  type KnowledgeSource, type KnowledgeStatus, type KnowledgeSearchResult,
} from '../lib/api'
import { useKnowledgeJobPoll } from './useKnowledgeJobPoll'

type Mode = 'url' | 'file' | 'text'

const inputStyle: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)',
  borderRadius: 6, padding: '7px 12px', fontSize: 13,
}

export function Knowledge() {
  const [status, setStatus] = useState<KnowledgeStatus | null>(null)
  const [sources, setSources] = useState<KnowledgeSource[]>([])
  const [loading, setLoading] = useState(false)

  const [mode, setMode] = useState<Mode>('url')
  const [url, setUrl] = useState('')
  const [textTitle, setTextTitle] = useState('')
  const [textBody, setTextBody] = useState('')
  const [pdfIsScanned, setPdfIsScanned] = useState(false)
  const [busy, setBusy] = useState(false)
  const [resultMsg, setResultMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<KnowledgeSearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)

  // PDF parsing runs as a poll-tracked background job (see useKnowledgeJobPoll) so it
  // survives navigating away from this page mid-parse — the interval lives outside
  // React, this hook just reads/writes the persisted job state.
  const { job: pdfJob, start: startPdfJob } = useKnowledgeJobPoll()
  const pdfBusy = pdfJob.status === 'queued' || pdfJob.status === 'running' || pdfJob.status === 'saving'
  const [, forceTick] = useState(0)

  const load = async () => {
    setLoading(true)
    try {
      const [st, src] = await Promise.all([getKnowledgeStatus(), getKnowledgeSources()])
      setStatus(st)
      setSources(src)
    } catch { /* backend not up yet */ }
    setLoading(false)
  }

  // Fetch-on-mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [])

  // Re-fetch the source list once this specific job lands, not on every render while
  // it stays 'saved' — keyed on jobId so a later job's completion re-triggers it too.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (pdfJob.status === 'saved') load()
  }, [pdfJob.status, pdfJob.jobId])

  // Ticks the elapsed-time readout while a parse is in flight; Sycamore doesn't expose
  // real page-level progress (see docs/sycamore-integration-plan.md Phase 4), so an
  // honest "Ns elapsed" beats a fake percentage.
  useEffect(() => {
    if (!pdfBusy) return
    const id = setInterval(() => forceTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [pdfBusy])

  const submit = async () => {
    setBusy(true)
    setResultMsg('')
    setErrorMsg('')
    try {
      let result: { id: number; title: string; chunks: number }
      if (mode === 'url') {
        if (!url.trim()) throw new Error('Enter a URL')
        result = await learnUrl(url.trim())
        setUrl('')
      } else if (mode === 'text') {
        if (!textBody.trim()) throw new Error('Paste some text')
        result = await learnText(textTitle.trim() || 'Untitled note', textBody.trim(), textTitle.trim() || undefined)
        setTextTitle('')
        setTextBody('')
      } else {
        throw new Error('Choose a file first')
      }
      setResultMsg(`Learned "${result.title}" — ${result.chunks} chunk(s) saved.`)
      load()
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Failed to learn')
    }
    setBusy(false)
  }

  // Non-PDF files only — plain text/code/.docx go straight through the fast path.
  // PDFs are routed to startPdfJob() by the file input's onChange below, since that
  // flow needs to survive navigation (see useKnowledgeJobPoll).
  const submitFile = async (file: File) => {
    setBusy(true)
    setResultMsg('')
    setErrorMsg('')
    try {
      const uploaded = await uploadKnowledgeFile(file)
      const result = await learnFile(uploaded.filename, uploaded.text)
      setResultMsg(`Learned "${result.title}" — ${result.chunks} chunk(s) saved.`)
      load()
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Failed to learn file')
    }
    setBusy(false)
  }

  const chooseFile = (file: File) => {
    if (file.name.toLowerCase().endsWith('.pdf')) {
      startPdfJob(file, pdfIsScanned)
    } else {
      submitFile(file)
    }
  }

  const del = async (id: number) => {
    if (!confirm('Forget this source?')) return
    await deleteKnowledgeSource(id)
    load()
  }

  const runSearch = async () => {
    if (!query.trim()) return
    setSearching(true)
    try {
      const res = await searchKnowledge(query.trim())
      setSearchResults(res.results)
    } catch {
      setSearchResults([])
    }
    setSearching(false)
  }

  const MODES: { key: Mode; label: string; icon: React.FC<{ size?: number }> }[] = [
    { key: 'url', label: 'URL', icon: LinkIcon },
    { key: 'file', label: 'File', icon: FileText },
    { key: 'text', label: 'Text', icon: Type },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>

        {/* Status */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <StatusPill
            ok={!!status?.qdrant.online}
            label={status?.qdrant.online ? 'Qdrant online' : 'Qdrant offline'}
          />
          <StatusPill
            ok={!!status?.qdrant.collection_ready}
            label={status?.qdrant.collection_ready ? 'Collection ready' : 'Collection not yet created'}
          />
          <StatusPill
            ok={!!status?.embedding_model_available}
            label={status ? `${status.embedding_model} ${status.embedding_model_available ? 'available' : 'missing'}` : 'embedding model'}
          />
        </div>

        {/* Teach Arynwood */}
        <div style={{
          background: 'var(--surface2)', border: '1px solid var(--border)',
          borderRadius: 12, padding: '16px 20px', marginBottom: 20,
        }}>
          <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: 14, marginBottom: 12 }}>
            Teach Arynwood something new
          </div>

          {/* Mode tabs */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {MODES.map(m => (
              <button key={m.key} onClick={() => { setMode(m.key); setResultMsg(''); setErrorMsg('') }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: mode === m.key ? 'rgba(124,110,247,0.15)' : 'var(--surface)',
                  border: `1px solid ${mode === m.key ? 'var(--accent)' : 'var(--border)'}`,
                  color: mode === m.key ? 'var(--accent)' : 'var(--text-muted)',
                  borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12,
                }}>
                <m.icon size={13} /> {m.label}
              </button>
            ))}
          </div>

          {mode === 'url' && (
            <div style={{ display: 'flex', gap: 8 }}>
              <input placeholder="https://example.com/article" value={url}
                onChange={e => setUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submit()}
                style={{ ...inputStyle, flex: 1 }} />
              <button onClick={submit} disabled={busy}
                style={{ background: 'var(--accent)', border: 'none', color: '#fff', borderRadius: 6, padding: '7px 20px', cursor: busy ? 'default' : 'pointer', fontSize: 13, opacity: busy ? 0.6 : 1 }}>
                {busy ? 'Learning…' : 'Learn'}
              </button>
            </div>
          )}

          {mode === 'file' && (
            <div>
              <input type="file" disabled={busy || pdfBusy}
                onChange={e => { const f = e.target.files?.[0]; if (f) chooseFile(f) }}
                style={{ ...inputStyle, width: '100%' }} />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                Text, code, PDF, or .docx — up to 50 MB. PDFs get a deep parse
                (layout + tables) via Sycamore — allow extra time on long documents.
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)', marginTop: 8, cursor: pdfBusy ? 'default' : 'pointer' }}>
                <input type="checkbox" checked={pdfIsScanned} disabled={pdfBusy}
                  onChange={e => setPdfIsScanned(e.target.checked)} />
                This PDF is a scan (enable OCR — slower, only helps on image-only pages)
              </label>
              {pdfJob.status !== 'idle' && (
                <div style={{
                  marginTop: 10, fontSize: 12,
                  color: pdfJob.status === 'error' ? 'var(--danger)' : pdfJob.status === 'saved' ? 'var(--success)' : 'var(--text-muted)',
                }}>
                  {pdfJob.status === 'queued' && `Queued: ${pdfJob.filename}…`}
                  {pdfJob.status === 'running' && (
                    <>Parsing "{pdfJob.filename}" (layout{pdfIsScanned ? ', OCR' : ''}, tables) — {
                      // Deliberately reads the wall clock each render; the forceTick interval
                      // above exists specifically to re-render this every second so the
                      // elapsed count is live.
                      // eslint-disable-next-line react-hooks/purity
                      pdfJob.startedAt ? Math.round((Date.now() - pdfJob.startedAt) / 1000) : 0
                    }s elapsed…</>
                  )}
                  {pdfJob.status === 'saving' && 'Parsed — saving to knowledge base…'}
                  {pdfJob.status === 'saved' && `Learned "${pdfJob.savedTitle}" — ${pdfJob.savedChunks} chunk(s) saved.`}
                  {pdfJob.status === 'error' && (pdfJob.error || 'PDF parsing failed.')}
                </div>
              )}
            </div>
          )}

          {mode === 'text' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input placeholder="Title (optional)" value={textTitle}
                onChange={e => setTextTitle(e.target.value)} style={inputStyle} />
              <textarea placeholder="Paste text to teach Arynwood…" value={textBody}
                onChange={e => setTextBody(e.target.value)}
                rows={6} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
              <button onClick={submit} disabled={busy}
                style={{ alignSelf: 'flex-start', background: 'var(--accent)', border: 'none', color: '#fff', borderRadius: 6, padding: '7px 20px', cursor: busy ? 'default' : 'pointer', fontSize: 13, opacity: busy ? 0.6 : 1 }}>
                {busy ? 'Learning…' : 'Learn'}
              </button>
            </div>
          )}

          {resultMsg && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--success)' }}>{resultMsg}</div>}
          {errorMsg && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--danger)' }}>{errorMsg}</div>}
        </div>

        {/* Search what Arynwood knows */}
        <div style={{
          background: 'var(--surface2)', border: '1px solid var(--border)',
          borderRadius: 12, padding: '16px 20px', marginBottom: 20,
        }}>
          <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: 14, marginBottom: 12 }}>
            Search what Arynwood has learned
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: searchResults ? 12 : 0 }}>
            <input placeholder="Ask a question to test retrieval…" value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && runSearch()}
              style={{ ...inputStyle, flex: 1 }} />
            <button onClick={runSearch} disabled={searching}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '7px 16px', cursor: searching ? 'default' : 'pointer', fontSize: 13 }}>
              <Search size={14} /> {searching ? 'Searching…' : 'Search'}
            </button>
          </div>
          {searchResults && (
            searchResults.length === 0
              ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No relevant results.</div>
              : <div style={{ display: 'grid', gap: 8 }}>
                  {searchResults.map((r, i) => (
                    <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
                        {r.title} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>· score {r.score.toFixed(2)}</span>
                        {r.page_start != null && (
                          <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                            {' '}· p.{r.page_start}{r.page_end && r.page_end !== r.page_start ? `-${r.page_end}` : ''}
                          </span>
                        )}
                        {r.has_table && (
                          <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · table</span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                        {r.text.slice(0, 300)}{r.text.length > 300 ? '…' : ''}
                      </div>
                    </div>
                  ))}
                </div>
          )}
        </div>

        {/* Learned sources — superseded versions (re-learned since) are hidden here;
            their content is no longer searchable, only the current version is. */}
        <div>
          <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: 14, marginBottom: 12 }}>
            Learned sources {sources.length > 0 && `(${sources.filter(s => !s.superseded_by).length})`}
          </div>
          {loading
            ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading…</div>
            : sources.filter(s => !s.superseded_by).length === 0
              ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nothing learned yet — add a URL, file, or note above.</div>
              : <div style={{ display: 'grid', gap: 8 }}>
                  {sources.filter(s => !s.superseded_by).map(s => (
                    <div key={s.id} style={{
                      background: 'var(--surface2)', border: '1px solid var(--border)',
                      borderRadius: 10, padding: '10px 14px',
                      display: 'flex', alignItems: 'center', gap: 12,
                    }}>
                      <div style={{
                        fontSize: 10, textTransform: 'uppercase', fontWeight: 700, color: 'var(--text-muted)',
                        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4,
                        padding: '2px 6px', flexShrink: 0,
                      }}>{s.source_type}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {s.title}
                          {s.version > 1 && (
                            <span style={{
                              marginLeft: 6, fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
                              border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px',
                            }} title={`Re-learned ${s.version - 1} time(s); earlier versions are kept for history but no longer searchable`}>
                              v{s.version}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {s.source} · {s.chunk_count} chunk{s.chunk_count === 1 ? '' : 's'}
                          {s.added_by ? ` · ${s.added_by}` : ''}
                        </div>
                      </div>
                      <button onClick={() => del(s.id)}
                        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, flexShrink: 0 }}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
          }
        </div>

      </div>
    </div>
  )
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      background: ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
      border: `1px solid ${ok ? 'var(--success)' : 'var(--danger)'}`,
      color: ok ? 'var(--success)' : 'var(--danger)',
      borderRadius: 999, padding: '4px 12px', fontSize: 12,
    }}>
      {ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
      {label}
    </div>
  )
}
