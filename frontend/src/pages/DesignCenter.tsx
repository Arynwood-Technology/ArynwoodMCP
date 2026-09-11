
// Stable URL — no Date.now() here. Date.now() on every render causes App.tsx to
// re-render on each navigation, generating a new timestamp URL and reloading the
// iframe, which wipes all canvas state.
//
// Dev: relative, so the iframe stays same-origin with the parent app (Vite proxies
// /html-tools to the backend, see vite.config.ts) — a cross-origin iframe silently
// blocks file downloads (Chrome's default Permissions-Policy for "downloads" only
// allows same-origin frames), which is why the LoRA "Download" buttons produced no
// prompt before this was made relative.
//
// Packaged build: there's no such proxy — the frontend is served from Tauri's own
// origin (http://tauri.localhost) with nothing forwarding /html-tools anywhere, so a
// relative URL here 404s inside Tauri's own asset protocol and the iframe never
// loads at all (confirmed: this is why Design Center didn't load in the packaged
// app). Must be absolute to the real backend origin instead — this does reintroduce
// the cross-origin download-blocking behavior described above for the packaged
// build specifically; loading correctly is the more urgent fix of the two.
const DESIGN_CENTER_URL = import.meta.env.PROD
  ? 'http://localhost:8010/html-tools/design-center.html'
  : '/html-tools/design-center.html'

export function DesignCenter() {
  return (
    <iframe
      src={DESIGN_CENTER_URL}
      style={{
        width: '100%',
        height: '100%',
        border: 'none',
        display: 'block',
      }}
      title="Design Center"
    />
  )
}
