import { describe, it, expect } from 'vitest'

import type { Taxon } from '~/lib/api/taxonomy'
import { join, group, editable, PLATFORM_ORG } from './catalogue'

/**
 * The join between the taxonomy service and the compiled registry.
 *
 * These prove the properties a live migration actually breaks — a stale service
 * silently removing products, a retired grouping coming back over the wire, and
 * the one that matters most: deciding editability from the row's own `owner`
 * rather than from having asked nicely.
 */

type Cat = 'AI' | 'Apps' | 'Observe'

const KNOWN: Record<string, Cat> = { ai: 'AI', apps: 'Apps', observe: 'Observe' }
const known = (id: string): Cat | null => KNOWN[id] ?? null

const local = (id: string, label: string, category: Cat) => ({
  id,
  label,
  description: `${label} compiled`,
  category,
})

const taxon = (over: Partial<Taxon> & { id: string }): Taxon => ({
  owner: PLATFORM_ORG,
  name: over.id,
  description: '',
  category: 'ai',
  order: 0,
  published: true,
  ...over,
})

describe('the service supplies what a person maintains', () => {
  it('takes the name, description, tags and category from the row', () => {
    const [j] = join(
      [taxon({ id: 'vector', name: 'Vector', description: 'Managed vectors', category: 'apps', tags: ['db'] })],
      [local('vector', 'Compiled Vector', 'AI')],
      known,
    )
    expect(j.label).toBe('Vector')
    expect(j.description).toBe('Managed vectors')
    expect(j.category).toBe('Apps')
    expect(j.tags).toEqual(['db'])
    // …while the compiled entry rides along, because the routes are on it.
    expect(j.entry.id).toBe('vector')
  })

  it('keeps the compiled copy where the row leaves a field empty', () => {
    const [j] = join([taxon({ id: 'vector', name: '', description: '' })], [local('vector', 'Vector', 'AI')], known)
    expect(j.label).toBe('Vector')
    expect(j.description).toBe('Vector compiled')
  })

  it('orders by the service, which is where order is now edited', () => {
    const joined = join(
      [taxon({ id: 'b', category: 'ai' }), taxon({ id: 'a', category: 'ai' })],
      [local('a', 'A', 'AI'), local('b', 'B', 'AI')],
      known,
    )
    expect(joined.map((j) => j.entry.id)).toEqual(['b', 'a'])
  })
})

describe('a disagreement between the two halves never loses a product', () => {
  // The failure this exists for: the service's copy of the catalogue is older
  // than the bundle, and repointing the nav at it takes working products off it.
  it('still renders a product the service has never heard of', () => {
    const joined = join([taxon({ id: 'vector' })], [local('vector', 'Vector', 'AI'), local('tel', 'Tel', 'Apps')], known)
    expect(joined.map((j) => j.entry.id).sort()).toEqual(['tel', 'vector'])
    const tel = joined.find((j) => j.entry.id === 'tel')!
    expect(tel.label).toBe('Tel')
    // Nothing to edit: the service carries no row for it.
    expect(tel.owner).toBeNull()
  })

  it('files a product under the local category when the service names a retired one', () => {
    // `training` was folded into AI here and still exists there. The fold must not
    // reverse just because the older name arrived over the wire.
    const [j] = join([taxon({ id: 'tune', category: 'training' })], [local('tune', 'Fine-tuning', 'AI')], known)
    expect(j.category).toBe('AI')
  })

  it('does not render a row this build has no module for', () => {
    // A nav item that leads to a 404 is worse than one that is absent.
    expect(join([taxon({ id: 'records', route: '/records' })], [], known)).toEqual([])
  })
})

describe('editability is read off the row, not asked for', () => {
  it('lets an org edit its own row and not the platform', () => {
    expect(editable('acme', 'acme')).toBe(true)
    expect(editable(PLATFORM_ORG, 'acme')).toBe(false)
  })

  it('refuses a row belonging to another tenant', () => {
    // The service never serves globex's rows to acme; if one ever arrived, it is
    // still not acme's to change.
    expect(editable('globex', 'acme')).toBe(false)
  })

  it('refuses everything when signed out, and anything the service did not carry', () => {
    expect(editable(PLATFORM_ORG, null)).toBe(false)
    expect(editable(null, 'acme')).toBe(false)
  })

  it('carries the owner through the join so one read answers it', () => {
    const joined = join(
      [taxon({ id: 'crm', owner: 'acme' }), taxon({ id: 'vector', owner: PLATFORM_ORG })],
      [local('crm', 'CRM', 'Apps'), local('vector', 'Vector', 'AI')],
      known,
    )
    expect(joined.find((j) => j.entry.id === 'crm')!.owner).toBe('acme')
    expect(joined.find((j) => j.entry.id === 'vector')!.owner).toBe(PLATFORM_ORG)
  })
})

describe('grouping', () => {
  it('groups in the order given and skips empty sections', () => {
    const joined = join(
      [taxon({ id: 'vector', category: 'ai' }), taxon({ id: 'chat', category: 'apps' })],
      [local('vector', 'Vector', 'AI'), local('chat', 'Chat', 'Apps')],
      known,
    )
    expect(group(joined, ['AI', 'Observe', 'Apps']).map((g) => g.category)).toEqual(['AI', 'Apps'])
  })
})
