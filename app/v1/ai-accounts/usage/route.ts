/**
 * Unified AI-account usage — the Overview data plane.
 *
 * For each CONNECTED provider it runs the headless `@hanzo/usage` pipeline
 * server-side over the Node host, decrypting the sealed credential into the
 * usage-engine settings (`settingsFor`) only in memory for the fetch. It ALSO
 * merges the org's own Hanzo lane — the REAL commerce usage ledger overview,
 * fetched through the tested `/billing` proxy (the SAME source the Billing/Overview
 * dashboards read), so `/ai-accounts` shows Hanzo + every linked provider side by side.
 *
 * A static route, so it wins over the sibling `[...path]` catch-all for this exact
 * path. Session-gated; a secret is never logged or returned.
 */
import { type NextRequest, NextResponse } from 'next/server'
import { nodeHost } from '@hanzo/usage/node'
import { runPipeline } from '@hanzo/usage'

import { resolveUser } from '~/lib/server/identity'
import { readAccounts, descriptorFor, settingsFor } from '~/lib/server/ai-accounts'
import { forwardBilling } from '~/lib/server/billing-proxy'
import { normalizeUsageRecords } from '~/lib/api/aimetrics'
import { buildCloudUsageOverview } from '~/lib/api/usage-adapter'
import type { CloudUsageOverview } from '~/lib/api/usage'
import type { ProviderUsage } from '~/lib/api/ai-accounts'

export const runtime = 'nodejs'

const msgOf = (e: unknown): string => (e instanceof Error ? e.message : 'Fetch failed.')

/** The org's own Hanzo Cloud lane: the real commerce ledger overview, null on any miss. */
async function hanzoLane(req: NextRequest): Promise<CloudUsageOverview | null> {
  try {
    const res = await forwardBilling(req, ['usage'])
    if (!res.ok) return null
    const records = normalizeUsageRecords(await res.json())
    return buildCloudUsageOverview(records, {
      range: '30d',
      topModels: 6,
      activityType: 'all',
      activityLimit: 8,
      activityOffset: 0,
      now: Date.now(),
      product: null,
    })
  } catch {
    return null
  }
}

/** Run the usage pipeline for one connected provider. */
async function providerUsage(id: string, cred: ReturnType<typeof readAccounts>[string]): Promise<ProviderUsage> {
  const descriptor = descriptorFor(id)
  if (!descriptor) return { id, ok: false, error: 'Unknown provider.' }
  const { mode, settings } = settingsFor(cred)
  try {
    const outcome = await runPipeline(descriptor, { host: nodeHost, sourceMode: mode, settings })
    if (outcome.result) return { id, ok: true, usage: outcome.result.usage }
    return { id, ok: false, error: msgOf(outcome.error) }
  } catch (e) {
    return { id, ok: false, error: msgOf(e) }
  }
}

export async function GET(req: NextRequest) {
  const user = await resolveUser(req)
  if (!user) return NextResponse.json({ error: 'Sign in to view usage.' }, { status: 401 })

  const store = readAccounts(req)
  const [providers, hanzo] = await Promise.all([
    Promise.all(Object.entries(store).map(([id, cred]) => providerUsage(id, cred))),
    hanzoLane(req),
  ])

  return NextResponse.json({ providers, hanzo })
}
