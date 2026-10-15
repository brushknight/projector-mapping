import { useSearch } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useCatalog } from '../../entities/catalog'
import type { EffectDef } from '../../entities/effect'
import { effectApi } from '../../entities/effect'
import { FrameMeter, FullscreenHint, handleRenderRpcs, useFullscreenControls, useWallDocs } from '../../entities/output'
import { PairingScreen } from '../../entities/pairing'
import { activeSolo, ambientClock, playheadNow, showAudio, useBlackout } from '../../entities/show'
import { activeTestPattern, sceneSize } from '../../entities/setup'
import { useAudioClient } from '../../entities/sound/audioHooks'
import { YouTubeBackdrop } from '../../entities/video/youtube'
import { activeYouTube, Renderer, warmPlateMasks, type OutlineFlash, type OutputPattern } from '../../render'
import { youtubeVolume } from '../../render/youtube'
import { Icon } from '../../shared/components'
import { setAuthToken } from '../../shared/lib/http'
import { useHubStatus, useOwnHub } from '../../shared/lib/useHub'
import { useReloadOnNewBuild } from '../../shared/lib/reloadOnNewBuild'
import { useRaf } from '../../shared/lib/useRaf'
import { Hub } from '../../shared/lib/ws'
import s from './styles.module.css'

const SPLASH_MS = 8000

/**
 * The projector output: a fullscreen canvas at device pixels, role `output`. Shows the pairing screen while
 * disconnected, while no scene is active, and for a few seconds after load (skip with ?headless or a click).
 * It is the default audio output (§14, caps render + audio): until the browser lets it play sound it shows
 * "click to enable sound" (not with ?headless). A YouTube video layer plays in a player behind the canvas.
 */
/** (§18) a calibration pattern stays at most this long without a new output.pattern */
const PATTERN_TTL_MS = 15000

export function OutPage() {
  const { headless, token } = useSearch({ from: '/out' })
  // localhost is trusted; a mini PC by the projector passes its device token as ?token=
  const hub = useOwnHub(() => {
    if (token) setAuthToken(token)
    return new Hub({ role: 'output', name: 'projector output', caps: ['render', 'audio'], token: token ?? null })
  })
  useReloadOnNewBuild(hub)
  const status = useHubStatus(hub)
  // an agent's draft previewed on the wall (backend §9 show.preview) replaces the live scene while it lasts
  const { show, setup, scene } = useWallDocs(hub)
  // §14: the projector plays every sound while show.audio.output is "projector"
  const audio = useAudioClient(hub, { role: 'output' })
  const catalog = useCatalog(hub.welcome?.catalogVersion)
  const [effects, setEffects] = useState<EffectDef[]>([])
  const [splash, setSplash] = useState(!headless)
  // §17: the first click (the same one that enables sound) goes full screen; double-click and F toggle it, Esc leaves
  const fs = useFullscreenControls({ hints: !headless })
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const renderer = useRef<Renderer | null>(null)
  const pattern = useRef<OutputPattern | null>(null)
  const outline = useRef<(OutlineFlash & { until: number }) | null>(null)
  const waiters = useRef<Array<{ frames: number; done: () => void }>>([])
  const meter = useRef(new FrameMeter())
  const blackout = useBlackout(show?.onAir, setup?.blackoutFadeMs)
  const [glError, setGlError] = useState<string | null>(null)
  const [patternOn, setPatternOn] = useState(false)
  // (§18) when the last output.pattern RPC arrived: a calibration pattern left behind by a server that died is dropped
  const patternAt = useRef(0)
  const [ytBlocked, setYtBlocked] = useState(false)
  const [ytRetry, setYtRetry] = useState(0)
  const latest = useRef({ show, scene, setup, catalog, effects, videoVolume: 0 })
  latest.current = { show, scene, setup, catalog, effects, videoVolume: audio.masterGain }

  // the WebGL2 renderer, sized to the device pixels of the window
  useEffect(() => {
    const canvas = canvasRef.current!
    try {
      renderer.current = new Renderer(canvas, { space: 'physical', preserveDrawingBuffer: true, transparent: true, hold: true })
    } catch (e) {
      setGlError(e instanceof Error ? e.message : String(e))
      return
    }
    const size = () => {
      const dpr = window.devicePixelRatio || 1
      renderer.current?.setSize(Math.round(window.innerWidth * dpr), Math.round(window.innerHeight * dpr))
    }
    size()
    window.addEventListener('resize', size)
    return () => {
      window.removeEventListener('resize', size)
      renderer.current?.dispose()
      renderer.current = null
    }
  }, [])

  // (§16 masks) warm the plate masks at idle (the small size stands in while a picked plate's full mask decodes)
  useEffect(() => {
    const a = warmPlateMasks(1024)
    const b = warmPlateMasks(4096)
    return () => {
      a()
      b()
    }
  }, [])

  // user and agent effects
  useEffect(() => {
    if (status !== 'open') return
    effectApi.list().then(setEffects, () => {})
  }, [status, scene?.id, scene?.version])

  useEffect(() => {
    if (!splash) return
    const t = setTimeout(() => setSplash(false), SPLASH_MS)
    return () => clearTimeout(t)
  }, [splash])

  // server → output RPCs
  useEffect(() => {
    const afterFrames = (n: number) => new Promise<void>((done) => waiters.current.push({ frames: n, done }))
    const offs = [
      hub.handleRpc('output.pattern', async (args) => {
        const kind = String(args.kind)
        if (kind === 'off') pattern.current = null
        else if (kind === 'gray') pattern.current = { kind: 'gray', axis: args.axis === 'y' ? 'y' : 'x', bit: Number(args.bit) | 0, inverse: !!args.inverse }
        else if (kind === 'white' || kind === 'black') pattern.current = { kind }
        else throw new Error(`Unknown pattern ${kind}.`)
        patternAt.current = performance.now()
        setPatternOn(!!pattern.current)
        await afterFrames(3)
        const r = renderer.current
        return { presented: true, width: r?.canvas.width ?? 0, height: r?.canvas.height ?? 0 }
      }),
      hub.handleRpc('output.outline', async (args) => {
        const ms = Number(args.ms ?? 1500)
        // outlines of another scene (the editor maps a scene that is not on the wall; a duplicate shares its surface
        // ids) would draw this scene's faces and look like they do not follow the drag
        const onWall = latest.current.scene?.id
        if (typeof args.sceneId === 'string' && onWall && args.sceneId !== onWall) {
          outline.current = null
          return { presented: false, reason: 'another scene is on the wall' }
        }
        outline.current = {
          surfaceIds: Array.isArray(args.surfaceIds) ? (args.surfaceIds as string[]) : [],
          color: typeof args.color === 'string' ? args.color : '#ffffff',
          width: Number(args.width ?? 2),
          until: performance.now() + ms,
        }
        await afterFrames(1)
        return { presented: true }
      }),
      handleRenderRpcs(hub, () => ambientClock(hub)),
    ]
    return () => offs.forEach((f) => f())
  }, [hub])

  // (§18) drop a calibration or aiming pattern 15 s after the last output.pattern, and at once when the hub drops:
  // the server renews aiming every 5 s and a calibration sends a pattern every second or two
  useEffect(() => {
    const clear = () => {
      if (!pattern.current) return
      pattern.current = null
      setPatternOn(false)
    }
    if (status !== 'open') {
      clear()
      return
    }
    const id = setInterval(() => {
      if (pattern.current && performance.now() - patternAt.current > PATTERN_TTL_MS) clear()
    }, 1000)
    return () => clearInterval(id)
  }, [status])

  // telemetry every 2 s
  useEffect(() => {
    const id = setInterval(() => {
      const r = renderer.current
      const { fps, dropped } = meter.current.take(2)
      hub.telemetry({ fps, dropped, width: r?.canvas.width ?? 0, height: r?.canvas.height ?? 0, refresh: meter.current.refresh() })
    }, 2000)
    return () => clearInterval(id)
  }, [hub])

  // keep the screen awake
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
    const get = () => {
      if (document.visibilityState === 'visible' && nav.wakeLock) nav.wakeLock.request('screen').then((l) => (lock = l), () => {})
    }
    get()
    document.addEventListener('visibilitychange', get)
    return () => {
      document.removeEventListener('visibilitychange', get)
      lock?.release().catch(() => {})
    }
  }, [])

  useRaf((now) => {
    const r = renderer.current
    meter.current.tick(now)
    const L = latest.current
    if (r && L.setup) {
      if (outline.current && outline.current.until < now) outline.current = null
      r.render({
        setup: L.setup,
        scene: L.scene,
        catalog: L.catalog,
        effects: L.effects,
        t: playheadNow(hub, L.show),
        step: L.show?.transport.step ?? null,
        clock: ambientClock(hub),
        now: hub.serverNow(),
        blackout: blackout.step(now),
        pattern: pattern.current,
        outline: outline.current,
        testPattern: activeTestPattern(L.setup, hub.serverNow()),
        // an agent previews its mapping: show the objects whatever mode the scene has on air
        mode: L.show?.preview?.draftId ? 'objects' : null,
        // a solo from the editor (protocol §12): only those faces, over black
        solo: activeSolo(L.show, hub.serverNow()),
        // §14: a video layer's own sound, at volume × master, once the browser allows sound
        videoVolume: L.videoVolume,
      })
    } else if (r && pattern.current) {
      // calibration still works before a setup arrives
      r.render({
        setup: { id: '', name: '', output: { width: r.canvas.width, height: r.canvas.height, orientation: 'landscape', flipH: false, flipV: false }, master: 1, blackoutFadeMs: 0, testPattern: 'off', referenceAsset: null, calibrationId: null },
        scene: null,
        catalog: null,
        t: 0,
        clock: 0,
        blackout: 1,
        pattern: pattern.current,
      })
    }
    // frames are presented on the next vsync; count them down for the RPCs that wait
    if (waiters.current.length) {
      waiters.current = waiters.current.filter((w) => {
        w.frames--
        if (w.frames <= 0) {
          w.done()
          return false
        }
        return true
      })
    }
  })

  const idle = status !== 'open' || !show?.activeSceneId || !scene
  const showPairing = !patternOn && (idle || splash) && !headless
  const youtube = patternOn ? null : activeYouTube(scene, { mode: show?.preview?.draftId ? 'objects' : null, solo: activeSolo(show, hub.serverNow()) })
  // (§16) the YouTube layer's sound plays here when this page is the audio output client
  const ytVolume = youtubeVolume(youtube, audio.masterGain)
  const needsClick = !headless && status === 'open' && showAudio(show).output === 'projector' && (!audio.unlocked || ytBlocked)
  return (
    <div
      className={s.out}
      data-idle={fs.idle}
      onClick={() => {
        setSplash(false)
        void audio.unlock()
        // a click lets the browser play the YouTube player's sound: try unmuting it again
        setYtRetry((n) => n + 1)
      }}
      data-testid="out"
    >
      {setup && <YouTubeBackdrop active={youtube} scene={sceneSize(setup.output)} output={setup.output} volume={ytVolume} onSoundBlocked={setYtBlocked} retry={ytRetry} />}
      <canvas ref={canvasRef} className={s.canvas} data-testid="out-canvas" />
      {showPairing && <PairingScreen connected={status === 'open'} status={show?.activeSceneId ? 'connected · scene ready' : 'connected · no scene yet'} />}
      {needsClick && (
        <button type="button" className={s.sound} onClick={() => void audio.unlock()} data-testid="enable-sound">
          <Icon name="speakerOff" size={16} />
          click to enable sound
        </button>
      )}
      <FullscreenHint small show={fs.hint} />
      {status !== 'open' && !showPairing && (
        <div
          data-testid="out-reconnecting"
          style={{ position: 'fixed', right: 12, bottom: 10, font: '12px "Share Tech Mono", monospace', color: '#8C8A85', pointerEvents: 'none' }}
        >
          reconnecting to projmap…
        </div>
      )}
      {glError && <div className={s.error}>This browser can't draw the output: {glError}</div>}
    </div>
  )
}
