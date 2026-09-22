import { BrowserRouter, HashRouter, Routes, Route } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { DemoUnavailable } from './components/demo/DemoUnavailable'
import { DEMO } from './lib/demo/flag'
import { Dashboard } from './pages/Dashboard'
import { Chat } from './pages/Chat'
import { ModelManager } from './pages/ModelManager'
import { Servers } from './pages/Servers'
import { ToolLibrary } from './pages/ToolLibrary'
import { Deploy } from './pages/Deploy'
import { Knowledge } from './pages/Knowledge'
import { Studio } from './pages/Studio'
import { DJStudio } from './pages/DJStudio'
import { Social } from './pages/Social'
import { Video } from './pages/Video'

// GitHub Pages serves static files with no server-side history-fallback rewrite, so a
// BrowserRouter route 404s on a hard refresh or direct link. HashRouter sidesteps that
// with zero extra static files — only the demo build uses it; the real app (dev + Tauri
// packaged) keeps BrowserRouter unchanged.
const Router = DEMO ? HashRouter : BrowserRouter

export default function App() {
  return (
    <Router>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/models" element={<ModelManager />} />
          <Route path="/servers" element={<Servers />} />
          <Route path="/tools" element={<ToolLibrary />} />
          <Route path="/publish" element={DEMO ? <DemoUnavailable feature="Publish" reason="a real SFTP/SSH server to deploy to" /> : <Deploy />} />
          <Route path="/knowledge" element={<Knowledge />} />
          <Route path="/studio" element={DEMO ? <DemoUnavailable feature="Music Studio" reason="a real GPU running local audio models" /> : <Studio />} />
          {/* Browsable in the demo — real catalog/manual content (see fixtures.ts's
              DJ_TOOLS), just no real desktop to actually launch anything on. */}
          <Route path="/dj" element={<DJStudio />} />
          <Route path="/social" element={DEMO ? <DemoUnavailable feature="Social Media" reason="real OAuth against live platforms" /> : <Social />} />
          <Route path="/video" element={DEMO ? <DemoUnavailable feature="Video Studio" reason="real GPU video generation" /> : <Video />} />
          {/* Design Center renders from AppShell's always-mounted overlay, not
              here — it must survive navigation to keep its iframe alive. This
              route exists only so the path matches and the shell can react.
              In demo mode AppShell never mounts that overlay, so this element
              is what actually renders there instead. */}
          <Route path="/design" element={DEMO ? <DemoUnavailable feature="Design Center" reason="a real local Stable Diffusion backend" /> : null} />
        </Route>
      </Routes>
    </Router>
  )
}
