/**
 * Fleet availability — how much of the Hanzo platform is up right now, and how much was
 * up across a window. ONE read, `GET /v1/o11y/availability` (HIP-0139), PLATFORM SUDO:
 * the whole fleet's inventory is not tenant data, so every customer is 403.
 *
 * The number is the fleet prober's own measurement (cloud apps/o11y/probes.go): each
 * service is asked its OWN health URL every 30 seconds, so a service is listed down
 * because it did not answer, never because something failed to collect it. There is no
 * per-replica identity under it — a Service address is not a pod — so a row carries the
 * service and the verdict and nothing that would have to be invented.
 *
 * Honest two ways. An empty inventory folds to zeros and an empty trend, never a
 * fabricated health dot. And a store that cannot be reached answers 503, which arrives
 * here as a thrown ApiError for the caller to render as unavailable: a board of zeroes
 * and a fleet that is entirely down look identical, and painting one as the other is the
 * most expensive lie a status surface can tell.
 *
 * `range` is clamped server-side (7d ceiling) and `stepSec` to [30, 3600]; the response
 * reports what was ACTUALLY used, which is why a caller reads `range` back instead of
 * assuming the numbers it asked for. The shaper is pure (JSON in, view-model out), so it
 * unit-tests without a live store.
 */
import { ApiError, cloudProxyV1Url, restGet } from './client'

// ── View models ──────────────────────────────────────────────────────────────

/** One probed service: its name, and whether it answered its health URL last cycle. */
export type ServiceHealth = { name: string; up: boolean }

/**
 * One measurement of the fleet, covering `stepSec` of the trend. `total` is how many
 * services reported at all across that span, and it can be LOWER than the fleet's total
 * today — a service added last week reported nothing the week before, and saying so is
 * the point.
 */
export type Sample = {
  /** Start of the span, RFC3339 in UTC. */
  t: string
  /** How many services were up at the end of the span. */
  up: number
  /** How many services reported at all across the span. */
  total: number
}

/** The whole platform-health board in one read: the instant inventory and the trend. */
export type Availability = {
  /** How many services are up right now. */
  up: number
  /** How many services the prober currently watches. */
  total: number
  /** The current inventory, sorted by name. */
  services: ServiceHealth[]
  /** The trend, oldest first. */
  series: Sample[]
  /** The window and step the server ACTUALLY used, after clamping. */
  range: { sinceSec: number; stepSec: number }
}

// ── Shaper (JSON in, view-model out) ─────────────────────────────────────────

const int = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0)
const rows = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

/** Fold the availability read into the board. Anything absent counts as zero, not as up. */
export function parseAvailability(body: unknown): Availability {
  const w = (body ?? {}) as {
    up?: unknown
    total?: unknown
    services?: unknown
    series?: unknown
    range?: { sinceSec?: unknown; stepSec?: unknown }
  }
  return {
    up: int(w.up),
    total: int(w.total),
    services: rows<{ name?: unknown; up?: unknown }>(w.services)
      .filter((s) => typeof s?.name === 'string' && s.name !== '')
      .map((s) => ({ name: s.name as string, up: s.up === true })),
    series: rows<{ t?: unknown; up?: unknown; total?: unknown }>(w.series)
      .filter((p) => typeof p?.t === 'string' && p.t !== '')
      .map((p) => ({ t: p.t as string, up: int(p.up), total: int(p.total) })),
    range: { sinceSec: int(w.range?.sinceSec), stepSec: int(w.range?.stepSec) },
  }
}

// ── Transport ────────────────────────────────────────────────────────────────

/** `<origin>/v1/o11y/availability` (root-relative on the server, where there is no `window`). */
const url = (params: Record<string, number | undefined>): string => {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, String(v))
  const path = cloudProxyV1Url('o11y/availability')
  const query = q.toString()
  return query ? `${path}?${query}` : path
}

export const TelemetryApi = {
  /**
   * Read the fleet: how many services are up now, the current inventory, and the
   * up-versus-reporting trend across `range` seconds. Omit `range` to take the server's
   * hour, and `stepSec` to let it pick ~60 steps; both come back on `range` clamped.
   */
  availability: async (range?: number, stepSec?: number): Promise<Availability> =>
    parseAvailability(await restGet<unknown>(url({ range, stepSec }))),
}

/** Re-export the typed error so callers classify 403/503 honestly. */
export { ApiError }
