'use client'

/**
 * Machine catalog — the REAL, COMPLETE compute offer (all regions + every available
 * standard size, with OUR market price) read from visor's catalog (`GET /v1/regions`,
 * `GET /v1/sizes` via the `/vm` proxy). Rendered under the "launch your first machine"
 * empty state so a customer with zero machines still sees the actual regions and the
 * full size list they can launch — searchable, with real $/hr AND $/mo per entry (the
 * same visor `HanzoPrice` the launch drawer quotes and the launch charges). Proves the
 * backend is live; never a partial/hardcoded subset, never fabricated data. If the
 * catalog can't load it renders nothing (the empty state stands on its own).
 */
import { useEffect, useMemo, useState } from 'react'
import { Card, Input, Text, XStack, YStack } from '@hanzo/gui'
import { Cpu, Globe, Search } from '@hanzogui/lucide-icons-2'

import { VisorApi, type VisorRegion, type VisorSize } from '~/lib/api/visor'

const DASH = '—'
const hr = (n?: number) => (n == null ? DASH : `$${n < 1 ? n.toFixed(3) : n.toFixed(2)}/hr`)
const mo = (n?: number) => (n == null ? DASH : `$${Math.round(n).toLocaleString()}/mo`)

export function MachineCatalog() {
  const [regions, setRegions] = useState<VisorRegion[]>([])
  const [sizes, setSizes] = useState<VisorSize[]>([])
  const [ready, setReady] = useState(false)
  const [q, setQ] = useState('')

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
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? allSizes.filter((it) => it.slug.toLowerCase().includes(s)) : allSizes
  }, [allSizes, q])
  const available = regions.filter((r) => r.available)

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
          </XStack>
          <XStack gap="$1.5" flexWrap="wrap">
            {available.map((r) => (
              <Text key={r.slug} fontSize="$1" px="$2" py="$1" rounded="$2" bg="$color3" color="$color11">{r.slug}</Text>
            ))}
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
            <Text fontSize="$1" color="$color10">{shown.length} of {allSizes.length}</Text>
          </XStack>
          <XStack items="center" gap="$2" px="$3" borderWidth={1} borderColor="$borderColor" rounded="$3">
            <Search size={14} />
            <Input flex={1} unstyled value={q} onChangeText={setQ} placeholder="Search sizes — s-2vcpu, c-4, m-…" autoCapitalize="none" py="$1.5" />
          </XStack>
          <YStack borderWidth={1} borderColor="$borderColor" rounded="$3" overflow="hidden">
            <XStack bg="$color2" py="$2" px="$3" gap="$3">
              <Text flex={1} fontSize="$1" fontWeight="700" color="$color11">Size</Text>
              <Text width={120} fontSize="$1" fontWeight="700" color="$color11">Resources</Text>
              <Text width={84} fontSize="$1" fontWeight="700" color="$color11">$/hr</Text>
              <Text width={96} fontSize="$1" fontWeight="700" color="$color11">$/mo</Text>
            </XStack>
            <YStack maxH={340} overflow="scroll">
              {shown.map((s) => (
                <XStack key={s.slug} py="$2" px="$3" gap="$3" borderTopWidth={1} borderColor="$borderColor" items="center">
                  <Text flex={1} fontSize="$2" color="$color12" numberOfLines={1}>{s.slug}</Text>
                  <Text width={120} fontSize="$2" color="$color11" numberOfLines={1}>
                    {s.vcpus != null ? `${s.vcpus} vCPU` : DASH}{s.memGb != null ? ` · ${s.memGb} GB` : ''}
                  </Text>
                  <Text width={84} fontSize="$2" color="$color12">{hr(s.priceHourly)}</Text>
                  <Text width={96} fontSize="$2" color="$color11">{mo(s.priceMonthly)}</Text>
                </XStack>
              ))}
              {shown.length === 0 ? <Text p="$3" fontSize="$2" color="$color10">No sizes match “{q}”.</Text> : null}
            </YStack>
          </YStack>
          <Text fontSize="$1" color="$color10">
            Live per-size price — what you pay (our market rate), the same figure the launch quote shows. GPU accelerators are on the GPUs page.
          </Text>
        </YStack>
      ) : null}
    </Card>
  )
}
