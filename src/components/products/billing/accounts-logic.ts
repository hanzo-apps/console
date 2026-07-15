/**
 * Pure, unit-tested helpers for the Billing Accounts page — the "billing on the org,
 * overridden per project" surface. No React, no I/O.
 *
 * The ONE rule these encode: the console NEVER predicts the charge order. Commerce
 * resolves the payer (`resolveBilling`) and is the one source of truth for who pays,
 * so this module only computes the PRIORITY to write; the page then re-reads the
 * chain and renders whatever commerce actually resolved. A local re-sort would be a
 * second, divergent answer to the one question that must have exactly one — and it
 * would silently lie the moment commerce's ordering rule changes.
 *
 * Priorities are ANCHORED on the anchor's fixed 0 (commerce's `anchorPriority`): a
 * link placed above the anchor gets a NEGATIVE priority, which is exactly how an
 * explicit binding preempts the derived subject ("an explicit binding with a lower
 * Priority may still preempt it" — commerce/api/billing/resolve.go). The anchor
 * itself is derived, has no binding row, and is therefore never written.
 */
import type { BillingAccount, ChainLink, HolderKind } from '~/lib/api/billing-accounts'

/** A binding-priority write: the row to update, and the priority to set on it. */
export type PriorityWrite = { bindingId: string; priority: number }

/** Human label for what put an account in the chain. */
export function sourceLabel(link: ChainLink): string {
  switch (link.source) {
    case 'anchor':
      return 'Default account'
    case 'org':
      return 'Organization'
    case 'project':
      return `Project · ${link.holderId}`
    case 'user':
      return 'User'
  }
}

/** Why the link is where it is — the one-line explanation under its label. */
export function sourceHint(link: ChainLink): string {
  switch (link.source) {
    case 'anchor':
      return 'Derived from your billing subject — always present, cannot be detached.'
    case 'org':
      return 'Attached to the organization — applies to every project without its own override.'
    case 'project':
      return 'Attached to this project — overrides the organization default.'
    case 'user':
      return 'Attached to your user — your personal overflow.'
  }
}

/** The anchor is derived, not a row: it can be ordered around but never detached. */
export const isDetachable = (link: ChainLink): boolean => link.source !== 'anchor' && !!link.bindingId

/** True iff the link at `i` can move one step in `dir` (-1 up, 1 down) within `chain`. */
export function canMove(chain: ChainLink[], i: number, dir: -1 | 1): boolean {
  const j = i + dir
  return i >= 0 && i < chain.length && j >= 0 && j < chain.length
}

/**
 * The chain reordered by moving the link at `i` one step in `dir`. Pure — returns a
 * new array; an out-of-range move returns the input order unchanged.
 */
export function movedOrder(chain: ChainLink[], i: number, dir: -1 | 1): ChainLink[] {
  if (!canMove(chain, i, dir)) return chain
  const next = [...chain]
  const j = i + dir
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

/**
 * The priority each BINDING must carry to realize `order`, anchored on the anchor's
 * fixed 0: a link above the anchor goes negative, below goes positive. The anchor
 * itself is skipped (derived — no row to write). With no anchor present the order is
 * numbered from 0. Every link with a binding row gets a DISTINCT priority, so the
 * requested order never depends on commerce's tie-break.
 */
export function priorityPlan(order: ChainLink[]): PriorityWrite[] {
  const anchorAt = order.findIndex((l) => l.source === 'anchor')
  const base = anchorAt < 0 ? 0 : anchorAt
  return order
    .map((l, i) => ({ link: l, priority: i - base }))
    .filter(({ link }) => !!link.bindingId)
    .map(({ link, priority }) => ({ bindingId: link.bindingId as string, priority }))
}

/**
 * The MINIMAL set of writes that turns `chain` into `order` — the plan, minus every
 * binding already at its target priority. Nothing to move ⇒ no writes, so a no-op
 * drag costs no money-plane traffic.
 */
export function reorderWrites(chain: ChainLink[], order: ChainLink[]): PriorityWrite[] {
  const current = new Map(chain.filter((l) => l.bindingId).map((l) => [l.bindingId as string, l.priority]))
  return priorityPlan(order).filter((w) => current.get(w.bindingId) !== w.priority)
}

/**
 * The priority for a NEWLY attached account: one past the last link, so an attach
 * lands at the END of the chain (a fallback), never silently preempting the account
 * that pays today. Anchored the same way as `priorityPlan`.
 */
export function appendPriority(chain: ChainLink[]): number {
  const anchorAt = chain.findIndex((l) => l.source === 'anchor')
  const base = anchorAt < 0 ? 0 : anchorAt
  return chain.length - base
}

/** The accounts not already in `chain` — the only ones an attach picker should offer. */
export function attachable(accounts: BillingAccount[], chain: ChainLink[]): BillingAccount[] {
  const inChain = new Set(chain.map((l) => l.accountId))
  return accounts.filter((a) => !inChain.has(a.id))
}

/** The scope a chain/binding targets: the org, or one of its projects. */
export type ScopeTarget = { holderKind: HolderKind; project?: string }

/** The scope tab's label — the org default, or a named project override. */
export const scopeLabel = (t: ScopeTarget): string =>
  t.holderKind === 'project' && t.project ? t.project : 'Organization'

/** An account's display label — its name, else its id (never a fabricated name). */
export const accountLabel = (a: { displayName?: string; id: string }): string => a.displayName || a.id
