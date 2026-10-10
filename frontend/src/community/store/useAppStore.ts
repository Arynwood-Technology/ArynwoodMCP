import { create } from 'zustand'

interface AppState {
  // Mail unread count
  mailUnread: number
  setMailUnread: (n: number) => void

  // P2P unread counts — keyed by addr or "group:<id>"
  p2pUnread: Record<string, number>
  setP2pUnread: (u: Record<string, number>) => void

  // IRC — persisted across navigation
  ircConnected: boolean
  ircConnecting: boolean
  ircPageVisible: boolean
  ircNick: string
  ircAway: boolean
  ircChannelList: string[]
  ircActiveChannel: string
  ircMessages: Record<string, IRCMsg[]>
  ircUsers: Record<string, string[]>       // channel -> nicks (with prefix stripped)
  ircUserPrefixes: Record<string, Record<string, string>>  // channel -> nick -> prefix (@/+/etc)
  ircTopics: Record<string, string>
  ircWhois: WhoisInfo | null
  ircIgnored: string[]
  ircUnreadByChannel: Record<string, number>
  ircUnread: number
  setIrcUnread: (n: number) => void
  setIrcState: (partial: Partial<Pick<AppState,
    'ircConnected' | 'ircConnecting' | 'ircPageVisible' | 'ircNick' | 'ircAway' |
    'ircChannelList' | 'ircActiveChannel' | 'ircMessages' | 'ircUsers' | 'ircUserPrefixes' |
    'ircTopics' | 'ircWhois' | 'ircIgnored' | 'ircUnreadByChannel' | 'ircUnread'
  >>) => void
}

export interface IRCMsg {
  id: number
  type: 'chat' | 'join' | 'part' | 'quit' | 'notice' | 'server' | 'error' | 'self' | 'action' | 'mention'
  nick: string
  channel?: string
  text: string
  ts: string
}

export interface WhoisInfo {
  nick: string
  user?: string
  host?: string
  realname?: string
  server?: string
  serverInfo?: string
  channels?: string
  account?: string
  idleSecs?: number
  signonTime?: number
  oper?: boolean
}


export const useAppStore = create<AppState>((set) => ({
  mailUnread: 0,
  setMailUnread: (mailUnread) => set({ mailUnread }),

  p2pUnread: {},
  setP2pUnread: (p2pUnread) => set({ p2pUnread }),

  ircConnected: false,
  ircConnecting: false,
  ircPageVisible: false,
  ircNick: 'mcp',
  ircAway: false,
  ircChannelList: [],
  ircActiveChannel: '',
  ircMessages: {},
  ircUsers: {},
  ircUserPrefixes: {},
  ircTopics: {},
  ircWhois: null,
  ircIgnored: [],
  ircUnreadByChannel: {},
  ircUnread: 0,
  setIrcUnread: (ircUnread) => set({ ircUnread }),
  setIrcState: (partial) => set(partial),
}))
