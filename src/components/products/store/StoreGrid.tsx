'use client'

/**
 * The App Store browse grid — search + tag filters over the full 1000+-app catalog,
 * rendering only a paginated slice (Load-more, PAGE_SIZE at a time) so the DOM stays
 * capped. Search is a LITERAL case-insensitive substring (ReDoS-safe); the pure
 * filter/paginate/tag logic lives in `./logic`. Card deploy + earn wiring is the shared
 * `AppsRow`.
 */
import { useMemo, useState } from 'react'
import { Button, Input, Text, XStack, YStack } from '@hanzo/gui'
import { Search, Tag, X } from '@hanzogui/lucide-icons-2'

import { type OssApp } from '~/lib/api/oss-apps'
import { AppsRow } from './AppsRow'
import { PAGE_SIZE, availableTags, featuredQuickTags, filterApps, paginate, remaining } from './logic'

function TagChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Button
      size="$1"
      onPress={onPress}
      theme={active ? 'light' : undefined}
      borderWidth={1}
      borderColor={active ? '$color8' : '$borderColor'}
    >
      {label}
    </Button>
  )
}

export function StoreGrid({ apps, base }: { apps: OssApp[]; base: string }) {
  const [query, setQuery] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [showAllTags, setShowAllTags] = useState(false)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const quickTags = useMemo(() => featuredQuickTags(apps), [apps])
  const allTags = useMemo(() => availableTags(apps), [apps])
  const filtered = useMemo(() => filterApps(apps, { query, tags }), [apps, query, tags])
  const visible = useMemo(() => paginate(filtered, visibleCount), [filtered, visibleCount])
  const left = remaining(filtered.length, visibleCount)

  const toggleTag = (t: string) => {
    setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))
    setVisibleCount(PAGE_SIZE) // a new filter resets the page window
  }
  const onQuery = (v: string) => {
    setQuery(v)
    setVisibleCount(PAGE_SIZE)
  }

  return (
    <YStack gap="$3">
      {/* Search + result count. */}
      <XStack gap="$3" items="center" flexWrap="wrap" justify="space-between">
        <XStack items="center" gap="$2" bg="$color2" px="$3" rounded="$3" borderWidth={1} borderColor="$borderColor" flex={1} minW={240} maxW={440}>
          <Search size={15} color="$color10" />
          <Input
            unstyled
            placeholder="Search 1000+ open-source apps…"
            value={query}
            onChangeText={onQuery}
            flex={1}
            py="$2"
            fontSize="$3"
          />
          {query ? <Button chromeless circular size="$1" icon={<X size={13} />} onPress={() => onQuery('')} /> : null}
        </XStack>
        <Text fontSize="$2" color="$color10">
          {filtered.length === apps.length ? `${apps.length} apps` : `${filtered.length} of ${apps.length} apps`}
        </Text>
      </XStack>

      {/* Quick-filter tag chips + a reveal of the full tag set. */}
      <XStack gap="$2" items="center" flexWrap="wrap">
        {quickTags.map((t) => (
          <TagChip key={t} label={t} active={tags.includes(t)} onPress={() => toggleTag(t)} />
        ))}
        {allTags.length > quickTags.length ? (
          <Button size="$1" chromeless icon={<Tag size={13} />} onPress={() => setShowAllTags((v) => !v)}>
            {showAllTags ? 'Fewer tags' : 'All tags'}
          </Button>
        ) : null}
        {tags.length ? (
          <Button size="$1" chromeless icon={<X size={13} />} onPress={() => setTags([])}>
            Clear
          </Button>
        ) : null}
      </XStack>

      {showAllTags ? (
        <XStack
          gap="$1.5"
          flexWrap="wrap"
          p="$2.5"
          bg="$color1"
          borderWidth={1}
          borderColor="$borderColor"
          rounded="$3"
          maxH={220}
          overflow="scroll"
        >
          {allTags.map((t) => (
            <TagChip key={t} label={t} active={tags.includes(t)} onPress={() => toggleTag(t)} />
          ))}
        </XStack>
      ) : null}

      {/* Results. */}
      {filtered.length === 0 ? (
        <Text color="$color10" py="$4">
          No apps match your search.
        </Text>
      ) : (
        <>
          <AppsRow apps={visible} base={base} />
          {left > 0 ? (
            <XStack justify="center" py="$2">
              <Button onPress={() => setVisibleCount((c) => c + PAGE_SIZE)}>Load more ({left} remaining)</Button>
            </XStack>
          ) : null}
        </>
      )}
    </YStack>
  )
}
