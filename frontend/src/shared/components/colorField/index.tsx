import { TextInput } from '../textInput'
import s from './styles.module.css'

/** A colour swatch (native picker) with its hex value. */
export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (hex: string, phase: 'live' | 'final') => void }) {
  return (
    <div className={s.row}>
      <span className={s.label}>{label}</span>
      <label className={s.swatch} style={{ background: value }}>
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#ffffff'}
          aria-label={label}
          onInput={(e) => onChange((e.target as HTMLInputElement).value, 'live')}
          onChange={(e) => onChange(e.target.value, 'final')}
        />
      </label>
      <TextInput
        className={s.hex}
        defaultValue={value}
        key={value}
        aria-label={`${label} hex`}
        onBlur={(e) => /^#[0-9a-fA-F]{6}$/.test(e.target.value) && e.target.value !== value && onChange(e.target.value, 'final')}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </div>
  )
}
