import { Pill } from '../../../../shared/components'
import { useEditor, type Tool } from '../../editor/context'
import s from './styles.module.css'

const HOW: Record<Tool, string> = {
  select: 'click the corners of a face on the object',
  quad: 'click the 4 corners of a face on the object, clockwise from top left',
  mesh: 'click the 4 corners of a curved face; then drag the mesh points to bend it',
  tri: 'click the 3 corners of the face',
  poly: 'click each corner; click the first point again or press Enter to close it',
  circle: 'click the centre, then a point on the rim',
  line: 'click along the edge; press Enter to finish',
  mask: 'click around the area to keep dark; press Enter to close it',
}

/** The "how to make a face" panel on the stage: shown on an empty scene and while a drawing tool waits for a click. */
export function Coach({ empty }: { empty: boolean }) {
  const ed = useEditor()
  const armed = ed.tool !== 'select'
  return (
    <div className={s.coach} role="note" aria-label="how to map a face" data-testid="coach">
      <div className={s.coachHead}>
        <span className={s.coachTitle}>{armed ? `${ed.tool}: ${HOW[ed.tool]}` : empty ? 'map your first face' : 'add a face'}</span>
        <Pill size="sm" ghost icon="close" aria-label="hide these tips" title="hide these tips" onClick={() => ed.setCoach(false)} />
      </div>
      <ol className={s.coachList}>
        {!armed && (
          <li>
            press <kbd>Q</kbd> (or <b>+ face</b> in the surfaces panel), then click the 4 corners of a face on the object, clockwise
            from top left
          </li>
        )}
        <li>drag a corner to adjust it; corners snap to nearby points so faces share them (hold <kbd>⌘</kbd> to skip the magnet)</li>
        <li>
          <kbd>Tab</kbd> cycles the points, arrows nudge 1 px, <kbd>⇧</kbd> + arrows 10 px
        </li>
        <li>
          <kbd>Enter</kbd> finishes a polygon or line, <kbd>Esc</kbd> cancels
        </li>
        <li>draw inside a selected face to add a detail; double-click a face to see it flat and draw on it</li>
      </ol>
      {!armed && (
        <div className={s.coachActions}>
          <Pill size="sm" on icon="quad" onClick={() => ed.setTool('quad')} data-testid="coach-quad">
            draw a face
          </Pill>
        </div>
      )}
    </div>
  )
}
