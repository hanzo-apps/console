/**
 * Same-origin proxy to the cloud ML/training surface (`/v1/ml/models` and the
 * fine-tuning broker `/v1/ai/finetune/*`).
 *
 * The console's Training page calls its OWN origin (`/training/...`) with just the
 * first-party session cookie; this server handler resolves the signed-in user from
 * that cookie, mints a SHORT-LIVED, user-bound IAM Bearer (`adminBearer` — the ONE
 * per-user cache shared with the `/v1` bearer proxy), and forwards to the cloud
 * backend's `/v1/...` surface with `Authorization: Bearer <token>` + the active
 * `X-Org-Id`. Training is a TENANT action — any signed-in org user may run it — so
 * this is user-scoped (resolveUser), never a service token. The cloud backend resolves
 * the org from the token's `owner` claim (and
 * the X-Org-Id the plain-REST train sub-service reads), so a caller can only ever
 * touch their own org's jobs. `POST /v1/ai/finetune/jobs` is billing-gated upstream and
 * returns 402 on an unfunded org — that status flows straight back so the UI can
 * surface it honestly.
 *
 * Why a Bearer and NOT the cookie (the fix for the "Not enabled" 403): cloud-api's
 * `/v1/*` authorizes on a VALIDATED JWT principal and returns 403 "no validated
 * principal" for a cookie-only call — the raw casibase session cookie is NOT a
 * principal it accepts (only the sanitizer's cookie-token names or a Bearer). Minting
 * the same user-bound token the `/v1` proxy uses is the ONE way a signed-in tenant
 * reaches this surface; the cookie is deliberately dropped upstream (it can't
 * authenticate, and a cookie + JWT together risks the public-gateway 431).
 *
 * Least privilege: only the explicit ML/training sub-paths are forwarded; anything
 * else 404s, so this is not a general backend tunnel. No secret ever reaches the
 * browser — the HuggingFace token (for private repos) is resolved from KMS
 * server-side inside the broker, never here.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { resolveUser, adminBearer } from '~/lib/server/identity'
import { orgFor } from '~/lib/server/admin-policy'
import { csrfRefusal } from '~/lib/server/bearer-proxy'
import { fetchWithTimeout } from '~/lib/server/fetch-timeout'

export const runtime = 'nodejs'

const trim = (s: string) => s.replace(/\/+$/, '')
const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e))
/** Cloud `/v1` backend (hanzoai/ai) — same target lib/server/identity.ts resolves. */
const CLOUD_API_URL = trim(process.env.CLOUD_API_URL ?? 'http://cloud.hanzo.svc.cluster.local:8000')

/** The exact `/v1/<...>` ML/training sub-paths the console is allowed to reach. */
const ALLOWED = new Set([
  // Model serving — the org's deployed kserve InferenceServices.
  'ml/models',
  // fine-tuning broker (custom-data runs, HF search) — the ONE training door. It is a
  // route of the ai capability, which answers at /v1/ai (HIP-0139), so each entry names
  // the route and admits nothing beside it.
  'ai/finetune/jobs',
  'ai/finetune/job',
  'ai/finetune/cancel',
  'ai/finetune/deploy',
  'ai/finetune/presets',
  'ai/finetune/hf/models',
  'ai/finetune/hf/datasets',
  'ai/finetune/hf/repo',
])

async function forward(req: NextRequest, path: string[]): Promise<NextResponse> {
  const rel = path.join('/')
  if (!ALLOWED.has(rel)) {
    return NextResponse.json({ status: 'error', msg: 'Not found' }, { status: 404 })
  }

  // CSRF: `POST /ai/finetune/jobs` mutates (and bills) from the auto-sent cookie — refuse a
  // cross-origin one before any work (safe reads pass).
  const csrf = csrfRefusal(req, 'casibase')
  if (csrf) return csrf

  const user = await resolveUser(req)
  if (!user) {
    return NextResponse.json(
      { status: 'error', msg: 'Sign in to manage training.' },
      { status: 401 },
    )
  }

  // Mint a short-lived, user-bound Bearer (the SAME per-user cache the `/v1`
  // proxy uses). cloud-api's `/v1/*` 403s a cookie-only call ("no validated
  // principal"); a Bearer is the one credential it accepts. Fail CLOSED with 502 if
  // the token can't be minted — never fall through to an unauthenticated forward.
  let bearer: string
  try {
    bearer = await adminBearer(user)
  } catch (e) {
    // Redact — the exception carries the internal IAM host/port. Log server-side only.
    console.error('training-proxy: could not mint user bearer:', msgOf(e))
    return NextResponse.json(
      { status: 'error', msg: 'Could not authorize the request.' },
      { status: 502 },
    )
  }

  const url = `${CLOUD_API_URL}/v1/${rel}${req.nextUrl.search}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${bearer}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    // Org is SERVER-RESOLVED, not the raw browser header: a SuperAdmin's switched
    // org (?/X-Org-Id) is honored, a non-SuperAdmin caller is PINNED to their own — so a
    // brand admin can't drive another tenant's training jobs even if the backend
    // trusted the forwarded header. For a non-SuperAdmin caller this equals the token
    // owner (the Bearer's own claim), so header and token agree. Matches the
    // /admin/kms orgFor pin. The raw session cookie is NOT forwarded (cloud-api can't
    // validate it as a principal, and cookie + JWT together risks the gateway 431).
    'X-Org-Id': orgFor({ isSuperAdmin: user.isSuperAdmin, orgScope: user.owner }, req.headers.get('X-Org-Id')),
  }
  const projectId = req.headers.get('X-Project-Id')
  const environment = req.headers.get('X-Environment')
  if (projectId) headers['X-Project-Id'] = projectId
  if (environment) headers['X-Environment'] = environment

  const init: RequestInit = { method: req.method, headers, cache: 'no-store' }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.text()
  }

  try {
    const res = await fetchWithTimeout(url, init)
    const text = await res.text()
    return new NextResponse(text, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
    })
  } catch (e) {
    return NextResponse.json(
      { status: 'error', msg: `Fine-tuning backend unreachable: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    )
  }
}

type Ctx = { params: Promise<{ path: string[] }> }

export async function GET(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path)
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path)
}
