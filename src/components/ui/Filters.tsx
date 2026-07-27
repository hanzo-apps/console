'use client'

/**
 * List filtering — the ONE segmented pill control, the ONE search box, and the ONE
 * bar that composes them above a list.
 *
 * These were first written for the Inference endpoints dashboard; promoted here so a
 * sibling product (Infrastructure, …) never reaches into `inference/` for shell chrome
 * — the same separation-of-concerns move `ui/Metric.tsx` made out of `gpus/`.
 * `inference/parts.tsx` re-exports them, so there is exactly one definition.
 *
 * `Filters` is that bar: search on the left, facets beside it, and a Reset that
 * appears ONLY once something is narrowed (a control that is always there but
 * usually inert teaches a user to ignore it). It takes a `List` from `useList`, so
 * a surface wires search + facets + reset in one line and the state it renders is
 * the state that persists.
 */
import type { ComponentProps } from 'react'
import { Button, Input, Text, XStack } from '@hanzo/gui'
import { Search, X } from '@hanzogui/lucide-icons-2'

import type { List } from '~/lib/list'

/** One pill in a segmented control. */
export type Option<T extends string> = { label: string; value: T }

/** A compact segmented pill control — the ONE way filters/ranges/toggles render. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = '$2',
}: {
  options: Option<T>[]
  value: T
  onChange: (v: T) => void
  size?: ComponentProps<typeof Button>['size']
}) {
  return (
    <XStack gap="$1" flexWrap="wrap" items="center">
      {options.map((o) => {
        const active = o.value === value
        return (
          <Button
            key={o.value}
            size={size}
            bg={active ? '$color5' : 'transparent'}
            borderWidth={1}
            borderColor={active ? '$color7' : '$borderColor'}
            aria-pressed={active}
            onPress={() => onChange(o.value)}
          >
            <Text fontSize="$2" fontWeight={active ? '700' : '500'} color={active ? '$color12' : '$color11'}>
              {o.label}
            </Text>
          </Button>
        )
      })}
    </XStack>
  )
}

/** A search input with a leading magnifier. */
export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <XStack flex={1} minW={180} items="center" gap="$2" px="$3" borderWidth={1} borderColor="$borderColor" rounded="$4" bg="$color1">
      <Search size={15} color="$color10" />
      <Input flex={1} value={value} onChangeText={onChange} placeholder={placeholder} borderWidth={0} bg="transparent" px="$0" fontSize="$3" />
    </XStack>
  )
}

/** One facet a `Filters` bar offers: a named group of mutually-exclusive pills. */
export type Facet = { name: string; options: Option<string>[] }

/**
 * The controls above a list: search, facets, and Reset — bound to the persisted
 * `useList` view, so what the user sees is what survives their next visit.
 *
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
      <SearchInput value={list.q} onChange={list.setQ} placeholder={placeholder} />
      {facets.map((f) => (
        <Segmented
          key={f.name}
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
