'use client'

/**
 * ModelSettings — the sampling panel attached to the prompt builder. Temperature
 * and Top-P are compact sliders (value shown live), Max tokens and Stop sequences
 * are inputs, and an "Advanced settings" disclosure reveals frequency/presence
 * penalties + a seed. Every control maps to a REAL OpenAI-compatible request field
 * via `paramsOf` — the same mapping the run and the request preview use.
 *
 * `chrome` (default true) draws the card + title for the desktop side-pane; the
 * mobile bottom sheet renders the controls bare (`chrome={false}`) because the
 * sheet supplies its own title.
 */
import { useState } from 'react'
import { Button, Card, Input, Slider, Text, XStack, YStack } from '@hanzo/gui'
import { ChevronDown, ChevronRight } from '@hanzogui/lucide-icons-2'

import type { Settings } from './types'

/** Trim trailing zeros: 0.70 → "0.7", 1.00 → "1". */
function fmtNum(v: number): string {
  return String(Number(v.toFixed(2)))
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  disabled,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  disabled?: boolean
}) {
  return (
    <YStack gap="$1.5">
      <XStack justify="space-between" items="center">
        <Text fontSize="$2" color="$color11">
          {label}
        </Text>
        <Text fontSize="$2" color="$color12" fontWeight="700">
          {fmtNum(value)}
        </Text>
      </XStack>
      {/* Compact: a thin track + a small thumb (the default thumb is oversized).
          The Thumb `size` token drives its diameter AND its end-inset math, so we
          size it via the token — not explicit width/height (which desync them). */}
      <Slider
        size="$1"
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(v) => onChange(v[0] ?? min)}
        disabled={disabled}
      >
        <Slider.Track height={5} bg="$color5">
          <Slider.TrackActive bg="$color11" />
        </Slider.Track>
        <Slider.Thumb index={0} circular size="$0.75" bg="$color12" borderWidth={0} />
      </Slider>
    </YStack>
  )
}

function InputRow({
  label,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
}) {
  return (
    <YStack gap="$1.5">
      <Text fontSize="$2" color="$color11">
        {label}
      </Text>
      <Input value={value} onChangeText={onChange} placeholder={placeholder} disabled={disabled} autoCapitalize="none" size="$3" />
    </YStack>
  )
}

/** The settings controls (no chrome) — shared by the desktop pane and mobile sheet. */
function Controls({
  value,
  onChange,
  disabled,
}: {
  value: Settings
  onChange: (patch: Partial<Settings>) => void
  disabled?: boolean
}) {
  const [adv, setAdv] = useState(false)
  return (
    <YStack gap="$3.5">
      <SliderRow
        label="Temperature"
        value={value.temperature}
        min={0}
        max={2}
        step={0.01}
        onChange={(v) => onChange({ temperature: v })}
        disabled={disabled}
      />
      <SliderRow
        label="Top P"
        value={value.topP}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => onChange({ topP: v })}
        disabled={disabled}
      />
      <InputRow
        label="Max tokens"
        value={value.maxTokens}
        onChange={(v) => onChange({ maxTokens: v })}
        placeholder="1024"
        disabled={disabled}
      />
      <InputRow
        label="Stop sequences"
        value={value.stop}
        onChange={(v) => onChange({ stop: v })}
        placeholder="comma-separated, e.g. END, ###"
        disabled={disabled}
      />

      <YStack gap="$3" borderTopWidth={1} borderColor="$borderColor" pt="$3">
        <Button
          size="$2"
          chromeless
          self="flex-start"
          px="$0"
          icon={adv ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          onPress={() => setAdv((s) => !s)}
        >
          <Text fontSize="$2" color="$color11" fontWeight="600">
            Advanced settings
          </Text>
        </Button>
        {adv ? (
          <YStack gap="$3.5">
            <SliderRow
              label="Frequency penalty"
              value={value.frequencyPenalty}
              min={-2}
              max={2}
              step={0.01}
              onChange={(v) => onChange({ frequencyPenalty: v })}
              disabled={disabled}
            />
            <SliderRow
              label="Presence penalty"
              value={value.presencePenalty}
              min={-2}
              max={2}
              step={0.01}
              onChange={(v) => onChange({ presencePenalty: v })}
              disabled={disabled}
            />
            <InputRow
              label="Seed"
              value={value.seed}
              onChange={(v) => onChange({ seed: v })}
              placeholder="none (random)"
              disabled={disabled}
            />
          </YStack>
        ) : null}
      </YStack>
    </YStack>
  )
}

export function ModelSettings({
  value,
  onChange,
  disabled,
  chrome = true,
}: {
  value: Settings
  onChange: (patch: Partial<Settings>) => void
  disabled?: boolean
  /** Draw the card + title (desktop pane). The mobile sheet passes `false`. */
  chrome?: boolean
}) {
  if (!chrome) return <Controls value={value} onChange={onChange} disabled={disabled} />
  return (
    <Card p="$4" gap="$3.5" borderWidth={1} borderColor="$borderColor" bg="$color1">
      <Text fontSize="$5" fontWeight="800">
        Model settings
      </Text>
      <Controls value={value} onChange={onChange} disabled={disabled} />
    </Card>
  )
}
