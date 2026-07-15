import { describe, it, expect } from 'vitest'

import {
  accountLabel,
  appendPriority,
  attachable,
  canMove,
  isDetachable,
  movedOrder,
  priorityPlan,
  reorderWrites,
  scopeLabel,
  sourceHint,
  sourceLabel,
} from './accounts-logic'
import type { ChainLink } from '~/lib/api/billing-accounts'

/**
 * The payer chain's ordering math. The invariant under test: the console computes
 * only the PRIORITY to write — commerce resolves the order. So these assert on the
 * WRITES produced, never on a locally re-sorted chain.
 */

const link = (p: Partial<ChainLink> & Pick<ChainLink, 'accountId' | 'source'>): ChainLink => ({
  holderId: '',
  priority: 0,
  ...p,
})

/** A realistic chain: a project override, the derived anchor, then an org fallback. */
const chain = (): ChainLink[] => [
  link({ accountId: 'acct_proj', source: 'project', holderId: 'apollo', priority: -1, bindingId: 'bnd_p' }),
  link({ accountId: 'acct_anchor', source: 'anchor', holderId: 'maxpower', priority: 0 }),
  link({ accountId: 'acct_org', source: 'org', holderId: 'maxpower', priority: 1, bindingId: 'bnd_o' }),
]

describe('sourceLabel / sourceHint — every chain link says WHY it is there', () => {
  it('names each holder class (a project link carries its project name)', () => {
    expect(sourceLabel(link({ accountId: 'a', source: 'anchor' }))).toBe('Default account')
    expect(sourceLabel(link({ accountId: 'a', source: 'org' }))).toBe('Organization')
    expect(sourceLabel(link({ accountId: 'a', source: 'project', holderId: 'apollo' }))).toBe('Project · apollo')
    expect(sourceLabel(link({ accountId: 'a', source: 'user' }))).toBe('User')
  })

  it('explains the project override and the org default distinctly', () => {
    expect(sourceHint(link({ accountId: 'a', source: 'project' }))).toContain('overrides the organization')
    expect(sourceHint(link({ accountId: 'a', source: 'org' }))).toContain('every project')
  })
})

describe('isDetachable — the anchor is derived, never a row', () => {
  it('refuses to detach the anchor (no binding behind it)', () => {
    expect(isDetachable(link({ accountId: 'a', source: 'anchor' }))).toBe(false)
  })
  it('allows detaching a real binding', () => {
    expect(isDetachable(link({ accountId: 'a', source: 'org', bindingId: 'bnd_o' }))).toBe(true)
  })
  it('refuses a holder link that carries no binding id (nothing to delete)', () => {
    expect(isDetachable(link({ accountId: 'a', source: 'org' }))).toBe(false)
  })
})

describe('canMove / movedOrder', () => {
  it('refuses to move the first link up or the last link down', () => {
    const c = chain()
    expect(canMove(c, 0, -1)).toBe(false)
    expect(canMove(c, c.length - 1, 1)).toBe(false)
    expect(canMove(c, 1, -1)).toBe(true)
  })

  it('swaps neighbours and leaves the input untouched (pure)', () => {
    const c = chain()
    const out = movedOrder(c, 2, -1) // org moves above the anchor
    expect(out.map((l) => l.accountId)).toEqual(['acct_proj', 'acct_org', 'acct_anchor'])
    expect(c.map((l) => l.accountId)).toEqual(['acct_proj', 'acct_anchor', 'acct_org']) // unmutated
  })

  it('returns the order unchanged for an out-of-range move', () => {
    const c = chain()
    expect(movedOrder(c, 0, -1)).toBe(c)
  })
})

describe('priorityPlan — priorities are ANCHORED on the anchor’s fixed 0', () => {
  it('gives a link above the anchor a NEGATIVE priority (how a binding preempts the anchor)', () => {
    // commerce: anchorPriority = 0, "an explicit binding with a lower Priority may
    // still preempt it". A plan that numbered from 0 could never preempt the anchor.
    const plan = priorityPlan(chain())
    expect(plan).toEqual([
      { bindingId: 'bnd_p', priority: -1 },
      { bindingId: 'bnd_o', priority: 1 },
    ])
  })

  it('never writes the anchor (it is derived — there is no row)', () => {
    expect(priorityPlan(chain()).some((w) => w.bindingId === undefined)).toBe(false)
    expect(priorityPlan(chain())).toHaveLength(2) // 3 links, 2 rows
  })

  it('re-anchors after a move: promoting the org above the anchor makes it negative', () => {
    const plan = priorityPlan(movedOrder(chain(), 2, -1))
    // order: proj, org, anchor → base = 2 → proj -2, org -1
    expect(plan).toEqual([
      { bindingId: 'bnd_p', priority: -2 },
      { bindingId: 'bnd_o', priority: -1 },
    ])
  })

  it('numbers from 0 when no anchor is present', () => {
    const noAnchor = [
      link({ accountId: 'a', source: 'org', priority: 9, bindingId: 'bnd_a' }),
      link({ accountId: 'b', source: 'user', priority: 9, bindingId: 'bnd_b' }),
    ]
    expect(priorityPlan(noAnchor)).toEqual([
      { bindingId: 'bnd_a', priority: 0 },
      { bindingId: 'bnd_b', priority: 1 },
    ])
  })

  it('gives every binding a DISTINCT priority (the order never rides commerce’s tie-break)', () => {
    const ps = priorityPlan(chain()).map((w) => w.priority)
    expect(new Set(ps).size).toBe(ps.length)
  })
})

describe('reorderWrites — the MINIMAL write set', () => {
  it('emits NO writes when nothing moved (a no-op costs no money-plane traffic)', () => {
    const c = chain()
    expect(reorderWrites(c, c)).toEqual([])
  })

  it('emits only the bindings whose priority actually changed', () => {
    const c = chain()
    // Move the org (priority 1) above the anchor → order proj, org, anchor.
    const writes = reorderWrites(c, movedOrder(c, 2, -1))
    // proj moves -1 → -2 and org 1 → -1: both changed, so both are written.
    expect(writes).toEqual([
      { bindingId: 'bnd_p', priority: -2 },
      { bindingId: 'bnd_o', priority: -1 },
    ])
  })

  it('skips a binding already at its target priority', () => {
    // A two-link chain where the anchor leads: the org binding is already at +1.
    const c = [
      link({ accountId: 'acct_anchor', source: 'anchor', priority: 0 }),
      link({ accountId: 'acct_org', source: 'org', priority: 1, bindingId: 'bnd_o' }),
    ]
    expect(reorderWrites(c, c)).toEqual([])
  })
})

describe('appendPriority — an attach lands at the END, never preempting today’s payer', () => {
  it('is one past the last link, anchored on the anchor', () => {
    // chain: proj(-1), anchor(0), org(1) → anchor at index 1 → append = 3 - 1 = 2.
    expect(appendPriority(chain())).toBe(2)
  })

  it('is strictly greater than every planned priority (a new account never jumps the queue)', () => {
    const p = appendPriority(chain())
    for (const w of priorityPlan(chain())) expect(p).toBeGreaterThan(w.priority)
  })

  it('is 0 for an empty chain (the first account attached leads)', () => {
    expect(appendPriority([])).toBe(0)
  })
})

describe('attachable — the picker only offers accounts not already in the chain', () => {
  it('excludes every account already in the chain (no duplicate binding)', () => {
    const accounts = [{ id: 'acct_anchor' }, { id: 'acct_org' }, { id: 'acct_new', displayName: 'Overflow' }]
    expect(attachable(accounts, chain()).map((a) => a.id)).toEqual(['acct_new'])
  })

  it('offers everything when the chain is empty', () => {
    expect(attachable([{ id: 'a' }, { id: 'b' }], [])).toHaveLength(2)
  })
})

describe('labels', () => {
  it('scopeLabel names the project for a project scope, else Organization', () => {
    expect(scopeLabel({ holderKind: 'project', project: 'apollo' })).toBe('apollo')
    expect(scopeLabel({ holderKind: 'org' })).toBe('Organization')
  })

  it('accountLabel falls back to the id — never a fabricated name', () => {
    expect(accountLabel({ id: 'acct_x' })).toBe('acct_x')
    expect(accountLabel({ id: 'acct_x', displayName: 'Ops card' })).toBe('Ops card')
  })
})
