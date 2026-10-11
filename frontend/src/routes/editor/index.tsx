import { useNavigate, useSearch } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AgentPanel } from '../../entities/agent'
import { AutoMapPanel, AutoMapStage, AutoMapSteps, useCalibration, type AutoMapState } from '../../entities/calibration'
import { useCamera } from '../../entities/camera'
import { useCatalog } from '../../entities/catalog'
import { effectApi, type EffectDef } from '../../entities/effect'
import { renderFrameRpc, type RenderFrameArgs } from '../../entities/output'
import { sceneApi, useSceneEditing, type EditMode, type SceneMode, type SceneSummary } from '../../entities/scene'
import { EditorContext, EMPTY_SELECTION, type EditorState, type FlatView, type Selection, type StageView, type Tool, type Workspace } from '../../entities/scene/editor/context'
import { deleteObject, deleteSurface, removeClip, removeLayer, setMode as setModeOps } from '../../entities/scene/ops'
import { EditorBar } from '../../entities/scene/ui/editorBar'
import { FromPhotoDialog } from '../../entities/scene/ui/fromPhoto'
import { Inspector } from '../../entities/scene/ui/inspector'
import { Library, type LibraryTab } from '../../entities/scene/ui/library'
import { Stage } from '../../entities/scene/ui/stage'
import { SurfaceTree } from '../../entities/scene/ui/surfaceTree'
import { Timeline } from '../../entities/scene/ui/timeline'
import { activeTestPattern, setupApi, testPatternSecondsLeft, type Setup } from '../../entities/setup'
import { ambientClock, type Show } from '../../entities/show'
import { Panel, Segmented, useToast } from '../../shared/components'
import { useChannel, useOwnHub, useServerSecond } from '../../shared/lib/useHub'
import { Hub, HubError } from '../../shared/lib/ws'
import { authToken } from '../../shared/lib/http'
import { authApi, storeToken } from '../../entities/auth'
import s from './styles.module.css'

const TOOL_KEYS: Record<string, Tool> = { v: 'select', q: 'quad', t: 'tri', p: 'poly', c: 'circle', w: 'mesh', l: 'line', k: 'mask' }

/** Signs in with a one-time `?login=` link first (an editor on another machine), then opens the editor. */
export function EditorPage({ workspace }: { workspace: Workspace }) {
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
  return <EditorApp workspace={workspace} />
}

/** The laptop editor: map, animate and auto map workspaces around one shared editing model. */
function EditorApp({ workspace }: { workspace: Workspace }) {
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
  const [loop, setLoop] = useState(false)
  const [libTab, setLibTab] = useState<LibraryTab>('effects')
  const [rightTab, setRightTab] = useState<'inspect' | 'agent'>('inspect')
  const [fromPhoto, setFromPhoto] = useState(false)
  const [flat, setFlat] = useState<FlatView | null>(null)
  const [coach, setCoach] = useState(true)

  const sceneId = search.scene ?? show?.activeSceneId ?? scenes[0]?.id ?? null
  const bad = useCallback((m: string) => toast(m, { bad: true }), [toast])
  const editing = useSceneEditing(hub, sceneId, mode, bad, previewDraftId)
  const scene = editing.scene
  const setupId = scene?.setupId ?? show?.activeSetupId ?? null
  const setup = useChannel<Setup>(hub, setupId ? `setup:${setupId}` : null).doc
  const now = useServerSecond(hub)
  const livePattern = activeTestPattern(setup, now)
  const testGrid = livePattern === 'grid'

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

  // the editor can render frames for agents too (cap "render")
  useEffect(() => hub.handleRpc('render.frame', (args) => renderFrameRpc(args as unknown as RenderFrameArgs, ambientClock(hub))), [hub])

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

  const openScene = useCallback(
    (id: string) => {
      setSel(EMPTY_SELECTION)
      setPreviewDraftId(null)
      nav({ to: workspace === 'map' ? '/editor/map' : workspace === 'animate' ? '/editor/animate' : '/editor/automap', search: { scene: id } })
    },
    [nav, workspace],
  )

  const select = useCallback((patch: Partial<Selection>) => setSel((cur) => ({ ...cur, ...patch })), [])
  const toggleTrack = useCallback((id: string) => setMuted((cur) => {
    const n = new Set(cur)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  }), [])

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
    loop,
    setLoop,
    toast,
    command,
    openFromPhoto: () => setFromPhoto(true),
    sceneMode: scene?.mode ?? 'static',
    setSceneMode,
    testPattern: { pattern: livePattern, secondsLeft: testPatternSecondsLeft(setup, now) },
    setTestPattern,
    flat,
    openFlat: (surfaceId: string) => {
      const owner = scene?.objects.find((o) => o.surfaces.some((x) => x.id === surfaceId))
      setFlat({ kind: 'surface', surfaceId, objectId: owner?.id ?? null })
      setSel((c) => ({ ...c, surfaceId, objectId: owner?.id ?? c.objectId, focus: 'surface' }))
    },
    openUnfold: (objectId: string) => setFlat({ kind: 'unfold', objectId }),
    closeFlat: () => setFlat(null),
    coach,
    setCoach,
  }

  // ── global keys: tools, undo/redo, play/pause, delete ──────────────────────
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (!sceneId) return
        if (mode === 'backstage') return bad('Undo works on the live scene. Discard the draft to start over.')
        ;(e.shiftKey ? sceneApi.redo(sceneId) : sceneApi.undo(sceneId)).catch((err) => bad(String(err.message ?? err)))
        return
      }
      if (mod || e.altKey) return
      const tk = TOOL_KEYS[e.key.toLowerCase()]
      if (tk && workspace !== 'automap') {
        setTool(tk)
        return
      }
      if (e.key === ' ') {
        e.preventDefault()
        void command(show?.transport.state === 'playing' ? 'show.pause' : 'show.play')
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && scene) {
        if (sel.focus === 'clip' && sel.clipId) {
          const id = sel.clipId
          void editing.edit((sc) => removeClip(sc, id))
          setSel((c) => ({ ...c, clipId: null, focus: null }))
        } else if (sel.focus === 'layer' && sel.layerId) {
          const id = sel.layerId
          void editing.edit((sc) => removeLayer(sc, id))
          setSel((c) => ({ ...c, layerId: null, focus: null }))
        } else if (sel.focus === 'surface' && sel.surfaceId && !sel.pointId) {
          const id = sel.surfaceId
          void editing.edit((sc) => deleteSurface(sc, id))
          setSel((c) => ({ ...c, surfaceId: null, focus: null }))
        } else if (sel.focus === 'object' && sel.objectId) {
          const id = sel.objectId
          void editing.edit((sc) => deleteObject(sc, id))
          setSel((c) => ({ ...c, objectId: null, focus: null }))
        }
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [sceneId, mode, workspace, show, scene, sel, editing, command, bad])

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

  const tlRow = workspace === 'animate' ? 380 : workspace === 'automap' ? 80 : 262
  const agentPanel = (
    <AgentPanel hub={hub} sceneId={sceneId} onError={bad} onNotice={(m) => toast(m)} previewDraftId={previewDraftId} onPreviewDraft={setPreviewDraftId} />
  )

  return (
    <EditorContext.Provider value={state}>
      <main className={s.ed} style={{ gridTemplateRows: `42px minmax(0, 1fr) ${tlRow}px` }} data-testid="editor">
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
            <Panel as="aside" aria-label="surfaces and library">
              <SurfaceTree />
              <Library tab={libTab} onTab={setLibTab} />
            </Panel>
            <Stage />
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
            nav({ to: position === 'anywhere' ? '/editor/automap' : '/editor/map', search: { scene: sc.id } })
          }}
        />
      )}
    </EditorContext.Provider>
  )
}
