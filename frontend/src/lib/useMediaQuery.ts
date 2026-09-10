import { useCallback, useSyncExternalStore } from 'react'

const noop = () => () => {}

/** Subscribe to a CSS media query from JS. Used where a breakpoint has to change
 *  behaviour, not just styling — the sidebar forces its icon rail on narrow
 *  viewports regardless of the user's saved preference.
 *
 *  Built on useSyncExternalStore because that is precisely what this is: reading
 *  a value that lives outside React and re-rendering when it changes. Doing it
 *  with useState + useEffect instead means a render with a stale value first. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    // matchMedia is missing in some test/SSR environments.
    if (typeof window === 'undefined' || !window.matchMedia) return noop()
    const mql = window.matchMedia(query)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  const getSnapshot = useCallback(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(query).matches
  }, [query])

  // Server snapshot: assume the wide-viewport default.
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
