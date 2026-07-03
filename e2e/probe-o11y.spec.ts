/**
 * LIVE probe of the o11y (SigNoz) backend through the console's own /cloud bearer
 * proxy. Logs in as z@hanzo.ai and, from the AUTHENTICATED page context, fetches
 * each candidate endpoint exactly as the new Observe modules will — same-origin
 * `<origin>/v1/o11y/*` (rewritten to `/cloud/v1/o11y/*`, cloud rewrites to the o11y
 * runtime's `/api/*`). Prints the HTTP status + a body snippet per endpoint so we
 * know what returns real data vs 404 (which must be flagged) before we build.
 *
 * Not a pass/fail test — a discovery harness. Run:
 *   BASE_URL=https://console.hanzo.ai HANZO_PASSWORD='…' npx playwright test probe-o11y --reporter=line
 */
import { test, type Page } from '@playwright/test'

const EMAIL = process.env.HANZO_EMAIL ?? 'z@hanzo.ai'
const PASSWORD = process.env.HANZO_PASSWORD ?? ''
const BASE_URL = process.env.BASE_URL ?? 'https://console.hanzo.ai'

async function signIn(page: Page) {
  await page.goto(`${BASE_URL}/signin`)
  await page.waitForSelector('input[placeholder="Email"]', { timeout: 20_000 })
  await page.fill('input[placeholder="Email"]', EMAIL)
  await page.fill('input[placeholder="Password"]', PASSWORD)
  await page.click('button:has-text("Sign in")')
  const base = new URL(BASE_URL).origin
  await page.waitForURL((url) => url.origin === base && url.pathname === '/', { timeout: 30_000 })
  await page.waitForLoadState('domcontentloaded')
}

/** now() epoch — SigNoz wants ns for services/errors, ms for infra. */
const nowMs = Date.now()
const endNs = String(nowMs * 1_000_000)
const startNs = String((nowMs - 60 * 60 * 1000) * 1_000_000) // 1h window
const endMs = nowMs
const startMs = nowMs - 60 * 60 * 1000

type Probe = { name: string; path: string; method: 'GET' | 'POST'; body?: unknown }

const PROBES: Probe[] = [
  // ── Dashboards (SigNoz) ──
  { name: 'dashboards.list', path: 'o11y/v1/dashboards', method: 'GET' },
  { name: 'dashboards.v2', path: 'o11y/v2/dashboards', method: 'GET' },
  // ── Service map / APM ──
  { name: 'services.list', path: 'o11y/v1/services/list', method: 'GET' },
  {
    name: 'services',
    path: 'o11y/v1/services',
    method: 'POST',
    body: { start: startNs, end: endNs, tags: [] },
  },
  {
    name: 'dependency_graph',
    path: 'o11y/v1/dependency_graph',
    method: 'POST',
    body: { start: startNs, end: endNs, tags: [] },
  },
  {
    name: 'service.top_operations',
    path: 'o11y/v1/service/top_operations',
    method: 'POST',
    body: { start: startNs, end: endNs, service: '' },
  },
  // ── Infra ──
  {
    name: 'hosts.list',
    path: 'o11y/v1/hosts/list',
    method: 'POST',
    body: { start: startMs, end: endMs, filters: { op: 'AND', items: [] } },
  },
  {
    name: 'pods.list',
    path: 'o11y/v1/pods/list',
    method: 'POST',
    body: { start: startMs, end: endMs, filters: { op: 'AND', items: [] } },
  },
  {
    name: 'nodes.list',
    path: 'o11y/v1/nodes/list',
    method: 'POST',
    body: { start: startMs, end: endMs, filters: { op: 'AND', items: [] } },
  },
  {
    name: 'namespaces.list',
    path: 'o11y/v1/namespaces/list',
    method: 'POST',
    body: { start: startMs, end: endMs, filters: { op: 'AND', items: [] } },
  },
  {
    name: 'clusters.list',
    path: 'o11y/v1/clusters/list',
    method: 'POST',
    body: { start: startMs, end: endMs, filters: { op: 'AND', items: [] } },
  },
  // ── Exceptions ──
  {
    name: 'listErrors',
    path: 'o11y/v1/listErrors',
    method: 'POST',
    body: { start: startNs, end: endNs, limit: 50, order: 'descending', orderParam: 'exceptionCount' },
  },
  {
    name: 'countErrors',
    path: 'o11y/v1/countErrors',
    method: 'POST',
    body: { start: startNs, end: endNs },
  },
  // ── Health (sanity: proves the runtime is reachable) ──
  { name: 'health', path: 'o11y/v1/health', method: 'GET' },
  { name: 'version', path: 'o11y/v1/version', method: 'GET' },
  // ── Alerts (known-good baseline — AlertsModule already uses this) ──
  { name: 'rules', path: 'o11y/v1/rules', method: 'GET' },
]

test('probe o11y endpoints (live, authenticated)', async ({ page }) => {
  test.setTimeout(180_000)
  if (!PASSWORD) throw new Error('HANZO_PASSWORD required for the live probe')
  await signIn(page)

  const results = await page.evaluate(
    async ({ probes }: { probes: Probe[] }) => {
      const out: { name: string; status: number; ok: boolean; snippet: string }[] = []
      for (const p of probes) {
        try {
          const res = await fetch(`${window.location.origin}/v1/${p.path}`, {
            method: p.method,
            credentials: 'include',
            headers: p.body !== undefined ? { 'Content-Type': 'application/json' } : {},
            body: p.body !== undefined ? JSON.stringify(p.body) : undefined,
          })
          const text = await res.text()
          out.push({ name: p.name, status: res.status, ok: res.ok, snippet: text.slice(0, 240) })
        } catch (e) {
          out.push({ name: p.name, status: -1, ok: false, snippet: String(e).slice(0, 240) })
        }
      }
      return out
    },
    { probes: PROBES },
  )

  console.log('\n================ O11Y LIVE PROBE ================')
  for (const r of results) {
    console.log(`\n[${r.status}] ${r.name}`)
    console.log(`   ${r.snippet.replace(/\n/g, ' ')}`)
  }
  console.log('\n================ END PROBE ================\n')
})
