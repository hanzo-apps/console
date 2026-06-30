/**
 * Cost — turn REAL token usage + the model's catalog pricing into dollars.
 *
 * Pricing is the SAME best-effort overlay the Models page loads
 * (`CloudModelApi.list()` → `CatalogModel.pricing`, normalized to $/million
 * tokens). When a price is missing the cost reads "—" rather than being
 * fabricated, exactly like the Model Catalog table. Pure — unit-tested.
 */
import type { ChatUsage, ModelPricing } from '~/lib/api'

export type Cost = { inputUsd: number | null; outputUsd: number | null; totalUsd: number | null }

/** Dollar cost of a completion from its usage and the model's $/Mtok pricing. */
export function costOf(usage: ChatUsage | null | undefined, pricing: ModelPricing | null | undefined): Cost {
  const none: Cost = { inputUsd: null, outputUsd: null, totalUsd: null }
  if (!usage || !pricing) return none
  const inputUsd =
    pricing.inputPerMillion != null && usage.prompt_tokens != null
      ? (usage.prompt_tokens / 1_000_000) * pricing.inputPerMillion
      : null
  const outputUsd =
    pricing.outputPerMillion != null && usage.completion_tokens != null
      ? (usage.completion_tokens / 1_000_000) * pricing.outputPerMillion
      : null
  const totalUsd = inputUsd == null && outputUsd == null ? null : (inputUsd ?? 0) + (outputUsd ?? 0)
  return { inputUsd, outputUsd, totalUsd }
}

/** Format a dollar amount; per-run costs are sub-cent, so keep precision when small. */
export function formatUsd(v: number | null | undefined): string {
  if (v == null) return '—'
  if (v === 0) return '$0'
  if (v < 0.000001) return '<$0.000001'
  if (v < 0.01) return `$${v.toFixed(6)}`
  if (v < 1) return `$${v.toFixed(4)}`
  return `$${v.toFixed(2)}`
}

/** Format a latency in ms as "123 ms" or "1.23 s". */
export function formatLatency(ms: number | null | undefined): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

/** Format a token count; null/undefined → "—". */
export function formatTokens(n: number | null | undefined): string {
  return n == null ? '—' : n.toLocaleString()
}

/** Tokens-per-second throughput from completion tokens and total time. */
export function tokensPerSecond(
  usage: ChatUsage | null | undefined,
  totalMs: number | null | undefined,
): number | null {
  if (!usage || usage.completion_tokens == null || !totalMs || totalMs <= 0) return null
  return usage.completion_tokens / (totalMs / 1000)
}
