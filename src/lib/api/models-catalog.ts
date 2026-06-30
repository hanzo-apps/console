/**
 * Cloud model catalog API — the available models served by the gateway.
 *
 * Ported from hanzoai/console features/cloud-models (server/cloudModelClient.ts +
 * server/router.ts). The catalog is the OpenAI-compatible model list at
 * `/v1/models` ({ object, data:[{ id, owned_by, premium, created }] }) — plain
 * JSON, NOT the casibase `{status,msg,data}` envelope — so it goes through the
 * REST layer (`restGet`), same as the plans rate card.
 *
 * Per-model token pricing is a best-effort overlay from `/v1/pricing/models`
 * ({ models:[{ id, pricing }] }). If that endpoint is unrouted or down, models
 * still list (prices read "—") — pricing is never fabricated.
 */
import { restGet, v1Url, aiV1Url } from './client'

/** One model as published by the OpenAI-compatible `/v1/models` list. */
export type CloudModel = {
  id: string
  object: string
  created: number
  owned_by: string
  /** Premium/paid tier flag (present on the Hanzo cloud surface). */
  premium?: boolean
}

type CloudModelsResponse = { object: string; data: CloudModel[] }

/** Per-token pricing for a model, normalized to $/million tokens. */
export type ModelPricing = {
  inputPerMillion?: number
  outputPerMillion?: number
}

/** A catalog model with its pricing overlay (null when pricing is unavailable). */
export type CatalogModel = CloudModel & { pricing: ModelPricing | null }

/** Friendly labels for the `owned_by` provider id. Falls back to the raw id. */
export const providerLabels: Record<string, string> = {
  'do-ai': 'DigitalOcean AI',
  fireworks: 'Fireworks AI',
  'openai-direct': 'OpenAI Direct',
  anthropic: 'Anthropic',
  hanzo: 'Zen',
}

type RawPricing = {
  models?: Array<{
    id: string
    pricing?: {
      input_cost_per_token?: number
      output_cost_per_token?: number
      input_cost_per_mtok?: number
      output_cost_per_mtok?: number
    }
  }>
}

/** Best-effort pricing map (id -> $/Mtok). Empty on any failure — never throws. */
async function fetchPricing(): Promise<Map<string, ModelPricing>> {
  const map = new Map<string, ModelPricing>()
  try {
    const data = await restGet<RawPricing>(v1Url('pricing/models'))
    for (const m of data.models ?? []) {
      const p = m.pricing
      if (!p) continue
      map.set(m.id, {
        inputPerMillion:
          p.input_cost_per_mtok ??
          (p.input_cost_per_token != null ? p.input_cost_per_token * 1_000_000 : undefined),
        outputPerMillion:
          p.output_cost_per_mtok ??
          (p.output_cost_per_token != null ? p.output_cost_per_token * 1_000_000 : undefined),
      })
    }
  } catch {
    // Pricing API unreachable — models still render without prices.
  }
  return map
}

export const CloudModelApi = {
  /**
   * The available model catalog with best-effort pricing. Throws `ApiError` if
   * the models endpoint itself is unrouted/unauthorized (the caller renders an
   * honest state); pricing failures degrade silently to "no price".
   */
  list: async (): Promise<CatalogModel[]> => {
    const [res, pricing] = await Promise.all([
      // Through the `/ai` proxy: it adds the user bearer the gateway requires.
      // (Cookie-only `/v1/models` 401s → empty catalog — the "models missing" bug.)
      restGet<CloudModelsResponse>(aiV1Url('models')),
      fetchPricing(),
    ])
    return (res.data ?? []).map((m) => ({ ...m, pricing: pricing.get(m.id) ?? null }))
  },
}
