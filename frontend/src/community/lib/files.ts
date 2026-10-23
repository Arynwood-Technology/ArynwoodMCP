import { api } from './community'
import { groveUrl } from './grove'

export interface FileItem {
  id: string; folder: string; name: string; kind: 'file' | 'folder'; size: number; version: number
  created: string; updated: string; deleted: string | null; author_id: string | null; author: string; updated_by: string
}
export interface Listing { folder: string; items: FileItem[]; used: number; limit: number; file_limit: number }
export interface Version { version: number; size: number; created: string; author: string }

export function bytes(n: number) {
  if (n < 1024) return `${n} B`
  const [value, unit] = n < 1024 ** 2 ? [n / 1024, 'KB'] : n < 1024 ** 3 ? [n / 1024 ** 2, 'MB'] : [n / 1024 ** 3, 'GB']
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${unit}`
}
export const joined = (folder: string, name: string) => folder ? `${folder}/${name}` : name
/** Whether a path is in a space's Website folder, which only the Grove's owners and webmasters change. */
export const inWebsite = (path: string) => path === 'Website' || path.startsWith('Website/')
export const contentUrl = (spaceId: string, id: string, query = '') => groveUrl(`/community/spaces/${spaceId}/files/${id}/content${query}`)
export const zipUrl = (spaceId: string, id: string) => groveUrl(`/community/spaces/${spaceId}/files/${id}/zip`)
const images = /\.(png|jpe?g|gif|webp)$/i, texts = /\.(txt|md|csv|tsv|json|html?|css|m?js|tsx?|jsx|svg|xml|ya?ml|toml|ini|srt|vtt)$/i
export const isImage = (name: string) => images.test(name)
export const isText = (name: string) => texts.test(name)

/** "Poster.png" → "Poster (2).png", the first name not already in `taken`. */
export function freeName(name: string, taken: Set<string>) {
  const dot = name.lastIndexOf('.'), stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : ''
  for (let n = 2; ; n++) if (!taken.has(`${stem} (${n})${ext}`)) return `${stem} (${n})${ext}`
}

// Under nginx's 1 MB default, for servers whose proxy refuses the larger pieces the Grove asks for.
const SMALL_PIECE = 768 * 1024

async function reason(response: Response) {
  const data = await response.json().catch(() => ({}))
  return typeof data.detail === 'string' ? data.detail : 'The upload failed.'
}

/** Sends a file in pieces. A dropped connection picks up where the server got to. */
export async function uploadFile(spaceId: string, file: File, options: { folder?: string; name?: string; replaces?: string; onProgress?: (sent: number) => void } = {}) {
  return sendInPieces<FileItem>(`/community/spaces/${spaceId}/uploads`, { folder: options.folder ?? '', name: options.name ?? file.name, size: file.size, replaces: options.replaces ?? null }, file, options.onProgress)
}

/** Starts an upload at `root` with `start`, sends the file there in pieces, and finishes it. Files
 *  and Messages both take uploads this way. */
export async function sendInPieces<T>(root: string, start: object, file: Blob, onProgress?: (sent: number) => void) {
  const started = await api<{ id: string; chunk: number }>(root, 'POST', start)
  let piece = started.chunk, offset = 0, failures = 0
  while (offset < file.size) {
    const part = file.slice(offset, offset + piece)
    const response = await fetch(groveUrl(`${root}/${started.id}?offset=${offset}`), { method: 'PUT', body: part,
      headers: { 'X-Community-Request': '1', 'Content-Type': 'application/octet-stream' } }).catch(() => null)
    if (response?.ok) { offset += part.size; failures = 0; onProgress?.(offset); continue }
    if (response?.status === 413 && piece > SMALL_PIECE) { piece = SMALL_PIECE; continue }
    if (response && response.status !== 409 && response.status < 500) throw new Error(await reason(response))
    if (++failures > 5) throw new Error('The connection keeps dropping. Try again in a moment.')
    await new Promise(resolve => setTimeout(resolve, 500 * failures))
    offset = (await api<{ received: number }>(`${root}/${started.id}`)).received
  }
  return api<T>(`${root}/${started.id}/finish`, 'POST')
}

export const saveText = (spaceId: string, id: string, text: string, version: number) => api<FileItem>(`/community/spaces/${spaceId}/files/${id}/text`, 'PUT', { text, version })
export const previewFolder = (spaceId: string, folder: string) => api<{ url: string }>(`/community/spaces/${spaceId}/previews`, 'POST', { folder })
/** The top folder of the website a folder belongs to: Website/<site>, or the folder itself. */
export const siteRoot = (folder: string) => /^Website\/[^/]+/.exec(folder)?.[0] ?? folder

// A site's own addresses, such as /styles.css, start at its top folder. In a preview they point
// under the preview's address; /community and /api stay the Grove's. The server does the same.
const ROOTED = String.raw`(?=/(?!/|(?:community|api)(?![^/?#"'\s)>])))`
const TAG = /<[a-zA-Z](?:[^>"']|"[^"]*"|'[^']*')*>/g
const STYLE = /(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi
const ATTRIBUTE = new RegExp(String.raw`(\s(?:href|src|poster|action|formaction|data|background)\s*=\s*["']?)` + ROOTED, 'gi')
const SRCSET = /(\s(?:srcset|imagesrcset)\s*=\s*(["']))([\s\S]*?)(\2)/gi
const CANDIDATE = new RegExp(String.raw`((?:^|,)\s*)` + ROOTED, 'g')
const CSS = new RegExp(String.raw`((?:url\(\s*|@import\s+)["']?)` + ROOTED, 'gi')
export function rebased(html: string, base: string) {
  const css = (value: string) => value.replace(CSS, (_, start: string) => start + base)
  const tag = (value: string) => css(value.replace(ATTRIBUTE, (_, start: string) => start + base)
    .replace(SRCSET, (_, start: string, _quote: string, list: string, end: string) => start + list.replace(CANDIDATE, (_match: string, lead: string) => lead + base) + end))
  return html.replace(TAG, tag).replace(STYLE, (_, open: string, body: string, close: string) => open + css(body) + close)
}
export async function readText(spaceId: string, item: Pick<FileItem, 'id' | 'version'>) {
  const response = await fetch(contentUrl(spaceId, item.id, `?inline=1&version=${item.version}`))
  if (!response.ok) throw new Error('The file could not be opened. Try again.')
  return response.text()
}
