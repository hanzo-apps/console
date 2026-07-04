/**
 * /v1/git/repos — repositories for one connected Git account.
 *
 * GET ?account=<login>&q=<search> → `{ repos: GitRepo[] }`, newest-push first,
 * server-side filtered by `q`. `account` defaults to the authenticated user.
 *
 * Proxies GitHub with the user's IAM-linked token (resolved server-side); the token
 * never reaches the browser. No linked token ⇒ 401 (the client falls back to the
 * "Connect GitHub" CTA) — never a service-token leak. Per-user ⇒ no-store.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { resolveGithubConnection, listRepos } from '~/lib/server/git'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' } as const

export async function GET(req: NextRequest) {
  const conn = await resolveGithubConnection(req)
  if (!conn) {
    return NextResponse.json({ repos: [], connected: false }, { status: 401, headers: NO_STORE })
  }

  const account = req.nextUrl.searchParams.get('account')?.trim() || ''
  const q = req.nextUrl.searchParams.get('q')?.trim() || ''

  let repos
  try {
    repos = await listRepos(conn, account, q)
  } catch {
    return NextResponse.json({ repos: [], error: 'github unreachable' }, { status: 502, headers: NO_STORE })
  }
  if (repos === null) {
    return NextResponse.json({ repos: [], connected: false }, { status: 401, headers: NO_STORE })
  }

  return NextResponse.json({ repos, connected: true }, { headers: NO_STORE })
}
