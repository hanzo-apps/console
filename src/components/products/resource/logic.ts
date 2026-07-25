/**
 * Managed-resource domain logic — PURE, no UI, no transport (types only, erased).
 *
 * ONE provisioning contract (`POST/GET/DELETE /v1/<kind>`) backs every Hanzo data
 * product (SQL, KV, Datastore, S3, Vector, DocDB). The list/detail API
 * carries lifecycle facts only — name, status, host/port, the optional username/
 * database, and createdAt. It does NOT carry content/usage metrics (rows, keys,
 * objects, storage bytes, queries, latency, cost): those are the shape of the
 * forthcoming metering read API. So this module:
 *
 *   - derives the REAL fleet headline from the list (instance count + a
 *     ready/provisioning/error breakdown), and
 *   - declares each product's usage tiles as honest "absent" (value `null` → the
 *     view renders "—" with an "Awaiting metering" note), never fabricated.
 *
 * Per-kind tuning (nouns, usage-tile labels, the data-plane tool the console
 * defers to your client, quick-start snippets, onboarding bullets) lives in
 * `RESOURCE_SPECS`. The view is one renderer parameterized by the spec — so all
 * kinds look and behave the same, and a new managed kind is one spec entry.
 */
import type { Resource, ResourceKind } from '~/lib/api'
import type { Slice } from '~/components/ui/Charts'
import { toneVar } from '~/components/ui/tone-var'

// ── Lifecycle classification (mirrors ui/StatusTag toneOf, one truth) ─────────

const READY = ['ready', 'active', 'running', 'available', 'ok', 'green']
const PENDING = ['creating', 'provisioning', 'pending', 'updating', 'attaching', 'yellow']
const FAILED = ['error', 'failed', 'degraded', 'down', 'red']

export type Lifecycle = 'ready' | 'provisioning' | 'error' | 'other'

export function lifecycle(status?: string): Lifecycle {
  const s = (status ?? '').toLowerCase()
  if (READY.includes(s)) return 'ready'
  if (PENDING.includes(s)) return 'provisioning'
  if (FAILED.includes(s)) return 'error'
  return 'other'
}

export const isReady = (status?: string): boolean => lifecycle(status) === 'ready'

/** The `host:port` endpoint of a resource, or an honest "—" when absent. */
export const endpoint = (r: Resource): string => (r.host ? `${r.host}:${r.port}` : '—')

// ── Real fleet headline (derived from the list — never fabricated) ────────────

export type FleetStats = {
  total: number
  ready: number
  provisioning: number
  error: number
  /** ISO string of the earliest createdAt present, if any. */
  since?: string
}

export function fleetStats(rows: Resource[]): FleetStats {
  let ready = 0
  let provisioning = 0
  let error = 0
  let since: string | undefined
  for (const r of rows) {
    const l = lifecycle(r.status)
    if (l === 'ready') ready++
    else if (l === 'provisioning') provisioning++
    else if (l === 'error') error++
    if (r.createdAt && (!since || r.createdAt < since)) since = r.createdAt
  }
  return { total: rows.length, ready, provisioning, error, since }
}

/** Status-donut weights — the ONE console tone map, as CSS values (SVG can't read tokens). */
const STATUS_COLORS: Record<Exclude<Lifecycle, 'other'> | 'other', string> = {
  ready: toneVar('positive'),
  provisioning: toneVar('warning'),
  error: toneVar('critical'),
  other: toneVar('muted'),
}

/** The status breakdown as donut slices (only the non-zero buckets). */
export function statusSlices(rows: Resource[]): Slice[] {
  const s = fleetStats(rows)
  const other = s.total - s.ready - s.provisioning - s.error
  return (
    [
      { label: 'Ready', value: s.ready, color: STATUS_COLORS.ready },
      { label: 'Provisioning', value: s.provisioning, color: STATUS_COLORS.provisioning },
      { label: 'Error', value: s.error, color: STATUS_COLORS.error },
      { label: 'Other', value: other, color: STATUS_COLORS.other },
    ] as Slice[]
  ).filter((x) => x.value > 0)
}

/** Most-recently-created instances first (createdAt desc; undated sink to the end).
 *  createdAt is coerced with String() — a backend that returns a numeric epoch (the
 *  vector kind does) is NOT a string, and `?? ''` only guards null/undefined, so a
 *  raw `.localeCompare` on a number threw and crashed the whole module render. */
export function recent(rows: Resource[], n: number): Resource[] {
  return [...rows]
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
    .slice(0, n)
}

// ── Per-kind spec (data only — pure) ──────────────────────────────────────────

/** An honest usage metric — `null` value renders "—" until metering ships. */
export type UsageTile = { key: string; label: string }

/** A copy-pastable quick-start block (real REST contract + client connect). */
export type Snippet = { title: string; code: string }

/** The data-plane tool the mockups feature (Query/Browser/Explore) — deferred
 *  honestly to your client until the in-console editor ships. */
export type ToolSpec = { id: string; label: string; icon: string; blurb: string }

export type ResourceSpec = {
  /** Plural instance noun — the count tile, the instances tab, the table header. */
  listNoun: string
  /** Singular instance noun — the create button + detail copy. */
  instanceNoun: string
  /** The create CTA, e.g. "Create database". */
  createLabel: string
  /** Placeholder for the create name field. */
  namePlaceholder: string
  /** Lucide icon key (resolved to a component in the view, keeping this pure). */
  icon: string
  /** Honest usage tiles (always render "—" + "Awaiting metering" today). */
  usageTiles: UsageTile[]
  /** Onboarding guidance bullets for the empty state. */
  bullets: string[]
  /** Optional data-plane tool tab (honest "open in your client" surface). */
  tool?: ToolSpec
  /** One-line client connection hint (also used as the registry connectionHint). */
  connectHint: string
  /** Real connect command for the underlying engine (psql/redis-cli/…). */
  connectCmd: (host: string) => string
  /** The OSS source repo (org/name) backing the product. */
  repo: string
}

const cloud = 'https://cloud.hanzo.ai'

/** Public docs URL for a managed kind (matches the registry's `${DOCS}/<kind>`).
 * The docs site is served under the /docs base path, so the link must include it. */
export const docsUrl = (kind: ResourceKind): string => `https://docs.hanzo.ai/docs/${kind}`

/** GitHub URL for a spec's source repo. */
export const repoUrl = (spec: ResourceSpec): string => `https://github.com/${spec.repo}`

/** The provision-by-API block — identical contract for every kind. */
export function provisionSnippet(kind: ResourceKind, name: string): Snippet {
  return {
    title: 'Provision via API',
    code: `curl -X POST ${cloud}/v1/${kind} \\
  -H 'Content-Type: application/json' \\
  --cookie "$HANZO_SESSION" \\
  -d '{"name":"${name}"}'`,
  }
}

/** The connect block — the real client invocation + the credentials-once note. */
export function connectSnippet(spec: ResourceSpec, host: string): Snippet {
  return {
    title: 'Connect',
    code: `# ${spec.connectHint}
${spec.connectCmd(host)}`,
  }
}

/** Quick-start = provision + connect, personalised to the first instance if any. */
export function quickstart(
  kind: ResourceKind,
  spec: ResourceSpec,
  ctx: { firstName?: string; firstHost?: string },
): Snippet[] {
  const name = ctx.firstName ?? `my-${kind}`
  const host = ctx.firstHost ?? `${name}.${kind}.hanzo.ai:5432`
  return [provisionSnippet(kind, name), connectSnippet(spec, host)]
}

const COST = { key: 'cost', label: 'Cost (30d)' }
const STORAGE = { key: 'storage', label: 'Storage' }

export const RESOURCE_SPECS: Record<ResourceKind, ResourceSpec> = {
  sql: {
    listNoun: 'Databases',
    instanceNoun: 'database',
    createLabel: 'Create database',
    namePlaceholder: 'my-db',
    icon: 'Database',
    usageTiles: [{ key: 'tables', label: 'Tables' }, { key: 'rows', label: 'Rows' }, STORAGE, COST],
    bullets: [
      'Create a database, then connect any Postgres client with the connection string',
      'Branches and read replicas provision the same way — by name',
      'The password is shown once at create; store it in your secret manager',
    ],
    tool: { id: 'query', label: 'Query', icon: 'Terminal', blurb: 'Run SQL against a database from the console' },
    connectHint: 'Connect any SQL client with the connection string.',
    connectCmd: (host) => `psql "postgres://USER:PASSWORD@${host}/DBNAME?sslmode=require"`,
    repo: 'hanzoai/sql',
  },
  kv: {
    listNoun: 'Stores',
    instanceNoun: 'store',
    createLabel: 'New store',
    namePlaceholder: 'my-cache',
    icon: 'Key',
    usageTiles: [{ key: 'keys', label: 'Keys' }, STORAGE, { key: 'ops', label: 'Ops / sec' }, COST],
    bullets: [
      'Create a store, then connect with any RESP/Redis client using the connection string',
      'Use it as a cache, a session store, or a durable queue',
      'The password is shown once at create; store it in your secret manager',
    ],
    tool: { id: 'browser', label: 'Browser', icon: 'Boxes', blurb: 'Browse keys and values from the console' },
    connectHint: 'Connect with any KV client using the connection string.',
    connectCmd: (host) => `redis-cli -u "rediss://default:PASSWORD@${host}"`,
    repo: 'hanzoai/kv',
  },
  datastore: {
    listNoun: 'Datastores',
    instanceNoun: 'datastore',
    createLabel: 'Create datastore',
    namePlaceholder: 'my-analytics',
    icon: 'Server',
    usageTiles: [{ key: 'tables', label: 'Tables' }, { key: 'rows', label: 'Rows' }, STORAGE, COST],
    bullets: [
      'Create a datastore, then connect over the native/HTTP protocol with the connection string',
      'Built for wide-column OLAP — billions of rows, columnar scans',
      'The password is shown once at create; store it in your secret manager',
    ],
    tool: { id: 'query', label: 'Query', icon: 'Terminal', blurb: 'Run analytical SQL from the console' },
    connectHint: 'Connect over the Datastore HTTP/native protocol using the connection string.',
    connectCmd: (host) => `clickhouse-client --host ${host.split(':')[0]} --secure --password PASSWORD`,
    repo: 'hanzoai/datastore',
  },
  s3: {
    listNoun: 'Buckets',
    instanceNoun: 'bucket',
    createLabel: 'Create bucket',
    namePlaceholder: 'my-bucket',
    icon: 'HardDrive',
    usageTiles: [{ key: 'objects', label: 'Objects' }, STORAGE, { key: 'requests', label: 'Requests' }, COST],
    bullets: [
      'Create a bucket, then use it as an S3 endpoint with the access key and secret',
      'Any S3 SDK or the aws CLI works against the endpoint unchanged',
      'The secret key is shown once at create; store it in your secret manager',
    ],
    tool: { id: 'objects', label: 'Objects', icon: 'FileText', blurb: 'Browse objects and prefixes from the console' },
    connectHint: 'Use as an S3 endpoint with the access key/secret in the connection string.',
    connectCmd: (host) => `aws --endpoint-url https://${host.split(':')[0]} s3 ls s3://BUCKET`,
    repo: 'hanzoai/storage',
  },
  vector: {
    listNoun: 'Collections',
    instanceNoun: 'collection',
    createLabel: 'New collection',
    namePlaceholder: 'my-vectors',
    icon: 'Boxes',
    usageTiles: [{ key: 'vectors', label: 'Vectors' }, STORAGE, { key: 'queries', label: 'Queries' }, COST],
    bullets: [
      'Create a collection, then point any Vector client at host:port with the connection string',
      'Upsert embeddings and query by similarity — HNSW indexed',
      'The API key is shown once at create; store it in your secret manager',
    ],
    tool: { id: 'explore', label: 'Explore', icon: 'Search', blurb: 'Run a similarity search from the console' },
    connectHint: 'Point a Vector client at host:port using the connection string.',
    connectCmd: (host) => `curl https://${host.split(':')[0]}/collections -H "api-key: $HANZO_VECTOR_KEY"`,
    repo: 'hanzoai/vector',
  },
  docdb: {
    listNoun: 'Databases',
    instanceNoun: 'database',
    createLabel: 'Create database',
    namePlaceholder: 'my-docs',
    icon: 'FileText',
    usageTiles: [
      { key: 'collections', label: 'Collections' },
      { key: 'documents', label: 'Documents' },
      STORAGE,
      COST,
    ],
    bullets: [
      'Create a database, then connect with any MongoDB driver using the connection string',
      'Wire-compatible document storage on a managed backend',
      'The password is shown once at create; store it in your secret manager',
    ],
    tool: { id: 'browser', label: 'Browser', icon: 'Boxes', blurb: 'Browse collections and documents from the console' },
    connectHint: 'Connect with any DocDB driver using the connection string.',
    connectCmd: (host) => `mongosh "mongodb://USER:PASSWORD@${host}/?tls=true"`,
    repo: 'hanzoai/docdb',
  },
  search: {
    listNoun: 'Indexes',
    instanceNoun: 'index',
    createLabel: 'Create index',
    namePlaceholder: 'my-index',
    icon: 'Search',
    usageTiles: [{ key: 'documents', label: 'Documents' }, STORAGE, { key: 'queries', label: 'Queries' }, COST],
    bullets: [
      'Create an index, then use the Search host and key from the connection string',
      'Full-text and hybrid search over your documents',
      'The API key is shown once at create; store it in your secret manager',
    ],
    connectHint: 'Use the Search host + key from the connection string.',
    connectCmd: (host) => `curl https://${host.split(':')[0]}/indexes -H "Authorization: Bearer $HANZO_SEARCH_KEY"`,
    repo: 'hanzoai/search',
  },
}

export const specFor = (kind: ResourceKind): ResourceSpec => RESOURCE_SPECS[kind]
