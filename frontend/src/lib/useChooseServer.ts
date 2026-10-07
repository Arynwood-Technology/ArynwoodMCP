import { useCallback } from 'react'
import { useAppStore } from '../store/useAppStore'
import { setDefaultServer, type Server } from './api'

/** Make a server the one chat uses: now, and on the next launch (GET /servers/default).
 *  An endpoint with its own model brings that model along, since a persona's Ollama
 *  model name means nothing to, say, an OpenAI-compatible provider. */
export function useChooseServer() {
  const setActiveServer = useAppStore(s => s.setActiveServer)
  const setActiveModel = useAppStore(s => s.setActiveModel)
  return useCallback((server: Server) => {
    setActiveServer(server)
    if (server.model) setActiveModel(server.model)
    setDefaultServer(server.id).catch(() => {})
  }, [setActiveServer, setActiveModel])
}
