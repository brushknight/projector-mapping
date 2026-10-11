import { useEffect, useState } from 'react'
import { catalogApi } from './api'
import type { Catalog } from './types'

let cached: Promise<Catalog> | null = null
let cachedVersion: number | null = null

/** The catalog, fetched once per catalogVersion and shared by every component. */
export function loadCatalog(version?: number | null): Promise<Catalog> {
  if (!cached || (version != null && cachedVersion != null && version !== cachedVersion)) {
    cached = catalogApi.get().then((c) => {
      cachedVersion = c.version
      return c
    })
    cached.catch(() => {
      cached = null
    })
  }
  return cached
}

export function useCatalog(version?: number | null): Catalog | null {
  const [cat, setCat] = useState<Catalog | null>(null)
  useEffect(() => {
    let alive = true
    const load = () =>
      loadCatalog(version).then(
        (c) => alive && setCat(c),
        () => alive && setTimeout(load, 2000),
      )
    load()
    return () => {
      alive = false
    }
  }, [version])
  return cat
}
