/**
 * e2e: Interactive Training (Fine-tuning → Interactive tab) — mocked-network render proof.
 *
 * Runs against a LOCAL server (BASE_URL=http://localhost:4000) with the whole network
 * mocked (same pattern as budgets-responsive / entitlement-sidebar): `/auth/session` → a
 * super-admin account so the shell mounts and the entitlement gate is bypassed, the engine
 * training plane (`/v1/training/clients` + `/clients/<id>`) → real-shaped fixtures,
 * everything else → an empty-ok envelope.
 *
 * It proves the ENGINE plane surface: the Interactive tab renders, the New-client form
 * validates an empty base_model (Create disabled until a model is typed), a mocked client
 * row reports status `ready`, and selecting it renders the loss-curve chart region.
 *
 * Run: BASE_URL=http://localhost:4000 npx playwright test interactive-training
 */
import { test, expect, type Route, type Page } from '@playwright/test'
import { requireFixtureServer } from './_fixture'
import { primeSession } from './_session'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4000'

// These render specs assert LOCAL fixture data; skip cleanly when that server is down.
requireFixtureServer()
const ORG = 'hanzo'
const SHOTS = join(process.cwd(), 'e2e-shots')

const ACCOUNT = {
  owner: ORG,
  name: 'z',
  type: 'normal-user',
  email: 'z@hanzo.ai',
  displayName: 'Z Admin',
  isSuperAdmin: true,
  isGlobalAdmin: true,
  isAdmin: true,
  signupApplication: 'hanzo-cloud',
}

const LORA = { rank: 16, alpha: 32, target_modules: ['q_proj', 'k_proj', 'v_proj', 'o_proj', 'gate_proj', 'up_proj', 'down_proj'] }
const CLIENT = {
  id: 'client_demo',
  base_model: 'HuggingFaceTB/SmolLM2-135M',
  status: 'ready',
  lora_config: LORA,
  trainable_params: 442368,
  forward_backward_calls: 3,
  optim_steps: 2,
  last_loss: 1.234,
}
const DETAIL = { ...CLIENT, loss_history: [2.4, 2.0, 1.7, 1.5, 1.234] }

const API_RE = /\/(v1|cloud|ai|billing|commerce|telemetry|vm|superbase|admin|paas|integrations|auth\/refresh)(\/|$|\?)/

async function mock(route: Route) {
  const req = route.request()
  if (req.resourceType() === 'document') return route.continue()
  const url = new URL(req.url())
  const path = url.pathname

  if (path === '/auth/session') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ account: ACCOUNT, expiresIn: 3600 }) })
  }
  if (path.startsWith('/auth/')) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  }
  // The engine training plane under test — the clean `/v1/training/*` the browser calls
  // (next.config dispatches it to the `/ai` bearer proxy server-side; the mock short-circuits).
  if (path === '/v1/training/clients') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ clients: [CLIENT] }) })
  }
  if (path === `/v1/training/clients/${CLIENT.id}`) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DETAIL) })
  }

  const sameOrigin = url.origin === new URL(BASE_URL).origin
  if (sameOrigin && !API_RE.test(path)) return route.continue()
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', msg: '', data: [], data2: 0 }) })
}

async function openInteractive(page: Page) {
  await page.addInitScript((org) => {
    try {
      localStorage.setItem('hanzo.console.org', org)
      localStorage.setItem('hanzo.console.org.selected', '1')
      localStorage.setItem('hz_admin_banner_dismissed', '1')
      // Skip the first-run onboarding wizard so the console surface mounts directly.
      localStorage.setItem(`hz_onboarding_done:${org}`, '1')
    } catch {
      /* private mode */
    }
  }, ORG)
  await page.route('**/*', mock)
  await primeSession(page, ACCOUNT)
  await page.goto(`${BASE_URL}/finetuning/interactive`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
}

test('Interactive tab renders the engine plane, validates create, shows a ready client + loss chart', async ({ browser }) => {
  mkdirSync(SHOTS, { recursive: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await ctx.newPage()
  await openInteractive(page)

  // No hard crash / bounce to sign-in.
  await expect(page).not.toHaveURL(/\/signin/)
  await expect(page.locator('text=/Application error|Unhandled Runtime Error/i')).toHaveCount(0)

  // 1. The Interactive tab surface rendered (its unique sub-header copy).
  await expect(page.getByText(/Create a live LoRA client/i)).toBeVisible({ timeout: 20_000 })

  // 2. A mocked client row reports status `ready`.
  await expect(page.getByText('client_demo').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('ready', { exact: true }).first()).toBeVisible()

  // 3. The New-client form validates an empty base_model: Create is disabled until a
  //    model is typed.
  await page.getByRole('button', { name: 'New client' }).first().click()
  const baseInput = page.getByPlaceholder('HuggingFaceTB/SmolLM2-135M')
  await expect(baseInput).toBeVisible({ timeout: 10_000 })
  const create = page.getByRole('button', { name: 'Create client' })
  await expect(create).toBeDisabled()
  await baseInput.fill('HuggingFaceTB/SmolLM2-135M')
  await expect(create).toBeEnabled()
  await page.screenshot({ path: join(SHOTS, 'interactive-training-clients.png'), fullPage: true })

  // 4. Selecting the client renders its loss-curve chart region (real loss_history).
  await page.getByText('client_demo').first().click()
  await expect(page.getByText('Loss curve')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/steps · last/)).toBeVisible()
  await page.screenshot({ path: join(SHOTS, 'interactive-training-detail.png'), fullPage: true })

  await ctx.close()
})
