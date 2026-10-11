import { defineConfig, devices } from '@playwright/test'

// e2e runs in Playwright's bundled headless Chromium against dev/mock-server.mjs (a stand-in for the Go backend
// built from contract/fixtures) on its own ports, so it never touches a real server on :7400.
const API_PORT = Number(process.env.PROJMAP_E2E_API_PORT ?? 7499)
const WEB_PORT = Number(process.env.PROJMAP_E2E_WEB_PORT ?? 5411)
export const API = `http://localhost:${API_PORT}`

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.results',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${WEB_PORT}`,
    viewport: { width: 1512, height: 945 },
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
    channel: undefined,
    headless: true,
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: [
    {
      command: `node dev/mock-server.mjs`,
      url: `${API}/api/v1/info`,
      env: { PORT: String(API_PORT) },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      env: { PROJMAP_API: API },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
