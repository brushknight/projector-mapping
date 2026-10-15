import { useCallback } from 'react'
import { withTrialLayer } from '../../../catalog/liveTry'
import { withStaticTrial } from '../../../catalog/staticTry'
import { LivePreview as WallLivePreview } from '../../../output/ui/livePreview'
import type { Scene } from '../../../scene/types'
import { useAudioUnlocked } from '../../../sound/audioHooks'
import { showAudio } from '../../types'
import { useShow } from './context'

/** The Show space's big preview: exactly what the projector shows (the engine's live preview, YouTube included). */
export function LivePreview({ className }: { className?: string }) {
  const sh = useShow()
  // (§16) while show.audio.output is "editor" the editor is the audio output: its wall preview plays the video layers' sound
  const unlocked = useAudioUnlocked()
  const audio = showAudio(sh.show)
  const videoVolume = audio.output === 'editor' && unlocked && !audio.muted ? audio.volume : 0
  // (§16) a try draws the wall's scene with the tried layer or attachment, here only; the wall does not change
  const { trying, staticTry, catalog } = sh
  const override = useCallback(
    (wall: Scene) => {
      if (staticTry) return withStaticTrial(wall, catalog, staticTry)
      if (trying) return withTrialLayer(wall, catalog, trying)
      return wall
    },
    [trying, staticTry, catalog],
  )
  return (
    <div className={className}>
      {/* (§16) 60 fps: a drag (slide, focus) shows the frame after it lands, never a 30 fps step later */}
      <WallLivePreview hub={sh.hub} maxWidth={1600} fps={60} videoVolume={videoVolume} sceneOverride={trying || staticTry ? override : null} data-testid="show-live-preview" />
    </div>
  )
}
