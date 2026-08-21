/**
 * Keyless AI proxy — the ONE path the console uses to reach the model gateway.
 *
 * `/v1/chat/completions` (and friends) REQUIRE an `Authorization: Bearer` token; a
 * browser session cookie alone is rejected. Rather than ship the user's durable
 * `sk-` key to the browser, the console calls its OWN origin at the canonical, prefix-free
 * `/v1/<aihead>` (the /v1-first law); `next.config.mjs` dispatches those heads to THIS `/ai`
 * proxy (re-rooting the upstream at `v1/` — invisible to the client). `forwardWithUserBearer`
 * resolves the user, mints a SHORT-LIVED, user-bound IAM token (shared per-user cache in
 * identity.ts), and forwards to the gateway with that token. No key in the browser, and
 * every call is billed to the user's own org. The response STREAMS through, so
 * `chat/completions` SSE (and the multi-model TTFT measurement) is preserved.
 *
 * Least privilege: only the read/inference AI endpoints are proxied (the ALLOWED
 * allow-list); anything else 404s, so this is not a general gateway tunnel. The RAG
 * retrieval switch (`X-Retrieval`/`X-Retrieval-Store`) is the ONE client-header
 * passthrough (allow-listed in `ai-proxy`).
 */
import { type NextRequest } from 'next/server'

import { forwardWithUserBearer } from '~/lib/server/bearer-proxy'
import { retrievalHeaders } from '~/lib/server/ai-proxy'

export const runtime = 'nodejs'

const trim = (s: string) => s.replace(/\/+$/, '')
/** Gateway the proxied AI calls are forwarded to (gated/priced api.hanzo.ai). */
const AI_GATEWAY_URL = trim(process.env.AI_GATEWAY_URL ?? 'https://api.hanzo.ai')

/** The exact `/v1/<...>` endpoints the console is allowed to reach. */
const ALLOWED = new Set([
  'v1/models',
  'v1/pricing/models', // the rich model+provider catalog (context, pricing, specs, tier) for Models/Providers pages
  'v1/plans', // the subscription tiers + entitlements (rpm/tpm/quota) for the catalog plan badges
  'v1/chat',
  'v1/chat/completions',
  'v1/embeddings',
  'v1/rerank',
  'v1/audio/speech', // text-to-speech (JSON in → audio bytes out) for the Playground Audio tab
  'v1/images/generations', // text-to-image (JSON in → image url/b64 out) for the Playground Image tab
  'v1/videos/generations', // text-to-video CREATE — async: JSON in → a queued job object out (Sora-style)
  'v1/ai/connections', // AI Login Manager (ai#79/#80): GET list + POST link a BYO provider key (KMS-sealed server-side)
  'v1/training/clients', // Interactive Training: GET list clients + POST create a LoRA training client (engine plane)
  'v1/ai/router/policy', // Router: GET the caller's org policy + PUT upsert it (org-admin gated upstream, self-scoped)
  'v1/ai/router/stats', // Router: the caller org's routing observability aggregate (RequirePrincipal upstream, self-scoped)
  'v1/get-training-contribution', // Router: the caller org's training opt-in flag (org-admin gated upstream)
  'v1/update-training-contribution', // Router: set the caller org's training opt-in flag (org-admin gated upstream)
  'v1/ai/org/settings', // Routing admin: one org's settings row — GET read, PUT upsert (PATCH-merge), DELETE revert (super-admin gated upstream)
  'v1/ai/org/settings/list', // Routing admin: per-org settings rows (super-admin gated upstream)
])

/**
 * Async video poll/download sub-paths: GET `/v1/videos/{id}` and
 * `/v1/videos/{id}/content`. Video generation is async (create returns a job id
 * immediately; the client polls the job and then downloads the finished MP4), so
 * the Playground must reach these two dynamic paths in addition to the exact
 * CREATE above. The job id is an opaque `video_<uuid>`; the charset is kept
 * conservative and the pattern is anchored to `v1/videos/`, so this stays a
 * narrow allow-list (the create POST is still only the exact
 * `v1/videos/generations`), never a general gateway tunnel. Method is enforced
 * by the backend (these are GET-only there).
 */
const VIDEO_JOB_PATH = /^v1\/videos\/[A-Za-z0-9._-]+(?:\/content)?$/

/**
 * Per-provider AI-connection sub-path: `/v1/ai/connections/<provider>` — the
 * disconnect (the AI router maps POST here to the delete). Anchored to the
 * connections head with a conservative provider charset, so it stays a narrow
 * allow-list, never a general tunnel.
 */
const AI_CONNECTION_PATH = /^v1\/ai\/connections\/[A-Za-z0-9_-]+$/

/**
 * Provider-login OAuth start (ai#85): `/v1/ai/connections/<provider>/authorize`.
 * GET returns the provider consent URL (`?format=json` → `{ authorizeUrl }`) that
 * the console redirects the browser to; the OAuth callback is handled server-side
 * by the backend (KMS-sealed), never through this proxy. Anchored to the
 * connections head with a conservative provider charset — a narrow allow-list, not
 * a general tunnel.
 */
const AI_CONNECTION_AUTHORIZE_PATH = /^v1\/ai\/connections\/[A-Za-z0-9_-]+\/authorize$/

/**
 * Import a connected account's usage: `/v1/ai/connections/<provider>/usage`. GET only —
 * the org's key is unsealed SERVER-SIDE and the provider's usage/cost API is called there;
 * the browser only reads the normalized ProviderUsage. Anchored to the connections head
 * with a conservative provider charset — a narrow allow-list, not a general tunnel.
 */
const AI_CONNECTION_USAGE_PATH = /^v1\/ai\/connections\/[A-Za-z0-9_-]+\/usage$/

/**
 * Interactive-training per-client sub-path: `/v1/training/clients/<id>` and its four
 * drive actions — `/forward_backward`, `/optim_step`, `/sample`, `/save_weights`. GET
 * reads a client, DELETE drops it, POST drives the actions. Anchored to the clients
 * head with a conservative id charset (opaque `client_<...>`) and an exact action set,
 * so it stays a narrow allow-list, never a general tunnel. The bare `v1/training/clients`
 * (list/create) is the exact entry above.
 */
const TRAINING_CLIENT_PATH = /^v1\/training\/clients\/[A-Za-z0-9._-]+(?:\/(?:forward_backward|optim_step|sample|save_weights))?$/

/** Whether a resolved `/v1/<...>` path is reachable through this proxy. */
function isAllowedAiPath(p: string): boolean {
  return (
    ALLOWED.has(p) ||
    VIDEO_JOB_PATH.test(p) ||
    AI_CONNECTION_PATH.test(p) ||
    AI_CONNECTION_AUTHORIZE_PATH.test(p) ||
    AI_CONNECTION_USAGE_PATH.test(p) ||
    TRAINING_CLIENT_PATH.test(p)
  )
}

type Ctx = { params: Promise<{ path: string[] }> }

function handle(req: NextRequest, ctx: Ctx) {
  return (async () => {
    // The client builds a clean `/v1/<aihead>` and `next.config.mjs` dispatches it here
    // WITHOUT a nested version (destination `/ai/<aihead>`), so the catch-all captures the
    // sub-path after `/ai/`. Re-root the upstream at `v1/` — the exact path `isAllowedAiPath`
    // and the gateway see (`v1/chat/completions`, `v1/images/generations`, `v1/ai/connections`).
    const path = `v1/${(await ctx.params).path.join('/')}`
    return forwardWithUserBearer(req, {
      target: AI_GATEWAY_URL,
      path,
      allow: isAllowedAiPath,
      // Forward the RAG retrieval switch when present; the store's org owner is still
      // resolved server-side from the session (the bearer), never the browser.
      extraHeaders: retrievalHeaders((h) => req.headers.get(h)),
      errorShape: 'openai',
      unauthorizedMessage: 'Sign in to use AI.',
    })
  })()
}

export async function GET(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx)
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx)
}
// DELETE drops an interactive-training client (`/v1/training/clients/<id>`); the
// same-origin CSRF guard in the bearer proxy gates it like every mutating verb.
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx)
}
