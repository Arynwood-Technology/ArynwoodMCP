// Deliberately the ONLY thing App.tsx/AppShell.tsx/Chat.tsx import from lib/demo/ —
// this file has zero other imports. `import.meta.env.MODE` (not a custom VITE_* var) is
// what makes this a reliable compile-time constant: Vite always inlines MODE as a
// literal string for every build, whether or not any .env file sets it — a custom var
// like VITE_DEMO_MODE only becomes a literal when something actually defines it, so its
// *absence* doesn't reliably fold to `false` for dead-code elimination (confirmed: an
// earlier version of this file using VITE_DEMO_MODE leaked demo copy into the real
// `npm run build` bundle). `vite build --mode demo` is the only thing that sets MODE to
// 'demo'; the real app, dev server and Tauri build never do. Everything else in
// lib/demo/ (fixtures, scenarios, the fetch/WebSocket mocks) is only ever reached via
// main.tsx's dynamic `import('./lib/demo/bootstrap')`, so none of it ships in a real
// build's bundle — importing this flag here must never pull that in too.
export const DEMO = import.meta.env.MODE === 'demo'
