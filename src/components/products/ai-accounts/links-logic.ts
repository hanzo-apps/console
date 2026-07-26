/**
 * Pure presentation logic for the login-manager (Machines) tab — labels, usage
 * tones, formatting, and the roll-up summary. No React, no network: unit-tested in
 * isolation so the dashboard stays a thin renderer over real `/v1/links` data.
 */
import type { Device, Link, LinkKind, BillingMode } from '~/lib/api/links'
import { toneVar } from '~/components/ui/tone'

export const kindLabel = (kind: LinkKind): string => (kind === 'apikey' ? 'API key' : 'Subscription')

/** How this account's inference bills — the subscription-vs-api distinction, in words. */
export const billingLabel = (billing: BillingMode): string =>
  billing === 'plan' ? 'Billed to your plan' : 'Billed via credits'

/** Bar weight by remaining headroom: healthy → warning → exhausted. Greyscale by design. */
export const headroomTone = (remainingPct: number): string => {
  if (remainingPct > 50) return toneVar('positive')
  if (remainingPct > 15) return toneVar('warning')
  return toneVar('critical')
}

export const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`
export const pctText = (n?: number): string => (typeof n === 'number' && Number.isFinite(n) ? `${Math.round(n)}%` : '—')
export const compact = (n: number): string =>
  new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n)

/** The display title for an account row: the plan, else the account label, else the provider. */
export const accountTitle = (l: Link): string => l.plan?.trim() || l.account?.trim() || l.provider

/** Relative "time ago" for a last-seen timestamp; "—" when absent/unparseable. */
export function sinceText(iso?: string, now: number = Date.now()): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return '—'
  const s = Math.max(0, Math.floor((now - t) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export type LinkSummary = {
  devices: number
  accounts: number // linked accounts only
  subscriptions: number
  apikeys: number
  spendCents: number
  activeSessions: number
}

/** Roll up the device list into the KPI band. Only LINKED accounts count toward the
 *  active tallies; revoked accounts are retained in the list but excluded here. */
export function summarize(devices: Device[]): LinkSummary {
  const s: LinkSummary = { devices: 0, accounts: 0, subscriptions: 0, apikeys: 0, spendCents: 0, activeSessions: 0 }
  for (const d of devices) {
    const linked = d.accounts.filter((a) => a.status === 'linked')
    if (linked.length > 0) s.devices += 1
    s.activeSessions += d.activeSessions
    for (const a of linked) {
      s.accounts += 1
      if (a.kind === 'subscription') s.subscriptions += 1
      else s.apikeys += 1
      s.spendCents += a.usage?.spendCents ?? 0
    }
  }
  return s
}
