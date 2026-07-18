/**
 * The money GRAPH — billing accounts, the bindings that attach them to a scope, and
 * the ordered chain a debit walks. The read side of "billing on the org, overridden
 * per project".
 *
 * Three primitives, mirroring commerce's own (hanzoai/commerce
 * `models/billingaccount`), so the console speaks the backend's vocabulary and
 * invents none of its own:
 *   - `BillingAccount` — a top-level, tenant-INDEPENDENT money-of-record. Many may
 *     exist. Its id is the ledger subject key; its balance is DERIVED from the
 *     append-only ledger, never a field.
 *   - `Binding` — `{holderKind ∈ {user,org,project}, holderId, accountId, priority}`.
 *     A holder may bind many accounts; an account may be bound by many holders. The
 *     row id is deterministic in the triple, so re-binding a pair UPSERTS.
 *   - the CHAIN — the ordered accounts commerce resolves for a scope
 *     (`resolveBilling`), charged first-first.
 *
 * ATTACH AND REORDER ARE THE SAME CALL. Because a binding's id is derived from
 * `(holderKind, holderId, accountId)`, re-binding an existing pair with a new
 * `priority` updates that one row in place. So there is no separate "reorder" verb —
 * reordering IS re-asserting the same fact at a different priority. One way to do it.
 *
 * The browser NEVER names a holder id (whose chain pays is a payer decision, not a
 * client claim): it names a holder KIND and, for a project, a project name; the
 * `/billing` proxy derives `holderId` from the session (`lib/server/billing-scope`
 * `holderIdFor`) and OVERWRITES whatever arrived, exactly as it already pins the
 * billing subject. The proxy also pins `X-Org-Id` from the session, and commerce
 * reads bindings inside that org's namespace — so a project label is tenant-confined
 * by construction.
 *
 * The CHAIN is READ from commerce, never computed here: commerce resolves the payer
 * at charge time and is the one source of truth for who pays. A console that
 * recomputed the order would be a second, divergent answer to the one question that
 * must have exactly one.
 *
 * Honest by construction: these endpoints are the Model B money-graph surface. Until
 * a deployment serves them the reads reject with an `ApiError` and the caller renders
 * the shared `BackendStateCard` — never a fabricated account, chain, or balance.
 */
import { restGet, restPost, restDelete, billingProxyV1Url } from './client'

/** The three holder classes an account binds to — commerce's vocabulary verbatim. */
export const HOLDER_KINDS = ['user', 'org', 'project'] as const
export type HolderKind = (typeof HOLDER_KINDS)[number]

/**
 * Why an account sits in a chain. `anchor` is not a holder: it is the DERIVED
 * subject commerce always charges (`BillingSubjectFor`), present with no binding row
 * behind it — so it can be reordered around but never detached.
 */
export type ChainSource = 'anchor' | HolderKind

/** A top-level money-of-record. Balance is DERIVED from the ledger — never a field. */
export type BillingAccount = {
  /** `acct_<hex>` — deliberately NOT derived from any tenant slug. The ledger subject key. */
  id: string
  /** Human label, when commerce reports one. */
  displayName?: string
  /** Ledger currency (lowercase ISO), e.g. `usd`. */
  currency?: string
  /** Payment provider backing the account (e.g. `square`), when reported. */
  provider?: string
}

/** One link in the resolved payer chain — the account, and WHY it is there. */
export type ChainLink = {
  /** The account charged at this position. */
  accountId: string
  /** What put it in the chain: the derived anchor, or a binding's holder class. */
  source: ChainSource
  /** The holder it is bound to (the org slug / billing subject / project name). */
  holderId: string
  /** Ascending — lower is charged first. */
  priority: number
  /** The binding row id (`bnd_…`). ABSENT for the anchor — it is derived, never a row. */
  bindingId?: string
  /** The account's label, when commerce joins it. */
  displayName?: string
  /** Derived ledger balance, USD cents — the capacity that decides who actually pays. */
  balanceCents?: number
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** Pull the first array found under any of the common envelope keys. */
const arrayUnder = (payload: unknown, keys: string[]): Record<string, unknown>[] => {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[]
  if (payload && typeof payload === 'object') {
    for (const k of keys) {
      const v = (payload as Record<string, unknown>)[k]
      if (Array.isArray(v)) return v as Record<string, unknown>[]
    }
  }
  return []
}

/** True iff `v` is one of commerce's holder classes (an unknown class is dropped, not guessed). */
const isHolderKind = (v: unknown): v is HolderKind =>
  typeof v === 'string' && (HOLDER_KINDS as readonly string[]).includes(v)

/** A chain link's source: the anchor, a known holder class, else `anchor` (a link with
 *  no binding row can only be the derived subject). */
const sourceOf = (r: Record<string, unknown>): ChainSource => {
  const raw = r.source ?? r.holderKind
  if (raw === 'anchor') return 'anchor'
  return isHolderKind(raw) ? raw : 'anchor'
}

/** Normalize commerce's accounts payload; a row with no id is dropped (never faked). */
export function normalizeAccounts(payload: unknown): BillingAccount[] {
  return arrayUnder(payload, ['accounts', 'data', 'rows', 'items'])
    .map((r) => ({
      id: str(r.id) ?? str(r.accountId) ?? '',
      displayName: str(r.displayName) ?? str(r.name),
      currency: str(r.currency),
      provider: str(r.providerType) ?? str(r.provider),
    }))
    .filter((a) => a.id !== '')
}

/**
 * Normalize commerce's resolved chain. Order is PRESERVED as commerce returned it —
 * commerce owns the charge order (`resolveBilling` sorts in Go so it is identical on
 * every backend), so re-sorting here would be a second answer to that one question.
 */
export function normalizeChain(payload: unknown): ChainLink[] {
  return arrayUnder(payload, ['chain', 'links', 'data', 'rows'])
    .map((r) => ({
      accountId: str(r.accountId) ?? str(r.id) ?? '',
      source: sourceOf(r),
      holderId: str(r.holderId) ?? '',
      priority: num(r.priority) ?? 0,
      bindingId: str(r.bindingId),
      displayName: str(r.displayName) ?? str(r.name),
      balanceCents: num(r.balanceCents) ?? num(r.balance),
    }))
    .filter((l) => l.accountId !== '')
}

/** The scope a chain is resolved for / a binding attaches to. `project` absent = org-level. */
export type BindTarget = {
  holderKind: HolderKind
  /** Required when `holderKind` is `project` — the project's name. */
  project?: string
}

export const BillingAccountApi = {
  /** The billing accounts the caller may draw on (proxy-scoped to their own tenant). */
  accounts: (): Promise<BillingAccount[]> =>
    restGet<unknown>(billingProxyV1Url('accounts')).then(normalizeAccounts),

  /**
   * The ORDERED chain commerce resolves for a scope — the account charged first,
   * first. `project` absent = the org-level chain. This is READ, never computed:
   * what it shows is what actually gets charged.
   */
  chain: (project?: string): Promise<ChainLink[]> => {
    const q = project ? `?project=${encodeURIComponent(project)}` : ''
    return restGet<unknown>(`${billingProxyV1Url('chain')}${q}`).then(normalizeChain)
  },

  /**
   * Attach `accountId` to a scope at `priority` — AND the reorder verb, since a
   * binding's id is deterministic in `(holderKind, holderId, accountId)`, so
   * re-binding an existing pair updates that row's priority in place.
   *
   * `holderId` is deliberately NOT sent: the proxy derives it from the session, so
   * the browser can never attach an account to another holder's chain.
   */
  bind: (target: BindTarget, accountId: string, priority: number): Promise<void> =>
    restPost(billingProxyV1Url('bindings'), {
      holderKind: target.holderKind,
      ...(target.project ? { project: target.project } : {}),
      accountId,
      priority,
    }).then(() => undefined),

  /** Detach a binding by its row id (from a chain link; the anchor has none). */
  unbind: (bindingId: string): Promise<void> =>
    restDelete(billingProxyV1Url(`bindings/${encodeURIComponent(bindingId)}`)),
}
