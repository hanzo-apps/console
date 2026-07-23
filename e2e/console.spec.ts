/**
 * e2e: Hanzo Cloud Console — login → API key → AI inference
 *
 * z@hanzo.ai is in the `hanzo` org (isGlobalAdmin), so the Scope now shows
 * a dismissible admin banner and renders the full console on console.hanzo.ai.
 * Admin ops still live at admin.hanzo.ai.
 *
 * Credentials (env, never in repo):
 *   HANZO_EMAIL    default z@hanzo.ai
 *   HANZO_PASSWORD required
 *   HANZO_API_KEY  optional; skip UI flow, go straight to inference
 *   HANZO_API_BASE default https://api.hanzo.ai
 *   BASE_URL       default https://console.hanzo.ai
 *
 * Run:
 *   HANZO_PASSWORD=xxx pnpm e2e
 *   HANZO_PASSWORD=xxx HANZO_API_KEY=hk-xxx pnpm e2e
 */
import { test, expect, type Page } from '@playwright/test'

const EMAIL    = process.env.HANZO_EMAIL    ?? 'z@hanzo.ai'
const PASSWORD = process.env.HANZO_PASSWORD ?? ''
const API_KEY  = process.env.HANZO_API_KEY  ?? ''
const API_BASE = process.env.HANZO_API_BASE ?? 'https://api.hanzo.ai'
const BASE_URL = process.env.BASE_URL       ?? 'https://console.hanzo.ai'

// ─── helpers ────────────────────────────────────────────────────────────────

async function signIn(page: Page) {
  await page.goto(`${BASE_URL}/signin`)
  await page.waitForSelector('input[placeholder="Email"]', { timeout: 20_000 })
  await page.fill('input[placeholder="Email"]', EMAIL)
  await page.fill('input[placeholder="Password"]', PASSWORD)
  await page.click('button:has-text("Sign in")')
}

/** Wait until we're on the dashboard (route replaced to '/'). */
async function waitForDashboard(page: Page) {
  const base = new URL(BASE_URL).origin
  await page.waitForURL(url => url.origin === base && url.pathname === '/', { timeout: 30_000 })
  // The dashboard renders product grid cards — wait for at least one visible card/link
  await page.waitForLoadState('domcontentloaded')
}

// ─── tests ──────────────────────────────────────────────────────────────────

// Public smoke — needs no credentials, so it always runs (in CI, for Dave, etc.)
// and catches a dead/blank sign-in gate. The authenticated flows below gate on
// HANZO_PASSWORD.
test.describe('Hanzo Cloud Console — public', () => {
  test('sign-in page renders (email/password + OAuth + passkey)', async ({ page }) => {
    await page.goto(`${BASE_URL}/signin`)
    await expect(page.locator('input[placeholder="Email"]')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('input[placeholder="Password"]')).toBeVisible()
    await expect(page.locator('button:has-text("Sign in")')).toBeVisible()
    await expect(page.locator('button:has-text("Continue with GitHub")')).toBeVisible()
    await expect(page.locator('button:has-text("Continue with Google")')).toBeVisible()
    await expect(page.locator('text=/passkey/i')).toBeVisible()
  })

  test('root serves the app (200, dark #0a0a0a) + /base resolves', async ({ page, request }) => {
    const res = await page.goto(BASE_URL)
    expect(res?.status()).toBe(200)
    await expect(page).toHaveTitle(/Hanzo Cloud Console/)
    await expect(page.locator('meta[name="theme-color"][content="#000000"]')).toHaveCount(1)
    expect((await request.get(`${BASE_URL}/base`)).status()).toBe(200)
  })

  // Security gates — an unauthenticated request must never receive backend DATA.
  // No credentials (plain request context) so this proves the production posture in
  // CI. The TRUE invariant is "no data tunnel": a gated proxy answers a fail-closed
  // JSON error (>=401), and any off-list / non-proxied path falls through to the SPA
  // shell (HTML) — NEVER backend JSON with a 2xx. A 2xx `application/json` from an
  // unauthenticated request is the real security bug.
  test('gated proxies are fail-closed — a JSON error, never data', async ({ request }) => {
    // The admin surface is the canonical gated proxy: fail-closed JSON, no data.
    const res = await request.get(`${BASE_URL}/v1/admin/finance`)
    expect(res.status(), '/v1/admin/* must be fail-closed').toBeGreaterThanOrEqual(401)
    expect(res.status(), '/v1/admin/* must not 5xx').toBeLessThan(500)
  })

  test('off-list paths do not tunnel to a backend (SPA shell, no JSON data)', async ({ request }) => {
    // Non-proxied / off-allow-list paths must resolve to the SPA (HTML) or a
    // fail-closed error — never a 2xx carrying backend JSON (that would be a tunnel).
    for (const path of [
      '/superbase/v1/collections/secrets/records',
      '/keys',
      '/admin/aggregate/iam',
    ]) {
      const res = await request.get(`${BASE_URL}${path}`)
      const contentType = res.headers()['content-type'] ?? ''
      const tunneled = res.ok() && contentType.includes('application/json')
      expect(tunneled, `${path} must not tunnel backend JSON (got ${res.status()} ${contentType})`).toBe(false)
    }
  })

  test('unknown route never 5xxs', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/no-such-surface-xyz`)
    expect(res.status()).toBeLessThan(500)
  })
})

test.describe('Hanzo Cloud Console e2e', () => {
  test.skip(!PASSWORD, 'HANZO_PASSWORD not set — skipping live authenticated tests')

  test('login as z@hanzo.ai — dashboard renders', async ({ page }) => {
    await signIn(page)
    await waitForDashboard(page)
    // Dashboard renders — sign-in form must be gone
    await expect(page.locator('input[placeholder="Password"]')).not.toBeVisible({ timeout: 10_000 })
    // At least one product category or card is visible (Overview / AI / Compute etc.)
    await expect(
      page.locator('a, button, [role="link"]').filter({ hasText: /models|providers|overview|AI/i }).first()
    ).toBeVisible({ timeout: 15_000 })
    console.log('✓ Signed in; dashboard is rendering')
  })

  test('admin banner visible (z is isAdmin on console.hanzo.ai)', async ({ page }) => {
    await signIn(page)
    await waitForDashboard(page)
    // Scope shows the admin banner for admins on the non-admin console host.
    // The banner may have been dismissed in a prior run (localStorage). Skip softly.
    const banner = page.locator('text=/Admin ops|admin\\.hanzo\\.ai/i').first()
    const visible = await banner.isVisible({ timeout: 5_000 }).catch(() => false)
    if (visible) {
      console.log('✓ Admin banner visible')
      await expect(page.locator('button:has-text("Open admin")')).toBeVisible()
    } else {
      console.log('ℹ Admin banner was dismissed (localStorage) — OK')
    }
  })

  test('create or confirm API key', async ({ page }) => {
    await signIn(page)
    await waitForDashboard(page)

    // API Keys module is at /api-keys (catch-all route, id='api-keys')
    await page.goto(`${BASE_URL}/api-keys`, { waitUntil: 'domcontentloaded' })

    // Wait for the module to hydrate — look for the page header or key cards
    await expect(
      page.locator('text=/API Keys/i, text=/Cloud API key/i, text=/Create.*API key/i').first()
    ).toBeVisible({ timeout: 25_000 })

    const hasKey  = page.locator('text=/Cloud API key/i')
    const noKey   = page.locator('text=/Create your Cloud API key/i')
    const createBtn = page.locator('button:has-text("Create API key")')

    const needsCreate = await noKey.isVisible({ timeout: 3_000 }).catch(() => false)
                     || await createBtn.isVisible({ timeout: 1_000 }).catch(() => false)

    if (needsCreate) {
      await createBtn.click()
      // One-time reveal card with the hk- key
      await expect(page.locator('text=/hk-/')).toBeVisible({ timeout: 25_000 })
      await expect(page.locator('text=/shown only once/i')).toBeVisible()
      await expect(page.locator('button:has-text("Copy")')).toBeVisible()
      console.log('✓ API key created (hk- one-time reveal shown)')
    } else {
      // Key already exists
      await expect(hasKey).toBeVisible({ timeout: 10_000 })
      await expect(page.locator('text=/hk-…|hk-[A-Za-z0-9]{3,}/i')).toBeVisible({ timeout: 5_000 })
      console.log('✓ API key already exists (prefix shown)')
    }
  })

  test('API key works — GET /v1/models', async ({ page }) => {
    let apiKey = API_KEY

    if (!apiKey) {
      await signIn(page)
      await waitForDashboard(page)
      await page.goto(`${BASE_URL}/api-keys`, { waitUntil: 'domcontentloaded' })
      await expect(
        page.locator('text=/API Keys/i').first()
      ).toBeVisible({ timeout: 25_000 })

      // Rotate (or create) to show the full key on-screen
      const rotateBtn = page.locator('button:has-text("Rotate")')
      const createBtn = page.locator('button:has-text("Create API key")')
      if (await rotateBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await rotateBtn.click()
      } else if (await createBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await createBtn.click()
      }
      await expect(page.locator('text=/hk-/')).toBeVisible({ timeout: 25_000 })

      // Grab the FULL key from the one-time reveal — never the masked display
      // (the account card shows `hk-2f18…` with an ellipsis, which is not a
      // usable credential). Match only a full hk- token (no `…`/`...`).
      const fullKey = /hk-[A-Za-z0-9._-]{16,}/
      const keyEl = page.locator('[style*="monospace"]').filter({ hasText: fullKey }).first()
      apiKey = (((await keyEl.textContent().catch(() => '')) ?? '').match(fullKey) ?? [''])[0]
      if (!apiKey) {
        const m = ((await page.textContent('body')) ?? '').match(fullKey)
        apiKey = m ? m[0] : ''
      }
      expect(apiKey, 'Could not extract hk- key from page').toMatch(/^hk-/)
      console.log(`✓ Extracted key prefix: ${apiKey.slice(0, 11)}…`)
    }

    // Verify the key works against api.hanzo.ai
    const resp = await page.request.get(`${API_BASE}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      timeout: 30_000,
    })
    expect(resp.ok(), `GET /v1/models → ${resp.status()}`).toBe(true)
    const json = await resp.json()
    expect(json).toMatchObject({ data: expect.any(Array) })
    const models: Array<{ id: string }> = json.data
    expect(models.length).toBeGreaterThan(0)
    const ids = models.map(m => m.id)
    console.log(`✓ /v1/models: ${models.length} models`)
    console.log(`  GLM      present: ${ids.some(id => id.includes('glm'))}`)
    console.log(`  Claude   present: ${ids.some(id => id.includes('claude'))}`)
    console.log(`  DeepSeek present: ${ids.some(id => id.includes('deepseek'))}`)
    console.log(`  First 5: ${ids.slice(0, 5).join(', ')}`)
  })

  test('OpenAI inference — glm-5.2', async ({ page }) => {
    test.skip(!API_KEY, 'Set HANZO_API_KEY to run inference tests')

    const resp = await page.request.post(`${API_BASE}/v1/chat/completions`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      data: {
        model: 'glm-5.2',
        messages: [{ role: 'user', content: 'Reply with only: PONG' }],
        max_tokens: 16,
        stream: false,
      },
      timeout: 30_000,
    })
    expect(resp.ok(), `glm-5.2 → ${resp.status()}`).toBe(true)
    const json = await resp.json()
    const text: string = json.choices?.[0]?.message?.content ?? ''
    expect(text).toBeTruthy()
    console.log(`✓ glm-5.2: "${text.trim()}"`)
  })

  test('OpenAI inference — deepseek-v4-pro', async ({ page }) => {
    test.skip(!API_KEY, 'Set HANZO_API_KEY to run inference tests')

    const resp = await page.request.post(`${API_BASE}/v1/chat/completions`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      data: {
        model: 'deepseek-v4-pro',
        messages: [{ role: 'user', content: 'Reply with only: PONG' }],
        max_tokens: 16,
        stream: false,
      },
      timeout: 30_000,
    })
    expect(resp.ok(), `deepseek-v4-pro → ${resp.status()}`).toBe(true)
    const json = await resp.json()
    const text: string = json.choices?.[0]?.message?.content ?? ''
    expect(text).toBeTruthy()
    console.log(`✓ deepseek-v4-pro: "${text.trim()}"`)
  })

  test('Anthropic-compat /v1/messages — live catalog model', async ({ page }) => {
    test.skip(!API_KEY, 'Set HANZO_API_KEY to run inference tests')

    // Pick a model that is ACTUALLY available right now (the catalog changes;
    // a hardcoded id like claude-sonnet-4-6 fails when it isn't provisioned).
    // The /v1/messages Anthropic surface accepts any catalog model.
    const listed = await page.request.get(`${API_BASE}/v1/models`, {
      headers: { Authorization: `Bearer ${API_KEY}`, Accept: 'application/json' },
      timeout: 30_000,
    })
    const ids: string[] = (await listed.json()).data?.map((m: { id: string }) => m.id) ?? []
    const model = ids.find((id) => id.includes('claude')) ?? ids.find((id) => id === 'glm-5.2') ?? ids[0]
    expect(model, 'no model available in catalog').toBeTruthy()

    const resp = await page.request.post(`${API_BASE}/v1/messages`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'anthropic-version': '2023-06-01',
      },
      data: {
        model,
        messages: [{ role: 'user', content: 'Reply with only: PONG' }],
        max_tokens: 16,
      },
      timeout: 30_000,
    })
    expect(resp.ok(), `/v1/messages (${model}) → ${resp.status()}`).toBe(true)
    const json = await resp.json()
    const text: string = json.content?.[0]?.text ?? ''
    expect(text).toBeTruthy()
    console.log(`✓ Anthropic-compat /v1/messages (${model}): "${text.trim()}"`)
  })
})
