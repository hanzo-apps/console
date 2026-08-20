/**
 * Git API — Hanzo Git, the native code-hosting subsystem welded into the unified
 * cloud binary (hanzoai/cloud `clients/git`, `/v1/git`). A REPO is the Git source
 * layer under an IAM project; it is scoped to the caller's org SERVER-SIDE (the
 * gateway-minted X-Org-Id / the Bearer owner), so one org can never read, clone, or
 * push to another's repos and NO org param ever leaves the browser.
 *
 * Documented contract (cloud clients/git — the READ/browse surface the dashboard
 * consumes; org resolved server-side on every call). REF + PATH ride as QUERY params
 * (the backend's own `?ref=` UI convention), so a slashed branch (`feature/x`) and a
 * nested file path are always unambiguous — no wildcard %2F ambiguity:
 *   GET /v1/git/repos                          → { data: repoView[] }   list
 *   GET /v1/git/repos/:name                    → repoView               one repo
 *   GET /v1/git/repos/:name/refs               → { branches, tags, default }
 *   GET /v1/git/repos/:name/tree?ref&path      → { entries: treeEntry[] }
 *   GET /v1/git/repos/:name/blob?ref&path      → blob (utf8|base64, binary, trunc)
 *   GET /v1/git/repos/:name/commits?ref&path&limit → { commits: commit[] }
 *   GET /v1/git/repos/:name/readme?ref         → { path, content, encoding }
 *   GET /v1/git/repos/:name/mirrors            → { data: mirrorTarget[] } outbound targets
 *
 * Called SAME-ORIGIN with NO prefix (`cloudProxyV1Url('git/...')` →
 * `<origin>/v1/git/...`, the CTO one-endpoint form). On a standalone console the
 * `app/v1/[...path]` BFF mints a short-lived user bearer and forwards it (a
 * cookie-only call 403s), so `git` is allow-listed in `proxy-allow.ts` exactly
 * like `agents`/`code`; on the go:embed console the same `/v1/git` hits the cloud
 * binary directly under the first-party session cookie. Either way the org is
 * resolved server-side.
 *
 * The surface is PLAIN REST (raw JSON, real HTTP status) — the SAME `restGet`
 * transport as code/agents, NOT the casibase envelope. Every read pulls its array
 * from whichever envelope key the backend uses (`data` / `entries` / `commits` /
 * `items`), and every payload is normalized DEFENSIVELY so a rename upstream
 * degrades a cell to "—" rather than throwing. A browse endpoint that isn't live
 * yet 404s and the caller renders an honest "not available" state — never a
 * fabricated tree, blob, or commit.
 */
import { restGet, cloudProxyV1Url } from './client'

/** Inventory facade base path (same-origin `/v1/git`). */
const BASE = 'git'

// ── Coercion helpers (defensive, code.ts style) ──────────────────────────────
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v)
    ? v
    : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))
      ? Number(v)
      : undefined
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
const bool = (v: unknown): boolean => v === true || v === 'true' || v === 1

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/** Pull the first array found under any of the common envelope keys (or the root). */
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

/** A list of strings under a record key (branch names); tolerant of a missing/loose value. */
const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => str(x)).filter((s): s is string => !!s) : []

// ── Domain types ─────────────────────────────────────────────────────────────

/**
 * One repo view — mirrors the cloud `repoView`. `project`/`description`/`branches`/
 * `head`/`updatedAt` are optional (a fresh bare repo has no commits → no HEAD and no
 * branches), so the UI renders what is present and shows "—" for the rest.
 */
export type Repo = {
  id: string
  org: string
  project?: string
  name: string
  description?: string
  defaultBranch: string
  branches: string[]
  head?: string
  cloneUrl: string
  sshUrl: string
  sizeBytes: number
  createdAt: string
  updatedAt?: string
}

/** A git reference (branch or tag): a name → the commit it points at. */
export type Ref = { name: string; sha: string }

/** The repo's branches + tags + the default branch name. */
export type RefList = { branches: Ref[]; tags: Ref[]; default: string }

/** One entry in a directory listing at a ref+path. `tree` = folder, `blob` = file. */
export type TreeEntry = {
  name: string
  path: string
  type: 'tree' | 'blob'
  size: number
  /** Unix mode bits as an octal string (e.g. `100644`, `040000`, `120000` symlink). */
  mode: string
}

/** A single file's bytes at a ref+path. `utf8` content is inline; `base64` is a raw blob. */
export type Blob = {
  path: string
  size: number
  encoding: 'utf8' | 'base64'
  content: string
  binary: boolean
  truncated: boolean
}

/** One commit in a history list. `shortSha` is the abbreviated hash for display. */
export type Commit = {
  sha: string
  shortSha: string
  message: string
  authorName: string
  authorEmail: string
  date: string
}

/** The rendered README at the repo root (markdown source + its encoding). */
export type Readme = { path: string; content: string; encoding: 'utf8' | 'base64' }

/**
 * One downstream remote a repo's advanced refs are force-pushed to — the cloud
 * `mirrorTargetView`. A repo with NO targets is published nowhere; that absence is
 * the state worth seeing, so it is a value ([] means nowhere) and never a null.
 */
export type Mirror = { id: string; repo: string; host: string; url: string; createdAt: string }

// ── Normalizers (pure — unit-tested) ─────────────────────────────────────────

/** Normalize one repo (drops rows with no name — the org-unique handle is mandatory). */
export function normalizeRepo(raw: unknown): Repo | null {
  const r = asRecord(raw)
  const name = str(r.name) ?? str(r.repo) ?? str(r.repository)
  if (!name) return null
  return {
    id: str(r.id) ?? name,
    org: str(r.org) ?? str(r.owner) ?? '',
    project: str(r.project),
    name,
    description: str(r.description),
    defaultBranch: str(r.defaultBranch) ?? str(r.default_branch) ?? 'main',
    branches: strArray(r.branches),
    head: str(r.head),
    cloneUrl: str(r.cloneUrl) ?? str(r.clone_url) ?? '',
    sshUrl: str(r.sshUrl) ?? str(r.ssh_url) ?? '',
    sizeBytes: num(r.sizeBytes) ?? num(r.size_bytes) ?? num(r.size) ?? 0,
    createdAt: str(r.createdAt) ?? str(r.created_at) ?? '',
    updatedAt: str(r.updatedAt) ?? str(r.updated_at),
  }
}

/** Normalize the list payload → `Repo[]` (reads the array from any common envelope key). */
export function normalizeRepos(payload: unknown): Repo[] {
  return arrayUnder(payload, ['data', 'repos', 'items', 'rows', 'results'])
    .map(normalizeRepo)
    .filter((r): r is Repo => r !== null)
}

/** Normalize one ref (drops a nameless ref). SHA is optional (degrades to ''). */
export function normalizeRef(raw: unknown): Ref | null {
  const r = asRecord(raw)
  const name = str(r.name) ?? str(r.ref) ?? str(r.branch) ?? str(r.tag)
  if (!name) return null
  return { name, sha: str(r.sha) ?? str(r.commit) ?? str(r.hash) ?? '' }
}

/** Normalize the refs payload → `{ branches, tags, default }` (defensive, honest-empty). */
export function normalizeRefList(payload: unknown): RefList {
  const p = asRecord(payload)
  const branches = arrayUnder(p.branches, []).map(normalizeRef).filter((x): x is Ref => x !== null)
  const tags = arrayUnder(p.tags, []).map(normalizeRef).filter((x): x is Ref => x !== null)
  const def = str(p.default) ?? str(p.defaultBranch) ?? str(p.default_branch) ?? branches[0]?.name ?? 'main'
  return { branches, tags, default: def }
}

/** Normalize one tree entry (drops a nameless entry; type coerced to tree|blob). */
export function normalizeTreeEntry(raw: unknown): TreeEntry | null {
  const r = asRecord(raw)
  const name = str(r.name) ?? str(r.path)?.split('/').pop()
  if (!name) return null
  const rawType = (str(r.type) ?? str(r.kind) ?? '').toLowerCase()
  const type: 'tree' | 'blob' =
    rawType === 'tree' || rawType === 'dir' || rawType === 'directory' || bool(r.isDir) ? 'tree' : 'blob'
  return {
    name,
    path: str(r.path) ?? name,
    type,
    size: num(r.size) ?? num(r.sizeBytes) ?? 0,
    mode: str(r.mode) ?? '',
  }
}

/** Normalize the tree payload → `TreeEntry[]` (reads the array from any common key). */
export function normalizeTree(payload: unknown): TreeEntry[] {
  return arrayUnder(payload, ['entries', 'tree', 'data', 'items', 'files'])
    .map(normalizeTreeEntry)
    .filter((e): e is TreeEntry => e !== null)
}

/** Normalize a blob payload → `Blob` (encoding defaults to utf8; content defaults to ''). */
export function normalizeBlob(payload: unknown): Blob | null {
  const r = asRecord(payload)
  // A blob response must at least carry a path or content to be real.
  const path = str(r.path) ?? ''
  const content = typeof r.content === 'string' ? r.content : ''
  if (!path && content === '' && r.size === undefined) return null
  const enc = (str(r.encoding) ?? '').toLowerCase()
  return {
    path,
    size: num(r.size) ?? num(r.sizeBytes) ?? content.length,
    encoding: enc === 'base64' ? 'base64' : 'utf8',
    content,
    binary: bool(r.binary) || bool(r.isBinary),
    truncated: bool(r.truncated) || bool(r.isTruncated),
  }
}

/** Normalize one commit (drops a sha-less commit; shortSha derived when absent). */
export function normalizeCommit(raw: unknown): Commit | null {
  const r = asRecord(raw)
  const sha = str(r.sha) ?? str(r.id) ?? str(r.hash) ?? str(r.commit)
  if (!sha) return null
  return {
    sha,
    shortSha: str(r.shortSha) ?? str(r.short_sha) ?? sha.slice(0, 7),
    message: str(r.message) ?? str(r.subject) ?? '',
    authorName: str(r.authorName) ?? str(r.author_name) ?? str(r.author) ?? '',
    authorEmail: str(r.authorEmail) ?? str(r.author_email) ?? str(r.email) ?? '',
    date: str(r.date) ?? str(r.authoredAt) ?? str(r.authored_at) ?? str(r.time) ?? '',
  }
}

/** Normalize the commits payload → `Commit[]` (reads the array from any common key). */
export function normalizeCommits(payload: unknown): Commit[] {
  return arrayUnder(payload, ['commits', 'data', 'items', 'log', 'results'])
    .map(normalizeCommit)
    .filter((c): c is Commit => c !== null)
}

/** Normalize a readme payload → `Readme` (null when the repo has no README). */
export function normalizeReadme(payload: unknown): Readme | null {
  const r = asRecord(payload)
  const content = typeof r.content === 'string' ? r.content : undefined
  const path = str(r.path)
  if (content === undefined && !path) return null
  const enc = (str(r.encoding) ?? '').toLowerCase()
  return { path: path ?? 'README.md', content: content ?? '', encoding: enc === 'base64' ? 'base64' : 'utf8' }
}

/**
 * Normalize one mirror target (drops a target with no url — the url IS the target).
 * `host` falls back to the url's own hostname, so a row is never labelled by a field
 * the backend happens not to send.
 */
export function normalizeMirror(raw: unknown): Mirror | null {
  const r = asRecord(raw)
  const url = str(r.url) ?? str(r.remote) ?? str(r.target)
  if (!url) return null
  let host = str(r.host)
  if (!host) {
    try {
      host = new URL(url).hostname.toLowerCase()
    } catch {
      host = undefined
    }
  }
  return {
    id: str(r.id) ?? url,
    repo: str(r.repo) ?? '',
    host: host ?? '',
    url,
    createdAt: str(r.createdAt) ?? str(r.created_at) ?? '',
  }
}

/**
 * Normalize the list payload → `Mirror[]`, or `null` when the payload carried NO list
 * at all.
 *
 * The distinction is the whole point. Every other normalizer here may fold an
 * unrecognised payload to an empty array, because for a tree or a commit log "empty"
 * and "could not read" both render the same em dash. For mirrors they are opposite
 * claims: `[]` means this repo publishes nowhere — a finding a caller displays and
 * sorts to the top — so silently producing `[]` for a 204, a `{}`, a renamed envelope
 * or an intermediary's placeholder body would accuse every repo in the org at once.
 * `null` says "no answer here" and lets the caller report it as unread.
 */
export function normalizeMirrors(payload: unknown): Mirror[] | null {
  const list = Array.isArray(payload)
    ? (payload.filter((x) => x && typeof x === 'object') as Record<string, unknown>[])
    : listUnder(payload, ['data', 'mirrors', 'items', 'rows', 'results'])
  if (list === null) return null
  return list.map(normalizeMirror).filter((m): m is Mirror => m !== null)
}

/** The first key holding an array, as records — or `null` when no key holds one. */
function listUnder(payload: unknown, keys: string[]): Record<string, unknown>[] | null {
  if (!payload || typeof payload !== 'object') return null
  const o = payload as Record<string, unknown>
  for (const k of keys) {
    const v = o[k]
    if (Array.isArray(v)) return v.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]
  }
  return null
}

// ── Derived helpers (pure — unit-tested) ─────────────────────────────────────

const EM = '—'

/** A stable, human `git clone` command for the copy button (falls back to the URL alone). */
export const cloneCommand = (repo: Pick<Repo, 'cloneUrl'>): string =>
  repo.cloneUrl ? `git clone ${repo.cloneUrl}` : ''

/** Short HEAD (first 7 of the resolved commit hash); em dash when the repo is empty. */
export const shortHead = (head?: string): string =>
  head && head.length >= 7 ? head.slice(0, 7) : head || EM

/** A stable React key for a repo (org-qualified so identical names across scopes don't clash). */
export const repoKey = (r: Repo): string => `${r.org}/${r.project ?? ''}/${r.name}`

// ── URL construction (pure — unit-tested) ────────────────────────────────────

/** Build `<origin>/v1/git/<path>` (no org param — the server resolves tenancy). */
const gitUrl = (path: string): string => cloudProxyV1Url(`${BASE}/${path.replace(/^\/+/, '')}`)

/** Append a query map to a URL string, skipping empty/undefined values. */
export const withQuery = (url: string, q: Record<string, string | number | undefined>): string => {
  const parts = Object.entries(q)
    .filter(([, v]) => v !== undefined && v !== '' && !(typeof v === 'number' && Number.isNaN(v)))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
  return parts.length ? `${url}?${parts.join('&')}` : url
}

// ── Network methods (thin — forward-compatible against the documented contract) ─

export const GitApi = {
  /** List the org's repos (`GET /v1/git/repos`). Org-scoped server-side; honest-empty/error until bound. */
  repos: (): Promise<Repo[]> => restGet<unknown>(gitUrl('repos')).then(normalizeRepos),

  /** One repo's detail (`GET /v1/git/repos/:name`). */
  repo: (name: string): Promise<Repo | null> =>
    restGet<unknown>(gitUrl(`repos/${encodeURIComponent(name)}`)).then(normalizeRepo),

  /** Branches + tags + default (`GET /v1/git/repos/:name/refs`). */
  refs: (name: string): Promise<RefList> =>
    restGet<unknown>(gitUrl(`repos/${encodeURIComponent(name)}/refs`)).then(normalizeRefList),

  /** Directory listing at a ref+path (`GET /v1/git/repos/:name/tree?ref&path`). */
  tree: (name: string, ref: string, path = ''): Promise<TreeEntry[]> =>
    restGet<unknown>(withQuery(gitUrl(`repos/${encodeURIComponent(name)}/tree`), { ref, path })).then(normalizeTree),

  /** A file's bytes at a ref+path (`GET /v1/git/repos/:name/blob?ref&path`). */
  blob: (name: string, ref: string, path: string): Promise<Blob | null> =>
    restGet<unknown>(withQuery(gitUrl(`repos/${encodeURIComponent(name)}/blob`), { ref, path })).then(normalizeBlob),

  /** Commit history (`GET /v1/git/repos/:name/commits?ref&path&limit`). */
  commits: (name: string, opts: { ref?: string; path?: string; limit?: number } = {}): Promise<Commit[]> =>
    restGet<unknown>(
      withQuery(gitUrl(`repos/${encodeURIComponent(name)}/commits`), {
        ref: opts.ref,
        path: opts.path,
        limit: opts.limit,
      }),
    ).then(normalizeCommits),

  /** The root README (`GET /v1/git/repos/:name/readme?ref`); null when absent. */
  readme: (name: string, ref?: string): Promise<Readme | null> =>
    restGet<unknown>(withQuery(gitUrl(`repos/${encodeURIComponent(name)}/readme`), { ref })).then(normalizeReadme),

  /**
   * A repo's outbound targets (`GET /v1/git/repos/:name/mirrors`). An empty array is a
   * real answer — no target is configured — and `null` means the response carried no
   * list to read. Both differ from a failed read, which throws.
   */
  mirrors: (name: string): Promise<Mirror[] | null> =>
    restGet<unknown>(gitUrl(`repos/${encodeURIComponent(name)}/mirrors`)).then(normalizeMirrors),
}
