'use client'

/**
 * useModels — the REAL model catalog for the composer, as `ModelOption[]`.
 *
 * Built on the ONE shared catalog hook (`~/components/products/useModelCatalog` →
 * `aicatalog.fetchCatalog`, through the keyless `/ai` proxy). It derives the composer's
 * `ModelOption` view (clean name, provider, context, $/Mtok in/out, availability,
 * featured, premium) AND passes the raw rich `entries` straight through — the unified
 * `ModelSelector` groups those by family. One fetch, one honest loading/error state; an
 * unreachable catalog never invents rows.
 */
import { useMemo } from 'react'

import {
  modelId,
  modelContext,
  modelDisplayName,
  displayProvider,
  type CatalogEntry,
} from '~/lib/api/aicatalog'
import { useModelCatalog } from '~/components/products/useModelCatalog'
import type { ModelPricing } from '~/lib/api'
import { type BackendState } from '@hanzo/ui/product'

/** A pickable model with the facts the composer needs. */
export type ModelOption = {
  /** Stable routing id sent to the gateway. */
  id: string
  /** Clean display name (provider prefix stripped). */
  name: string
  provider: string
  /** Context window in tokens, or null when unknown. */
  context: number | null
  /** $/Mtok input price, or null. */
  inputPrice: number | null
  /** $/Mtok output price, or null. */
  outputPrice: number | null
  /** Servable right now (vs catalog-only). */
  available: boolean
  /** Editorially promoted/featured in the catalog — drives the default pick. */
  featured: boolean
  /** Premium (requires a PAID balance) — the gateway 402s these for a trial-only
   *  ($5 welcome) balance, so the auto-default skips them. Absent ⇒ non-premium. */
  premium?: boolean
}

export type ModelsCatalog = {
  phase: 'loading' | 'error' | 'ready'
  options: ModelOption[]
  /** The raw rich catalog entries — fed straight into the unified `ModelSelector`. */
  entries: CatalogEntry[]
  error: BackendState | null
  byId: Map<string, ModelOption>
  reload: () => void
}

export function useModels(): ModelsCatalog {
  const cat = useModelCatalog()

  const options = useMemo<ModelOption[]>(
    () =>
      cat.entries
        .map((m) => ({
          id: modelId(m),
          // Fall back to the id so a live-only entry (no rich name) never renders blank.
          name: modelDisplayName(m) || modelId(m),
          provider: displayProvider(m.provider),
          context: modelContext(m),
          inputPrice: typeof m.pricing?.input === 'number' ? m.pricing.input : null,
          outputPrice: typeof m.pricing?.output === 'number' ? m.pricing.output : null,
          available: m.available,
          featured: !!m.featured,
          premium: !!m.premium,
        }))
        .filter((o) => o.id.length > 0),
    [cat.entries],
  )

  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options])

  return { phase: cat.phase, options, entries: cat.entries, error: cat.error, byId, reload: cat.reload }
}

/** The `ModelPricing` ($/Mtok) the cost helper expects, or null when unpriced. */
export function pricingOf(opt: ModelOption | undefined): ModelPricing | null {
  if (!opt) return null
  if (opt.inputPrice == null && opt.outputPrice == null) return null
  return {
    inputPerMillion: opt.inputPrice ?? undefined,
    outputPerMillion: opt.outputPrice ?? undefined,
  }
}

// The default-model pick is pure policy (latest promoted Zen flagship) — it lives
// in ./default-model so it's unit-testable without this hook's React/UI imports.
// Re-exported so the composer imports the catalog hook and its default from ONE module.
export { defaultModelId } from './default-model'
