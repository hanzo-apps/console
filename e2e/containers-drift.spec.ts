/**
 * e2e: the Workloads board states WHY an app drifts, and against WHAT.
 *
 * The inventory computes drift from three tags — declared, running, latest — and
 * reports the flags that produced its verdict. The board used to print the severity
 * word alone and never showed `latest`, so a "yellow" row named a gap whose far end
 * was invisible: you could see an app was behind, not what it was behind, nor why.
 *
 * Run: BASE_URL=http://localhost:4000 npx playwright test containers-drift
 */
import { test, expect, type Page, type Route } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { requireFixtureServer } from './_fixture'
import { primeSession } from './_session'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4000'
const SHOTS = join(process.cwd(), 'e2e-shots')

requireFixtureServer()

/** `GET /v1/platform/apps` — the fleet inventory envelope (`{apps: [...]}`). */
const APPS = {
  apps: [
    {
      id: 'a1',
      org: 'hanzo',
      app: 'cloud',
      env: 'main',
      cluster: 'hanzo-k8s',
      namespace: 'hanzo',
      health: 'yellow',
      declaredTag: 'v1.801.570',
      runningTag: 'v1.801.570',
      latestTag: 'v1.801.612',
      drift: {
        severity: 'yellow',
        flags: [{ kind: 'stale', severity: 'yellow', message: 'declared is behind the latest release' }],
      },
    },
    {
      id: 'a2',
      org: 'hanzo',
      app: 'console',
      env: 'main',
      cluster: 'hanzo-k8s',
      namespace: 'hanzo',
      health: 'green',
      declaredTag: '8.5.121',
      runningTag: '8.5.121',
      latestTag: '8.5.121',
      drift: { severity: 'none', flags: [] },
    },
  ],
}

const json = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

async function mockNetwork(page: Page): Promise<void> {
  await page.route('**/*', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/v1/platform/apps')) return json(route, APPS)
    if (path.endsWith('/v1/visor/clusters')) return json(route, { data: [] })
    if (path.includes('/v1/')) return json(route, {})
    return route.continue()
  })
  await primeSession(page)
}

test('the workloads board names the drift reason and the tag it is behind', async ({ page }) => {
  await mockNetwork(page)
  await page.goto(`${BASE_URL}/containers`, { waitUntil: 'domcontentloaded' })

  await expect(page.getByText('cloud', { exact: true }).first()).toBeVisible({ timeout: 45_000 })

  // The three tags the verdict is computed from are all on the row: running under the
  // name, declared in its cell, and latest beside it BECAUSE it differs.
  await expect(page.getByText('running v1.801.570', { exact: true })).toBeVisible()
  await expect(page.getByText('v1.801.570', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('latest v1.801.612', { exact: true })).toBeVisible()

  // And the drift cell says WHY, not just how loudly.
  await expect(page.getByText('stale', { exact: true }).first()).toBeVisible()

  // The app that is level shows no latest line — printing the same tag twice is noise.
  await expect(page.getByText('latest 8.5.121', { exact: true })).toHaveCount(0)

  // The verdict must be ON SCREEN, not merely in the DOM behind a horizontal scroll:
  // nine columns do not fit this board's width, so Drift's place in the order is what
  // decides whether anyone reads it. Assert the cell sits inside the viewport.
  const box = await page.getByText('stale', { exact: true }).first().boundingBox()
  const width = page.viewportSize()?.width ?? 0
  expect(box).not.toBeNull()
  expect(box!.x + box!.width).toBeLessThanOrEqual(width)

  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: join(SHOTS, 'containers-drift.png'), fullPage: true })
})
