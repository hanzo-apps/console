import { expect, test } from '@playwright/test'

import { primeSession } from './_session'

/**
 * The org switcher's sheet, measured — because the defect it pins is invisible
 * to every other layer we have.
 *
 * The sheet padded a step and every row inside padded the SAME step again, so
 * the content sat two steps off both edges and the sheet read as a frame around
 * a narrower menu. Nothing catches that: it type-checks, it renders, and a unit
 * test asserting "the row has px=$2" passes either way — the bug is the SUM of
 * two correct-looking declarations in two files, which only exists once a
 * browser has resolved both.
 *
 * So this asserts the RELATIONSHIP rather than either number: the gap between
 * the sheet's edge and the row's edge is a gutter (a hover pill must not touch
 * the edge) and not an indent (the row owns the content inset). Stated as a
 * range, because the exact token may move and the relationship may not.
 */
const GUTTER_MIN = 1
const GUTTER_MAX = 8

test.describe('org switcher sheet', () => {
  test.beforeEach(async ({ page }) => {
    await primeSession(page)
  })

  test('content is a gutter off the sheet, not two steps', async ({ page }) => {
    await page.goto('/')
    // Two controls carry this id — the rail's and the mobile drawer's — and
    // exactly one is visible at a given width. Scope to the painted one.
    const trigger = page.getByTestId('switcher-context').locator('visible=true').first()
    await expect(trigger).toBeVisible()
    await trigger.click()

    // The sheet, and the first row inside it. `role=menu` is what the sheet
    // publishes; a row is a radio (one of a set) or a menuitem (an action).
    const sheet = page.getByRole('menu').first()
    await expect(sheet).toBeVisible()
    // The first selectable row in DOM order. A CSS locator rather than two
    // role locators OR'd together: `.or()` resolves to the first match of
    // EITHER set, which is not necessarily the first row — it picked a narrower
    // nested element and reported a 66px gutter on a sheet whose real gutter is
    // 4px. Measure the row, not something inside it.
    const row = sheet.locator('[role=radio],[role=menuitem]').first()
    await expect(row).toBeVisible()

    const s = await sheet.boundingBox()
    const r = await row.boundingBox()
    expect(s, 'the sheet has a box').toBeTruthy()
    expect(r, 'the row has a box').toBeTruthy()

    const left = r!.x - s!.x
    const right = s!.x + s!.width - (r!.x + r!.width)

    expect.soft(left, `left gutter ${left}px`).toBeGreaterThanOrEqual(GUTTER_MIN)
    expect.soft(left, `left gutter ${left}px`).toBeLessThanOrEqual(GUTTER_MAX)
    expect.soft(right, `right gutter ${right}px`).toBeGreaterThanOrEqual(GUTTER_MIN)
    expect.soft(right, `right gutter ${right}px`).toBeLessThanOrEqual(GUTTER_MAX)

    // Symmetric, or the sheet reads as drifting off its trigger.
    expect(Math.abs(left - right), 'gutters match').toBeLessThanOrEqual(1)

    await page.screenshot({ path: 'e2e-shots/switcher-gutter.png' })
  })

  test('the sheet is fully on screen and opaque', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('switcher-context').locator('visible=true').first().click()
    const sheet = page.getByRole('menu').first()
    await expect(sheet).toBeVisible()

    const box = (await sheet.boundingBox())!
    const view = page.viewportSize()!
    expect(box.x, 'not off the left edge').toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, 'not off the right edge').toBeLessThanOrEqual(view.width + 1)

    // A menu you can read the page through is a menu with no background.
    // Asserted with a RETRYING matcher: the sheet enters on `hz-menu-in`, an
    // opacity keyframe, so an instant read catches it mid-animation and reports
    // a translucent sheet that is merely still arriving.
    await expect(sheet).toHaveCSS('opacity', '1')
  })
})
