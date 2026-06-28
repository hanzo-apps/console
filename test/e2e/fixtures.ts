/**
 * Hermetic E2E backend — Playwright route interception for the cloud `/v1`
 * envelope API, the plain-REST provisioning kinds, and the `/paas` proxy.
 *
 * Why: console2 is a pure client of the unified backend. Mocking the backend at
 * the network boundary makes every test deterministic and SAFE — it never
 * touches real prod data (no real org/user/secret is read or mutated). The REAL
 * Next app + real client logic render against these fixtures, so assertions are
 * on real UI behavior.
 *
 * Usage:
 *   test('…', async ({ page, backend }) => {
 *     backend.account(ACCOUNTS.admin).envelope('get-providers', [provider])
 *     await page.goto('/providers')
 *     await expect(page.getByText('OpenAI')).toBeVisible()
 *   })
 *
 * Unset endpoints return honest-empty defaults so nothing errors; `get-account`
 * defaults to the anonymous (logged-out) session unless `account()` is called.
 */
import { test as base, expect, type Page, type Route } from '@playwright/test'

export { expect }

/** Fixture accounts — NEVER real customers. Pure test identities. */
export const ACCOUNTS = {
  admin: {
    owner: 'hanzo',
    name: 'ada-admin',
    displayName: 'Ada Admin',
    email: 'ada@example.test',
    type: 'normal-user',
    organization: 'hanzo',
    isAdmin: true,
  },
  member: {
    owner: 'hanzo',
    name: 'mo-member',
    displayName: 'Mo Member',
    email: 'mo@example.test',
    type: 'normal-user',
    organization: 'hanzo',
    isAdmin: false,
  },
  anonymous: { owner: 'hanzo', name: 'anonymous', type: 'anonymous-user' },
} as const

/** Plain-REST provisioning kinds (return raw JSON, not the casibase envelope). */
const PROVISIONING_KINDS = ['sql', 'vector', 'datastore', 'kv', 'search', 's3', 'docdb']

type FulfillSpec = { status: number; contentType: string; body: string }

const json = (body: string, status = 200): FulfillSpec => ({
  status,
  contentType: 'application/json',
  body,
})

/** A casibase `{status,msg,data,data2}` envelope body. */
const envelopeBody = (data: unknown, data2?: unknown): string =>
  JSON.stringify({
    status: 'ok',
    msg: '',
    data,
    data2: data2 ?? (Array.isArray(data) ? data.length : undefined),
  })

export type Backend = {
  /** Set the signed-in account (`/v1/get-account`). */
  account: (a: unknown) => Backend
  /** Register a casibase-envelope endpoint (path after `/v1/`). */
  envelope: (path: string, data: unknown, data2?: number) => Backend
  /** Register a plain-REST endpoint (raw JSON body) under `/v1/`. */
  rest: (path: string, body: unknown, status?: number) => Backend
  /** Register an error response under `/v1/` (honest 401/403/404/503 states). */
  error: (path: string, status: number, msg?: string) => Backend
  /** Register a method-specific REST response (e.g. POST create on a shared path). */
  createdAt: (method: string, path: string, body: unknown, status?: number) => Backend
  /** Register a `/paas/*` proxy endpoint (raw JSON). */
  paas: (path: string, body: unknown, status?: number) => Backend
  /** Register a `/paas/*` error (e.g. 501 not-configured). */
  paasError: (path: string, status: number, msg?: string) => Backend
}

function createBackend(page: Page): Backend {
  const map = new Map<string, FulfillSpec>()

  const handler = async (route: Route) => {
    const u = new URL(route.request().url())
    // Method-qualified match first (e.g. provisioning POST vs GET share a path),
    // then the path-only match.
    const exact = map.get(`${route.request().method()} ${u.pathname}`) ?? map.get(u.pathname)
    if (exact) return route.fulfill(exact)

    // Defaults — honest, never error.
    if (u.pathname === '/v1/get-account') {
      return route.fulfill(json(envelopeBody(ACCOUNTS.anonymous)))
    }
    if (u.pathname.startsWith('/paas/')) {
      return route.fulfill(json('{}')) // {apps:[],clusters:[]} both resolve to []
    }
    const seg = u.pathname.replace('/v1/', '').split('/')[0]
    if (PROVISIONING_KINDS.includes(seg)) {
      const isDetail = u.pathname.replace('/v1/', '').includes('/')
      return route.fulfill(json(isDetail ? '{}' : '[]'))
    }
    return route.fulfill(json(envelopeBody([], 0)))
  }

  // Intercept both the cloud `/v1` surface and the `/paas` proxy.
  void page.route(/\/(v1|paas)\//, handler)

  const api: Backend = {
    account(a) {
      map.set('/v1/get-account', json(envelopeBody(a)))
      return api
    },
    envelope(path, data, data2) {
      map.set('/v1/' + path, json(envelopeBody(data, data2)))
      return api
    },
    rest(path, body, status = 200) {
      map.set('/v1/' + path, json(JSON.stringify(body), status))
      return api
    },
    error(path, status, msg = 'error') {
      map.set('/v1/' + path, json(JSON.stringify({ status: 'error', msg, data: null }), status))
      return api
    },
    createdAt(method, path, body, status = 201) {
      map.set(`${method} /v1/${path}`, json(JSON.stringify(body), status))
      return api
    },
    paas(path, body, status = 200) {
      map.set('/paas/' + path, json(JSON.stringify(body), status))
      return api
    },
    paasError(path, status, msg = 'not configured') {
      map.set('/paas/' + path, json(JSON.stringify({ error: msg }), status))
      return api
    },
  }
  return api
}

/** Test with a `backend` fixture pre-installed (route interception is live). */
export const test = base.extend<{ backend: Backend }>({
  backend: async ({ page }, use) => {
    const backend = createBackend(page)
    await use(backend)
  },
})

/**
 * Collect browser console errors + uncaught page errors for "clean console"
 * assertions. Call BEFORE navigation. Benign, environment-level noise (favicon,
 * intercepted-request abort logs) is filtered so only REAL app errors fail.
 */
export function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = []
  const benign = [
    /favicon/i,
    /Failed to load resource/i, // intercepted/aborted sub-resources
    /Download the React DevTools/i,
    /\[Fast Refresh\]/i,
  ]
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    if (benign.some((re) => re.test(text))) return
    errors.push(text)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  return errors
}

/**
 * Register honest-empty responses for the plain-REST surfaces (o11y, evals,
 * gateway models, pricing, paas) so any module renders its empty state cleanly.
 * Envelope list endpoints are already empty by default.
 */
export function baseline(backend: Backend): Backend {
  const page0 = { page: 1, limit: 50, totalItems: 0, totalPages: 0 }
  return backend
    .rest('o11y/traces', { data: [], meta: page0 })
    .rest('o11y/sessions', { data: [], meta: page0 })
    .rest('o11y/scores', { data: [], meta: page0 })
    .rest('evals/scores', { data: [], meta: page0 })
    .rest('evals/datasets', { data: [] })
    .rest('models', { object: 'list', data: [] })
    .rest('pricing/models', { models: [] })
    .rest('pricing', { cloud: { plans: [] } })
    .paas('apps', { apps: [] })
}

/** Sign in as a fixture account and land on the dashboard home. */
export async function landAs(page: Page, backend: Backend, account: unknown): Promise<void> {
  backend.account(account)
  await page.goto('/')
  // The home subtitle is unique to the authenticated dashboard home.
  await expect(page.getByText(/See, enable, and manage every .* product from one place/)).toBeVisible()
}
