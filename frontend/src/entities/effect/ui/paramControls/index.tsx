import { ColorField, FillSlider, Menu, Pill, Row, Segmented, Switch, TextInput } from '../../../../shared/components'
import { coerceParam, formatParam, specDefault } from '../../params'
import type { ParamSchema, ParamSpec } from '../../types'
import s from './styles.module.css'

export type ParamPhase = 'live' | 'final'

/**
 * Controls drawn from a param schema: fill sliders for numbers, segments or a menu for enums, switches, colours and
 * text. A new catalog item needs no new UI code.
 */
export function ParamControls({ schema, values, onChange, skip }: { schema: ParamSchema; values: Record<string, unknown>; onChange: (key: string, value: unknown, phase: ParamPhase) => void; skip?: string[] }) {
  return (
    <div className={s.list}>
      {Object.entries(schema)
        .filter(([k, spec]) => !skip?.includes(k) && spec.type !== 'strokes')
        .map(([key, spec]) => (
          <ParamControl key={key} name={key} spec={spec} value={values[key] ?? specDefault(spec)} onChange={(v, p) => onChange(key, v, p)} />
        ))}
    </div>
  )
}

export function ParamControl({ name, spec, value, onChange }: { name: string; spec: ParamSpec; value: unknown; onChange: (v: unknown, phase: ParamPhase) => void }) {
  const label = spec.label ?? name
  switch (spec.type) {
    case 'number':
    case 'integer': {
      const v = Number(coerceParam(spec, value))
      return (
        <FillSlider
          label={label}
          value={v}
          min={spec.min ?? 0}
          max={spec.max ?? 1}
          step={spec.step ?? (spec.type === 'integer' ? 1 : undefined)}
          display={formatParam(spec, v)}
          onChange={(x, phase) => onChange(spec.type === 'integer' ? Math.round(x) : x, phase)}
        />
      )
    }
    case 'boolean':
      return (
        <Row className={s.row}>
          <span>{label}</span>
          <Switch checked={!!value} onChange={(b) => onChange(b, 'final')} ariaLabel={label} />
        </Row>
      )
    case 'color':
      return <ColorField label={label} value={String(coerceParam(spec, value))} onChange={(hex, phase) => onChange(hex, phase)} />
    case 'enum': {
      const opts = spec.options ?? []
      const cur = String(coerceParam(spec, value))
      if (opts.length <= 4)
        return <Segmented ariaLabel={label} options={opts.map((o) => ({ value: o, label: enumLabel(name, o) }))} value={cur} onChange={(o) => onChange(o, 'final')} />
      return (
        <Row className={s.row}>
          <span>{label}</span>
          <Menu
            align="right"
            width={180}
            trigger={({ toggle }) => (
              <Pill size="sm" icon="chevronDown" onClick={toggle}>
                {cur}
              </Pill>
            )}
            items={opts.map((o) => ({ key: o, label: o, on: o === cur, onSelect: () => onChange(o, 'final') }))}
          />
        </Row>
      )
    }
    case 'string':
      return (
        <Row className={s.row}>
          <span>{label}</span>
          <TextInput className={s.text} defaultValue={String(value ?? '')} key={String(value ?? '')} aria-label={label} onBlur={(e) => e.target.value !== value && onChange(e.target.value, 'final')} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        </Row>
      )
    default:
      return null
  }
}

/** Friendlier words for a few enum values (trace: border → "along border"). */
function enumLabel(param: string, v: string): string {
  if (param === 'mode' && v === 'border') return 'along border'
  return v
}
