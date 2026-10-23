import { api } from './community'
import type { FileItem } from './files'

export type Device = 'computer' | 'tablet' | 'phone'
/** Widths the preview shows a site at; a computer fills the pane. */
export const DEVICES: Record<Device, number | null> = { computer: null, tablet: 820, phone: 390 }
export interface NoteReply { id: string; note_id: string; author_id: string | null; author: string; body: string; created: string }
/** A note on a website's preview: a spot on a page, what should change there, and the replies to it. */
export interface SiteNote {
  id: string; space_id: string; folder: string; page: string; selector: string; quote: string; x: number | null; y: number | null
  device: '' | Device; body: string; suggestion: string | null; status: 'open' | 'done'; author_id: string | null; author: string
  created: string; closed_by: string; closed: string | null; replies: NoteReply[]
}
/** A website as its preview pane needs it. `changed` changes whenever its files do. */
export interface SiteReview { space_id: string; space_name: string; folder: string; name: string; pages: string[]; changed: string; notes: SiteNote[] }
export interface SiteFile extends FileItem { draft: { version: number; updated: string } | null }
/** A spot someone pointed at in a preview: its page, a path to the element, and the words it held. */
export interface Spot { page: string; selector: string; quote: string; tag: string; x: number; y: number }
/** A note's pin, as the page draws it. */
export interface Pin { id: string; n: number; selector: string; quote: string; x: number | null; y: number | null; done: boolean; label: string }
/** Which website a page of the Webmaster tools is showing, and how. */
export interface SiteTarget { space: string; folder: string; mode: 'edit' | 'review' }
/** /community/website?site=…&folder=…&mode=edit opens a site in the editor; mode=review, its preview and notes. */
export function siteTarget(search: string): SiteTarget | null {
  const q = new URLSearchParams(search), space = q.get('site'), folder = q.get('folder')
  return space && folder ? { space, folder, mode: q.get('mode') === 'edit' ? 'edit' : 'review' } : null
}
export const siteSearch = (target: SiteTarget | null) => target ? '?' + new URLSearchParams({ site: target.space, folder: target.folder, mode: target.mode }) : ''

const query = (spaceId: string, folder: string) => new URLSearchParams({ space_id: spaceId, folder })
const file = (spaceId: string, id: string) => `/community/spaces/${spaceId}/files/${id}`
export const siteApi = {
  review: (spaceId: string, folder: string) => api<SiteReview>('/webmaster/review?' + query(spaceId, folder)),
  files: (spaceId: string, folder: string) => api<{ folder: string; items: SiteFile[] }>('/webmaster/files?' + query(spaceId, folder)),
  preview: (spaceId: string, folder: string, drafts = false) => api<{ url: string }>('/webmaster/previews', 'POST', { space_id: spaceId, folder, bridge: true, drafts }),
  addNote: (note: { space_id: string; folder: string; page: string; selector: string; quote: string; x: number | null; y: number | null; device: Device; body: string; suggestion: string | null }) =>
    api<SiteNote>('/webmaster/notes', 'POST', note),
  reply: (id: string, body: string) => api<NoteReply>(`/webmaster/notes/${id}/replies`, 'POST', { body }),
  setStatus: (id: string, status: 'open' | 'done') => api<SiteNote>(`/webmaster/notes/${id}`, 'PUT', { status }),
  deleteNote: (id: string) => api(`/webmaster/notes/${id}`, 'DELETE'),
  draft: (spaceId: string, id: string) => api<{ text: string; version: number; updated: string }>(`${file(spaceId, id)}/draft`),
  keepDraft: (spaceId: string, id: string, text: string, version: number) => api(`${file(spaceId, id)}/draft`, 'PUT', { text, version }),
  dropDraft: (spaceId: string, id: string) => api(`${file(spaceId, id)}/draft`, 'DELETE'),
}

/** The address a page file has in a preview and on the live site: about.html is /about, docs/index.html is /docs/. */
export const pageAddress = (path: string) => '/' + path.replace(/(^|\/)index\.html?$/i, '$1').replace(/\.html?$/i, '')
/** One address for a page however it was reached: /about, /about.html and /about/ are the same. */
export function pageKey(address: string) {
  let path = address.split(/[?#]/)[0]
  try { path = decodeURIComponent(path) } catch { /* kept as it is */ }
  return ('/' + path.replace(/^\/+/, '')).replace(/(^|\/)index\.html?$/i, '$1').replace(/\.html?$/i, '').replace(/(.)\/$/, '$1')
}
export const samePage = (a: string, b: string) => pageKey(a) === pageKey(b)

/** The file in a site that an address shows, as the preview finds it, from the site's file paths. */
export function pageFile(address: string, paths: Iterable<string>) {
  const known = new Set(paths)
  let path = address.split(/[?#]/)[0]
  try { path = decodeURIComponent(path) } catch { /* kept as it is */ }
  path = path.replace(/^\/+/, '')
  const candidates = !path || path.endsWith('/') ? [path + 'index.html'] : /\.[a-z0-9]+$/i.test(path) ? [path, path + '/index.html'] : [path + '.html', path + '/index.html']
  return candidates.find(c => known.has(c)) ?? null
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Where words seen on a page are in its source, when they can be found: across tags, line breaks
 *  and entities. `plain` says no tag sits inside them, so they can be changed as they are. */
export function findQuote(source: string, quote: string) {
  const words = quote.trim().split(/\s+/).filter(Boolean).slice(0, 80)
  if (!words.length) return null
  const letter = (ch: string) => /[A-Za-z0-9]/.test(ch) ? ch : `(?:${escaped(ch)}|&#?[A-Za-z0-9]+;)`
  // A tag may sit inside a word, as in <strong>1</strong>st, and anywhere between words.
  const body = words.map(word => Array.from(word).map(letter).join('(?:<[^>]*>)*')).join('(?:\\s|&nbsp;|<[^>]*>)+')
  for (const flags of ['g', 'gi']) {
    const matches = Array.from(source.matchAll(new RegExp(body, flags))).slice(0, 50)
    if (matches.length) {
      const [first] = matches
      return { from: first.index, to: first.index + first[0].length, count: matches.length, plain: !first[0].includes('<') }
    }
  }
  return null
}
/** Text to put in a page's HTML in place of other text. */
export const asHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const label = (note: SiteNote) => (note.body || note.suggestion || '').replace(/\s+/g, ' ').slice(0, 120)
/** Notes on the page being shown, as pins: open ones, and whichever is selected. Numbers count every note. */
export const pinsFor = (notes: SiteNote[], here: string, selected: string): Pin[] => notes.map((note, i) => ({ note, n: i + 1 }))
  .filter(({ note }) => note.selector && samePage(note.page, here) && (note.status === 'open' || note.id === selected))
  .map(({ note, n }) => ({ id: note.id, n, selector: note.selector, quote: note.quote, x: note.x, y: note.y, done: note.status === 'done', label: label(note) }))
