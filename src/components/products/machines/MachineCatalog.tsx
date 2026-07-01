'use client'

/**
 * Machine catalog — the REAL compute offer (regions + standard sizes with pricing)
 * read from visor's public catalog (`GET /v1/regions`, `GET /v1/sizes` via the `/vm`
 * proxy). Rendered under the "launch your first machine" empty state so a customer
 * with zero machines still sees the actual regions and sizes they can launch (with
 * real hourly/monthly price) — proving the backend is live, never a blank state and
 * never fabricated data. If the catalog can't load it renders nothing (the empty
 * state stands on its own).
 */
import { useEffect, useState } from 'react'
import { Card, Text, XStack, YStack } from '@hanzo/gui'
import { Cpu, Globe } from '@hanzogui/lucide-icons-2'

import { VisorApi, fmtHourly, fmtMonthly, type VisorRegion, type VisorSize } from '~/lib/api/visor'

const DASH = '—'

/** Top standard sizes to surface (smallest first), so the panel stays compact. */
function pickSizes(sizes: VisorSize[]): VisorSize[] {
  return sizes
    .filter((s) => s.available && s.vcpus != null && s.priceHourly != null)
    .sort((a, b) => (a.priceHourly ?? 0) - (b.priceHourly ?? 0))
    .slice(0, 6)
}

export function MachineCatalog() {
  const [regions, setRegions] = useState<VisorRegion[]>([])
  const [sizes, setSizes] = useState<VisorSize[]>([])
  const [ready, setReady] = useState(false)

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

  const shownSizes = pickSizes(sizes)
  // Nothing real to show → render nothing (the empty state alone is honest).
  if (!ready || (regions.length === 0 && shownSizes.length === 0)) return null

  const available = regions.filter((r) => r.available)

  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3" width="100%" maxWidth={720} self="center">
      <XStack items="center" justify="space-between" gap="$2" flexWrap="wrap">
        <Text fontSize="$4" fontWeight="800" color="$color12">
          Available compute
        </Text>
        <Text fontSize="$1" color="$color10">
          live catalog · visor
        </Text>
      </XStack>

      {available.length ? (
        <YStack gap="$1.5">
          <XStack items="center" gap="$2">
            <Globe size={14} color="$color10" />
            <Text fontSize="$2" color="$color11" fontWeight="600">
              {available.length} region{available.length === 1 ? '' : 's'}
            </Text>
          </XStack>
          <XStack gap="$1.5" flexWrap="wrap">
            {available.slice(0, 12).map((r) => (
              <Text key={r.slug} fontSize="$1" px="$2" py="$1" rounded="$2" bg="$color3" color="$color11">
                {r.slug}
              </Text>
            ))}
          </XStack>
        </YStack>
      ) : null}

      {shownSizes.length ? (
        <YStack gap="$2">
          <XStack items="center" gap="$2">
            <Cpu size={14} color="$color10" />
            <Text fontSize="$2" color="$color11" fontWeight="600">
              Standard sizes
            </Text>
          </XStack>
          <YStack borderWidth={1} borderColor="$borderColor" rounded="$3" overflow="hidden">
            <XStack bg="$color2" py="$2" px="$3" gap="$3">
              <Text flex={1} fontSize="$1" fontWeight="700" color="$color11">Size</Text>
              <Text width={120} fontSize="$1" fontWeight="700" color="$color11">Resources</Text>
              <Text width={80} fontSize="$1" fontWeight="700" color="$color11">$/hr</Text>
              <Text width={92} fontSize="$1" fontWeight="700" color="$color11">$/mo</Text>
            </XStack>
            {shownSizes.map((s) => (
              <XStack key={s.slug} py="$2" px="$3" gap="$3" borderTopWidth={1} borderColor="$borderColor" items="center">
                <Text flex={1} fontSize="$2" color="$color12" numberOfLines={1}>{s.slug}</Text>
                <Text width={120} fontSize="$2" color="$color11" numberOfLines={1}>
                  {s.vcpus != null ? `${s.vcpus} vCPU` : DASH}
                  {s.memGb != null ? ` · ${s.memGb} GB` : ''}
                </Text>
                <Text width={80} fontSize="$2" color="$color12">{fmtHourly(s.priceHourly)}</Text>
                <Text width={92} fontSize="$2" color="$color11">{fmtMonthly(s.priceHourly)}</Text>
              </XStack>
            ))}
          </YStack>
          <Text fontSize="$1" color="$color10">
            Prices are the live per-size hourly rate; monthly is the 730-hour equivalent. GPU accelerators are on the GPUs page.
          </Text>
        </YStack>
      ) : null}
    </Card>
  )
}
