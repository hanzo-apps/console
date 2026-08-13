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
 *
 * Two-level model — the org VALUE (which org) and the SELECTION (has one been
 * chosen yet) are orthogonal. Every login lands org-LESS on the picker: the
 * selection flag is false, so `Scope` shows the org list even for a one-org
 * user (they click in). Entering an org (`enterOrg`) sets the value AND the flag
 * and drops into the scoped console; the sidebar "Home" affordance (`leaveOrg`)
 * clears the flag to de-scope back to the picker. `currentOrg()` stays the pure
 * value read that stamps `X-Org-Id` once entered.
 */
import { adminConsoleUrl, adminOrgName, config } from '~/config'

const KEY = 'hanzo.console.org'
/** Selection flag — '1' once an org has been explicitly ENTERED (picker → shell). */
const SELECTED_KEY = 'hanzo.console.org.selected'

/** Read a localStorage key, browser-only, null when blocked/SSR. */
function read(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Navigate to the console home, reloading so every module refetches under the
 *  active scope. The ONE way the two-level model changes level (enter/leave). */
function goHome(): void {
  if (typeof window !== 'undefined' && typeof window.location?.assign === 'function') {
    window.location.assign('/')
  }
}

/** The org the console is currently scoped to (default: the brand org). */
export function currentOrg(): string {
  const v = read(KEY)
  return v || config.iamOrgName
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
 * True once the user has EXPLICITLY entered an org (picker → scoped console).
 * False on a fresh login — so `Scope` shows the org picker instead of
 * auto-scoping, even for a one-org user. Orthogonal to the org VALUE.
 */
export function hasSelectedOrg(): boolean {
  return read(SELECTED_KEY) === '1'
}

/**
 * Enter an org from the picker: set the active scope AND mark it selected, then
 * drop into the scoped console home (reload refetches every module under the new
 * `X-Org-Id`). This is the "click an org card" transition.
 */
/**
 * The reserved admin org is not a scope a brand host can wear.
 *
 * SuperAdmin is resolved by authenticating INTO that org through the
 * `admin-console` app, which only `admin.<brand>` does. Stamping
 * `X-Org-Id: admin` here would ask the API to act as an org this session was
 * never issued for — the token's `owner` is the brand, and no header rewrites
 * that — so the switch would appear to work and every read would refuse. Handing
 * off to the admin console is the switch: it is where that identity is minted.
 *
 * Returns true when it took the navigation, so a caller stops.
 */
function handedOffToAdminConsole(org: string): boolean {
  if (org !== adminOrgName || typeof window === 'undefined') return false
  const url = adminConsoleUrl(window.location.host)
  if (!url) return false // already on the admin console — a normal scope switch
  window.location.assign(url)
  return true
}

export function enterOrg(org: string): void {
  if (!org) return
  if (handedOffToAdminConsole(org)) return
  setCurrentOrg(org)
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(SELECTED_KEY, '1')
    } catch {
      // Storage blocked — selection can't persist; the picker will reappear.
    }
  }
  goHome()
}

/**
 * Leave the current org (the sidebar "Home"/back affordance): clear the selection
 * so `Scope` returns to the picker, and reset the scope to the brand default so
 * no stale `X-Org-Id` lingers. Re-enter picks a fresh org.
 */
export function leaveOrg(): void {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(SELECTED_KEY)
    } catch {
      // Storage blocked — nothing to clear.
    }
  }
  setCurrentOrg(config.iamOrgName) // clears the override
  goHome()
}

/**
 * Switch the active org scope and hard-reload so every module refetches under the
 * new `X-Org-Id`. The in-shell quick-switch (OrgSwitcher / command palette): the
 * user is already ENTERED, so keep the selection flag set. Switching to the
 * current org is a no-op.
 */
export function switchOrg(org: string): void {
  if (!org || org === currentOrg()) return
  if (handedOffToAdminConsole(org)) return
  setCurrentOrg(org)
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(SELECTED_KEY, '1')
    } catch {
      // Storage blocked — the switch still takes effect for this load.
    }
    window.location.reload()
  }
}

/** Case-insensitive filter over org name + display name (the switcher search). */
export function filterOrgs<T extends { name: string; displayName?: string }>(orgs: T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return orgs
  return orgs.filter(
    (o) => o.name.toLowerCase().includes(q) || (o.displayName ?? '').toLowerCase().includes(q),
  )
}
