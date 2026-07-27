'use client'

/**
 * Org switcher — the hoisted `@hanzo/ui` shared-shell switcher (hanzoai/ui#36;
 * this console's switcher was its source), wired to THIS host's contract:
 *
 *  - scope   — `~/lib/org-scope` (the same orgScope contract, console keys).
 *  - orgs    — the lazy, server-paged cross-tenant IAM list
 *              (`IamAdminApi.organizations` via the gated `/admin/iam` proxy),
 *              injected ONLY for a super admin; a regular user sees their own
 *              org synthesized from the scope — never fabricated.
 *  - create  — the same-origin `/v1/iam/onboard` route (zero-org user →
 *              created + joined as admin; existing user → an additional org
 *              they're scope-switched into).
 *  - picker  — the "All organizations" de-scope row (`leaveOrg`).
 *
 * Selecting re-scopes IN PLACE (`switchOrg` persists + reloads so every module
 * refetches under the new `X-Org-Id`); the super-admin masquerade is unchanged.
 */
import { OrgSwitcher as Switcher, type Org, type OrgScope } from '@hanzo/ui/product'

import { useOrgIdentity } from '~/components/ui/BrandLogo'

import {
  currentOrg,
  enterOrg,
  hasSelectedOrg,
  isScopedAway,
  leaveOrg,
  setCurrentOrg,
  switchOrg,
} from '~/lib/org-scope'
import { ORG_PAGE_SIZE, orgQuery } from '~/lib/org-list'
import { IamAdminApi } from '~/lib/api'
import { v1Url } from '~/lib/api/client'
import { useIsSuperAdmin } from '~/lib/auth/admin'

/** The console's active-org contract, in the hoisted shape. */
const scope: OrgScope = {
  currentOrg,
  setCurrentOrg,
  isScopedAway,
  hasSelectedOrg,
  enterOrg,
  leaveOrg,
  switchOrg,
}

/** One page of the cross-tenant org list, mapped to the shared `Org` shape. */
async function orgPage(page: number, query: string): Promise<Org[]> {
  const res = await IamAdminApi.organizations(orgQuery(page, query))
  return (res.rows ?? []).map((o) => ({ name: o.name, displayName: o.displayName, logo: o.logo }))
}

/** Create an org through the same-origin onboard route → the new org's id. */
async function createOrg(name: string): Promise<string> {
  const res = await fetch(v1Url('iam/onboard'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  const data = (await res.json().catch(() => ({}))) as { org?: string; error?: string }
  if (!res.ok || !data.org) throw new Error(data.error || `Could not create organization (${res.status}).`)
  return data.org
}

export function OrgSwitcher() {
  // The admin-gated cross-tenant list fires ONLY for a super admin — a regular
  // user (who would 403 it) gets no loader and sees their current org alone.
  const isSuperAdmin = useIsSuperAdmin()
  // The SAME resolved org the chrome's top-left mark wears (one cached read), so
  // the two identity slots can never disagree — and a regular user, who has no
  // cross-tenant list to draw the current row from, still gets their own logo.
  const current = useOrgIdentity()
  return (
    <Switcher
      scope={scope}
      orgs={isSuperAdmin ? orgPage : undefined}
      pageSize={ORG_PAGE_SIZE}
      current={current}
      create={createOrg}
      picker
    />
  )
}
