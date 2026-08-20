/**
 * e2e: the Code hub's Publishing face — mocked-network render.
 *
 * Runs against a LOCAL server (BASE_URL=http://localhost:4000) with the network
 * mocked, so the shapes asserted here are the shapes cloud actually serves:
 * `{data: repoView[]}` for `GET /v1/git/repos` and `{data: mirrorTargetView[]}` for
 * `GET /v1/git/repos/:name/mirrors`.
 *
 * The claim under test is the one the face exists to make: a repo with NO mirror
 * target reads "Nowhere", and a repo whose target list could not be READ reads
 * "Unreadable" — never "Nowhere". Collapsing those two would report a broken read as
 * a broken repo, and a board that cries wolf is worse than the kubectl it replaced.
 *
 * Run: BASE_URL=http://localhost:4000 npx playwright test code-publishing
 */
import { test, expect, type Page, type Route } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { requireFixtureServer } from './_fixture'
import { primeSession } from './_session'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4000'
const SHOTS = join(process.cwd(), 'e2e-shots')

requireFixtureServer()

/** `GET /v1/git/repos` — the cloud `repoList` envelope. */
const REPOS = {
  data: [
    { id: 'r1', org: 'hanzo', name: 'cloud', defaultBranch: 'main', cloneUrl: '', sshUrl: '', sizeBytes: 1, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-08-19T00:00:00Z' },
    { id: 'r2', org: 'hanzo', name: 'silent', defaultBranch: 'main', cloneUrl: '', sshUrl: '', sizeBytes: 1, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-08-18T00:00:00Z' },
    { id: 'r3', org: 'hanzo', name: 'unreadable', defaultBranch: 'main', cloneUrl: '', sshUrl: '', sizeBytes: 1, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-08-17T00:00:00Z' },
  ],
}

/** `cloud` publishes to github; `silent` has an EMPTY list; `unreadable` 500s. */
const MIRRORS: Record<string, unknown> = {
  cloud: { data: [{ id: 'mir_1', repo: 'cloud', host: 'github.com', url: 'https://github.com/hanzoai/cloud.git', createdAt: '2026-02-01T00:00:00Z' }] },
  silent: { data: [] },
}

const json = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

/**
 * Mock the two reads the face makes. Registered BEFORE `primeSession`, whose IAM
 * handlers must win (Playwright matches routes in reverse registration order).
 */
async function mockNetwork(page: Page): Promise<void> {
  await page.route('**/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname
    const m = /\/v1\/git\/repos\/([^/]+)\/mirrors$/.exec(path)
    if (m) {
      const body = MIRRORS[decodeURIComponent(m[1])]
      return body
        ? json(route, body)
        : route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' })
    }
    if (path.endsWith('/v1/git/repos')) return json(route, REPOS)
    return json(route, {})
  })
  await primeSession(page)
}

async function openPublishing(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/code/publishing`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('Publishing', { exact: true }).first()).toBeVisible({ timeout: 45_000 })
}

test.describe('Code · Publishing', () => {
  test.beforeEach(async ({ page }) => {
    await mockNetwork(page)
  })

  test('names where each repo publishes, and separates nowhere from unreadable', async ({ page }) => {
    await openPublishing(page)

    // Every repo the backend returned is on the board.
    for (const name of ['cloud', 'silent', 'unreadable']) {
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible()
    }

    // The repo that publishes names its destination.
    await expect(page.getByText('github.com', { exact: true }).first()).toBeVisible()

    // The empty list is a finding; the failed read is NOT the same finding.
    await expect(page.getByText('Nowhere', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Unreadable', { exact: true }).first()).toBeVisible()

    // And the summary counts them apart.
    await expect(page.getByText('1 publishing', { exact: true })).toBeVisible()
    await expect(page.getByText('1 nowhere', { exact: true })).toBeVisible()
    await expect(page.getByText('1 unreadable', { exact: true })).toBeVisible()

    mkdirSync(SHOTS, { recursive: true })
    await page.screenshot({ path: join(SHOTS, 'code-publishing.png'), fullPage: true })
  })

  test('is reachable from the Code hub tab strip', async ({ page }) => {
    await page.goto(`${BASE_URL}/code`, { waitUntil: 'domcontentloaded' })
    const tab = page.getByText('Publishing', { exact: true }).first()
    await expect(tab).toBeVisible({ timeout: 45_000 })
    await tab.click()
    await expect(page).toHaveURL(/\/code\/publishing$/)
    await expect(page.getByText('Nowhere', { exact: true }).first()).toBeVisible({ timeout: 30_000 })
  })

  test('a repo row opens that repo', async ({ page }) => {
    await openPublishing(page)
    await page.getByText('cloud', { exact: true }).first().click()
    await expect(page).toHaveURL(/\/code\/repos\/cloud/)
  })
})
