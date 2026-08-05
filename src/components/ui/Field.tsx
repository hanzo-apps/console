'use client'

/**
 * The one labeled control `@hanzo/ui/product` does not carry yet.
 *
 * Every other field primitive — `FieldRow`, `FieldText`, `FieldTextArea`,
 * `FieldSwitch`, `FieldSelect`, `FieldSlider` — now comes from the package.
 * `FieldOptionSelect` is the value/label twin of `FieldSelect`: an entity
 * reference picker (pick a stakeholder or share class BY NAME, commit its id),
 * where `FieldSelect` is the special case value === label. It has no package
 * equivalent, so it stays here until it has one.
 *
 * A native `<select>` is compact, keyboard/ARIA-accessible, gives the native
 * mobile picker (best small-screen UX), and is themed via the Tamagui CSS custom
 * properties (`--background`/`--color12`/`--borderColor`) so it tracks light/dark.
 */
import type { CSSProperties } from 'react'

/** The disclosure chevron a native `<select>` wears — a themed background image,
 *  since `appearance: none` removes the platform one. Shared with any surface
 *  that styles its own `<select>` so there is ONE chevron. */
export const CHEVRON = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9a9a9a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
)}`

function selectStyle(disabled?: boolean): CSSProperties {
  return {
    width: '100%',
    boxSizing: 'border-box',
    appearance: 'none',
    WebkitAppearance: 'none',
    MozAppearance: 'none',
    background: `var(--background) url("${CHEVRON}") no-repeat right 10px center`,
    color: 'var(--color12)',
    border: '1px solid var(--borderColor)',
    borderRadius: 9,
    padding: '9px 34px 9px 12px',
    fontSize: 14,
    lineHeight: '20px',
    fontFamily: 'inherit',
    height: 40,
    outline: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  }
}

const OPTION_STYLE: CSSProperties = { background: 'var(--color2)', color: 'var(--color12)' }

export function FieldOptionSelect({
  value,
  options,
  onChange,
  disabled,
  placeholder = 'Select…',
}: {
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
  disabled?: boolean
  placeholder?: string
}) {
  const showPlaceholder = value === '' || !options.some((o) => o.value === value)
  return (
    <select
      value={showPlaceholder ? '' : value}
      onChange={(e) => onChange(e.currentTarget.value)}
      disabled={disabled}
      aria-label={placeholder}
      style={selectStyle(disabled)}
    >
      {showPlaceholder ? (
        <option value="" disabled style={OPTION_STYLE}>
          {placeholder}
        </option>
      ) : null}
      {options.map((opt) => (
        <option key={opt.value} value={opt.value} style={OPTION_STYLE}>
          {opt.label}
        </option>
      ))}
    </select>
  )
}
