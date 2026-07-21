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
