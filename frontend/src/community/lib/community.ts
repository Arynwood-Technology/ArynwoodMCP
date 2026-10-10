import { groveUrl } from './grove'

export interface User { id: string; name: string; email: string; admin: number }
export interface Space { id: string; name: string; role: 'owner' | 'member' }
export interface Member { id: string; name: string; role: string }
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
    throw new Error(typeof data.detail === 'string' ? data.detail : 'Check your entries and try again.')
  }
  if (data.error || data.ok === false) throw new Error(data.error || 'Request failed.')
  return data as T
}
export function stamp(value: string) { return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }
