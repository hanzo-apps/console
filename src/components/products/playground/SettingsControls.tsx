'use client'

/**
 * Settings — the sampling controls shared across columns (or overridden per
 * column): Temperature, Top-P, Max tokens, Stop. ONE control set, composed in two
 * places (the shared card and a column's override), so the fields never drift.
 */
import { YStack } from '@hanzo/gui'

import { FieldRow, FieldSlider, FieldText } from '~/components/ui/Field'
import type { Settings } from './types'

export function SettingsFields({
  value,
  onChange,
  disabled,
}: {
  value: Settings
  onChange: (patch: Partial<Settings>) => void
  disabled?: boolean
}) {
  return (
    <YStack gap="$2.5">
      <FieldRow label="Temperature">
        <FieldSlider
          value={value.temperature}
          min={0}
          max={2}
          step={0.01}
          onChange={(v) => onChange({ temperature: v })}
          disabled={disabled}
        />
      </FieldRow>
      <FieldRow label="Top P">
        <FieldSlider value={value.topP} min={0} max={1} step={0.01} onChange={(v) => onChange({ topP: v })} disabled={disabled} />
      </FieldRow>
      <FieldRow label="Max tokens">
        <FieldText value={value.maxTokens} onChange={(v) => onChange({ maxTokens: v })} placeholder="1024" disabled={disabled} />
      </FieldRow>
      <FieldRow label="Stop">
        <FieldText
          value={value.stop}
          onChange={(v) => onChange({ stop: v })}
          placeholder="comma-separated, e.g. END, ###"
          disabled={disabled}
        />
      </FieldRow>
    </YStack>
  )
}
