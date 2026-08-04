/**
 * Onboarding — Continue never moves, and Skip is always reachable.
 *
 * The complaint this pins: the Continue button landed at a different height on
 * every step, so a user clicking through had to re-aim each time. StepActions was
 * the LAST CHILD of a flex column, so its y was whatever the step's content
 * happened to add up to. It is now a SLOT on StepShell above a content area with
 * a reserved height — one placement, decided in one place.
 *
 * This is a GEOMETRY assertion on purpose. The JSX move is invisible to a unit
 * test (both shapes render the same button with the same label); only the painted
 * box says whether the thing the user complained about is fixed.
 */
import { test, expect, type Page } from '@playwright/test'
import { primeSession } from './_session'

/** Every step whose footer must line up, in flow order. */
const STEPS = ['Secure your account', 'Data & consent', 'Your workspace', 'Free trial credits', 'AI access']

/** The y of the actions row, in page coordinates. */
async function actionsY(page: Page): Promise<number> {
  const row = page.getByTestId('onboarding-actions')
  await expect(row).toBeVisible()
  const box = await row.boundingBox()
  if (!box) throw new Error('actions row has no box')
  return Math.round(box.y)
}

/** Advance past the current step, preferring Skip so the flow stays clickable. */
async function advance(page: Page): Promise<void> {
  const row = page.getByTestId('onboarding-actions')
  const skip = row.getByRole('button', { name: /^(Skip|Keep the default)/ })
  if (await skip.count()) {
    await skip.first().click()
    return
  }
  // Consent has no Skip by design (accepting Terms is not optional), so tick the
  // agreement and use Continue. Tick only if Continue is still disabled — a caller
  // may already have ticked it, and toggling twice turns it back OFF.
  const cont = row.getByRole('button', { name: /Continue/ })
  if (await cont.isDisabled()) {
    const agree = page.locator('[role="switch"], input[type="checkbox"]').first()
    if (await agree.count()) await agree.click()
  }
  await cont.click()
}

test.beforeEach(async ({ page }) => {
  // Anything the steps reach for answers empty — they are best-effort and must
  // still render. Registered BEFORE primeSession so its handlers win.
  await page.route('**/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await primeSession(page)
  // primeSession marks onboarding DONE so other specs can reach the app. This
  // spec is about the wizard, so un-mark it (the tour gate stays seeded).
  await page.addInitScript(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('hz_onboarding_done:')) localStorage.removeItem(k)
  })
})

test('Continue lands at the same height on every step', async ({ page }) => {
  await page.goto('/')

  const seen: { step: string; y: number }[] = []
  for (const step of STEPS) {
    await expect(page.getByTestId('onboarding-step-title')).toHaveText(step, { timeout: 15_000 })
    seen.push({ step, y: await actionsY(page) })
    await advance(page)
  }

  const ys = seen.map((s) => s.y)
  const spread = Math.max(...ys) - Math.min(...ys)
  expect(
    spread,
    `Continue moved ${spread}px across steps — ${seen.map((s) => `${s.step}:${s.y}`).join(' ')}`,
  ).toBeLessThanOrEqual(2)
})

test('every step always offers an enabled way forward', async ({ page }) => {
  await page.goto('/')

  // The real invariant behind "skip so easy to click through": on every step there
  // is ALWAYS at least one enabled control that advances you — Skip where there is
  // something to decline, Continue where there is not. Credits swaps between the
  // two on purpose (Skip appears only when a card could be added; otherwise
  // Continue carries you), so asserting a literal "Skip" everywhere would be
  // asserting the wrong thing. Being STUCK is the defect.
  for (const step of STEPS) {
    await expect(page.getByTestId('onboarding-step-title')).toHaveText(step, { timeout: 15_000 })

    // Consent gates Continue on accepting the Terms — not optional, so tick it
    // first and then assert the way forward exists.
    if (step === 'Data & consent') {
      const agree = page.locator('[role="switch"], input[type="checkbox"]').first()
      if (await agree.count()) await agree.click()
    }

    const row = page.getByTestId('onboarding-actions')
    const forward = row.getByRole('button', { name: /^(Skip|Keep the default|Continue)/ })
    const n = await forward.count()
    expect(n, `${step} renders no forward control`).toBeGreaterThan(0)

    let usable = 0
    for (let i = 0; i < n; i++) {
      const b = forward.nth(i)
      if (await b.isDisabled()) continue
      const box = await b.boundingBox()
      if (!box || box.height < 24) continue
      const hit = await b.evaluate((el) => {
        const r = el.getBoundingClientRect()
        return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
      })
      if (hit) usable++
    }
    expect(usable, `${step} has no enabled, clickable way forward`).toBeGreaterThan(0)

    await advance(page)
  }
})
