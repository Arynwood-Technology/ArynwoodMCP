import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { SystemStatus, Server, Conversation, Tool, Persona } from '../lib/api'

interface AppState {
  // System
  status: SystemStatus | null
  setStatus: (s: SystemStatus) => void

  // Active selections
  activeModel: string
  setActiveModel: (m: string) => void
  activeServer: Server | null
  setActiveServer: (s: Server | null) => void

  // Personas
  personas: Persona[]
  setPersonas: (p: Persona[]) => void
  activePersonaId: string
  setActivePersonaId: (id: string) => void

  // Conversations
  conversations: Conversation[]
  setConversations: (c: Conversation[]) => void
  activeConversationId: number | null
  setActiveConversationId: (id: number | null) => void

  // Servers
  servers: Server[]
  setServers: (s: Server[]) => void

  // Tools
  tools: Tool[]
  setTools: (t: Tool[]) => void

  // Page chrome — a page can override the route's default TopBar title (Chat
  // shows the live persona name). null falls back to the route table.
  pageTitle: string | null
  setPageTitle: (t: string | null) => void

  // Sidebar rail vs. labelled nav. The only persisted field (see `partialize`)
  // — it's a deliberate user preference, unlike everything else here, which is
  // either server state or per-session.
  sidebarExpanded: boolean
  setSidebarExpanded: (v: boolean) => void
  toggleSidebar: () => void

  // Global overlays, hosted by AppShell so any page can open them.
  paletteOpen: boolean
  setPaletteOpen: (v: boolean) => void
  statusDrawerOpen: boolean
  setStatusDrawerOpen: (v: boolean) => void

  // Dashboard Arynwood chat — persisted across navigation
  dashMsgs: DashMsg[]
  dashConvId: number | null
  setDashMsgs: (msgs: DashMsg[] | ((prev: DashMsg[]) => DashMsg[])) => void
  setDashConvId: (id: number | null) => void
}

export interface DashMsg {
  id: number
  role: 'user' | 'assistant' | 'error'
  text: string
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      status: null,
      setStatus: (status) => set({ status }),

      activeModel: 'qwen2.5-coder:14b',
      setActiveModel: (activeModel) => set({ activeModel }),
      activeServer: null,
      setActiveServer: (activeServer) => set({ activeServer }),

      personas: [],
      setPersonas: (personas) => set({ personas }),
      activePersonaId: 'central',
      setActivePersonaId: (activePersonaId) => set({ activePersonaId }),

      conversations: [],
      setConversations: (conversations) => set({ conversations }),
      activeConversationId: null,
      setActiveConversationId: (activeConversationId) => set({ activeConversationId }),

      servers: [],
      setServers: (servers) => set({ servers }),

      tools: [],
      setTools: (tools) => set({ tools }),

      pageTitle: null,
      setPageTitle: (pageTitle) => set({ pageTitle }),

      sidebarExpanded: false,
      setSidebarExpanded: (sidebarExpanded) => set({ sidebarExpanded }),
      toggleSidebar: () => set(s => ({ sidebarExpanded: !s.sidebarExpanded })),

      paletteOpen: false,
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      statusDrawerOpen: false,
      setStatusDrawerOpen: (statusDrawerOpen) => set({ statusDrawerOpen }),

      dashMsgs: [],
      dashConvId: null,
      setDashMsgs: (updater) => set(state => ({ dashMsgs: typeof updater === 'function' ? updater(state.dashMsgs) : updater })),
      setDashConvId: (dashConvId) => set({ dashConvId }),
    }),
    {
      name: 'arynwood-ui',
      storage: createJSONStorage(() => localStorage),
      // Persist preferences only. Server state (status, servers, conversations)
      // must come from the backend on every load, and stale overlay flags would
      // reopen the palette on refresh.
      partialize: (s) => ({ sidebarExpanded: s.sidebarExpanded }),
    },
  ),
)
