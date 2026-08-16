/**
 * What a model row does with the two things the catalog often does not carry.
 *
 * They look alike in source — both are "the field is empty" — and they get
 * opposite treatments, because the two absences mean different things:
 *
 *  - A DESCRIPTION is normally absent. Measured on the live catalog through the
 *    console's own origin: 397 of 432 models publish none, and all 35 that do are
 *    the house Zen/Enso family. So the row renders NOTHING. A placeholder here
 *    would be the rule rather than the exception — 397 identical lines saying the
 *    catalog is a catalog — and that is noise wearing honesty's clothes.
 *  - A SCORE is normally present, so its absence is worth marking, and it is an
 *    em-dash. Never a zero, never a guess: an absent measurement is not a bad one.
 *
 * This spec exists to stop either treatment drifting into the other. It fails if
 * someone fills the score column with a zero, and it fails if someone adds
 * placeholder prose to the 92% of rows that legitimately have nothing to say.
 */
import { test, expect, type Page } from '@playwright/test'
import { primeSession } from './_session'

/** Two Zen models: one the pricing catalog describes, one it does not. */
const PRICING = {
  models: [
    {
      name: 'zen-described',
      fullName: 'Zen Described',
      description: 'A model the catalog carries copy for.',
      family: 'zen',
      provider: 'Hanzo',
      owned_by: 'zenlm',
      pricing: { input: 1, output: 2 },
      context: 128000,
    },
    // No `description` key at all — the shape the live-only merge produces.
    { name: 'zen-bare', family: 'zen', provider: 'Hanzo', owned_by: 'zenlm', pricing: { input: 0, output: 0 } },
  ],
}

const LIVE = { data: [{ id: 'zen-described', owned_by: 'zenlm' }, { id: 'zen-bare', owned_by: 'zenlm' }] }

async function stub(page: Page): Promise<void> {
  await page.route('**/v1/**', async (route) => {
    const url = route.request().url()
    if (url.includes('pricing/models')) return route.fulfill({ json: PRICING })
    if (/\/v1\/models(\?|$)/.test(url)) return route.fulfill({ json: LIVE })
    return route.fulfill({ json: { status: 'ok', msg: '', data: [], total: 0 } })
  })
}

test('a described row shows its copy; a bare row says nothing and keeps its em-dash', async ({ page }) => {
  await stub(page)
  await primeSession(page)
  await page.setViewportSize({ width: 1280, height: 1600 })
  await page.goto('/models')

  // The id appears twice — once as a suggested chip, once as the row — so this is
  // only a "the catalog has painted" wait, not a locator for the row itself.
  await page.getByText('zen-bare', { exact: true }).first().waitFor()
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {})))
  })

  // The model that HAS copy shows the copy.
  await expect(page.getByText('A model the catalog carries copy for.')).toBeVisible()

  // The model that does not shows NO stand-in prose. Checked as text on the page
  // rather than per-row, because a placeholder added anywhere would land on ~92% of
  // rows and this is the assertion that would catch it.
  const body = await page.evaluate(() => document.body.innerText)
  expect(body).not.toMatch(/no description/i)
  expect(body).not.toMatch(/description (unavailable|not available|missing)/i)

  // Neither model is in the published benchmark corpus, so the score column stays an
  // em-dash. A zero here would be a measurement nobody took.
  await expect(page.getByText('—').first()).toBeVisible()
  expect(await page.getByText('0.0', { exact: true }).count()).toBe(0)

  await page.screenshot({ path: 'e2e-shots/models-row-absences.png' })
})
