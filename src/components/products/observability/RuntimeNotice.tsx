'use client'

/**
 * The ONE honest state for an observability surface whose fetch failed.
 *
 * The verdict and the words are `runtime.ts` (pure, tested against real statuses);
 * this file only renders them. We never fabricate traces, sessions, scores, or
 * charts — the card explains what the backend actually did and names the endpoint,
 * so an empty observability area always reads truthfully.
 */
import { Button, Card, Text, XStack } from '@hanzo/gui'
import { BarChart3, TriangleAlert } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { startReauth } from '~/lib/auth/iam'
import { runtimeCopy, type RuntimeStatus } from './runtime'

/**
 * The states where AI Metrics is a genuine alternative: the org's own usage data
 * (from the commerce billing ledger) is real and readable while the trace runtime
 * is unprovisioned, unrouted, or not enabled for them. A 405 or a 5xx is a defect
 * or an outage — offering a different page instead of naming the fault would read
 * as a shrug, so those states link nowhere.
 */
const OFFERS_METRICS: readonly RuntimeStatus[] = ['not-initialized', 'unavailable', 'access']

export function RuntimeNotice({ surface, error }: { surface: string; error: unknown }) {
  const { status, title, body } = runtimeCopy(surface, error)
  const goToMetrics = () => {
    if (typeof window !== 'undefined') window.location.assign('/ai-metrics')
  }
  return (
    <Card p="$4" gap="$2" borderWidth={1} borderColor="$borderColor" maxWidth={680}>
      <XStack gap="$2" items="center">
        <TriangleAlert size={16} />
        <Text fontSize="$4" fontWeight="700">
          {title}
        </Text>
      </XStack>
      <Text fontSize="$3" color="$color11">
        {body}
      </Text>
      {status === 'signin' ? (
        <Button size="$2" theme="light" self="flex-start" onPress={startReauth}>
          Sign in again
        </Button>
      ) : OFFERS_METRICS.includes(status) ? (
        <Button size="$2" self="flex-start" icon={<BarChart3 size={15} />} onPress={goToMetrics}>
          View AI Metrics
        </Button>
      ) : null}
      <Text fontSize="$2" color="$color10">
        endpoint · /v1/o11y/{surface} · {config.brandName}
      </Text>
    </Card>
  )
}
