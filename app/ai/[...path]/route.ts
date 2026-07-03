/**
 * Keyless AI proxy — the ONE path the console uses to reach the model gateway.
 *
 * `/v1/chat/completions` (and friends) REQUIRE an `Authorization: Bearer` token; a
 * browser session cookie alone is rejected. Rather than ship the user's durable
 * `hk-` key to the browser, the console calls its OWN origin (`/ai/v1/...`) with just
 * the session cookie; `forwardWithUserBearer` resolves the user, mints a SHORT-LIVED,
 * user-bound IAM token (shared per-user cache in identity.ts), and forwards to the
 * gateway with that token. No key in the browser, no rotation on a chat turn, and
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
  'v1/videos/generations', // text-to-video (JSON in → base64 MP4 out) for the Playground Video tab
])

type Ctx = { params: Promise<{ path: string[] }> }

function handle(req: NextRequest, ctx: Ctx) {
  return (async () => {
    const path = (await ctx.params).path.join('/')
    return forwardWithUserBearer(req, {
      target: AI_GATEWAY_URL,
      path,
      allow: (p) => ALLOWED.has(p),
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
