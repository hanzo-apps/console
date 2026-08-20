/**
 * The Hanzo `/v1/<svc>` capability catalog — a small, HONEST client-side map of
 * the subsystem ids the cloud actually mounts (`hanzoai/cloud subsystems`), used
 * to tag a canvas node with the Hanzo capability it is (e.g. this node is
 * `/v1/vector`, that one `/v1/platform`).
 *
 * There is no runtime `/v1/subsystems` endpoint — the ids ARE the mount route
 * names, and human labels live only in the code. So this is a known, curated map
 * (not fabricated data); an id with no entry simply resolves to `null` and the
 * node shows no capability chip rather than a guess.
 */
export interface Capability {
  id: string
  label: string
  path: string
}

/** Curated labels for the user-facing `/v1/<id>` capabilities a PaaS node maps to. */
const LABELS: Record<string, string> = {
  platform: 'App Platform',
  functions: 'Functions',
  agents: 'Agents',
  prompts: 'Prompts',
  evals: 'Evals',
  ml: 'ML',
  exec: 'Code Interpreter',
  websearch: 'Web Search',
  sql: 'SQL',
  vector: 'Vector',
  kv: 'KV',
  search: 'Search',
  s3: 'Object Storage',
  datastore: 'Datastore',
  docdb: 'DocDB',
  analytics: 'Analytics',
  crm: 'CRM',
  cms: 'CMS',
  team: 'Team',
  git: 'Git',
  tasks: 'Tasks',
  templates: 'Templates',
  connectors: 'Connectors',
  automations: 'Automations',
  notify: 'Notify',
  bot: 'Bot',
  security: 'Security',
  knowledge: 'Knowledge',
}

/** The set of known capability ids (used for honest exact-match inference). */
export const CAPABILITY_IDS = new Set(Object.keys(LABELS))

/** Resolve a capability id → its `{id,label,path}`, or `null` when unknown. */
export function capabilityFor(id: string | undefined | null): Capability | null {
  if (!id) return null
  const key = id.toLowerCase()
  const label = LABELS[key]
  return label ? { id: key, label, path: `/v1/${key}` } : null
}

/**
 * Best-effort, HONEST inference of an app's Hanzo capability from its image repo
 * basename or slug — only an EXACT match to a known `/v1` id counts (so an app
 * literally deploying the `vector`/`search`/`functions` service is tagged), else
 * the app is simply the App Platform capability. Never a fuzzy guess.
 */
export function inferAppCapability(opts: { slug?: string; imageRepo?: string; name?: string }): Capability {
  const candidates = [opts.slug, opts.name, opts.imageRepo?.split('/').pop()]
    .filter((s): s is string => !!s)
    .map((s) => s.toLowerCase())
  for (const c of candidates) {
    if (c !== 'platform' && CAPABILITY_IDS.has(c)) return capabilityFor(c)!
  }
  return capabilityFor('platform')!
}
