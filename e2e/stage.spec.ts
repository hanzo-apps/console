/**
 * e2e: the console shows GA and nothing else, until an org says otherwise.
 *
 * The unit tests prove the PREDICATE over fixtures. These prove the WIRING — that
 * every surface actually calls it, with the same viewer, over the real catalog. A
 * predicate nothing consults is the defect this whole change exists to remove, so
 * it has to be measured where the pixels are.
 *
 * The org-wide opt-in is the only thing that varies between the two runs: same
 * account, same catalog, same build. `feature/beta` on the enablement registry is
 * `optedIn: false` in the first and `true` in the second.
 *
 * Run: BASE_URL=http://localhost:4123 npx playwright test stage
 */
import { test, expect, type Route, type Page } from '@playwright/test'
import { primeSession } from './_session'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4000'
const API_RE = /\/(v1|cloud|ai|billing|commerce|telemetry|vm|superbase|admin|paas|integrations|org|auth\/refresh)(\/|$|\?)/

/** The one beta-stage product in the catalog, and an admin-stage one beside it. */
const BETA = { id: 'beta-features', label: 'Beta features' }
const ADMIN = { id: 'overlord', label: 'Overlord' }
const GA = { id: 'models', label: 'Models' }

/**
 * Every backend answers 401 — this spec is about which products are OFFERED, not
 * about their data, and an unauthorized read is a state every module renders
 * honestly. The exception is the enablement registry, which IS the variable.
 */
function mock(beta: boolean) {
  return async (route: Route) => {
    const req = route.request()
    if (req.resourceType() === 'document') return route.continue()
    const url = new URL(req.url())
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.pathname.startsWith('/auth/')) return json({ ok: true })
    if (url.pathname.endsWith('/v1/pricing/enablement')) {
      const item = { kind: 'feature', id: 'beta', state: 'beta', effective: beta, optedIn: beta, canOptIn: !beta }
      return json({ org: 'maxpower', items: [item], betas: beta ? [] : [item] })
    }
    const sameOrigin = url.origin === new URL(BASE_URL).origin
    if (sameOrigin && !API_RE.test(url.pathname)) return route.continue()
    return json({ error: 'Sign in to use Hanzo Cloud.' }, 401)
  }
}

/** A customer org admin — admin OF THEIR OWN org, never a platform super admin. */
const CUSTOMER = { owner: 'maxpower', name: 'dave', email: 'dave@maxpower.com', isAdmin: true }
/** A member of the reserved admin org — the only identity admin surfaces admit. */
const OPERATOR = { owner: 'admin', name: 'z', email: 'z@hanzo.ai', isAdmin: true }

async function open(page: Page, path: string, opts: { beta?: boolean; as?: typeof CUSTOMER } = {}) {
  await page.route('**/*', mock(opts.beta ?? false))
  await primeSession(page, opts.as ?? CUSTOMER)
  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded' })
  await page.locator('nav[aria-label="Products"]').first().waitFor({ state: 'attached', timeout: 30_000 })
  await page.waitForTimeout(1500)
}

/** Open ⌘K, type, and read what it OFFERS. */
async function search(page: Page, query: string): Promise<string> {
  await page.keyboard.press('Meta+k')
  await page.waitForTimeout(600)
  await page.keyboard.type(query)
  await page.waitForTimeout(900)
  return (await page.locator('body').innerText()).toLowerCase()
}

/** The All-products pane — the one surface that lists the WHOLE catalog, so the
 *  honest place to ask "is this product offered to me at all". */
async function allProducts(page: Page): Promise<string> {
  await page.locator('nav[aria-label="Products"]').first()
    .getByRole('button', { name: 'All products', exact: true }).first().click()
  await page.waitForTimeout(800)
  return (await page.locator('body').innerText()).toLowerCase()
}

test.describe('a new account sees GA only', () => {
  test('a GA product is offered; a beta one is not', async ({ page }) => {
    await open(page, '/')
    const pane = await allProducts(page)
    expect(pane).toContain(GA.label.toLowerCase())
    expect(pane).not.toContain(BETA.label.toLowerCase())
  })

  test('nothing invites them to turn beta on', async ({ page }) => {
    await open(page, '/')
    // The whole point of the design: no banner, no nudge, no empty-state prompt.
    // Out of the box the words never appear on the home board.
    const home = (await page.locator('body').innerText()).toLowerCase()
    expect(home).not.toContain('early access')
    expect(home).not.toContain('enable beta')
  })

  test('⌘K cannot jump to a product the rail hides', async ({ page }) => {
    await open(page, '/')
    // The palette's empty state ECHOES the query, so "does the words appear" is not
    // the question — "did it offer somewhere to go" is. It offers nothing.
    expect(await search(page, BETA.label)).toContain('no commands or products match')
  })
})

test.describe('the org opts in, and the same build shows more', () => {
  test('the beta product appears — the only thing that changed is the org setting', async ({ page }) => {
    await open(page, '/', { beta: true })
    const pane = await allProducts(page)
    expect(pane).toContain(BETA.label.toLowerCase())
  })

  test('⌘K can jump to it now — the palette reads the same viewer', async ({ page }) => {
    await open(page, '/', { beta: true })
    expect(await search(page, BETA.label)).not.toContain('no commands or products match')
  })

  test('the switch lives in org settings, and only there', async ({ page }) => {
    await open(page, '/settings', { beta: true })
    const settings = (await page.locator('body').innerText()).toLowerCase()
    expect(settings).toContain('early access')
    expect(settings).toContain('beta products')
  })
})

test.describe('hiding is a nav decision, not a 404', () => {
  test('a hidden beta product still resolves at its own address', async ({ page }) => {
    await open(page, `/${BETA.id}`)
    // It is NOT listed for this viewer (proved above) and it still renders: a
    // bookmark, a support link, or a colleague's URL must open it.
    // `PageHeader` renders an RNW `Text` (a div, no heading role), so the honest
    // probe is the product's own copy on screen — not a role that never existed.
    const body = (await page.locator('body').innerText()).toLowerCase()
    expect(body).not.toContain('could not be found')
    expect(body).toContain('enable early-access models and features')
  })
})

test.describe('admin is membership, never a toggle', () => {
  test('an admin product is invisible AND unreachable for a customer', async ({ page }) => {
    // Even with the beta opt-in taken — there is no setting that reaches it.
    await open(page, '/', { beta: true })
    const pane = await allProducts(page)
    expect(pane).not.toContain(ADMIN.label.toLowerCase())

    await open(page, `/${ADMIN.id}`, { beta: true })
    const body = (await page.locator('body').innerText()).toLowerCase()
    expect(body).toContain('managed by hanzo')
  })

  test('the reserved admin org sees it and opens it', async ({ page }) => {
    await open(page, `/${ADMIN.id}`, { as: OPERATOR })
    const body = (await page.locator('body').innerText()).toLowerCase()
    expect(body).not.toContain('managed by hanzo')
  })
})
