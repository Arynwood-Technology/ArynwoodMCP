import { groveUrl } from './grove'

// A Grove-wide role, apart from each space's owners and members. The host is always an owner.
export type GroveRole = 'owner' | 'manager' | 'member'
/** Public chat: the Grove's IRC room, open to every member. `nick` is a pattern whose # marks become random digits. */
/** `private`: hidden on the IRC network and locked with a key only this Grove knows. */
export interface PublicChat { channel: string; nick: string; server: string; private?: boolean }
/** `webmaster`: an owner, or someone an owner chose to look after the website. */
export interface User { id: string; name: string; email: string; admin: number; role: GroveRole; can_start_spaces: boolean; host_tools?: boolean; public_chat?: PublicChat | null; log_name?: string; webmaster?: boolean }
export interface Space { id: string; name: string; topic?: string; role: 'owner' | 'member' }
export interface Member { id: string; name: string; role: 'owner' | 'member' }
export type Kind = 'board' | 'note' | 'task' | 'event' | 'chat' | 'list' | 'item' | 'comment'
export interface Entry {
  id: string; space_id: string; author_id: string; author: string; kind: Kind
  title: string; body: string; visibility: 'shared' | 'private'; parent_id: string | null
  done: boolean | number; due: string; assigned_to: string | null; created: string; updated: string; version: number
}
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(groveUrl(path), { method, headers: { 'Content-Type': 'application/json', 'X-Community-Request': '1' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth')) window.dispatchEvent(new Event('session-expired'))
    // An older Grove has no such action (renaming or deleting a space came later).
    if (response.status === 405) throw new Error('This Grove is an older version that cannot do this yet. Update the Grove to use it.')
    throw new Error(typeof data.detail === 'string' ? data.detail : 'Check your entries and try again.')
  }
  if (data.error || data.ok === false) throw new Error(data.error || 'Request failed.')
  return data as T
}
export function stamp(value: string) { return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }
