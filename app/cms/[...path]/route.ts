/**
 * Same-origin user-bearer proxy to the brand's Payload CMS (`cms.<brand>`) REST API —
 * the READ path that powers the console's NATIVE Content views (Collections + Media/DAM)
 * alongside the embedded Studio.
 *
 * The browser calls this OWN-origin route (`/cms/api/pages`, `/cms/api/media`,
 * `/cms/api/media/file/<f>`) with just its session cookie. `forwardWithUserBearer`
 * resolves the user, mints a short-lived user-bound IAM token, and forwards it to the
 * per-brand Payload host as `Authorization: Bearer`. Payload's `hanzoIAMStrategy` verifies
 * the JWKS-signed hanzo.id token and its multi-tenant plugin scopes every `pages`/`media`
 * row to the token's `owner` claim — so a caller reads ONLY their own org's content,
 * SERVER-SIDE and BACKEND-enforced (no org is ever browser-supplied). No token reaches
 * the browser.
 *
 * SSRF-safe by construction: the target host is `cms.<brand>` where `<brand>` is the
 * request host CLAMPED to the known brand domains (`clampedBrandDomain`, unit-tested) —
 * a forged Host header can never steer this to an arbitrary origin. Least privilege on
 * the path: `allowCmsSurface` admits ONLY the two tenant-scoped collections (pages/media)
 * + the per-file media bytes route, never `api/users`/`api/tenants` (the cross-org
 * registry). READ-ONLY: only GET/HEAD are exposed — the native views never mutate; all
 * authoring stays in the Studio.
 */
import { type NextRequest } from 'next/server'

import { forwardWithUserBearer } from '~/lib/server/bearer-proxy'
import { allowCmsSurface } from '~/lib/server/proxy-allow'
import { clampedBrandDomain } from '~/lib/server/embed-probe'

export const runtime = 'nodejs'

const trim = (s: string) => s.replace(/\/+$/, '')

/** The per-brand Payload origin for this request, SSRF-clamped. An optional `CMS_URL`
 *  env pins a single in-cluster origin (a single-brand deploy); otherwise it is
 *  `https://cms.<clamped-brand-domain>`, so a Lux/Zoo console reaches ITS OWN CMS. */
function cmsTarget(host: string | null): string {
  const override = process.env.CMS_URL?.trim()
  if (override) return trim(override)
  return `https://cms.${clampedBrandDomain(host)}`
}

type Ctx = { params: Promise<{ path: string[] }> }

function handle(req: NextRequest, ctx: Ctx) {
  return (async () => {
    const path = (await ctx.params).path.join('/')
    return forwardWithUserBearer(req, {
      target: cmsTarget(req.headers.get('host')),
      path,
      allow: allowCmsSurface,
      unauthorizedMessage: 'Sign in to view content.',
    })
  })()
}

export async function GET(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx)
}
export async function HEAD(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx)
}
