'use client'

/**
 * Customer machines — a tenant's OWN compute, read from the native `/v1/machines`
 * surface via the user-bearer `/v1` proxy (`VisorApi.machines()`, visor-backed,
 * org resolved from the Bearer owner). This is what a non-admin (a customer like a
 * demo user) sees under Compute › Machines: their real machines with a launch flow
 * (`LaunchDrawer`) and a terminate action (`DELETE /v1/machines/:id`), or a graceful
 * "launch one" / "managed compute" state — NEVER an infra "not configured" message
 * (that is only ever an admin concern; the admin fleet view lives in `MachinesModule`).
 *
 * A row opens the ONE right-side `DetailPane` (item detail slides out from the
 * right, full-screen on mobile) — no full-page nav.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { AlertTriangle, Lock, RefreshCw, Rocket, Server, Trash2 } from '@hanzogui/lucide-icons-2'

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
import { PageHeader } from '@hanzo/ui/product'
import { DataTable, type Column } from '@hanzo/ui/product'
import { EmptyState } from '@hanzo/ui/product'
import { useDetailPane } from '~/components/DetailPane'
import { asColor } from '@hanzo/ui/product'
import { BillingApi } from '~/lib/api/billing'
import { MachineCatalog } from './MachineCatalog'
import { LaunchDrawer } from './LaunchDrawer'
import { FundingNote } from './FundingNote'

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

export function CustomerMachines() {
  const detail = useDetailPane()
  const [rows, setRows] = useState<VisorMachine[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<VisorError | null>(null)
  // The org's spendable CREDIT balance (cents) that a non-GPU machine launches on —
  // best-effort, so the Machines page can state clearly that CPU compute is
  // credit-funded (no card). `null` until known → the note omits the figure.
  const [creditCents, setCreditCents] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    // Credit balance is enrichment for the funding note — never blocks the list.
    BillingApi.balance()
      .then((b) => setCreditCents(b.available))
      .catch(() => setCreditCents(null))
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

  // Terminate (destroy) a machine — real DELETE /v1/machines/:id, stops metering. Honest
  // confirm; on success the row is dropped and the list reloaded; a failure surfaces the
  // real backend message (no fabricated success).
  const terminate = async (m: VisorMachine) => {
    if (typeof window !== 'undefined' && !window.confirm(`Terminate "${m.name || m.id}"? This destroys the machine and stops billing.`)) return
    try {
      await VisorApi.terminate(m.id)
      detail.close()
      setRows((r) => r.filter((x) => x.id !== m.id))
      void load()
    } catch (e) {
      if (typeof window !== 'undefined') window.alert(`Could not terminate "${m.name || m.id}": ${e instanceof Error ? e.message : String(e)}`)
    }
  }

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
          <Button flex={1} theme="red" icon={<Trash2 size={15} />} onPress={() => void terminate(m)}>
            Terminate
          </Button>
        </>
      ),
    })

  // The REAL launch flow — the shared drawer (a machine is a `cpu` size); on success
  // the new machine is prepended and the list reloaded. An optional `preset` (from a
  // catalog size/region the customer tapped) preselects the drawer so a tap in the
  // catalog is one step from launch.
  const openLaunch = (preset?: { size?: string; region?: string }) =>
    detail.open({
      title: 'Launch a machine',
      subtitle: 'Pick a size and region',
      icon: Rocket,
      iconColor: machineColor,
      size: 520,
      content: (
        <LaunchDrawer
          kind="cpu"
          initialSize={preset?.size}
          initialRegion={preset?.region}
          onClose={detail.close}
          onLaunched={(m) => {
            detail.close()
            setRows((r) => [m, ...r.filter((x) => x.id !== m.id)])
            setError(null)
            void load()
          }}
        />
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
          <Button size="$3" theme="light" icon={<Rocket size={15} />} onPress={() => openLaunch()}>
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

  // A genuine 401 (no session) is a sign-in prompt.
  if (error?.kind === 'unauthorized') {
    return (
      <>
        {header}
        <EmptyState
          icon={Server}
          title="Sign in to view your machines"
          description={error.message}
          primary={{ label: 'Compute docs', href: `${config.docsUrl}/docs/machines` }}
        />
      </>
    )
  }

  // A permission (403) or transport failure (404 / 5xx / network) is NOT "you have
  // none" — surface it honestly. Rendering the empty "launch your first" state here
  // would mask a load/permission error as an empty list, contradicting the very
  // "nothing is fabricated" promise. A transient error offers Retry; a 403 does not.
  if (error) {
    const forbidden = error.kind === 'forbidden'
    return (
      <>
        {header}
        <EmptyState
          icon={forbidden ? Lock : AlertTriangle}
          title={forbidden ? 'Machines are not enabled for your account' : 'Could not load your machines'}
          description={error.message}
          primary={forbidden ? undefined : { label: 'Retry', onPress: () => void load() }}
          secondary={{ label: 'Compute docs', href: `${config.docsUrl}/docs/machines` }}
        />
      </>
    )
  }

  // A real 200 with zero machines: the CONNECTED "launch your first" state that shows
  // the live region + size catalog with real pricing below (proving the backend). Only
  // ever reached on a genuine empty list — never on an error.
  if (rows.length === 0) {
    return (
      <>
        {header}
        <FundingNote kind="cpu" creditCents={creditCents} />
        <EmptyState
          icon={Server}
          title="Launch your first machine"
          description="Dedicated compute machines run your workloads across regions. Launch one and it appears here — with real capacity, region, and cost. Managed on Hanzo Cloud."
          bullets={['Tap a size in the live catalog below to launch it.', 'CPU machines launch on your Hanzo credit balance — no card required; nothing is fabricated.']}
          primary={{ label: 'Launch a machine', onPress: () => openLaunch() }}
          secondary={{ label: 'Compute docs', href: `${config.docsUrl}/docs/machines` }}
        />
        <MachineCatalog onLaunch={openLaunch} />
      </>
    )
  }

  return (
    <>
      {header}
      <FundingNote kind="cpu" creditCents={creditCents} />
      <DataTable columns={columns} rows={rows} rowKey={(m) => m.id} onRowPress={openDetail} />
    </>
  )
}
