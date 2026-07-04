/**
 * Tenant view-model — the PURE composition that turns the three real backend
 * sources into ONE `Tenant` row + the reseller tree. No React, no network, no
 * config (unit-tested in isolation).
 *
 * A TENANT is an org in this white-label model. We compose:
 *   - IAM org (`IamAdminApi.organizations`) — name, displayName, logo, favicon,
 *     theme: the BRAND. This is the authoritative tenant list (all orgs).
 *   - Admin-cockpit customer (`AdminCockpitApi.customers`) — plan, status, wallet
 *     balance, spend, MRR, owner email, user count: the BILLING + lifecycle. Real
 *     cross-tenant data through the global-admin-gated aggregate.
 *   - Platform clusters (`PlatformApi` apps/clusters) — the tenant's dedicated
 *     cluster, if any: the DEPLOY TARGET.
 *
 * HONEST BY CONSTRUCTION: every field that a source doesn't answer stays undefined /
 * empty — the UI renders an em-dash, never a fabricated value. A tenant with no
 * cockpit row (an org that isn't a billing customer) still lists, with brand from
 * IAM and honest "—" for plan/wallet.
 *
 * RESELLER TREE: the platform has NO `parentOrgId` column yet (only `ownerId` +
 * `metadata`). So the tree is DERIVED honestly: an org whose owner email belongs to
 * ANOTHER tenant's owner is a sub-org of that tenant. Where the derivation can't
 * prove a parent, the org is a top-level tenant — we never fabricate a hierarchy.
 * A real `parentOrgId` (or `metadata.parentOrg`) is the foundation-phase follow-up
 * (see `parentHint`), and this function prefers it the moment it exists.
 */

/** The minimal IAM org shape this model needs (subset of `admin.ts` Organization). */
export type TenantOrgInput = {
  name: string
  displayName?: string
  logo?: string
  favicon?: string
  /** Free-form metadata; we read `parentOrg` from it when present (the follow-up). */
  metadata?: string | Record<string, unknown>
  /** IAM theme accent, when the org set one. */
  themeColor?: string
}

/** The minimal admin-cockpit customer shape this model needs (subset of `CustomerRow`). */
export type TenantCustomerInput = {
  org: string
  display?: string
  ownerEmail?: string
  plan?: string
  status?: string
  users?: number
  balanceCents?: number
  spendCents?: number
  mrrCents?: number
}

/** The minimal cluster shape this model needs (subset of platform `Cluster`). */
export type TenantClusterInput = {
  /** The org this cluster belongs to (platform scopes clusters by org). */
  org: string
  name: string
  region?: string
  status?: string
  phase?: string
}

/** A fully-composed tenant row. */
export type Tenant = {
  /** The org slug (IAM org name / cockpit org). The stable id. */
  org: string
  /** Display name (IAM displayName → cockpit display → org). */
  display: string
  /** Brand logo URL, when the org set one (else undefined → the H mark / initials). */
  logo?: string
  favicon?: string
  themeColor?: string
  /** Owner email (from the cockpit). */
  ownerEmail?: string
  /** Plan (from the cockpit), else undefined → "—". */
  plan?: string
  /** Lifecycle status: active | suspended | … (from the cockpit), else 'unknown'. */
  status: string
  /** User count (from the cockpit). */
  users?: number
  /** Wallet balance in USD cents (from the cockpit). */
  balanceCents?: number
  spendCents?: number
  mrrCents?: number
  /** The tenant's dedicated cluster name, if it has one (else undefined → shared). */
  cluster?: string
  clusterStatus?: string
  /** The derived parent tenant's org, when the tree could prove one (else undefined
   *  → top-level). NEVER fabricated. */
  parentOrg?: string
  /** How the parent was derived — for the honest "derived, not a real column" note.
   *  'metadata' = a real `parentOrg` in metadata (the follow-up landed); 'owner' =
   *  derived from a shared owner email; undefined = top-level. */
  parentHint?: 'metadata' | 'owner'
  /** True when this org is a billing customer (has a cockpit row) — vs. an org that
   *  only exists in IAM (brand only, no billing yet). */
  isCustomer: boolean
}

/** A node in the reseller tree — a tenant plus its sub-tenants. */
export type TenantNode = { tenant: Tenant; children: TenantNode[] }

// ── pure helpers ─────────────────────────────────────────────────────────────

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Parse an IAM org's metadata (string JSON or object) → a plain record. Never throws. */
export function parseMetadata(metadata: TenantOrgInput['metadata']): Record<string, unknown> {
  if (!metadata) return {}
  if (typeof metadata === 'object') return metadata
  try {
    const o = JSON.parse(metadata)
    return o && typeof o === 'object' ? (o as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** The explicit parent org from metadata (`parentOrg` / `parentOrgId`), if any — the
 *  real follow-up column, honored the moment it exists. */
function metadataParent(org: TenantOrgInput): string | undefined {
  const m = parseMetadata(org.metadata)
  const p = str(m.parentOrg) || str(m.parentOrgId)
  return p || undefined
}

/**
 * Compose ONE tenant from its three (optional) sources. Only `org` from IAM is
 * required; a missing cockpit/cluster leaves those fields honestly empty.
 */
export function composeTenant(
  org: TenantOrgInput,
  customer: TenantCustomerInput | undefined,
  cluster: TenantClusterInput | undefined,
): Tenant {
  const parentOrg = metadataParent(org)
  return {
    org: org.name,
    display: org.displayName || customer?.display || org.name,
    logo: org.logo || undefined,
    favicon: org.favicon || undefined,
    themeColor: org.themeColor || undefined,
    ownerEmail: customer?.ownerEmail || undefined,
    plan: customer?.plan || undefined,
    status: customer?.status || 'unknown',
    users: num(customer?.users),
    balanceCents: num(customer?.balanceCents),
    spendCents: num(customer?.spendCents),
    mrrCents: num(customer?.mrrCents),
    cluster: cluster?.name || undefined,
    clusterStatus: cluster?.phase || cluster?.status || undefined,
    parentOrg,
    parentHint: parentOrg ? 'metadata' : undefined,
    isCustomer: Boolean(customer),
  }
}

/**
 * Compose the full tenant list from the three source arrays. Keyed on the IAM org
 * name (the authoritative list); cockpit + clusters are joined by org. The FIRST
 * cluster for an org is taken as its primary (the platform reports ≤1 active).
 */
export function composeTenants(
  orgs: TenantOrgInput[],
  customers: TenantCustomerInput[],
  clusters: TenantClusterInput[],
): Tenant[] {
  const custByOrg = new Map(customers.map((c) => [c.org, c]))
  const clusterByOrg = new Map<string, TenantClusterInput>()
  for (const c of clusters) if (!clusterByOrg.has(c.org)) clusterByOrg.set(c.org, c)
  return orgs.map((o) => composeTenant(o, custByOrg.get(o.name), clusterByOrg.get(o.name)))
}

/**
 * Derive the reseller parent for each tenant, mutating in a copy. Precedence:
 *   1. A metadata `parentOrg` (the real follow-up) — already set by `composeTenant`.
 *   2. Owner-email inference: if a tenant's owner email is ANOTHER tenant's owner
 *      email AND that other tenant is a different org, this org is a sub-org of it.
 *      This only fires when an owner clearly owns multiple orgs — a signal, flagged
 *      as `parentHint:'owner'`, never presented as authoritative.
 *
 * Returns a new array (pure). Never creates a cycle (an org is never its own parent;
 * a would-be cycle is dropped).
 */
export function deriveResellerParents(tenants: Tenant[]): Tenant[] {
  // owner email → the org that owner FIRST appears as (its "home" org). We treat the
  // owner's first (alphabetical, stable) org as the reseller parent; its other orgs
  // become children. This is the honest owner-based heuristic.
  const byOwner = new Map<string, string[]>()
  for (const t of tenants) {
    if (!t.ownerEmail) continue
    const list = byOwner.get(t.ownerEmail) ?? []
    list.push(t.org)
    byOwner.set(t.ownerEmail, list)
  }
  const ownerHome = new Map<string, string>()
  for (const [email, orgList] of byOwner) {
    if (orgList.length > 1) ownerHome.set(email, [...orgList].sort()[0])
  }
  return tenants.map((t) => {
    if (t.parentOrg) return t // metadata parent wins, already set
    if (!t.ownerEmail) return t
    const home = ownerHome.get(t.ownerEmail)
    if (home && home !== t.org) return { ...t, parentOrg: home, parentHint: 'owner' as const }
    return t
  })
}

/**
 * Build the reseller tree from a flat tenant list (parents already derived). A
 * tenant with no `parentOrg` (or a parent that isn't in the list) is a root.
 * Children are sorted by display name; roots by whether they have children then name
 * (resellers first). Cycle-safe: a node is never its own descendant.
 */
export function buildResellerTree(tenants: Tenant[]): TenantNode[] {
  const byOrg = new Map(tenants.map((t) => [t.org, t]))
  const nodes = new Map<string, TenantNode>(tenants.map((t) => [t.org, { tenant: t, children: [] }]))
  const roots: TenantNode[] = []
  for (const t of tenants) {
    const node = nodes.get(t.org)!
    const parent = t.parentOrg && t.parentOrg !== t.org ? nodes.get(t.parentOrg) : undefined
    // Guard against a cycle: don't attach if the parent is already a descendant.
    if (parent && byOrg.has(t.parentOrg!) && !isDescendant(node, parent)) {
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }
  const sortChildren = (n: TenantNode) => {
    n.children.sort((a, b) => a.tenant.display.localeCompare(b.tenant.display))
    n.children.forEach(sortChildren)
  }
  roots.forEach(sortChildren)
  roots.sort((a, b) => {
    if ((b.children.length > 0 ? 1 : 0) !== (a.children.length > 0 ? 1 : 0)) {
      return (b.children.length > 0 ? 1 : 0) - (a.children.length > 0 ? 1 : 0)
    }
    return a.tenant.display.localeCompare(b.tenant.display)
  })
  return roots
}

/** True when `maybeChild` is `node` or already somewhere under it (cycle guard). */
function isDescendant(node: TenantNode, maybeChild: TenantNode): boolean {
  if (node === maybeChild) return true
  return node.children.some((c) => isDescendant(c, maybeChild))
}

/** Flatten a tree back to a depth-annotated list (for a flat indented table). */
export function flattenTree(nodes: TenantNode[], depth = 0): { tenant: Tenant; depth: number }[] {
  const out: { tenant: Tenant; depth: number }[] = []
  for (const n of nodes) {
    out.push({ tenant: n.tenant, depth })
    out.push(...flattenTree(n.children, depth + 1))
  }
  return out
}

/** True when ANY tenant's parent was derived from owner email (not a real column) —
 *  drives the honest "reseller tree is inferred; a real parentOrgId is the follow-up"
 *  banner. */
export function treeIsInferred(tenants: Tenant[]): boolean {
  return tenants.some((t) => t.parentHint === 'owner')
}

/** Case-insensitive filter over a tenant's org + display (the list search). */
export function filterTenants(tenants: Tenant[], query: string): Tenant[] {
  const q = query.trim().toLowerCase()
  if (!q) return tenants
  return tenants.filter((t) => t.org.toLowerCase().includes(q) || t.display.toLowerCase().includes(q))
}
