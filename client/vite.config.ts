import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sessionFile = path.join(root, 'server/data/.local-session')

function readSessionToken(): string | null {
  try {
    if (!existsSync(sessionFile)) return null
    const t = readFileSync(sessionFile, 'utf8').trim()
    return t.length >= 32 ? t : null
  } catch {
    return null
  }
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (proxyReq) => {
            // Inject local session without exposing token in browser UI/JS
            const token = readSessionToken()
            if (token) {
              proxyReq.setHeader('X-Agent-Deck-Session', token)
            }
          })
        },
      },
    },
  },
})
