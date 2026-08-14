'use client'

/**
 * Honest async states — the ONE way the console explains a failed/empty load.
 *
 * Every admin module that reads a real `/v1` endpoint can 404 (not routed on
 * this deployment), 401/403 (access enforced server-side), 402 (the org has no
 * funded balance), or 503 (backend starting). `honestError` maps an `ApiError` to
 * a specific, truthful message — never a generic crash and never fabricated data —
 * and `ErrorState` renders it with the RIGHT affordance: retry, "Sign in again"
 * (401), or "Add credits" (402 → `/billing/credits`). Per-call copy overrides keep
 * surface-specific guidance (e.g. the IAM admin API) without duplicating the structure.
 */
import { useRouter } from '~/lib/router'
import { Button, Card, Text, XStack } from '@hanzo/gui'
import { TriangleAlert, Lock, CreditCard } from '@hanzogui/lucide-icons-2'

import { ApiError } from '~/lib/api'
import { useSession } from '~/lib/auth/session'
import { startReauth } from '~/lib/auth/iam'
import { getBrand } from '~/lib/branding/brands'
import { honestError, type HonestCopy } from './states-logic'

// The honest-error VALUE logic lives in `./states-logic` (a plain `.ts`, node-
// testable — no gui/icon imports). Re-exported here so callers keep importing
// `{ honestError, type HonestCopy }` from `~/components/ui/States`.
export { honestError }
export type { HonestCopy }

/** Coerce an unknown thrown value into an ApiError for honest rendering. */
export const asApiError = (e: unknown): ApiError =>
  e instanceof ApiError ? e : new ApiError(e instanceof Error ? e.message : String(e))

/** True for the gate's `ApiError('forbidden', 403)` — the SuperAdmin-required panel. */
export const isForbidden = (err: ApiError): boolean => err.status === 403

/**
 * The ONE gate headline. Exported so a surface that renders its own error card
 * (rather than this panel) says the same words — one predicate, one string.
 */
export const SUPERADMIN_REQUIRED = 'SuperAdmin access required'

/**
 * The SuperAdmin-required panel — the honest UX on top of the authoritative
 * server-side admin gate. Shown when the IAM/KMS gated proxies return 403: the
 * caller is signed in but not authorized for THIS brand's admin console.
 */
export function SuperAdminRequired() {
  const { account } = useSession()
  const brand = getBrand()
  const who = account?.email || account?.name || 'This account'
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$2" maxWidth={620}>
      <XStack gap="$2" items="center">
        <Lock size={16} />
        <Text fontSize="$4" fontWeight="700">
          {SUPERADMIN_REQUIRED}
        </Text>
      </XStack>
      <Text fontSize="$3" color="$color11">
        {who} is not authorized for the {brand.brandName} admin console. This console requires a
        SuperAdmin — a member of the reserved admin org, on an @{brand.adminDomain} account.
      </Text>
    </Card>
  )
}

/** The honest error card — title, explanation, and an optional retry. */
export function ErrorState({
  err,
  onRetry,
  copy,
}: {
  err: ApiError
  onRetry?: () => void
  copy?: HonestCopy
}) {
  const router = useRouter()
  const { title, body, reauth, topUp, subscribe } = honestError(err, copy)
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$2" maxWidth={620}>
      <XStack gap="$2" items="center">
        <TriangleAlert size={16} />
        <Text fontSize="$4" fontWeight="700">
          {title}
        </Text>
      </XStack>
      <Text fontSize="$3" color="$color11">
        {body}
      </Text>
      {subscribe ? (
        // 402 subscription_required — a PLANLESS org. Credits cannot fix this: the
        // paywall would refuse the next request just the same, so send them to plans.
        <Button size="$2" theme="light" self="flex-start" icon={<CreditCard size={14} />} onPress={() => router.push('/plans')}>
          See plans
        </Button>
      ) : topUp ? (
        // 402 — an unfunded org. Send them to top up, not to a dead "Retry".
        <Button size="$2" theme="light" self="flex-start" icon={<CreditCard size={14} />} onPress={() => router.push('/billing/credits')}>
          Add credits
        </Button>
      ) : reauth ? (
        <Button size="$2" theme="light" self="flex-start" onPress={startReauth}>
          Sign in again
        </Button>
      ) : onRetry ? (
        <Button size="$2" self="flex-start" onPress={onRetry}>
          Retry
        </Button>
      ) : null}
    </Card>
  )
}
