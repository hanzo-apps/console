/**
 * Model sync admin API — force model config reload and live pricing refresh.
 *
 * GLOBAL-ADMIN only. These calls hit the console's own same-origin `/v1/admin/*`
 * rewrite surface, so the browser never talks to the cloud host directly.
 */
import { originPost } from './client'

export type ModelSyncResult = {
  lastPricingRefresh: string | null
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

function normalizeResult(raw: unknown): ModelSyncResult {
  const r = (raw ?? {}) as Record<string, unknown>
  const lastPricingRefresh = str(r.lastPricingRefresh || r.last_pricing_refresh)
  if (!lastPricingRefresh || lastPricingRefresh.startsWith('0001-01-01T00:00:00')) {
    return { lastPricingRefresh: null }
  }
  return { lastPricingRefresh }
}

export const ModelSyncApi = {
  reloadConfig: async (): Promise<ModelSyncResult> => normalizeResult(await originPost<unknown>('admin/reload-model-config')),
  refreshPricing: async (): Promise<ModelSyncResult> => normalizeResult(await originPost<unknown>('admin/refresh-model-pricing')),
}
