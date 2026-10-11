import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { applyPatch, getAt, setAt } from '../../shared/lib/jsonPatch'
import { useChannel } from '../../shared/lib/useHub'
import type { Hub } from '../../shared/lib/ws'
import { draftApi } from '../draft/api'
import type { Draft } from '../draft/types'
import type { PatchOp, Scene } from './types'

export type EditMode = 'live' | 'backstage'
export type Phase = 'live' | 'final'
export type OpsBuilder = (scene: Scene) => PatchOp[] | null

export interface SceneEditing {
  /** what the editor shows and edits: the live scene, or the scene with the backstage draft applied */
  scene: Scene | null
  /** the live scene as the server has it */
  live: Scene | null
  version: number
  mode: EditMode
  draft: Draft | null
  /** a structural edit; `build` runs again on a newer document if the server says the base is stale */
  edit: (build: OpsBuilder) => Promise<void>
  /** a continuous value (slider, drag): `live` while moving, `final` on release */
  setValue: (path: string, value: unknown, phase: Phase) => void
  setValues: (entries: Array<[string, unknown]>, phase: Phase) => void
  /** true while edits wait for the server */
  pending: boolean
}

const safeApply = (doc: Scene | null, ops: readonly PatchOp[]): Scene | null => {
  if (!doc) return doc
  try {
    return applyPatch(doc, ops)
  } catch {
    // apply op by op so one stale op doesn't hide the rest
    let d = doc
    for (const op of ops) {
      try {
        d = applyPatch(d, [op])
      } catch {
        /* skip */
      }
    }
    return d
  }
}

/** Finds this editor's open draft for a scene, or creates one. */
export async function ensureEditorDraft(sceneId: string): Promise<Draft> {
  const drafts = await draftApi.list().catch(() => [] as Draft[])
  const mine = drafts.find((d) => d.sceneId === sceneId && d.author === 'user:editor' && d.status === 'open')
  return mine ?? draftApi.create(sceneId, 'user:editor')
}

/**
 * The editor's write path. Live: params and patches go to `scene:{id}`. Backstage: edits go to a draft
 * (`patch` on `draft:{id}`, see docs/protocol.md) and the live scene stays untouched until the draft is applied.
 * `previewDraftId` overlays another draft read-only (an agent's proposal).
 */
export function useSceneEditing(hub: Hub, sceneId: string | null, mode: EditMode, onError: (msg: string) => void, previewDraftId?: string | null): SceneEditing {
  const sceneCh = useChannel<Scene>(hub, sceneId ? `scene:${sceneId}` : null)
  const live = sceneCh.doc && sceneCh.doc.id === sceneId ? sceneCh.doc : null
  const [draftId, setDraftId] = useState<string | null>(null)
  const draftCh = useChannel<Draft>(hub, mode === 'backstage' && draftId ? `draft:${draftId}` : null)
  const previewCh = useChannel<Draft>(hub, previewDraftId ? `draft:${previewDraftId}` : null)
  const [localOps, setLocalOps] = useState<PatchOp[][]>([])
  const [overlay, setOverlay] = useState<Record<string, unknown>>({})
  const [pendingCount, setPendingCount] = useState(0)
  const errRef = useRef(onError)
  errRef.current = onError

  useEffect(() => {
    setDraftId(null)
    setLocalOps([])
    setOverlay({})
    if (mode !== 'backstage' || !sceneId) return
    let alive = true
    ensureEditorDraft(sceneId).then(
      (d) => alive && setDraftId(d.id),
      (e) => errRef.current(`Can't open a backstage draft: ${e instanceof Error ? e.message : e}`),
    )
    return () => {
      alive = false
    }
  }, [mode, sceneId])

  const draft = mode === 'backstage' ? draftCh.doc : null
  const acked = useRef(new Map<PatchOp[], number>())
  useEffect(() => {
    if (!acked.current.size) return
    const done = [...acked.current].filter(([, v]) => draftCh.version > v).map(([ops]) => ops)
    if (!done.length) return
    for (const ops of done) acked.current.delete(ops)
    setLocalOps((xs) => xs.filter((x) => !done.includes(x)))
  }, [draftCh.version, draftCh.doc])
  // a draft that got applied or discarded elsewhere: start a fresh one
  useEffect(() => {
    if (mode === 'backstage' && draft && (draft.status === 'applied' || draft.status === 'discarded') && sceneId) {
      ensureEditorDraft(sceneId).then((d) => setDraftId(d.id), () => {})
    }
  }, [mode, draft, sceneId])

  const scene = useMemo(() => {
    let v = live
    if (mode === 'backstage' && draft) v = safeApply(v, draft.ops)
    if (mode === 'backstage') for (const ops of localOps) v = safeApply(v, ops)
    if (previewCh.doc && previewDraftId) v = safeApply(v, previewCh.doc.ops)
    for (const [p, val] of Object.entries(overlay)) {
      try {
        v = v ? setAt(v, p, val) : v
      } catch {
        /* path gone */
      }
    }
    return v
  }, [live, mode, draft, localOps, overlay, previewCh.doc, previewDraftId])

  const sceneRef = useRef(scene)
  sceneRef.current = scene

  const track = useCallback(async <T,>(p: Promise<T>) => {
    setPendingCount((n) => n + 1)
    try {
      return await p
    } finally {
      setPendingCount((n) => n - 1)
    }
  }, [])

  const edit = useCallback(
    async (build: OpsBuilder) => {
      const cur = sceneRef.current
      if (!cur || !sceneId) return
      const ops = build(cur)
      if (!ops || ops.length === 0) return
      try {
        if (mode === 'live') {
          await track(hub.patch(`scene:${sceneId}`, ops, (d) => build(d as Scene)))
        } else {
          if (!draftId) throw new Error('The backstage draft is not ready yet.')
          const ch = `draft:${draftId}`
          const sentAt = hub.get(ch).version
          setLocalOps((xs) => [...xs, ops])
          let ok = false
          try {
            await track(hub.patch(ch, ops))
            ok = true
          } finally {
            // keep showing the ops until the draft that contains them arrives (the server may ack first)
            if (ok && hub.get(ch).version <= sentAt) acked.current.set(ops, sentAt)
            else setLocalOps((xs) => xs.filter((x) => x !== ops))
          }
        }
      } catch (e) {
        errRef.current(e instanceof Error ? e.message : String(e))
      }
    },
    [hub, sceneId, mode, draftId, track],
  )

  const setValues = useCallback(
    (entries: Array<[string, unknown]>, phase: Phase) => {
      const cur = sceneRef.current
      if (!cur || !sceneId) return
      const exists = entries.every(([p]) => getAt(cur, p) !== undefined)
      if (mode === 'live' && exists) {
        for (const [p, v] of entries) hub.param(`scene:${sceneId}`, p, v)
        if (phase === 'final') setOverlay((o) => dropKeys(o, entries))
        return
      }
      // backstage, or a key that doesn't exist yet: hold it locally while moving, write it on release
      if (phase === 'live') {
        setOverlay((o) => {
          const n = { ...o }
          for (const [p, v] of entries) n[p] = v
          return n
        })
        return
      }
      void edit((s) => entries.map(([p, v]) => ({ op: getAt(s, p) === undefined ? ('add' as const) : ('replace' as const), path: p, value: v }))).finally(() =>
        setOverlay((o) => dropKeys(o, entries)),
      )
    },
    [hub, sceneId, mode, edit],
  )

  const setValue = useCallback((path: string, value: unknown, phase: Phase) => setValues([[path, value]], phase), [setValues])

  return { scene, live, version: sceneCh.version, mode, draft, edit, setValue, setValues, pending: pendingCount > 0 || sceneCh.pending }
}

function dropKeys(o: Record<string, unknown>, entries: Array<[string, unknown]>) {
  if (!entries.some(([p]) => p in o)) return o
  const n = { ...o }
  for (const [p] of entries) delete n[p]
  return n
}
