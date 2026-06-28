'use client'

/**
 * The ONE honest state for an observability surface whose fetch failed.
 *
 * The `/v1/o11y` runtime returns 503 until its telemetry stores + query service
 * are initialized (and 404 where the surface is unrouted, 401/403 on access). We
 * never fabricate traces, sessions, scores, or charts — this card explains the
 * real reason and names the endpoint, so an empty observability area always reads
 * truthfully.
 */
import { Card, Text, XStack } from '@hanzo/gui'
import { TriangleAlert } from '@hanzogui/lucide-icons-2'

import { ApiError } from '~/lib/api'
import { config } from '~/config'

export type RuntimeStatus = 'not-initialized' | 'unavailable' | 'access' | 'error'

/** Map a failed o11y fetch to an honest runtime status. */
export function classifyRuntime(e: unknown): RuntimeStatus {
  const s = e instanceof ApiError ? e.status : 0
  if (s === 503) return 'not-initialized'
  if (s === 404) return 'unavailable'
  if (s === 401 || s === 403) return 'access'
  return 'error'
}

const TITLE: Record<RuntimeStatus, string> = {
  'not-initialized': 'Observability runtime initializing',
  unavailable: 'Not routed on this host',
  access: 'Access required',
  error: 'Could not reach observability',
}

export function RuntimeNotice({ surface, error }: { surface: string; error: unknown }) {
  const status = classifyRuntime(error)
  const message = error instanceof Error ? error.message : String(error)
  const body: Record<RuntimeStatus, string> = {
    'not-initialized': `The /v1/o11y routes are mounted, but the observability runtime (telemetry stores, query service) is not initialized on this deployment yet, so ${surface} cannot be read. This page shows live ${surface} the moment the runtime is online — it never shows placeholder data.`,
    unavailable: `The /v1/o11y/${surface} surface is not proxied on this host yet.`,
    access: `Sign in with an account that can read observability ${surface}.`,
    error: message,
  }
  return (
    <Card p="$4" gap="$2" borderWidth={1} borderColor="$borderColor" maxWidth={680}>
      <XStack gap="$2" items="center">
        <TriangleAlert size={16} />
        <Text fontSize="$4" fontWeight="700">
          {TITLE[status]}
        </Text>
      </XStack>
      <Text fontSize="$3" color="$color11">
        {body[status]}
      </Text>
      <Text fontSize="$2" color="$color10">
        endpoint · /v1/o11y/{surface} · {config.brandName}
      </Text>
    </Card>
  )
}
