'use client'

/**
 * Generic PaaS resource tab — ONE way the Containers console lists a Kubernetes
 * resource kind (pods, images, namespaces, events, containers) from the platform
 * control plane via the same-origin `/paas` proxy (admin-gated; service token
 * injected server-side). Each kind is just a `path` + a column preset; the loader,
 * tolerant array-unwrap, and honest states (loading / not-configured / unavailable
 * / empty / error) are shared.
 *
 * Tolerant by design: the platform's exact JSON shape per kind isn't pinned, so a
 * row is a loose record and each cell pulls the first present field (with an em-dash
 * fallback) — a field rename upstream degrades a cell, never the page. Nothing is
 * fabricated: an unreachable/absent endpoint shows the truthful card, never demo rows.
 */
import { useCallback, useEffect, useState } from 'react'
import { Spinner, Text, XStack } from '@hanzo/gui'

import { restGet } from '~/lib/api/client'
import { DataTable, type Column } from '@hanzo/ui/product'
import { StatusTag } from '@hanzo/ui/product'
import { interpretPlatformError, PlatformStateCard, type PlatformError } from '../platform/state'

export type Rec = Record<string, unknown>

const paas = (path: string) => `/paas/${path.replace(/^\/+/, '')}`

/** First present non-empty field as a display string, else '—'. */
export function pick(r: Rec, keys: string[]): string {
  for (const k of keys) {
    const v = r[k]
    if (typeof v === 'string' && v.trim()) return v
    if (typeof v === 'number' && Number.isFinite(v)) return String(v)
    if (typeof v === 'boolean') return v ? 'true' : 'false'
  }
  return '—'
}

/** First present finite number, else undefined. */
export function pickNum(r: Rec, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = r[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  }
  return undefined
}

/** Pull the first array found under any envelope key (or a bare array). */
function arrayUnder(payload: unknown, keys: string[]): Rec[] {
  if (Array.isArray(payload)) return payload as Rec[]
  if (payload && typeof payload === 'object') {
    const o = payload as Rec
    for (const k of keys) if (Array.isArray(o[k])) return o[k] as Rec[]
    // Some kinds nest under `items` (raw kube list) — accept that too.
    if (Array.isArray(o.items)) return o.items as Rec[]
  }
  return []
}

/** Compact relative age from an ISO/epoch timestamp (`3d`, `5h`, `12m`, `now`), or '—'. */
export function fmtAge(v: unknown): string {
  if (typeof v !== 'string' && typeof v !== 'number') return '—'
  const d = new Date(typeof v === 'number' ? v : /^\d+$/.test(v) ? Number(v) * 1000 : v)
  const t = d.getTime()
  if (Number.isNaN(t)) return '—'
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

const txt = (s: string) => (
  <Text fontSize="$3" color="$color11" numberOfLines={1}>{s}</Text>
)

// ── Column presets per kind (tolerant field lists) ──────────────────────────

export const PODS_COLUMNS: Column<Rec>[] = [
  { key: 'name', header: 'Pod', render: (r) => <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{pick(r, ['name', 'podName', 'metadata.name'])}</Text> },
  { key: 'namespace', header: 'Namespace', width: 150, render: (r) => txt(pick(r, ['namespace', 'ns'])) },
  { key: 'status', header: 'Status', width: 120, render: (r) => <StatusTag status={pick(r, ['status', 'phase', 'state'])} /> },
  { key: 'ready', header: 'Ready', width: 80, render: (r) => txt(pick(r, ['ready', 'readyContainers'])) },
  { key: 'restarts', header: 'Restarts', width: 90, render: (r) => txt(String(pickNum(r, ['restarts', 'restartCount']) ?? '—')) },
  { key: 'node', header: 'Node', width: 150, render: (r) => txt(pick(r, ['node', 'nodeName', 'host'])) },
  { key: 'age', header: 'Age', width: 70, render: (r) => txt(fmtAge(r.age ?? r.createdAt ?? r.startTime ?? r.creationTimestamp)) },
]

export const IMAGES_COLUMNS: Column<Rec>[] = [
  { key: 'repo', header: 'Repository', render: (r) => <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{pick(r, ['repository', 'name', 'image', 'repo'])}</Text> },
  { key: 'tag', header: 'Tag', width: 160, render: (r) => txt(pick(r, ['tag', 'version'])) },
  { key: 'digest', header: 'Digest', width: 160, render: (r) => txt(pick(r, ['digest', 'sha', 'id'])) },
  { key: 'size', header: 'Size', width: 110, render: (r) => txt(pick(r, ['size', 'sizeHuman'])) },
  { key: 'created', header: 'Pushed', width: 80, render: (r) => txt(fmtAge(r.created ?? r.createdAt ?? r.pushedAt)) },
]

export const NAMESPACES_COLUMNS: Column<Rec>[] = [
  { key: 'name', header: 'Namespace', render: (r) => <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{pick(r, ['name', 'namespace'])}</Text> },
  { key: 'status', header: 'Status', width: 120, render: (r) => <StatusTag status={pick(r, ['status', 'phase'])} /> },
  { key: 'workloads', header: 'Workloads', width: 110, render: (r) => txt(String(pickNum(r, ['workloads', 'apps', 'deployments', 'pods']) ?? '—')) },
  { key: 'age', header: 'Age', width: 80, render: (r) => txt(fmtAge(r.age ?? r.createdAt ?? r.creationTimestamp)) },
]

export const EVENTS_COLUMNS: Column<Rec>[] = [
  { key: 'type', header: 'Type', width: 100, render: (r) => <StatusTag status={pick(r, ['type', 'severity'])} /> },
  { key: 'reason', header: 'Reason', width: 150, render: (r) => <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{pick(r, ['reason'])}</Text> },
  { key: 'object', header: 'Object', width: 180, render: (r) => txt(pick(r, ['object', 'involvedObject', 'name'])) },
  { key: 'message', header: 'Message', render: (r) => txt(pick(r, ['message', 'note', 'msg'])) },
  { key: 'time', header: 'When', width: 80, render: (r) => txt(fmtAge(r.lastTimestamp ?? r.time ?? r.eventTime ?? r.createdAt)) },
]

export const CONTAINERS_COLUMNS: Column<Rec>[] = [
  { key: 'name', header: 'Name', render: (r) => <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{pick(r, ['name', 'id'])}</Text> },
  { key: 'image', header: 'Image', width: 220, render: (r) => txt(pick(r, ['image'])) },
  { key: 'node', header: 'Node', width: 140, render: (r) => txt(pick(r, ['node', 'nodeName'])) },
  { key: 'cpu', header: 'CPU', width: 90, render: (r) => txt(pick(r, ['cpu'])) },
  { key: 'memory', header: 'Memory', width: 100, render: (r) => txt(pick(r, ['memory', 'mem'])) },
  { key: 'status', header: 'Status', width: 120, render: (r) => <StatusTag status={pick(r, ['status', 'state'])} /> },
]

type State = { phase: 'loading' } | { phase: 'error'; error: PlatformError } | { phase: 'ready'; rows: Rec[] }

/** Load + render one platform resource kind with honest states. */
export function PaasResourceTab({
  path,
  arrayKeys,
  columns,
  empty,
  hint,
}: {
  path: string
  arrayKeys: string[]
  columns: Column<Rec>[]
  empty: string
  hint?: string
}) {
  const [state, setState] = useState<State>({ phase: 'loading' })

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const r = await restGet<unknown>(paas(path))
      setState({ phase: 'ready', rows: arrayUnder(r, arrayKeys) })
    } catch (e) {
      setState({ phase: 'error', error: interpretPlatformError(e) })
    }
  }, [path, arrayKeys])

  useEffect(() => { void load() }, [load])

  if (state.phase === 'loading') {
    return <XStack p="$4" gap="$2" items="center"><Spinner /><Text color="$color11">Loading…</Text></XStack>
  }
  if (state.phase === 'error') {
    return <PlatformStateCard error={state.error} onRetry={() => void load()} />
  }
  return (
    <DataTable
      columns={columns}
      rows={state.rows}
      rowKey={(r) => `${pick(r, ['id', 'uid', 'name', 'reason'])}:${pick(r, ['namespace', 'tag', 'object'])}`}
      empty={hint ? `${empty} ${hint}` : empty}
    />
  )
}
