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

/**
 * The exact `/v1/<...>` endpoints the console is allowed to reach: the model call itself,
 * in every modality, plus the catalog that describes what it can call.
 *
 * The rest of what hanzoai/ai serves — connections, router config, org settings, memory,
 * stores, RAG, fine-tuning — answers at `/v1/ai/*` (HIP-0139) and reaches cloud through
 * the `/v1` BFF, so it is not listed here and is not reachable here.
 */
const ALLOWED = new Set([
  'v1/models',
  'v1/pricing/models', // the rich model+provider catalog (context, pricing, specs, tier) for Models/Providers pages
  'v1/chat',
  'v1/chat/completions',
  'v1/embeddings',
  'v1/rerank',
  'v1/audio/speech', // text-to-speech (JSON in → audio bytes out) for the Playground Audio tab
  'v1/images/generations', // text-to-image (JSON in → image url/b64 out) for the Playground Image tab
  'v1/videos/generations', // text-to-video CREATE — async: JSON in → a queued job object out (Sora-style)
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

/** Whether a resolved `/v1/<...>` path is reachable through this proxy. */
function isAllowedAiPath(p: string): boolean {
  return ALLOWED.has(p) || VIDEO_JOB_PATH.test(p)
}

type Ctx = { params: Promise<{ path: string[] }> }

function handle(req: NextRequest, ctx: Ctx) {
  return (async () => {
    // The client builds a clean `/v1/<aihead>` and `next.config.mjs` dispatches it here
    // WITHOUT a nested version (destination `/ai/<aihead>`), so the catch-all captures the
    // sub-path after `/ai/`. Re-root the upstream at `v1/` — the exact path `isAllowedAiPath`
    // and the gateway see (`v1/chat/completions`, `v1/images/generations`).
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
