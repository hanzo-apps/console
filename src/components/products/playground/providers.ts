/**
 * Provider cascade — group the model catalog by provider for the two-pane picker
 * (pick the PROVIDER first, then the MODEL within it).
 *
 * Pure + unit-tested so the ordering rules live in one place:
 *   - our own Zen group is pinned FIRST (it is the marquee), then providers by
 *     model count (desc), then alphabetically — the same intent as
 *     `aicatalog.groupByProvider`, over the already-normalized `ModelOption`s
 *     (whose `provider` is display-named, so "Hanzo" already reads "Zen").
 *   - within a provider, servable ("live") models sort first, then by name.
 * Search filters models across every provider and drops empty groups, so the
 * left rail only ever lists providers that actually have a match.
 */
import type { ModelOption } from './useModels'

/** A provider and its models, ready for the cascade's right pane. */
export type ProviderGroup = { provider: string; models: ModelOption[] }

/** Our own first-party group(s) — pinned to the top of the provider rail. */
const FIRST_PARTY = new Set(['zen', 'hanzo'])

const isFirstParty = (provider: string): boolean => FIRST_PARTY.has(provider.trim().toLowerCase())

/** Servable-first, then alphabetical — a stable, sensible model order. */
function sortModels(models: ModelOption[]): ModelOption[] {
  return [...models].sort(
    (a, b) => Number(b.available) - Number(a.available) || a.name.localeCompare(b.name),
  )
}

/** Zen first, then by model count (desc), then provider name (asc). */
function compareGroups(a: ProviderGroup, b: ProviderGroup): number {
  const az = isFirstParty(a.provider)
  const bz = isFirstParty(b.provider)
  if (az !== bz) return az ? -1 : 1
  return b.models.length - a.models.length || a.provider.localeCompare(b.provider)
}

/** Group options by provider for the cascade (Zen-first, count-desc). */
export function providerGroups(options: ModelOption[]): ProviderGroup[] {
  const by = new Map<string, ModelOption[]>()
  for (const o of options) {
    const provider = o.provider.trim() || 'Other'
    const arr = by.get(provider)
    if (arr) arr.push(o)
    else by.set(provider, [o])
  }
  const groups: ProviderGroup[] = Array.from(by, ([provider, models]) => ({
    provider,
    models: sortModels(models),
  }))
  return groups.sort(compareGroups)
}

/** Case-insensitive match of one option against a query (name / id / provider). */
export function matchOption(o: ModelOption, q: string): boolean {
  const t = q.trim().toLowerCase()
  if (!t) return true
  return (
    o.id.toLowerCase().includes(t) ||
    o.name.toLowerCase().includes(t) ||
    o.provider.toLowerCase().includes(t)
  )
}

/** Filter groups by a query, dropping providers with no matching model. */
export function filterGroups(groups: ProviderGroup[], q: string): ProviderGroup[] {
  if (!q.trim()) return groups
  const out: ProviderGroup[] = []
  for (const g of groups) {
    const models = g.models.filter((o) => matchOption(o, q))
    if (models.length) out.push({ provider: g.provider, models })
  }
  return out
}

/** Total model count across groups (the picker's "N models" labels). */
export function totalModels(groups: ProviderGroup[]): number {
  return groups.reduce((n, g) => n + g.models.length, 0)
}
