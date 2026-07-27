import { describe, expect, it, vi } from 'vitest'

import { adminOrgState, scopedOrgRow } from './org-state'
import { switchOrg } from '~/lib/org-scope'

describe('adminOrgState', () => {
  const findOrgs = async () => []

  it('switches through the console org scope and nothing else', () => {
    // THE money-path invariant. `org-scope.switchOrg` persists the scope and
    // reloads, so every module refetches under the new `X-Org-Id` — the one seam
    // tenant scoping and its billing attribution hang off. A switcher that minted
    // its own would bypass it silently, which is why this is an IDENTITY check and
    // not a behavioural one: there is one switch, and this is it.
    expect(adminOrgState({ scoped: 'hanzo', findOrgs, switchOrg }).switchOrg).toBe(switchOrg)
  })

  it('carries the cross-tenant search through untouched', () => {
    const state = adminOrgState({ scoped: 'hanzo', findOrgs, switchOrg })
    expect(state.findOrgs).toBe(findOrgs)
  })

  it('reports the scoped org as the current one', () => {
    const state = adminOrgState({ scoped: 'maxpower', findOrgs, switchOrg })
    expect(state.currentOrgId).toBe('maxpower')
    expect(state.currentOrg?.name).toBe('maxpower')
    expect(state.organizations.map((o) => o.name)).toEqual(['maxpower'])
  })

  it('is honest when nothing is scoped yet', () => {
    const state = adminOrgState({ scoped: '', findOrgs, switchOrg })
    expect(state.currentOrgId).toBeNull()
    expect(state.currentOrg).toBeNull()
    expect(state.organizations).toEqual([])
  })

  it('leaves projects to the scope switcher — no second project picker', () => {
    const state = adminOrgState({ scoped: 'hanzo', findOrgs, switchOrg })
    expect(state.projects).toEqual([])
    expect(state.currentProjectId).toBeNull()
  })

  it('titles a slug without inventing a display name', () => {
    expect(scopedOrgRow('acme').at(0)?.displayName).toBe('Acme')
    expect(scopedOrgRow('')).toEqual([])
  })

  it('never lists an org it was not given', () => {
    const spy = vi.fn(async () => [])
    const state = adminOrgState({ scoped: 'hanzo', findOrgs: spy, switchOrg })
    expect(state.organizations).toHaveLength(1)
    expect(spy).not.toHaveBeenCalled()
  })
})
