'use client'

/**
 * Honest platform states — ONE place that maps a `/paas` proxy / platform error
 * to a truthful explanation, shared by every platform module (Clusters,
 * Kubernetes). No fabricated data: a 501 means the proxy has no service token
 * yet, a 404 means the platform backend doesn't serve that surface yet, anything
 * else is the real error.
 */
import { Button, Card, Text, XStack } from '@hanzo/gui'
import { TriangleAlert } from '@hanzogui/lucide-icons-2'

import { ApiError } from '~/lib/api'

export type PlatformErrorKind = 'not-configured' | 'unavailable' | 'error'

export type PlatformError = { kind: PlatformErrorKind; message: string }

/** Classify a thrown error from a `/paas` call into an honest kind + message. */
export function interpretPlatformError(e: unknown): PlatformError {
  const status = e instanceof ApiError ? e.status : 0
  const message = e instanceof Error ? e.message : String(e)
  if (status === 501) return { kind: 'not-configured', message }
  if (status === 404) return { kind: 'unavailable', message }
  return { kind: 'error', message }
}

const TITLES: Record<PlatformErrorKind, string> = {
  'not-configured': 'PaaS control plane not configured',
  unavailable: 'Backend not yet available',
  error: 'Could not reach the platform',
}

const BODIES: Record<PlatformErrorKind, string> = {
  'not-configured':
    'This console is wired to platform.hanzo.ai, but the server-side service token (PAAS_SERVICE_TOKEN, from KMS) is not set on this deployment yet. Once it is, real data appears here. No placeholder data is shown.',
  unavailable:
    'The platform backend does not serve this endpoint yet (it ships separately). This view lights up automatically once the endpoint is live.',
  error: '',
}

/** A truthful state card for a platform load failure. */
export function PlatformStateCard({ error, onRetry }: { error: PlatformError; onRetry?: () => void }) {
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$2" maxWidth={640}>
      <XStack gap="$2" items="center">
        <TriangleAlert size={16} />
        <Text fontSize="$4" fontWeight="700">
          {TITLES[error.kind]}
        </Text>
      </XStack>
      <Text fontSize="$3" color="$color11">
        {BODIES[error.kind] || error.message}
      </Text>
      {onRetry ? (
        <Button size="$2" self="flex-start" onPress={onRetry}>
          Retry
        </Button>
      ) : null}
    </Card>
  )
}
