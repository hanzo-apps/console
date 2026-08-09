/**
 * e2e: Integrations lists the whole registry.
 *
 * The page used to drop any provider the deployment held no app credentials for.
 * Google is registered in cloud (`apps/integrations/google.go`, org plane, the
 * provider the Drive/Sheets imports read) but this deployment has no
 * GOOGLE_CLIENT_ID, so `available` comes back false and the card was filtered out
 * — the provider was not "unavailable" on the page, it was ABSENT from it, which
 * reads as "we removed Google".
 *
 * These assertions need a browser: the question is whether a card is PAINTED, and
 * an element filtered out of the render is indistinguishable from one styled away
 * unless you resolve the box.
 *
 * Run: BASE_URL=http://localhost:4111 npx playwright test integrations-catalog
 */
import { test, expect, type Route, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { primeSession } from './_session'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4000'
const SHOTS = join(process.cwd(), 'e2e-shots')

const ACCOUNT = { owner: 'hanzo', name: 'z', email: 'z@hanzo.ai', displayName: 'Z Admin', isAdmin: true }

/**
 * The catalog exactly as cloud answers it on THIS deployment: every registered
 * org-plane provider, `available` reporting whether the deployment holds that
 * provider's app credentials. Google's false is the production fact this spec
 * exists for (kubectl shows SLACK_CLIENT_ID and GITHUB_APP_ID on the cloud
 * deployment and no GOOGLE_CLIENT_ID).
 */
const PROVIDERS = [
  { id: 'github', name: 'GitHub', description: 'Mirror your repositories.', category: 'Developer', available: true, connected: false },
  { id: 'google', name: 'Google', description: 'Connect Google Drive & Sheets to import documents and cap tables.', category: 'Productivity', available: false, connected: false },
  { id: 'slack', name: 'Slack', description: 'Connect your workspace.', category: 'Communication', available: true, connected: true, connection: { account: 'Hanzo', externalId: 'T0231', scopes: ['chat:write'], connectedAt: '2026-07-01T10:00:00Z' } },
]

const mock = (providers: unknown[]) => async (route: Route) => {
  const req = route.request()
  if (req.resourceType() === 'document') return route.continue()
  const url = new URL(req.url())
  const json = (body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  if (url.pathname === '/v1/integrations') return json({ providers })
  if (url.pathname.startsWith('/auth/')) return json({ ok: true })
  const sameOrigin = url.origin === new URL(BASE_URL).origin
  if (sameOrigin && !/\/(v1|cloud|ai|billing|commerce|telemetry|admin|paas|org)(\/|$|\?)/.test(url.pathname)) {
    return route.continue()
  }
  return json({ status: 'ok', msg: '', data: [], data2: 0 })
}

async function open(page: Page, providers: unknown[] = PROVIDERS) {
  await page.route('**/*', mock(providers))
  await primeSession(page, ACCOUNT)
  await page.goto(`${BASE_URL}/integrations`, { waitUntil: 'domcontentloaded' })
  await page.getByTestId('provider-slack').waitFor({ state: 'visible', timeout: 30_000 })
}

const card = (page: Page, id: string) => page.getByTestId(`provider-${id}`)

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }))

test('Google is on the page even though this deployment has no credentials for it', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await open(page)

  // The whole registry paints — the unavailable one included. This is the defect.
  await expect(card(page, 'google')).toBeVisible()
  await expect(card(page, 'github')).toBeVisible()
  await expect(card(page, 'slack')).toBeVisible()
  await expect(card(page, 'google').getByText('Google', { exact: true })).toBeVisible()

  // And it is honest about why you cannot press Connect, ON the card, rather than
  // leaving a dead control to be guessed at.
  await expect(page.getByTestId('unavailable-google')).toBeVisible()
  await expect(card(page, 'google').getByText('Unavailable')).toBeVisible()
  await expect(card(page, 'google').getByRole('button', { name: 'Connect' })).toBeDisabled()

  // A provider the deployment CAN connect is untouched by the change.
  await expect(card(page, 'github').getByRole('button', { name: 'Connect' })).toBeEnabled()
  await expect(page.getByTestId('unavailable-github')).toHaveCount(0)

  // A connected provider still reads as connected and offers the way out.
  await expect(card(page, 'slack').getByText('Connected', { exact: true })).toBeVisible()
  await expect(card(page, 'slack').getByRole('button', { name: 'Disconnect' })).toBeVisible()

  await page.screenshot({ path: join(SHOTS, 'integrations-google.png'), animations: 'disabled' })
  await ctx.close()
})

test('the credentials landing makes the card live — no console change needed', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  // Same page, same code — only the deployment's answer for `available` differs.
  await open(page, PROVIDERS.map((p) => (p.id === 'google' ? { ...p, available: true } : p)))

  await expect(card(page, 'google')).toBeVisible()
  await expect(card(page, 'google').getByRole('button', { name: 'Connect' })).toBeEnabled()
  await expect(page.getByTestId('unavailable-google')).toHaveCount(0)
  await ctx.close()
})
