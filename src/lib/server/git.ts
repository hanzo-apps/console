/**
 * Server-only Git connection layer — the trust boundary for repository import.
 *
 * A signed-in console user authenticates via Hanzo IAM (HIP-0111 OIDC). When they
 * sign in with — or link — the GitHub provider, IAM (Casdoor) stores that user's
 * GitHub OAuth token in their account `properties["oauth_GitHub_accessToken"]`. IAM
 * masks per-provider tokens for every caller EXCEPT the user themselves, so reading
 * the user's OWN account returns the token unmasked.
 *
 * The console never holds a raw IAM user bearer in the browser; it resolves the
 * signed-in user from the first-party cloud SESSION COOKIE exactly like
 * `resolveUser` — `GET {cloud}/v1/iam/get-account` with the request cookie — which
 * returns the user's own (self) account, tokens unmasked. This module reads that
 * token SERVER-SIDE and uses it to call the GitHub REST API on the user's behalf.
 * The GitHub token NEVER reaches the browser — the BFF routes return only
 * repository/account metadata. Fail-closed everywhere: no session, or no linked
 * GitHub token ⇒ `null` (the UI shows an honest "Connect GitHub" CTA); a shared
 * service token is NEVER substituted.
 *
 * This is the SAME `/v1/git/{accounts,repos}` contract hanzo.app serves, ported so
 * the console's connect-repo dropdown is genuinely real (works the moment a user
 * links GitHub in IAM) rather than a mock.
 *
 * Server-only by construction: imported ONLY by the `/v1/git/*` route handlers
 * (the console convention — like `identity.ts`/`session.ts`, no `server-only`
 * package dep), so the GitHub token never reaches the client bundle.
 */
import type { NextRequest } from 'next/server'

import { fetchWithTimeout } from './fetch-timeout'

const trim = (s: string) => s.replace(/\/+$/, '')

/** Cloud `/v1` backend (hanzoai/cloud) — resolves the session cookie to the user's
 *  account (with unmasked self-tokens). Same default/override as `identity.ts`. */
const CLOUD_API_URL = trim(process.env.CLOUD_API_URL ?? 'http://cloud.hanzo.svc.cluster.local:8000')

/** GitHub REST API base. */
const GITHUB_API = 'https://api.github.com'

/** A resolved GitHub connection for the signed-in user. */
export interface GithubConnection {
  /** The GitHub OAuth access token (SERVER-SIDE ONLY — never serialized out). */
  token: string
  /** The user's GitHub login, when IAM recorded it. */
  login: string
}

/** Shape of the cloud get-account response we consume (best-effort). */
interface AccountData {
  github?: string
  properties?: Record<string, string>
  User?: { github?: string; properties?: Record<string, string> }
}

/**
 * Resolve the signed-in user's GitHub token from IAM via the cloud session cookie.
 *
 * Returns null when the user is unauthenticated OR has no GitHub linked (the honest
 * "not connected" state). A masked value ("***") is treated as absent.
 */
export async function resolveGithubConnection(req: NextRequest): Promise<GithubConnection | null> {
  const cookie = req.headers.get('cookie')
  if (!cookie) return null

  let res: Response
  try {
    res = await fetchWithTimeout(`${CLOUD_API_URL}/v1/iam/get-account`, {
      headers: { cookie, Accept: 'application/json' },
      cache: 'no-store',
    })
  } catch {
    return null
  }
  if (!res.ok) return null

  const json = (await res.json().catch(() => null)) as { status?: string; data?: AccountData } | null
  if (!json || json.status !== 'ok' || !json.data) return null

  const d = json.data
  const props = d.properties ?? d.User?.properties ?? {}
  const token = props['oauth_GitHub_accessToken'] || ''
  if (!token || token === '***') return null

  const login = d.github || d.User?.github || props['oauth_GitHub_username'] || ''
  return { token, login }
}

/** A connected Git account (the user, or an org they belong to). */
export interface GitAccount {
  login: string
  avatarUrl: string
  provider: 'github'
  type: 'user' | 'org'
}

/** A repository row for the import list. */
export interface GitRepo {
  name: string
  fullName: string
  private: boolean
  description: string
  language: string
  pushedAt: string
  defaultBranch: string
  cloneUrl: string
  htmlUrl: string
}

async function gh(token: string, path: string): Promise<Response> {
  return fetchWithTimeout(`${GITHUB_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'hanzo-console',
    },
    cache: 'no-store',
  })
}

/**
 * List the connected accounts: the authenticated user plus every org they can act
 * in. A 401 (token revoked/expired) surfaces as `null` so the caller reports "not
 * connected" rather than a hard error.
 */
export async function listAccounts(conn: GithubConnection): Promise<GitAccount[] | null> {
  const meRes = await gh(conn.token, '/user')
  if (meRes.status === 401) return null
  if (!meRes.ok) throw new Error(`github /user ${meRes.status}`)
  const me = (await meRes.json()) as { login: string; avatar_url: string }

  const accounts: GitAccount[] = [
    { login: me.login, avatarUrl: me.avatar_url || '', provider: 'github', type: 'user' },
  ]

  // Orgs are best-effort: a token without org scope simply yields none.
  try {
    const orgRes = await gh(conn.token, '/user/orgs?per_page=100')
    if (orgRes.ok) {
      const orgs = (await orgRes.json()) as { login: string; avatar_url: string }[]
      for (const o of orgs) {
        accounts.push({ login: o.login, avatarUrl: o.avatar_url || '', provider: 'github', type: 'org' })
      }
    }
  } catch {
    /* orgs are optional */
  }
  return accounts
}

interface RawRepo {
  name: string
  full_name: string
  private: boolean
  description: string | null
  language: string | null
  pushed_at: string | null
  updated_at: string | null
  default_branch: string
  clone_url: string
  html_url: string
}

function normalizeRepo(r: RawRepo): GitRepo {
  return {
    name: r.name,
    fullName: r.full_name,
    private: Boolean(r.private),
    description: r.description || '',
    language: r.language || '',
    pushedAt: r.pushed_at || r.updated_at || '',
    defaultBranch: r.default_branch || 'main',
    cloneUrl: r.clone_url,
    htmlUrl: r.html_url,
  }
}

/**
 * List repositories for one account, newest-push first, filtered by `q`.
 *
 * `account === conn.login` ⇒ the user's own repos (`/user/repos?type=owner`);
 * otherwise the org's repos (`/orgs/:account/repos`). One page of up to 100 is
 * fetched from GitHub and filtered server-side, capped at `cap` rows. Private repos
 * appear only when the stored token carries the `repo` scope.
 */
export async function listRepos(
  conn: GithubConnection,
  account: string,
  q: string,
  cap = 60,
): Promise<GitRepo[] | null> {
  const isSelf = !account || account === conn.login
  const path = isSelf
    ? '/user/repos?per_page=100&sort=pushed&type=owner'
    : `/orgs/${encodeURIComponent(account)}/repos?per_page=100&sort=pushed&type=all`

  const res = await gh(conn.token, path)
  if (res.status === 401) return null
  if (!res.ok) throw new Error(`github repos ${res.status}`)

  const raw = (await res.json()) as RawRepo[]
  const needle = q.trim().toLowerCase()
  const repos = raw
    .map(normalizeRepo)
    .filter((r) => (needle ? (r.fullName + ' ' + r.description).toLowerCase().includes(needle) : true))
  return repos.slice(0, cap)
}
