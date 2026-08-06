/**
 * Per-PRODUCT status from the cloud-native o11y surface — `GET /v1/o11y/status?product=<slug>`.
 * This is the ONE org-scoped read that answers "is this product actually up", and it is the
 * only per-product path backed by the `hanzo_service_up` gauge.
 *
 * Transport: the same-origin `/v1` user-bearer BFF (`cloudProxyV1Url`), like every other cloud
 * head; the `o11y` head is allow-listed in `proxy-allow.ts`. Plain REST (raw JSON, real HTTP
 * status), so `restGet` throws a typed `ApiError` carrying the status — surfaced as
 * `reachable:false` rather than an exception, so a miss renders an honest notice and never a
 * fabricated verdict.
 *
 * ── THE STATUS RULE (verbatim from cloud `apps/o11y/status.go` `probeStatus`) ──
 * Exactly TWO signals are consulted, in this order. There is NO error-rate term:
 *
 *   1. A live HTTP probe against the service's fleet-registry URL (2s timeout).
 *      Probe succeeds            → up = true,     source = "probe"
 *   2. Otherwise the `hanzo_service_up` gauge (`event.metric` JOIN `event.series`).
 *      Any instance reporting up → up = anyVMUp,  source = "datastore"
 *   3. Neither answered          → up = false,    source = "unreachable"
 *
 *   source = "unknown-service" means the slug is well-formed but has no backing workload —
 *   nothing was probed. That is NOT "down"; it is "nothing to report", and the UI must say so.
 *
 * ── TWO TRAPS THIS MODULE ENCODES SO CALLERS CANNOT GET THEM WRONG ──
 *  A. `latencyMs` is 0 whenever the PROBE FAILED — not because the service was fast. Rendering
 *     it unconditionally prints a confident "0ms" for a dead service. So `latencyMs` is exposed
 *     as `probeLatencyMs: number | null`, non-null ONLY when `source === 'probe'`.
 *  B. `deployments` is NOT a replica list. Per-replica identity is gone upstream; the gauge is
 *     per Service address, so the array is at most ONE row whose `instance` is the service name.
 *     Callers must not build a per-replica table out of it.
 */
import { ApiError, cloudProxyV1Url, restGet } from './client'

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Where the verdict came from. Drives how much the UI is entitled to claim. */
export type StatusSource = 'probe' | 'datastore' | 'unreachable' | 'unknown-service'

/** One reporting address. At most one row — see trap B; never a replica table. */
export type StatusDeployment = { instance: string; up: boolean }

export type ProductStatus = {
  product: string
  /** The verdict. Meaningless unless `reachable` — and never shown for `unknown-service`. */
  up: boolean
  source: StatusSource
  /** Non-null ONLY for a successful probe (trap A). Null means "not measured", not "0ms". */
  probeLatencyMs: number | null
  deployments: StatusDeployment[]
  checkedAt: string
  /** True = o11y answered (200). False = unreachable/unconfigured (503/404/401/403). */
  reachable: boolean
  /** HTTP status when `reachable` is false — lets the caller render the honest reason. */
  status: number
}

const SOURCES: StatusSource[] = ['probe', 'datastore', 'unreachable', 'unknown-service']
const asSource = (v: unknown): StatusSource => {
  const s = str(v)
  return (SOURCES as string[]).includes(s) ? (s as StatusSource) : 'unreachable'
}

/** True when o11y has nothing to report for this slug — not a failure, and never a red dot. */
export const isUnknownService = (s: ProductStatus): boolean => s.source === 'unknown-service'

/** Normalize a raw status body, defensively — a garbage payload degrades, never throws. */
export function normalizeProductStatus(raw: unknown, fallbackProduct = ''): ProductStatus {
  const r = (raw ?? {}) as Record<string, unknown>
  const source = asSource(r.source)
  const rows = Array.isArray(r.deployments) ? r.deployments : []
  return {
    product: str(r.product) || fallbackProduct,
    up: r.up === true,
    source,
    // Trap A: a non-probe verdict never carries a real latency.
    probeLatencyMs: source === 'probe' ? num(r.latencyMs) : null,
    deployments: rows.map((d) => {
      const o = (d ?? {}) as Record<string, unknown>
      return { instance: str(o.instance), up: o.up === true }
    }),
    checkedAt: str(r.checkedAt),
    reachable: true,
    status: 200,
  }
}

/** The honest not-reachable result — o11y itself did not answer. */
function unreachable(product: string, status: number): ProductStatus {
  return {
    product,
    up: false,
    source: 'unreachable',
    probeLatencyMs: null,
    deployments: [],
    checkedAt: '',
    reachable: false,
    status,
  }
}

export const O11yStatusApi = {
  /**
   * Live status for ONE product slug. Never throws: an o11y transport error resolves to
   * `reachable:false` carrying the HTTP status, so the caller renders an honest reason.
   *
   * NOTE (fleet): there is deliberately no whole-inventory call here. The fleet-wide read
   * (`GET /v1/o11y/availability`) is platform-sudo gated, so a status column across N
   * products costs N calls — callers must design for that rather than reaching for a
   * bulk endpoint a customer cannot use.
   */
  product: async (product: string): Promise<ProductStatus> => {
    const slug = product.trim().toLowerCase()
    if (!slug) return unreachable(product, 0)
    try {
      const sp = new URLSearchParams({ product: slug })
      return normalizeProductStatus(await restGet<unknown>(cloudProxyV1Url(`o11y/status?${sp.toString()}`)), slug)
    } catch (e) {
      return unreachable(slug, e instanceof ApiError ? e.status : 0)
    }
  },
}
