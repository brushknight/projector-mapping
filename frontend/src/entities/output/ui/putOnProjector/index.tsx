import { useState, type ReactNode } from 'react'
import { Menu, type MenuItem } from '../../../../shared/components'
import { errMsg } from '../../../../shared/lib/http'
import { outputsApi, type OutputDisplay } from '../../api'

/**
 * (§17) "put on projector": picks a display and asks the server to open /out there as a Chrome kiosk window, with no
 * address bar, its own profile and sound allowed. Works from the editor on the Mac that runs projmap.
 */
export function PutOnProjector({ trigger, onDone, onError, align = 'right', className }: {
  trigger: (p: { open: boolean; toggle: () => void }) => ReactNode
  onDone: (msg: string) => void
  onError: (msg: string) => void
  align?: 'left' | 'right'
  className?: string
}) {
  const [displays, setDisplays] = useState<OutputDisplay[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const load = (open: boolean) => {
    if (!open) return
    setProblem(null)
    outputsApi.displays().then(setDisplays, (e) => {
      setDisplays([])
      setProblem(errMsg(e, 'This Mac did not list its displays.'))
    })
  }
  const launch = (d: OutputDisplay) =>
    outputsApi.launch(d.index, 'out').then(
      () => onDone(`Opened the output on ${d.name}. Press Esc there to leave full screen.`),
      (e) => onError(errMsg(e, 'Chrome did not open.')),
    )
  const items: MenuItem[] = [
    { key: 'cap', caption: true, label: 'open the output full screen on' },
    ...(displays === null
      ? [{ key: 'loading', label: 'looking for displays…', disabled: true }]
      : displays.map((d) => ({
          key: `d${d.index}`,
          icon: d.main ? 'window' : 'projector',
          label: `${d.index} · ${d.name}`,
          meta: `${d.width}×${d.height}`,
          onSelect: () => void launch(d),
          testId: `put-on-display-${d.index}`,
        }))),
    ...(problem ? [{ key: 'problem', label: problem, disabled: true }] : []),
  ]
  return <Menu align={align} width={380} trigger={trigger} items={items} onOpenChange={load} className={className} />
}
