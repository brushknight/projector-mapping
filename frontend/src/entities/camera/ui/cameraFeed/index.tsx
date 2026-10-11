import type { ReactNode } from 'react'
import { Glass } from '../../../../shared/components'
import { frameDataUrl, type CameraFrame } from '../../types'
import s from './styles.module.css'

/** The phone's camera preview with glass chips on top. */
export function CameraFeed({ frame, left, right, empty }: { frame: CameraFrame | null; left?: ReactNode; right?: ReactNode; empty?: ReactNode }) {
  return (
    <div className={s.feed} data-testid="camera-feed">
      {frame ? <img src={frameDataUrl(frame)} alt="what the phone sees" className={s.img} /> : <div className={s.empty}>{empty ?? 'no camera yet. open auto map on the phone and put it on a stand.'}</div>}
      <div className={s.fbar}>
        {left ? <Glass>{left}</Glass> : <span />}
        {right && <Glass>{right}</Glass>}
      </div>
    </div>
  )
}
