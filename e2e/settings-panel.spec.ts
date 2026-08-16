/**
 * The settings panel, and the rail's brand lockup.
 *
 * Two claims a unit test cannot make, so both are measured on computed style and
 * geometry in a real browser:
 *
 *  1. Settings is a PANEL — five groups, each on the shared `Fieldset` surface,
 *     each carrying the way to the one place that owns its subject. A group that
 *     shows values it cannot write must not also draw a Save.
 *  2. The rail's org control is the ANCHOR of its surface: `@hanzo/ui`'s `lead`
 *     steps the row to 56, the mark to 36 and the label to `$6`/700. Reading it
 *     off the DOM is the only way to know the prop reached the markup — a
 *     `className` descendant selector into another package's internals would
 *     type-check and measure wrong.
 *
 * Animations are awaited before every measurement: a mid-animation screenshot is
 * how a false defect gets filed against a control that was merely still moving.
 */
import { test, expect, type Page } from '@playwright/test'
import { primeSession } from './_session'

const ORG = {
  owner: 'admin',
  name: 'hanzo',
  displayName: 'Hanzo AI',
  websiteUrl: 'https://hanzo.ai',
  createdTime: '2026-03-13T20:31:14Z',
}

/** Answer every call this screen makes; the panel itself is what is under test. */
async function stub(page: Page): Promise<void> {
  await page.route('**/v1/**', async (route) => {
    const url = route.request().url()
    if (url.includes('get-organization')) {
      return route.fulfill({ json: { status: 'ok', msg: '', data: ORG } })
    }
    if (url.includes('/enablement')) {
      return route.fulfill({ json: { status: 'ok', msg: '', data: { offered: false, on: false } } })
    }
    return route.fulfill({ json: { status: 'ok', msg: '', data: [], total: 0 } })
  })
}

/** Nothing is measured until every animation has finished. */
async function settled(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {})))
  })
}

test.beforeEach(async ({ page }) => {
  await stub(page)
  await primeSession(page)
})

test('settings is five groups on one surface, each pointing at its owner', async ({ page }) => {
  await page.goto('/settings')
  // Anchored on copy only this panel carries — "Organization" is also a rail row,
  // so waiting on it can resolve before the groups have painted.
  // Generous: against a dev server this is the route's first compile.
  await page.getByText(/passkeys and connected accounts/i).waitFor({ timeout: 30_000 })
  await settled(page)

  for (const legend of ['Organization', 'Account', 'Security', 'Billing', 'Developer']) {
    await expect(page.getByText(legend, { exact: true }).first()).toBeVisible()
  }

  // Every group sits on the SAME surface — one fill, one radius, one edge. Read it
  // off the rendered box rather than trusting that each caller passed the same props.
  //
  // The legend text alone is not a locator here: "Organization" is also a rail row,
  // and "Billing" a product. So the search is scoped to the content column, and the
  // group is found by walking UP from the legend to the first ancestor that draws an
  // edge — which is what a Fieldset IS, whatever its markup happens to nest.
  const surfaces = await page.evaluate(() => {
    const nav = document.querySelector('[aria-label="Navigation"]')
    const legends = ['Organization', 'Account', 'Security', 'Billing', 'Developer']
    const seen: { legend: string; bg: string; radius: string; border: string }[] = []
    for (const l of legends) {
      const el = [...document.querySelectorAll('*')].find(
        (e) =>
          e.children.length === 0 &&
          e.textContent?.trim() === l &&
          !nav?.contains(e) &&
          // A cross-link is a control, not a legend, and a button draws its own edge.
          !e.closest('button') &&
          (e as HTMLElement).getBoundingClientRect().width > 0,
      )
      let box: HTMLElement | null = (el as HTMLElement | null)?.parentElement ?? null
      while (box && getComputedStyle(box).borderTopWidth !== '1px') box = box.parentElement
      if (!box) continue
      const cs = getComputedStyle(box)
      seen.push({ legend: l, bg: cs.backgroundColor, radius: cs.borderTopLeftRadius, border: cs.borderTopWidth })
    }
    return seen
  })
  expect(surfaces.map((s) => s.legend)).toEqual(['Organization', 'Account', 'Security', 'Billing', 'Developer'])
  expect(new Set(surfaces.map((s) => `${s.bg}|${s.radius}|${s.border}`)).size).toBe(1)

  // Read-only by construction: this screen writes nothing, so it offers no Save.
  await expect(page.getByRole('button', { name: /save/i })).toHaveCount(0)

  // Identity is owned elsewhere and the panel says where, by host.
  const idLink = page.getByRole('button', { name: /hanzo\.id/i })
  await expect(idLink.first()).toBeVisible()

  await page.screenshot({ path: 'e2e-shots/settings-panel.png', fullPage: true })
})

test('the panel does not scroll the body sideways on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/settings')
  // Anchored on copy only this panel carries — "Organization" is also a rail row,
  // so waiting on it can resolve before the groups have painted.
  // Generous: against a dev server this is the route's first compile.
  await page.getByText(/passkeys and connected accounts/i).waitFor({ timeout: 30_000 })
  await settled(page)

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(scrollWidth).toBe(clientWidth)

  await page.screenshot({ path: 'e2e-shots/settings-panel-mobile.png', fullPage: true })
})

test('the rail brand lockup is the anchor of its surface', async ({ page }) => {
  await page.goto('/settings')
  // The control renders twice — once in the desktop rail, once in the mobile
  // drawer — so it is located inside the Navigation landmark, not by test id alone.
  await page.getByLabel('Navigation', { exact: true }).getByTestId('switcher-context').waitFor()
  await settled(page)

  const lockup = await page.evaluate(() => {
    const nav = document.querySelector('[aria-label="Navigation"]')
    const t = nav?.querySelector('[data-testid="switcher-context"]') as HTMLElement | null
    if (!t) return null
    // The org NAME, not the monogram glyph inside the mark — both are leaf text, and
    // the glyph comes first in document order, so it is chosen by width.
    const label = [...t.querySelectorAll('*')]
      .filter((e) => e.children.length === 0 && (e.textContent ?? '').trim().length > 0)
      .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0]
    const cs = label ? getComputedStyle(label) : null
    // The mark is the square that leads the row — widest-of-the-shortest, so find
    // the child whose box is closest to square and tallest.
    const mark = [...t.querySelectorAll('*')]
      .map((e) => e.getBoundingClientRect())
      .filter((b) => b.width > 20 && Math.abs(b.width - b.height) < 3)
      .sort((a, b) => b.height - a.height)[0]
    return {
      rowH: Math.round(t.getBoundingClientRect().height),
      markH: mark ? Math.round(mark.height) : null,
      fontSize: cs?.fontSize ?? null,
      fontWeight: cs?.fontWeight ?? null,
    }
  })

  expect(lockup).not.toBeNull()
  // 56 / 36 / $6 (17px) / 700 — the `lead` step, straight off the rendered DOM.
  expect(lockup!.rowH).toBe(56)
  expect(lockup!.markH).toBe(36)
  expect(lockup!.fontSize).toBe('17px')
  expect(lockup!.fontWeight).toBe('700')

  await page.screenshot({ path: 'e2e-shots/rail-lockup.png', clip: { x: 0, y: 0, width: 280, height: 120 } })
})
