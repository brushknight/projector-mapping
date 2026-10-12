import { Icon } from '../../../../shared/components'
import { cx } from '../../../../shared/lib/cx'
import { useEditor, type Tool } from '../../editor/context'
import type { Scene } from '../../types'
import s from './styles.module.css'

/** What a drawing tool needs from you, shown under step 2 while it waits for clicks. */
export const TOOL_HOW: Record<Tool, string> = {
  select: 'click the corners of a face on the object',
  quad: 'click the 4 corners of a face on the object, clockwise from top left',
  mesh: 'click the 4 corners of a curved face; then drag the mesh points to bend it',
  tri: 'click the 3 corners of the face',
  poly: 'click each corner; click the first point again or press Enter to close it',
  circle: 'click the centre, then a point on the rim',
  line: 'click along the edge; press Enter to finish',
  mask: 'click around the area to keep dark; press Enter to close it',
}

export interface RailSteps {
  reference: boolean
  faces: boolean
  content: boolean
  play: boolean
}

/** Which of the 4 steps are done for a scene (pure, for tests). */
export function railSteps(scene: Scene | null, setup: { referenceAsset: string | null; calibrationId: string | null } | null, testPatternOn: boolean): RailSteps {
  const surfaces = scene?.objects.flatMap((o) => o.surfaces) ?? []
  return {
    reference: !!setup?.referenceAsset || !!setup?.calibrationId || testPatternOn,
    faces: surfaces.some((x) => x.role === 'face' && x.kind !== 'line' && x.kind !== 'mask'),
    content:
      surfaces.some((x) => x.effects.length > 0 || (x.layers?.length ?? 0) > 0) ||
      !!scene?.objects.some((o) => (o.layers?.length ?? 0) > 0) ||
      (scene?.timeline.clips.length ?? 0) > 0,
    play: scene?.mode === 'objects',
  }
}

/**
 * The 4-step rail at the top of the left panel: 1 reference → 2 faces → 3 content → 4 play. Done steps light up;
 * clicking a step takes you there. The hint under it says what to do next.
 */
export function Rail() {
  const ed = useEditor()
  const done = railSteps(ed.scene, ed.setup, ed.testPattern.pattern !== 'off')
  const steps: Array<{ key: keyof RailSteps; label: string; go: () => void; title: string }> = [
    { key: 'reference', label: 'reference', title: 'add a photo from the lens or turn on the test grid (set up)', go: () => ed.setSetupOpen(true) },
    {
      key: 'faces',
      label: 'faces',
      title: 'draw the faces of the object on the stage (Q)',
      go: () => {
        ed.setSpace('map')
        ed.setTool('quad')
      },
    },
    { key: 'content', label: 'content', title: 'put pictures, drawings and effects on the faces (tab)', go: () => ed.setSpace('content') },
    {
      key: 'play',
      label: 'play',
      title: 'open the timeline and preview it (space); put the objects on air when it looks right',
      go: () => {
        ed.setTimelineOpen(true)
        if (!ed.preview.playing) ed.preview.play()
      },
    },
  ]
  const current = steps.find((x) => !done[x.key])?.key ?? null
  const armed = ed.space === 'map' && ed.tool !== 'select'
  const hint = armed
    ? `${ed.tool}: ${TOOL_HOW[ed.tool]}. esc cancels`
    : current === 'reference'
      ? 'add a photo taken from the projector, or turn on the test grid, to see the object'
      : current === 'faces'
        ? 'press Q (or + face), then click the 4 corners of a face on the object, clockwise from top left'
        : current === 'content'
          ? 'press tab for content: drop a picture on a face, draw on it, or add an effect'
          : current === 'play'
            ? 'press space to preview here; put objects on air when the wall should show them'
            : ed.space === 'map'
              ? 'drag corners to fit; [ and ] step through points, S solos the selection'
              : 'double-click a face to edit it alone; [ and ] step through faces'
  return (
    <div className={s.rail} data-testid="rail">
      <ol className={s.steps} aria-label="steps">
        {steps.map((st, i) => (
          <li key={st.key}>
            <button
              type="button"
              className={cx(s.step, done[st.key] && s.done, current === st.key && s.now)}
              onClick={st.go}
              title={st.title}
              aria-current={current === st.key ? 'step' : undefined}
              data-testid={`rail-${st.key}`}
              data-done={done[st.key]}
            >
              <span className={s.n}>{done[st.key] ? <Icon name="check" size={11} /> : i + 1}</span>
              {st.label}
            </button>
          </li>
        ))}
      </ol>
      <p className={s.hint} data-testid="coach">
        {hint}
      </p>
    </div>
  )
}
