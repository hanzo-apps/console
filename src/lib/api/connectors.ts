/**
 * Integrations API — the org-authed connector framework over the REAL cloud
 * `/v1/connectors` surface (cloud `clients/connectors`, a generic provider-
 * agnostic OAuth connector store on Base/SQLite; Slack is the reference impl,
 * GitHub the registered seam, Google/Salesforce plug into the same registry).
 *
 * Every call is same-origin, keyless and prefix-free (`originV1Url('integrations/...')`
 * → `<origin>/v1/connectors/...`, the CTO one-endpoint form — NOTHING before `/v1/`).
 * The console's OWN `app/v1` user-bearer BFF serves the `integrations` head — it mints a
 * short-lived user-bound IAM token server-side and forwards it; the cloud backend
 * resolves the org from the token's `owner` claim, so every list/connect/disconnect is
 * org-scoped SERVER-SIDE and no credential reaches the browser. This is the EXACT
 * per-tenant path Agents/CRM/Evals use (`integrations` is allow-listed in
 * `proxy-allow.ts` CLOUD_HEADS). A cookie-only call would 403 ("X-Org-Id required"), so
 * the bearer BFF is mandatory.
 *
 * Routes (from the CONNECTORS_CONTRACT, cloud `clients/connectors`):
 *   GET  /v1/connectors                        list → { providers: [Provider] }
 *   GET  /v1/connectors/:provider              detail (404 unknown id)
 *   POST /v1/connectors/:provider/connect      → { authorizeUrl } | 503 not-configured
 *   POST /v1/connectors/:provider/disconnect   → { disconnected: true }
 *   GET  /v1/connectors/:provider/callback     PUBLIC (state-authed) — NOT called here;
 *                                                it 302s the browser back to /integrations.
 *
 * Plain REST (raw JSON, real HTTP status). Payloads are normalized DEFENSIVELY — a
 * field rename upstream degrades a card rather than throwing, and the list is read from
 * whichever envelope key the backend uses (`providers` / `data` / `items` / a bare
 * array). PURE normalizers are unit-tested (integrations.test.ts).
 *
 * NOTE on verbs: disconnect is a POST (`/disconnect`), matching the contract's generic
 * revoke route — NOT a REST DELETE (the cloud framework keeps the provider row and
 * only revokes+clears the sealed token via a POST action).
 */
import { restGet, restPost, originV1Url } from './client'

const BASE = 'connectors'
const enc = encodeURIComponent

// ── Coercion helpers (defensive; crm.ts style) ──────────────────────────────
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const bool = (v: unknown): boolean => v === true || v === 'true' || v === 1
const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
/** Coerce any array-ish of scalars to a clean string[] (drops empties). */
const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(str).filter((s) => s !== '') : []

/** Pull the first array found under any common envelope key (or the root). */
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
const providerRows = (payload: unknown) => arrayUnder(payload, ['providers', 'data', 'items', 'rows'])

// ── Domain types (mirror the CONNECTORS_CONTRACT Provider JSON) ──────────────

/** A live per-org connection to a provider (present only when `connected`). */
export type Connection = {
  /** Human label for the connected account (Slack team name / GitHub org). */
  account: string
  /** The provider-side id (Slack team_id / GitHub installation_id). */
  externalId: string
  /** Granted OAuth scopes. */
  scopes: string[]
  /** When the connection was established (RFC3339 string; may be empty). */
  connectedAt: string
}

/**
 * HOW a connector is connected — the one thing that genuinely differs between
 * the two halves of the catalog.
 *
 * `oauth` sends the browser to the provider and comes back with a code.
 * `credential` cannot: WhatsApp, a carrier SMS account and SMTP hand you a
 * token (or a host and a password) in a dashboard, with no consent screen and
 * nothing to come back from. Cloud PUBLISHES this rather than leaving a client
 * to keep its own list of which providers are which.
 */
export type ConnectorKind = 'oauth' | 'credential'

/** One input a credential connector asks for. The form is rendered from the
 *  catalog, so adding a connector never edits this UI. */
export type ConnectorField = {
  name: string
  label: string
  /** Sealed into KMS and never read back. Rendered as a password input. */
  secret: boolean
  required: boolean
}

/** One connectable provider card. */
export type Provider = {
  id: string
  name: string
  description: string
  category: string
  /** App creds are configured on this deployment — the Connect button is live.
   *  Always true for a credential connector: it is configured by the org that
   *  pastes its own account, so there is no deployment credential to be missing. */
  available: boolean
  /** This org has an active connection. */
  connected: boolean
  /** The active connection details (null when not connected). */
  connection: Connection | null
  /** Which connect leg this provider takes. Defaults to `oauth` so a cloud that
   *  has not published the field yet keeps its current meaning. */
  kind: ConnectorKind
  /** The form a credential connector needs; empty for oauth. */
  fields: ConnectorField[]
}

/** The connect response. An oauth connect answers with the provider authorize
 *  URL to top-level navigate to; a credential connect has already finished by
 *  the time it replies, and says so. */
export type ConnectResult = { authorizeUrl: string; connected?: boolean; account?: string }

// ── Normalizers (pure; honest defaults, never throw) ─────────────────────────

export function normalizeConnection(raw: unknown): Connection {
  const r = asRecord(raw)
  return {
    account: str(r.account) || str(r.accountLabel) || str(r.account_label),
    externalId: str(r.externalId) || str(r.external_id),
    scopes: strArray(r.scopes),
    connectedAt: str(r.connectedAt) || str(r.connected_at),
  }
}

export function normalizeProvider(raw: unknown): Provider {
  const r = asRecord(raw)
  // A connection object present (any of the common keys) → normalize it; a bare
  // `connected:true` with no object still renders as connected (honest, no throw).
  const rawConn = r.connection ?? r.connectionInfo ?? null
  const connection = rawConn && typeof rawConn === 'object' ? normalizeConnection(rawConn) : null
  return {
    id: str(r.id),
    name: str(r.name) || str(r.id),
    description: str(r.description),
    category: str(r.category),
    available: bool(r.available),
    connected: bool(r.connected) || connection != null,
    connection,
    // Anything that is not the credential kind reads as oauth, which is the
    // safe default: an oauth connect navigates and an unexpected value would
    // otherwise render a form with no fields in it.
    kind: str(r.kind) === 'credential' ? 'credential' : 'oauth',
    fields: normalizeFields(r.fields),
  }
}

/** Field rows, tolerant of a missing/garbage list — a connector whose form
 *  cannot be read renders as having none rather than throwing the page away. */
export function normalizeFields(raw: unknown): ConnectorField[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((f) => {
      const r = asRecord(f)
      return {
        name: str(r.name),
        label: str(r.label) || str(r.name),
        secret: bool(r.secret),
        required: bool(r.required),
      }
    })
    .filter((f) => f.name)
}

export function normalizeProviders(payload: unknown): Provider[] {
  return providerRows(payload).map(normalizeProvider).filter((p) => p.id)
}

/**
 * Normalize the connect response to a single `authorizeUrl`. Tolerates
 * `authorizeUrl` / `authorize_url` / `url`. Returns `''` on a garbage/empty body
 * (never throws) — the caller checks it's non-empty before navigating, so an
 * unexpected shape is an honest "could not connect", never a dead-end redirect.
 */
export function normalizeConnectResult(raw: unknown): ConnectResult {
  const r = asRecord(raw)
  return {
    authorizeUrl: str(r.authorizeUrl) || str(r.authorize_url) || str(r.url),
    connected: bool(r.connected),
    account: str(r.account),
  }
}

// ── Network methods (thin — one per documented route) ────────────────────────

export const ConnectorsApi = {
  /** All connectable providers for the current org (org from the Bearer owner). */
  list: (): Promise<Provider[]> =>
    restGet<unknown>(originV1Url(BASE)).then(normalizeProviders),

  /** One provider by id (404 → the caller's honest "unavailable"). */
  get: (id: string): Promise<Provider> =>
    restGet<unknown>(originV1Url(`${BASE}/${enc(id)}`)).then(normalizeProvider),

  /**
   * Connect. ONE method for both kinds, because it is one route: an oauth
   * connector answers with the authorize URL to navigate to, and a credential
   * connector takes the pasted `values` and answers {connected:true} — it has
   * already verified and sealed them by the time it replies.
   */
  connect: (id: string, values?: Record<string, string>): Promise<ConnectResult> =>
    restPost<unknown>(originV1Url(`${BASE}/${enc(id)}/connect`), values).then(normalizeConnectResult),

  /** Revoke + clear this org's connection (POST /disconnect, per the contract). */
  disconnect: (id: string): Promise<void> =>
    restPost<unknown>(originV1Url(`${BASE}/${enc(id)}/disconnect`)).then(() => undefined),
}

// ── GitHub App: repo mirror + bidirectional sync ─────────────────────────────
//
// Once the org installs the Hanzo GitHub App (via ConnectorsApi.connect('github')),
// these list the org's granted repos and import them into git.hanzo.ai. Every call
// is org-scoped SERVER-SIDE (the granted set rides the org's own installation token),
// over the SAME `integrations` head — nothing before `/v1/`.
//   GET  /v1/connectors/github/repos          → { repos: [GitHubRepo] }
//   POST /v1/connectors/github/repos/import   → { queued, repos }  (202)

/** One repo the installation grants, annotated with its native import + sync status. */
export type GitHubRepo = {
  name: string
  fullName: string
  private: boolean
  defaultBranch: string
  /** A native repo exists in git.hanzo.ai for this repo. */
  imported: boolean
  /** '' (not imported) · 'synced' · 'conflict' (native diverged, preserved). */
  syncStatus: '' | 'synced' | 'conflict'
  lastSyncedAt: string
  htmlUrl: string
}

/** The queued-import response (202): how many repos were queued for a background import. */
export type GitHubImportResult = { queued: number; repos: string[] }

const syncStatusOf = (v: unknown): GitHubRepo['syncStatus'] =>
  v === 'synced' || v === 'conflict' ? v : ''

export function normalizeGitHubRepo(raw: unknown): GitHubRepo {
  const r = asRecord(raw)
  return {
    name: str(r.name),
    fullName: str(r.fullName) || str(r.full_name) || str(r.name),
    private: bool(r.private),
    defaultBranch: str(r.defaultBranch) || str(r.default_branch),
    imported: bool(r.imported),
    syncStatus: syncStatusOf(r.syncStatus ?? r.sync_status),
    lastSyncedAt: str(r.lastSyncedAt) || str(r.last_synced_at),
    htmlUrl: str(r.htmlUrl) || str(r.html_url),
  }
}

export function normalizeGitHubRepos(payload: unknown): GitHubRepo[] {
  return arrayUnder(payload, ['repos', 'data', 'items']).map(normalizeGitHubRepo).filter((r) => r.name)
}

export const GitHubApi = {
  /** The org's granted GitHub repos with per-repo import + sync status. */
  listRepos: (): Promise<GitHubRepo[]> =>
    restGet<unknown>(originV1Url(`${BASE}/github/repos`)).then(normalizeGitHubRepos),

  /** Queue a background import into git.hanzo.ai of the named repos (or all granted). */
  importRepos: (sel: { repos?: string[]; all?: boolean }): Promise<GitHubImportResult> =>
    restPost<unknown>(originV1Url(`${BASE}/github/repos/import`), sel).then((raw) => {
      const r = asRecord(raw)
      return { queued: Number(r.queued) || 0, repos: strArray(r.repos) }
    }),
}
