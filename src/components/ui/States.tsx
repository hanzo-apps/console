'use client'

/**
 * Honest async states — the ONE way the console explains a failed/empty load.
 *
 * Every admin module that reads a real `/v1` endpoint can 404 (not routed on
 * this deployment), 401/403 (access enforced server-side), or 503 (backend
 * starting). `honestError` maps an `ApiError` to a specific, truthful message —
 * never a generic crash and never fabricated data — and `ErrorState` renders it
 * with a retry. Per-call copy overrides keep surface-specific guidance (e.g. the
 * IAM admin API) without duplicating the structure.
 */
import { Button, Card, Text, XStack } from '@hanzo/gui'
import { TriangleAlert, Lock } from '@hanzogui/lucide-icons-2'

import { ApiError } from '~/lib/api'
import { useSession } from '~/lib/auth/session'
import { startReauth } from '~/lib/auth/iam'
import { getBrand } from '~/lib/branding/brands'

/** Surface-specific overrides for the 404/unauthorized explanations. */
export type HonestCopy = { notFound?: string; unauthorized?: string }

/**
 * Map an ApiError to an honest title + body. Defaults are generic and truthful.
 *
 * 401 and 403 are DISTINCT: a 401 means the session lapsed (re-auth fixes it →
 * `reauth`), a 403 means the signed-in account isn't authorized for this surface.
 * A signed-in user is NEVER told to "sign in" for a 403.
 */
export function honestError(
  err: ApiError,
  copy: HonestCopy = {},
): { title: string; body: string; reauth?: boolean } {
  if (err.status === 404)
    return {
      title: 'Not available on this deployment',
      body:
        copy.notFound ??
        'This API is not routed on this host yet. It appears automatically once the deployment proxies it through the gateway.',
    }
  if (err.status === 503)
    return {
      title: 'Service unavailable',
      body: 'The service is starting up or temporarily unavailable. Retry in a moment.',
    }
  if (err.status === 401)
    return {
      title: 'Your session expired',
      body: 'Your session has expired or isn’t recognized here. Sign in again to continue where you left off.',
      reauth: true,
    }
  if (err.status === 403 || /sign ?in|login|unauthorized/i.test(err.message))
    return {
      title: 'Access required',
      body:
        copy.unauthorized ??
        "You're signed in, but this account isn't authorized for this — it's an admin-only surface, or it isn't enabled for your organization yet.",
    }
  return { title: 'Could not load', body: err.message }
}

/** Coerce an unknown thrown value into an ApiError for honest rendering. */
export const asApiError = (e: unknown): ApiError =>
  e instanceof ApiError ? e : new ApiError(e instanceof Error ? e.message : String(e))

/** True for the gate's `ApiError('forbidden', 403)` — the operator-access panel. */
export const isForbidden = (err: ApiError): boolean => err.status === 403

/**
 * The operator-access-required panel — the honest UX on top of the authoritative
 * server-side admin gate. Shown when the IAM/KMS gated proxies return 403: the
 * caller is signed in but not authorized for THIS brand's admin console.
 */
export function OperatorAccessRequired() {
  const { account } = useSession()
  const brand = getBrand()
  const who = account?.email || account?.name || 'This account'
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$2" maxWidth={620}>
      <XStack gap="$2" items="center">
        <Lock size={16} />
        <Text fontSize="$4" fontWeight="700">
          Operator access required
        </Text>
      </XStack>
      <Text fontSize="$3" color="$color11">
        {who} is not authorized for the {brand.brandName} admin console. This console requires an
        @{brand.adminDomain} account with an admin role.
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
  const { title, body, reauth } = honestError(err, copy)
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
      {reauth ? (
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
