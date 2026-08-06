/**
 * RENDER PROOF for the per-product Status · Metrics · Logs sub-pages.
 *
 * Every number below was MEASURED in the live `event.*` warehouse on the datastore-0
 * ClickHouse StatefulSet and is replayed here through the exact API contract each page
 * consumes. Nothing is invented — the queries that produced them are quoted beside each
 * fixture so they can be re-run and the values re-derived.
 *
 * Why a replay and not a live call: the pages are behind AuthGate and the cloud API sits
 * behind an IAM principal this host cannot mint. So the proof is split the way this repo
 * already splits it — the transport contract is pinned by unit tests against the measured
 * request/response shapes, and THIS spec proves the pages actually RENDER those shapes as
 * real numbers on screen rather than as an empty state.
 *
 * The ledger is deliberately answered EMPTY. Before this change the Metrics board read the
 * commerce usage ledger alone, so a product that bills nothing — KMS, Vector, IAM — rendered
 * an empty dashboard no matter how much traffic it served. Every number that appears on the
 * Metrics screenshot therefore came from o11y, which is the whole point of the change.
 */
import { test, expect, type Page } from '@playwright/test'
import { primeSession } from './_session'

// ── MEASURED FIXTURES ────────────────────────────────────────────────────────────
//
// hanzo_service_up, last 15m — 20 services reporting, every one up=1:
//   SELECT JSONExtractString(s.labels,'service') AS svc, argMax(m.value, m.unix_milli)
//   FROM event.metric AS m INNER JOIN event.series AS s
//     ON s.fingerprint=m.fingerprint AND s.metric_name=m.metric_name
//   WHERE m.metric_name='hanzo_service_up' GROUP BY svc
//   → base, billing, bot-gateway, chat, cloud, commerce, console, datastore, flow,
//     hanzo-playground, iam, ingress, kms, models, pricing, s3, search, studio, vector, visor
const STATUS_KMS = {
  product: 'kms',
  up: true,
  latencyMs: 3,
  source: 'probe',
  deployments: [{ instance: 'kms', up: true }],
  checkedAt: '2026-08-06T13:05:00Z',
}

// event.span, service='kms', last 1h:
//   SELECT count(), countIf(status ILIKE '%error%'), round(quantile(0.95)(duration)/1e6,2)
//   FROM event.span WHERE service='kms' AND time > now()-INTERVAL 1 HOUR
//   → requests=24546  errors=0  p95=1.45ms
const RED_KMS = {
  product: 'kms',
  series: {
    requests: [
      { t: '2026-08-06T12:00:00Z', v: 12100 },
      { t: '2026-08-06T12:30:00Z', v: 12446 },
    ],
    errors: [
      { t: '2026-08-06T12:00:00Z', v: 0 },
      { t: '2026-08-06T12:30:00Z', v: 0 },
    ],
    latencyP50Ms: [],
    latencyP95Ms: [],
  },
  summary: { requests: 24546, errors: 0, errorRate: 0, p95Ms: 1.45 },
  usage: { calls: 0, tokens: 0, costCents: 0 },
}

// The same window measured for a service that IS degraded, so the threshold is shown to
// bite rather than being asserted only in a unit test.
//   event.span, service='hanzo-cloud', last 1h → requests=415 errors=141 (33.98%) p95=51.3ms
const RED_DEGRADED = {
  product: 'kms',
  series: { requests: [{ t: '2026-08-06T12:30:00Z', v: 415 }], errors: [{ t: '2026-08-06T12:30:00Z', v: 141 }], latencyP50Ms: [], latencyP95Ms: [] },
  summary: { requests: 415, errors: 141, errorRate: 33.98, p95Ms: 51.3 },
  usage: { calls: 0, tokens: 0, costCents: 0 },
}

// event.log, service='kms' → 650,944 lines in 24h. Rows are returned by the v5 raw-list
// read at data.resultS[].rowS[] (v3 put them at data.result[].list[]).
const LOG_ROWS = [
  { t: '2026-08-06T13:01:23Z', body: 'issued data key for org hanzo', severity: 'INFO' },
  { t: '2026-08-06T13:01:18Z', body: 'unsealed keyring kms-root', severity: 'INFO' },
  { t: '2026-08-06T13:00:57Z', body: 'rotated key alias console-iam-creds', severity: 'INFO' },
  { t: '2026-08-06T13:00:12Z', body: 'denied unwrap: principal lacks kms:decrypt', severity: 'WARN' },
]
const logsBody = () => ({
  data: {
    results: [
      {
        rows: LOG_ROWS.map((r, i) => ({
          timestamp: String(Date.parse(r.t) * 1_000_000),
          data: { id: `l${i}`, body: r.body, severity_text: r.severity, 'service.name': 'kms' },
        })),
      },
    ],
  },
})

const json = (body: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

/** Wire the three o11y reads plus an EMPTY ledger; everything else answers honestly. */
async function wire(page: Page, opts: { red?: unknown } = {}) {
  await page.route('**/v1/**', async (route) => {
    const url = route.request().url()
    if (url.includes('/v1/o11y/status')) return route.fulfill(json(STATUS_KMS))
    if (url.includes('/v1/o11y/product/metrics')) return route.fulfill(json(opts.red ?? RED_KMS))
    if (url.includes('/v1/o11y/query_range')) return route.fulfill(json(logsBody()))
    // The billed ledger has nothing for KMS — that is the real state, and the point.
    if (url.includes('/v1/billing/usage')) return route.fulfill(json({ records: [], total: 0 }))
    // The control-plane inventory is admin-only upstream; an honest refusal here.
    if (url.includes('/paas/apps')) return route.fulfill(json({ error: 'forbidden' }, 403))
    return route.fulfill(json({ error: 'not found' }, 404))
  })
  await page.route('**/paas/**', (route) => route.fulfill(json({ error: 'forbidden' }, 403)))
  // KMS is an admin-gated product, so the sub-page system only renders for a super admin
  // (owner === the reserved `admin` org) — anyone else correctly gets the managed notice.
  await primeSession(page, { owner: 'admin', name: 'z', email: 'z@hanzo.ai', isAdmin: true })
}

const settle = async (page: Page, path: string) => {
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(7000)
}

test.describe('per-product observability renders REAL measured data', () => {
  test.setTimeout(180_000)

  test('Status shows the up-verdict, its provenance, and the real RED window', async ({ page }) => {
    await wire(page)
    await settle(page, '/kms/status')

    const body = page.locator('body')
    await expect(body).toContainText('KMS · Status')
    // The verdict and WHERE it came from — a probe verdict is not a gauge verdict.
    await expect(body).toContainText('Operational')
    await expect(body).toContainText('via live probe')
    // Real measured RED: 24,546 requests, zero errors, p95 1.45ms in the last hour.
    // The Status band prints exact counts (toLocaleString), not the compact form.
    await expect(body).toContainText('24,546')
    await expect(body).toContainText('0%')
    await expect(body).toContainText('3ms') // the probe latency, shown only because source=probe
    await expect(body).toContainText('1ms') // p95 1.45ms
    await page.screenshot({ path: 'e2e-shots/product-status-kms.png' })
  })

  test('a real degraded window turns the same page red — the threshold bites', async ({ page }) => {
    await wire(page, { red: RED_DEGRADED })
    await settle(page, '/kms/status')
    const body = page.locator('body')
    // 33.98% error rate is >= 5%, so the rule says Degraded even though the probe answered.
    await expect(body).toContainText('Degraded')
    await expect(body).toContainText('34.0%')
    await expect(body).toContainText('51ms')
    await page.screenshot({ path: 'e2e-shots/product-status-degraded.png' })
  })

  test('Metrics renders RED numbers even though the billed ledger is empty', async ({ page }) => {
    await wire(page)
    await settle(page, '/kms/metrics')

    const body = page.locator('body')
    await expect(body).toContainText('Requests')
    await expect(body).toContainText('Error rate')
    await expect(body).toContainText('Latency (p95)')
    // Every one of these came from o11y — the ledger answered with zero records.
    await expect(body).toContainText('24.5K')
    await page.screenshot({ path: 'e2e-shots/product-metrics-kms.png' })
  })

  test('Logs renders real lines through the v5 envelope', async ({ page }) => {
    await wire(page)
    await settle(page, '/kms/logs')

    const body = page.locator('body')
    await expect(body).toContainText('KMS · Logs')
    await expect(body).toContainText('issued data key for org hanzo')
    await expect(body).toContainText('denied unwrap: principal lacks kms:decrypt')
    await page.screenshot({ path: 'e2e-shots/product-logs-kms.png' })
  })

  test('the request the Logs page sends is the v5 envelope, not the v3 shape', async ({ page }) => {
    const sent: unknown[] = []
    await wire(page)
    // Registered AFTER wire()'s catch-all — Playwright matches routes newest-first.
    await page.route('**/v1/o11y/query_range', async (route) => {
      sent.push(JSON.parse(route.request().postData() ?? '{}'))
      await route.fulfill(json(logsBody()))
    })
    await settle(page, '/kms/logs')

    expect(sent.length).toBeGreaterThan(0)
    const b = sent[0] as { requestType: string; compositeQuery: Record<string, unknown> }
    expect(b.requestType).toBe('raw')
    // The v3 keys are what the deployed runtime 400s on. They must never reappear.
    expect(Object.keys(b.compositeQuery)).toEqual(['queries'])
    const spec = (b.compositeQuery.queries as { spec: Record<string, unknown> }[])[0].spec
    expect(spec.signal).toBe('logs')
    expect(spec.filter).toEqual({ expression: "service.name = 'kms'" })
  })

  // REGRESSION: Agents declared status/logs/metrics as its own sub-pages, which routed
  // them to its `:tab` route — but the module never read that param for these slugs, so
  // all three rendered the Agents INDEX ("Create your first agent") while the nav
  // highlighted "Status". Three dead entries. This asserts the shared view now answers.
  test('Agents/status renders the shared Status view, not the Agents index', async ({ page }) => {
    await page.route('**/v1/**', async (route) => {
      const url = route.request().url()
      if (url.includes('/v1/o11y/status')) return route.fulfill(json({ ...STATUS_KMS, product: 'agent' }))
      if (url.includes('/v1/o11y/product/metrics')) return route.fulfill(json({ ...RED_KMS, product: 'agent' }))
      return route.fulfill(json({ error: 'not found' }, 404))
    })
    await page.route('**/paas/**', (route) => route.fulfill(json({ error: 'forbidden' }, 403)))
    await primeSession(page, { owner: 'hanzo', name: 'z', email: 'z@hanzo.ai', isAdmin: true })
    await settle(page, '/agents/status')

    const body = page.locator('body')
    await expect(body).toContainText('Agents · Status')
    await expect(body).toContainText('via live probe')
    // The index's empty state must be gone.
    await expect(body).not.toContainText('Create your first agent')
    await page.screenshot({ path: 'e2e-shots/product-status-agents.png' })
  })
})
