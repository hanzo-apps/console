'use client'

/**
 * Managed-resource console — the polished list/home surface for one provisioning
 * kind (SQL, KV, Datastore, S3, Vector, …). ONE renderer, tuned by
 * the per-kind `ResourceSpec`:
 *
 *   ┌ PageHeader (product · Refresh · primary Create) ─────────────────────────┐
 *   │ Stat row — REAL fleet count + ready/provisioning, then honest "—" usage   │
 *   │ Tabs: Overview · <instances> · Access · Metrics · [tool] · Settings       │
 *   │   Overview  recent instances + status donut + quick actions + quick start │
 *   │   Instances the full DataTable + the real create flow (password once)     │
 *   │   Access    connection guidance + real provision/connect snippets         │
 *   │   Metrics   honest usage tiles ("—") + the REAL status breakdown          │
 *   │   <tool>    Query/Browser/Explore — honestly deferred to your client      │
 *   │   Settings  configuration facts + danger zone                             │
 *   └───────────────────────────────────────────────────────────────────────────┘
 *
 * Every number is derived from the real `GET /v1/<kind>` list or rendered as an
 * honest "—"; create is the real `POST /v1/<kind>`; nothing is fabricated.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  ExternalLink,
  Gauge,
  Github,
  KeyRound,
  LayoutDashboard,
  Plus,
  RefreshCw,
  Settings2,
  Trash,
  X,
} from '@hanzogui/lucide-icons-2'

import {
  ApiError,
  ProvisioningApi,
  type Resource,
  type ResourceCreated,
  type ResourceKind,
} from '~/lib/api'
import { currentOrg } from '~/lib/org-scope'
import { useToast } from '~/components/ui/Toast'
import { slugError } from '~/lib/slug'

import {
  docsUrl,
  endpoint,
  fleetStats,
  quickstart,
  recent,
  repoUrl,
  specFor,
  statusSlices,
  type ResourceSpec,
} from './logic'
import {
  CopyField,
  DetailRow,
  iconComponent,
  iconFor,
  openHref,
  ResourceStat,
  SectionCard,
  SnippetBlock,
  StatusDonutCard,
  TabBar,
  type TabDef,
} from './parts'
import { BackendStateCard, DataTable, EmptyState, FieldRow, FieldText, PageHeader, PrimaryButton, StatusTag, classifyBackend, type BackendState, type Column } from '@hanzo/ui/product'

const fmtDate = (v?: string): string => {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString()
}

export type ResourceListProps = {
  kind: ResourceKind
  productLabel: string
  connectionHint?: string
  onOpen: (r: Resource) => void
}

export function ResourceListView({ kind, productLabel, connectionHint, onOpen }: ResourceListProps) {
  const spec = specFor(kind)
  const toast = useToast()

  const [rows, setRows] = useState<Resource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<BackendState | null>(null)
  const [tab, setTab] = useState<string>('overview')

  // Create flow (the real POST /v1/<kind>) — password surfaced once.
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<ResourceCreated | null>(null)
  const [createErr, setCreateErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await ProvisioningApi.list(kind)
      setRows(data ?? [])
    } catch (e) {
      setError(classifyBackend(e))
    } finally {
      setLoading(false)
    }
  }, [kind])

  useEffect(() => {
    void load()
  }, [load])

  const stats = useMemo(() => fleetStats(rows), [rows])
  const slices = useMemo(() => statusSlices(rows), [rows])
  const snippets = useMemo(
    () => quickstart(kind, spec, { firstName: rows[0]?.name, firstHost: rows[0]?.host ? endpoint(rows[0]) : undefined }),
    [kind, spec, rows],
  )

  const startCreate = () => {
    setShowCreate(true)
    setTab('instances')
  }

  const onCreate = async () => {
    const err = slugError(name)
    if (err) {
      setCreateErr(err)
      return
    }
    setCreating(true)
    setCreateErr(null)
    try {
      const res = await ProvisioningApi.create(kind, name)
      setCreated(res)
      toast.success(`Created ${res.name}`, 'Save the credentials shown — they appear only once.')
      setName('')
      setShowCreate(false)
      await load()
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : `Failed to create ${productLabel}`
      setCreateErr(msg)
      toast.error(`Could not create ${productLabel}`, msg)
    } finally {
      setCreating(false)
    }
  }

  const onDelete = async (r: Resource) => {
    if (typeof window !== 'undefined' && !window.confirm(`Delete "${r.name}"? This cannot be undone.`)) return
    try {
      await ProvisioningApi.remove(kind, r.name)
      setRows((rs) => rs.filter((x) => x.name !== r.name))
      toast.success(`Deleted ${r.name}`)
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : `Failed to delete "${r.name}"`
      toast.error(`Could not delete ${r.name}`, msg)
    }
  }

  const tabs: TabDef[] = [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard size={15} /> },
    { id: 'instances', label: spec.listNoun, icon: iconFor(spec.icon, 15) },
    { id: 'access', label: 'Access', icon: <KeyRound size={15} /> },
    { id: 'metrics', label: 'Metrics', icon: <Gauge size={15} /> },
    ...(spec.tool ? [{ id: spec.tool.id, label: spec.tool.label, icon: iconFor(spec.tool.icon, 15) }] : []),
    { id: 'settings', label: 'Settings', icon: <Settings2 size={15} /> },
  ]

  const nameErr = name ? slugError(name) : null

  return (
    <YStack gap="$4">
      <PageHeader
        title={productLabel}
        subtitle={`Provision and manage ${productLabel} ${spec.listNoun.toLowerCase()}.`}
        actions={
          <XStack gap="$2">
            <Button size="$2" icon={<RefreshCw size={15} />} onPress={() => void load()}>
              Refresh
            </Button>
            <PrimaryButton size="$2" icon={<Plus size={15} />} onPress={startCreate}>
              {spec.createLabel}
            </PrimaryButton>
          </XStack>
        }
      />

      {error && !loading ? (
        // On a load failure we show the honest error card only — no stat row, so
        // we never imply "zero instances" when we simply could not read the fleet.
        <BackendStateCard state={error} onRetry={() => void load()} hint={`endpoint · GET /v1/${kind}`} />
      ) : (
        <>
          {/* ── Stat row — REAL fleet headline + honest usage tiles ──────────── */}
          <XStack flexWrap="wrap" gap="$3">
            <ResourceStat
              label={spec.listNoun}
              value={loading ? null : String(stats.total)}
              loading={loading}
              icon={iconFor(spec.icon, 15)}
              sub={loading ? undefined : stats.since ? `since ${fmtDate(stats.since)}` : 'none yet'}
            />
            <ResourceStat
              label="Ready"
              value={loading ? null : String(stats.ready)}
              loading={loading}
              sub={
                loading
                  ? undefined
                  : stats.provisioning
                    ? `${stats.provisioning} provisioning`
                    : stats.error
                      ? `${stats.error} error`
                      : stats.total
                        ? 'all ready'
                        : '—'
              }
            />
            {spec.usageTiles.map((t) => (
              <ResourceStat key={t.key} label={t.label} value={null} loading={loading} />
            ))}
          </XStack>

          {created ? <CreatedReveal created={created} connectionHint={connectionHint ?? spec.connectHint} onDismiss={() => setCreated(null)} /> : null}

          <TabBar tabs={tabs} active={tab} onSelect={setTab} />

          {tab === 'overview' ? (
            <OverviewTab
              spec={spec}
              kind={kind}
              rows={rows}
              loading={loading}
              slices={slices}
              total={stats.total}
              snippets={snippets}
              onOpen={onOpen}
              onCreate={startCreate}
              onSeeAll={() => setTab('instances')}
              onRefresh={() => void load()}
            />
          ) : null}

          {tab === 'instances' ? (
            <InstancesTab
              spec={spec}
              rows={rows}
              loading={loading}
              showCreate={showCreate}
              name={name}
              nameErr={nameErr}
              createErr={createErr}
              creating={creating}
              onName={setName}
              onToggleCreate={() => setShowCreate((v) => !v)}
              onSubmit={() => void onCreate()}
              onOpen={onOpen}
              onDelete={(r) => void onDelete(r)}
            />
          ) : null}

          {tab === 'access' ? <AccessTab spec={spec} connectionHint={connectionHint ?? spec.connectHint} snippets={snippets} /> : null}

          {tab === 'metrics' ? <MetricsTab spec={spec} slices={slices} total={stats.total} kind={kind} /> : null}

          {spec.tool && tab === spec.tool.id ? (
            <ToolTab label={spec.tool.label} blurb={spec.tool.blurb} snippet={snippets[1]} />
          ) : null}

          {tab === 'settings' ? <SettingsTab spec={spec} kind={kind} /> : null}
        </>
      )}
    </YStack>
  )
}

// ── Created-credentials reveal (password shown ONCE) ──────────────────────────

function CreatedReveal({
  created,
  connectionHint,
  onDismiss,
}: {
  created: ResourceCreated
  connectionHint?: string
  onDismiss: () => void
}) {
  return (
    <Card p="$4" gap="$3.5" borderWidth={1} borderColor="$color7" bg="$color2">
      <YStack gap="$1">
        <Text fontSize="$5" fontWeight="800">
          {created.name} created — save your credentials now
        </Text>
        <Text fontSize="$3" color="$color12">
          The password is shown ONCE and cannot be retrieved later. Copy it somewhere safe before you dismiss this panel.
        </Text>
      </YStack>
      <CopyField label="Connection string" value={created.connectionString} />
      {created.password ? <CopyField label="Password" value={created.password} secret /> : null}
      {connectionHint ? (
        <Text fontSize="$2" color="$color10">
          {connectionHint}
        </Text>
      ) : null}
      <XStack>
        <Button self="flex-start" onPress={onDismiss}>
          I&apos;ve saved it — dismiss
        </Button>
      </XStack>
    </Card>
  )
}

// ── Overview tab ──────────────────────────────────────────────────────────────

function OverviewTab({
  spec,
  kind,
  rows,
  loading,
  slices,
  total,
  snippets,
  onOpen,
  onCreate,
  onSeeAll,
  onRefresh,
}: {
  spec: ResourceSpec
  kind: ResourceKind
  rows: Resource[]
  loading: boolean
  slices: ReturnType<typeof statusSlices>
  total: number
  snippets: ReturnType<typeof quickstart>
  onOpen: (r: Resource) => void
  onCreate: () => void
  onSeeAll: () => void
  onRefresh: () => void
}) {
  if (loading) {
    return (
      <XStack p="$6" justify="center">
        <Spinner size="large" color="$color11" />
      </XStack>
    )
  }
  if (total === 0) {
    return (
      <EmptyState
        icon={iconComponent(spec.icon)}
        title={`Create your first ${spec.instanceNoun}`}
        description={`Provision a managed ${spec.instanceNoun} by name — the connection string and password are returned once, at create.`}
        bullets={spec.bullets}
        primary={{ label: spec.createLabel, onPress: onCreate }}
        secondary={{ label: 'Documentation', href: docsUrl(kind) }}
      />
    )
  }

  const top = recent(rows, 6)
  return (
    <YStack gap="$4">
      <XStack flexWrap="wrap" gap="$4">
        <SectionCard
          title={`Recent ${spec.listNoun.toLowerCase()}`}
          flex={2}
          minW={320}
          actions={
            <Button size="$1" chromeless iconAfter={<ArrowRight size={14} />} onPress={onSeeAll}>
              View all
            </Button>
          }
        >
          <YStack>
            {top.map((r) => (
              <XStack
                key={r.id || r.name}
                py="$2.5"
                gap="$3"
                items="center"
                borderTopWidth={1}
                borderColor="$borderColor"
                hoverStyle={{ bg: '$color2' }}
                cursor="pointer"
                onPress={() => onOpen(r)}
              >
                <Text fontSize="$3" fontWeight="600" color="$color12" flex={1} numberOfLines={1}>
                  {r.name}
                </Text>
                <Text fontSize="$2" color="$color11" width={210} numberOfLines={1}>
                  {endpoint(r)}
                </Text>
                <StatusTag status={r.status} />
                <Text fontSize="$2" color="$color10" width={96} numberOfLines={1}>
                  {fmtDate(r.createdAt)}
                </Text>
              </XStack>
            ))}
          </YStack>
        </SectionCard>

        <YStack flex={1} minW={280} gap="$4">
          {slices.length ? <StatusDonutCard slices={slices} total={total} /> : null}
          <SectionCard title="Quick actions">
            <YStack gap="$2">
              <PrimaryButton size="$2" icon={<Plus size={15} />} onPress={onCreate}>
                {spec.createLabel}
              </PrimaryButton>
              <Button size="$2" icon={<RefreshCw size={15} />} onPress={onRefresh}>
                Refresh
              </Button>
              <Button size="$2" icon={<BookOpen size={15} />} iconAfter={<ExternalLink size={13} />} onPress={() => openHref(docsUrl(kind))}>
                Documentation
              </Button>
            </YStack>
          </SectionCard>
        </YStack>
      </XStack>

      <SectionCard title="Quick start">
        <XStack flexWrap="wrap" gap="$4">
          {snippets.map((s) => (
            <YStack key={s.title} flex={1} minW={300}>
              <SnippetBlock snippet={s} />
            </YStack>
          ))}
        </XStack>
      </SectionCard>
    </YStack>
  )
}

// ── Instances tab (the full table + the real create flow) ─────────────────────

function InstancesTab({
  spec,
  rows,
  loading,
  showCreate,
  name,
  nameErr,
  createErr,
  creating,
  onName,
  onToggleCreate,
  onSubmit,
  onOpen,
  onDelete,
}: {
  spec: ResourceSpec
  rows: Resource[]
  loading: boolean
  showCreate: boolean
  name: string
  nameErr: string | null
  createErr: string | null
  creating: boolean
  onName: (v: string) => void
  onToggleCreate: () => void
  onSubmit: () => void
  onOpen: (r: Resource) => void
  onDelete: (r: Resource) => void
}) {
  const columns: Column<Resource>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (r) => (
        <Button chromeless px="$0" onPress={() => onOpen(r)}>
          <Text fontSize="$3" fontWeight="600" color="$color12">
            {r.name}
          </Text>
        </Button>
      ),
    },
    { key: 'status', header: 'Status', width: 130, render: (r) => <StatusTag status={r.status} /> },
    {
      key: 'endpoint',
      header: 'Endpoint',
      width: 240,
      render: (r) => (
        <Text fontSize="$3" color="$color11" numberOfLines={1}>
          {endpoint(r)}
        </Text>
      ),
    },
    {
      key: 'createdAt',
      header: 'Created',
      width: 150,
      render: (r) => (
        <Text fontSize="$3" color="$color11">
          {fmtDate(r.createdAt)}
        </Text>
      ),
    },
    {
      key: 'action',
      header: '',
      width: 150,
      render: (r) => (
        <XStack gap="$2" justify="flex-end" flex={1}>
          <Button size="$2" iconAfter={<ChevronRight size={14} />} onPress={() => onOpen(r)}>
            Manage
          </Button>
          <Button size="$2" icon={<Trash size={14} />} onPress={() => onDelete(r)} />
        </XStack>
      ),
    },
  ]

  return (
    <YStack gap="$3">
      {showCreate ? (
        <Card p="$4" gap="$3" borderWidth={1} borderColor="$color7" bg="$color1">
          <XStack justify="space-between" items="center">
            <Text fontSize="$5" fontWeight="700">
              {spec.createLabel}
            </Text>
            <Button size="$1" chromeless icon={<X size={14} />} onPress={onToggleCreate} />
          </XStack>
          <FieldRow label="Name">
            <YStack gap="$1.5" flex={1}>
              <FieldText value={name} onChange={onName} placeholder={spec.namePlaceholder} />
              <Text fontSize="$2" color={nameErr || createErr ? '$red10' : '$color10'}>
                {nameErr ?? createErr ?? 'Lowercase letters, numbers and hyphens. 2–40 chars.'}
              </Text>
            </YStack>
          </FieldRow>
          <XStack>
            <PrimaryButton
              icon={<Plus size={16} />}
              disabled={creating || !name || !!nameErr}
              onPress={onSubmit}
            >
              {creating ? 'Creating…' : spec.createLabel}
            </PrimaryButton>
          </XStack>
        </Card>
      ) : (
        <XStack>
          <Button self="flex-start" size="$2" icon={<Plus size={15} />} onPress={onToggleCreate}>
            {spec.createLabel}
          </Button>
        </XStack>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        rowKey={(r) => r.id || r.name}
        empty={`No ${spec.listNoun.toLowerCase()} yet. Create one above.`}
      />
    </YStack>
  )
}

// ── Access tab ────────────────────────────────────────────────────────────────

function AccessTab({
  spec,
  connectionHint,
  snippets,
}: {
  spec: ResourceSpec
  connectionHint?: string
  snippets: ReturnType<typeof quickstart>
}) {
  return (
    <YStack gap="$4">
      <SectionCard title="Connection">
        <Text fontSize="$3" color="$color11">
          {connectionHint}
        </Text>
        <Text fontSize="$2" color="$color10">
          The full connection string and password are returned ONCE, when you create a {spec.instanceNoun}. They are
          never re-fetched — if you lose them, rotate the credential from your client or recreate the {spec.instanceNoun}.
          Tenancy is enforced server-side: every request is scoped to your organization.
        </Text>
      </SectionCard>
      <SectionCard title="Quick start">
        <XStack flexWrap="wrap" gap="$4">
          {snippets.map((s) => (
            <YStack key={s.title} flex={1} minW={300}>
              <SnippetBlock snippet={s} />
            </YStack>
          ))}
        </XStack>
      </SectionCard>
    </YStack>
  )
}

// ── Metrics tab (honest "—" usage + the REAL status breakdown) ────────────────

function MetricsTab({
  spec,
  slices,
  total,
  kind,
}: {
  spec: ResourceSpec
  slices: ReturnType<typeof statusSlices>
  total: number
  kind: ResourceKind
}) {
  return (
    <YStack gap="$4">
      <XStack flexWrap="wrap" gap="$3">
        {spec.usageTiles.map((t) => (
          <ResourceStat key={t.key} label={t.label} value={null} />
        ))}
      </XStack>
      <XStack flexWrap="wrap" gap="$4">
        {slices.length ? <StatusDonutCard slices={slices} total={total} /> : null}
        <SectionCard title="Usage metering" flex={2} minW={320}>
          <Text fontSize="$3" color="$color11">
            Usage series — {spec.usageTiles.map((t) => t.label.toLowerCase()).join(', ')} — appear here once the metering
            read API ships for {spec.listNoun.toLowerCase()}. The status breakdown above is live from{' '}
            <Text style={{ fontFamily: 'monospace' }}>GET /v1/{kind}</Text>. We never render placeholder numbers.
          </Text>
        </SectionCard>
      </XStack>
    </YStack>
  )
}

// ── Tool tab (Query / Browser / Explore — connect via your own client) ────────

function ToolTab({ label, blurb, snippet }: { label: string; blurb: string; snippet?: ReturnType<typeof quickstart>[number] }) {
  return (
    <SectionCard title={label}>
      <Text fontSize="$3" color="$color11">
        {blurb}. Connect with your own client using the connection string below — it works against the managed
        endpoint unchanged, so your existing tools and drivers just work.
      </Text>
      {snippet ? <SnippetBlock snippet={snippet} /> : null}
    </SectionCard>
  )
}

// ── Settings tab ──────────────────────────────────────────────────────────────

function SettingsTab({ spec, kind }: { spec: ResourceSpec; kind: ResourceKind }) {
  return (
    <YStack gap="$4">
      <SectionCard title="Configuration">
        <DetailRow label="Kind" value={kind} />
        <DetailRow label="Organization" value={currentOrg()} />
        <DetailRow label="Endpoint pattern" value={`<name>.${kind}.hanzo.ai`} />
        <DetailRow
          label="Source"
          value={
            <Button size="$1" chromeless icon={<Github size={13} />} iconAfter={<ExternalLink size={12} />} onPress={() => openHref(repoUrl(spec))}>
              {spec.repo}
            </Button>
          }
        />
        <DetailRow
          label="Documentation"
          value={
            <Button size="$1" chromeless icon={<BookOpen size={13} />} iconAfter={<ExternalLink size={12} />} onPress={() => openHref(docsUrl(kind))}>
              docs.hanzo.ai/{kind}
            </Button>
          }
        />
      </SectionCard>
      <SectionCard title="Danger zone">
        <Text fontSize="$3" color="$color11">
          Deleting a {spec.instanceNoun} is permanent and removes all of its data. Delete a specific {spec.instanceNoun}{' '}
          from the {spec.listNoun} tab or its detail page.
        </Text>
      </SectionCard>
    </YStack>
  )
}
