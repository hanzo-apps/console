/**
 * Fixture-server gate for the render specs.
 *
 * Several render specs (ai-economics, budgets-responsive, gpus-*, provider-billing,
 * entitlement-sidebar, interactive-training, blank-audit, probe-o11y) assert data
 * that exists ONLY in a LOCAL fixture server — they default `BASE_URL` to
 * `http://localhost:4000` and seed exact numbers ("$26k credit / 62% margin /
 * fable-5 75%"). Run against live prod that server isn't there (ECONNREFUSED) and
 * the numbers are meaningless anyway, so the spec has nothing real to assert.
 *
 * This is NOT a blind skip: it's a reachability gate. Point `BASE_URL` at a running
 * fixture (`npm run dev` on :4000, or a prod origin that actually serves the seeded
 * surface) and the spec runs for real. Call `requireFixtureServer()` once at module
 * top level in a fixture spec; its `beforeAll` probes the target and skips the whole
 * file only when it's genuinely unreachable.
 */
import { test } from '@playwright/test'

/** The origin a fixture render spec targets (its own default is the local dev server). */
export const FIXTURE_BASE = process.env.BASE_URL ?? 'http://localhost:4000'

/** Skip the whole spec file when its fixture server can't be reached. */
export function requireFixtureServer(base: string = FIXTURE_BASE): void {
  test.beforeAll(async ({ request }) => {
    const reachable = await request
      .get(base, { timeout: 4000 })
      .then((r) => r.status() < 500)
      .catch(() => false)
    test.skip(
      !reachable,
      `fixture server ${base} not reachable — point BASE_URL at a running fixture to exercise these render specs`,
    )
  })
}
