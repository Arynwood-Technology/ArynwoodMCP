import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
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

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/models" element={<ModelManager />} />
          <Route path="/servers" element={<Servers />} />
          <Route path="/tools" element={<ToolLibrary />} />
          <Route path="/publish" element={<Deploy />} />
          <Route path="/knowledge" element={<Knowledge />} />
          <Route path="/studio" element={<Studio />} />
          <Route path="/dj" element={<DJStudio />} />
          <Route path="/social" element={<Social />} />
          <Route path="/video" element={<Video />} />
          {/* Design Center renders from AppShell's always-mounted overlay, not
              here — it must survive navigation to keep its iframe alive. This
              route exists only so the path matches and the shell can react. */}
          <Route path="/design" element={null} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
