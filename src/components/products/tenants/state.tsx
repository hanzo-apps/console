'use client'

/**
 * Honest states for tenant PROVISIONING actions.
 *
 * A provisioning action (IAM app, suspend/reactivate) either succeeds, fails, or lands
 * on a route this deployment's platform does not serve. The third is not an error and
 * must not read as one — it is the honest "not connected here" state, an inline notice
 * rather than a fake success toast.
 *
 * This is the ONE place that decides which of the three a thrown error is, so every
 * action button reads the same. It reuses `ApiError.status`.
 */
import { Text, XStack } from '@hanzo/gui'
import { CheckCircle2, Clock, TriangleAlert } from '@hanzogui/lucide-icons-2'

import { ApiError } from '~/lib/api'

/** The outcome of a provisioning action, classified honestly. */
export type ActionOutcome =
  | { tone: 'ok'; text: string }
  | { tone: 'pending'; text: string } // the endpoint isn't bound yet — the honest follow-up
  | { tone: 'err'; text: string }

/**
 * Classify a thrown provisioning error. A 404 (or 501) means the platform doesn't
 * serve this composite endpoint YET → an honest "not connected, next phase" pending
 * state, NOT a red error. Everything else is a real failure.
 */
export function classifyAction(e: unknown, notConnectedText: string): ActionOutcome {
  const status = e instanceof ApiError ? e.status : 0
  if (status === 404 || status === 501 || status === 405) return { tone: 'pending', text: notConnectedText }
  const msg = e instanceof Error ? e.message : String(e)
  return { tone: 'err', text: msg || 'Action failed' }
}

/** A one-line inline outcome row under an action (ok / pending-follow-up / error). */
export function ActionNotice({ outcome }: { outcome: ActionOutcome | null }) {
  if (!outcome) return null
  const Icon = outcome.tone === 'ok' ? CheckCircle2 : outcome.tone === 'pending' ? Clock : TriangleAlert
  const color = outcome.tone === 'ok' ? '$green10' : outcome.tone === 'pending' ? '$color10' : '$red10'
  return (
    <XStack gap="$2" items="center" flexWrap="wrap">
      <Icon size={14} color={color} />
      <Text fontSize="$2" color={color} flex={1}>
        {outcome.text}
      </Text>
    </XStack>
  )
}
