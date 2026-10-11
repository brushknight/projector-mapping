import { createRootRoute, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import { OutPage } from './routes/out'
import { PreviewPage } from './routes/preview'

// The editor and the style guide are big; /out and /preview load only the engine and the hub client.
const EditorPage = lazy(() => import('./routes/editor').then((m) => ({ default: m.EditorPage })))
const ComponentsPage = lazy(() => import('./routes/components').then((m) => ({ default: m.ComponentsPage })))

const rootRoute = createRootRoute({
  component: () => (
    <Suspense fallback={null}>
      <Outlet />
    </Suspense>
  ),
})

const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : typeof v === 'number' ? String(v) : undefined)

export type OutSearch = { headless?: string; token?: string }
const outRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/out',
  component: OutPage,
  validateSearch: (s: Record<string, unknown>): OutSearch => ({ ...(str(s.headless) ? { headless: str(s.headless) } : {}), ...(str(s.token) ? { token: str(s.token) } : {}) }),
})

export type PreviewSearch = { token?: string; w?: string; mode?: string; layer?: string }
const previewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/preview',
  component: PreviewPage,
  validateSearch: (s: Record<string, unknown>): PreviewSearch => {
    const out: PreviewSearch = {}
    for (const k of ['token', 'w', 'mode', 'layer'] as const) {
      const v = str(s[k])
      if (v) out[k] = v
    }
    return out
  },
})

export type EditorSearch = { scene?: string; login?: string }
const editorSearch = (s: Record<string, unknown>): EditorSearch => ({ ...(str(s.scene) ? { scene: str(s.scene) } : {}), ...(str(s.login) ? { login: str(s.login) } : {}) })
const editorRoute = createRoute({ getParentRoute: () => rootRoute, path: '/editor', component: () => <EditorPage workspace="map" />, validateSearch: editorSearch })
const editorMapRoute = createRoute({ getParentRoute: () => rootRoute, path: '/editor/map', component: () => <EditorPage workspace="map" />, validateSearch: editorSearch })
const editorAnimateRoute = createRoute({ getParentRoute: () => rootRoute, path: '/editor/animate', component: () => <EditorPage workspace="animate" />, validateSearch: editorSearch })
const editorAutomapRoute = createRoute({ getParentRoute: () => rootRoute, path: '/editor/automap', component: () => <EditorPage workspace="automap" />, validateSearch: editorSearch })

const componentsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/components', component: () => <ComponentsPage /> })
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/editor' })
  },
})

const routeTree = rootRoute.addChildren([indexRoute, outRoute, previewRoute, editorRoute, editorMapRoute, editorAnimateRoute, editorAutomapRoute, componentsRoute])

export const router = createRouter({ routeTree, defaultPreload: false })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
