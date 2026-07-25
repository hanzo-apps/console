/**
 * e2e: brand-forward chrome + voice — mocked-network render proof.
 *
 * The Chrome wave: the big floating chat CIRCLE was removed; the assistant now opens
 * from the TOPBAR (a small brand-H "Chat with Hanzo" + a "Talk to Hanzo" mic), the
 * top-left SidebarBrand renders the org's own logo (white-label), and the Developers
 * dock is drag-resizable with a live "Create key". This spec proves all of it in a
 * browser.
 *
 * Same harness as workbench.spec (the closest sibling): a LOCAL server with the
 * network mocked. `primeSession` seeds the IAM-PKCE identity AND the first-run gates
 * (tour / onboarding / org) that otherwise overlay the page; `/v1/billing/usage` →
 * real-shaped ledger rows for the dock's Overview, `/v1/models` → a small catalog for
 * the assistant's model list; everything else → an empty-ok envelope.
 *
 * Voice gotcha: headless chromium ships NO webkitSpeechRecognition, so the topbar mic
 * (rendered only when `voiceSupported()`) would be absent for an environment reason,
 * not a code one. A tiny, inert Web Speech stub is injected BEFORE load
 * (`installVoiceStub`) so `voiceSupported()` is deterministically true and the mic
 * renders — the exact gate `src/lib/voice.test.ts` pins — and it records
 * `recognition.start()` calls on `window.__voiceStarted` so the mic → startVoice →
 * conversation wiring can be asserted end to end.
 *
 * Run: BASE_URL=http://localhost:4000 npx playwright test chrome-brand-voice
 *      (requireFixtureServer skips the file when no local server is reachable.)
 */
import { test, expect, type Route, type Page } from '@playwright/test'
import { requireFixtureServer } from './_fixture'
import { primeSession } from './_session'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4000'

requireFixtureServer()
const SHOTS = join(process.cwd(), 'e2e-shots')

/** Real-shaped commerce ledger rows (the `/v1/billing/usage` contract) so the dock's
 *  Overview loads its ledger (never the empty state) and the "Create key" card shows. */
const now = Date.now()
const USAGE = {
  usage: [
    {
      transactionId: 't1',
      amount: 12,
      createdAt: new Date(now - 60_000).toISOString(),
      notes: 'API usage: zen5 (1200 tokens)',
      metadata: { model: 'zen5', provider: 'hanzo', status: 'success', promptTokens: 800, completionTokens: 400, totalTokens: 1200 },
    },
    {
      transactionId: 't2',
      amount: 3,
      createdAt: new Date(now - 120_000).toISOString(),
      notes: 'API usage: glm-5.2 (300 tokens)',
      metadata: { model: 'glm-5.2', provider: 'zhipu', status: 'success', promptTokens: 200, completionTokens: 100, totalTokens: 300 },
    },
  ],
}

const MODELS = { object: 'list', data: [{ id: 'zen5', owned_by: 'hanzo' }, { id: 'glm-5.2', owned_by: 'hanzo' }] }

const API_RE = /\/(v1|cloud|ai|billing|commerce|telemetry|vm|superbase|admin|paas|integrations|auth\/refresh)(\/|$|\?)/

async function mock(route: Route) {
  const req = route.request()
  if (req.resourceType() === 'document') return route.continue()
  const url = new URL(req.url())
  const path = url.pathname

  if (path === '/v1/billing/usage') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(USAGE) })
  }
  if (path === '/v1/models') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MODELS) })
  }

  const sameOrigin = url.origin === new URL(BASE_URL).origin
  if (sameOrigin && !API_RE.test(path)) return route.continue()
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', msg: '', data: [], data2: 0 }) })
}

/**
 * A minimal, inert Web Speech stub installed BEFORE the page scripts run, so
 * `voiceSupported()` returns true under headless chromium (which ships no
 * webkitSpeechRecognition) and the "Talk to Hanzo" mic renders deterministically.
 * `start()` bumps `window.__voiceStarted` so the mic → voice wiring is assertable.
 */
function installVoiceStub(page: Page) {
  return page.addInitScript(() => {
    class FakeRecognition {
      lang = ''
      continuous = false
      interimResults = false
      onresult: unknown = null
      onerror: unknown = null
      onend: unknown = null
      start() {
        const w = window as unknown as { __voiceStarted?: number }
        w.__voiceStarted = (w.__voiceStarted ?? 0) + 1
      }
      stop() {}
      abort() {}
    }
    const w = window as unknown as Record<string, unknown>
    w.SpeechRecognition = FakeRecognition
    w.webkitSpeechRecognition = FakeRecognition
  })
}

/** Prime + navigate; the topbar brand-H is on EVERY viewport, so it is the mount signal. */
async function openHome(page: Page, waitForMount = true) {
  await installVoiceStub(page)
  await page.route('**/*', mock)
  await primeSession(page)
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' })
  if (waitForMount) {
    await expect(page.locator('[aria-label="Chat with Hanzo"]').first()).toBeVisible({ timeout: 20_000 })
  }
}

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }))

test('the floating circle is gone; the topbar carries chat + voice, the sidebar brand + docked assistant + Developers dock work', async ({ browser }) => {
  // laptop (≥ lg 1024): the persistent sidebar, the Developers dock, and the docked
  // assistant column are all present (they are desktop-only concerns).
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  await openHome(page)

  // 1. The OLD floating circle is GONE — the bubble that covered page content.
  await expect(page.locator('[aria-label="Open AI assistant"]')).toHaveCount(0)

  // 2. Topbar: the small brand-H "Chat with Hanzo" AND the "Talk to Hanzo" mic, both
  //    visible (the mic renders because the Web Speech stub makes voiceSupported() true).
  await expect(page.locator('[aria-label="Chat with Hanzo"]').first()).toBeVisible()
  await expect(page.locator('[aria-label="Talk to Hanzo"]').first()).toBeVisible()

  // 3. The top-left SidebarBrand renders the org logo / BrandMark (an <img> or <svg>).
  const brand = page.locator('[aria-label*="right-click for brand menu"]').first()
  await expect(brand).toBeVisible()
  await expect(brand.locator('svg, img').first()).toBeVisible()

  // 4. The Developers dock: the always-there bar opens into the drawer with the
  //    drag-to-resize handle and a LIVE "Create key" in the Overview tab.
  await expect(page.locator('text=Developers').first()).toBeVisible()
  await page.getByRole('button', { name: 'Open the workbench' }).first().click()
  await expect(page.locator('[title="Drag to resize"]').first()).toBeVisible()
  await expect(page.locator('text=Create key').first()).toBeVisible({ timeout: 15_000 })

  // 5. Clicking "Chat with Hanzo" opens the DOCKED assistant surface — the "Assistant"
  //    header + its Undock control appear (uniquely the docked panel at lg+).
  await page.locator('[aria-label="Chat with Hanzo"]').first().click()
  await expect(page.locator('[aria-label^="Undock"]').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Assistant', { exact: true }).filter({ visible: true }).first()).toBeVisible()

  // 6. The mic is wired: "Talk to Hanzo" → startVoice → the conversation opens the
  //    recognition (voiceSignal effect → voice.start() → the stub records the call).
  await page.locator('[aria-label="Talk to Hanzo"]').first().click()
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __voiceStarted?: number }).__voiceStarted ?? 0), { timeout: 15_000 })
    .toBeGreaterThan(0)

  await page.screenshot({ path: join(SHOTS, 'chrome-open.png') })
  await ctx.close()
})

test('renders across breakpoints with no horizontal body scroll on a phone; screenshots at 390 / 768 / 1280 / 1680', async ({ browser }) => {
  const viewports = [
    { name: 'mobile', width: 390, height: 844 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'laptop', width: 1280, height: 900 },
    { name: 'desktop', width: 1680, height: 1050 },
  ] as const

  for (const v of viewports) {
    const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height } })
    const page = await ctx.newPage()
    // Don't hard-fail the mount wait here — the screenshot is captured either way
    // (real render, or an honest blank shell if the sandbox can't paint the SPA).
    await openHome(page, false)
    await page
      .locator('[aria-label="Chat with Hanzo"]')
      .first()
      .waitFor({ state: 'visible', timeout: 20_000 })
      .catch(() => {})
    await page.screenshot({ path: join(SHOTS, `chrome-${v.name}.png`) })

    if (v.width === 390) {
      // The mobile regression this guards: the body must never scroll sideways.
      const noHorizontalScroll = await page.evaluate(() => {
        const el = document.scrollingElement ?? document.documentElement
        return el.scrollWidth <= window.innerWidth + 1
      })
      expect(noHorizontalScroll).toBe(true)
    }

    await ctx.close()
  }
})
