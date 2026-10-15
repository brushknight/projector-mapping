import { useMemo } from 'react'
import { Cap } from '../../../../shared/components'
import { useEditor } from '../../editor/context'
import { faceHasContent, miniMap } from './model'
import s from './styles.module.css'

/**
 * "Where am I": the object's faces outlined as they sit on the stage, the face you edit bright, faces with content
 * lightly filled. Clicking a face opens it; clicking around the faces goes back to all faces.
 */
export function MiniMap({ objectId, current }: { objectId: string; current: string | null }) {
  const ed = useEditor()
  const scene = ed.scene!
  const obj = scene.objects.find((o) => o.id === objectId)
  const map = useMemo(() => (obj ? miniMap(scene, obj) : null), [scene, obj])
  if (!obj || !map) return null
  const { box } = map
  const W = 196
  const H = Math.max(70, Math.min(160, Math.round((W * box.h) / box.w)))
  const curFace = current ? obj.surfaces.find((x) => x.id === current) : null
  return (
    <div className={s.mini} data-testid="minimap" data-tour="content-minimap">
      <div className={s.miniHead}>
        <Cap>where you are</Cap>
        <span className={s.miniName}>{curFace ? curFace.name : 'all faces'}</span>
      </div>
      <svg
        className={s.miniSvg}
        width={W}
        height={H}
        viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`${obj.name} on the stage${curFace ? `, ${curFace.name} highlighted` : ''}`}
        onClick={(e) => {
          if (e.target === e.currentTarget && current) {
            ed.setFaceZoom(null)
            ed.select({ objectId, surfaceId: null, contentLayerId: null, focus: 'object' })
          }
        }}
      >
        {map.faces.map((f) => {
          const on = f.id === current
          const full = faceHasContent(scene, f.id)
          return (
            <polygon
              key={f.id}
              points={f.pts.map((p) => `${p.x},${p.y}`).join(' ')}
              className={`${s.miniFace} ${f.detail ? s.miniDetail : ''} ${full ? s.miniFull : ''} ${on ? s.miniOn : ''}`}
              onClick={() => ed.editFace(f.id)}
              data-testid={`minimap-face-${f.id}`}
              data-current={on}
            >
              <title>{on ? `${f.name}: you are here` : `open ${f.name}`}</title>
            </polygon>
          )
        })}
      </svg>
    </div>
  )
}
