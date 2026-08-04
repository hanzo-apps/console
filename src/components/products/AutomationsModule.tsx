'use client'

/**
 * Automations — the ONE native Connectors + Automations surface, rendered
 * IN-CONSOLE over cloud `/v1/automations/*` (`hanzoai/cloud` clients/automations)
 * through the `/v1` user-bearer proxy. This replaces the retired external
 * auto.hanzo.ai engine + its `/v1/auto` reverse proxy — one engine, one surface,
 * no link-out. `/auto` and `/automation` alias here (match-core).
 *
 * Three tabs (the registry `:tab` pattern, like Models/GPUs):
 *  - Flows       — the org's flows: create, enable/disable, run, delete. Honest
 *                  empty ("No flows yet · browse connectors to build one").
 *  - Connectors  — the go:embed'd 706-piece catalogue: search + category filter,
 *                  per-piece capabilities + auth. Always populated.
 *  - Runs        — recent durable runs (status, flow, started). Honest empty.
 *
 * Every read is org-scoped by the Bearer owner claim server-side, so a caller only
 * ever sees THEIR org's flows/runs. States are honest: loading, `BackendStateCard`
 * on a `/v1` failure, and real empty states — never fabricated rows.
 */
import { SubNav } from '~/components/ui/SubNav'
import { productSubpageSlug } from '~/lib/products/match'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Blocks, ListChecks, Play, Plus, Power, RefreshCw, Trash2, Workflow } from '@hanzogui/lucide-icons-2'

import { AutomationsApi, type AutomationFlow, type FlowRun, type Piece } from '~/lib/api/automations'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { EmptyState } from '~/components/ui/EmptyState'
import { FieldSelect, FieldText } from '~/components/ui/Field'
import { Loader } from '~/components/ui/Loader'
import { PageHeader } from '~/components/ui/PageHeader'
import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { SlideOver } from '~/components/ui/SlideOver'
import { StatusTag } from '~/components/ui/StatusTag'
import {
  authLabel,
  capabilitySummary,
  filterPieces,
  flowName,
  flowStatusText,
  formatWhen,
  pieceCategories,
  runStatusText,
  summarizeFlows,
  summarizeRuns,
  validateFlowName,
} from './automations/logic'
import { toneColor } from '~/components/ui/tone'

/** Cap the rendered connector cards; search/category narrow the rest (honest note). */
const CATALOG_RENDER_CAP = 240

export function AutomationsModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const tab = productSubpageSlug('automations', params.tab)
  const go = (id: string) => router.push(`/automations${id ? `/${id}` : ''}`)

  return (
    <YStack gap="$4" p="$4">
      <PageHeader
        title="Automations"
        subtitle="Build and run automation flows — 706 connectors on the native engine, in-console."
      />

      <SubNav id="automations" />

      {tab === 'connectors' ? <ConnectorsView /> : tab === 'runs' ? <RunsView /> : <FlowsView onBrowse={() => go('connectors')} />}
    </YStack>
  )
}

// ── shared bits ─────────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card p="$3" gap="$1" borderWidth={1} borderColor="$borderColor" minW={120} flex={1}>
      <Text fontSize="$7" fontWeight="800">
        {value}
      </Text>
      <Text fontSize="$2" color="$color11">
        {label}
      </Text>
    </Card>
  )
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <XStack justify="space-between" items="center" py="$1.5" borderBottomWidth={1} borderColor="$borderColor" gap="$3">
      <Text fontSize="$2" color="$color11">
        {label}
      </Text>
      <Text fontSize="$2" color="$color12" fontWeight="600" numberOfLines={1}>
        {value}
      </Text>
    </XStack>
  )
}

// ── Flows ───────────────────────────────────────────────────────────────────

function FlowsView({ onBrowse }: { onBrowse: () => void }) {
  const [flows, setFlows] = useState<AutomationFlow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<BackendState | null>(null)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createErr, setCreateErr] = useState<string | null>(null)
  const [selected, setSelected] = useState<AutomationFlow | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setFlows(await AutomationsApi.listFlows())
    } catch (e) {
      setError(classifyBackend(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const create = useCallback(async () => {
    const err = validateFlowName(name)
    if (err) {
      setCreateErr(err)
      return
    }
    setCreating(true)
    setCreateErr(null)
    try {
      const flow = await AutomationsApi.createFlow(name.trim())
      setName('')
      setFlows((prev) => [flow, ...prev])
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }, [name])

  const sum = summarizeFlows(flows)

  const columns: Column<AutomationFlow>[] = [
    { key: 'name', header: 'Flow', render: (f) => (
      <YStack>
        <Text fontSize="$3" fontWeight="600" numberOfLines={1}>{flowName(f)}</Text>
        <Text fontSize="$1" color="$color10" numberOfLines={1}>{f.id}</Text>
      </YStack>
    ) },
    { key: 'status', header: 'Status', width: 120, render: (f) => <StatusTag status={flowStatusText(f.status)} /> },
    { key: 'updated', header: 'Updated', width: 120, render: (f) => <Text fontSize="$2" color="$color11">{formatWhen(f.updated)}</Text> },
  ]

  return (
    <YStack gap="$4">
      <XStack gap="$2" flexWrap="wrap" items="flex-end">
        <YStack flex={1} minW={240} gap="$1">
          <Text fontSize="$2" color="$color11">New flow</Text>
          <FieldText value={name} onChange={setName} placeholder="e.g. New lead → Slack alert" disabled={creating} />
        </YStack>
        <PrimaryButton icon={<Plus size={16} />} onPress={() => void create()} disabled={creating || name.trim() === ''}>
          Create flow
        </PrimaryButton>
        <Button size="$3" icon={<RefreshCw size={16} />} onPress={() => void refresh()} disabled={loading}>
          Refresh
        </Button>
      </XStack>
      {createErr ? <Text fontSize="$2" color={toneColor('critical')}>{createErr}</Text> : null}

      {error ? (
        <BackendStateCard state={error} onRetry={() => void refresh()} hint="Flows you create here run on the native /v1/automations engine." />
      ) : loading ? (
        <Loader label="Loading your flows…" />
      ) : flows.length === 0 ? (
        <EmptyState
          icon={Workflow}
          title="No flows yet"
          description="Create your first flow above, then add a trigger and connector steps. Browse the 706-connector catalogue to see what you can wire together."
          bullets={[
            'Name a flow, then wire a trigger to one or more connector actions',
            'Enable it to run on a schedule, or run it on demand',
            'Credentials are sealed per org in KMS — never plaintext',
          ]}
          primary={{ label: 'Browse connectors', onPress: onBrowse }}
        />
      ) : (
        <>
          <XStack gap="$3" flexWrap="wrap">
            <StatCard label="Flows" value={sum.total} />
            <StatCard label="Enabled" value={sum.enabled} />
            <StatCard label="Disabled" value={sum.disabled} />
          </XStack>
          <DataTable<AutomationFlow> columns={columns} rows={flows} rowKey={(f) => f.id} onRowPress={(f) => setSelected(f)} />
        </>
      )}

      <SlideOver open={!!selected} onClose={() => setSelected(null)} title={selected ? flowName(selected) : 'Flow'} size={520}>
        {selected ? (
          <FlowDetail flow={selected} onChanged={(f) => setSelected(f)} onRefreshList={() => void refresh()} onDeleted={() => { setSelected(null); void refresh() }} />
        ) : null}
      </SlideOver>
    </YStack>
  )
}

function FlowDetail({
  flow,
  onChanged,
  onRefreshList,
  onDeleted,
}: {
  flow: AutomationFlow
  onChanged: (f: AutomationFlow) => void
  onRefreshList: () => void
  onDeleted: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const act = useCallback(
    async (name: string, fn: () => Promise<void>) => {
      setBusy(name)
      setErr(null)
      setNote(null)
      try {
        await fn()
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(null)
      }
    },
    [],
  )

  const enabled = flow.status === 'ENABLED'

  return (
    <YStack gap="$3">
      <XStack gap="$2" flexWrap="wrap">
        <Button
          icon={<Power size={16} />}
          onPress={() =>
            void act('toggle', async () => {
              const updated = enabled ? await AutomationsApi.disableFlow(flow.id) : await AutomationsApi.enableFlow(flow.id)
              onChanged({ ...flow, status: updated.status })
              onRefreshList()
              setNote(enabled ? 'Flow disabled.' : 'Flow enabled.')
            })
          }
          disabled={busy !== null}
        >
          {enabled ? 'Disable' : 'Enable'}
        </Button>
        <Button
          icon={<Play size={16} />}
          onPress={() =>
            void act('run', async () => {
              const run = await AutomationsApi.runFlow(flow.id)
              setNote(`Run started (${run.id}).`)
            })
          }
          disabled={busy !== null}
        >
          Run
        </Button>
        <Button
          icon={<Trash2 size={16} />}
          onPress={() =>
            void act('delete', async () => {
              await AutomationsApi.deleteFlow(flow.id)
              onDeleted()
            })
          }
          disabled={busy !== null}
        >
          Delete
        </Button>
      </XStack>
      {note ? <Text fontSize="$2" color={toneColor('positive')}>{note}</Text> : null}
      {err ? <Text fontSize="$2" color={toneColor('critical')}>{err}</Text> : null}

      <YStack gap="$0">
        <Fact label="Status" value={<StatusTag status={flowStatusText(flow.status)} />} />
        <Fact label="Flow ID" value={flow.id} />
        {flow.externalId ? <Fact label="External ID" value={flow.externalId} /> : null}
        <Fact label="Published version" value={flow.publishedVersionId || '—'} />
        <Fact label="Created" value={formatWhen(flow.created)} />
        <Fact label="Updated" value={formatWhen(flow.updated)} />
      </YStack>

      <Text fontSize="$1" color="$color10">
        Add trigger + connector steps in the flow builder. This engine runs your flow durably on the shared Hanzo Tasks
        engine, scoped to your org.
      </Text>
    </YStack>
  )
}

// ── Connectors (the 706-piece catalogue) ────────────────────────────────────

function PieceLogo({ piece }: { piece: Piece }) {
  const [broken, setBroken] = useState(false)
  const letter = (piece.displayName || piece.name || '?').charAt(0).toUpperCase()
  return (
    <YStack width={32} height={32} rounded="$3" bg="$color4" items="center" justify="center" overflow="hidden">
      {piece.logoUrl && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={piece.logoUrl} alt="" width={32} height={32} style={{ objectFit: 'contain' }} onError={() => setBroken(true)} />
      ) : (
        <Text fontSize="$4" fontWeight="700" color="$color11">
          {letter}
        </Text>
      )}
    </YStack>
  )
}

function PieceCard({ piece }: { piece: Piece }) {
  const cap = capabilitySummary(piece)
  return (
    <Card p="$3" gap="$2" borderWidth={1} borderColor="$borderColor" width={260} minW={260} flex={1}>
      <XStack gap="$2" items="center">
        <PieceLogo piece={piece} />
        <YStack flex={1} minW={0}>
          <Text fontSize="$3" fontWeight="700" numberOfLines={1}>
            {piece.displayName}
          </Text>
          <Text fontSize="$1" color="$color10" numberOfLines={1}>
            {authLabel(piece)}
          </Text>
        </YStack>
      </XStack>
      <Text fontSize="$2" color="$color11" numberOfLines={2}>
        {piece.description || '—'}
      </Text>
      {cap ? (
        <Text fontSize="$1" color="$color10" numberOfLines={1}>
          {cap}
        </Text>
      ) : null}
    </Card>
  )
}

function ConnectorsView() {
  const [pieces, setPieces] = useState<Piece[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<BackendState | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const cat = await AutomationsApi.pieces()
      setPieces(cat.pieces)
    } catch (e) {
      setError(classifyBackend(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const cats = pieceCategories(pieces)
  const catOption = category || 'All categories'
  const filtered = filterPieces(pieces, query, category)
  const shown = filtered.slice(0, CATALOG_RENDER_CAP)

  return (
    <YStack gap="$4">
      <XStack gap="$2" flexWrap="wrap" items="flex-end">
        <YStack flex={1} minW={220} gap="$1">
          <Text fontSize="$2" color="$color11">Search connectors</Text>
          <FieldText value={query} onChange={setQuery} placeholder="Slack, Gmail, Sheets…" />
        </YStack>
        <YStack width={220} gap="$1">
          <Text fontSize="$2" color="$color11">Category</Text>
          <FieldSelect
            value={catOption}
            options={['All categories', ...cats]}
            onChange={(v) => setCategory(v === 'All categories' ? '' : v)}
          />
        </YStack>
        <Button size="$3" icon={<RefreshCw size={16} />} onPress={() => void refresh()} disabled={loading}>
          Refresh
        </Button>
      </XStack>

      {error ? (
        <BackendStateCard state={error} onRetry={() => void refresh()} hint="The connector catalogue is served by the native /v1/automations engine." />
      ) : loading ? (
        <Loader label="Loading the connector catalogue…" />
      ) : pieces.length === 0 ? (
        <EmptyState icon={Blocks} title="No connectors reported" description="The catalogue lights up once the /v1/automations engine reports its pieces." />
      ) : (
        <>
          <Text fontSize="$2" color="$color11">
            {filtered.length === pieces.length
              ? `${pieces.length} connectors`
              : `${filtered.length} of ${pieces.length} connectors`}
            {shown.length < filtered.length ? ` · showing first ${shown.length}, refine to see more` : ''}
          </Text>
          {shown.length === 0 ? (
            <EmptyState icon={Blocks} title="No connectors match" description="Try a different search term or category." />
          ) : (
            <XStack gap="$3" flexWrap="wrap" items="stretch">
              {shown.map((p) => (
                <PieceCard key={p.name} piece={p} />
              ))}
            </XStack>
          )}
        </>
      )}
    </YStack>
  )
}

// ── Runs ────────────────────────────────────────────────────────────────────

function RunsView() {
  const [runs, setRuns] = useState<FlowRun[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<BackendState | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setRuns(await AutomationsApi.listRuns())
    } catch (e) {
      setError(classifyBackend(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const sum = summarizeRuns(runs)

  const columns: Column<FlowRun>[] = [
    { key: 'id', header: 'Run', render: (r) => <Text fontSize="$2" numberOfLines={1} className="mono">{r.id}</Text> },
    { key: 'flow', header: 'Flow', render: (r) => <Text fontSize="$2" color="$color11" numberOfLines={1}>{r.flowId}</Text> },
    { key: 'status', header: 'Status', width: 120, render: (r) => <StatusTag status={runStatusText(r.status)} /> },
    { key: 'started', header: 'Started', width: 120, render: (r) => <Text fontSize="$2" color="$color11">{formatWhen(r.startTime)}</Text> },
  ]

  return (
    <YStack gap="$4">
      <XStack justify="flex-end">
        <Button size="$3" icon={<RefreshCw size={16} />} onPress={() => void refresh()} disabled={loading}>
          Refresh
        </Button>
      </XStack>

      {error ? (
        <BackendStateCard state={error} onRetry={() => void refresh()} hint="Runs appear here when a flow executes on the native engine." />
      ) : loading ? (
        <Loader label="Loading recent runs…" />
      ) : runs.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="No runs yet"
          description="When you run a flow — on demand or on a schedule — its executions show up here with live status."
        />
      ) : (
        <>
          <XStack gap="$3" flexWrap="wrap">
            <StatCard label="Runs" value={sum.total} />
            <StatCard label="In flight" value={sum.running} />
            <StatCard label="Succeeded" value={sum.succeeded} />
            <StatCard label="Failed" value={sum.failed} />
          </XStack>
          <DataTable<FlowRun> columns={columns} rows={runs} rowKey={(r) => r.id} />
        </>
      )}
    </YStack>
  )
}
