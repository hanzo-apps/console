/**
 * The per-service metric fold + fetch orchestration for the App Platform canvas.
 *
 * The pure folds (`productForApp`, `cardMetric`) turn a real o11y `ServiceMetrics`
 * read into the `@hanzo/canvas` `ServiceMetric` the card sparkline accepts — honest by
 * construction: a service with no telemetry yields `undefined` (no sparkline, the exact
 * prior empty state), never a fabricated flat line. `fetchCardMetrics` reads the o11y
 * per-service metrics for the VISIBLE apps (concurrency-capped, keyed by app id) so the
 * canvas can preview real request activity per node.
 *
 * o11y exposes REQUESTS / errors / latency per service (RED, trace-derived), not
 * CPU/memory — the card previews requests; the drawer's Metrics tab shows the full
 * requests/errors/latency set and labels CPU/memory honestly as not-exposed.
 */
import type { ServiceMetric } from '@hanzo/canvas/pure'

import { O11yMetricsApi, type ServiceMetrics } from '~/lib/api/o11y-metrics'
import type { PlatformApp } from '~/lib/api/platform-apps'
import { mapLimit } from '~/lib/map-limit'

/** Compact number for the card value (1234 → "1.2K") — the console's standard idiom. */
const compact = (n: number): string =>
  new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n)

/**
 * The o11y `product` slug for an app — its DNS-safe slug (the deployed workload name).
 * The metrics endpoint aliases + allowlists this server-side, so an app whose slug maps
 * to a live workload gets real data and any other app gets an honest-empty 200.
 */
export function productForApp(app: PlatformApp): string {
  return app.slug || app.name || app.id
}

/**
 * Fold the o11y RED read into the card's single Requests `ServiceMetric` (the glanceable
 * preview). `undefined` when the service reported no telemetry — the node then shows no
 * sparkline, identical to the prior honest empty state; a real link is never invented.
 */
export function cardMetric(r: ServiceMetrics): ServiceMetric | undefined {
  if (!r.hasData) return undefined
  return { label: 'req', points: r.requests.map((p) => p.v), value: compact(r.summary.requests) }
}

/**
 * Fetch the card Requests metric for each app, keyed by `app.id`. Concurrency-capped;
 * an app with no telemetry (or an o11y miss) is simply absent from the map — the canvas
 * renders it without a sparkline, never a fabricated one. `O11yMetricsApi.service`
 * already swallows transport errors into `connected:false`, so one app can't break the batch.
 */
export async function fetchCardMetrics(apps: PlatformApp[], rangeSec = 3600): Promise<Map<string, ServiceMetric>> {
  const out = new Map<string, ServiceMetric>()
  await mapLimit(apps, 6, async (a) => {
    const r = await O11yMetricsApi.service(productForApp(a), { rangeSec })
    const m = cardMetric(r)
    if (m) out.set(a.id, m)
  })
  return out
}
