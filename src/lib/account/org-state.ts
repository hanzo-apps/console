/**
 * The org state an ADMIN console hands the shared account control.
 *
 * `@hanzo/iam`'s own `useOrganizations()` reads the caller's memberships off the
 * access token — right for every product, and structurally unable to express what
 * an admin console does: act in ANY tenant. `OrgState` is a plain interface, so
 * the console supplies its own rather than forking the control.
 *
 * A pure function on purpose. The one thing that must never drift is WHICH switch
 * runs: the console's `org-scope.switchOrg`, which persists the scope and reloads
 * so every module refetches under the new `X-Org-Id`. That is the single seam the
 * tenant scoping and its billing attribution hang off, and a second switch minted
 * here would silently bypass it. Passed through by reference, and pinned by a test.
 */
import type { OrgFinder, OrgState } from '@hanzo/iam/react'
import type { Organization } from '~/lib/api'

/** The scoped org as a row — the honest answer when no wider list is reachable. */
export function scopedOrgRow(name: string): Organization[] {
  if (!name) return []
  const displayName = name.charAt(0).toUpperCase() + name.slice(1)
  return [{ owner: 'admin', name, displayName } as Organization]
}

export function adminOrgState(input: {
  /** The org the console is currently acting in (`org-scope.currentOrg()`). */
  scoped: string
  /** The console's cross-tenant search, already gated to what the caller may see. */
  findOrgs: OrgFinder
  /** MUST be `org-scope.switchOrg` — never a switch invented here. */
  switchOrg: (org: string) => void
}): OrgState {
  const organizations = scopedOrgRow(input.scoped)
  return {
    organizations,
    roles: {},
    currentRole: null,
    currentOrg: organizations[0] ?? null,
    currentOrgId: input.scoped || null,
    switchOrg: input.switchOrg,
    // Projects are the top bar's concern (`ScopeSwitcher`), not the account
    // control's — one control per question, and no second project picker.
    projects: [],
    currentProject: null,
    currentProjectId: null,
    switchProject: () => {},
    isLoading: false,
    findOrgs: input.findOrgs,
  }
}
