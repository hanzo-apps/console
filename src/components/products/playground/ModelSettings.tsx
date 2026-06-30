'use client'

/**
 * ModelSettings — the right-rail sampling panel. Temperature and Top-P are
 * sliders (value shown live), Max tokens and Stop sequences are inputs, and an
 * "Advanced settings" disclosure reveals frequency/presence penalties + a seed.
 * Every control maps to a REAL OpenAI-compatible request field via `paramsOf` —
 * the same mapping the run and the request preview use, so nothing shown here is
 * cosmetic.
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
    <YStack gap="$2">
      <XStack justify="space-between" items="center">
        <Text fontSize="$2" color="$color11">
          {label}
        </Text>
        <Text fontSize="$2" color="$color12" fontWeight="700">
          {fmtNum(value)}
        </Text>
      </XStack>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(v) => onChange(v[0] ?? min)}
        disabled={disabled}
      >
        <Slider.Track>
          <Slider.TrackActive />
        </Slider.Track>
        <Slider.Thumb index={0} circular />
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

export function ModelSettings({
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
    <Card p="$4" gap="$3.5" borderWidth={1} borderColor="$borderColor" bg="$color1">
      <Text fontSize="$5" fontWeight="800">
        Model settings
      </Text>

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
    </Card>
  )
}
