/**
 * status.hanzo.ai (Gatus) summary — PURE, no React/next imports.
 *
 * Collapses the full Gatus endpoint feed
 * (`GET https://status.hanzo.ai/api/v1/endpoints/statuses`, an array of
 * `{ key, name, group, results: [{ success, ... }] }`) into ONE overall verdict
 * for the console's global status badge. An endpoint's CURRENT health is the
 * `success` boolean of its LAST result (Gatus appends the newest result last);
 * no results ⇒ unknown, excluded from up/total.
 *
 * Parsed defensively (the feed is a third-party surface): anything that isn't a
 * well-formed endpoint row is skipped, and a non-array / garbage payload yields
 * `unknown` with an empty set — the badge degrades, never throws.
 */

export type Overall = 'operational' | 'degraded' | 'down' | 'unknown'

export type DownComponent = { name: string; group: string }

export type StatusSummary = {
  overall: Overall
  /** Number of endpoints with a current result (up or down). */
  total: number
  /** Number currently up. */
  up: number
  /** Currently-down components, for the panel. */
  down: DownComponent[]
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/** Current up/down of one endpoint, or null when it has no results yet. */
function currentUp(ep: Record<string, unknown>): boolean | null {
  const results = ep.results
  if (!Array.isArray(results) || results.length === 0) return null
  const last = results[results.length - 1]
  if (!isRecord(last)) return null
  return last.success === true
}

export function summarizeStatuses(raw: unknown): StatusSummary {
  if (!Array.isArray(raw)) return { overall: 'unknown', total: 0, up: 0, down: [] }

  let up = 0
  let total = 0
  const down: DownComponent[] = []

  for (const ep of raw) {
    if (!isRecord(ep)) continue
    const state = currentUp(ep)
    if (state === null) continue // no results yet — not counted
    total += 1
    if (state) {
      up += 1
    } else {
      down.push({
        name: typeof ep.name === 'string' ? ep.name : '',
        group: typeof ep.group === 'string' ? ep.group : '',
      })
    }
  }

  let overall: Overall
  if (total === 0) overall = 'unknown'
  else if (down.length === 0) overall = 'operational'
  else if (up === 0) overall = 'down'
  else overall = 'degraded'

  return { overall, total, up, down }
}
