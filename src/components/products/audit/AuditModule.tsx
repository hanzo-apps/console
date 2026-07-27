'use client'

/**
 * Audit — the org's tamper-evident security trail. Enterprise-grade: server-side
 * filters (time range, actor, action, resource type + id, result), real pagination
 * over the server total, a per-event detail drawer that surfaces the full record
 * INCLUDING the hash-chain linkage (immutability evidence), and one-click CSV export
 * for a compliance review.
 *
 * Source: `GET /v1/audit` (cloud `clients/auditlog`) — the ORG-SCOPED read of the
 * SAME append-only, hash-chained store the admin god-view reads; the org is PINNED
 * server-side from the validated bearer, so an org admin sees ONLY their OWN org's
 * events. Honest states throughout — no fabricated rows, ever.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, Input, Text, XStack, YStack } from '@hanzo/gui'
import { RefreshCw, Download, Search, X, ChevronLeft, ChevronRight, ShieldCheck, Link2 } from '@hanzogui/lucide-icons-2'

import { PageHeader } from '@hanzo/ui/product'
import { DataTable, type Column } from '@hanzo/ui/product'
import { BackendStateCard, classifyBackend, type BackendState } from '@hanzo/ui/product'
import { SelectMenu } from '@hanzo/ui/product'
import { SlideOver } from '@hanzo/ui/product'
import { AuditApi, type AuditEvent, type AuditPage, type AuditQuery } from '~/lib/api/audit'
import { exportCSV } from '~/lib/csv'

const PAGE_SIZE = 50

type TimeRange = '24h' | '7d' | '30d' | 'all'
const RANGE_OPTIONS: { key: TimeRange; label: string }[] = [
  { key: '24h', label: 'Last 24h' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'all', label: 'All time' },
]
const RESULT_OPTIONS: { key: string; label: string }[] = [
  { key: 'success', label: 'Success' },
  { key: 'deny', label: 'Denied' },
  { key: 'error', label: 'Error' },
]

const sinceFor = (r: TimeRange): string | undefined => {
  if (r === 'all') return undefined
  const ms = r === '24h' ? 864e5 : r === '7d' ? 7 * 864e5 : 30 * 864e5
  return new Date(Date.now() - ms).toISOString()
}

const fmtTime = (v: string): string => {
  const d = new Date(v)
  return isNaN(d.getTime()) ? v || '—' : d.toLocaleString()
}

const resultColor = (result: string): `#${string}` =>
  result === 'success' ? '#7ee787' : result === 'deny' ? '#f0a868' : result === 'error' ? '#e5534b' : '#8b9bb4'

type Async<T> = { phase: 'loading' } | { phase: 'error'; error: BackendState } | { phase: 'ready'; data: T }

export function AuditModule(_props: { params: Record<string, string> }) {
  const [range, setRange] = useState<TimeRange>('7d')
  const [result, setResult] = useState<string | null>(null)
  const [action, setAction] = useState('')
  const [resource, setResource] = useState('')
  const [actor, setActor] = useState('')
  const [page, setPage] = useState(1)
  const [state, setState] = useState<Async<AuditPage>>({ phase: 'loading' })
  const [selected, setSelected] = useState<AuditEvent | null>(null)
  const [nonce, setNonce] = useState(0)

  // One serialized signature of every filter + page — the debounced effect key, so
  // rapid typing coalesces into a single fetch and paging/selects refetch cleanly.
  const query: AuditQuery = useMemo(
    () => ({
      action: action.trim() || undefined,
      resource: resource.trim() || undefined,
      sub: actor.trim() || undefined,
      result: result || undefined,
      since: sinceFor(range),
      pageSize: PAGE_SIZE,
      page,
    }),
    [action, resource, actor, result, range, page],
  )
  const sig = JSON.stringify(query)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    setState({ phase: 'loading' })
    timer.current = setTimeout(() => {
      AuditApi.list(JSON.parse(sig) as AuditQuery)
        .then((data) => setState({ phase: 'ready', data }))
        .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
    }, 250)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [sig, nonce])

  // Any filter change resets to page 1 (a stale page beyond the new result set would
  // show empty). Page changes themselves are excluded (they don't reset).
  const filterSig = `${action}|${resource}|${actor}|${result}|${range}`
  const firstFilter = useRef(filterSig)
  useEffect(() => {
    if (firstFilter.current !== filterSig) {
      firstFilter.current = filterSig
      setPage(1)
    }
  }, [filterSig])

  const rows = state.phase === 'ready' ? state.data.rows : []
  const total = state.phase === 'ready' ? state.data.total : 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const clearFilters = useCallback(() => {
    setAction('')
    setResource('')
    setActor('')
    setResult(null)
    setRange('7d')
    setPage(1)
  }, [])
  const hasFilters = action || resource || actor || result || range !== '7d'

  const columns: Column<AuditEvent>[] = [
    { key: 'time', header: 'Time', width: 190, render: (e) => <Text fontSize="$2" color="$color11">{fmtTime(e.time)}</Text> },
    { key: 'actor', header: 'Actor', width: 150, render: (e) => <Text fontSize="$3" color="$color12" numberOfLines={1}>{e.email || e.sub || '—'}</Text> },
    { key: 'action', header: 'Action', render: (e) => <Text fontSize="$3" color="$color12" numberOfLines={1}>{e.action || '—'}</Text> },
    { key: 'resource', header: 'Resource', render: (e) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{[e.resource, e.resourceId].filter(Boolean).join(' · ') || '—'}</Text> },
    { key: 'result', header: 'Result', width: 100, render: (e) => <Text fontSize="$2" fontWeight="700" color={resultColor(e.result)}>{e.result || '—'}</Text> },
    { key: 'status', header: 'Status', width: 80, align: 'right', mono: true, render: (e) => <Text fontSize="$2" color="$color11">{e.status || '—'}</Text> },
  ]

  const onExport = useCallback(() => {
    if (!rows.length) return
    exportCSV(
      `audit-page${page}`,
      ['Seq', 'Time', 'Actor', 'Email', 'Action', 'Resource', 'ResourceID', 'Method', 'Path', 'Result', 'Status', 'Reason', 'SourceIP', 'AuthMethod', 'IsAdmin', 'Hash', 'PrevHash'],
      rows.map((e) => [e.seq, e.time, e.sub, e.email, e.action, e.resource, e.resourceId, e.method, e.path, e.result, e.status, e.reason, e.sourceIp, e.authMethod, e.isAdmin, e.hash, e.prevHash]),
    )
  }, [rows, page])

  return (
    <>
      <PageHeader
        title="Audit"
        subtitle="Your organization's tamper-evident security trail — every access-controlled action, hash-chained and append-only. Filter, inspect, and export for a compliance review."
        actions={
          <XStack gap="$2" items="center">
            <Button size="$2" icon={<Download size={15} />} onPress={onExport} disabled={!rows.length} aria-label="Export audit CSV">
              Export
            </Button>
            <Button size="$2" icon={<RefreshCw size={15} />} onPress={() => setNonce((n) => n + 1)}>
              Refresh
            </Button>
          </XStack>
        }
      />

      {/* ── Filter bar ─────────────────────────────────────────────────────── */}
      <XStack items="center" gap="$2" flexWrap="wrap">
        <SelectMenu<TimeRange> options={RANGE_OPTIONS} value={range} onChange={(v) => setRange(v ?? 'all')} allLabel="All time" minWidth={140} />
        <SelectMenu options={RESULT_OPTIONS} value={result} onChange={setResult} allLabel="All results" minWidth={130} />
        <FilterInput value={action} onChange={setAction} placeholder="Action…" />
        <FilterInput value={resource} onChange={setResource} placeholder="Resource type…" />
        <FilterInput value={actor} onChange={setActor} placeholder="Actor…" />
        {hasFilters ? (
          <Button size="$2" chromeless icon={<X size={14} />} onPress={clearFilters}>
            Clear
          </Button>
        ) : null}
      </XStack>

      {state.phase === 'error' ? (
        <BackendStateCard state={state.error} onRetry={() => setNonce((n) => n + 1)} hint="endpoint · GET /v1/audit" />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={rows}
            loading={state.phase === 'loading'}
            rowKey={(e) => String(e.seq)}
            onRowPress={(e) => setSelected(e)}
            empty={hasFilters ? 'No audit events match these filters.' : 'No audit events recorded yet.'}
          />

          {/* ── Pagination ───────────────────────────────────────────────── */}
          <XStack items="center" justify="space-between" gap="$2" flexWrap="wrap" py="$1">
            <Text fontSize="$2" color="$color10">
              {total > 0 ? `${total.toLocaleString()} event${total === 1 ? '' : 's'} · page ${page} of ${totalPages}` : ''}
            </Text>
            <XStack items="center" gap="$2">
              <Button size="$2" icon={<ChevronLeft size={15} />} disabled={page <= 1 || state.phase === 'loading'} onPress={() => setPage((p) => Math.max(1, p - 1))}>
                Prev
              </Button>
              <Button size="$2" iconAfter={<ChevronRight size={15} />} disabled={page >= totalPages || state.phase === 'loading'} onPress={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </XStack>
          </XStack>
        </>
      )}

      {/* ── Detail drawer ──────────────────────────────────────────────────── */}
      <SlideOver
        open={selected != null}
        onClose={() => setSelected(null)}
        title="Audit event"
        icon={ShieldCheck}
        iconColor="#7ee787"
        ariaLabel="Audit event detail"
        size={460}
      >
        {selected ? <AuditDetail e={selected} /> : null}
      </SlideOver>
    </>
  )
}

/** One compact filter text input with a leading search glyph and a clear affordance. */
function FilterInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <XStack items="center" gap="$2" px="$2.5" height={34} rounded="$3" borderWidth={1} borderColor="$borderColor" bg="$color2" minW={170}>
      <Search size={14} opacity={0.6} />
      <Input flex={1} unstyled value={value} onChangeText={onChange} placeholder={placeholder} fontSize="$3" color="$color12" autoCapitalize="none" />
      {value ? <Button size="$1" chromeless icon={<X size={13} />} onPress={() => onChange('')} aria-label="Clear" /> : null}
    </XStack>
  )
}

/** The full record view + the hash-chain linkage (immutability evidence). */
function AuditDetail({ e }: { e: AuditEvent }) {
  return (
    <YStack gap="$3">
      <XStack items="center" gap="$2">
        <Text fontSize="$2" fontWeight="700" color={resultColor(e.result)}>{e.result || '—'}</Text>
        {e.status ? <Text fontSize="$2" color="$color10">HTTP {e.status}</Text> : null}
        <Text fontSize="$1" color="$color9">seq {e.seq}</Text>
      </XStack>

      <YStack gap="$1">
        <KV k="Time" v={fmtTime(e.time)} />
        <KV k="Actor" v={e.sub || '—'} />
        {e.email ? <KV k="Email" v={e.email} /> : null}
        <KV k="Action" v={e.action || '—'} />
        <KV k="Resource" v={[e.resource, e.resourceId].filter(Boolean).join(' · ') || '—'} />
        {e.method || e.path ? <KV k="Request" v={[e.method, e.path].filter(Boolean).join(' ')} mono /> : null}
        {e.reason ? <KV k="Reason" v={e.reason} /> : null}
        {e.sourceIp ? <KV k="Source IP" v={e.sourceIp} mono /> : null}
        {e.authMethod ? <KV k="Auth" v={`${e.authMethod}${e.isAdmin ? ' · admin' : ''}`} /> : null}
        {e.requestId ? <KV k="Request ID" v={e.requestId} mono /> : null}
        {e.userAgent ? <KV k="User agent" v={e.userAgent} /> : null}
      </YStack>

      {/* Tamper-evidence: the hash-chain linkage proves this record was not altered
          or reordered without detection (each hash covers the record + the prior hash). */}
      <Card p="$3" gap="$2" bg="$color2" borderWidth={1} borderColor="$borderColor">
        <XStack items="center" gap="$1.5">
          <Link2 size={13} opacity={0.7} />
          <Text fontSize="$2" fontWeight="700" color="$color12">Tamper-evident chain</Text>
        </XStack>
        <KV k="Hash" v={e.hash || '—'} mono wrap />
        <KV k="Prev hash" v={e.prevHash || '—'} mono wrap />
      </Card>
    </YStack>
  )
}

function KV({ k, v, mono, wrap }: { k: string; v: string; mono?: boolean; wrap?: boolean }) {
  return (
    <XStack gap="$3" items="flex-start" py="$1">
      <Text fontSize="$2" color="$color10" width={92}>{k}</Text>
      <Text fontSize="$2" color="$color12" flex={1} className={mono ? 'hz-mono' : undefined} numberOfLines={wrap ? undefined : 1}>
        {v}
      </Text>
    </XStack>
  )
}

