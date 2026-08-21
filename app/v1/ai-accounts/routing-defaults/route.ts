/**
 * AI-accounts ORG routing defaults (READ-ONLY) — the server-driven default the
 * admin set for the whole org, surfaced so the Routing tab can show
 * "Organization default: On/Off" and fall back to it when the user has no explicit
 * override.
 *
 *   GET v1/routing-defaults → cloud-api `{ status, data: { auto_routing_active,
 *                             default_session_routing } }` (streamed through verbatim)
 *
 * This is a pure READ. It forwards to cloud-api's org-scoped
 * `GET /v1/ai/router/defaults` with the caller's short-lived user bearer (org is
 * the token owner — never browser-supplied), the EXACT same auth pattern as the
 * `/v1` proxy. It deliberately does NOT touch the org-settings WRITE path: a
 * customer surface has no clean authenticated path to mint the global-admin write,
 * and forging one is a confused-deputy escalation (see the long note in
 * `settings/route.ts`). Reads are fine; writes stay out.
 *
 * FAIL-SOFT: an older cloud-api with no such endpoint 404s, which streams straight
 * through as a 404 the client treats as "no org default" — the tab then honors the
 * cookie preference alone, exactly as before this endpoint existed.
 *
 * A static route, so it wins over the sibling `[...path]` catch-all for this exact
 * path (same rule as `/v1/ai-accounts/usage` and `/v1/ai-accounts/settings`).
 */
import { type NextRequest } from 'next/server'

import { forwardWithUserBearer } from '~/lib/server/bearer-proxy'

export const runtime = 'nodejs'

const trim = (s: string) => s.replace(/\/+$/, '')
/** The unified cloud backend (hanzoai/cloud) — same in-cluster target as the `/v1` proxy. */
const CLOUD_API_URL = trim(process.env.CLOUD_API_URL?.trim() || 'http://cloud-api.hanzo.svc.cluster.local:8000')

const UPSTREAM_PATH = 'v1/ai/router/defaults'

export async function GET(req: NextRequest) {
  return forwardWithUserBearer(req, {
    target: CLOUD_API_URL,
    path: UPSTREAM_PATH,
    allow: (p) => p === UPSTREAM_PATH,
    errorShape: 'casibase',
    unauthorizedMessage: 'Sign in to read organization routing defaults.',
  })
}
