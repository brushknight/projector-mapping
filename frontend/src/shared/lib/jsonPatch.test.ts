import { describe, expect, it } from 'vitest'
import { applyPatch, getAt, onlyLeafReplaces, pointer, setAt } from './jsonPatch'

describe('jsonPatch', () => {
  const doc = { a: [{ x: 1 }, { x: 2 }], b: { c: 'hi' } }

  it('adds, replaces, removes immutably', () => {
    const out = applyPatch(doc, [
      { op: 'add', path: '/a/-', value: { x: 3 } },
      { op: 'replace', path: '/a/0/x', value: 9 },
      { op: 'remove', path: '/b/c' },
      { op: 'add', path: '/a/1', value: { x: 7 } },
    ])
    expect(out).toEqual({ a: [{ x: 9 }, { x: 7 }, { x: 2 }, { x: 3 }], b: {} })
    expect(doc.a[0].x).toBe(1)
    expect(out.a[2]).toBe(doc.a[1]) // untouched branches are shared
  })

  it('moves and copies', () => {
    const out = applyPatch(doc, [{ op: 'move', from: '/a/0', path: '/a/1' }, { op: 'copy', from: '/b', path: '/d' }])
    expect(out.a).toEqual([{ x: 2 }, { x: 1 }])
    expect((out as Record<string, unknown>).d).toEqual({ c: 'hi' })
  })

  it('throws on a missing path and on a failed test', () => {
    expect(() => applyPatch(doc, [{ op: 'replace', path: '/a/5/x', value: 1 }])).toThrow()
    expect(() => applyPatch(doc, [{ op: 'test', path: '/b/c', value: 'no' }])).toThrow()
  })

  it('escapes pointers', () => {
    expect(pointer('a/b', 'c~d', 3)).toBe('/a~1b/c~0d/3')
    expect(getAt({ 'a/b': { 'c~d': [0, 1, 2, 'x'] } }, '/a~1b/c~0d/3')).toBe('x')
  })

  it('sets params and spots leaf-only patches', () => {
    expect(setAt(doc, '/b/c', 'yo').b.c).toBe('yo')
    expect(setAt(doc, '/b/new', 1)).toMatchObject({ b: { c: 'hi', new: 1 } })
    expect(onlyLeafReplaces([{ op: 'replace', path: '/a/0/x', value: 3 }], doc)).toBe(true)
    expect(onlyLeafReplaces([{ op: 'replace', path: '/a/0', value: {} }], doc)).toBe(false)
    expect(onlyLeafReplaces([{ op: 'add', path: '/a/-', value: 1 }], doc)).toBe(false)
  })
})
