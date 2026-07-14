'use client'

/**
 * AI Metrics — the org's AI usage: requests, tokens, spend, per-model breakdown,
 * and recent activity. Renders the ONE canonical `<UsagePanel>` (`@hanzo/usage/react`)
 * over the server-owned `GET /v1/get-cloud-usages` overview — no bespoke re-derivation,
 * no second copy of the shape. This module only owns the fetch + honest async state;
 * the panel owns all the usage rendering (header, range tabs, cards, chart, breakdown,
 * activity), so this surface looks identical to every other Hanzo usage surface.
 */
import { useCallback, useEffect, useState } from 'react'
import { UsagePanel } from '@hanzo/usage/react'
import type { CloudUsageOverview, UsageRange } from '@hanzo/usage'

import { classifyBackend } from '~/components/ui/BackendState'
import { CloudUsageApi } from '~/lib/api/cloud-usage'

type State = { phase: 'loading' } | { phase: 'error'; message: string } | { phase: 'ready'; data: CloudUsageOverview }

export function AiUsageModule(_props: { params: Record<string, string> }) {
  const [range, setRange] = useState<UsageRange>('7d')
  const [state, setState] = useState<State>({ phase: 'loading' })

  const load = useCallback((r: UsageRange) => {
    setState({ phase: 'loading' })
    CloudUsageApi.overview(r)
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', message: classifyBackend(e).message }))
  }, [])

  useEffect(() => {
    load(range)
  }, [load, range])

  return (
    <UsagePanel
      title="AI Metrics"
      subtitle="Requests, tokens, spend, and per-model usage for your org — from the cloud usage ledger (GET /v1/get-cloud-usages)."
      range={range}
      onRangeChange={setRange}
      data={state.phase === 'ready' ? state.data : null}
      loading={state.phase === 'loading'}
      error={state.phase === 'error' ? state.message : null}
      onRetry={() => load(range)}
    />
  )
}

export default AiUsageModule
