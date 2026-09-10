import '@testing-library/jest-dom/vitest'

// App.tsx bootstraps via getServers()/getTools() on mount (real fetch calls);
// tests run without a backend, so stub fetch to resolve empty lists rather
// than letting jsdom's unimplemented fetch reject noisily into the console.
globalThis.fetch = (async () =>
  new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } })
) as typeof fetch

// jsdom ships no matchMedia. useMediaQuery (Sidebar's narrow-viewport rail)
// tolerates its absence, but stubbing it means tests exercise the real code
// path and can drive the breakpoint via setViewportMatches() below.
let mediaMatches = false
const listeners = new Set<(e: MediaQueryListEvent) => void>()

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    media: query,
    get matches() { return mediaMatches },
    onchange: null,
    addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => { listeners.add(fn) },
    removeEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => { listeners.delete(fn) },
    addListener: (fn: (e: MediaQueryListEvent) => void) => { listeners.add(fn) },
    removeListener: (fn: (e: MediaQueryListEvent) => void) => { listeners.delete(fn) },
    dispatchEvent: () => false,
  })) as typeof window.matchMedia
}

/** Drive the stubbed media query from a test. Call with `true` to simulate a
 *  viewport narrower than the sidebar's breakpoint. Wrap in act() — it pushes a
 *  React state update into every mounted useMediaQuery. */
export function setViewportMatches(value: boolean) {
  mediaMatches = value
  listeners.forEach(fn => fn({ matches: value } as MediaQueryListEvent))
}

/** Reset the breakpoint between tests *without* notifying listeners. Dispatching
 *  here would push state into trees mid-teardown and trip act() warnings. */
export function resetViewport() {
  mediaMatches = false
  listeners.clear()
}
