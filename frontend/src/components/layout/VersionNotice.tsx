import { APP_VERSION, backendDiffers } from '../../lib/updates'
import { useAppStore } from '../../store/useAppStore'

/**
 * Says so when the backend answering these screens is another release. Parts of the app then fail in ways
 * nothing else explains, and before this nothing said why (issue #24). System status has the fix.
 */
export function VersionNotice() {
  const status = useAppStore(s => s.status)
  const openStatus = useAppStore(s => s.setStatusDrawerOpen)
  if (!backendDiffers(status)) return null
  return (
    <div role="alert" className="flex shrink-0 flex-wrap items-center gap-3 border-b border-warning/50 bg-surface2 px-5 py-2 text-sm text-text">
      <span>
        These screens are Arynwood MCP {APP_VERSION}, but the backend answering them
        is {status?.version ?? 'an older release'}. Parts of the app may not work.
      </span>
      <button type="button" className="cursor-pointer text-accent underline" onClick={() => openStatus(true)}>
        What to do
      </button>
    </div>
  )
}
