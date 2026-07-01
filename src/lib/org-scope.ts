/**
 * Active org scope — which organization the console is currently acting in.
 *
 * Brand identity (which IAM you log into, the wordmark + logo) is fixed per host
 * and lives in `config`. The *data scope* is orthogonal: a global admin (e.g.
 * z@hanzo.ai) can point the console at ANY org's identity, secrets, and resources
 * without re-logging-in. That switch is this module's single concern.
 *
 * The scope defaults to the user's own brand org; the OrgSwitcher overrides it
 * (persisted in localStorage, browser-only). Every tenant-scoped call reads
 * `currentOrg()`: `client.ts` stamps it as `X-Org-Id`, and the IAM/KMS admin
 * modules pass it as the `owner`/`org` their server-gated proxy authorizes — a
 * global admin → any org; a brand admin is PINNED to their own org by the proxy,
 * so passing it is always safe (the proxy ignores a brand admin's request to
 * cross orgs).
 */
import { config } from '~/config'

const KEY = 'hanzo.console.org'         // explicit switcher override
const SESSION_KEY = 'hanzo.console.session-org' // the signed-in user's own org

/** THE global-admin org — a member of `admin` may act cross-tenant. Mirrors the
 * server admin-policy; a tenant member (owner=maxpower/…) is NEVER global. */
export const ADMIN_ORG = 'admin'

/** True when the account is a global (cross-tenant) admin — the ONLY principal
 * allowed to hit the admin-scoped IAM/overview/PaaS surfaces. A tenant member
 * (Dave in maxpower) is not, so the console must NOT call those for them. */
export function isGlobalAdmin(account: { owner?: string; isGlobalAdmin?: boolean } | null | undefined): boolean {
  return Boolean(account) && (account!.owner === ADMIN_ORG || account!.isGlobalAdmin === true)
}

/** Seed the signed-in user's own org as the scope default (called once the
 * session resolves). Persisted so reloads scope to the user's org immediately,
 * eliminating the brief wrong-org (brand-default) window. */
export function setSessionOrg(org: string): void {
  if (typeof window === 'undefined' || !org) return
  try { window.localStorage.setItem(SESSION_KEY, org) } catch { /* storage blocked */ }
}

function read(key: string): string {
  if (typeof window === 'undefined') return ''
  try { return window.localStorage.getItem(key) ?? '' } catch { return '' }
}

/** The org the console is currently scoped to: an explicit switcher override, else
 * the signed-in user's OWN org, else the brand org (pre-session / SSR fallback). */
export function currentOrg(): string {
  return read(KEY) || read(SESSION_KEY) || config.iamOrgName
}

/** Switch the active org scope. Passing the brand org clears the override. */
export function setCurrentOrg(org: string): void {
  if (typeof window === 'undefined') return
  try {
    if (!org || org === config.iamOrgName) window.localStorage.removeItem(KEY)
    else window.localStorage.setItem(KEY, org)
  } catch {
    // Storage blocked — the scope simply stays at the brand org.
  }
}

/** True when the console is scoped to a non-default (switched) org. */
export function isScopedAway(): boolean {
  return currentOrg() !== config.iamOrgName
}

/**
 * Switch the active org scope and hard-reload so every module refetches under the
 * new `X-Org-Id`. The ONE way the console changes org (used by the OrgSwitcher and
 * the command palette) — switching to the current org is a no-op.
 */
export function switchOrg(org: string): void {
  if (!org || org === currentOrg()) return
  setCurrentOrg(org)
  if (typeof window !== 'undefined') window.location.reload()
}

/** Case-insensitive filter over org name + display name (the switcher search). */
export function filterOrgs<T extends { name: string; displayName?: string }>(orgs: T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return orgs
  return orgs.filter(
    (o) => o.name.toLowerCase().includes(q) || (o.displayName ?? '').toLowerCase().includes(q),
  )
}
