/**
 * The brief — the compact context you hand someone (or something) about to act on a
 * product. Plain markdown, so it pastes into any agent unchanged.
 *
 * PURE and PER-PRODUCT-BLIND: every line is a fact already in hand — the product's own
 * catalog record, the console addresses the router already computes, and operations
 * READ from the API's own served description. There is no per-product string here and
 * there must never be one: adding a product to the catalog yields its brief for free.
 *
 * Nothing is invented. No operations ⇒ no operations section, just the address of the
 * description document. No parameter-free read ⇒ no example. That honesty is the whole
 * value: an agent that trusts the brief must never be handed a path that does not exist.
 *
 * It carries NO credential — not a token, not a key, not a KMS path. Auth is named as a
 * bearer the reader mints for themselves, and the mint is IAM's job, never the brief's.
 */

/** One operation, exactly as the API's own command projection reports it. */
export type Op = {
  /** The operation's identity — the one token a call, a tool and the docs all use. */
  name: string
  method: string
  path: string
  summary?: string
}

/** Everything the brief says about one product. Assembled by the caller; never stored. */
export type Subject = {
  /** Stable id — also the console path segment and the description's tag. */
  id: string
  label: string
  description: string
  category: string
  /** Console address, e.g. `/dns`. */
  route: string
  /** Sub-page labels, in nav order. */
  pages: readonly string[]
  /** Canonical docs deep link, when the record carries one. */
  docs?: string
  /** API root, e.g. `https://api.hanzo.ai`. */
  base: string
  /** Derived from the ONE description document; empty when this surface publishes none. */
  ops: readonly Op[]
}

/**
 * The catalog facts a brief needs — structurally what every module entry already
 * carries, so this reads ANY entry and branches on none of them. It is stated as its
 * own shape rather than importing the catalog because the catalog is a React module.
 */
export type Entry = {
  id: string
  label: string
  description: string
  category: string
  docs?: string
}

/** One catalog entry + what the router and the description know → the brief's subject. */
export const subjectOf = (
  e: Entry,
  pages: readonly string[],
  base: string,
  ops: readonly Op[],
): Subject => ({
  id: e.id,
  label: e.label,
  description: e.description,
  category: e.category,
  route: `/${e.id}`,
  pages,
  docs: e.docs,
  base,
  ops,
})

/** How many operations a brief spells out before it summarizes the rest. */
export const CAP = 40

/** The console page that mints the bearer the brief tells you to send. */
const KEYS = '/api-keys'

/** Where the API describes itself — the brief's own source, named so it can be re-read. */
const PROJECTION = '/v1/openapi/commands'

/** True when a path addresses a specific thing the brief has no value for. */
const parameterized = (path: string): boolean => /[:{]/.test(path)

/**
 * A copy-paste read, taken from the product's own operations rather than composed.
 *
 * The pick is the shortest parameter-free GET: no placeholder to fill in and no body to
 * guess, so it runs as written. A product that publishes no such read gets no example —
 * a curl with an invented path or body is a lie an agent would act on.
 */
export function example(base: string, ops: readonly Op[]): string | undefined {
  const pick = ops
    .filter((o) => o.method === 'GET' && !parameterized(o.path))
    .sort((a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path))[0]
  if (!pick) return undefined
  return `curl -s ${base}${pick.path} \\\n  -H "Authorization: Bearer $TOKEN"`
}

/** One operation: the name to call it by first, because that is what an agent needs. */
const line = (o: Op): string =>
  `- \`${o.name}\` — \`${o.method} ${o.path}\`${o.summary ? ` — ${o.summary}` : ''}`

/** The brief for one product, as markdown. */
export function compose(s: Subject): string {
  const out: string[] = [`# ${s.label}`, ``, s.description, ``]

  out.push(`- Console: \`${s.route}\`${s.pages.length ? ` — ${s.pages.join(' · ')}` : ''}`)
  out.push(`- Category: ${s.category}`)
  if (s.docs) out.push(`- Docs: ${s.docs}`)

  out.push(``, `## API`, ``)
  // The base carries no version segment: every operation below prints its own
  // absolute path, so joining the two as written must not yield /v1/v1.
  out.push(`- Base: \`${s.base}\` — the operation paths below are absolute.`)
  out.push(`- Auth: \`Authorization: Bearer <your token>\` — mint one in the console at \`${KEYS}\`.`)
  out.push(`- Every operation: ${s.base}${PROJECTION} (service \`${s.id}\`)`)

  if (s.ops.length === 0) {
    out.push(``, `This surface answers no operations under \`/v1/${s.id}\` — it is a console view.`)
    return out.join('\n')
  }

  // The name leads each line because it is the operation's identity everywhere: a
  // direct call, an agent tool, and the docs all address it by exactly this token.
  out.push(``, `### Operations (${s.ops.length})`, ``, `Each is addressed by its name.`, ``)
  for (const o of s.ops.slice(0, CAP)) out.push(line(o))
  if (s.ops.length > CAP) out.push(`- … ${s.ops.length - CAP} more at ${s.base}${PROJECTION}`)

  const curl = example(s.base, s.ops)
  if (curl) out.push(``, `### Example`, ``, '```sh', curl, '```')

  return out.join('\n')
}
