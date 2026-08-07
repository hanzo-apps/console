/**
 * How the console names the org it is scoped to when no wider list is reachable.
 *
 * A regular user's cross-tenant list is admin-gated at the proxy and would 403,
 * so the honest answer is the one org they are already in, synthesized from the
 * session rather than fetched. `ContextSwitcher` renders this row directly.
 *
 * This file used to also build an `OrgState` for `@hanzo/iam`'s account control,
 * back when the account menu was the thing that switched tenant. Org and project
 * now condense into the top-left `ContextSwitcher`, and the account menu answers
 * only "who am I", so that adapter had no caller left and is gone rather than
 * kept warm. The invariant it existed to protect — that the ONE org switch is
 * `org-scope.switchOrg`, the seam tenant scoping and billing attribution hang
 * off — is now pinned directly, by `org-state.test.ts` scanning the source for a
 * second caller.
 */
import type { Organization } from '~/lib/api'

/** The scoped org as a row — the honest answer when no wider list is reachable. */
export function scopedOrgRow(name: string): Organization[] {
  if (!name) return []
  return [{ owner: 'admin', name, displayName: titleCase(name) } as Organization]
}

/** A slug as a name, without inventing one IAM did not give us. */
export function titleCase(name: string): string {
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : name
}

/**
 * What to CALL an org — its IAM display name when it has one, else its slug
 * titled. ONE rule, so the switcher's trigger, the row for that same org inside
 * it, and the rail's brand all say the same word. They used to disagree: the
 * trigger titled the slug and the rows printed it raw, so the control could read
 * "Acme" over an active row reading "acme".
 */
export function orgLabel(org: { name?: string; displayName?: string }): string {
  return org.displayName?.trim() || titleCase(org.name ?? '')
}

/**
 * The one-line summary the context switcher shows: the org, then the project
 * slice of it. Org-level scope has no project, and says so by omission rather
 * than by printing a placeholder.
 */
export function contextLabel(org: string, project?: string): string {
  return project ? `${org} / ${project}` : org
}
