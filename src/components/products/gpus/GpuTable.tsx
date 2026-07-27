'use client'

/**
 * The GPU inventory table — the primary surface shared by the Overview and GPUs
 * tabs. Renders ONLY real inventory rows (from `GET /paas/gpus`); telemetry cells
 * show `—` when a field is absent (never a fabricated 0). Search + cluster/model/
 * status/location facet filters + pagination are pure (`filterGpus`/`paginate`).
 *
 * Per-GPU actions (cordon/drain/reboot) have no backend yet, so the row menu is
 * honestly disabled with a tooltip — never a dead handler.
 */
import { useEffect, useMemo, useState } from 'react'
import { Input, ScrollView, Text, XStack, YStack } from '@hanzo/gui'
import { Search } from '@hanzogui/lucide-icons-2'

import {
  filterGpus,
  paginate,
  uniqueValues,
  fmtPct,
  fmtTemp,
  fmtPower,
  fmtUptime,
  shortUuid,
  emptyFilter,
  type Gpu,
  type GpuFilter,
} from '~/lib/api/compute'
import { StatusTag } from '@hanzo/ui/product'
import { FieldSelect } from '@hanzo/ui/product'
import { HintButton, UtilBar, utilColor } from './charts'

const COLS = [
  { key: 'gpu', header: 'GPU', width: 210 },
  { key: 'model', header: 'Model', width: 96 },
  { key: 'cluster', header: 'Cluster', width: 150 },
  { key: 'status', header: 'Status', width: 132 },
  { key: 'util', header: 'Util', width: 132 },
  { key: 'mem', header: 'Mem', width: 70 },
  { key: 'temp', header: 'Temp', width: 70 },
  { key: 'power', header: 'Power', width: 78 },
  { key: 'uptime', header: 'Uptime', width: 84 },
  { key: 'location', header: 'Location', width: 96 },
] as const
const TOTAL = COLS.reduce((a, c) => a + c.width, 0)

const Cell = ({ width, children }: { width: number; children: React.ReactNode }) => (
  <YStack width={width} justify="center">
    {children}
  </YStack>
)

/** A facet dropdown with an "All …" sentinel mapped to the empty filter. */
function Facet({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (v: string) => void
}) {
  const all = `All ${label}`
  return (
    <YStack minW={150} flex={1}>
      <FieldSelect
        value={value || all}
        options={[all, ...options]}
        onChange={(v) => onChange(v === all ? '' : v)}
      />
    </YStack>
  )
}

export function GpuTable({ gpus, pageSize = 10 }: { gpus: Gpu[]; pageSize?: number }) {
  const [filter, setFilter] = useState<GpuFilter>(emptyFilter)
  const [page, setPage] = useState(1)

  const clusters = useMemo(() => uniqueValues(gpus, 'cluster'), [gpus])
  const models = useMemo(() => uniqueValues(gpus, 'model'), [gpus])
  const statuses = useMemo(() => uniqueValues(gpus, 'status'), [gpus])
  const locations = useMemo(() => uniqueValues(gpus, 'location'), [gpus])

  const filtered = useMemo(() => filterGpus(gpus, filter), [gpus, filter])
  // Reset to page 1 whenever the filtered set changes size (new search/facet).
  useEffect(() => setPage(1), [filter])
  const { rows, page: cur, pages, total } = paginate(filtered, page, pageSize)

  const set = (patch: Partial<GpuFilter>) => setFilter((f) => ({ ...f, ...patch }))

  return (
    <YStack gap="$3">
      {/* Toolbar: search + facets */}
      <XStack gap="$2" flexWrap="wrap" items="center">
        <XStack
          items="center"
          gap="$2"
          px="$3"
          borderWidth={1}
          borderColor="$borderColor"
          rounded="$3"
          minW={220}
          flex={1}
        >
          <Search size={15} />
          <Input
            unstyled
            flex={1}
            py="$2"
            fontSize="$3"
            color="$color12"
            placeholder="Search GPU, UUID, model…"
            value={filter.q}
            onChangeText={(v) => set({ q: v })}
            autoCapitalize="none"
          />
        </XStack>
        <Facet label="clusters" value={filter.cluster} options={clusters} onChange={(v) => set({ cluster: v })} />
        <Facet label="models" value={filter.model} options={models} onChange={(v) => set({ model: v })} />
        <Facet label="statuses" value={filter.status} options={statuses} onChange={(v) => set({ status: v })} />
        <Facet label="locations" value={filter.location} options={locations} onChange={(v) => set({ location: v })} />
      </XStack>

      {/* Table (horizontally scrollable so the wide telemetry row never clips) */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <YStack minW={TOTAL} borderWidth={1} borderColor="$borderColor" rounded="$4" overflow="hidden">
          <XStack bg="$color2" py="$2.5" px="$3" gap="$3">
            {COLS.map((c) => (
              <Text key={c.key} width={c.width} fontSize="$2" fontWeight="700" color="$color11">
                {c.header}
              </Text>
            ))}
          </XStack>

          {rows.length === 0 ? (
            <YStack p="$5" items="center" borderTopWidth={1} borderColor="$borderColor">
              <Text color="$color11">No GPUs match these filters.</Text>
            </YStack>
          ) : (
            rows.map((g) => (
              <XStack key={g.id} py="$2.5" px="$3" gap="$3" borderTopWidth={1} borderColor="$borderColor" items="center">
                <Cell width={COLS[0].width}>
                  <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
                    {g.name || g.id}
                  </Text>
                  <Text fontSize="$1" color="$color10" numberOfLines={1}>
                    {shortUuid(g.uuid, g.id)}
                  </Text>
                </Cell>
                <Cell width={COLS[1].width}>
                  <Text fontSize="$3" color="$color11">
                    {g.model || '—'}
                  </Text>
                </Cell>
                <Cell width={COLS[2].width}>
                  <Text fontSize="$3" color="$color12" numberOfLines={1}>
                    {g.cluster || '—'}
                  </Text>
                  {g.region ? (
                    <Text fontSize="$1" color="$color10" numberOfLines={1}>
                      {g.region}
                    </Text>
                  ) : null}
                </Cell>
                <Cell width={COLS[3].width}>
                  <XStack gap="$1.5" items="center">
                    <StatusTag status={g.status ?? 'unknown'} />
                    {g.health ? (
                      <Text fontSize="$1" color="$color10">
                        {g.health}
                      </Text>
                    ) : null}
                  </XStack>
                </Cell>
                <Cell width={COLS[4].width}>
                  {typeof g.utilization === 'number' ? (
                    <YStack gap="$1">
                      <Text fontSize="$2" color="$color12">
                        {fmtPct(g.utilization)}
                      </Text>
                      <UtilBar value={g.utilization} width={COLS[4].width - 12} />
                    </YStack>
                  ) : (
                    <Text fontSize="$3" color="$color10">
                      —
                    </Text>
                  )}
                </Cell>
                <Cell width={COLS[5].width}>
                  <Text fontSize="$3" color="$color11">
                    {fmtPct(g.memoryUtil)}
                  </Text>
                </Cell>
                <Cell width={COLS[6].width}>
                  <Text fontSize="$3" color={typeof g.temperature === 'number' ? (utilColor(g.temperature) as never) : '$color10'}>
                    {fmtTemp(g.temperature)}
                  </Text>
                </Cell>
                <Cell width={COLS[7].width}>
                  <Text fontSize="$3" color="$color11">
                    {fmtPower(g.power)}
                  </Text>
                </Cell>
                <Cell width={COLS[8].width}>
                  <Text fontSize="$3" color="$color11">
                    {fmtUptime(g.uptimeSeconds)}
                  </Text>
                </Cell>
                <Cell width={COLS[9].width}>
                  <Text fontSize="$3" color="$color11" numberOfLines={1}>
                    {g.location || '—'}
                  </Text>
                </Cell>
              </XStack>
            ))
          )}
        </YStack>
      </ScrollView>

      {/* Pagination */}
      <XStack items="center" justify="space-between" gap="$2" flexWrap="wrap">
        <Text fontSize="$2" color="$color10">
          {total} GPU{total === 1 ? '' : 's'}
          {filtered.length !== gpus.length ? ` (filtered from ${gpus.length})` : ''}
        </Text>
        <XStack items="center" gap="$2">
          <HintButton disabled={cur <= 1} onPress={() => setPage(cur - 1)}>
            Prev
          </HintButton>
          <Text fontSize="$2" color="$color11">
            Page {cur} of {pages}
          </Text>
          <HintButton disabled={cur >= pages} onPress={() => setPage(cur + 1)}>
            Next
          </HintButton>
        </XStack>
      </XStack>
    </YStack>
  )
}
