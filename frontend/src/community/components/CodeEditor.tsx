import { useEffect, useRef, useState } from 'react'
import { basicSetup } from 'codemirror'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { syntaxHighlighting } from '@codemirror/language'
import { openSearchPanel } from '@codemirror/search'
import { api } from '../lib/community'
import { previewUrl } from '../lib/grove'
import { colours, language, theme } from '../lib/codemirror'
import { previewFolder, readText, rebased, saveText, siteRoot, type FileItem, type Version } from '../lib/files'
import { Modal } from '../pages/Workspace'
import './code-editor.css'

/** `url` previews the site's top folder; the page sits `inside` it. */
function documentFor(draft: string, url: string, inside: string) {
  const root = new URL(previewUrl(url), window.location.origin).href
  const base = root + (inside ? inside.split('/').map(encodeURIComponent).join('/') + '/' : '')
  const policy = `default-src 'none'; style-src ${root} 'unsafe-inline'; img-src ${root} data:; font-src ${root}; media-src ${root}; base-uri ${root}; form-action 'none'`
  // Policy and base come first: draft markup cannot replace them or fetch Grove APIs.
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"><base href="${base}"></head><body>${rebased(draft, root.replace(/\/$/, ''))}</body></html>`
}

export function CodeEditor({ spaceId, item, text, onClose, onSaved }: { spaceId: string; item: FileItem; text: string; onClose: () => void; onSaved: (item: FileItem, text: string) => void }) {
  const [initial] = useState({ text, name: item.name })
  const [draft, setDraft] = useState(text), [saved, setSaved] = useState(text), [version, setVersion] = useState(item.version)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const [preview, setPreview] = useState(false), [url, setUrl] = useState(''), [srcdoc, setSrcdoc] = useState(''), [previewError, setPreviewError] = useState('')
  const host = useRef<HTMLDivElement>(null), view = useRef<EditorView | null>(null), saving = useRef(false)
  const actions = useRef({ save: () => {} })
  const dirty = draft !== saved, page = /\.html?$/i.test(item.name)
  function close() { if (!saving.current && (!dirty || window.confirm('Discard your unsaved changes?'))) onClose() }
  async function save() {
    if (saving.current || !dirty) return
    saving.current = true; setBusy(true); setError(''); setMessage('')
    const snapshot = view.current?.state.doc.toString() ?? draft
    try {
      const result = await saveText(spaceId, item.id, snapshot, version)
      setSaved(snapshot); setVersion(result.version); onSaved(result, snapshot); setMessage(`Saved version ${result.version}.`)
    } catch (e) { setError((e as Error).message) }
    finally { saving.current = false; setBusy(false) }
  }
  useEffect(() => { actions.current = { save: () => { void save() } } })
  useEffect(() => {
    if (!host.current) return
    const syntax = new Compartment()
    const editor = new EditorView({ parent: host.current, state: EditorState.create({ doc: initial.text, extensions: [
      keymap.of([{ key: 'Mod-s', run: () => { actions.current.save(); return true } }]), basicSetup, theme,
      syntaxHighlighting(colours), syntax.of([]), EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': 'File contents' }),
      EditorView.updateListener.of(update => { if (update.docChanged) { setDraft(update.state.doc.toString()); setMessage('') } }),
    ] }) })
    view.current = editor; editor.focus()
    let active = true
    void language(initial.name).then(extension => { if (active) editor.dispatch({ effects: syntax.reconfigure(extension) }) }).catch(() => {})
    return () => { active = false; editor.destroy(); view.current = null }
  }, [initial])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  useEffect(() => {
    if (!preview || !page) return
    let active = true
    const renew = () => { void previewFolder(spaceId, siteRoot(item.folder)).then(value => { if (active) { setUrl(value.url); setPreviewError('') } }).catch(e => { if (active) setPreviewError(e.message) }) }
    renew()
    const timer = setInterval(renew, 14 * 60 * 1000)
    return () => { active = false; clearInterval(timer) }
  }, [preview, page, spaceId, item.folder])
  useEffect(() => {
    if (!preview || !url) return
    const timer = setTimeout(() => setSrcdoc(documentFor(draft, url, item.folder.slice(siteRoot(item.folder).length + 1))), 300)
    return () => clearTimeout(timer)
  }, [draft, url, preview, item.folder])
  async function reload() {
    if (saving.current || (dirty && !window.confirm('Discard your unsaved changes and reload?'))) return
    saving.current = true; setBusy(true); setError(''); setMessage('')
    try {
      const versions = await api<Version[]>(`/community/spaces/${spaceId}/files/${item.id}/versions`)
      const latest = { ...item, version: versions[0].version, size: versions[0].size }
      if (latest.size > 2 * 1024 * 1024) throw new Error('The editor opens files up to 2 MB.')
      const contents = await readText(spaceId, latest)
      view.current?.dispatch({ changes: { from: 0, to: view.current.state.doc.length, insert: contents } })
      setDraft(contents); setSaved(contents); setVersion(latest.version); onSaved(latest, contents); setMessage('Opened the saved version.')
    } catch (e) { setError((e as Error).message) }
    finally { saving.current = false; setBusy(false) }
  }
  return <Modal title={`Edit ${item.name}`} onClose={close}>
    <div className="code-editor">
      <div className="editor-toolbar">
        <button className="primary" disabled={busy || !dirty} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="secondary" onClick={() => { if (view.current) openSearchPanel(view.current) }}>Search</button>
        {page && <button className="secondary" aria-pressed={preview} onClick={() => setPreview(value => !value)}>{preview ? 'Hide preview' : 'Preview'}</button>}
        <button className="secondary" disabled={busy} onClick={() => void reload()}>Reload saved file</button>
        <button className="secondary" disabled={busy} onClick={close}>Back</button>
        <span className="muted-text">{dirty ? 'Unsaved changes' : `Version ${version}`} · Ctrl/Cmd-S to save</span>
      </div>
      {error && <p className="error" role="alert">{error}</p>}{message && <p className="notice" role="status">{message}</p>}
      <div className={'editor-panes' + (preview ? ' with-preview' : '')}>
        <div className="editor-source" ref={host} />
        {preview && <section className="editor-preview" aria-label="Page preview"><h3>Preview</h3><p className="muted-text">Your draft with saved styles and images. Scripts stay off.</p>
          {previewError ? <p className="error" role="alert">{previewError}</p> : srcdoc ? <iframe title={`Preview of ${item.name}`} sandbox="" referrerPolicy="no-referrer" srcDoc={srcdoc} /> : <p>Opening preview…</p>}
        </section>}
      </div>
    </div>
  </Modal>
}
