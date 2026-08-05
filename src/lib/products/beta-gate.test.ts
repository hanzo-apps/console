import { describe, expect, it } from 'vitest'

import { filterBeta, LAUNCH_PRODUCTS } from '~/lib/entitlements'

// We launch with hanzo.chat, hanzo.app and the console: the launch set is an
// ALLOW-LIST, so everything else is beta by default and a NEW catalog entry is
// hidden the day it lands. That default is the whole point — pin it.
describe('filterBeta — the launch gate', () => {
  const entries = [
    { id: 'chat' },
    { id: 'models' },
    { id: 'api-keys' },
    { id: 'beta-features' },
    { id: 'crm' },
    { id: 'gpus' },
    { id: 'lux-bridge' },
    { id: 'a-product-nobody-has-written-yet' },
  ]

  it('shows the launch set and hides everything else', () => {
    expect(filterBeta(entries, false, false).map((e) => e.id)).toEqual([
      'chat',
      'models',
      'api-keys',
      'beta-features',
    ])
  })

  it('a brand-new catalog entry is hidden by DEFAULT, not by remembering to stamp it', () => {
    const shown = filterBeta([{ id: 'something-new-2027' }], false, false)
    expect(shown).toEqual([])
  })

  it('the flag reveals everything; a superadmin never needed it', () => {
    expect(filterBeta(entries, true, false)).toHaveLength(entries.length)
    expect(filterBeta(entries, false, true)).toHaveLength(entries.length)
  })

  it('the beta door itself is in the launch set — otherwise nobody can opt in', () => {
    expect(LAUNCH_PRODUCTS).toContain('beta-features')
  })

  it('a stamped entry inside the launch set can still ship dark', () => {
    expect(filterBeta([{ id: 'chat', beta: true }], false, false)).toEqual([])
  })
})
