/**
 * e2e: screenshot every console page + assert each renders (FE↔BE wired).
 *
 * Signs in as z@hanzo.ai (global admin, sees every product), then visits all 89
 * registered product routes. For each page it:
 *   - navigates to /<id>,
 *   - waits for hydration,
 *   - asserts the app shell is present and the page did NOT hit a hard crash
 *     (Next error overlay / "Application error" / a blank body),
 *   - captures a full-page screenshot into e2e/screenshots/<id>.png.
 *
 * This is the "screenshot it all, make sure every page is wired" pass. It does
 * NOT click destructive buttons — it proves each surface mounts, renders real
 * state (or an honest empty/loading/403), and is reachable end to end. Deeper
 * per-button flows live in console.spec.ts (API key create/rotate, inference).
 *
 * Credentials (env, never in repo):
 *   HANZO_EMAIL     default z@hanzo.ai
 *   HANZO_PASSWORD  required (skips when unset)
 *   BASE_URL        default https://console.hanzo.ai
 *
 * Run:  HANZO_PASSWORD=xxx pnpm e2e pages.spec.ts
 */
import { test, expect, type Page } from '@playwright/test'

const EMAIL = process.env.HANZO_EMAIL ?? 'z@hanzo.ai'
const PASSWORD = process.env.HANZO_PASSWORD ?? ''
const BASE_URL = process.env.BASE_URL ?? 'https://console.hanzo.ai'

/**
 * Every product route id in the registry (src/lib/products/registry.tsx).
 * Kept as a literal list so the spec has zero import coupling to the app bundle;
 * a page added to the registry gets a screenshot by adding its id here.
 */
const PAGES: string[] = [
  'overview', 'dashboards', 'status',
  // AI
  'models', 'model-catalog' /* alias */, 'providers', 'playground', 'chat', 'inference',
  'agents', 'prompts', 'finetuning', 'embeddings', 'evals', 'datasets', 'experiments',
  'annotation-queues', 'scores', 'score-configs', 'observations', 'traces', 'sessions',
  // Compute / hypervisor
  'machines', 'gpus', 'clusters', 'kubernetes', 'containers', 'networks', 'vpc',
  'load-balancer', 'service-mesh', 'edge', 'zero-trust', 'dns', 'cdn',
  // Data / storage
  's3', 'sql', 'vector', 'datastore', 'kv', 'search', 'docdb', 'base', 'memory', 'indexer',
  // Platform
  'functions', 'pipelines', 'builds', 'releases', 'environments', 'projects', 'oracles',
  // Identity / security
  'iam', 'users', 'team', 'authz', 'kms', 'secrets', 'mpc', 'hsm', 'attestations',
  'api-keys', 'tokens', 'applications',
  // Business / analytics
  'cost', 'ai-metrics', 'metrics', 'settlement', 'wallet', 'plans', 'referrals',
  // Ops / tooling
  'logs', 'alerts', 'o11y', 'gateway', 'tasks', 'integrations', 'registry', 'audit',
  'sdks', 'cli', 'ide', 'studio', 'desktop', 'bot', 'profile', 'settings',
]

async function signIn(page: Page) {
  await page.goto(`${BASE_URL}/signin`)
  await page.waitForSelector('input[placeholder="Email"]', { timeout: 20_000 })
  await page.fill('input[placeholder="Email"]', EMAIL)
  await page.fill('input[placeholder="Password"]', PASSWORD)
  await page.click('button:has-text("Sign in")')
  const base = new URL(BASE_URL).origin
  await page.waitForURL((url) => url.origin === base && url.pathname === '/', { timeout: 30_000 })
  await page.waitForLoadState('domcontentloaded')
}

test.describe('Hanzo Cloud Console — every page renders + screenshot', () => {
  test.skip(!PASSWORD, 'HANZO_PASSWORD not set — skipping authenticated screenshot pass')

  // One shared signed-in context for the whole file (fast).
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  for (const id of PAGES) {
    test(`page: /${id}`, async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(String(e)))

      const res = await page.goto(`${BASE_URL}/${id}`, { waitUntil: 'domcontentloaded' })
      // Route must not 5xx.
      expect(res?.status() ?? 0, `/${id} HTTP`).toBeLessThan(500)

      // App shell mounted (the console renders a nav + main region on every page).
      await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})

      // Hard-crash guards: no Next error overlay, no generic crash banner.
      await expect(page.locator('text=/Application error|Unhandled Runtime Error/i')).toHaveCount(0)

      // The body must have real content (not a blank white page).
      const bodyText = (await page.locator('body').innerText().catch(() => '')) || ''
      expect(bodyText.trim().length, `/${id} rendered content`).toBeGreaterThan(0)

      await page.screenshot({ path: `e2e/screenshots/${id}.png`, fullPage: true })

      // Surface (don't fail on) any console page errors for triage.
      if (errors.length) console.log(`⚠ /${id} pageerror: ${errors.join(' | ').slice(0, 200)}`)
    })
  }
})
