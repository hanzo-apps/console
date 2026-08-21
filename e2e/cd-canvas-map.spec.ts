/**
 * e2e: CD fleet deploy MAP — mocked-network render + RESPONSIVE proof.
 *
 * Runs against a LOCAL server (BASE_URL=http://localhost:4000) with the whole
 * network mocked (same pattern as budgets-responsive): `/auth/session` → a global
 * admin so the shell mounts and the admin-only Deploy product renders, the
 * `/v1/deploy/*` CD projection → real-shaped rows (the fleet + one app's tree +
 * logs), `/v1/git/repos` + `/v1/platform/builds` → enrichment, everything else → empty-ok.
 *
 * It proves: the fleet renders as canvas NODES, a node OPENS the drawer, the
 * resource TOPOLOGY mounts in the drawer, and — the CTO requirement — at a NARROW
 * (390px) viewport the body never scrolls horizontally AND the nav collapses to
 * the hamburger. Screenshots at desktop (1440) and mobile (390).
 *
 * Run: BASE_URL=http://localhost:4000 npx playwright test cd-canvas-map
 */
import { test, expect, type Route, type Page } from '@playwright/test'
import { requireFixtureServer } from './_fixture'
import { primeSession } from './_session'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4000'

requireFixtureServer()
const SHOTS = join(process.cwd(), 'e2e-shots')

// cd.hanzo.ai authenticates the RESERVED `admin` org (owner=='admin' — the SuperAdmin
// predicate `useIsSuperAdmin` gates the admin:true Deploy product on, per e2e 107's
// admin-console login). A claim-only super-admin in a brand org sees the honest
// AdminManagedNotice instead — that's the correct admin-org-model behavior.
const ACCOUNT = {
  owner: 'admin',
  name: 'z',
  type: 'normal-user',
  email: 'z@hanzo.ai',
  displayName: 'Z Admin',
  isSuperAdmin: true,
  isGlobalAdmin: true,
  isAdmin: true,
  signupApplication: 'admin-console',
}

/** Real-shaped `/v1/deploy/applications` rows (the cloud clients/deploy DTO). */
const FLEET = {
  applications: [
    { name: 'cloud', namespace: 'hanzo', env: 'main', repository: 'ghcr.io/hanzoai/cloud', version: 'v1.800.1', runningVersion: 'v1.800.1', health: 'healthy', sync: 'synced', phase: 'Running', endpoints: ['https://cloud.hanzo.ai'] },
    { name: 'iam', namespace: 'hanzo', env: 'main', repository: 'ghcr.io/hanzoai/iam', version: 'v1.4.11', runningVersion: 'v1.4.10', health: 'progressing', healthMessage: 'rolling update (1/2)', sync: 'out-of-sync', phase: 'Running' },
    { name: 'gateway', namespace: 'hanzo', env: 'main', repository: 'ghcr.io/hanzoai/gateway', version: 'v2.16.4', runningVersion: 'v2.16.4', health: 'healthy', sync: 'synced', phase: 'Running' },
    { name: 'o11y', namespace: 'hanzo', env: 'main', repository: 'ghcr.io/hanzoai/o11y', version: 'v1.5.12', runningVersion: 'v1.5.10', health: 'degraded', healthMessage: 'CrashLoopBackOff', sync: 'out-of-sync', phase: 'Degraded' },
  ],
  summary: { total: 4, healthy: 2, degraded: 1, outOfSync: 2 },
}

/** The owned-resource tree for `iam` (root App CR → Deployment → ReplicaSet → Pods). */
const IAM_TREE = {
  application: FLEET.applications[1],
  nodes: [
    { group: 'hanzo.ai', version: 'v1', kind: 'App', namespace: 'hanzo', name: 'iam', ref: 'hanzo.ai:App:hanzo:iam', uid: 'u1', health: 'progressing', parentRefs: [] },
    { group: 'apps', version: 'v1', kind: 'Deployment', namespace: 'hanzo', name: 'iam', ref: 'apps:Deployment:hanzo:iam', uid: 'u2', health: 'progressing', parentRefs: [{ ref: 'hanzo.ai:App:hanzo:iam' }] },
    { group: 'apps', version: 'v1', kind: 'ReplicaSet', namespace: 'hanzo', name: 'iam-6d8f', ref: 'apps:ReplicaSet:hanzo:iam-6d8f', uid: 'u3', health: 'healthy', parentRefs: [{ ref: 'apps:Deployment:hanzo:iam' }] },
    { group: '', version: 'v1', kind: 'Pod', namespace: 'hanzo', name: 'iam-6d8f-abc', ref: ':Pod:hanzo:iam-6d8f-abc', uid: 'u4', health: 'healthy', parentRefs: [{ ref: 'apps:ReplicaSet:hanzo:iam-6d8f' }] },
  ],
}

const REPOS = [
  { id: 'r1', org: 'hanzoai', name: 'iam', defaultBranch: 'main', branches: ['main'], head: 'abc1234def', cloneUrl: '', sshUrl: '', sizeBytes: 0, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'r2', org: 'hanzoai', name: 'cloud', defaultBranch: 'main', branches: ['main'], head: 'ffff000011', cloneUrl: '', sshUrl: '', sizeBytes: 0, createdAt: '2026-01-01T00:00:00Z' },
]
const BUILDS = { builds: [{ id: 'b1', repo: 'hanzoai/iam', commit: 'abc1234', status: 'success', startedAt: '2026-07-18T12:00:00Z', duration: '2m' }] }

const API_RE = /\/(v1|cloud|ai|billing|commerce|telemetry|vm|superbase|admin|paas|integrations|auth\/refresh)(\/|$|\?)/

async function mock(route: Route) {
  const req = route.request()
  if (req.resourceType() === 'document') return route.continue()
  const url = new URL(req.url())
  const path = url.pathname
  const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

  if (path === '/auth/session') return json({ account: ACCOUNT, expiresIn: 3600 })
  if (path.startsWith('/auth/')) return json({ ok: true })

  // The CD projection under test (cloud clients/deploy shapes).
  if (path === '/v1/deploy/applications') return json(FLEET)
  if (path === '/v1/deploy/iam/tree') return json(IAM_TREE)
  if (/^\/v1\/deploy\/[^/]+\/tree$/.test(path)) return json({ application: {}, nodes: [] })
  if (/^\/v1\/deploy\/[^/]+\/logs$/.test(path)) return json({ application: 'hanzo/iam', pod: 'iam-6d8f-abc', logs: 'ready to serve\nlistening on :8080\n' })
  if (/^\/v1\/deploy\/[^/]+\/resource\//.test(path)) return json({ ref: 'apps:Deployment:hanzo:iam', health: 'healthy', liveManifest: { apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'iam' }, spec: { replicas: 2 } }, desiredSource: 'last-applied', diff: { modified: false } })
  if (path === '/v1/git/repos') return json(REPOS)
  if (/^\/v1\/git\/repos\/[^/]+\/refs$/.test(path)) return json({ branches: [{ name: 'main', sha: 'abc' }], tags: [{ name: 'v1.4.10', sha: 'a' }, { name: 'v1.4.9', sha: 'b' }], default: 'main' })
  if (/^\/v1\/git\/repos\//.test(path)) return json({ id: 'r1', org: 'hanzoai', name: 'iam', defaultBranch: 'main', branches: ['main'], head: 'abc1234def', cloneUrl: '', sshUrl: '', sizeBytes: 0, createdAt: '2026-01-01T00:00:00Z' })
  if (path === '/v1/platform/builds') return json(BUILDS)

  const sameOrigin = url.origin === new URL(BASE_URL).origin
  if (sameOrigin && !API_RE.test(path)) return route.continue()
  return json({ status: 'ok', msg: '', data: [], data2: 0 })
}

async function openMap(page: Page) {
  await page.addInitScript((org) => {
    try {
      localStorage.setItem('hanzo.console.org', org)
      localStorage.setItem('hanzo.console.org.selected', '1') // ENTERED flag — Scope → scoped console
      localStorage.setItem('hz_onboarding_done:' + org, '1') // skip the first-run wizard
      localStorage.setItem('hz_admin_banner_dismissed', '1')
    } catch {
      /* private mode */
    }
  }, ACCOUNT.owner)
  await page.route('**/*', mock)
  await primeSession(page, ACCOUNT)
  await page.goto(`${BASE_URL}/gitops`, { waitUntil: 'domcontentloaded' })
  const content = page.locator('[data-testid="product-content"]').first()
  await content.waitFor({ state: 'attached', timeout: 20_000 })
  // The lazy @xyflow canvas mounts client-side; wait for the fleet nodes.
  await page.locator('.react-flow__node').first().waitFor({ state: 'visible', timeout: 20_000 })
}

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }))

test('renders the fleet as canvas nodes, opens a node → drawer → resource topology (desktop)', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await openMap(page)

  // The fleet KPI band (from the real folds) + the app nodes.
  await expect(page.locator('text=Applications').first()).toBeVisible()
  await expect(page.locator('.react-flow__node').filter({ hasText: 'iam' }).first()).toBeVisible()
  await expect(page.locator('.react-flow__node').filter({ hasText: 'cloud' }).first()).toBeVisible()
  await page.screenshot({ path: join(SHOTS, 'cd-map-desktop.png'), fullPage: true })

  // Open a node → the detail drawer, and confirm the drawer's tabs.
  await page.locator('.react-flow__node').filter({ hasText: 'iam' }).first().click()
  const drawer = page.getByRole('dialog').first()
  await expect(drawer).toBeVisible({ timeout: 10_000 })
  await expect(drawer.locator('text=Resources').first()).toBeVisible()
  await expect(drawer.locator('text=Deploys').first()).toBeVisible()
  await expect(drawer.locator('text=Logs').first()).toBeVisible()
  await expect(drawer.locator('text=Source').first()).toBeVisible()

  // The Resources tab mounts the owned-resource topology (nested canvas + caption).
  await expect(drawer.locator('text=/resources · tap a node/i').first()).toBeVisible({ timeout: 10_000 })
  await expect(drawer.locator('.react-flow__node').first()).toBeVisible()
  await page.screenshot({ path: join(SHOTS, 'cd-map-drawer.png'), fullPage: true })
  await ctx.close()
})

test('reflows with no horizontal body scroll AND a collapsed nav at a narrow (mobile) viewport', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  await openMap(page)

  await expect(page.locator('.react-flow__node').filter({ hasText: 'iam' }).first()).toBeVisible()

  // The CTO requirement 1: the body must not scroll horizontally on mobile.
  const overflow = await page.evaluate(() => {
    const el = document.documentElement
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }
  })
  expect(overflow.scrollWidth, 'no horizontal body scroll at 390px').toBeLessThanOrEqual(overflow.clientWidth + 1)

  // The CTO requirement 2: the nav collapses to the hamburger (no persistent sidebar).
  await expect(page.getByRole('button', { name: 'Open navigation' }).first()).toBeVisible()

  // The drawer is a full-screen sheet on mobile.
  await page.locator('.react-flow__node').filter({ hasText: 'iam' }).first().click()
  await expect(page.getByRole('dialog').first()).toBeVisible({ timeout: 10_000 })
  await page.screenshot({ path: join(SHOTS, 'cd-map-mobile.png'), fullPage: true })
  await ctx.close()
})
