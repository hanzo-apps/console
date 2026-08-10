/**
 * Router client — the per-org router policy + the routing observability read,
 * over the canonical same-origin `/v1` surface (v1-first: no service prefix, no
 * nested version).
 *
 *   GET  /v1/router/policy              → the effective policy resolved for the
 *                                         caller's org (org > "*" > conf)
 *   PUT  /v1/router/policy              → upsert the caller's OWN org policy
 *   GET  /v1/router/stats               → the org-scoped routing aggregate (cost
 *                                         saved, quality proxy, distributions)
 *   GET  /v1/get-training-contribution  → the org's opt-in flag
 *   POST /v1/update-training-contribution → set the org's opt-in flag
 *
 * Standalone console: the `next.config` AI-head dispatch terminates these at the
 * `/ai` user-bearer proxy (session cookie → short-lived minted bearer → the
 * hanzoai/ai gateway; org from the token owner, never browser-supplied).
 * go:embed console: the same `/v1/*` paths hit cloud natively. Every endpoint is
 * org-admin gated / RequirePrincipal server-side, so a customer reads and writes
 * only its own org — never another tenant's.
 *
 * The policy is the org's router prefer table (task tag → ordered model ids,
 * "default" is the catch-all) + a per-1k cost ceiling + an enabled-models
 * allowlist (empty = all allowed) + a savings↔quality dial (0..1). An empty
 * prefer + 0 ceiling clears the org override (reverts to "*" then conf).
 */
import { originGet, originPost, originPatch, originPut } from './client'

/** One servable model the org may allow the router to pick from (rows the allowlist multi-select). */
export type RouterModel = { id: string; name: string }

/** The effective router policy for the caller's org, plus whether the org has its own override. */
export type RouterPolicy = {
  prefer: Record<string, string[]>
  costCeiling: number
  /** The org's allowlist of model ids the router may pick from. Empty/absent = ALL models allowed. */
  enabledModels?: string[]
  /** Savings↔quality dial: 0 = cheapest, 1 = best model, 0.5 = balanced. `null`/absent = unset (→ balanced). */
  qualityBias?: number | null
  /** ALL servable models for the org — the source for the allowlist multi-select. Read-only (GET only). */
  available?: RouterModel[]
  hasOverride?: boolean
}

export const RouterPolicyApi = {
  /** The effective policy resolved for the caller's own org (org > "*" > conf). */
  get: (): Promise<RouterPolicy> => originGet('router/policy'),
  /** Upsert the caller's OWN org policy (prefer + costCeiling + enabledModels + qualityBias)
   *  via PUT — empty prefer + 0 ceiling + empty allowlist clears the override. */
  save: (body: RouterPolicy): Promise<RouterPolicy> => originPut('router/policy', body),
}

// ── Routing observability (GET /v1/router/stats) ─────────────────────────────
// The wire contract mirrors the Go `routerStats` struct (hanzoai/ai
// controllers/router_stats.go). Every field the console reads is OPTIONAL-safe:
// `cost` is absent when no priced events land in the window; `routed_index` /
// `counterfactual_index` are present only in ORG scope (the absolute $/MTok
// levels); `shadow_agreement` is null until a shadow model is scored; `retrain`
// is absent until a nightly job publishes. The pure normalizer (`router/logic.ts`)
// turns any partial payload into honest "—"/empty, never a fabricated number.

/** The resolved time window + the total events scanned in it. */
export type StatsWindow = { since: string; until: string; events: number }

/**
 * Cost saved by routing — a BLENDED $/MTok PROXY (the ledger has no per-token
 * counts), NOT billed dollars. `routed_index` = avg served-model blended index;
 * `counterfactual_index` = the premium single model the org would default to
 * without routing. Both are nullable (present only in org scope with priced
 * events). `saved_pct` = (cf − routed)/cf; `cumulative_saved_index` sums the
 * per-request (cf − routed). `priced_events` is the coverage (0 → honest "—").
 */
export type CostStats = {
  routed_index?: number | null
  counterfactual_index?: number | null
  saved_pct: number
  cumulative_saved_index: number
  baseline_model: string
  priced_events: number
}

/** Quality proxy — learned-reward + learned share + confidence; shadow nullable. */
export type QualityStats = {
  reward_rate: number
  rewarded_events: number
  learned_share: number
  avg_confidence: number
  shadow_agreement: number | null
}

/** Per-task routed-model distribution (models by served count). */
export type TaskStats = { events: number; models: Record<string, number> }

/** Per-hour throughput buckets (24) + the window total. */
export type ThroughputStats = { per_hour: number[]; total_window: number }

/** The last retrain's gate verdict (published/kept-incumbent), when present. */
export type RetrainMeta = {
  version: string
  trained_time: string
  events: number
  gate_passed: boolean
  published: boolean
  gate_kind: string
  gate_metric: string
  gate_value: number
  gate_base: number
  note: string
}

/** The `/v1/router/stats` aggregate (org scope carries the real ids + $ indices). */
export type RouterStats = {
  scope: string
  org?: string
  window: StatsWindow
  cost?: CostStats | null
  quality: QualityStats
  by_task: Record<string, TaskStats>
  by_model: Record<string, number>
  throughput: ThroughputStats
  retrain?: RetrainMeta | null
}

/** Window selector: `hours` (default 24, capped 90d server-side) or an RFC3339 `since` (wins). */
export type StatsWindowParams = { hours?: number; since?: string }

export const RouterStatsApi = {
  /** The org-scoped routing aggregate for the caller's own org (RequirePrincipal). */
  get: (params: StatsWindowParams = {}): Promise<RouterStats> =>
    originGet('router/stats', {
      ...(params.since ? { since: params.since } : {}),
      ...(params.hours != null ? { hours: params.hours } : {}),
    }),
}

// ── Training-data contribution opt-in ────────────────────────────────────────

/** The org's opt-in flag for improving routing with its own usage (feature vectors only). */
export type TrainingContribution = { enabled: boolean }

export const TrainingContributionApi = {
  /** Read the caller org's opt-in flag. */
  get: (): Promise<TrainingContribution> => originGet('ai/training-contribution'),
  /** Set the caller org's opt-in flag (org-admin gated + self-scoped server-side). */
  save: (enabled: boolean): Promise<TrainingContribution> =>
    originPatch('ai/training-contribution', { enabled }),
}
