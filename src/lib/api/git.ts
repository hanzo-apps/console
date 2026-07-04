/**
 * Client for the same-origin Git import BFF (`/v1/git/*`).
 *
 * These endpoints resolve the user's IAM-linked GitHub token server-side and return
 * only repository/account metadata — the token stays on the server. All calls are
 * same-origin so the first-party session cookie rides automatically
 * (`credentials: "include"`). Every helper resolves (never throws): a not-connected /
 * unauthenticated response yields empty data so the UI shows the honest "Connect
 * GitHub" CTA instead of crashing.
 *
 * Same contract hanzo.app's `/new` serves — so the console's connect-repo dropdown
 * lights up with the user's real GitHub repos the moment they link GitHub in IAM.
 */

export interface GitAccount {
  login: string
  avatarUrl: string
  provider: 'github'
  type: 'user' | 'org'
}

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

export interface GitAccountsResult {
  connected: boolean
  accounts: GitAccount[]
}

/** Connected accounts for the signed-in user (empty + not-connected on any failure). */
export async function fetchGitAccounts(): Promise<GitAccountsResult> {
  try {
    const res = await fetch('/v1/git/accounts', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return { connected: false, accounts: [] }
    const body = (await res.json()) as Partial<GitAccountsResult>
    return {
      connected: Boolean(body.connected),
      accounts: Array.isArray(body.accounts) ? body.accounts : [],
    }
  } catch {
    return { connected: false, accounts: [] }
  }
}

/** Repositories for one account, server-side filtered by `q`. Empty on any failure. */
export async function fetchGitRepos(account: string, q = ''): Promise<GitRepo[]> {
  try {
    const params = new URLSearchParams()
    if (account) params.set('account', account)
    if (q.trim()) params.set('q', q.trim())
    const res = await fetch(`/v1/git/repos?${params.toString()}`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return []
    const body = (await res.json()) as { repos?: GitRepo[] }
    return Array.isArray(body.repos) ? body.repos : []
  } catch {
    return []
  }
}

/** "updated 2h ago" — compact relative time for a repo's last push. */
export function relativeTime(iso: string): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000))
  const units: [number, string][] = [
    [31536000, 'y'],
    [2592000, 'mo'],
    [604800, 'w'],
    [86400, 'd'],
    [3600, 'h'],
    [60, 'm'],
  ]
  for (const [size, label] of units) {
    if (secs >= size) return `updated ${Math.floor(secs / size)}${label} ago`
  }
  return 'updated just now'
}
