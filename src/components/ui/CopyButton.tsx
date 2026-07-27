'use client'

/**
 * Copy a value to the clipboard, showing a transient "Copied". The ONE copy control
 * — every surface (clone URLs, secrets, snippets, request bodies, invite links)
 * uses this, so the affordance looks and behaves the same everywhere.
 *
 * A blocked clipboard (insecure context, denied permission) is silent by design:
 * the value the button copies is already on screen and selectable.
 */
import { useState } from 'react'
import { Button, Text } from '@hanzo/gui'
import { Check, Copy } from '@hanzogui/lucide-icons-2'

type Size = '$1' | '$2' | '$3'

const ICON: Record<Size, number> = { $1: 12, $2: 14, $3: 15 }

export function CopyButton({
  value,
  label = 'Copy',
  ariaLabel,
  size = '$2',
  iconOnly,
  chromeless = true,
}: {
  value: string
  label?: string
  ariaLabel?: string
  size?: Size
  /** No label text — just the icon. */
  iconOnly?: boolean
  /** Solid button (`false`) where the call site framed it as a real control. */
  chromeless?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked (insecure context) — the value is already visible */
    }
  }
  const text = copied ? 'Copied' : label
  return (
    <Button
      size={size}
      chromeless={chromeless}
      aria-label={ariaLabel ?? (label || 'Copy')}
      disabled={!value}
      icon={copied ? <Check size={ICON[size]} /> : <Copy size={ICON[size]} />}
      onPress={() => void copy()}
    >
      {iconOnly ? null : chromeless ? (
        <Text fontSize={size === '$1' ? '$1' : '$2'} color="$color11">
          {text}
        </Text>
      ) : (
        text
      )}
    </Button>
  )
}
