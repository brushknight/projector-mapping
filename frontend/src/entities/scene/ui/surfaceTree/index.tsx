import { EmptyState, Menu, Pill, TreeNode } from '../../../../shared/components'
import { newId } from '../../../../shared/lib/ids'
import { useEditor } from '../../editor/context'
import { addObject, setObjectField, setSurfaceField } from '../../ops'
import type { Surface } from '../../types'
import s from './styles.module.css'

export const KIND_ICON: Record<Surface['kind'], string> = { quad: 'quad', tri: 'tri', poly: 'poly', circle: 'circle', line: 'line', mask: 'mask' }

export function surfaceMeta(srf: Surface): string {
  if (srf.kind === 'mask') return 'mask'
  if (srf.kind === 'line') return String(Math.max(0, srf.pointIds.length - 1))
  if (srf.role === 'detail') return ''
  return srf.role
}

/** The objects and surfaces of the scene. Click selects; the eye hides on the wall. */
export function SurfaceTree({ header = true }: { header?: boolean }) {
  const ed = useEditor()
  const scene = ed.scene
  const selObject = ed.sel.objectId

  const newObject = () => {
    const id = newId('obj')
    void ed.editing.edit(() => addObject({ id, name: `object ${(scene?.objects.length ?? 0) + 1}`, tags: [], visible: true, surfaces: [] }))
    ed.select({ objectId: id, surfaceId: null, pointId: null, focus: 'object' })
  }

  return (
    <>
      {header && (
        <div className={s.ph}>
          <span className={s.cap}>surfaces</span>
          <Pill
            size="sm"
            on={ed.tool === 'quad'}
            icon="plus"
            className={s.face}
            onClick={() => {
              ed.setCoach(true)
              ed.setTool('quad')
            }}
            title="draw a face: click its 4 corners on the stage (Q)"
            data-testid="add-face"
          >
            face
          </Pill>
          <Menu
            align="right"
            width={240}
            trigger={({ toggle }) => <Pill size="sm" icon="plus" aria-label="add surface" onClick={toggle} />}
            items={[
              { key: 'obj', icon: 'folder', label: 'new object', onSelect: newObject },
              { key: 'q', icon: 'quad', label: 'draw a quad (Q)', onSelect: () => ed.setTool('quad') },
              { key: 't', icon: 'tri', label: 'draw a triangle (T)', onSelect: () => ed.setTool('tri') },
              { key: 'p', icon: 'poly', label: 'draw a polygon (P)', onSelect: () => ed.setTool('poly') },
              { key: 'c', icon: 'circle', label: 'draw a circle (C)', onSelect: () => ed.setTool('circle') },
              { key: 'l', icon: 'line', label: 'draw a line (L)', onSelect: () => ed.setTool('line') },
              { key: 'k', icon: 'mask', label: 'draw a mask (K)', onSelect: () => ed.setTool('mask') },
            ]}
          />
        </div>
      )}
      <div className={s.tree} role="tree" aria-label="surfaces">
        {!scene || scene.objects.length === 0 ? (
          <EmptyState>no objects yet. press + face (or Q) and click the 4 corners of a face on the stage.</EmptyState>
        ) : (
          scene.objects.map((obj) => {
            const pts = new Set(obj.surfaces.flatMap((x) => x.pointIds)).size
            const objSel = ed.sel.focus === 'object' && selObject === obj.id
            const dim = !!selObject && selObject !== obj.id
            return (
              <div key={obj.id} className={s.group}>
                <TreeNode
                  icon="folder"
                  label={obj.name}
                  meta={obj.surfaces.length === 1 && obj.surfaces[0].role === 'face' ? '1 face' : `${pts} pts`}
                  selected={objSel}
                  dim={dim}
                  visible={obj.visible}
                  onToggleVisible={() => ed.editing.edit((sc) => setObjectField(sc, obj.id, 'visible', !obj.visible))}
                  onClick={() => ed.select({ objectId: obj.id, surfaceId: null, pointId: null, meshIndex: null, focus: 'object' })}
                  testId={`tree-object-${obj.id}`}
                />
                {obj.surfaces.map((srf) => (
                  <TreeNode
                    key={srf.id}
                    depth={1}
                    icon={KIND_ICON[srf.kind]}
                    label={srf.name}
                    meta={surfaceMeta(srf)}
                    selected={ed.sel.surfaceId === srf.id && ed.sel.focus !== 'object'}
                    dim={dim}
                    visible={srf.visible}
                    onToggleVisible={() => ed.editing.edit((sc) => setSurfaceField(sc, srf.id, 'visible', !srf.visible))}
                    onClick={() => ed.select({ objectId: obj.id, surfaceId: srf.id, pointId: null, meshIndex: null, focus: 'surface' })}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', `surface:${srf.id}`)}
                    testId={`tree-surface-${srf.id}`}
                  />
                ))}
              </div>
            )
          })
        )}
      </div>
    </>
  )
}
