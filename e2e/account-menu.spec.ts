/**
 * The ONE account control, at the foot of the rail — and the ONE org switch.
 *
 * There used to be three account-ish menus: an org switcher at the top of the
 * sidebar, an account popover at the bottom, and a third in the mobile drawer,
 * with four ways to sign out between them. They became one control that answered
 * BOTH "who am I" and "where am I".
 *
 * They have now been split again, but by QUESTION rather than by accident: the
 * account control at the foot answers who you are (identity, team, personal
 * settings, balance, the way out), and `ContextSwitcher` at the TOP-LEFT answers
 * where you are (organization + project, together, beside the tenant's mark).
 * So the cross-tenant reach is asserted against the context switcher below, and
 * the account menu is asserted to no longer offer a tenant at all.
 *
 * Everything is asserted on computed style and geometry. The failure this guards
 * against is a menu that is present in the DOM and unreadable — a library that
 * paints with utility class names renders exactly that in this app, because
 * Tailwind never scanned node_modules. An `expect(locator).toBeVisible()` would
 * have passed on the broken build.
 */
import { test, expect, type Page } from '@playwright/test'
import { primeSession } from './_session'

/** The cross-tenant org list an admin console reaches — none of them memberships. */
const ORGS = [
  { owner: 'admin', name: 'hanzo', displayName: 'Hanzo' },
  { owner: 'admin', name: 'maxpower', displayName: 'Max Power' },
  { owner: 'admin', name: 'acme-industrial', displayName: 'Acme Industrial' },
]

/** Every org-scoped request the page made, with the scope it carried. */
type Scoped = { url: string; org: string | null }

/**
 * The account trigger in the persistent rail.
 *
 * The shell mounts the SAME control three times — the rail, the collapsed-rail
 * hover flyout, and the phone drawer — because `SidebarNav` is one component with
 * three mounts. All three stay in the DOM (the flyout and drawer are offset, not
 * unmounted), which predates this change and belongs to the shell lane; the first
 * in document order is the persistent rail, and every geometry assertion below
 * checks it really is the one on screen.
 */
const accountTrigger = (page: Page) => page.getByTestId('nav-user').first()

/** The trigger inside the phone's account sheet — the last mount in the document. */
const drawerTrigger = (page: Page) => page.getByTestId('nav-user').last()

/** The org + project control at the top-left — the only thing that switches tenant. */
const contextTrigger = (page: Page) => page.getByTestId('switcher-context').first()

async function mountConsole(page: Page, seen: Scoped[]) {
  // The standalone console reaches the cross-tenant list through its own gated
  // `/admin/iam` proxy; the go:embed build reaches cloud's `/v1/iam` directly.
  // Both are covered so the spec does not silently pass on the wrong one.
  await page.route(/\/(v1|admin\/iam)\//, async (route) => {
    const url = route.request().url()
    seen.push({ url, org: route.request().headers()['x-org-id'] ?? null })

    if (url.includes('get-organizations')) {
      const query = new URL(url).searchParams.get('value') ?? ''
      const rows = ORGS.filter((o) => o.displayName.toLowerCase().includes(query.toLowerCase()))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', data: rows, data2: rows.length }) })
    }
    if (url.includes('billing/balance')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ spendableCents: 4250 }) })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', data: [] }) })
  })
  // The reserved `admin` org IS the super admin — the only identity that reaches
  // every tenant, which is what an admin console is for.
  // Record every write to the console's org scope. The switch reloads the page and
  // the harness re-seeds the scope on load, so the write is observed as it happens.
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'hanzo.console.org') {
        const log = JSON.parse(sessionStorage.getItem('spec.scope.writes') ?? '[]') as string[]
        log.push(`${key}=${value}`)
        setItem.call(sessionStorage, 'spec.scope.writes', JSON.stringify(log))
      }
      return setItem.call(this, key, value)
    }
  })
  await primeSession(page, { owner: 'admin', name: 'z', email: 'z@hanzo.ai', displayName: 'Z Admin' })
  await page.goto('/')
  await page.waitForSelector('[data-testid=nav-user]', { state: 'attached', timeout: 30_000 })
}

const px = (v: string) => Number.parseFloat(v)
const rgb = (v: string) => (v.match(/\d+(\.\d+)?/g) ?? []).map(Number)
const luminance = ([r, g, b]: number[]) => {
  const f = (c: number) => { const n = c / 255; return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const contrast = (a: number[], b: number[]) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((m, n) => n - m)
  return (hi + 0.05) / (lo + 0.05)
}

test.describe('account control', () => {
  test('sits at the foot of the rail and paints in a shell with no Tailwind', async ({ page }) => {
    const seen: Scoped[] = []
    await mountConsole(page, seen)

    // The control is at the BOTTOM — below the middle of the sidebar, not above it.
    const trigger = accountTrigger(page)
    const box = (await trigger.boundingBox())!
    const viewport = page.viewportSize()!
    expect(box.y).toBeGreaterThan(viewport.height / 2)
    expect(box.x).toBeLessThan(300)

    // Nothing else claims to switch orgs: the top-of-rail switcher is gone.
    await expect(page.getByLabel('Switch organization')).toHaveCount(0)

    await trigger.click()
    const menu = page.locator('[role=menu]')
    await menu.waitFor()

    const paint = await menu.evaluate((el) => {
      const s = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      return {
        bg: s.backgroundColor,
        radius: s.borderTopLeftRadius,
        borderWidth: s.borderTopWidth,
        z: s.zIndex,
        font: s.fontFamily,
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      }
    })

    // It PAINTS — an opaque surface, not a transparent stack of divs.
    expect(paint.bg).not.toBe('rgba(0, 0, 0, 0)')
    expect(px(paint.radius)).toBeGreaterThanOrEqual(8)
    expect(px(paint.borderWidth)).toBeGreaterThanOrEqual(1)
    // …in the app's own typeface, not a system fallback.
    expect(paint.font).toMatch(/Geist/i)

    // It is FULLY on screen and above the shell.
    expect(paint.rect.x).toBeGreaterThanOrEqual(0)
    expect(paint.rect.y).toBeGreaterThanOrEqual(0)
    expect(paint.rect.x + paint.rect.w).toBeLessThanOrEqual(viewport.width + 1)
    expect(paint.rect.y + paint.rect.h).toBeLessThanOrEqual(viewport.height + 1)
    // Nothing of the shell is painted over it.
    const onTop = await menu.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + 12)
      return el.contains(hit)
    })
    expect(onTop).toBe(true)

    // Rows are padded, tall enough to hit, and readable.
    const rows = await menu.locator('.hz-iam-row').evaluateAll((els) =>
      els.map((el) => {
        const s = getComputedStyle(el)
        return { pl: s.paddingLeft, h: el.getBoundingClientRect().height, color: s.color, text: (el.textContent ?? '').trim() }
      }),
    )
    expect(rows.length).toBeGreaterThanOrEqual(5)
    for (const row of rows) {
      expect(px(row.pl), `"${row.text}" padding`).toBeGreaterThanOrEqual(8)
      expect(row.h, `"${row.text}" height`).toBeGreaterThanOrEqual(24)
      expect(contrast(rgb(row.color), rgb(paint.bg)), `"${row.text}" contrast`).toBeGreaterThanOrEqual(4.5)
    }

    // Hover is a real state — the switch-that-rendered-identical class of bug.
    const first = menu.locator('.hz-iam-row').first()
    const atRest = await first.evaluate((el) => getComputedStyle(el).backgroundColor)
    await first.hover()
    expect(await first.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(atRest)

    await page.screenshot({ path: 'e2e-shots/account-menu-desktop.png', animations: 'disabled' })
  })

  test('nothing in it shouts', async ({ page }) => {
    await mountConsole(page, [])
    await accountTrigger(page).click()
    await page.locator('[role=menu]').waitFor()

    const shouting = await page.locator('[role=menu]').evaluate((el) =>
      [...el.querySelectorAll('*')].filter((n) => getComputedStyle(n).textTransform === 'uppercase').map((n) => n.textContent ?? ''),
    )
    expect(shouting).toEqual([])

    const typedInCaps = await page.locator('[role=menu]').evaluate((el) =>
      [...el.querySelectorAll('*')]
        .map((n) => (n.children.length ? '' : (n.textContent ?? '').trim()))
        .filter((t) => /^[A-Z][A-Z0-9 &/·—-]{3,}$/.test(t)),
    )
    expect(typedInCaps).toEqual([])
  })

  test('the context switcher reaches a tenant the caller is not a member of', async ({ page }) => {
    const seen: Scoped[] = []
    await mountConsole(page, seen)
    // Tenancy is the TOP-LEFT control's job now, not the account menu's.
    await contextTrigger(page).click()

    // Acme is nobody's membership — it exists only in the cross-tenant list an
    // admin may search. A memberships-only switcher could not offer it at all.
    await page.getByLabel('Find an organization').fill('acme')
    // `radiogroup`/`radio`, not `listbox`/`option`: @hanzo/gui's `role` union is
    // React Native's a11y set, which carries `option` but NOT `listbox`.
    const orgList = page.getByRole('radiogroup', { name: 'Organizations' })
    const acme = orgList.getByRole('radio', { name: 'Acme Industrial' })
    await acme.waitFor()
    // Scoped to the ORG group — the same popover also lists projects, and a bare
    // getByRole('radio') would silently count those too.
    await expect(orgList.getByRole('radio')).toHaveCount(1)

    await page.screenshot({ path: 'e2e-shots/account-menu-find-org.png', animations: 'disabled' })

    // MONEY PATH. Entering a tenant must go through the console's OWN org scope —
    // the single seam that persists `hanzo.console.org`, reloads, and is read back
    // as `X-Org-Id` on every call. A switcher that minted its own would bypass the
    // scoping and its billing attribution without anything visibly breaking, so the
    // write itself is what is asserted. (The scope key is recorded through a wrapped
    // setter because the reload re-runs the harness's own seeding.)
    await acme.click()
    await page.waitForFunction(
      () => sessionStorage.getItem('spec.scope.writes')?.includes('acme-industrial') ?? false,
    )
    const writes: string[] = JSON.parse(
      (await page.evaluate(() => sessionStorage.getItem('spec.scope.writes'))) ?? '[]',
    )
    expect(writes).toContain('hanzo.console.org=acme-industrial')

    // And every scoped call the page made before that carried the admin's own
    // scope — the menu never issued a request under someone else's tenant.
    for (const call of seen.filter((s) => s.org !== null)) expect(call.org).toBe('admin')
  })

  test('the same control is the account surface on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await mountConsole(page, [])

    // On a phone the rail is a drawer, so the account control lives in the
    // right-hand account sheet — the SAME component, not a phone-only copy.
    await page.getByLabel('Account and settings').click()
    await drawerTrigger(page).click()
    const menu = page.locator('[role=menu]')
    await menu.waitFor()

    const rect = await menu.evaluate((el) => {
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height, bg: getComputedStyle(el).backgroundColor }
    })
    expect(rect.bg).not.toBe('rgba(0, 0, 0, 0)')
    // …and it paints OVER the sheet it was opened from. A sheet pinned at a
    // literal 1000 swallowed the menu whole: present, measurable, unclickable.
    const onTop = await menu.evaluate((el) => {
      const r = el.getBoundingClientRect()
      return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + 12))
    })
    expect(onTop).toBe(true)
    expect(rect.x).toBeGreaterThanOrEqual(0)
    expect(rect.x + rect.w).toBeLessThanOrEqual(391)
    expect(rect.y).toBeGreaterThanOrEqual(0)
    expect(rect.y + rect.h).toBeLessThanOrEqual(845)

    // The page itself never scrolls sideways to accommodate it.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)

    await page.screenshot({ path: 'e2e-shots/account-menu-mobile.png', animations: 'disabled' })
  })
})
