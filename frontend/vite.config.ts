import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The desktop app's own backend also binds :8010, so running the dev backend beside it means picking
// another port — point the proxy at it with ARYNWOOD_DEV_API=http://localhost:18010 npm run dev.
const API = process.env.ARYNWOOD_DEV_API ?? 'http://localhost:8010'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5180,
    strictPort: true,
    proxy: {
      '/api':        { target: API, changeOrigin: true, ws: true },
      '/html-tools': { target: API, changeOrigin: true },
    },
  },
})
