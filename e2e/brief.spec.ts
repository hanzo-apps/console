/**
 * e2e: the brief — every product handed to an agent from the top of its own page.
 *
 * These are assertions only a browser can make. That the row PAINTS above the product's
 * own content rather than merely existing in the DOM; that the primary control is
 * keyboard-reachable and shows a focus ring; that pressing it puts real, derived text on
 * the system clipboard — the product's identity, its console address, and the operations
 * read from `/v1/openapi/commands`, which is mocked here so the assertion is about derivation and
 * not about what the fleet happens to publish today. And that a page which is not a
 * product (the console home) shows no row at all.
 *
 * Run: BASE_URL=http://localhost:4000 npx playwright test brief
 */
import { test, expect, type Route, type Page } from '@playwright/test'
import { requireFixtureServer } from './_fixture'
import { primeSession } from './_session'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4000'

requireFixtureServer()

const ACCOUNT = { owner: 'hanzo', name: 'z', email: 'z@hanzo.ai', displayName: 'Z Admin', isAdmin: true }

const API_RE = /\/(v1|cloud|ai|billing|commerce|telemetry|vm|superbase|admin|paas|integrations|auth\/refresh)(\/|$|\?)/
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

/** The command projection, as cloud serves it — two operations under one service. */
const COMMANDS = [
  {
    Service: 'dns',
    Name: 'list',
    OperationID: 'get_dns_zones',
    Summary: "Read your org's DNS zones and records",
    Method: 'GET',
    Path: '/v1/dns/zones',
  },
  {
    Service: 'dns',
    Name: 'create',
    OperationID: 'post_dns_zones',
    Summary: 'Create a DNS zone or record',
    Method: 'POST',
    Path: '/v1/dns/zones',
  },
  { Service: 'other', Name: 'list', OperationID: 'get_other', Summary: 'Not this product', Method: 'GET', Path: '/v1/other' },
]

async function mock(route: Route) {
  const req = route.request()
  if (req.resourceType() === 'document') return route.continue()
  const url = new URL(req.url())
  if (url.pathname === '/v1/openapi/commands') return json(route, COMMANDS)
  if (url.pathname.startsWith('/auth/')) return json(route, { ok: true })
  const sameOrigin = url.origin === new URL(BASE_URL).origin
  if (sameOrigin && !API_RE.test(url.pathname)) return route.continue()
  return json(route, { error: 'Sign in to use Hanzo Cloud.' }, 401)
}

async function open(page: Page, path: string) {
  await page.route('**/*', mock)
  await primeSession(page, ACCOUNT)
  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-testid="product-content"]').first().waitFor({ state: 'attached', timeout: 30_000 })
  await page.waitForTimeout(1500)
}

const copyButton = (page: Page) => page.getByRole('button', { name: /Copy the .* brief for an agent/ })

test('the control paints at the top of a product page, above the product content', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await open(page, '/dns')

  const strip = page.getByTestId('brief').first()
  await expect(strip).toBeVisible()

  // Above everything the product itself renders — geometry, not source order.
  const row = await strip.boundingBox()
  const content = await page.locator('[data-testid="product-content"]').first().boundingBox()
  expect(row && content).toBeTruthy()
  expect(row!.y, 'the row sits inside the top of the content column').toBeLessThan(content!.y + 120)
  // One row, not a banner: it must not take a slice of the page away from the product.
  expect(row!.height, 'the row stays a single control height').toBeLessThan(64)

  await ctx.close()
})

test('copying puts the derived brief on the clipboard', async ({ browser }) => {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  const page = await ctx.newPage()
  await open(page, '/dns')

  await copyButton(page).click()
  await expect(page.getByText(/brief copied/i)).toBeVisible({ timeout: 10_000 })

  const text = await page.evaluate(() => navigator.clipboard.readText())
  expect(text.length, 'the clipboard is not empty').toBeGreaterThan(200)
  // Identity + console address come from the catalog; the operations from /v1/openapi/commands.
  expect(text).toContain('- Console: `/dns`')
  expect(text).toContain('- Base: `https://api.hanzo.ai/v1`')
  expect(text).toContain('Authorization: Bearer <your token>')
  expect(text).toContain('- `get_dns_zones` — `GET /v1/dns/zones`')
  expect(text).toContain('- `post_dns_zones` — `POST /v1/dns/zones`')
  expect(text).toContain('curl -s https://api.hanzo.ai/v1/dns/zones')
  // Another service's operation is not this product's.
  expect(text).not.toContain('get_other')
  // No credential ever rides along.
  expect(text).not.toMatch(/\bsk-|\bpk-|\bhk-/)

  await ctx.close()
})

test('the control is keyboard-reachable and shows a focus ring', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await open(page, '/dns')

  const copy = copyButton(page)
  await copy.focus()
  await expect(copy).toBeFocused()

  // The global :focus-visible floor must actually paint an outline on it.
  const outline = await copy.evaluate((el) => {
    const s = getComputedStyle(el)
    return { width: s.outlineWidth, style: s.outlineStyle }
  })
  expect(outline.style, 'a focused control has a visible outline').not.toBe('none')
  expect(parseFloat(outline.width), 'the outline has real width').toBeGreaterThan(0)

  await ctx.close()
})

test('a page that is not a product shows no row', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await open(page, '/')
  await expect(page.getByTestId('brief')).toHaveCount(0)
  await ctx.close()
})
