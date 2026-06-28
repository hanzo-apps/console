'use client'

/**
 * Honest backend states for `/v1`-backed modules (Playground, Evals, Datasets,
 * Prompts) — ONE place that maps a thrown `ApiError` to a truthful explanation.
 *
 * These surfaces compose the model gateway and the console eval engine through
 * the cloud `/v1` facade. A 503 means the runtime/keys aren't wired on this
 * deployment yet, a 404/405 means the route isn't mounted here, 401/403 means
 * the session can't read it. Nothing is fabricated — on failure the caller shows
 * this card instead of placeholder rows/charts.
 */
import type { ReactNode } from 'react'
import { Button, Card, Text, XStack } from '@hanzo/gui'
import { TriangleAlert } from '@hanzogui/lucide-icons-2'

import { ApiError } from '~/lib/api'

export type BackendStateKind = 'not-initialized' | 'unavailable' | 'access' | 'error'

export type BackendState = { kind: BackendStateKind; message: string }

/** Classify a thrown `/v1` error into an honest kind + raw message. */
export function classifyBackend(e: unknown): BackendState {
  const status = e instanceof ApiError ? e.status : 0
  const message = e instanceof Error ? e.message : String(e)
  if (status === 503) return { kind: 'not-initialized', message }
  if (status === 404 || status === 405) return { kind: 'unavailable', message }
  if (status === 401 || status === 403) return { kind: 'access', message }
  return { kind: 'error', message }
}

const TITLES: Record<BackendStateKind, string> = {
  'not-initialized': 'Backend not initialized',
  unavailable: 'Not available on this deployment yet',
  access: 'Access required',
  error: 'Could not reach the backend',
}

const BODIES: Record<BackendStateKind, string> = {
  'not-initialized':
    'The /v1 route is mounted but its runtime (or the console API key it proxies to) is not configured on this deployment yet. Real data appears here once it is — no placeholder data is shown.',
  unavailable:
    'This endpoint is not mounted at the gateway on this host yet. The view lights up automatically once the route is live.',
  access: 'Sign in with an account that can read this data.',
  error: '',
}

/** A truthful state card for a `/v1` load failure, with an optional retry + hint. */
export function BackendStateCard({
  state,
  onRetry,
  hint,
}: {
  state: BackendState
  onRetry?: () => void
  hint?: ReactNode
}) {
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$2" maxWidth={640}>
      <XStack gap="$2" items="center">
        <TriangleAlert size={16} />
        <Text fontSize="$4" fontWeight="700">
          {TITLES[state.kind]}
        </Text>
      </XStack>
      <Text fontSize="$3" color="$color11">
        {BODIES[state.kind] || state.message}
      </Text>
      {hint ? (
        <Text fontSize="$2" color="$color10">
          {hint}
        </Text>
      ) : null}
      {onRetry ? (
        <Button size="$2" self="flex-start" onPress={onRetry}>
          Retry
        </Button>
      ) : null}
    </Card>
  )
}
