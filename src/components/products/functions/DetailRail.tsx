'use client'

/**
 * The selected-function detail rail. Loads ONE function's real detail
 * (`GET /v1/functions/{name}`) and shows Overview / Metrics / Logs / Invocations /
 * Config tabs, About facts, its triggers, and recent invocations. Every panel has
 * honest loading / empty / error states (`BackendStateCard`) — never fabricated
 * facts, logs, or calls.
 *
 * Destructive/mutating actions are gated on `live` (the inventory loaded over a
 * real 200): when live, Delete calls the real `DELETE /v1/functions/{name}` behind
 * a confirm; when not, Edit/Delete are honest-disabled with a tooltip (they never
 * call a fabricated endpoint).
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { ExternalLink, Pencil, RefreshCw, Trash, X } from '@hanzogui/lucide-icons-2'

import {
  FunctionsApi,
  fmtAbs,
  fmtCompact,
  fmtDuration,
  fmtInt,
  fmtPct,
  fmtRelative,
  type FunctionDetail,
  type FunctionInvocation,
} from '~/lib/api/functions'
import { ApiError } from '~/lib/api'
import { BackendStateCard, classifyBackend, type BackendState } from '@hanzo/ui/product'
import { DataTable, type Column } from '@hanzo/ui/product'
import { StatusTag } from '@hanzo/ui/product'
import { useToast } from '@hanzo/ui/product'
import { DetailRow, Badge } from '~/components/products/observability/parts'
import { DisabledAction } from './parts'

type Async<T> = { phase: 'loading' } | { phase: 'error'; error: BackendState } | { phase: 'ready'; data: T }

const RAIL_TABS = ['Overview', 'Metrics', 'Logs', 'Invocations', 'Config'] as const
type RailTab = (typeof RAIL_TABS)[number]

const openExternal = (href: string) => {
  if (typeof window !== 'undefined') window.open(href, '_blank', 'noopener')
}

/** Status-code pill, tinted by class (2xx green · 4xx amber · 5xx red). */
function CodePill({ code }: { code?: number }) {
  if (code === undefined) return <Text fontSize="$2" color="$color10">—</Text>
  const color = code < 300 ? '#3fb950' : code < 500 ? '#d29922' : '#f85149'
  return (
    <Text fontSize="$1" px="$2" py="$1" rounded="$2" bg="$color3" color={color} fontWeight="700">
      {code}
    </Text>
  )
}

export function DetailRail({
  name,
  live,
  docsHref,
  onClose,
  onDeleted,
}: {
  name: string
  live: boolean
  docsHref: string
  onClose: () => void
  onDeleted: (name: string) => void
}) {
  const toast = useToast()
  const [state, setState] = useState<Async<FunctionDetail>>({ phase: 'loading' })
  const [tab, setTab] = useState<RailTab>('Overview')
  const [invocations, setInvocations] = useState<Async<FunctionInvocation[]> | null>(null)
  const [logs, setLogs] = useState<Async<string> | null>(null)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const data = await FunctionsApi.get(name)
      if (!data) {
        setState({ phase: 'error', error: { kind: 'unavailable', message: `Function "${name}" not found.` } })
        return
      }
      setState({ phase: 'ready', data })
    } catch (e) {
      setState({ phase: 'error', error: classifyBackend(e) })
    }
  }, [name])

  useEffect(() => {
    void load()
    setTab('Overview')
    setInvocations(null)
    setLogs(null)
  }, [load])

  // Lazy-load the heavier panels only when their tab is opened.
  useEffect(() => {
    if (tab === 'Invocations' && invocations === null) {
      setInvocations({ phase: 'loading' })
      FunctionsApi.invocations(name)
        .then((data) => setInvocations({ phase: 'ready', data }))
        .catch((e) => setInvocations({ phase: 'error', error: classifyBackend(e) }))
    }
    if (tab === 'Logs' && logs === null) {
      setLogs({ phase: 'loading' })
      FunctionsApi.logs(name)
        .then((data) => setLogs({ phase: 'ready', data }))
        .catch((e) => setLogs({ phase: 'error', error: classifyBackend(e) }))
    }
  }, [tab, name, invocations, logs])

  const onDelete = async () => {
    if (typeof window !== 'undefined' && !window.confirm(`Delete function "${name}"? This removes the function and its triggers. This cannot be undone.`)) return
    try {
      await FunctionsApi.remove(name)
      toast.success(`Deleted ${name}`)
      onDeleted(name)
    } catch (e) {
      toast.error(`Could not delete ${name}`, e instanceof ApiError ? e.message : String(e))
    }
  }

  const fn = state.phase === 'ready' ? state.data : null

  const invocationColumns: Column<FunctionInvocation>[] = [
    { key: 'statusCode', header: 'Code', width: 70, render: (r) => <CodePill code={r.statusCode} /> },
    { key: 'method', header: 'Method', width: 80, render: (r) => <Text fontSize="$2" color="$color11">{r.method ?? '—'}</Text> },
    { key: 'time', header: 'Time', render: (r) => <Text fontSize="$2" color="$color11" numberOfLines={1}>{fmtRelative(r.time)}</Text> },
    { key: 'durationMs', header: 'Duration', width: 90, render: (r) => <Text fontSize="$2" color="$color11">{fmtDuration(r.durationMs)}</Text> },
  ]

  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$3.5" gap="$3" width={400} minW={340} self="flex-start">
      {/* Header */}
      <XStack items="flex-start" justify="space-between" gap="$2">
        <YStack flex={1} gap="$1">
          <Text fontSize="$5" fontWeight="800" color="$color12" numberOfLines={1}>
            {name}
          </Text>
          {fn ? <StatusTag status={fn.status} /> : null}
        </YStack>
        <Button size="$2" chromeless icon={<X size={16} />} aria-label="Close detail" onPress={onClose} />
      </XStack>

      {/* Actions: View (open endpoint) · Edit · Delete — honest-gated */}
      <XStack gap="$2" flexWrap="wrap">
        {fn?.endpoint ? (
          <Button size="$2" icon={<ExternalLink size={14} />} onPress={() => openExternal(fn.endpoint as string)}>
            Open endpoint
          </Button>
        ) : null}
        <Button size="$2" icon={<RefreshCw size={14} />} onPress={() => void load()}>
          Refresh
        </Button>
        {live ? (
          <DisabledAction
            label="Edit"
            icon={<Pencil size={14} />}
            reason="Editing a function deploys a new revision from its spec — do it from the Functions CLI or the deploy guide so the change is versioned."
          />
        ) : (
          <DisabledAction label="Edit" icon={<Pencil size={14} />} reason="The Functions backend isn't connected on this deployment yet, so functions can't be edited from the console. Use the CLI." />
        )}
        {live ? (
          <Button size="$2" theme="red" icon={<Trash size={14} />} onPress={() => void onDelete()}>
            Delete
          </Button>
        ) : (
          <DisabledAction label="Delete" icon={<Trash size={14} />} reason="The Functions backend isn't connected on this deployment yet, so functions can't be deleted from the console. Use the CLI." />
        )}
      </XStack>

      {/* Rail tabs */}
      <XStack gap="$1" flexWrap="wrap">
        {RAIL_TABS.map((t) => (
          <Button
            key={t}
            size="$2"
            bg={t === tab ? '$color5' : 'transparent'}
            borderWidth={1}
            borderColor="$borderColor"
            onPress={() => setTab(t)}
          >
            {t}
          </Button>
        ))}
      </XStack>

      {state.phase === 'loading' ? (
        <Text fontSize="$3" color="$color11">Loading…</Text>
      ) : state.phase === 'error' ? (
        <BackendStateCard state={state.error} onRetry={() => void load()} hint={`endpoint · GET /v1/functions/${name}`} />
      ) : fn ? (
        <YStack gap="$3">
          {tab === 'Overview' ? (
            <>
              <YStack>
                <Text fontSize="$3" fontWeight="700" color="$color12" mb="$1">About</Text>
                <DetailRow label="Namespace" value={fn.namespace} />
                <DetailRow label="Image" value={fn.image ?? '—'} />
                <DetailRow label="Environment" value={fn.environment ?? '—'} />
                <DetailRow label="Endpoint" value={fn.endpoint ?? '—'} />
                <DetailRow label="Replicas" value={fmtInt(fn.replicas)} />
                <DetailRow label="Min / max replicas" value={`${fmtInt(fn.minReplicas)} / ${fmtInt(fn.maxReplicas)}`} />
                <DetailRow label="Timeout" value={fn.timeoutSec !== undefined ? `${fn.timeoutSec}s` : '—'} />
                <DetailRow label="Memory limit" value={fn.memoryLimit ?? '—'} />
                <DetailRow label="Environment vars" value={fn.envCount !== undefined ? `${fn.envCount}` : '—'} />
                <DetailRow label="Created" value={fmtAbs(fn.createdAt)} />
                <DetailRow label="Last deployed" value={fmtRelative(fn.lastDeployedAt)} />
              </YStack>

              <YStack gap="$1.5">
                <Text fontSize="$3" fontWeight="700" color="$color12">Triggers</Text>
                {fn.triggers.length ? (
                  <YStack gap="$1.5">
                    {fn.triggers.map((t) => (
                      <XStack key={t.id} items="center" justify="space-between" gap="$2" py="$1.5" borderBottomWidth={1} borderColor="$borderColor">
                        <XStack gap="$2" items="center" flex={1}>
                          <Badge label={t.type} />
                          <Text fontSize="$2" color="$color11" numberOfLines={1}>{t.target ?? t.name}</Text>
                        </XStack>
                        <Text fontSize="$1" color={t.enabled ? '#3fb950' : '$color10'}>{t.enabled ? 'enabled' : 'disabled'}</Text>
                      </XStack>
                    ))}
                  </YStack>
                ) : (
                  <Text fontSize="$2" color="$color10">No triggers on this function.</Text>
                )}
              </YStack>

              <YStack gap="$1.5">
                <Text fontSize="$3" fontWeight="700" color="$color12">Recent invocations</Text>
                <DataTable columns={invocationColumns} rows={fn.recentInvocations} rowKey={(r) => r.id} empty="No recent invocations." />
              </YStack>
            </>
          ) : null}

          {tab === 'Metrics' ? (
            <YStack>
              <DetailRow label="Invocations 7D" value={fmtCompact(fn.invocations7d)} />
              <DetailRow label="Success rate" value={fmtPct(fn.successRate)} />
              <DetailRow label="Avg duration" value={fmtDuration(fn.avgDurationMs)} />
              <DetailRow label="Errors 7D" value={fmtInt(fn.errors7d)} />
              <Text fontSize="$1" color="$color10" mt="$2">
                Headline metrics are read from the inventory. Per-function time-series appear here once the Functions metrics route is connected — no placeholder chart is shown.
              </Text>
            </YStack>
          ) : null}

          {tab === 'Logs' ? (
            logs === null || logs.phase === 'loading' ? (
              <Text fontSize="$2" color="$color11">Loading logs…</Text>
            ) : logs.phase === 'error' ? (
              <BackendStateCard state={logs.error} hint={`endpoint · GET /v1/functions/${name}/logs`} />
            ) : logs.data ? (
              <YStack maxH={360} overflow="scroll" bg="$color2" rounded="$3" p="$3">
                <Text fontSize="$1" color="$color11">{logs.data}</Text>
              </YStack>
            ) : (
              <Text fontSize="$2" color="$color10">No logs in the recent window.</Text>
            )
          ) : null}

          {tab === 'Invocations' ? (
            invocations === null || invocations.phase === 'loading' ? (
              <Text fontSize="$2" color="$color11">Loading invocations…</Text>
            ) : invocations.phase === 'error' ? (
              <BackendStateCard state={invocations.error} hint={`endpoint · GET /v1/functions/${name}/invocations`} />
            ) : (
              <DataTable columns={invocationColumns} rows={invocations.data} rowKey={(r) => r.id} empty="No invocations recorded yet." />
            )
          ) : null}

          {tab === 'Config' ? (
            <YStack gap="$2">
              <DetailRow label="Environment" value={fn.environment ?? '—'} />
              <DetailRow label="Environment vars" value={fn.envCount !== undefined ? `${fn.envCount} configured` : '—'} />
              <DetailRow label="Memory limit" value={fn.memoryLimit ?? '—'} />
              <DetailRow label="Timeout" value={fn.timeoutSec !== undefined ? `${fn.timeoutSec}s` : '—'} />
              <DetailRow label="Min / max replicas" value={`${fmtInt(fn.minReplicas)} / ${fmtInt(fn.maxReplicas)}`} />
              <Text fontSize="$1" color="$color10" mt="$1">
                Environment variable VALUES are never read or shown here (only the count). Manage secrets in the Secrets tab and KMS.
              </Text>
              <XStack>
                <Button size="$2" chromeless icon={<ExternalLink size={13} />} onPress={() => openExternal(docsHref)}>
                  Configuration guide
                </Button>
              </XStack>
            </YStack>
          ) : null}
        </YStack>
      ) : null}
    </Card>
  )
}
