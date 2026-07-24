/**
 * Authors — the customer client over the REAL cloud `/v1/authors` surface
 * (cloud `clients/authors`: a native-Go, per-org OSS-AUTHOR royalty loop on
 * Base/SQLite that pays an ongoing share of the platform spend of every org that
 * DEPLOYS the author's open-source project on Hanzo, settled through the commerce
 * ledger). This is the connect/verify-based creator-revenue loop beside affiliates'
 * ?aff partner-commission loop — an author connects GitHub, verifies the repos they
 * own, and earns when someone deploys their work. Every read/write is org-scoped
 * SERVER-SIDE from the minted user bearer; no credential reaches the browser.
 *
 * TRANSPORT: `cloudProxyV1Url('authors/…')` → `<origin>/v1/authors/…`,
 * the console's hardened `/v1` user-bearer proxy (NOT bare `/v1/…`, which the live
 * ingress routes to the gateway with no principal → 403; the affiliates/crm lesson).
 * The backend answers BARE JSON, so these use the plain REST verbs + defensive
 * normalizers.
 */
import { restGet, restPost, cloudProxyV1Url } from './client'

const BASE = 'authors'

// ── Coercion helpers (defensive; affiliates.ts style) ────────────────────────
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const int = (v: unknown): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v)
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Math.trunc(Number(v))
  return 0
}
const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const arrayUnder = (payload: unknown, keys: string[]): Record<string, unknown>[] => {
  if (Array.isArray(payload)) return payload.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]
  if (payload && typeof payload === 'object') {
    for (const k of keys) {
      const v = (payload as Record<string, unknown>)[k]
      if (Array.isArray(v)) return v.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]
    }
  }
  return []
}

// ── Domain types (mirror cloud clients/authors JSON tags) ────────────────────

/** An author advances connected → approved (and can be suspended). */
export type AuthorStatus = 'connected' | 'approved' | 'suspended' | (string & {})

/** How a repository was verified: the GitHub app (oauth), a hanzo.json file, or not yet (''). */
export type RepoVerifyMethod = 'oauth' | 'file' | '' | (string & {})

/** One row of an author's payout history. */
export type Payout = {
  id: string
  amountCents: number
  method: string
  reference: string
  txn: string
  createdAt: number
}

/** A repository the author has claimed, with its ready-to-paste "Deploy on Hanzo" badge. */
export type AuthorRepo = {
  repoUrl: string
  verified: boolean
  method: RepoVerifyMethod
  badgeMarkdown: string
  verifiedAt: number
  createdAt: number
}

/** A recorded deploy of the author's work by some org. */
export type AuthorDeploy = {
  repoUrl: string
  project: string
  deployingOrg: string
  createdAt: number
}

/**
 * The GET /v1/authors overview. `isAuthor:false` (with `defaultShareBps` +
 * `badgeBase`) means the org has NOT connected yet → the console shows the connect
 * form; otherwise the full dashboard (status, GitHub identity + verify recipe, share,
 * repos, deploys, ledger, payouts).
 */
export type AuthorOverview = {
  isAuthor: boolean
  defaultShareBps: number
  badgeBase: string
  id: string
  status: AuthorStatus
  githubLogin: string
  verified: boolean
  verifyCode: string
  verifyFile: string
  verifySnippet: string
  shareBps: number
  repos: AuthorRepo[]
  deploys: AuthorDeploy[]
  accruedCents: number
  pendingCents: number
  paidCents: number
  payouts: Payout[]
}

/** The POST /v1/authors/connect result. */
export type ConnectResult = {
  id: string
  status: AuthorStatus
  githubLogin: string
  verified: boolean
  verifyCode: string
  verifyFile: string
  verifySnippet: string
  shareBps: number
  created: boolean
}

/** The POST /v1/authors/repos/verify result. */
export type VerifyRepoResult = {
  repo: AuthorRepo
  created: boolean
}

// ── Normalizers (garbage-in → safe default) ──────────────────────────────────

export function normalizePayout(v: unknown): Payout {
  const r = asRecord(v)
  return {
    id: str(r.id),
    amountCents: int(r.amountCents),
    method: str(r.method),
    reference: str(r.reference),
    txn: str(r.txn),
    createdAt: int(r.createdAt),
  }
}

export function normalizeRepo(v: unknown): AuthorRepo {
  const r = asRecord(v)
  return {
    repoUrl: str(r.repoUrl),
    verified: r.verified === true,
    method: (str(r.method) || '') as RepoVerifyMethod,
    badgeMarkdown: str(r.badgeMarkdown),
    verifiedAt: int(r.verifiedAt),
    createdAt: int(r.createdAt),
  }
}

export function normalizeDeploy(v: unknown): AuthorDeploy {
  const r = asRecord(v)
  return {
    repoUrl: str(r.repoUrl),
    project: str(r.project),
    deployingOrg: str(r.deployingOrg),
    createdAt: int(r.createdAt),
  }
}

export function normalizeOverview(v: unknown): AuthorOverview {
  const r = asRecord(v)
  // The default share is what a connect would grant (backend sends it in BOTH shapes).
  // Fallback is the ONE canonical creator share, 20% (2000 bps) — matches cloud's
  // authors.defaultShareBps, so a missing field never shows the wrong rate.
  const defaultShareBps = int(r.defaultShareBps) || 2000
  return {
    isAuthor: r.isAuthor === true,
    defaultShareBps,
    badgeBase: str(r.badgeBase) || 'https://hanzo.app',
    id: str(r.id),
    status: (str(r.status) || 'connected') as AuthorStatus,
    githubLogin: str(r.githubLogin),
    verified: r.verified === true,
    verifyCode: str(r.verifyCode),
    verifyFile: str(r.verifyFile) || 'hanzo.json',
    verifySnippet: str(r.verifySnippet),
    shareBps: int(r.shareBps),
    repos: arrayUnder(r.repos, ['repos', 'data', 'items']).map(normalizeRepo).filter((x) => x.repoUrl),
    deploys: arrayUnder(r.deploys, ['deploys', 'data', 'items']).map(normalizeDeploy).filter((x) => x.repoUrl),
    accruedCents: int(r.accruedCents),
    pendingCents: int(r.pendingCents),
    paidCents: int(r.paidCents),
    payouts: arrayUnder(r.payouts, ['payouts', 'data', 'items']).map(normalizePayout).filter((p) => p.id),
  }
}

export function normalizeConnect(v: unknown): ConnectResult {
  const r = asRecord(v)
  return {
    id: str(r.id),
    status: (str(r.status) || 'connected') as AuthorStatus,
    githubLogin: str(r.githubLogin),
    verified: r.verified === true,
    verifyCode: str(r.verifyCode),
    verifyFile: str(r.verifyFile) || 'hanzo.json',
    verifySnippet: str(r.verifySnippet),
    shareBps: int(r.shareBps),
    created: r.created === true,
  }
}

export function normalizeVerifyRepo(v: unknown): VerifyRepoResult {
  const r = asRecord(v)
  return {
    repo: normalizeRepo(r.repo),
    created: r.created === true,
  }
}

// ── Network surface ───────────────────────────────────────────────────────────

export const AuthorsApi = {
  /** GET /v1/authors — my status, GitHub identity, verify recipe, repos, deploys, ledger, payouts. */
  overview: (): Promise<AuthorOverview> =>
    restGet<unknown>(cloudProxyV1Url(BASE)).then(normalizeOverview),

  /** POST /v1/authors/connect — join the program (optional GitHub login hint). */
  connect: (githubLogin?: string): Promise<ConnectResult> =>
    restPost<unknown>(cloudProxyV1Url(`${BASE}/connect`), { githubLogin: githubLogin ?? '' }).then(normalizeConnect),

  /** POST /v1/authors/repos/verify — claim + verify one repository you own. */
  verifyRepo: (repoUrl: string): Promise<VerifyRepoResult> =>
    restPost<unknown>(cloudProxyV1Url(`${BASE}/repos/verify`), { repoUrl }).then(normalizeVerifyRepo),
}
