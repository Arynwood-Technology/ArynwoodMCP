import { createContext } from 'react'
import { apiUrl, wsUrl } from '../../lib/api'

/** The Community page reaches its Grove through Arynwood's backend (backend/routers/community.py),
 *  which holds the Grove sign-in: the desktop web view is a different site from any Grove, so a Grove
 *  cookie there could never be sent. */
export const GROVE_API = '/api/community/grove'
export const groveUrl = (path: string) => apiUrl(GROVE_API + path)
export const groveSocketUrl = (path: string) => wsUrl(GROVE_API + path)

export interface GroveInfo {
  /** The Grove's own address, such as https://grove.example.com: what invitation links name. */
  url: string
  local: boolean
  version: string | null
  /** Open an invitation link the owner pasted, for this Grove or another one. */
  joinLink: (href: string) => void
}

export const GroveContext = createContext<GroveInfo>({ url: window.location.origin, local: true, version: null, joinLink: () => {} })
