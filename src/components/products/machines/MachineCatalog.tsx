'use client'

/**
 * Machine catalog — the REAL, COMPLETE compute offer (all regions + every available
 * standard size, with OUR market price) read from visor's catalog (`GET /v1/vm/regions`,
 * `GET /v1/vm/sizes`). Rendered under the "launch your first machine"
 * empty state so a customer with zero machines still sees the actual regions and the
 * full size list they can launch — searchable, with real $/hr AND $/mo per entry (the
 * same visor `HanzoPrice` the launch drawer quotes and the launch charges). Proves the
 * backend is live; never a partial/hardcoded subset, never fabricated data. If the
 * catalog can't load it renders nothing (the empty state stands on its own).
 */
import { useEffect, useMemo, useState } from 'react'
import { Card, Input, Text, XStack, YStack } from '@hanzo/gui'
import { ChevronRight, Cpu, Globe, Rocket, Search, Server } from '@hanzogui/lucide-icons-2'

import { VisorApi, filterSizes, type VisorRegion, type VisorSize } from '~/lib/api/visor'

const DASH = '—'
const hr = (n?: number) => (n == null ? DASH : `$${n < 1 ? n.toFixed(3) : n.toFixed(2)}/hr`)
const mo = (n?: number) => (n == null ? DASH : `$${Math.round(n).toLocaleString()}/mo`)
const spec = (s: VisorSize) =>
  s.vcpus != null ? `${s.vcpus} vCPU${s.memGb != null ? ` · ${s.memGb} GB` : ''}` : DASH

/**
 * The live compute catalog under the "launch your first machine" state — REAL
 * regions + every available size with OUR market price (visor `/v1/vm` catalog).
 *
 * INTERACTIVE (not a brochure): tapping a region chip filters + presets the launch
 * region; tapping a size row opens the real launch drawer preselected on that size
 * (`onLaunch`). With no `onLaunch` the rows stay informational. Nothing fabricated —
 * if the catalog can't load it renders nothing and the empty state stands alone.
 */
export function MachineCatalog({ onLaunch }: { onLaunch?: (opts: { size?: string; region?: string }) => void }) {
  const [regions, setRegions] = useState<VisorRegion[]>([])
  const [sizes, setSizes] = useState<VisorSize[]>([])
  const [ready, setReady] = useState(false)
  const [q, setQ] = useState('')
  const [activeRegion, setActiveRegion] = useState('') // '' = all regions

  useEffect(() => {
    let live = true
    Promise.allSettled([VisorApi.regions(), VisorApi.sizes()]).then(([r, s]) => {
      if (!live) return
      if (r.status === 'fulfilled') setRegions(r.value)
      if (s.status === 'fulfilled') setSizes(s.value)
      setReady(true)
    })
    return () => {
      live = false
    }
  }, [])

  // ALL available sizes (cheapest first) — the complete live list, filterable.
  const allSizes = useMemo(
    () => sizes.filter((s) => s.available && s.vcpus != null).sort((a, b) => (a.priceHourly ?? 0) - (b.priceHourly ?? 0)),
    [sizes],
  )
  const shown = useMemo(() => filterSizes(allSizes, q, activeRegion || undefined), [allSizes, q, activeRegion])
  const available = regions.filter((r) => r.available)
  const clickable = !!onLaunch

  // Nothing real to show → render nothing (the empty state alone is honest).
  if (!ready || (available.length === 0 && allSizes.length === 0)) return null

  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3" width="100%" maxWidth={760} self="center">
      <XStack items="center" justify="space-between" gap="$2" flexWrap="wrap">
        <Text fontSize="$4" fontWeight="800" color="$color12">Available compute</Text>
        <Text fontSize="$1" color="$color10">live catalog · visor · our market price</Text>
      </XStack>

      {available.length ? (
        <YStack gap="$1.5">
          <XStack items="center" gap="$2">
            <Globe size={14} color="$color10" />
            <Text fontSize="$2" color="$color11" fontWeight="600">{available.length} region{available.length === 1 ? '' : 's'}</Text>
            {clickable ? <Text fontSize="$1" color="$color10">· tap to filter</Text> : null}
          </XStack>
          <XStack gap="$1.5" flexWrap="wrap">
            {clickable ? (
              <RegionChip label="All" active={activeRegion === ''} onPress={() => setActiveRegion('')} />
            ) : null}
            {available.map((r) =>
              clickable ? (
                <RegionChip
                  key={r.slug}
                  label={r.slug}
                  active={activeRegion === r.slug}
                  onPress={() => setActiveRegion((cur) => (cur === r.slug ? '' : r.slug))}
                />
              ) : (
                <Text key={r.slug} fontSize="$1" px="$2" py="$1" rounded="$2" bg="$color3" color="$color11">{r.slug}</Text>
              ),
            )}
          </XStack>
        </YStack>
      ) : null}

      {allSizes.length ? (
        <YStack gap="$2">
          <XStack items="center" justify="space-between" gap="$2" flexWrap="wrap">
            <XStack items="center" gap="$2">
              <Cpu size={14} color="$color10" />
              <Text fontSize="$2" color="$color11" fontWeight="600">Machine sizes</Text>
            </XStack>
            <Text fontSize="$1" color="$color10">
              {shown.length} of {allSizes.length}{activeRegion ? ` · in ${activeRegion}` : ''}
            </Text>
          </XStack>
          <XStack items="center" gap="$2" px="$3" borderWidth={1} borderColor="$borderColor" rounded="$3">
            <Search size={14} />
            <Input flex={1} unstyled value={q} onChangeText={setQ} placeholder="Search sizes — s-2vcpu, c-4, m-…" autoCapitalize="none" py="$1.5" />
          </XStack>
          <YStack borderWidth={1} borderColor="$borderColor" rounded="$3" overflow="hidden">
            <YStack maxH={360} overflow="scroll">
              {shown.map((s) => (
                <XStack
                  key={s.slug}
                  py="$2.5"
                  px="$3"
                  gap="$2"
                  borderBottomWidth={1}
                  borderColor="$borderColor"
                  items="center"
                  hoverStyle={clickable ? { bg: '$color2' } : undefined}
                  pressStyle={clickable ? { bg: '$color3' } : undefined}
                  cursor={clickable ? 'pointer' : undefined}
                  onPress={clickable ? () => onLaunch?.({ size: s.slug, region: activeRegion || undefined }) : undefined}
                >
                  <Server size={15} color="$color10" />
                  <YStack flex={1} minW={0}>
                    <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{s.slug}</Text>
                    <Text fontSize="$1" color="$color10" numberOfLines={1}>{spec(s)}</Text>
                  </YStack>
                  <YStack items="flex-end">
                    <Text fontSize="$3" fontWeight="700" color="$color12">{mo(s.priceMonthly)}</Text>
                    <Text fontSize="$1" color="$color10">{hr(s.priceHourly)}</Text>
                  </YStack>
                  {clickable ? <ChevronRight size={16} color="$color9" /> : null}
                </XStack>
              ))}
              {shown.length === 0 ? (
                <Text p="$3" fontSize="$2" color="$color10">
                  No sizes match{q ? ` “${q}”` : ''}{activeRegion ? ` in ${activeRegion}` : ''}.
                </Text>
              ) : null}
            </YStack>
          </YStack>
          <XStack items="center" gap="$1.5" flexWrap="wrap">
            {clickable ? <Rocket size={12} color="$color10" /> : null}
            <Text fontSize="$1" color="$color10">
              {clickable
                ? `Tap a size to launch it${activeRegion ? ` in ${activeRegion}` : ''} — you pay our market rate (the same figure the launch quote shows). GPU accelerators are on the GPUs page.`
                : 'Live per-size price — what you pay (our market rate), the same figure the launch quote shows. GPU accelerators are on the GPUs page.'}
            </Text>
          </XStack>
        </YStack>
      ) : null}
    </Card>
  )
}

/** A selectable region pill — tap to filter the size list to that region (and preset it). */
function RegionChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Text
      fontSize="$1"
      px="$2.5"
      py="$1"
      rounded="$2"
      bg={active ? '$color12' : '$color3'}
      color={active ? '$color1' : '$color11'}
      fontWeight={active ? '700' : '400'}
      cursor="pointer"
      hoverStyle={active ? undefined : { bg: '$color4' }}
      pressStyle={{ opacity: 0.85 }}
      onPress={onPress}
    >
      {label}
    </Text>
  )
}
