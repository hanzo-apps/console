'use client'

/**
 * useModels — the REAL model catalog for the composer's model picker.
 *
 * Source is the rich `/v1/pricing/models` catalog via `aicatalog.fetchCatalog`
 * (through the keyless `/ai` proxy, so the user bearer is attached server-side) —
 * the SAME 375-model catalog the Models page renders. Each option carries the
 * model's real context window, $/Mtok input/output price, true provider, and live
 * availability, so the chip's "128K context" badge and the COST box are real, not
 * fabricated. Honest loading/error state; an unreachable catalog never invents rows.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  fetchCatalog,
  modelId,
  modelContext,
  modelDisplayName,
  displayProvider,
} from '~/lib/api/aicatalog'
import { classifyBackend, type BackendState } from '~/components/ui/BackendState'
import type { ModelPricing } from '~/lib/api'

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
}

type State =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; options: ModelOption[] }

export type ModelsCatalog = {
  phase: State['phase']
  options: ModelOption[]
  error: BackendState | null
  byId: Map<string, ModelOption>
  reload: () => void
}

export function useModels(): ModelsCatalog {
  const [state, setState] = useState<State>({ phase: 'loading' })

  const reload = useCallback(() => {
    setState({ phase: 'loading' })
    fetchCatalog()
      .then((entries) => {
        const options: ModelOption[] = entries
          .map((m) => ({
            id: modelId(m),
            name: modelDisplayName(m),
            provider: displayProvider(m.provider),
            context: modelContext(m),
            inputPrice: typeof m.pricing?.input === 'number' ? m.pricing.input : null,
            outputPrice: typeof m.pricing?.output === 'number' ? m.pricing.output : null,
            available: m.available,
          }))
          .filter((o) => o.id.length > 0)
        setState({ phase: 'ready', options })
      })
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  useEffect(() => reload(), [reload])

  const options = state.phase === 'ready' ? state.options : []
  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options])

  return { phase: state.phase, options, error: state.phase === 'error' ? state.error : null, byId, reload }
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

const AUX = /(embed|tts|whisper|speech|rerank|image|diffusion|flux|dall|guard|moderation)/i

/**
 * Pick a sensible default model: prefer our own Zen text models that are servable
 * now, then any servable text model, then the first catalog entry. Auxiliary
 * (embedding/audio/image) models are skipped for the chat default.
 */
export function defaultModelId(options: ModelOption[]): string {
  if (options.length === 0) return ''
  const text = options.filter((o) => !AUX.test(o.id))
  const zen = text.filter((o) => /zen/i.test(o.id) || o.provider.toLowerCase() === 'zen')
  const pickAvail = (arr: ModelOption[]): ModelOption | undefined => arr.find((o) => o.available) ?? arr[0]
  return (pickAvail(zen) ?? pickAvail(text) ?? options[0]).id
}
