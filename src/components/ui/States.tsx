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
import { TriangleAlert } from '@hanzogui/lucide-icons-2'

import { ApiError } from '~/lib/api'

/** Surface-specific overrides for the 404/unauthorized explanations. */
export type HonestCopy = { notFound?: string; unauthorized?: string }

/** Map an ApiError to an honest title + body. Defaults are generic and truthful. */
export function honestError(err: ApiError, copy: HonestCopy = {}): { title: string; body: string } {
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
  if (err.status === 401 || err.status === 403 || /sign ?in|login|unauthorized/i.test(err.message))
    return {
      title: 'Access required',
      body:
        copy.unauthorized ??
        'This view requires an authorized session, enforced server-side. Sign in with an account that has access.',
    }
  return { title: 'Could not load', body: err.message }
}

/** Coerce an unknown thrown value into an ApiError for honest rendering. */
export const asApiError = (e: unknown): ApiError =>
  e instanceof ApiError ? e : new ApiError(e instanceof Error ? e.message : String(e))

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
  const { title, body } = honestError(err, copy)
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
      {onRetry ? (
        <Button size="$2" self="flex-start" onPress={onRetry}>
          Retry
        </Button>
      ) : null}
    </Card>
  )
}
