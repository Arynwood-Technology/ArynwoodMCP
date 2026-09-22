// Installs a global window.fetch that answers every /api/* call from canned fixture
// data instead of a real backend. Must be installed *after* main.tsx's existing
// `if (import.meta.env.PROD)` fetch patch, so this one wraps outermost: it sees the
// original, clean `/api/...` path and fully answers it before that inner patch's
// apiUrl()→http://localhost:8010 rewrite ever runs. Non-/api requests (fonts, etc.)
// fall through to the real fetch untouched.
import { chatStore } from './chatStore'
import {
  PERSONAS, STATUS, GPU_QUEUE, SERVERS, TOOLS, CHECKPOINTS, LORAS, OLLAMA_MODELS,
  KNOWLEDGE_STATUS, KNOWLEDGE_SOURCES, MCP_SERVERS, SIDECARS, DJ_TOOLS, DJ_SESSIONS,
} from './fixtures'
// `?inline` forces Vite to always base64-inline this asset (it's ~100KB, well past the
// default 4KB assetsInlineLimit) rather than emit a separate hashed file — a plain
// import wouldn't matter for code-splitting purposes either way (this module is only
// ever reached via the dynamic bootstrap import), but inlining means no extra network
// round-trip is needed to turn it into the base64 string the real SD/rembg/upscale
// endpoints all return.
import demoImageDataUrl from './assets/demo-generated-image.png?inline'

const DEMO_IMAGE_BASE64 = demoImageDataUrl.replace(/^data:image\/png;base64,/, '')

interface DemoReq { json?: unknown; formData?: FormData }
interface Res { status?: number; body?: unknown }
type Handler = (params: Record<string, string>, req: DemoReq) => Res | Promise<Res>

// A verb that would mutate real state on a real install, for any path not explicitly
// given a working fixture handler below — answered with a clear, honest denial instead
// of silently doing nothing or throwing an opaque network error.
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const DEMO_DENIED: Res = { status: 403, body: { detail: 'Not available in this demo — this would change real data on a real install.' } }

// `| undefined` on the value type (not just relying on an index signature) is what
// makes a plain `STATIC[key]` truthy-check type-check as meaningful rather than
// tripping TS2774 ("this function is always defined") — noUncheckedIndexedAccess isn't
// enabled in this project's tsconfig, so a bare `Record<string, Handler>` would type
// every lookup as unconditionally present.
const STATIC: Record<string, Handler | undefined> = {
  'GET /system/status': () => ({ body: STATUS }),
  'GET /system/gpu-queue': () => ({ body: GPU_QUEUE }),
  'GET /servers': () => ({ body: SERVERS }),
  'GET /tools': () => ({ body: TOOLS }),
  'GET /chat/personas': () => ({ body: PERSONAS }),
  'GET /chat/conversations': () => ({ body: chatStore.conversations }),
  'GET /knowledge/status': () => ({ body: KNOWLEDGE_STATUS }),
  'GET /knowledge/sources': () => ({ body: KNOWLEDGE_SOURCES }),
  'GET /mcp/servers': () => ({ body: MCP_SERVERS }),
  'GET /studio/sidecars': () => ({ body: SIDECARS }),
  'GET /models/checkpoints': () => ({ body: CHECKPOINTS }),
  'GET /models/loras': () => ({ body: LORAS }),
  'GET /ollama/models': () => ({ body: { models: OLLAMA_MODELS } }),
  'GET /ollama/running': () => ({ body: { models: [] } }),
  'GET /video/library': () => ({ body: [] }),
  'GET /music/capabilities': () => ({ body: { providers: [], stems: { provider: '', sidecar_status: 'stopped', engines: [], stem_counts: [] } } }),
  'GET /music/assets': () => ({ body: [] }),
  // DJ Toolkit's tools/sessions are read-only real reference content — see DJ_TOOLS'
  // comment in fixtures.ts. Nothing to "launch" in a browser, but the catalog/manual is
  // a real feature worth showing, not a wall.
  'GET /dj/tools': () => ({ body: DJ_TOOLS }),
  'GET /dj/sessions': () => ({ body: DJ_SESSIONS }),
  // "AI image generation" gets a real, working response — a placeholder we made and
  // clearly labeled as a demo image (see assets/demo-generated-image.png), not a 403.
  // Shapes match the real A1111/rembg/Real-ESRGAN responses exactly (ToolLibrary.tsx
  // prepends the data: URI prefix itself), so the same UI code renders it identically.
  'POST /tools/stable_diffusion/generate': () => ({ body: { images: [DEMO_IMAGE_BASE64] } }),
  'POST /tools/rembg/remove': () => ({ body: { image_base64: DEMO_IMAGE_BASE64 } }),
  'POST /tools/realesrgan/upscale': () => ({ body: { image_base64: DEMO_IMAGE_BASE64 } }),
  // File upload can be genuinely real — no backend needed to read a File client-side.
  'POST /chat/upload': async (_params, req) => {
    const file = req.formData?.get('file') as File | undefined
    if (!file) return { status: 400, body: { detail: 'No file' } }
    const text = await file.text()
    return { body: { filename: file.name, text: text.slice(0, 4000), chars: text.length } }
  },
}

const DYNAMIC: { method: string; pattern: string; handler: Handler }[] = [
  { method: 'GET', pattern: '/chat/conversations/:id/messages', handler: (p) => ({ body: chatStore.getMessages(+p.id) }) },
  { method: 'DELETE', pattern: '/chat/conversations/:id', handler: (p) => ({ body: chatStore.deleteConversation(+p.id) }) },
  { method: 'GET', pattern: '/servers/:id/ping', handler: () => ({ body: { online: true } }) },
  // "Launching" a native desktop app has no real meaning in a browser — this is honest
  // about that (no fake pid pretending something opened) rather than either denying the
  // click outright or silently lying that an app started.
  {
    method: 'POST', pattern: '/dj/tools/:id/launch',
    handler: (p) => {
      const tool = DJ_TOOLS.find(t => t.id === p.id)
      return { status: 409, body: { detail: `${tool?.name ?? 'This tool'} would launch here on a real install — there's no desktop to open it on in a browser demo.` } }
    },
  },
  {
    method: 'POST', pattern: '/dj/sessions/:id/start',
    handler: (p) => {
      const session = DJ_SESSIONS.find(s => s.id === p.id)
      return { status: 409, body: { detail: `${session?.label ?? 'This session'} would launch its tools here on a real install — there's no desktop to open them on in a browser demo.` } }
    },
  },
]

function matchDynamic(method: string, path: string): { handler: Handler; params: Record<string, string> } | null {
  const pathSegs = path.split('/').filter(Boolean)
  for (const route of DYNAMIC) {
    if (route.method !== method) continue
    const routeSegs = route.pattern.split('/').filter(Boolean)
    if (routeSegs.length !== pathSegs.length) continue
    const params: Record<string, string> = {}
    let ok = true
    for (let i = 0; i < routeSegs.length; i++) {
      const rs = routeSegs[i]
      if (rs.startsWith(':')) params[rs.slice(1)] = pathSegs[i]
      else if (rs !== pathSegs[i]) { ok = false; break }
    }
    if (ok) return { handler: route.handler, params }
  }
  return null
}

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

export function installDemoFetch() {
  const passthrough = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (!url.startsWith('/api/')) return passthrough(input, init)

    const method = (init?.method ?? 'GET').toUpperCase()
    const path = url.slice('/api'.length).split('?')[0]
    const isForm = init?.body instanceof FormData
    const req: DemoReq = {
      formData: isForm ? (init!.body as FormData) : undefined,
      json: !isForm && typeof init?.body === 'string' ? safeParse(init.body) : undefined,
    }

    await sleep(120 + Math.random() * 180) // visible loading states, not instant snaps

    const key = `${method} ${path}`
    const staticHandler = STATIC[key]
    const dynamic = staticHandler ? null : matchDynamic(method, path)

    let result: Res
    if (staticHandler) {
      result = await staticHandler({}, req)
    } else if (dynamic) {
      result = await dynamic.handler(dynamic.params, req)
    } else if (MUTATING.has(method)) {
      // No explicit fixture for a write — deny clearly rather than silently no-op or
      // let it fall through to a nonexistent real backend.
      result = DEMO_DENIED
    } else {
      console.warn(`[demo] no fixture for ${key}`)
      result = { status: 404, body: { detail: 'Not available in this demo' } }
    }

    const { status = 200, body = {} } = result
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }
}

function safeParse(text: string): unknown {
  try { return JSON.parse(text) } catch { return undefined }
}
