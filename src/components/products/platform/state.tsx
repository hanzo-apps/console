'use client'

/**
 * Honest platform states — ONE place that maps a `/paas` proxy / platform error
 * to a truthful explanation, shared by every platform module (Clusters,
 * Kubernetes). No fabricated data: a 501 means the proxy has no service token
 * yet, a 404 means the platform backend doesn't serve that surface yet, anything
 * else is the real error.
 */
import { Button, Card, Text, XStack } from '@hanzo/gui'
import { CheckCircle2, TriangleAlert } from '@hanzogui/lucide-icons-2'

import { ApiError } from '~/lib/api'

export type PlatformErrorKind = 'not-configured' | 'forbidden' | 'unavailable' | 'error'

export type PlatformError = { kind: PlatformErrorKind; message: string }

/** Classify a thrown error from a `/paas` call into an honest kind + message. */
export function interpretPlatformError(e: unknown): PlatformError {
  const status = e instanceof ApiError ? e.status : 0
  const message = e instanceof Error ? e.message : String(e)
  // 501 = the console's PaaS service token is not set (an ADMIN infra concern).
  // 401/403 = the CALLER can't read the control plane — a customer (not a workspace
  // admin), NOT a token problem: show a graceful "managed control plane" state, never
  // the infra PAAS_SERVICE_TOKEN message (that would be a false claim to a customer).
  if (status === 501) return { kind: 'not-configured', message }
  if (status === 401 || status === 403) return { kind: 'forbidden', message }
  if (status === 404) return { kind: 'unavailable', message }
  return { kind: 'error', message }
}

const TITLES: Record<PlatformErrorKind, string> = {
  'not-configured': 'PaaS control plane not configured',
  forbidden: 'Connected · managed by Hanzo',
  unavailable: 'Backend not yet available',
  error: 'Could not reach the platform',
}

const BODIES: Record<PlatformErrorKind, string> = {
  'not-configured':
    'This console is wired to platform.hanzo.ai, but the server-side service token (PAAS_SERVICE_TOKEN, from KMS) is not set on this deployment yet. Once it is, real data appears here. No placeholder data is shown.',
  forbidden:
    'Your workloads run on managed Hanzo Cloud — no cluster to operate. The full control-plane fleet view (clusters, nodes, raw workloads) is an admin surface; deploy and scale through Functions, Agents, and the platform.',
  unavailable:
    'The platform backend does not serve this endpoint yet (it ships separately). This view lights up automatically once the endpoint is live.',
  error: '',
}

/**
 * A truthful state card for a platform load. `forbidden` is a CONNECTED, customer-
 * appropriate "managed by Hanzo" state (green check, no Retry) — the caller reached the
 * control plane, it's just admin-scoped; it must NOT read like a warning/error. The other
 * kinds are genuine problems (warning triangle + Retry).
 */
export function PlatformStateCard({ error, onRetry }: { error: PlatformError; onRetry?: () => void }) {
  const connected = error.kind === 'forbidden'
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$2" maxWidth={640}>
      <XStack gap="$2" items="center">
        {connected ? <CheckCircle2 size={16} color="$green10" /> : <TriangleAlert size={16} />}
        <Text fontSize="$4" fontWeight="700">
          {TITLES[error.kind]}
        </Text>
      </XStack>
      <Text fontSize="$3" color="$color11">
        {BODIES[error.kind] || error.message}
      </Text>
      {onRetry && !connected ? (
        <Button size="$2" self="flex-start" onPress={onRetry}>
          Retry
        </Button>
      ) : null}
    </Card>
  )
}
