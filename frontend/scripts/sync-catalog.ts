/**
 * Writes the plate library into contract/catalog.json from the plate sources in src/render/plates (protocol §16): the
 * `gobos` list (every attachment is a plate), `goboCategories`, `windowParamGroups` and the catalog `version`. The
 * rest of the catalog stays as it is. Run after adding or changing a plate, then `npm run thumbs -- plate-` and
 * `cd ../backend && make catalog`:
 *
 *   npm run catalog
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FIELD_MODES, PLATE_CATEGORIES, PLATES } from '../src/render/plates'
import { WINDOW_PARAM_GROUPS, WINDOW_PARAMS } from '../src/render/plates/windows'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const path = resolve(root, 'contract/catalog.json')
const catalog = JSON.parse(readFileSync(path, 'utf8'))

/** the focus a plate starts with: crisp, and sharper still for the fine lines */
const FOCUS: Record<string, number> = { 'plate-fine-vertical-lines': 0.9, 'plate-fine-horizontal-lines': 0.9 }

catalog.version = 6
catalog.goboCategories = PLATE_CATEGORIES
catalog.windowParamGroups = WINDOW_PARAM_GROUPS
catalog.gobos = PLATES.map((p) => {
  const params: Record<string, unknown> = {
    field: { type: 'enum', options: [...FIELD_MODES], default: 'round', label: 'light field' },
  }
  if (p.window) {
    for (const [k, spec] of Object.entries(WINDOW_PARAMS)) params[k] = { ...spec, default: p.window[k] ?? spec.default }
  }
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    category: p.category,
    thumb: `thumbs/${p.id}.png`,
    metalThumb: `thumbs/${p.id}-metal.png`,
    source: p.source,
    ...(p.window ? { family: 'window' } : {}),
    params,
    attachment: { scale: 1, rotation: 0 },
    focus: FOCUS[p.id] ?? 0.82,
    defaults: { depth: 0 },
  }
})

writeFileSync(path, JSON.stringify(catalog, null, 2) + '\n')
console.log(`catalog ${catalog.version}: ${catalog.gobos.length} plates (${catalog.gobos.filter((g: { family?: string }) => g.family).length} windows)`)
