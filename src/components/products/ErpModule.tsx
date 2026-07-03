'use client'

/**
 * ERP — accounting, inventory, sales, and HR on the canonical ERPNext (Frappe) backend,
 * surfaced IN the console. Honest by construction (verified against the live cluster +
 * the hanzoai/erp repo): ERP is a SINGLE shared per-brand Frappe instance and there is
 * NO ERP backend running today (`erp.<brand>` is 502). So this module:
 *
 *   - is ENTITLEMENT-GATED (server-side `/embed-status`): only the owning brand org / a
 *     global admin sees ERP — a customer org gets the honest provision panel, never the
 *     brand's ERP data (Frappe is single-tenant, not per-org isolated).
 *   - Overview — a REAL deploy: "Deploy ERP" drives `/v1/platform` to provision the
 *     ERPNext app for the org (idempotent create-project + create-app + deploy), showing
 *     the live deploy/build status. (A full ERPNext needs its bundled data services — the
 *     single-image deploy proves the real provisioning path; status reflects that honestly.)
 *   - Accounting / Items / Sales — NATIVE summary views over Frappe's REST
 *     (`/api/resource/<DocType>`); real rows the moment an instance is live, an honest
 *     "connect / deploy ERP" state until then — never fabricated.
 *   - Desk — the real ERPNext desk EMBEDDED (SSO iframe) once `erp.<brand>` is reachable.
 *
 * Binds to canonical ERPNext (real Frappe REST reads + the real PaaS deploy + the real
 * desk embed) — never reimplemented.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Boxes, Calculator, LayoutDashboard, Rocket, ShoppingCart, Users } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { EmbedApi, type EmbedStatus } from '~/lib/api/embed'
import { ErpApi, ERP_IMAGE, type ErpAccount, type ErpItem, type ErpSalesOrder } from '~/lib/api/erp'
import type { PaasApp } from '~/lib/api/paas'
import { fmtUsd, fmtAbs } from '~/lib/api/functions'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { StatusTag } from '~/components/ui/StatusTag'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { Loader } from '~/components/ui/Loader'
import { EmbeddedApp } from './embed/EmbeddedApp'
import { ProvisionPanel, type ProvisionFeature } from './embed/ProvisionPanel'

type Async<T> = { phase: 'loading' } | { phase: 'error'; error: BackendState } | { phase: 'ready'; data: T }

const MANAGES: ProvisionFeature[] = [
  { icon: Calculator, label: 'Accounting', body: 'General ledger, invoices, payments, and financial statements.' },
  { icon: Boxes, label: 'Inventory', body: 'Items, warehouses, stock levels, and valuation across your catalog.' },
  { icon: ShoppingCart, label: 'Sales & Buying', body: 'Sales and purchase orders, quotations, and customer/supplier records.' },
  { icon: Users, label: 'HR & Payroll', body: 'Employees, attendance, leave, and payroll on one Business-OS.' },
]

const TABS = [
  { id: '', label: 'Overview', icon: LayoutDashboard },
  { id: 'accounting', label: 'Accounting', icon: Calculator },
  { id: 'items', label: 'Items', icon: Boxes },
  { id: 'sales', label: 'Sales Orders', icon: ShoppingCart },
  { id: 'desk', label: 'Desk', icon: LayoutDashboard },
] as const

export function ErpModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const [state, setState] = useState<Async<EmbedStatus>>({ phase: 'loading' })

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    EmbedApi.status('erp')
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])
  useEffect(() => { load() }, [load])

  const tab = useMemo(() => {
    const t = params.tab ?? ''
    return TABS.some((x) => x.id === t) ? t : ''
  }, [params.tab])

  if (state.phase === 'loading') return <Loader label="Checking ERP…" />
  if (state.phase === 'error') {
    return (
      <>
        <PageHeader title="ERP" subtitle="Accounting, inventory, and HR — your Business-OS ERP." />
        <BackendStateCard state={state.error} onRetry={load} hint="probe · GET /embed-status?app=erp" />
      </>
    )
  }

  const status = state.data

  // Not entitled (a customer org): honest provision panel — the shared brand ERP is not
  // per-org isolated, so a customer never reads it. Request a deployment instead.
  if (!status.entitled) {
    return (
      <ProvisionPanel
        title="ERP"
        subtitle="Accounting, inventory, sales, and HR — your Business-OS ERP on ERPNext."
        heroTitle="Deploy Hanzo ERP"
        heroBody={
          'Hanzo ERP is the full ERPNext (Frappe) business suite — accounting, inventory, sales, ' +
          'purchasing, manufacturing, and HR — signed in with your Hanzo identity. It isn’t provisioned ' +
          'for your organization yet; request a deployment and it will appear here, embedded in the console.'
        }
        features={MANAGES}
        intakeSlug="erp"
        intakeLabel="ERP"
        cta="Request ERP"
        docsHref={config.docsUrl ? `${config.docsUrl}/docs/erp` : undefined}
        sourceLabel="hanzoai/erp · ERPNext (Frappe)"
        note="Binds to the canonical ERPNext backend — ERP is not reimplemented in the console."
      />
    )
  }

  return (
    <YStack gap="$4">
      <PageHeader
        title="ERP"
        subtitle="Accounting, inventory, sales, and HR — your ERPNext desk, in the console."
        actions={
          <XStack gap="$1" flexWrap="wrap">
            {TABS.map((t) => (
              <XStack
                key={t.id || 'overview'}
                onPress={() => router.push(t.id ? `/erp/${t.id}` : '/erp')}
                cursor="pointer"
                items="center"
                gap="$1.5"
                px="$3"
                height={34}
                rounded="$3"
                borderWidth={1}
                borderColor="$borderColor"
                bg={t.id === tab ? '$color5' : 'transparent'}
                hoverStyle={{ bg: '$color3' }}
              >
                <t.icon size={15} />
                <Text fontSize="$3" fontWeight="600" color="$color12">{t.label}</Text>
              </XStack>
            ))}
          </XStack>
        }
      />
      {tab === 'accounting' ? <AccountingTab /> : null}
      {tab === 'items' ? <ItemsTab /> : null}
      {tab === 'sales' ? <SalesTab /> : null}
      {tab === 'desk' ? <DeskTab status={status} onRetry={load} /> : null}
      {tab === '' ? <OverviewTab status={status} /> : null}
    </YStack>
  )
}

// ── Overview — reachability + REAL deploy + what-it-is ────────────────────────
function OverviewTab({ status }: { status: EmbedStatus }) {
  return (
    <YStack gap="$4" maxW={900}>
      <DeployPanel reachable={status.reachable} origin={status.origin} />
      <XStack gap="$3" flexWrap="wrap">
        {MANAGES.map(({ icon: Icon, label, body }) => (
          <Card key={label} borderWidth={1} borderColor="$borderColor" p="$4" gap="$2" flex={1} minWidth={240}>
            <XStack gap="$2" items="center">
              <Icon size={18} />
              <Text fontSize="$4" fontWeight="700" color="$color12">{label}</Text>
            </XStack>
            <Text fontSize="$2" color="$color11">{body}</Text>
          </Card>
        ))}
      </XStack>
      <Text fontSize="$2" color="$color9">hanzoai/erp · ERPNext (Frappe) — bound to the canonical backend, not reimplemented.</Text>
    </YStack>
  )
}

/** The REAL deploy control — provisions the ERPNext app on Hanzo PaaS and shows live status. */
function DeployPanel({ reachable, origin }: { reachable: boolean; origin: string }) {
  const [app, setApp] = useState<PaasApp | null>(null)
  const [checking, setChecking] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setApp(await ErpApi.app())
    } catch {
      setApp(null) // platform not reachable / no project yet → deploy CTA
    } finally {
      setChecking(false)
    }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  const deploy = async () => {
    setBusy(true); setError(null); setNote(null)
    try {
      const d = await ErpApi.deploy()
      setNote(`Deployment started — status: ${d.status ?? 'queued'}.`)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the deployment.')
    } finally {
      setBusy(false)
    }
  }

  const appStatus = app?.phase || app?.status
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$5" gap="$3">
      <XStack items="center" gap="$2" flexWrap="wrap">
        <Text fontSize="$6" fontWeight="800" color="$color12">Hanzo ERP</Text>
        {reachable ? (
          <StatusTag status="live" />
        ) : app ? (
          <StatusTag status={appStatus || 'provisioning'} />
        ) : (
          <Text fontSize="$2" color="$color10">not deployed</Text>
        )}
      </XStack>
      <Text fontSize="$3" color="$color11">
        The full ERPNext (Frappe) business suite — accounting, inventory, sales, purchasing, and HR — signed in with
        your Hanzo identity. Deploy provisions the ERP app on Hanzo PaaS for your organization. A complete ERPNext also
        needs its bundled data services (MariaDB/Redis); the app’s status below reflects the real deployment.
      </Text>

      {reachable ? (
        <Text fontSize="$2" color="$green10">ERP is live at {origin} — open the Desk tab to use it.</Text>
      ) : null}
      {app ? (
        <XStack gap="$4" flexWrap="wrap">
          <Fact label="App" value={app.slug || app.name || 'erp'} />
          <Fact label="Image" value={`${ERP_IMAGE.repository}:${ERP_IMAGE.tag}`} />
          <Fact label="Status" value={appStatus || '—'} />
          {app.health ? <Fact label="Health" value={app.health} /> : null}
        </XStack>
      ) : null}

      <XStack gap="$2" items="center" flexWrap="wrap">
        <Button
          size="$3"
          theme="light"
          disabled={busy || checking}
          icon={busy ? <Spinner color="$color1" /> : <Rocket size={16} />}
          onPress={() => void deploy()}
        >
          {busy ? 'Deploying…' : app ? 'Redeploy ERP' : 'Deploy ERP'}
        </Button>
        <Button size="$3" chromeless disabled={checking || busy} onPress={() => void refresh()}>Refresh status</Button>
      </XStack>
      {note ? <Text fontSize="$2" color="$green10">{note}</Text> : null}
      {error ? <Text fontSize="$2" color="$red10">{error}</Text> : null}
    </Card>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <YStack minW={120}>
      <Text fontSize="$1" color="$color10">{label}</Text>
      <Text fontSize="$3" fontWeight="700" color="$color12" numberOfLines={1}>{value}</Text>
    </YStack>
  )
}

// ── Native Frappe summary views (honest-until-live) ──────────────────────────
/** Shared summary shell: fetch → honest "not connected" (502/401) / empty / table. */
function ErpSummary<T>({
  title,
  subtitle,
  load,
  columns,
  rowKey,
  empty,
  hint,
}: {
  title: string
  subtitle: string
  load: () => Promise<T[]>
  columns: Column<T>[]
  rowKey: (r: T) => string
  empty: string
  hint: string
}) {
  const [state, setState] = useState<Async<T[]>>({ phase: 'loading' })

  const run = useCallback(() => {
    setState({ phase: 'loading' })
    load()
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { run() }, [run])

  return (
    <YStack gap="$3">
      <YStack gap="$1">
        <Text fontSize="$5" fontWeight="800" color="$color12">{title}</Text>
        <Text fontSize="$2" color="$color10">{subtitle}</Text>
      </YStack>
      {state.phase === 'error' ? (
        <NotConnected error={state.error} onRetry={run} hint={hint} />
      ) : (
        <DataTable
          columns={columns}
          rows={state.phase === 'ready' ? state.data : []}
          loading={state.phase === 'loading'}
          rowKey={rowKey}
          empty={empty}
        />
      )}
    </YStack>
  )
}

/** Honest "ERP isn't connected yet" — a 502/401/403 on a summary read means no live
 *  ERP instance (or no Frappe credential). Points the user at the Overview deploy. */
function NotConnected({ error, onRetry, hint }: { error: BackendState; onRetry: () => void; hint: string }) {
  return (
    <Card p="$5" gap="$2" borderWidth={1} borderColor="$borderColor">
      <Text fontSize="$4" fontWeight="800" color="$color12">ERP isn’t connected yet</Text>
      <Text fontSize="$2" color="$color11">
        No live ERPNext instance answered this summary. Deploy ERP from the Overview tab; once it’s live, the real
        accounting, items, and sales data appear here — nothing is fabricated in the meantime.
      </Text>
      <Text fontSize="$1" color="$color9">{hint}</Text>
      <XStack pt="$2"><Button size="$2" onPress={onRetry}>Retry</Button></XStack>
      {/* keep the classified reason available to assistive tech / debugging */}
      <Text fontSize="$1" color="$color9">{error.message}</Text>
    </Card>
  )
}

function AccountingTab() {
  const columns: Column<ErpAccount>[] = [
    { key: 'account', header: 'Account', render: (r) => <Text fontSize="$3" fontWeight="600" color="$color12">{r.accountName || r.name}</Text> },
    { key: 'type', header: 'Type', width: 150, render: (r) => <Text fontSize="$3" color="$color11">{r.accountType || '—'}</Text> },
    { key: 'root', header: 'Root', width: 130, render: (r) => <Text fontSize="$3" color="$color11">{r.rootType || '—'}</Text> },
    { key: 'currency', header: 'Currency', width: 110, render: (r) => <Text fontSize="$3" color="$color11">{r.currency || '—'}</Text> },
  ]
  return (
    <ErpSummary<ErpAccount>
      title="Accounting"
      subtitle="Chart of accounts — the general-ledger accounts on your ERPNext instance."
      load={() => ErpApi.accounts()}
      columns={columns}
      rowKey={(r) => r.name}
      empty="No accounts yet."
      hint="endpoint · GET /erp/api/resource/Account (ERPNext)"
    />
  )
}

function ItemsTab() {
  const columns: Column<ErpItem>[] = [
    { key: 'item', header: 'Item', render: (r) => <Text fontSize="$3" fontWeight="600" color="$color12">{r.itemName || r.itemCode || r.name}</Text> },
    { key: 'code', header: 'Code', width: 160, render: (r) => <Text fontSize="$3" color="$color11">{r.itemCode || '—'}</Text> },
    { key: 'group', header: 'Group', width: 150, render: (r) => <Text fontSize="$3" color="$color11">{r.itemGroup || '—'}</Text> },
    { key: 'uom', header: 'UOM', width: 90, render: (r) => <Text fontSize="$3" color="$color11">{r.uom || '—'}</Text> },
    { key: 'valuation', header: 'Valuation', width: 120, render: (r) => <Text fontSize="$3" color="$color11">{r.valuationRate != null ? r.valuationRate.toLocaleString() : '—'}</Text> },
    { key: 'stock', header: 'Stock item', width: 110, render: (r) => <StatusTag status={r.disabled ? 'inactive' : r.stockItem ? 'active' : 'inactive'} /> },
  ]
  return (
    <ErpSummary<ErpItem>
      title="Items & Inventory"
      subtitle="Your catalog items — code, group, unit, and valuation on ERPNext."
      load={() => ErpApi.items()}
      columns={columns}
      rowKey={(r) => r.name}
      empty="No items yet."
      hint="endpoint · GET /erp/api/resource/Item (ERPNext)"
    />
  )
}

function SalesTab() {
  const columns: Column<ErpSalesOrder>[] = [
    { key: 'order', header: 'Order', width: 160, render: (r) => <Text fontSize="$3" fontWeight="600" color="$color12">{r.name}</Text> },
    { key: 'customer', header: 'Customer', render: (r) => <Text fontSize="$3" color="$color11">{r.customer || '—'}</Text> },
    { key: 'date', header: 'Date', width: 130, render: (r) => <Text fontSize="$3" color="$color11">{fmtAbs(r.date)}</Text> },
    { key: 'total', header: 'Total', width: 130, render: (r) => <Text fontSize="$3" color="$color11">{r.grandTotal != null ? `${r.currency ? r.currency + ' ' : ''}${r.grandTotal.toLocaleString()}` : '—'}</Text> },
    { key: 'status', header: 'Status', width: 150, render: (r) => (r.status ? <StatusTag status={r.status} /> : <Text fontSize="$3" color="$color10">—</Text>) },
  ]
  return (
    <ErpSummary<ErpSalesOrder>
      title="Sales Orders"
      subtitle="Recent sales orders — customer, total, and status from ERPNext."
      load={() => ErpApi.salesOrders()}
      columns={columns}
      rowKey={(r) => r.name}
      empty="No sales orders yet."
      hint="endpoint · GET /erp/api/resource/Sales Order (ERPNext)"
    />
  )
}

// ── Desk — the real ERPNext desk embedded once reachable ─────────────────────
function DeskTab({ status, onRetry }: { status: EmbedStatus; onRetry: () => void }) {
  if (status.reachable) {
    return (
      <EmbeddedApp
        title="ERP Desk"
        subtitle="Your ERPNext desk, embedded with IAM single sign-on."
        src={status.embedUrl}
        openLabel="Open ERP"
        sourceLabel="hanzoai/erp"
        note="Your ERPNext desk, signed in with your Hanzo identity (IAM SSO)."
      />
    )
  }
  return (
    <Card p="$5" gap="$2" borderWidth={1} borderColor="$borderColor">
      <Text fontSize="$4" fontWeight="800" color="$color12">The ERP desk isn’t live yet</Text>
      <Text fontSize="$2" color="$color11">
        Deploy ERP from the Overview tab. Once {status.origin} is reachable, the full ERPNext desk embeds here, signed
        in with your Hanzo identity.
      </Text>
      <XStack pt="$2"><Button size="$2" onPress={onRetry}>Check again</Button></XStack>
    </Card>
  )
}
