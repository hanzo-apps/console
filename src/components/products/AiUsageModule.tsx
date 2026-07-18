'use client'

/**
 * AI Metrics — the org's AI usage in ONE place (native Hanzo usage beside the org's
 * imported connected-provider usage). A thin registry adapter over the shared
 * `<AiUsagePanels>` body, which the Router product's "Usage" tab also renders — so
 * there is ONE implementation of the usage board (DRY), never a second copy.
 */
import { AiUsagePanels } from './usage/AiUsagePanels'

export function AiUsageModule(_props: { params: Record<string, string> }) {
  return <AiUsagePanels />
}

