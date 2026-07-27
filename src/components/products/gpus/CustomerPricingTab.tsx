'use client'

/**
 * GPUs · Pricing (customer) — the REAL, live per-accelerator price list, straight from
 * visor's GPU catalog (`GET /v1/gpus` via the user-bearer `/v1/vm` proxy). Every row is a
 * real accelerator with its real hourly rate and the 730-hour monthly equivalent — the
 * SAME figure the Launch drawer quotes and charges (one pricing source). Nothing is
 * indicative or fabricated: an empty catalog renders an honest "catalog unavailable"
 * state, and a price the backend omits renders "—".
 *
 * INTERACTIVE (not a rate card): with `onLaunch`, tapping a row opens the shared launch
 * drawer preselected on that accelerator — the price you see is the price you launch.
 */
import { Card, Text, XStack, YStack } from '@hanzo/gui'
import { Cpu, Server, Tag } from '@hanzogui/lucide-icons-2'

import { fmtHourly, fmtMonthly, DASH, type VisorGpuSize } from '~/lib/api/visor'
import { DataTable, type Column } from '@hanzo/ui/product'
import { sortByHourly } from './customer-logic'

export function CustomerPricingTab({ catalog, onLaunch }: { catalog: VisorGpuSize[]; onLaunch?: (c: VisorGpuSize) => void }) {
  const rows = sortByHourly(catalog.filter((c) => c.available))

  const columns: Column<VisorGpuSize>[] = [
    {
      key: 'model',
      header: 'Accelerator',
      render: (c) => (
        <XStack items="center" gap="$2" minW={0}>
          <Cpu size={15} color="$color10" />
          <YStack minW={0}>
            <Text fontSize="$3" fontWeight="700" color="$color12" numberOfLines={1}>
              {c.gpuCount && c.gpuCount > 1 ? `${c.gpuCount}× ` : ''}{c.model || c.slug}
            </Text>
            <Text fontSize="$1" color="$color10" numberOfLines={1}>{c.slug}</Text>
          </YStack>
        </XStack>
      ),
    },
    { key: 'vram', header: 'VRAM', width: 90, render: (c) => <Text fontSize="$3" color="$color11">{c.vramGb != null ? `${c.vramGb} GB` : DASH}</Text> },
    {
      key: 'host',
      header: 'Host',
      width: 150,
      render: (c) => (
        <Text fontSize="$2" color="$color11" numberOfLines={1}>
          {c.vcpus != null ? `${c.vcpus} vCPU` : DASH}{c.memGb != null ? ` · ${c.memGb} GB` : ''}
        </Text>
      ),
    },
    { key: 'hr', header: '$/hr', width: 96, render: (c) => <Text fontSize="$3" color="$color12" fontWeight="700">{fmtHourly(c.priceHourly)}</Text> },
    // Prefer the catalog's own monthly rate; else the 730-hour equivalent of the real hourly.
    { key: 'mo', header: '$/mo', width: 110, render: (c) => <Text fontSize="$3" color="$color11">{c.priceMonthly != null ? `$${Math.round(c.priceMonthly).toLocaleString()}/mo` : fmtMonthly(c.priceHourly)}</Text> },
  ]

  return (
    <YStack gap="$4">
      <Card p="$4" gap="$2" borderWidth={1} borderColor="$borderColor" maxWidth={720}>
        <XStack items="center" gap="$2">
          <Tag size={16} />
          <Text fontSize="$5" fontWeight="800">GPU pricing</Text>
        </XStack>
        <Text fontSize="$3" color="$color11">
          On-demand accelerators, billed hourly to your Hanzo Cloud balance. Rates below are live from the
          catalog; monthly is the 730-hour equivalent of the hourly rate.{onLaunch ? ' Tap any accelerator to launch it.' : ' Launch any of them from the GPUs tab.'}
        </Text>
      </Card>

      {rows.length ? (
        <YStack gap="$2">
          <DataTable columns={columns} rows={rows} rowKey={(c) => c.slug} onRowPress={onLaunch} empty="No GPU sizes available." />
          <Text fontSize="$1" color="$color10">Live per-accelerator hourly rate · visor catalog. No indicative numbers — every rate is the one you are charged{onLaunch ? ' — tap a row to launch it' : ''}.</Text>
        </YStack>
      ) : (
        <Card borderWidth={1} borderColor="$borderColor" borderStyle="dashed" p="$5" items="center" gap="$2">
          <Server size={20} />
          <Text fontSize="$3" fontWeight="700">Pricing catalog unavailable</Text>
          <Text fontSize="$2" color="$color11" text="center" maxW={420}>
            The accelerator catalog isn’t reachable right now, so no rates are shown — nothing is fabricated. Try again shortly.
          </Text>
        </Card>
      )}
    </YStack>
  )
}
