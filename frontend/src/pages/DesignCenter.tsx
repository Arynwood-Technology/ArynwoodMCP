
// Stable URL — no Date.now() here. Date.now() on every render causes App.tsx to
// re-render on each navigation, generating a new timestamp URL and reloading the
// iframe, which wipes all canvas state.
//
// Relative (not absolute http://localhost:8000/...) so the iframe stays same-origin
// with the parent app (vite proxies /html-tools to the backend, see vite.config.ts).
// A cross-origin iframe here would silently block file downloads (Chrome's default
// Permissions-Policy for "downloads" only allows same-origin frames) — that's why
// the LoRA "Download" buttons produced no prompt.
const DESIGN_CENTER_URL = `/html-tools/design-center.html`

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
