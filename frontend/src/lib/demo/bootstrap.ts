// Only ever reached via main.tsx's dynamic `import('./lib/demo/bootstrap')` — never
// import this statically from anywhere (that would pull fixtures/scenarios/mocks into
// the real app's bundle; see flag.ts's note). This is where that heavier graph
// actually lives.
import { installDemoFetch } from './fetchInterceptor'
import { DemoWebSocket } from './DemoWebSocket'

export function installDemoMode() {
  installDemoFetch()
  // ChatSocket (lib/ws.ts) just does `new WebSocket(...)` — replacing the global here
  // makes it transparently use the scripted fake, no changes needed to ws.ts itself.
  // DemoWebSocket's shape is intentionally narrower than the real DOM WebSocket
  // interface (no binaryType/protocol/addEventListener/etc.), hence the cast.
  ;(window as unknown as { WebSocket: typeof WebSocket }).WebSocket =
    DemoWebSocket as unknown as typeof WebSocket
}
