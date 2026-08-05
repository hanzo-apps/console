'use client'

/**
 * The controls above a list — the ONE bar that binds search + facets + Reset to
 * the persisted `useList` view.
 *
 * The ATOMS it composes (`Segmented`, `SearchInput`, `Option`) live in
 * `@hanzo/ui/product`, instrumented and shared with every other Hanzo surface.
 * This bar stays local because it takes a `List` — console's persisted view
 * model — so it is app-coupled by construction and cannot be lifted as-is.
 */
import type { ComponentProps } from 'react'
import { Button, Text, XStack } from '@hanzo/gui'
import { X } from '@hanzogui/lucide-icons-2'

import type { List } from '~/lib/list'
import { Segmented, SearchInput, type Option } from '@hanzo/ui/product'

/** One facet a `Filters` bar offers: a named group of mutually-exclusive pills. */
export type Facet = { name: string; options: Option<string>[] }

/**
 * A facet's `''` option is its "all" — `setFilter` stores nothing for it, which
 * keeps the persisted blob free of sentinels and the Reset count honest.
 */
export function Filters({
  list,
  placeholder = 'Search…',
  facets = [],
  children,
}: {
  list: List
  placeholder?: string
  facets?: Facet[]
  /** Extra controls (a range toggle, a view switch) trailing the facets. */
  children?: ComponentProps<typeof XStack>['children']
}) {
  return (
    <XStack gap="$2" items="center" flexWrap="wrap">
      <SearchInput value={list.q} onChange={list.setQ} placeholder={placeholder} name="list" />
      {facets.map((f) => (
        <Segmented
          key={f.name}
          name={f.name}
          options={f.options}
          value={list.filter(f.name)}
          onChange={(v) => list.setFilter(f.name, v)}
        />
      ))}
      {children}
      {list.active > 0 ? (
        <Button size="$2" chromeless icon={<X size={13} />} onPress={list.reset} aria-label="Reset filters">
          <Text fontSize="$2" color="$color11">
            Reset
          </Text>
        </Button>
      ) : null}
    </XStack>
  )
}
