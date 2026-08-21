/**
 * The Hanzo capability catalog — a small, HONEST client-side map of the subsystem
 * ids the cloud actually mounts, used to tag a canvas node with the Hanzo
 * capability it is (e.g. this node is `/v1/provisioning/vector`, that one
 * `/v1/platform`).
 *
 * There is no runtime `/v1/subsystems` endpoint — the ids come off the node, and
 * the label and address are curated here. Each address is STATED, not derived from
 * the id: HIP-0139 gives a capability one head, and several ids answer under
 * another capability's (a SQL/vector/document store is provisioning's). An id with
 * no entry resolves to `null` and the node shows no capability chip rather than a
 * guess.
 */
export interface Capability {
  id: string
  label: string
  path: string
}

/** Every subsystem id a PaaS node can be, with the label and `/v1` address for it. */
const CAPABILITIES: Record<string, Omit<Capability, 'id'>> = {
  platform: { label: 'App Platform', path: '/v1/platform' },
  functions: { label: 'Functions', path: '/v1/functions' },
  agents: { label: 'Agents', path: '/v1/agents' },
  prompts: { label: 'Prompts', path: '/v1/prompts' },
  evals: { label: 'Evals', path: '/v1/evals' },
  ml: { label: 'ML', path: '/v1/ml' },
  exec: { label: 'Code Interpreter', path: '/v1/exec' },
  websearch: { label: 'Web Search', path: '/v1/websearch' },
  sql: { label: 'SQL', path: '/v1/provisioning/sql' },
  vector: { label: 'Vector', path: '/v1/provisioning/vector' },
  kv: { label: 'KV', path: '/v1/provisioning/kv' },
  datastore: { label: 'Datastore', path: '/v1/provisioning/datastore' },
  docdb: { label: 'DocDB', path: '/v1/provisioning/docdb' },
  search: { label: 'Search', path: '/v1/search' },
  s3: { label: 'Object Storage', path: '/v1/s3' },
  crm: { label: 'CRM', path: '/v1/crm' },
  team: { label: 'Team', path: '/v1/team' },
  git: { label: 'Git', path: '/v1/git' },
  tasks: { label: 'Tasks', path: '/v1/tasks' },
  templates: { label: 'Templates', path: '/v1/templates' },
  integrations: { label: 'Integrations', path: '/v1/integrations' },
  auto: { label: 'Automations', path: '/v1/auto' },
  notify: { label: 'Notify', path: '/v1/notify' },
  bot: { label: 'Bot', path: '/v1/bot' },
  security: { label: 'Security', path: '/v1/security' },
  knowledge: { label: 'Knowledge', path: '/v1/knowledge' },
}

/** The set of known capability ids (used for honest exact-match inference). */
export const CAPABILITY_IDS = new Set(Object.keys(CAPABILITIES))

/** Resolve a capability id → its `{id,label,path}`, or `null` when unknown. */
export function capabilityFor(id: string | undefined | null): Capability | null {
  if (!id) return null
  const key = id.toLowerCase()
  const c = CAPABILITIES[key]
  return c ? { id: key, ...c } : null
}

/**
 * Best-effort, HONEST inference of an app's Hanzo capability from its image repo
 * basename or slug — only an EXACT match to a known capability id counts (so an app
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
