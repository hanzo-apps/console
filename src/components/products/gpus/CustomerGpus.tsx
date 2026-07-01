'use client'

/**
 * Customer GPUs — a tenant's accelerator surface, read from visor's REAL catalog via
 * the user-bearer `/vm` proxy: the GPU accelerator offer (`GET /v1/gpus` — model,
 * count, VRAM, vCPU/RAM, real hourly/monthly price) plus the org's OWN GPU machines
 * (`GET /v1/machines`, filtered to accelerated types). This is the customer analogue
 * of `MachinesModule`'s customer branch — a customer sees the actual GPUs they can
 * launch and the ones they run, never the admin `/paas` fleet view or the infra
 * "PAAS_SERVICE_TOKEN" message. Honest by construction: an empty catalog / machine
 * list is a real state, a field the backend omits renders "—", nothing is fabricated.
 */
import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Cpu, RefreshCw, Rocket, Server } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import {
  VisorApi,
  fmtHourly,
  fmtMonthly,
  fmtSpec,
  statusVerdict,
  DASH,
  type VisorGpuSize,
  type VisorMachine,
} from '~/lib/api/visor'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'

const VERDICT_TONE = { ok: '$green10', warn: '$yellow10', down: '$red10', idle: '$color9' } as const

/** True if a machine is GPU-accelerated (visor sets `gpu`, or a `gpu-*` size slug). */
const isGpuMachine = (m: VisorMachine): boolean => !!m.gpu || (m.type ?? '').toLowerCase().startsWith('gpu-')

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <YStack flex={1} minW={160} p="$3.5" gap="$1.5" borderWidth={1} borderColor="$borderColor" rounded="$4" bg="$color1">
      <Text fontSize="$2" color="$color11" fontWeight="600">{label}</Text>
      <Text fontSize="$8" fontWeight="900" color="$color12" numberOfLines={1}>{value}</Text>
      {sub ? <Text fontSize="$1" color="$color10" numberOfLines={1}>{sub}</Text> : null}
    </YStack>
  )
}

export function CustomerGpus() {
  const [catalog, setCatalog] = useState<VisorGpuSize[]>([])
  const [machines, setMachines] = useState<VisorMachine[]>([])
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    Promise.allSettled([VisorApi.gpus(), VisorApi.machines()]).then(([g, m]) => {
      setCatalog(g.status === 'fulfilled' ? g.value : [])
      setMachines(m.status === 'fulfilled' ? m.value.filter(isGpuMachine) : [])
      setLoading(false)
    })
  }
  useEffect(load, [])

  const available = useMemo(() => catalog.filter((c) => c.available), [catalog])
  const models = useMemo(() => new Set(available.map((c) => c.model).filter(Boolean)).size, [available])
  const cheapest = useMemo(
    () => available.map((c) => c.priceHourly).filter((n): n is number => n != null).sort((a, b) => a - b)[0],
    [available],
  )

  const catalogCols: Column<VisorGpuSize>[] = [
    {
      key: 'model',
      header: 'GPU',
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
    { key: 'hr', header: '$/hr', width: 84, render: (c) => <Text fontSize="$3" color="$color12" fontWeight="600">{fmtHourly(c.priceHourly)}</Text> },
    { key: 'mo', header: '$/mo', width: 96, render: (c) => <Text fontSize="$3" color="$color11">{fmtMonthly(c.priceHourly)}</Text> },
  ]

  const machineCols: Column<VisorMachine>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (m) => (
        <YStack minW={0}>
          <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{m.name || m.id}</Text>
          <Text fontSize="$1" color="$color10" numberOfLines={1}>{m.type || DASH}</Text>
        </YStack>
      ),
    },
    { key: 'gpu', header: 'GPU', width: 120, render: (m) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{m.gpu || DASH}</Text> },
    { key: 'region', header: 'Region', width: 100, render: (m) => <Text fontSize="$3" color="$color11">{m.region || DASH}</Text> },
    { key: 'spec', header: 'Resources', width: 140, render: (m) => <Text fontSize="$2" color="$color11" numberOfLines={1}>{fmtSpec(m)}</Text> },
    {
      key: 'status',
      header: 'Status',
      width: 110,
      render: (m) => (
        <XStack items="center" gap="$1.5">
          <YStack width={8} height={8} rounded="$10" bg={VERDICT_TONE[statusVerdict(m.status)]} />
          <Text fontSize="$2" color="$color11" numberOfLines={1}>{m.status || DASH}</Text>
        </XStack>
      ),
    },
    { key: 'cost', header: 'Cost', width: 92, render: (m) => <Text fontSize="$3" color="$color12">{fmtHourly(m.costHourlyUsd)}</Text> },
  ]

  const launch = () => {
    if (typeof window !== 'undefined') window.open(`${config.docsUrl}/gpus`, '_blank', 'noopener')
  }

  const header = (
    <PageHeader
      title="GPUs"
      subtitle="On-demand GPU accelerators — H100, A100, L40S and more."
      actions={
        <XStack gap="$2">
          <Button size="$3" chromeless icon={<RefreshCw size={15} />} onPress={load} aria-label="Refresh" />
          <Button size="$3" theme="light" icon={<Rocket size={15} />} onPress={launch}>Launch GPU</Button>
        </XStack>
      }
    />
  )

  if (loading) {
    return (
      <>
        {header}
        <XStack p="$6" justify="center"><Spinner size="large" color="$color11" /></XStack>
      </>
    )
  }

  return (
    <>
      {header}

      <XStack flexWrap="wrap" gap="$3" items="stretch">
        <StatCard label="GPU types" value={String(models)} sub="available to launch" />
        <StatCard label="From" value={cheapest != null ? fmtHourly(cheapest) : DASH} sub="cheapest accelerator" />
        <StatCard label="Your GPU machines" value={String(machines.length)} sub={machines.length ? 'running' : 'none yet'} />
      </XStack>

      {machines.length ? (
        <YStack gap="$2">
          <Text fontSize="$4" fontWeight="800" color="$color12">Your GPU machines</Text>
          <DataTable columns={machineCols} rows={machines} rowKey={(m) => m.id} empty="No GPU machines yet." />
        </YStack>
      ) : null}

      <YStack gap="$2">
        <XStack items="center" justify="space-between" gap="$2" flexWrap="wrap">
          <Text fontSize="$4" fontWeight="800" color="$color12">GPU catalog</Text>
          <Text fontSize="$1" color="$color10">live catalog · visor</Text>
        </XStack>
        {available.length ? (
          <DataTable columns={catalogCols} rows={available} rowKey={(c) => c.slug} empty="No GPU sizes available." />
        ) : (
          <Card borderWidth={1} borderColor="$borderColor" borderStyle="dashed" p="$5" items="center" gap="$2">
            <Server size={20} />
            <Text fontSize="$3" fontWeight="700">GPU catalog unavailable</Text>
            <Text fontSize="$2" color="$color11" text="center" maxW={420}>
              The accelerator catalog isn’t reachable right now. GPU machines you launch will still appear above — nothing is fabricated.
            </Text>
          </Card>
        )}
        {available.length ? (
          <Text fontSize="$1" color="$color10">
            Prices are the live per-accelerator hourly rate; monthly is the 730-hour equivalent. Launch from the CLI or docs.
          </Text>
        ) : null}
      </YStack>
    </>
  )
}
