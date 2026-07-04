/**
 * /v1/git/accounts — the signed-in user's connected Git accounts.
 *
 * GET → `{ connected: boolean, accounts: GitAccount[] }`.
 *   - `connected: false, accounts: []` when the user has no GitHub linked in IAM
 *     (drives the honest "Connect GitHub" CTA — NEVER fabricated rows).
 *   - Otherwise the authenticated GitHub user + the orgs they belong to.
 *
 * The GitHub token is resolved from IAM server-side (the user's own session) and
 * used only here — it is never returned to the browser. Per-user data ⇒ no-store.
 *
 * `git` is deliberately NOT a `/cloud` rewrite head (next.config `CLOUD_V1_HEADS`),
 * so `/v1/git/*` terminates at THIS console BFF, not the cloud binary's internal
 * git-hosting surface.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { resolveGithubConnection, listAccounts } from '~/lib/server/git'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' } as const

export async function GET(req: NextRequest) {
  const conn = await resolveGithubConnection(req)
  if (!conn) {
    return NextResponse.json({ connected: false, accounts: [] }, { headers: NO_STORE })
  }

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
  if (accounts === null) {
    return NextResponse.json({ connected: false, accounts: [] }, { headers: NO_STORE })
  }

  return NextResponse.json({ connected: true, accounts }, { headers: NO_STORE })
}
