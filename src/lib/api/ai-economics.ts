/**
 * AI Economics — the model-mix + unit-economics + training/eval flywheel lens for
 * admin.hanzo.ai. GLOBAL-ADMIN only. The STRATEGIC sibling of Provider Billing
 * (the treasury credit/funding lens): this one answers the operator question
 * "how many <model A> requests vs <model B> vs …, at what margin, and how does the
 * eval/training loop feed the next router" — the KEY being the per-(provider,model)
 * REQUEST MIX.
 *
 * It COMPOSES the existing admin reads rather than forking them:
 *   - model mix     ← `ProviderBillingApi.funding` (`GET /v1/admin/usage/funding`),
 *                     folded by (provider, model) into request-share (`foldModelMix`).
 *   - profitability ← `FinanceApi.finance` (`GET /v1/admin/finance`) +
 *                     `ProviderBillingApi.credit` (`GET /v1/admin/providers/credit`).
 *   - training/eval ← `EvalsApi.listDatasets` / `listRuns` (`/v1/evals/*`, org-scoped).
 *
 * The metering ledger `hanzo.cloud_usage` (on OUR datastore — hanzoai/datastore)
 * records ONE row per inference call with counts + cost and NO prompt/completion
 * CONTENT: there is no traffic harvesting and no consent flag anywhere, so the only
 * "training data" the platform holds is the user-curated eval dataset registry (plus
 * the datasets a fine-tune run points at through `/v1/ai/finetune/jobs`) — never a
 * fabricated pipeline. Every
 * rollup here is a PURE function over real rows; nothing is invented (a missing value
 * degrades to 0 / '' / an em dash at the render site).
 */
import { ProviderBillingApi, type FundingRow } from './provider-billing'
import type { RangeKey } from './aimetrics'
import type { EvalDataset, EvalDatasetRun } from './evals'

// ── model mix (the KEY): requests / share / tokens / cost per provider+model ──

/** One (provider, model) row of the request mix over the window. */
export type ModelMixRow = {
  provider: string
  model: string
  requests: number
  tokens: number
  costCents: number
  /** Share of total requests in the window, 0..1 — the request-mix headline. */
  requestShare: number
}

/** The folded request mix: per (provider, model) rows + grand total + counts. */
export type ModelMix = {
  /** Rows sorted by requests (desc), then cost (desc). */
  rows: ModelMixRow[]
  total: { requests: number; tokens: number; costCents: number }
  /** Distinct (provider, model) pairs. */
  models: number
  /** Distinct providers. */
  providers: number
}

const mixKey = (r: { provider: string; model: string }): string => `${r.provider}||${r.model}`

/**
 * Fold the funding rows (one per provider/model/funding-class) into the request mix
 * by (provider, model) — summing ACROSS funding classes, since the mix question is
 * "how many requests hit each model", independent of how the call was funded.
 * `requestShare` is each row's fraction of the window's total requests (0 when there
 * is no traffic). Sorted so the most-requested model reads first.
 */
export function foldModelMix(rows: FundingRow[]): ModelMix {
  const by = new Map<string, ModelMixRow>()
  const providers = new Set<string>()
  const total = { requests: 0, tokens: 0, costCents: 0 }
  for (const r of rows) {
    const cur =
      by.get(mixKey(r)) ??
      { provider: r.provider, model: r.model, requests: 0, tokens: 0, costCents: 0, requestShare: 0 }
    cur.requests += r.requests
    cur.tokens += r.tokens
    cur.costCents += r.costCents
    by.set(mixKey(r), cur)
    if (r.provider) providers.add(r.provider)
    total.requests += r.requests
    total.tokens += r.tokens
    total.costCents += r.costCents
  }
  const out = Array.from(by.values())
  for (const row of out) row.requestShare = total.requests > 0 ? row.requests / total.requests : 0
  out.sort((a, b) => b.requests - a.requests || b.costCents - a.costCents)
  return { rows: out, total, models: out.length, providers: providers.size }
}

/**
 * Top-N models by REQUESTS for the share donut, aggregating each model ACROSS
 * providers (the "which model" lens), with the long tail folded into one "Other"
 * slice. `value` is a request count; the caller assigns categorical colors. Returns
 * `[]` for an empty mix (the Donut then renders its honest em dash).
 */
export function topModelShares(mix: ModelMix, topN = 6): { label: string; value: number }[] {
  const byModel = new Map<string, number>()
  for (const r of mix.rows) {
    const label = r.model || r.provider || 'unknown'
    byModel.set(label, (byModel.get(label) ?? 0) + r.requests)
  }
  const sorted = Array.from(byModel, ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
  if (sorted.length <= topN) return sorted
  const top = sorted.slice(0, topN)
  const other = sorted.slice(topN).reduce((s, x) => s + x.value, 0)
  if (other > 0) top.push({ label: 'Other', value: other })
  return top
}

// ── profitability tone (presentation only, over the real derived margin) ──────

/** Health tone for a gross-margin %: healthy ≥ 50, thin ≥ 0, underwater below 0. */
export function marginTone(grossMarginPct: number): 'ok' | 'warn' | 'crit' {
  if (grossMarginPct < 0) return 'crit'
  if (grossMarginPct < 50) return 'warn'
  return 'ok'
}

/** A gross-margin % → a compact signed label like `+62%` / `-8%` / `—`. */
export function marginPctLabel(grossMarginPct: number | null | undefined): string {
  if (grossMarginPct == null || !Number.isFinite(grossMarginPct)) return '—'
  const r = Math.round(grossMarginPct)
  return `${r > 0 ? '+' : ''}${r}%`
}

// ── training-data + eval flywheel counts (over the eval registry, real rows) ──

/** The honest "what training data exists" tally — user-curated eval datasets only. */
export type DatasetStats = { datasets: number; items: number }

/** Count datasets and sum their item counts (`EvalDataset.items`), degrading a
 *  missing/garbage item count to 0 (never a fabricated total). */
export function datasetStats(datasets: EvalDataset[]): DatasetStats {
  return {
    datasets: datasets.length,
    items: datasets.reduce((s, d) => s + (typeof d.items === 'number' && Number.isFinite(d.items) ? d.items : 0), 0),
  }
}

/** The most recent runs (by `createdAt` desc; undated sort last), capped at `n`. */
export function recentRuns(runs: EvalDatasetRun[], n = 8): EvalDatasetRun[] {
  const at = (s?: string): number => (s ? Date.parse(s) : NaN)
  return [...runs]
    .sort((a, b) => {
      const ta = at(a.createdAt)
      const tb = at(b.createdAt)
      const na = Number.isNaN(ta)
      const nb = Number.isNaN(tb)
      if (na && nb) return 0
      if (na) return 1
      if (nb) return -1
      return tb - ta
    })
    .slice(0, n)
}

/** Format an eval score: a 0..1 judge score as a percent, any other scale to 2 dp,
 *  and a null/non-finite value as an honest em dash. */
export function fmtScore(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  if (v >= 0 && v <= 1) return `${Math.round(v * 100)}%`
  return v.toFixed(2)
}

// ── API (composition of the existing admin reads) ─────────────────────────────

export const AiEconomicsApi = {
  /**
   * The model request mix over a window — reuses the SAME admin usage/funding read
   * Provider Billing uses (`ProviderBillingApi.funding`), folded by (provider, model)
   * into request-share. Throws the same typed `ApiError` (403 → operator gate, 404 →
   * not routed yet) the caller renders as an honest state.
   */
  modelMix: async (range: RangeKey, now: number = Date.now()): Promise<ModelMix> =>
    foldModelMix(await ProviderBillingApi.funding(range, now)),
}
