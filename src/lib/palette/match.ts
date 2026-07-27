/**
 * Palette matching — ONE scorer for everything the command palette ranks.
 *
 * A query scores against a single haystack (`label sublabel keywords`) so a
 * resource is findable by its own name, its org/region, or a synonym. The ladder
 * is strict and non-overlapping, so an obvious hit always beats a clever one:
 *
 *   prefix       1000        "vol" → "Volumes"
 *   word-start   700…800     "prod" → "Delete prod-db"
 *   substring    400…500     "ume" → "Volumes"
 *   subsequence  1…300       "vlm" → "Volumes"
 *
 * The scan is plain `indexOf` — a query is NEVER compiled into a RegExp (user
 * input as a pattern is an injection + catastrophic-backtracking hazard).
 */

/** Characters that start a new "word" for word-start ranking. */
const WORD_BREAK = new Set([' ', '-', '_', '.', '/', ':', '(', '[', ','])

/** Anything the palette can rank. */
export type Matchable = { label: string; sublabel?: string; keywords?: string }

/** The single text a query is scored against. */
export const haystack = (m: Matchable): string =>
  `${m.label} ${m.sublabel ?? ''} ${m.keywords ?? ''}`.trim()

/** Score `query` against `text`; 0 = no match, higher = better. Empty query = 1. */
export function scoreMatch(query: string, text: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 1
  const t = text.toLowerCase()

  const idx = t.indexOf(q)
  if (idx === 0) return 1000
  if (idx > 0) {
    const base = WORD_BREAK.has(t[idx - 1]!) ? 800 : 500
    return base - Math.min(idx, 100)
  }

  // Subsequence: every char of q appears in order. Reward contiguity + early hits,
  // then cap below the substring floor so a real substring always wins.
  let ti = 0
  let score = 0
  let streak = 0
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found === -1) return 0
    streak = found === ti ? streak + 1 : 0
    score += 10 + streak * 5 - Math.min(found - ti, 8)
    ti = found + 1
  }
  return Math.min(Math.max(score, 1), 300)
}

/** Score a matchable against its full haystack. */
export const scoreItem = (query: string, m: Matchable): number => scoreMatch(query, haystack(m))

/**
 * The matching subset of `items`, best first. Ties keep input order (the index
 * tiebreak makes this stable on every engine, not just V8's stable sort), so a
 * list never reshuffles under the cursor while the same query stands.
 */
export function rank<T extends Matchable>(query: string, items: T[]): T[] {
  return items
    .map((item, i) => ({ item, i, s: scoreItem(query, item) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.item)
}

/**
 * Ranked, then re-ordered so every member of a group is contiguous — a group's
 * position is set by its best-ranked member. Lets the palette print one heading
 * per group while keeping rank order inside it.
 */
export function rankGrouped<T extends Matchable & { group: string }>(query: string, items: T[]): T[] {
  const groups = new Map<string, T[]>()
  for (const item of rank(query, items)) {
    const bucket = groups.get(item.group)
    if (bucket) bucket.push(item)
    else groups.set(item.group, [item])
  }
  return [...groups.values()].flat()
}
