import { EditorView } from '@codemirror/view'
import { HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'

// CodeMirror in the Grove's colours, shared by the file editor and the site editor.

/** The syntax for a file, from its name. */
export async function language(name: string) {
  if (/\.html?$/i.test(name)) return (await import('@codemirror/lang-html')).html()
  if (/\.css$/i.test(name)) return (await import('@codemirror/lang-css')).css()
  if (/\.[cm]?jsx?$/i.test(name)) return (await import('@codemirror/lang-javascript')).javascript({ jsx: /jsx$/i.test(name) })
  if (/\.tsx?$/i.test(name)) return (await import('@codemirror/lang-javascript')).javascript({ typescript: true, jsx: /tsx$/i.test(name) })
  if (/\.json$/i.test(name)) return (await import('@codemirror/lang-json')).json()
  if (/\.md$/i.test(name)) return (await import('@codemirror/lang-markdown')).markdown()
  return []
}
export const colours = HighlightStyle.define([
  { tag: [tags.keyword, tags.tagName, tags.heading], color: 'var(--accent-text)' },
  { tag: [tags.string, tags.attributeValue, tags.link], color: 'var(--text)' },
  { tag: [tags.comment, tags.meta], color: 'var(--text-muted)', fontStyle: 'italic' },
  { tag: [tags.number, tags.bool, tags.attributeName], color: 'var(--accent2)' },
])
export const theme = EditorView.theme({
  '&': { color: 'var(--text)', backgroundColor: 'var(--surface)', fontSize: '14px' },
  '.cm-content': { caretColor: 'var(--accent)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
  '.cm-gutters': { backgroundColor: 'var(--bg)', color: 'var(--text-muted)', borderColor: 'var(--border)' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--accent-soft)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--accent-soft)' },
  '.cm-panels, .cm-tooltip': { backgroundColor: 'var(--surface2)', color: 'var(--text)', borderColor: 'var(--border)' },
}, { dark: true })
