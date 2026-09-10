import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5180,
    strictPort: true,
    proxy: {
      '/api':        { target: 'http://localhost:8010', changeOrigin: true, ws: true },
      '/html-tools': { target: 'http://localhost:8010', changeOrigin: true },
    },
  },
})
