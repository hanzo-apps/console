/**
 * Social API — Hanzo Social (per-org accounts + posts), over the REAL cloud
 * `/v1/social` surface (cloud `clients/social`, a native-Go per-org accounts+posts
 * store on Base/SQLite — the in-process fold of the live social stack
 * github.com/hanzoai/social, twin of clients/crm). NOT a proxy to the standalone
 * social pods.
 *
 * Every call is same-origin, keyless and prefix-free (`originV1Url('social/...')`
 * → `<origin>/v1/social/...`). The console's OWN `app/v1` user-bearer BFF serves the
 * `social` head — it mints a short-lived user-bound IAM token server-side and
 * forwards it; the cloud backend resolves the org from the token's `owner` claim, so
 * every read/write is org-scoped SERVER-SIDE and no credential reaches the browser.
 * This is the EXACT per-tenant path CRM/Agents/Prompts use (the `social` head is
 * allow-listed in `proxy-allow.ts` CLOUD_HEADS). A cookie-only call would 403
 * ("X-Org-Id required"), so the bearer BFF is mandatory — never a direct call.
 *
 * Routes (from cloud `clients/social/social.go`):
 *   GET                 /v1/social/summary               per-org roll-up
 *   GET/POST            /v1/social/accounts              list (?provider=) / connect
 *   GET/PUT/DELETE      /v1/social/accounts/:id          detail / update / disconnect
 *   GET/POST            /v1/social/posts                 list (?status=) / create-or-schedule
 *   GET/PUT/DELETE      /v1/social/posts/:id             detail / update / delete
 *
 * Plain REST (raw JSON, real HTTP status). Payloads are normalized DEFENSIVELY — a
 * field rename upstream degrades a cell rather than throwing, and the list is read
 * from whichever envelope key the backend uses (`data`/`items`/`rows`, or a bare
 * array). Mirrors the crm.ts / marketing.ts shape exactly.
 */
import { restGet, restPost, restPut, restDelete, originV1Url } from './client'

const BASE = 'social'
const enc = encodeURIComponent

// ── Coercion helpers (defensive; crm.ts style) ──────────────────────────────
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const num = (v: unknown): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
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
const rows = (payload: unknown) => arrayUnder(payload, ['data', 'items', 'rows'])

// ── Domain types (mirror cloud clients/social/store.go JSON tags) ────────────

/** Networks (cloud rejects an unknown provider/channel; '' → x). */
export const PROVIDERS = ['x', 'facebook', 'instagram', 'linkedin', 'tiktok', 'youtube', 'threads'] as const
export type Provider = (typeof PROVIDERS)[number]

/** Account connection lifecycle (cloud rejects an unknown status; '' → connected). */
export const ACCOUNT_STATUSES = ['connected', 'disconnected', 'error'] as const
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number]

/** Post lifecycle (cloud rejects an unknown status; '' → draft). */
export const POST_STATUSES = ['draft', 'scheduled', 'published', 'failed'] as const
export type PostStatus = (typeof POST_STATUSES)[number]

export type Account = {
  id: string
  provider: string
  handle: string
  status: string
  createdAt: number
  updatedAt: number
}

export type Post = {
  id: string
  content: string
  channel: string
  status: string
  /** Unix seconds; 0 = not scheduled / publish now. */
  scheduleAt: number
  createdAt: number
  updatedAt: number
}

export type Summary = { posts: number; scheduled: number; published: number; accounts: number }

/** Create/update bodies — only the writable fields (server owns id/org/timestamps). */
export type NewAccount = Partial<Omit<Account, 'id' | 'createdAt' | 'updatedAt'>> & { provider: string }
export type NewPost = Partial<Omit<Post, 'id' | 'createdAt' | 'updatedAt'>> & { content: string }

// ── Normalizers (pure) ──────────────────────────────────────────────────────

export function normalizeAccount(raw: unknown): Account {
  const r = asRecord(raw)
  return {
    id: str(r.id),
    provider: str(r.provider) || 'x',
    handle: str(r.handle),
    status: str(r.status) || 'connected',
    createdAt: num(r.createdAt),
    updatedAt: num(r.updatedAt),
  }
}

export function normalizePost(raw: unknown): Post {
  const r = asRecord(raw)
  return {
    id: str(r.id),
    content: str(r.content),
    channel: str(r.channel) || 'x',
    status: str(r.status) || 'draft',
    scheduleAt: num(r.scheduleAt),
    createdAt: num(r.createdAt),
    updatedAt: num(r.updatedAt),
  }
}

export function normalizeSummary(raw: unknown): Summary {
  const r = asRecord(raw)
  return { posts: num(r.posts), scheduled: num(r.scheduled), published: num(r.published), accounts: num(r.accounts) }
}

export const normalizeAccounts = (p: unknown): Account[] => rows(p).map(normalizeAccount).filter((a) => a.id)
export const normalizePosts = (p: unknown): Post[] => rows(p).map(normalizePost).filter((p) => p.id)

// ── Network methods (thin — one per documented route) ───────────────────────

export const SocialApi = {
  summary: (): Promise<Summary> => restGet<unknown>(originV1Url(`${BASE}/summary`)).then(normalizeSummary),

  accounts: {
    list: (provider?: string): Promise<Account[]> =>
      restGet<unknown>(
        originV1Url(`${BASE}/accounts${provider ? `?provider=${enc(provider)}` : ''}`),
      ).then(normalizeAccounts),
    get: (id: string): Promise<Account> =>
      restGet<unknown>(originV1Url(`${BASE}/accounts/${enc(id)}`)).then(normalizeAccount),
    create: (body: NewAccount): Promise<Account> =>
      restPost<unknown>(originV1Url(`${BASE}/accounts`), body).then(normalizeAccount),
    update: (id: string, body: NewAccount): Promise<Account> =>
      restPut<unknown>(originV1Url(`${BASE}/accounts/${enc(id)}`), body).then(normalizeAccount),
    remove: (id: string): Promise<void> => restDelete(originV1Url(`${BASE}/accounts/${enc(id)}`)),
  },

  posts: {
    list: (status?: string): Promise<Post[]> =>
      restGet<unknown>(
        originV1Url(`${BASE}/posts${status ? `?status=${enc(status)}` : ''}`),
      ).then(normalizePosts),
    get: (id: string): Promise<Post> =>
      restGet<unknown>(originV1Url(`${BASE}/posts/${enc(id)}`)).then(normalizePost),
    create: (body: NewPost): Promise<Post> =>
      restPost<unknown>(originV1Url(`${BASE}/posts`), body).then(normalizePost),
    update: (id: string, body: NewPost): Promise<Post> =>
      restPut<unknown>(originV1Url(`${BASE}/posts/${enc(id)}`), body).then(normalizePost),
    remove: (id: string): Promise<void> => restDelete(originV1Url(`${BASE}/posts/${enc(id)}`)),
  },
}
