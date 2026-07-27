'use client'

/**
 * The console's ONE destructive-confirm panel, rendered inside a `SlideOver`.
 *
 * A destructive action is the only irreversible thing a product module offers, so it
 * gets a single shared shape: the consequence stated in full, a red confirm, a cancel,
 * and an inline honest error (via `classifyBackend`) when the call fails — the panel
 * stays open on failure so the user sees WHY instead of a silently-closed drawer.
 *
 * Two opt-in dials, so this stays the ONE panel instead of growing a sibling:
 * `confirmText` raises the bar to typing the resource's name (for a destroy with no
 * undo — a live node, a load balancer serving traffic), and `busyLabel` names what is
 * actually happening while it runs.
 */
import { useState } from 'react'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { Trash2 } from '@hanzogui/lucide-icons-2'

import { classifyBackend } from './BackendState'
import { FieldText } from './Field'
import { toneColor, toneVar } from './tone'

export function ConfirmDelete({
  message,
  confirmLabel,
  confirmText,
  busyLabel = 'Deleting…',
  run,
  onDone,
}: {
  /** The full consequence, stated plainly ("Delete X and all N of its records?"). */
  message: string
  confirmLabel: string
  /**
   * When set, the confirm stays DISARMED until this exact string is typed. The bar for
   * an action whose confirmation must hold on its own — including when it is reached
   * from the ⌘K palette with no drawer around it.
   */
  confirmText?: string
  /** What the button says while the call is in flight. */
  busyLabel?: string
  run: () => Promise<void>
  /** Called on success AND on cancel — the caller closes the drawer and reloads. */
  onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  // A blank `confirmText` is the same as none: an unnamed resource must not produce a
  // challenge that any empty box satisfies.
  const challenge = confirmText?.trim() ?? ''
  const armed = challenge === '' || typed.trim() === challenge

  const go = async () => {
    setBusy(true)
    setErr(null)
    try {
      await run()
      onDone()
    } catch (e) {
      setErr(classifyBackend(e).message || 'Failed to delete.')
      setBusy(false)
    }
  }

  return (
    <YStack gap="$3">
      <Text fontSize="$3" color="$color11">
        {message}
      </Text>
      {err ? (
        <Text fontSize="$2" color={toneColor('critical')}>
          {err}
        </Text>
      ) : null}
      {challenge ? (
        <YStack gap="$1.5">
          <Text fontSize="$2" color="$color11">
            Type{' '}
            <Text fontSize="$2" fontWeight="700" color="$color12">
              {challenge}
            </Text>{' '}
            to confirm.
          </Text>
          <FieldText value={typed} onChange={setTyped} disabled={busy} placeholder={challenge} />
        </YStack>
      ) : null}
      <XStack gap="$2" flexWrap="wrap">
        <Button
          onPress={go}
          disabled={busy || !armed}
          icon={<Trash2 size={15} />}
          // Dimmed while disarmed/busy: the console's one disabled affordance (matches
          // FieldSelect), because the hardcoded critical fill would otherwise paint a
          // dead button as live.
          style={{ backgroundColor: toneVar('critical'), borderColor: toneVar('critical'), color: 'var(--color1)', opacity: busy || !armed ? 0.5 : 1 }}
        >
          {busy ? busyLabel : confirmLabel}
        </Button>
        <Button chromeless onPress={() => onDone()} disabled={busy}>
          Cancel
        </Button>
      </XStack>
    </YStack>
  )
}
