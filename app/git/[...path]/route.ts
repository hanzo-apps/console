/**
 * /git/* — the console's Git-import BFF (connected accounts + repositories).
 *
 * A `[...path]` catch-all route handler (the PROVEN top-level BFF shape used by
 * `/cloud`, `/ai`, `/paas`, `/cms`): a catch-all route handler wins over the
 * `(dashboard)/[...slug]` SPA page, whereas a STATIC route handler at the same depth
 * is shadowed by it. Served at TOP-LEVEL `/git/*` (NOT `/v1/*`) because
 * console.hanzo.ai's ingress routes `/v1/*` to hanzoai/gateway (bypassing Next), so
 * a `/v1/git/*` handler would 404 at the cloud binary.
 *
 * Two heads, one handler:
 *   - GET /git/accounts            → { connected, accounts }
 *   - GET /git/repos?account&q     → { repos }  (401 when not connected)
 *
 * The GitHub token is resolved from IAM server-side (the user's own session) and
 * used only here — it never reaches the browser. Per-user data ⇒ no-store.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { resolveGithubConnection, listAccounts, listRepos } from '~/lib/server/git'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' } as const

type Ctx = { params: Promise<{ path: string[] }> }

export async function GET(req: NextRequest, ctx: Ctx) {
  const head = (await ctx.params).path?.[0] ?? ''
  const conn = await resolveGithubConnection(req)

  // /git/accounts — the signed-in user's connected Git accounts. Not connected ⇒
  // honest `{ connected: false, accounts: [] }` (drives the "Connect GitHub" CTA).
  if (head === 'accounts') {
    if (!conn) return NextResponse.json({ connected: false, accounts: [] }, { headers: NO_STORE })
    let accounts
    try {
      accounts = await listAccounts(conn)
    } catch {
      return NextResponse.json(
        { connected: true, accounts: [], error: 'github unreachable' },
        { status: 502, headers: NO_STORE },
      )
    }
    // A 401 from GitHub (token revoked/expired) ⇒ treat as not connected.
    if (accounts === null) return NextResponse.json({ connected: false, accounts: [] }, { headers: NO_STORE })
    return NextResponse.json({ connected: true, accounts }, { headers: NO_STORE })
  }

  // /git/repos?account=<login>&q=<search> — repositories for one account, newest-push
  // first, server-side filtered. No linked token ⇒ 401 (the client falls back to the
  // "Connect GitHub" CTA) — never a service-token leak.
  if (head === 'repos') {
    if (!conn) return NextResponse.json({ repos: [], connected: false }, { status: 401, headers: NO_STORE })
    const account = req.nextUrl.searchParams.get('account')?.trim() || ''
    const q = req.nextUrl.searchParams.get('q')?.trim() || ''
    let repos
    try {
      repos = await listRepos(conn, account, q)
    } catch {
      return NextResponse.json({ repos: [], error: 'github unreachable' }, { status: 502, headers: NO_STORE })
    }
    if (repos === null) return NextResponse.json({ repos: [], connected: false }, { status: 401, headers: NO_STORE })
    return NextResponse.json({ repos, connected: true }, { headers: NO_STORE })
  }

  return NextResponse.json({ error: 'not found' }, { status: 404, headers: NO_STORE })
}
