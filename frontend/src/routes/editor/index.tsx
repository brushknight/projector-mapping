import { useNavigate, useSearch } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AgentPanel } from '../../entities/agent'
import { assetApi } from '../../entities/asset/api'
import { AutoMapPanel, AutoMapStage, AutoMapSteps, useCalibration, type AutoMapState } from '../../entities/calibration'
import { useCamera } from '../../entities/camera'
import { useCatalog } from '../../entities/catalog'
import { effectApi, type EffectDef } from '../../entities/effect'
import { handleRenderRpcs } from '../../entities/output'
import { sceneApi, useSceneEditing, type EditMode, type SceneMode, type SceneSummary } from '../../entities/scene'
import { EditorContext, EMPTY_SELECTION, type EditorState, type Selection, type SoloFill, type Space, type StageView, type Tool, type Workspace } from '../../entities/scene/editor/context'
import { usePreviewClock } from '../../entities/scene/editor/preview'
import { addContentLayer, deleteObject, deleteSurface, locateSurface, mediaLayer, removeClip, removeContentLayer, removeLayer, setAtlas, setMode as setModeOps } from '../../entities/scene/ops'
import { ContentView } from '../../entities/scene/ui/contentView'
import { EditorBar } from '../../entities/scene/ui/editorBar'
import { FromPhotoDialog } from '../../entities/scene/ui/fromPhoto'
import { Inspector } from '../../entities/scene/ui/inspector'
import { Library, type LibraryTab } from '../../entities/scene/ui/library'
import { Rail } from '../../entities/scene/ui/rail'
import { Stage } from '../../entities/scene/ui/stage'
import { SurfaceTree } from '../../entities/scene/ui/surfaceTree'
import { Timeline } from '../../entities/scene/ui/timeline'
import { activeTestPattern, setupApi, testPatternSecondsLeft, type Setup } from '../../entities/setup'
import { ambientClock, type Show } from '../../entities/show'
import { autoAtlas } from '../../render'
import { Panel, Segmented, useToast } from '../../shared/components'
import { newId } from '../../shared/lib/ids'
import { useChannel, useOwnHub, useServerSecond } from '../../shared/lib/useHub'
import { Hub, HubError } from '../../shared/lib/ws'
import { authToken } from '../../shared/lib/http'
import { authApi, storeToken } from '../../entities/auth'
import s from './styles.module.css'

/** Map tools. L, J, K and S belong to the transport and solo, so line is E (edge) and mask is M. */
const TOOL_KEYS: Record<string, Tool> = { v: 'select', q: 'quad', t: 'tri', p: 'poly', c: 'circle', w: 'mesh', e: 'line', m: 'mask' }
const FRAME = 1 / 30

/** Signs in with a one-time `?login=` link first (an editor on another machine), then opens the editor. */
export function EditorPage({ workspace, timeline }: { workspace: Workspace; timeline?: boolean }) {
  const { login, scene } = useSearch({ strict: false }) as { scene?: string; login?: string }
  const nav = useNavigate()
  const [state, setState] = useState<'ready' | 'signing' | string>(login ? 'signing' : 'ready')
  useEffect(() => {
    if (!login) return
    authApi.login(login, 'laptop editor').then(
      (r) => {
        storeToken(r.token)
        setState('ready')
        nav({ to: '/editor', search: scene ? { scene } : {}, replace: true })
      },
      (e) => setState(`The login link didn't work: ${e instanceof Error ? e.message : e}. Run projmap open again.`),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [login])
  if (state !== 'ready') return <div className={s.gate}>{state === 'signing' ? 'signing in…' : state}</div>
  return <EditorApp workspace={workspace} timeline={timeline} />
}

const mediaKind = (f: File): 'image' | 'video' | null => (f.type.startsWith('video/') ? 'video' : f.type.startsWith('image/') ? 'image' : null)

/** The laptop editor: Map and Content spaces on one screen, a collapsible timeline, and the auto map wizard. */
function EditorApp({ workspace, timeline }: { workspace: Workspace; timeline?: boolean }) {
  const search = useSearch({ strict: false }) as { scene?: string }
  const nav = useNavigate()
  const toast = useToast()
  const hub = useOwnHub(() => new Hub({ role: 'editor', name: 'laptop editor', caps: ['render'], token: authToken() }))
  const show = useChannel<Show>(hub, 'show').doc
  const catalog = useCatalog(hub.welcome?.catalogVersion)
  const [scenes, setScenes] = useState<SceneSummary[]>([])
  const [userEffects, setUserEffects] = useState<EffectDef[]>([])
  const [mode, setMode] = useState<EditMode>('live')
  const [sel, setSel] = useState<Selection>(EMPTY_SELECTION)
  const [tool, setTool] = useState<Tool>('select')
  const [view, setView] = useState<StageView>('output')
  const [reference, setReference] = useState(true)
  const [magnet, setMagnet] = useState(true)
  const [lockCorners, setLockCorners] = useState(true)
  const [mutedTracks, setMuted] = useState<ReadonlySet<string>>(new Set())
  const [previewDraftId, setPreviewDraftId] = useState<string | null>(null)
  const [libTab, setLibTab] = useState<LibraryTab>('effects')
  const [rightTab, setRightTab] = useState<'inspect' | 'agent'>('inspect')
  const [fromPhoto, setFromPhoto] = useState(false)
  const [wallFollows, setWallFollowsState] = useState(false)
  const [solo, setSolo] = useState<string[] | null>(null)
  const [wallSoloFill, setWallSoloFill] = useState<SoloFill>('grid')
  const [timelineOpen, setTimelineOpen] = useState(!!timeline)
  const [faceZoom, setFaceZoom] = useState<string | null>(null)
  const [setupOpen, setSetupOpen] = useState(false)

  const sceneId = search.scene ?? show?.activeSceneId ?? scenes[0]?.id ?? null
  const bad = useCallback((m: string) => toast(m, { bad: true }), [toast])
  const editing = useSceneEditing(hub, sceneId, mode, bad, previewDraftId)
  const scene = editing.scene
  const setupId = scene?.setupId ?? show?.activeSetupId ?? null
  const setup = useChannel<Setup>(hub, setupId ? `setup:${setupId}` : null).doc
  const now = useServerSecond(hub)
  const livePattern = activeTestPattern(setup, now)
  const testGrid = livePattern === 'grid'
  const space: Space = workspace === 'content' ? 'content' : 'map'

  // ── the editor preview clock; the wall follows it only when asked ─────────
  const follow = useRef({ on: false, mode, draftId: null as string | null })
  follow.current = { on: wallFollows, mode, draftId: editing.draft?.id ?? null }
  const preview = usePreviewClock(scene?.timeline.duration ?? 20, (kind, t) => {
    const f = follow.current
    if (!f.on) return
    const send = (name: string, args: Record<string, unknown> = {}) => hub.cmd(name, args).catch((e) => bad(e instanceof HubError ? e.message : String(e)))
    if (f.mode === 'backstage' && f.draftId) {
      void send('show.preview', { draftId: f.draftId, t, play: kind === 'play' || (kind === 'seek' && previewRef.current.playing) })
      return
    }
    if (kind === 'play') void send('show.seek', { t }).then(() => send('show.play'))
    else if (kind === 'pause') void send('show.pause').then(() => send('show.seek', { t }))
    else void send('show.seek', { t })
  })
  const previewRef = useRef(preview)
  previewRef.current = preview
  const setWallFollows = useCallback(
    (v: boolean) => {
      setWallFollowsState(v)
      follow.current.on = v
      if (!v) return
      // line the wall up with the editor at once
      const p = previewRef.current
      const t = p.t()
      if (mode === 'backstage' && editing.draft) void hub.cmd('show.preview', { draftId: editing.draft.id, t, play: p.playing }).catch(() => {})
      else void hub.cmd('show.seek', { t }).then(() => hub.cmd(p.playing ? 'show.play' : 'show.pause')).catch(() => {})
    },
    [hub, mode, editing.draft],
  )

  const reloadScenes = useCallback(() => {
    sceneApi.list().then(setScenes, () => {})
  }, [])
  const reloadEffects = useCallback(() => {
    effectApi.list().then(setUserEffects, () => {})
  }, [])
  useEffect(() => {
    reloadScenes()
    reloadEffects()
  }, [reloadScenes, reloadEffects, hub.status])
  useEffect(() => {
    if (scene && !scenes.some((x) => x.id === scene.id)) reloadScenes()
  }, [scene, scenes, reloadScenes])

  useEffect(() => {
    document.title = scene ? `${scene.name} · projector map` : 'projector map'
  }, [scene])

  // the editor renders frames, faces and unfolds for agents too (cap "render")
  useEffect(() => handleRenderRpcs(hub, () => ambientClock(hub)), [hub])

  const effects = useMemo(() => [...(catalog?.effects ?? []), ...userEffects.filter((u) => !catalog?.effects.some((b) => b.id === u.id))], [catalog, userEffects])

  const command = useCallback(
    async (name: string, args: Record<string, unknown> = {}) => {
      try {
        return await hub.cmd(name, args)
      } catch (e) {
        bad(e instanceof HubError ? e.message : String(e))
        return undefined
      }
    },
    [hub, bad],
  )

  const setTestPattern = useCallback(
    (pattern: Setup['testPattern']) => {
      if (!setup) return
      hub.cmd('setup.testPattern', { setupId: setup.id, pattern, seconds: 60 }).catch(() => setupApi.update(setup.id, { testPattern: pattern }).catch((e) => bad(String(e.message ?? e))))
    },
    [hub, setup, bad],
  )
  const setTestGrid = useCallback((v: boolean) => setTestPattern(v ? 'grid' : 'off'), [setTestPattern])
  const setSceneMode = useCallback(
    (m: SceneMode) => {
      if (!scene || scene.mode === m) return
      void editing.edit(() => setModeOps(m))
    },
    [scene, editing],
  )

  const goWorkspace = useCallback(
    (w: Workspace, id: string | null = sceneId) => nav({ to: '/editor/$space', params: { space: w }, search: id ? { scene: id } : {} }),
    [nav, sceneId],
  )
  const setSpace = useCallback((sp: Space) => goWorkspace(sp), [goWorkspace])

  const openScene = useCallback(
    (id: string) => {
      setSel(EMPTY_SELECTION)
      setPreviewDraftId(null)
      setFaceZoom(null)
      setSolo(null)
      goWorkspace(workspace, id)
    },
    [goWorkspace, workspace],
  )

  const select = useCallback((patch: Partial<Selection>) => setSel((cur) => ({ ...cur, ...patch })), [])
  const toggleTrack = useCallback((id: string) => setMuted((cur) => {
    const n = new Set(cur)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  }), [])

  // the object the content space shows: the selected one, or the first with faces
  const contentObjectId = useMemo(() => {
    if (!scene) return null
    if (sel.objectId && scene.objects.some((o) => o.id === sel.objectId)) return sel.objectId
    if (sel.surfaceId) {
      const o = scene.objects.find((x) => x.surfaces.some((y) => y.id === sel.surfaceId))
      if (o) return o.id
    }
    return scene.objects.find((o) => o.surfaces.some((x) => x.role === 'face' && x.kind !== 'line' && x.kind !== 'mask'))?.id ?? null
  }, [scene, sel.objectId, sel.surfaceId])

  // the face zoom follows the scene: a deleted face drops back to the unfold
  useEffect(() => {
    if (faceZoom && scene && !locateSurface(scene, faceZoom)) setFaceZoom(null)
  }, [faceZoom, scene])

  const editFace = useCallback(
    (surfaceId: string) => {
      const owner = scene?.objects.find((o) => o.surfaces.some((x) => x.id === surfaceId))
      setSel((c) => ({ ...c, surfaceId, objectId: owner?.id ?? c.objectId, pointId: null, meshIndex: null, focus: 'surface' }))
      setFaceZoom(surfaceId)
      if (workspace !== 'content') goWorkspace('content')
    },
    [scene, workspace, goWorkspace],
  )

  /** The surfaces a solo of the selection covers: the surface, or every surface of the object. */
  const selectionIds = useCallback((): string[] => {
    if (!scene) return []
    if (sel.surfaceId && sel.focus !== 'object') return [sel.surfaceId]
    const oid = sel.objectId ?? (faceZoom ? scene.objects.find((o) => o.surfaces.some((x) => x.id === faceZoom))?.id : null)
    const obj = scene.objects.find((o) => o.id === oid)
    return obj ? obj.surfaces.filter((x) => x.kind !== 'line' && x.kind !== 'mask').map((x) => x.id) : []
  }, [scene, sel, faceZoom])

  const soloSelection = useCallback(
    (wall: boolean) => {
      const ids = selectionIds()
      if (!ids.length) return bad('Select a surface or an object to solo it.')
      setSolo(ids)
      if (wall) {
        void command('show.solo', { surfaceIds: ids, fill: wallSoloFill, seconds: 60 }).then((r) => r !== undefined && toast(`Solo on the wall for 60 s (${wallSoloFill}). Esc ends it.`))
      }
    },
    [selectionIds, bad, command, wallSoloFill, toast],
  )
  const clearSolo = useCallback(() => {
    setSolo(null)
    if (show?.solo?.surfaceIds?.length) void command('show.solo', { surfaceIds: [] })
  }, [show, command])

  const addMedia = useCallback(
    async (files: File[], owner: { kind: 'surface' | 'object'; id: string }, opts: { fit?: 'fill' | 'fit' | 'stretch'; name?: string } = {}) => {
      if (!scene) return
      for (const f of files) {
        const kind = mediaKind(f)
        if (!kind) {
          bad(`${f.name || 'That file'} is not a picture or a video.`)
          continue
        }
        try {
          const a = await assetApi.upload(f, 'photo', f.name || (kind === 'video' ? 'clip.mp4' : 'picture.png'))
          const layer = mediaLayer(newId('cl'), `asset:${a.sha}`, opts.name ?? (f.name ? f.name.replace(/\.[a-z0-9]+$/i, '') : kind), kind, opts.fit ?? 'fill')
          await editing.edit((sc) => {
            const ops = addContentLayer(sc, owner, layer)
            // an object layer pins the atlas so the artwork stays put when the mapping moves
            const obj = owner.kind === 'object' ? sc.objects.find((o) => o.id === owner.id) : null
            if (ops && obj && !obj.atlas) ops.unshift(...(setAtlas(sc, obj.id, autoAtlas(sc, obj)) ?? []))
            return ops
          })
          setSel((c) => ({ ...c, contentLayerId: layer.id, focus: 'content' }))
          toast(owner.kind === 'object' ? 'Added the picture across the object.' : 'Added the picture to the face.')
        } catch (e) {
          bad(`The upload failed: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    },
    [scene, editing, bad, toast],
  )

  const state: EditorState = {
    hub,
    workspace,
    catalog,
    effects,
    userEffects,
    reloadEffects,
    show,
    setup,
    scenes,
    reloadScenes,
    sceneId,
    openScene,
    editing,
    mode,
    setMode,
    scene,
    sel,
    select,
    tool,
    setTool,
    view,
    setView,
    reference,
    setReference,
    magnet,
    setMagnet,
    testGrid,
    setTestGrid,
    lockCorners,
    setLockCorners,
    mutedTracks,
    toggleTrack,
    previewDraftId,
    setPreviewDraftId,
    loop: preview.loop,
    setLoop: preview.setLoop,
    toast,
    command,
    openFromPhoto: () => setFromPhoto(true),
    sceneMode: scene?.mode ?? 'static',
    setSceneMode,
    testPattern: { pattern: livePattern, secondsLeft: testPatternSecondsLeft(setup, now) },
    setTestPattern,
    space,
    setSpace,
    preview,
    wallFollows,
    setWallFollows,
    solo,
    soloSelection,
    clearSolo,
    wallSoloFill,
    setWallSoloFill,
    timelineOpen,
    setTimelineOpen,
    contentObjectId,
    faceZoom,
    setFaceZoom,
    editFace,
    setupOpen,
    setSetupOpen,
    addMedia,
  }

  // ── global keys: spaces, transport, solo, tools, undo/redo, delete ─────────
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return
      if (e.defaultPrevented) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (!sceneId) return
        if (mode === 'backstage') return bad('Undo works on the live scene. Discard the draft to start over.')
        ;(e.shiftKey ? sceneApi.redo(sceneId) : sceneApi.undo(sceneId)).catch((err) => bad(String(err.message ?? err)))
        return
      }
      if (mod || e.altKey || workspace === 'automap') return
      const k = e.key.toLowerCase()
      if (e.key === 'Tab') {
        e.preventDefault()
        setSpace(space === 'map' ? 'content' : 'map')
        return
      }
      if (e.key === ' ') {
        e.preventDefault()
        preview.toggle()
        return
      }
      if (e.key === 'Home') {
        e.preventDefault()
        preview.seek(0)
        return
      }
      if (k === 'l') return preview.setLoop(!preview.loop)
      if (k === 'j' || k === 'k') return preview.step((k === 'j' ? -1 : 1) * (e.shiftKey ? 1 : FRAME))
      if (k === 's') {
        e.preventDefault()
        if (solo && !e.shiftKey) return clearSolo()
        return soloSelection(e.shiftKey)
      }
      if (e.key === 'Escape' && (solo || show?.solo?.surfaceIds?.length)) {
        clearSolo()
        return
      }
      if (k === 'f') {
        const sid = sel.surfaceId ?? (scene && sel.objectId ? scene.objects.find((o) => o.id === sel.objectId)?.surfaces.find((x) => x.role === 'face' && x.kind !== 'line' && x.kind !== 'mask')?.id : null)
        if (sid) editFace(sid)
        else bad('Select a face to edit it.')
        return
      }
      const tk = TOOL_KEYS[k]
      if (tk && space === 'map' && !e.shiftKey) {
        setTool(tk)
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && scene) {
        if (sel.focus === 'content' && sel.contentLayerId) {
          const id = sel.contentLayerId
          void editing.edit((sc) => removeContentLayer(sc, id))
          setSel((c) => ({ ...c, contentLayerId: null, focus: c.surfaceId ? 'surface' : null }))
        } else if (sel.focus === 'clip' && sel.clipId) {
          const id = sel.clipId
          void editing.edit((sc) => removeClip(sc, id))
          setSel((c) => ({ ...c, clipId: null, focus: null }))
        } else if (sel.focus === 'layer' && sel.layerId) {
          const id = sel.layerId
          void editing.edit((sc) => removeLayer(sc, id))
          setSel((c) => ({ ...c, layerId: null, focus: null }))
        } else if (space === 'map' && sel.focus === 'surface' && sel.surfaceId && !sel.pointId) {
          const id = sel.surfaceId
          void editing.edit((sc) => deleteSurface(sc, id))
          setSel((c) => ({ ...c, surfaceId: null, focus: null }))
        } else if (space === 'map' && sel.focus === 'object' && sel.objectId) {
          const id = sel.objectId
          void editing.edit((sc) => deleteObject(sc, id))
          setSel((c) => ({ ...c, objectId: null, focus: null }))
        }
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [sceneId, mode, workspace, space, setSpace, show, scene, sel, editing, bad, preview, solo, soloSelection, clearSolo, editFace])

  // ── auto map ───────────────────────────────────────────────────────────────
  const cam = useCamera(hub, workspace === 'automap')
  const calib = useCalibration(hub, setup?.id ?? null, setup?.calibrationId ?? null)
  const autoState: AutoMapState = {
    frame: cam.frame,
    status: cam.status,
    frameAt: cam.at,
    calib,
    agentRunning: false,
    agentDone: !!editing.draft && editing.draft.status === 'applied',
  }

  const tlRow = workspace === 'automap' ? 80 : timelineOpen ? 300 : 52
  const agentPanel = (
    <AgentPanel hub={hub} sceneId={sceneId} onError={bad} onNotice={(m) => toast(m)} previewDraftId={previewDraftId} onPreviewDraft={setPreviewDraftId} />
  )

  return (
    <EditorContext.Provider value={state}>
      <main className={s.ed} style={{ gridTemplateRows: `46px minmax(0, 1fr) ${tlRow}px` }} data-testid="editor" data-space={workspace}>
        <EditorBar />
        {workspace === 'automap' ? (
          <>
            <Panel as="aside" aria-label="auto map steps">
              <AutoMapPanel st={autoState} />
            </Panel>
            <AutoMapStage st={autoState} />
            <Panel as="aside" aria-label="agent" className={s.insp}>
              {agentPanel}
            </Panel>
            <AutoMapSteps st={autoState} />
          </>
        ) : (
          <>
            <Panel as="aside" aria-label="surfaces and library" className={s.left}>
              <Rail />
              <SurfaceTree />
              <Library tab={libTab} onTab={setLibTab} />
            </Panel>
            {space === 'map' ? <Stage /> : <ContentView />}
            <Panel as="aside" aria-label="inspector" className={s.insp}>
              <div className={s.rightTabs}>
                <Segmented
                  ariaLabel="right panel"
                  size="sm"
                  value={rightTab}
                  onChange={setRightTab}
                  options={[
                    { value: 'inspect', label: 'inspect' },
                    { value: 'agent', label: 'agent' },
                  ]}
                />
              </div>
              <div className={s.inspBody}>{rightTab === 'inspect' ? <Inspector /> : agentPanel}</div>
            </Panel>
            <Timeline />
          </>
        )}
      </main>
      {fromPhoto && (
        <FromPhotoDialog
          onClose={() => setFromPhoto(false)}
          onCreated={(sc, position) => {
            setFromPhoto(false)
            reloadScenes()
            toast(position === 'anywhere' ? 'Scene created. Run a quick calibration in auto map next.' : 'Scene created from the photo.')
            nav({ to: '/editor/$space', params: { space: position === 'anywhere' ? 'automap' : 'map' }, search: { scene: sc.id } })
          }}
        />
      )}
    </EditorContext.Provider>
  )
}
