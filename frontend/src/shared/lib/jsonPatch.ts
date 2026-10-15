/**
 * RFC 6902 JSON Patch applied immutably (structural sharing along the touched paths), plus JSON Pointer helpers.
 * The hub client uses it to apply snapshots, patched ops and params to its local copy.
 */
export type JsonOp =
  | { op: 'add' | 'replace' | 'test'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'move' | 'copy'; from: string; path: string }

export function parsePointer(path: string): string[] {
  if (path === '') return []
  if (!path.startsWith('/')) throw new Error(`bad JSON pointer ${path}`)
  return path.slice(1).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'))
}

export function pointer(...parts: Array<string | number>): string {
  return parts.map((p) => '/' + String(p).replace(/~/g, '~0').replace(/\//g, '~1')).join('')
}

export function getAt(doc: unknown, path: string): unknown {
  let cur: unknown = doc
  for (const k of parsePointer(path)) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = Array.isArray(cur) ? cur[k === '-' ? cur.length : Number(k)] : (cur as Record<string, unknown>)[k]
  }
  return cur
}

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)))

function setIn(node: unknown, keys: string[], i: number, fn: (parent: unknown, key: string) => unknown): unknown {
  if (i === keys.length - 1) return fn(node, keys[i])
  const k = keys[i]
  if (Array.isArray(node)) {
    const idx = Number(k)
    if (!(idx >= 0 && idx < node.length)) throw new Error(`path not found at ${k}`)
    const copy = node.slice()
    copy[idx] = setIn(node[idx], keys, i + 1, fn)
    return copy
  }
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>
    if (!(k in o)) throw new Error(`path not found at ${k}`)
    return { ...o, [k]: setIn(o[k], keys, i + 1, fn) }
  }
  throw new Error(`path not found at ${k}`)
}

function addAt(doc: unknown, path: string, value: unknown, replace: boolean): unknown {
  const keys = parsePointer(path)
  if (!keys.length) return value
  return setIn(doc, keys, 0, (parent, key) => {
    if (Array.isArray(parent)) {
      const copy = parent.slice()
      if (replace) {
        const idx = Number(key)
        if (!(idx >= 0 && idx < copy.length)) throw new Error(`replace out of range ${path}`)
        copy[idx] = value
      } else {
        const idx = key === '-' ? copy.length : Number(key)
        if (!(idx >= 0 && idx <= copy.length)) throw new Error(`add out of range ${path}`)
        copy.splice(idx, 0, value)
      }
      return copy
    }
    if (parent && typeof parent === 'object') {
      if (replace && !(key in (parent as object))) throw new Error(`replace of missing ${path}`)
      return { ...(parent as Record<string, unknown>), [key]: value }
    }
    throw new Error(`bad parent for ${path}`)
  })
}

function removeAt(doc: unknown, path: string): unknown {
  const keys = parsePointer(path)
  return setIn(doc, keys, 0, (parent, key) => {
    if (Array.isArray(parent)) {
      const idx = Number(key)
      if (!(idx >= 0 && idx < parent.length)) throw new Error(`remove out of range ${path}`)
      const copy = parent.slice()
      copy.splice(idx, 1)
      return copy
    }
    if (parent && typeof parent === 'object' && key in (parent as object)) {
      const { [key]: _gone, ...rest } = parent as Record<string, unknown>
      void _gone
      return rest
    }
    throw new Error(`remove of missing ${path}`)
  })
}

export function applyOp<T>(doc: T, op: JsonOp): T {
  switch (op.op) {
    case 'add':
      return addAt(doc, op.path, clone(op.value), false) as T
    case 'replace':
      return addAt(doc, op.path, clone(op.value), true) as T
    case 'remove':
      return removeAt(doc, op.path) as T
    case 'move': {
      const v = getAt(doc, op.from)
      return addAt(removeAt(doc, op.from), op.path, v, false) as T
    }
    case 'copy':
      return addAt(doc, op.path, clone(getAt(doc, op.from)), false) as T
    case 'test':
      if (JSON.stringify(getAt(doc, op.path)) !== JSON.stringify(op.value)) throw new Error(`test failed at ${op.path}`)
      return doc
  }
}

/** Applies every op in order; throws (leaving the input untouched) when one fails. */
export function applyPatch<T>(doc: T, ops: readonly JsonOp[]): T {
  return ops.reduce((d, op) => applyOp(d, op), doc)
}

/** Sets a value at a pointer, creating it when the last key is new (how incoming params are applied). */
export function setAt<T>(doc: T, path: string, value: unknown): T {
  const exists = getAt(doc, path) !== undefined
  return addAt(doc, path, clone(value), exists && !path.endsWith('/-')) as T
}

/** True when every op only replaces a leaf value (the server applies these even on a stale base). */
export function onlyLeafReplaces(ops: readonly JsonOp[], doc: unknown): boolean {
  return ops.every((op) => {
    if (op.op === 'test') return true
    if (op.op !== 'replace') return false
    const cur = getAt(doc, op.path)
    return cur === null || typeof cur !== 'object'
  })
}
