'use client'

/**
 * AiUsagePanels — the ONE org AI-usage board body: native Hanzo usage (the
 * canonical `<UsagePanel>` over `GET /v1/get-cloud-usages`) AND, right beside it,
 * the org's IMPORTED third-party usage from its connected OpenAI / Anthropic /
 * Google accounts (`<ConnectedUsage>` over `GET /v1/ai/connections/:provider/usage`).
 *
 * This component owns only the fetch + honest async state for both planes; the two
 * @hanzo/usage components own all rendering. It is the SINGLE implementation of the
 * usage board — shared verbatim by the `ai-metrics` module (`AiUsageModule`) AND the
 * Router product's "Usage" tab (`RouterModule`), so the cross-provider view reads as
 * one system wherever it appears (DRY — never a second copy). Nothing is re-derived
 * client-side; a not-connected / scope-denied provider shows its honest state, never
 * a fabricated figure.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, YStack } from '@hanzo/gui'
import { KeyRound } from '@hanzogui/lucide-icons-2'
import { useRouter } from '~/lib/router'
import { UsagePanel } from '@hanzo/usage/panel'
import { ConnectedUsage } from '@hanzo/usage/connected'
import type { CloudUsageOverview, ProviderUsage, UsageRange } from '@hanzo/usage'

import { CloudUsageApi } from '~/lib/api/cloud-usage'
import { AiConnectionsApi } from '~/lib/api/ai-connections'
import { classifyBackend } from '@hanzo/ui/product'

type NativeState = { phase: 'loading' } | { phase: 'error'; message: string } | { phase: 'ready'; data: CloudUsageOverview }
type ConnState = { phase: 'loading' } | { phase: 'error'; message: string } | { phase: 'ready'; items: ProviderUsage[] }

/** Map the panel's 24h/7d/30d range to an RFC3339 [from,to] window for the connected
 *  provider import (the provider APIs are day-bucketed; a 24h window yields ≤1 bucket). */
function rangeWindow(range: UsageRange): { from: string; to: string } {
  const to = new Date()
  const from = new Date(to)
  const days = range === '24h' ? 1 : range === '7d' ? 7 : 30
  from.setUTCDate(from.getUTCDate() - days)
  return { from: from.toISOString(), to: to.toISOString() }
}

/**
 * @param title    Native-usage panel heading (defaults to the AI Metrics wording).
 * @param subtitle Native-usage panel sub-heading.
 */
export function AiUsagePanels({
  title = 'AI Metrics',
  subtitle = 'Requests, tokens, spend, and per-model usage for your org — native Hanzo usage (GET /v1/get-cloud-usages).',
}: { title?: string; subtitle?: string } = {}) {
  const router = useRouter()
  const [range, setRange] = useState<UsageRange>('7d')
  const [native, setNative] = useState<NativeState>({ phase: 'loading' })
  const [conn, setConn] = useState<ConnState>({ phase: 'loading' })

  const loadNative = useCallback((r: UsageRange) => {
    setNative({ phase: 'loading' })
    CloudUsageApi.overview(r)
      .then((data) => setNative({ phase: 'ready', data }))
      .catch((e) => setNative({ phase: 'error', message: classifyBackend(e).message }))
  }, [])

  const loadConnected = useCallback((r: UsageRange) => {
    setConn({ phase: 'loading' })
    const { from, to } = rangeWindow(r)
    AiConnectionsApi.listWithUsage(from, to)
      .then((items) => setConn({ phase: 'ready', items }))
      .catch((e) => setConn({ phase: 'error', message: classifyBackend(e).message }))
  }, [])

  useEffect(() => {
    loadNative(range)
    loadConnected(range)
  }, [loadNative, loadConnected, range])

  return (
    <YStack gap="$6">
      <UsagePanel
        title={title}
        subtitle={subtitle}
        range={range}
        onRangeChange={setRange}
        data={native.phase === 'ready' ? native.data : null}
        loading={native.phase === 'loading'}
        error={native.phase === 'error' ? native.message : null}
        onRetry={() => loadNative(range)}
      />
      <ConnectedUsage
        subtitle="Imported spend and usage from your connected OpenAI, Anthropic, and Google accounts — beside your native Hanzo usage."
        items={conn.phase === 'ready' ? conn.items : null}
        loading={conn.phase === 'loading'}
        error={conn.phase === 'error' ? conn.message : null}
        onRetry={() => loadConnected(range)}
        headerAction={
          <Button size="$2" icon={<KeyRound size={14} />} onPress={() => router.push('/connections')}>
            Manage connections
          </Button>
        }
      />
    </YStack>
  )
}

