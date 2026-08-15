/**
 * e2e: one sheet, one left edge.
 *
 * The org menu had two of them. Its search field was inset one step and every
 * row under it two, so the field read as though it belonged to a different
 * panel — and nothing caught it, because the field and the rows were drawn by
 * different components and a build is green either way. This measures the thing
 * that was wrong: where each row's box, each row's leading glyph, and the search
 * field's box actually start, in pixels, from the inside of the sheet.
 *
 * It is a browser assertion because it can only be one. The insets are theme
 * tokens resolved at paint; the two components agreed about the token name and
 * disagreed about which token, which no typecheck can see.
 *
 * Run: BASE_URL=http://localhost:4000 npx playwright test menu-inset
 */
import { test, expect, type Page } from '@playwright/test'
import { primeSession } from './_session'

/** A tenant nobody is a member of — it exists only in the cross-tenant list. */
const ORGS = [
  { owner: 'admin', name: 'hanzo', displayName: 'Hanzo AI' },
  { owner: 'admin', name: 'acme-industrial', displayName: 'Acme Industrial' },
]

async function mount(page: Page) {
  await page.route(/\/(v1|admin\/iam)\//, async (route) => {
    const url = route.request().url()
    if (url.includes('get-organizations')) {
      const q = new URL(url).searchParams.get('value') ?? ''
      const rows = ORGS.filter((o) => o.displayName.toLowerCase().includes(q.toLowerCase()))
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok', data: rows, data2: rows.length }),
      })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', data: [] }) })
  })
  // The reserved `admin` org IS the super admin — the identity that gets a
  // search field, because its list is the cross-tenant one.
  await primeSession(page, { owner: 'admin', name: 'z', email: 'z@hanzo.ai', displayName: 'Z Admin' })
  await page.goto('/')
  await page.waitForSelector('[data-testid=nav-user]', { state: 'attached', timeout: 30_000 })
}

/**
 * Every left edge inside the sheet, measured from the sheet's own content box —
 * so the numbers are insets, not viewport coordinates, and stay comparable when
 * the sheet moves.
 */
async function insets(page: Page) {
  // The sheet that is actually OPEN. The shell mounts its rail three times and
  // a closed popover can still be in the document, so "the first [role=menu]"
  // measures rows against a box they are not in and reports a constant offset
  // that looks like an inset and is not.
  const menu = page.locator('[role=menu]').filter({ visible: true }).last()
  await menu.waitFor()
  await page.waitForTimeout(400) // the enter animation; a box read early is the wrong box
  return menu.evaluate((sheet) => {
    const s = getComputedStyle(sheet)
    const origin =
      sheet.getBoundingClientRect().left + Number.parseFloat(s.paddingLeft) + Number.parseFloat(s.borderLeftWidth)
    const at = (el: Element) => Math.round((el.getBoundingClientRect().left - origin) * 10) / 10
    const text = (el: Element) => (el.textContent ?? '').trim().slice(0, 24)

    const rows = [...sheet.querySelectorAll('[role=menuitem], [role=radio]')]
    /**
     * The LEADING glyph — the row's first child when that child is not the
     * label. Selecting `svg, img` instead finds the trailing check on a row that
     * has no leading icon, which reads as a glyph 268px in: the measurement's
     * own bug, and the kind that makes a real defect look like noise. The label
     * is the child that grows; everything before it is the glyph column.
     */
    const lead = (row: Element): Element | null => {
      const first = row.firstElementChild
      if (!first || getComputedStyle(first).flexGrow === '1') return null
      return first
    }
    const field = sheet.querySelector('input')
    // The field's BOX is the bordered row it sits in, not the input itself.
    const fieldBox = field?.closest('div,span')?.parentElement ?? null

    return {
      rows: rows.map((r) => {
        const g = lead(r)
        return { label: text(r), box: at(r), glyph: g ? at(g) : null }
      }),
      // Headings ("Organization", "Project") — they name the rows, so they sit
      // where the rows do.
      headings: [...sheet.querySelectorAll('span, div')]
        .filter((el) => !el.children.length && /^(Organization|Project|Theme)$/.test(text(el)))
        .map((el) => ({ label: text(el), box: at(el) })),
      field: field
        ? { box: fieldBox ? at(fieldBox) : null, glyph: fieldBox?.firstElementChild ? at(fieldBox.firstElementChild) : null }
        : null,
    }
  })
}

const only = (ns: (number | null)[]) => [...new Set(ns.filter((n): n is number => n !== null))]

test('the organization sheet has ONE left edge', async ({ page }) => {
  await mount(page)
  await page.getByTestId('switcher-context').first().click()
  const m = await insets(page)

  // eslint-disable-next-line no-console
  console.log('ORG MENU', JSON.stringify(m, null, 2))

  expect(m.rows.length, 'rows are reachable at all').toBeGreaterThanOrEqual(3)

  // THE assertion: every row box, every heading and the search field's box start
  // at the same distance from the inside of the sheet.
  expect(only(m.rows.map((r) => r.box)), 'row boxes').toHaveLength(1)
  expect(only(m.headings.map((h) => h.box)), 'headings').toEqual(only(m.rows.map((r) => r.box)))
  if (m.field) expect(m.field.box, 'the search field box').toBe(m.rows[0].box)

  // …and every leading glyph lines up with every other, so the column of icons
  // down the left of the sheet is a column.
  expect(only(m.rows.map((r) => r.glyph)), 'row glyphs').toHaveLength(1)
})

test('the account sheet has ONE left edge', async ({ page }) => {
  await mount(page)
  await page.getByTestId('nav-user').first().click()
  const m = await insets(page)

  // eslint-disable-next-line no-console
  console.log('ACCOUNT MENU', JSON.stringify(m, null, 2))

  expect(m.rows.length).toBeGreaterThanOrEqual(5)
  expect(only(m.rows.map((r) => r.box)), 'row boxes').toHaveLength(1)
  expect(only(m.headings.map((h) => h.box)), 'headings').toEqual(only(m.rows.map((r) => r.box)))
})
