import { useEffect } from 'react'
import { useAppStore } from '../../store/useAppStore'

/** Override the global TopBar title for as long as this page is mounted.
 *  Pages with a static title don't need this — add them to ROUTE_TITLES in
 *  AppShell instead. Use it only when the title is derived from state, the
 *  way Chat's is from the active persona. */
export function usePageTitle(title: string) {
  const setPageTitle = useAppStore(s => s.setPageTitle)
  useEffect(() => {
    setPageTitle(title)
    return () => setPageTitle(null)
  }, [title, setPageTitle])
}
