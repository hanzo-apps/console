/**
 * A product's operations, read from the API describing itself.
 *
 * ONE source: `GET /v1/commands`, cloud's command projection of its own router — every
 * operation the API answers, reduced to the name it is addressed by, its method, path
 * and prose. Two properties make it the right door and not merely a convenient one:
 * cloud composes it from each subsystem's own registration, so an operation is in it
 * because it exists; and the `OperationID` is the op's IDENTITY — the same token the
 * description document's `operationId`, the agent tool's name and a direct call all use
 * — so a name taken from here is a name an agent can actually invoke.
 *
 * `Service` (the first non-version path segment) is how the projection files an op under
 * a product, so a product's surface is READ, never listed here. That is why adding a
 * product to the catalog yields its brief with nobody writing one.
 *
 * `index` is pure — the test feeds it a literal projection. `read` is the fetch, taken
 * at most once per session and only when someone asks for a brief: it is half a megabyte,
 * which is nothing to spend on a press and far too much to spend on a render.
 */
import { restGet, originV1Url } from '~/lib/api/client'

import type { Op } from './compose'

/** One row of the projection, as cloud serves it. */
type Command = {
  Service?: unknown
  Name?: unknown
  OperationID?: unknown
  Summary?: unknown
  Method?: unknown
  Path?: unknown
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** The `/v1/<head>` segment of a path, when it has one. */
const head = (path: string): string | undefined => {
  const seg = path.split('/').filter(Boolean)
  return seg[0] === 'v1' ? seg[1] : undefined
}

/**
 * Every operation the projection files under `id` — by its own `Service`, or by living
 * under `/v1/<id>` when a row carries no service. A product with neither gets none, and
 * the brief says so rather than inventing a path.
 */
export function index(list: unknown, id: string): Op[] {
  if (!Array.isArray(list)) return []
  const out: Op[] = []
  for (const row of list as Command[]) {
    if (!row || typeof row !== 'object') continue
    const path = str(row.Path)
    const method = str(row.Method)
    const name = str(row.OperationID)
    if (!path || !method || !name) continue
    if (str(row.Service) !== id && head(path) !== id) continue
    out.push({ name, method: method.toUpperCase(), path, summary: str(row.Summary) || undefined })
  }
  return out.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
}

/** The projection, in flight or in hand. Cleared on failure so a second press retries. */
let list: Promise<unknown> | null = null

/** Read the projection (once per session) and pull out one product's operations. */
export async function opsFor(id: string): Promise<Op[]> {
  list ??= restGet<unknown>(originV1Url('commands')).catch(() => {
    list = null
    // An unreachable projection is not a failed brief: the identity, the console
    // addresses and the projection's own address are all still true and still useful.
    return []
  })
  return index(await list, id)
}
