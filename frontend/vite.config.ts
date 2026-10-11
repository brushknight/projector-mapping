/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const api = process.env.PROJMAP_API ?? 'http://localhost:7400'
const outDir = resolve(__dirname, '../backend/internal/web/dist')

// emptyOutDir wipes dist; the Go embed needs dist/.gitkeep to exist in a clean checkout.
const keepGitkeep = (): Plugin => ({
  name: 'projmap-gitkeep',
  apply: 'build',
  closeBundle() {
    mkdirSync(outDir, { recursive: true })
    writeFileSync(resolve(outDir, '.gitkeep'), '')
  },
})

export default defineConfig({
  base: '/',
  plugins: [react(), keepGitkeep()],
  build: { outDir, emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: {
    port: 5410,
    fs: { allow: ['..'] },
    proxy: {
      '/api': { target: api, changeOrigin: false },
      '/ws': { target: api.replace(/^http/, 'ws'), ws: true, changeOrigin: false },
      '^/a/': { target: api, changeOrigin: false },
      '/catalog': { target: api, changeOrigin: false },
      '/mcp': { target: api, changeOrigin: false },
      '/__mock': { target: api, changeOrigin: false },
    },
  },
  worker: { format: 'es' },
  // Unit tests only; e2e/*.spec.ts belong to Playwright.
  test: { include: ['src/**/*.test.ts', 'src/**/*.test.tsx'], passWithNoTests: true },
})
