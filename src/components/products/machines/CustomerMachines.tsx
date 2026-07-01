'use client'

/**
 * Customer machines — a tenant's OWN compute, read from visor via the user-bearer
 * `/vm` proxy (`VisorApi.machines()`). This is what a non-admin (a customer like a
 * demo user) sees under Compute › Machines: their real machines, or a graceful
 * "launch one" / "managed compute" state — NEVER the infra "PAAS_SERVICE_TOKEN not
 * set" message (that is only ever an admin concern; the admin fleet view lives in
 * `MachinesModule`).
 *
 * A row opens the ONE right-side `DetailPane` (item detail slides out from the
 * right, full-screen on mobile) — no full-page nav.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { RefreshCw, Rocket, Server } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import {
  VisorApi,
  interpretVisorError,
  fmtSpec,
  fmtHourly,
  statusVerdict,
  DASH,
  type VisorError,
  type VisorMachine,
} from '~/lib/api/visor'
import { productColorHex } from '~/lib/products/colors'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { EmptyState } from '~/components/ui/EmptyState'
import { useDetailPane } from '~/components/DetailPane'
import { asColor } from '~/components/ui/color'
import { MachineCatalog } from './MachineCatalog'

const VERDICT_TONE = {
  ok: '$green10',
  warn: '$yellow10',
  down: '$red10',
  idle: '$color9',
} as const

function StatusPill({ status }: { status?: string }) {
  const tone = VERDICT_TONE[statusVerdict(status)]
  return (
    <XStack items="center" gap="$1.5">
      <YStack width={8} height={8} rounded="$10" bg={tone} />
      <Text fontSize="$2" color="$color11" numberOfLines={1}>
        {status || DASH}
      </Text>
    </XStack>
  )
}

/** A label · value fact row inside the detail pane. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <XStack justify="space-between" gap="$3" py="$1.5" borderBottomWidth={1} borderColor="$borderColor">
      <Text fontSize="$2" color="$color10">
        {label}
      </Text>
      <Text fontSize="$2" color="$color12" fontWeight="600" numberOfLines={1}>
        {value}
      </Text>
    </XStack>
  )
}

function MachineDetail({ m }: { m: VisorMachine }) {
  return (
    <YStack gap="$2">
      <Fact label="Status" value={m.status || DASH} />
      <Fact label="Region" value={m.region || DASH} />
      <Fact label="Type" value={m.type || DASH} />
      <Fact label="Resources" value={fmtSpec(m)} />
      <Fact label="GPU" value={m.gpu || DASH} />
      <Fact label="IP address" value={m.ip || DASH} />
      <Fact label="Created" value={m.createdAt ? new Date(m.createdAt).toLocaleString() : DASH} />
      <Fact label="Cost" value={fmtHourly(m.costHourlyUsd)} />
      <Fact label="Machine ID" value={m.id} />
    </YStack>
  )
}

const launchDocs = () => {
  if (typeof window !== 'undefined') window.open(`${config.docsUrl}/vm`, '_blank', 'noopener')
}

export function CustomerMachines() {
  const detail = useDetailPane()
  const [rows, setRows] = useState<VisorMachine[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<VisorError | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await VisorApi.machines())
      setError(null)
    } catch (e) {
      setError(interpretVisorError(e))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const machineColor = productColorHex('machines')
  const openDetail = (m: VisorMachine) =>
    detail.open({
      title: m.name || m.id,
      subtitle: `${m.type || 'machine'}${m.region ? ` · ${m.region}` : ''}`,
      icon: Server,
      iconColor: machineColor,
      content: <MachineDetail m={m} />,
      footer: (
        <>
          <Button flex={1} icon={<RefreshCw size={15} />} onPress={() => void load()}>
            Refresh
          </Button>
        </>
      ),
    })

  const columns: Column<VisorMachine>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (m) => (
        <XStack items="center" gap="$2" minW={0}>
          <Server size={16} color={asColor(machineColor)} />
          <YStack minW={0}>
            <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
              {m.name || m.id}
            </Text>
            <Text fontSize="$1" color="$color10" numberOfLines={1}>
              {m.id}
            </Text>
          </YStack>
        </XStack>
      ),
    },
    { key: 'region', header: 'Region', width: 110, render: (m) => <Text fontSize="$3" color="$color11">{m.region || DASH}</Text> },
    {
      key: 'type',
      header: 'Type',
      width: 150,
      render: (m) => (
        <YStack minW={0}>
          <Text fontSize="$3" color="$color11" numberOfLines={1}>
            {m.type || DASH}
          </Text>
          <Text fontSize="$1" color="$color10">
            {fmtSpec(m)}
          </Text>
        </YStack>
      ),
    },
    { key: 'status', header: 'Status', width: 120, render: (m) => <StatusPill status={m.status} /> },
    { key: 'cost', header: 'Cost', width: 96, render: (m) => <Text fontSize="$3" color="$color12">{fmtHourly(m.costHourlyUsd)}</Text> },
  ]

  const header = (
    <PageHeader
      title="Machines"
      subtitle="Your compute machines across regions."
      actions={
        <XStack gap="$2">
          <Button size="$3" icon={<RefreshCw size={15} />} onPress={() => void load()} aria-label="Refresh">
            <Text display="none" $md={{ display: 'flex' }}>
              Refresh
            </Text>
          </Button>
          <Button size="$3" icon={<Rocket size={15} />} onPress={launchDocs}>
            Launch
          </Button>
        </XStack>
      }
    />
  )

  if (loading) {
    return (
      <>
        {header}
        <XStack p="$6" justify="center">
          <Spinner size="large" color="$color11" />
        </XStack>
      </>
    )
  }

  // Honest, customer-appropriate state — visor unreachable / not routed here. NOT
  // an infra "not configured" message.
  if (error) {
    return (
      <>
        {header}
        <EmptyState
          icon={Server}
          title="No machines yet"
          description={error.message}
          bullets={['Dedicated compute is managed by Hanzo.', 'Launch a machine to see it here — nothing is fabricated.']}
          primary={{ label: 'Launch a machine', onPress: launchDocs }}
          secondary={{ label: 'Compute docs', href: `${config.docsUrl}/vm` }}
        />
        <MachineCatalog />
      </>
    )
  }

  if (rows.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={Server}
          title="Launch your first machine"
          description="Dedicated compute machines run your workloads across regions. Launch one and it appears here — with real capacity, region, and cost."
          primary={{ label: 'Launch a machine', onPress: launchDocs }}
          secondary={{ label: 'Compute docs', href: `${config.docsUrl}/vm` }}
        />
        <MachineCatalog />
      </>
    )
  }

  return (
    <>
      {header}
      <DataTable columns={columns} rows={rows} rowKey={(m) => m.id} onRowPress={openDetail} />
    </>
  )
}
