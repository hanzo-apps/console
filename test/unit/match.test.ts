import { describe, it, expect } from 'vitest'

import { matchRoute } from '~/lib/products/match'
import { findModule } from '~/lib/products/registry'

/**
 * The catch-all router resolves a URL slug to one module + route + params. This
 * is the ONLY routing logic in the console, so its contract is pinned here.
 */
describe('matchRoute', () => {
  it('returns null for an empty slug', () => {
    expect(matchRoute([])).toBeNull()
    expect(matchRoute([''])).toBeNull()
  })

  it('returns null for an unknown module', () => {
    expect(matchRoute(['does-not-exist'])).toBeNull()
    expect(matchRoute(['nope', 'x', 'y'])).toBeNull()
  })

  it('matches a module index route ("")', () => {
    const m = matchRoute(['providers'])
    expect(m).not.toBeNull()
    expect(m!.module.id).toBe('providers')
    expect(m!.route.path).toBe('')
    expect(m!.params).toEqual({})
  })

  it('captures a :name param', () => {
    const m = matchRoute(['providers', 'openai'])
    expect(m!.module.id).toBe('providers')
    expect(m!.route.path).toBe(':name')
    expect(m!.params).toEqual({ name: 'openai' })
  })

  it('captures the special "new" name for model create', () => {
    const m = matchRoute(['models', 'new'])
    expect(m!.module.id).toBe('models')
    expect(m!.params).toEqual({ name: 'new' })
  })

  it('captures a :tab param for tabbed modules (iam, settings, evals)', () => {
    expect(matchRoute(['iam', 'users'])!.params).toEqual({ tab: 'users' })
    expect(matchRoute(['settings', 'org'])!.params).toEqual({ tab: 'org' })
    expect(matchRoute(['evals', 'scores'])!.params).toEqual({ tab: 'scores' })
  })

  it('returns null when there are more segments than any route accepts', () => {
    // providers has '' and ':name' (1 extra segment max).
    expect(matchRoute(['providers', 'a', 'b'])).toBeNull()
  })

  it('does not resolve external (non-module) catalog ids as routes', () => {
    // `cost`/`gateway` are external surfaces, not in-console modules.
    expect(findModule('cost')).toBeUndefined()
    expect(matchRoute(['cost'])).toBeNull()
    expect(matchRoute(['gateway'])).toBeNull()
  })

  it('resolves every enabled in-console module index route', () => {
    // Smoke: each module is reachable at its index.
    for (const id of ['models', 'providers', 'chat', 'vector', 'sql', 'status']) {
      const m = matchRoute([id])
      expect(m, `module ${id} should resolve`).not.toBeNull()
      expect(m!.module.id).toBe(id)
    }
  })
})
