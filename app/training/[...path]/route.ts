/**
 * Same-origin proxy to the cloud ML/training surface on hanzoai/ai (`/v1/train/*`,
 * `/v1/ml/models`, and the fine-tuning broker `/v1/finetune/*`).
 *
 * The console's Training page calls its OWN origin (`/training/...`) with just the
 * first-party session cookie; this server handler resolves the signed-in user from
 * that cookie and forwards to the cloud backend's `/v1/...` surface, passing the
 * cookie through (the proven `get-account` server-to-server pattern in
 * lib/server/identity.ts) plus the active `X-Org-Id`. Training is a TENANT action —
 * any signed-in org user may run it — so this is user-scoped (resolveUser), NOT the
 * control-plane admin gate the `/paas` proxy uses. The cloud backend scopes by org
 * (GetEffectiveOrg / the X-Org-Id the plain-REST train sub-service requires), so a
 * caller can only ever touch their own org's jobs. `POST /v1/train/jobs` is
 * billing-gated by the live ResourceMeter and returns 402 on an unfunded org — that
 * status flows straight back so the UI can surface it honestly.
 *
 * Least privilege: only the explicit ML/training sub-paths are forwarded; anything
 * else 404s, so this is not a general backend tunnel. No secret ever reaches the
 * browser — the HuggingFace token (for private repos) is resolved from KMS
 * server-side inside the broker, never here.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { resolveUser } from '~/lib/server/identity'

export const runtime = 'nodejs'

const trim = (s: string) => s.replace(/\/+$/, '')
/** Cloud `/v1` backend (hanzoai/ai) — same target lib/server/identity.ts resolves. */
const CLOUD_API_URL = trim(process.env.CLOUD_API_URL ?? 'http://cloud.hanzo.svc.cluster.local:8000')

/** The exact `/v1/<...>` ML/training sub-paths the console is allowed to reach. */
const ALLOWED = new Set([
  // mlsvc — the canonical training surface (task #40 ResourceMeter gates POST jobs).
  'train/jobs',
  'train/experiments',
  'ml/models',
  // fine-tuning broker (custom-data runs, HF search) — sibling surface.
  'finetune/jobs',
  'finetune/job',
  'finetune/cancel',
  'finetune/deploy',
  'finetune/presets',
  'finetune/hf/models',
  'finetune/hf/datasets',
  'finetune/hf/repo',
])

async function forward(req: NextRequest, path: string[]): Promise<NextResponse> {
  const rel = path.join('/')
  if (!ALLOWED.has(rel)) {
    return NextResponse.json({ status: 'error', msg: 'Not found' }, { status: 404 })
  }

  const user = await resolveUser(req)
  if (!user) {
    return NextResponse.json(
      { status: 'error', msg: 'Sign in to manage training.' },
      { status: 401 },
    )
  }

  const cookie = req.headers.get('cookie') ?? ''
  const url = `${CLOUD_API_URL}/v1/${rel}${req.nextUrl.search}`
  const headers: Record<string, string> = {
    cookie,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    // The backend re-validates org from the session; forward the active scope so a
    // global admin's switched org is honored and a brand admin is pinned to theirs.
    'X-Org-Id': req.headers.get('X-Org-Id') ?? user.owner,
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
    const res = await fetch(url, init)
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
