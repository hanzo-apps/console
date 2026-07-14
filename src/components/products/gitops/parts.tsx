'use client'

/**
 * Small GitOps status primitives — the health dot + sync glyph the board and the
 * application detail read the same way (one place, DRY). These are intentionally
 * tiny; when `@hanzo/ui/gitops` ships its canonical `HealthBadge`/`SyncBadge`
 * they can replace these verbatim (same `HealthStatus`/`SyncStatus` inputs).
 *
 * Honest by construction: the color comes from the pure palette in `logic.ts`
 * (never a fabricated "green"), and a Progressing/Syncing verdict pulses to read
 * as a live thing converging.
 */
import { Text, XStack, YStack } from '@hanzo/gui'
import { CircleDashed, GitCompareArrows, RefreshCw } from '@hanzogui/lucide-icons-2'

import type { HealthStatus, SyncStatus } from '~/lib/api/gitops'
import { healthColor, healthPulses, syncColor } from './logic'

/** ArgoCD-style health dot + label (●Healthy / ●Progressing / ●Degraded). */
export function HealthPill({ health }: { health: HealthStatus }) {
  return (
    <XStack items="center" gap="$1.5">
      <YStack
        width={8}
        height={8}
        className={healthPulses(health) ? 'hz-pulse' : undefined}
        style={{ backgroundColor: healthColor(health), borderRadius: 999 }}
      />
      <Text fontSize="$3" color="$color12">
        {health}
      </Text>
    </XStack>
  )
}

const SYNC_ICON: Record<SyncStatus, typeof RefreshCw> = {
  Synced: RefreshCw,
  Syncing: RefreshCw,
  OutOfSync: GitCompareArrows,
  Unknown: CircleDashed,
}

/** ArgoCD-style sync glyph + label (↻Synced / ⧗Syncing / OutOfSync). The glyph
 *  color rides `currentColor` off the row's inline CSS color (the lucide stroke
 *  inherits it), so an arbitrary hex from the pure palette needs no GUI token. */
export function SyncPill({ sync }: { sync: SyncStatus }) {
  const Icon = SYNC_ICON[sync]
  return (
    <XStack items="center" gap="$1.5">
      <YStack style={{ color: syncColor(sync) }} className={sync === 'Syncing' ? 'hz-pulse' : undefined}>
        <Icon size={13} />
      </YStack>
      <Text fontSize="$3" color="$color12">
        {sync}
      </Text>
    </XStack>
  )
}
