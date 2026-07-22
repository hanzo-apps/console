/**
 * Workbench logic — the PURE half of the bottom Developers dock (parse a shell
 * command into a safe same-origin `/v1` read; render a response for the terminal).
 * No React/Gui/registry imports so it is node-testable in isolation.
 */

export type Command = { path: string } | { error: string }

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
/** Path charset — segments, query string; nothing that can smuggle a scheme/host. */
const PATH_OK = /^[A-Za-z0-9\-_./?=&%,:+]+$/

/**
 * Parse a workbench shell line into a `/v1`-relative GET path. Accepted forms:
 * `GET /v1/models` · `/v1/models` · `v1/models` · `models` (a bare head). The
 * shell is deliberately READ-ONLY (GET) — a mutation belongs in the product UI,
 * where it gets its confirm/undo affordances — and `/v1`-only (the one API root).
 */
export function parseCommand(input: string): Command {
  const words = input.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return { error: 'Enter a path — e.g. GET /v1/models' }
  let rest = words
  const head = words[0].toUpperCase()
  if (METHODS.has(head)) {
    if (head !== 'GET') return { error: 'The workbench shell is read-only — only GET is supported.' }
    rest = words.slice(1)
  }
  if (rest.length !== 1) return { error: 'One path per command — e.g. GET /v1/models' }
  if (/^([a-z][a-z0-9+.-]*:)?\/\//i.test(rest[0])) return { error: 'Only a /v1 path is allowed — e.g. /v1/models' }
  let path = rest[0].replace(/^\/+/, '')
  if (path === 'v1' || path === 'v1/') return { error: 'Name a resource — e.g. /v1/models' }
  if (path.startsWith('v1/')) path = path.slice(3)
  if (!path || !PATH_OK.test(path) || path.includes('..') || path.includes('//')) {
    return { error: 'Only a /v1 path is allowed — e.g. /v1/models' }
  }
  return { path }
}

/** Pretty-print a shell response, bounded so a huge payload never wedges the DOM. */
export function renderOutput(value: unknown, maxChars = 20000): string {
  let text: string
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    text = String(value)
  }
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n… (${text.length - maxChars} more characters truncated)`
}

// ── Inspector — route an object id to its `/v1` GET ───────────────────────────

/** A resolved inspect target (a same-origin `/v1` GET) or an honest parse error. */
export type InspectTarget = { path: string; kind: string; label: string } | { error: string }

/** The `hk-`/`sk-`/`pk-` credential prefixes — there is no GET-by-value, so they
 *  resolve to the account's key STATUS (never the secret). */
const KEY_PREFIXES = ['hk-', 'sk-', 'pk-']

/**
 * id-prefix → the `/v1` resource that owns it. The prefixes mirror the object ids
 * the platform mints (`agent_…`, `fn_…`, `flow_…`, `run_…`, `prompt_…`, `trace_…`);
 * each maps to the READ endpoint the console already speaks (agents/functions/
 * automations/prompts/o11y). One table, extended by adding a row — never a per-call
 * special case.
 */
const ID_ROUTES: { prefixes: string[]; kind: string; label: string; path: (id: string) => string }[] = [
  { prefixes: ['agent_', 'agt_'], kind: 'agent', label: 'Agent', path: (id) => `agents/${id}` },
  { prefixes: ['fn_', 'func_', 'function_'], kind: 'function', label: 'Function', path: (id) => `functions/${id}` },
  { prefixes: ['flow_'], kind: 'flow', label: 'Automation flow', path: (id) => `automations/flows/${id}` },
  { prefixes: ['run_'], kind: 'run', label: 'Automation run', path: (id) => `automations/runs/${id}` },
  { prefixes: ['prompt_', 'prm_'], kind: 'prompt', label: 'Prompt', path: (id) => `prompts/${id}` },
  { prefixes: ['trace_', 'tr_'], kind: 'trace', label: 'Trace', path: (id) => `o11y/traces/${id}` },
]

/**
 * Route an object id (or a bare `resource/name` path) to the same-origin `/v1` GET
 * that reads it. Recognizes the platform's id prefixes, the `hk-/sk-/pk-` key
 * prefixes (→ key status, never the secret), and a raw `resource/name` fallback so
 * any object addressable by path (`agents/my-agent`, `models/zen5`) is inspectable.
 * A URL or an unrecognized bare token is refused with an honest message — the
 * Inspector never guesses a wrong endpoint.
 */
export function inspectorRoute(input: string): InspectTarget {
  const id = input.trim()
  if (!id) return { error: 'Enter an object id — e.g. agent_… , fn_… , or a path like agents/<name>' }
  if (/^([a-z][a-z0-9+.-]*:)?\/\//i.test(id)) return { error: 'Enter an object id or a /v1 resource path — not a URL.' }
  const lower = id.toLowerCase()
  if (KEY_PREFIXES.some((p) => lower.startsWith(p))) return { path: 'iam/keys', kind: 'key', label: 'API key' }
  for (const r of ID_ROUTES) {
    if (r.prefixes.some((p) => lower.startsWith(p))) return { path: r.path(encodeURIComponent(id)), kind: r.kind, label: r.label }
  }
  // Fallback: a raw `resource/name` path (must contain a segment separator, be safe).
  const path = id.replace(/^\/+/, '').replace(/^v1\//, '')
  if (path.includes('/') && PATH_OK.test(path) && !path.includes('..') && !path.includes('//')) {
    return { path, kind: 'resource', label: 'Resource' }
  }
  return {
    error: 'Unrecognized id. Try agent_… , fn_… , flow_… , run_… , prompt_… , an hk-/sk-/pk- key, or a resource path like agents/<name>.',
  }
}

// ── Show code — the same read as curl / the Hanzo CLI ─────────────────────────

/** Normalize a workbench path (`/v1/x`, `v1/x`, `x`) to the bare resource `x`. */
const bareResource = (path: string): string => path.replace(/^\/+/, '').replace(/^v1\//, '')

/** The `curl` form of a `/v1` GET — the real request, keyed by the account's `hk-` key. */
export function curlFor(path: string, origin = 'https://api.hanzo.ai'): string {
  return `curl ${origin}/v1/${bareResource(path)} \\\n  -H "Authorization: Bearer $HANZO_API_KEY"`
}

/** The Hanzo CLI form of the same `/v1` GET. */
export function hanzoCli(path: string): string {
  return `hanzo api get /v1/${bareResource(path)}`
}

// ── Events — project the usage ledger into a platform-event stream ────────────

/** One platform event, projected from a real charged ledger row (never fabricated). */
export type PlatformEvent = { id: string; type: string; object: string; at: number | null; status: string; cents: number }

/** The minimal ledger-row shape the event projection reads (a `UsageRecord` subset). */
type EventSource = { id: string; requestId: string; model: string; product: string; agent: string; status: string; cents: number; at: number | null }

/**
 * Project the org's real usage/billing ledger into a platform-event stream —
 * newest first. Each metered call IS a platform event: an agent invocation →
 * `agent.run.*`, a plain call → `request.*`, refined by the real charged status.
 * Honest by construction: no ledger rows → `[]` (an org with no activity), and the
 * fields are the row's own id/model/status/cost — never a synthesized delivery.
 */
export function eventsFrom(records: EventSource[]): PlatformEvent[] {
  return records
    .map((r) => {
      const failed = r.status !== '' && r.status !== 'success'
      const type = r.agent
        ? failed
          ? 'agent.run.failed'
          : 'agent.run.succeeded'
        : failed
          ? 'request.failed'
          : 'request.succeeded'
      return {
        id: r.requestId || r.id,
        type,
        object: r.model || r.product || '—',
        at: r.at,
        status: r.status || (failed ? 'error' : 'success'),
        cents: r.cents,
      }
    })
    .sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity))
}
