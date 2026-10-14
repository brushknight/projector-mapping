import { LivePreview as WallLivePreview } from '../../../output/ui/livePreview'
import { useShow } from './context'

/** The Show space's big preview: exactly what the projector shows (the engine's live preview, YouTube included). */
export function LivePreview({ className }: { className?: string }) {
  const sh = useShow()
  return (
    <div className={className}>
      <WallLivePreview hub={sh.hub} maxWidth={1600} data-testid="show-live-preview" />
    </div>
  )
}
