/**
 * Hanzo Research — the typed client for the R&D EVIDENCE plane (`/v1/research/*`,
 * HIP-0512). One reader for the falsifiable-experiment corpus every product self-logs
 * (kernel-perf, benchmark, training, ablation, policy-eval): the headline totals with a
 * per-kind breakdown, and the experiment ledger latest-run-canonical.
 *
 * Same-origin `/v1/research/*` through the user-bearer BFF (the `research` head is
 * allow-listed in proxy-allow.ts); the org is resolved server-side from the Bearer owner
 * claim, so a cookie-only call 403s and the caller renders an honest state. The BFF
 * strips the browser project sub-scope, so a project-less read returns the org's WHOLE
 * research set across projects — the cross-project board.
 *
 * These endpoints speak PLAIN REST (bare JSON — `{data,total}` for the ledger, a bare
 * totals object), NOT the casibase `{status,data}` envelope, so they read through
 * `restGet` (never `get`/`originGet`, which unwrap `.data` and demand `status:'ok'`).
 * Optional-safe normalizers tolerate snake_case + camelCase and degrade a missing field
 * to '' / 0 / [] — never a fabricated result. The scientific frame
 * (hypothesis/predict/verdict/because/log) is parsed from the free-form `meta` JSON the
 * SDKs stamp (ml/hanzo-research `Meta`).
 */
import { restGet, cloudProxyV1Url } from './client'

/** The epistemic verdict on a stated hypothesis. A refutation is a FIRST-CLASS result,
 *  as durable as a proof; '' is an unconcluded / hypothesis-free run. */
export type Verdict = 'proven' | 'refuted' | 'inconclusive' | ''

/** The scientific frame + narrative that travels with an experiment (the `meta` JSON). */
export interface ExperimentMeta {
  hypothesis: string
  predict: string
  verdict: Verdict
  because: string
  log: string[]
  doc: string
  note: string
  commits: string[]
  host: string
}

/** One experiment latest-run-canonical — a ledger row (`<kind>:<subject>:<task>`). */
export interface Experiment {
  project: string
  id: string
  kind: string
  subject: string
  task: string
  metric: string
  value: number
  n: number
  nTotal: number
  costUsd: number
  status: string
  ts: number
  endpoint: string
  meta: ExperimentMeta
}

/** One kind's slice of the totals aggregate. */
export interface KindTotal {
  kind: string
  experiments: number
  costUsd: number
}

/** The headline aggregate across the org's research (or one project). */
export interface Totals {
  projects: number
  experiments: number
  attempts: number
  models: number
  benchmarks: number
  costUsd: number
  byKind: KindTotal[]
}

// ── defensive coercion (snake_case OR camelCase; missing/garbage → honest zero) ──
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const num = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : 0
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
/** A string array, tolerating a single-string value (degrades to a one-element list). */
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' && v !== '' ? [v] : [])
/** First present of the given keys (camel + snake variants). */
const pick = (o: Record<string, unknown>, ...keys: string[]): unknown => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k]
  return undefined
}

const VERDICTS: readonly string[] = ['proven', 'refuted', 'inconclusive']
/** Clamp a free-form verdict to the closed set; anything else is honestly unconcluded. */
const verdict = (v: unknown): Verdict => {
  const s = str(v).trim().toLowerCase()
  return (VERDICTS.includes(s) ? s : '') as Verdict
}

/** Coerce a `meta` that may arrive as a nested object (json.RawMessage) OR a JSON string. */
const asObject = (v: unknown): Record<string, unknown> => {
  if (typeof v === 'string') {
    try {
      return rec(JSON.parse(v))
    } catch {
      return {}
    }
  }
  return rec(v)
}

/** Parse the scientific frame from the free-form `meta` JSON — every field optional-safe. */
export function normalizeMeta(v: unknown): ExperimentMeta {
  const m = asObject(v)
  const host = pick(m, 'host')
  return {
    hypothesis: str(pick(m, 'hypothesis')),
    predict: str(pick(m, 'predict')),
    verdict: verdict(pick(m, 'verdict')),
    because: str(pick(m, 'because')),
    log: strs(pick(m, 'log')),
    doc: str(pick(m, 'doc')),
    note: str(pick(m, 'note')),
    commits: strs(pick(m, 'commits')),
    // `host` is `{hostname,platform}` on the wire; degrade to a bare hostname string.
    host: host && typeof host === 'object' ? str(pick(rec(host), 'hostname')) : str(host),
  }
}

function normalizeExperiment(raw: unknown): Experiment {
  const r = rec(raw)
  return {
    project: str(pick(r, 'project')),
    id: str(pick(r, 'id')),
    kind: str(pick(r, 'kind')),
    subject: str(pick(r, 'subject')),
    task: str(pick(r, 'task')),
    metric: str(pick(r, 'metric')),
    value: num(pick(r, 'value')),
    n: num(pick(r, 'n')),
    nTotal: num(pick(r, 'nTotal', 'n_total')),
    costUsd: num(pick(r, 'costUsd', 'cost_usd')),
    status: str(pick(r, 'status')),
    ts: num(pick(r, 'ts')),
    endpoint: str(pick(r, 'endpoint')),
    meta: normalizeMeta(pick(r, 'meta')),
  }
}

const normalizeKind = (raw: unknown): KindTotal => {
  const r = rec(raw)
  return { kind: str(pick(r, 'kind')), experiments: num(pick(r, 'experiments')), costUsd: num(pick(r, 'costUsd', 'cost_usd')) }
}

/** Normalize the raw `/v1/research/totals` payload (a bare totals object). */
export function normalizeTotals(raw: unknown): Totals {
  const r = rec(raw)
  return {
    projects: num(pick(r, 'projects')),
    experiments: num(pick(r, 'experiments')),
    attempts: num(pick(r, 'attempts')),
    models: num(pick(r, 'models')),
    benchmarks: num(pick(r, 'benchmarks')),
    costUsd: num(pick(r, 'costUsd', 'cost_usd')),
    byKind: arr(pick(r, 'byKind', 'by_kind')).map(normalizeKind).filter((k) => k.kind),
  }
}

/** Normalize the raw `/v1/research/experiments` payload (`{data,total}` or a bare array). */
export function normalizeExperiments(raw: unknown): Experiment[] {
  const rows = Array.isArray(raw) ? raw : arr(pick(rec(raw), 'data', 'experiments', 'items'))
  return rows.map(normalizeExperiment).filter((e) => e.id || e.subject)
}

export const ResearchApi = {
  /** The org's experiment ledger, latest-run-canonical across every project. Throws a
   *  typed `ApiError` (403 for a non-authorized caller) the board renders as an honest
   *  state — never a fabricated corpus. */
  experiments: async (): Promise<Experiment[]> => normalizeExperiments(await restGet<unknown>(cloudProxyV1Url('research/experiments'))),
  /** The headline totals + per-kind breakdown for the org. */
  totals: async (): Promise<Totals> => normalizeTotals(await restGet<unknown>(cloudProxyV1Url('research/totals'))),
}
