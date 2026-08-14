/**
 * A navigation inside the console is a navigation, not a reload.
 *
 * It was a reload — every one of them. Next's `router.push` has to fetch an RSC
 * payload for the target route, and this app is served as ONE index.html for every
 * address, so there is none to fetch: measured on console.hanzo.ai,
 * `GET /profile` carrying `RSC: 1` answers `content-type: text/html`, and Next's
 * client router treats a non-flight response by handing the address to
 * `window.location`. Clicking Profile in the account menu therefore threw the whole
 * console away and built it again — providers remounted, the session refetched, the
 * screen went white on the way. Navigation carries the address on the history API
 * now (`src/lib/router.ts`), which Next patches to update `usePathname` with no
 * fetch and no route change.
 *
 * "It did not reload" is not something a screenshot can show, so it is measured two
 * independent ways, one in each layer a reload destroys:
 *
 *   the JS realm — a value on `window`. A document load makes a new realm, so the
 *   value cannot survive one.
 *   the DOM — an attribute stamped by the spec onto a node the SHELL renders. React
 *   replaces the node if it remounts the subtree, and the attribute goes with it.
 *   This is the one that would catch a same-document navigation that nonetheless
 *   tears the app down and rebuilds it, which `window` alone cannot see.
 *
 * Both detectors are proven able to FAIL, against a real document load, in the same
 * run — otherwise "it survived" is a claim about a probe that measures nothing.
 */
import { test, expect, type Page } from '@playwright/test'
import { primeSession } from './_session'

/** The account control at the foot of the rail — the reported trigger. */
const accountTrigger = (page: Page) => page.getByTestId('nav-user').first()

/** What the spec puts in each layer, and reads back. */
const SENTINEL = '__console_nav_probe'

async function mountConsole(page: Page) {
  await page.route(/\/(v1|admin\/iam)\//, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', data: [] }),
    }),
  )
  await primeSession(page)
  await page.goto('/')
  await page.waitForSelector('[data-testid=nav-user]', { state: 'attached', timeout: 30_000 })
}

/** Plant both detectors: one in the JS realm, one on a node the shell owns. */
async function plant(page: Page) {
  await page.evaluate((key) => {
    ;(window as unknown as Record<string, string>)[key] = 'alive'
    document.querySelector('[data-testid=nav-user]')?.setAttribute('data-probe', 'alive')
  }, SENTINEL)
}

/** Read both back. */
async function survived(page: Page): Promise<{ realm: boolean; node: boolean }> {
  return page.evaluate((key) => ({
    realm: (window as unknown as Record<string, string>)[key] === 'alive',
    node: document.querySelector('[data-testid=nav-user]')?.getAttribute('data-probe') === 'alive',
  }), SENTINEL)
}

test.describe('navigation keeps the app', () => {
  test('the target IS production: no RSC payload exists for a product address', async ({ request }) => {
    // Establishes that the environment can actually reproduce the bug. Next fetches
    // `<address>.txt` for a client transition; production answers it with the SPA
    // shell, at 200, because "the file, or index.html" is the only rule there is.
    // Measured on console.hanzo.ai: /index.txt is 9,576 bytes of real flight payload
    // and /models.txt, /profile.txt, /billing.txt are all the same 380,392-byte
    // index.html. Getting HTML where a flight payload belongs is what sends Next to
    // `window.location`, so an app that asks for one cannot navigate here.
    //
    // A REACHABILITY GATE, not a blind skip: run this against `next dev`/`next start`
    // and there is no such topology to assert about. `pnpm build:embed && node
    // scripts/serve-export.mjs 4123` is the one that reproduces it.
    const payload = await request.get('/profile.txt')
    const type = payload.headers()['content-type'] ?? ''
    test.skip(
      !(payload.status() === 200 && type.startsWith('text/html')),
      `target answers /profile.txt with ${payload.status()} ${type} — a real Next server, not the static bundle production serves`,
    )
    const shell = await request.get('/')
    expect(await payload.text()).toBe(await shell.text())
  })

  test('the detectors can fail — a real document load destroys both', async ({ page }) => {
    // The negative control, first, so nothing below rests on a probe that always
    // answers "alive". A reload is exactly what the fixed path must NOT do.
    await mountConsole(page)
    await plant(page)
    expect(await survived(page)).toEqual({ realm: true, node: true })

    await page.goto('/profile')
    await page.waitForSelector('[data-testid=nav-user]', { state: 'attached', timeout: 30_000 })
    expect(await survived(page)).toEqual({ realm: false, node: false })
  })

  test('Profile, from the account menu, is a client transition', async ({ page }) => {
    await mountConsole(page)
    await plant(page)

    // Count document loads on the main frame for a third, independent reading.
    let loads = 0
    page.on('load', () => {
      loads++
    })

    await accountTrigger(page).click()
    const menu = page.locator('[role=menu]')
    await menu.waitFor()
    await page.screenshot({ path: 'e2e-shots/nav-account-menu.png', animations: 'disabled' })
    await menu.getByRole('menuitem', { name: 'Profile' }).click()

    // It arrived…
    await expect(page).toHaveURL(/\/profile$/)
    await expect(page.getByText('Your account, security, and personal API keys.')).toBeVisible()

    // …without throwing the console away.
    expect(await survived(page)).toEqual({ realm: true, node: true })
    expect(loads).toBe(0)

    // The shell is still the shell: the rail is there and still says who you are.
    await expect(accountTrigger(page)).toBeVisible()
    await page.screenshot({ path: 'e2e-shots/nav-profile.png', animations: 'disabled' })
  })

  test('Back is a client transition too', async ({ page }) => {
    // Next reloads the page on `popstate` for any history entry it did not mark as
    // its own, so a hand-rolled pushState that dropped that marker would look right
    // going forward and reload on every Back.
    await mountConsole(page)
    await plant(page)

    await accountTrigger(page).click()
    await page.locator('[role=menu]').getByRole('menuitem', { name: 'Profile' }).click()
    await expect(page).toHaveURL(/\/profile$/)

    await page.goBack()
    await expect(page).toHaveURL(/\/$/)
    expect(await survived(page)).toEqual({ realm: true, node: true })
  })

  test('a product opened from ⌘K is a client transition', async ({ page }) => {
    // The third surface that moves the app. All three call the same `router.push`,
    // so all three were the same reload — and all three are asserted, because "we
    // fixed the account menu" is the shape of claim that leaves two behind.
    await mountConsole(page)
    await plant(page)

    await page.keyboard.press('ControlOrMeta+k')
    const input = page.getByPlaceholder('Search apps and commands…')
    await input.waitFor()
    await input.fill('billing')
    await page.keyboard.press('Enter')

    await expect(page).toHaveURL(/\/billing/)
    expect(await survived(page)).toEqual({ realm: true, node: true })
  })

  test('a product opened from the rail is a client transition', async ({ page }) => {
    // The reported symptom was Profile, but the cause was the router, so the fix has
    // to hold for the rail — the navigation people make all day.
    await mountConsole(page)
    await plant(page)

    // The rail's rows are buttons; the first visible one in document order is the
    // persistent rail's (the flyout and drawer mounts follow it).
    await page.getByRole('button', { name: 'Models', exact: true }).filter({ visible: true }).first().click()
    await expect(page).toHaveURL(/\/models/)
    expect(await survived(page)).toEqual({ realm: true, node: true })
    await expect(page.locator('[data-testid="product-content"]').first()).toBeVisible()
  })
})
