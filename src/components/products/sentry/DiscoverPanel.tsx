'use client'

/**
 * Discover — the query/search builder over events (`POST /v1/sentry/discover`).
 * Compose field filters + aggregations + group-by over a time range, Run, and read
 * a real results table (columns derived from the response) plus a time-series chart.
 * Every row/point is the backend's own result — an empty query is an honest empty
 * table, a failed run is the shared honest `ErrorState`, never fabricated rows.
 */
import { useCallback, useMemo, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Play, Plus, X } from '@hanzogui/lucide-icons-2'

import { SentryApi, type DiscoverFilter, type DiscoverResult, type DiscoverRow, type Period, type SentryProject } from '~/lib/api/sentry'
import { LineChart } from '~/components/ui/Charts'
import { Panel } from '~/components/ui/Panel'
import { ErrorState, asApiError } from '~/components/ui/States'
import { PeriodPicker, ProjectPicker } from './parts'
import { DISCOVER_FIELDS, DISCOVER_OPS, DISCOVER_AGGREGATIONS, emptyFilter, statsToPoints, fmtCount } from './logic'
import { DataTable, FieldSelect, FieldText, PageHeader, type Column } from '@hanzo/ui/product'

export function DiscoverPanel({ projects }: { projects: SentryProject[] }) {
  const [filters, setFilters] = useState<DiscoverFilter[]>([emptyFilter()])
  const [aggregations, setAggregations] = useState<string[]>(['count()'])
  const [groupBy, setGroupBy] = useState<string[]>(['transaction'])
  const [orderBy, setOrderBy] = useState('')
  const [project, setProject] = useState('')
  const [period, setPeriod] = useState<Period>('24h')
  const [result, setResult] = useState<DiscoverResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const run = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await SentryApi.discover({
        project,
        period,
        // Only send filled filter rows (a blank value is "any").
        filters: filters.filter((f) => f.field && f.value.trim() !== ''),
        aggregations,
        groupBy,
        orderBy: orderBy || undefined,
        limit: 100,
      })
      setResult(res)
    } catch (e) {
      setError(e)
      setResult(null)
    } finally {
      setLoading(false)
    }
  }, [project, period, filters, aggregations, groupBy, orderBy])

  const setFilter = (i: number, patch: Partial<DiscoverFilter>) =>
    setFilters((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)))
  const toggle = (arr: string[], set: (v: string[]) => void, v: string) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])

  const orderOptions = useMemo(() => ['', ...aggregations, ...groupBy], [aggregations, groupBy])

  const columns: Column<DiscoverRow>[] = useMemo(() => {
    const fields = result?.fields ?? []
    return fields.map((f) => {
      const numeric = (result?.rows ?? []).some((r) => typeof r[f] === 'number')
      return {
        key: f,
        header: f,
        align: numeric ? 'right' : 'left',
        mono: numeric,
        render: (r: DiscoverRow) => {
          const v = r[f]
          return (
            <Text fontSize="$2" color="$color12" numberOfLines={1} className={numeric ? 'hz-mono' : undefined}>
              {typeof v === 'number' ? fmtCount(v) : v || '—'}
            </Text>
          )
        },
      }
    })
  }, [result])

  const series = result ? statsToPoints(result.series) : []

  return (
    <YStack gap="$4">
      <PageHeader
        title="Discover"
        subtitle="Build a query over your events — filter, aggregate, group by, and chart the result."
        actions={
          <Button size="$3" bg="$color5" borderWidth={1} borderColor="$borderColor" icon={<Play size={15} />} onPress={() => void run()}>
            Run query
          </Button>
        }
      />

      <Card p="$4" gap="$3.5" borderWidth={1} borderColor="$borderColor">
        {/* Scope */}
        <XStack gap="$3" items="center" flexWrap="wrap">
          <ProjectPicker projects={projects} value={project} onChange={setProject} />
          <PeriodPicker value={period} onChange={setPeriod} />
        </XStack>

        {/* Filters */}
        <YStack gap="$2">
          <Text fontSize="$2" color="$color11" fontWeight="600">
            Filters
          </Text>
          {filters.map((f, i) => (
            <XStack key={i} gap="$2" items="center" flexWrap="wrap">
              <YStack width={190}>
                <FieldSelect value={f.field} options={[...DISCOVER_FIELDS]} onChange={(v) => setFilter(i, { field: v })} />
              </YStack>
              <YStack width={110}>
                <FieldSelect value={f.op} options={[...DISCOVER_OPS]} onChange={(v) => setFilter(i, { op: v })} />
              </YStack>
              <YStack flex={1} minW={160}>
                <FieldText value={f.value} onChange={(v) => setFilter(i, { value: v })} placeholder="value" />
              </YStack>
              <Button
                size="$2"
                chromeless
                icon={<X size={15} />}
                aria-label="Remove filter"
                onPress={() => setFilters((fs) => (fs.length > 1 ? fs.filter((_, j) => j !== i) : [emptyFilter()]))}
              />
            </XStack>
          ))}
          <Button size="$2" self="flex-start" icon={<Plus size={14} />} onPress={() => setFilters((fs) => [...fs, emptyFilter()])}>
            Add filter
          </Button>
        </YStack>

        {/* Aggregations + group by */}
        <XStack gap="$5" flexWrap="wrap">
          <YStack gap="$2" flex={1} minW={240}>
            <Text fontSize="$2" color="$color11" fontWeight="600">
              Aggregations
            </Text>
            <XStack gap="$1.5" flexWrap="wrap">
              {DISCOVER_AGGREGATIONS.map((a) => (
                <Chip key={a} label={a} on={aggregations.includes(a)} onPress={() => toggle(aggregations, setAggregations, a)} />
              ))}
            </XStack>
          </YStack>
          <YStack gap="$2" flex={1} minW={240}>
            <Text fontSize="$2" color="$color11" fontWeight="600">
              Group by
            </Text>
            <XStack gap="$1.5" flexWrap="wrap">
              {DISCOVER_FIELDS.map((g) => (
                <Chip key={g} label={g} on={groupBy.includes(g)} onPress={() => toggle(groupBy, setGroupBy, g)} />
              ))}
            </XStack>
          </YStack>
        </XStack>

        {/* Order by */}
        <XStack gap="$2" items="center" flexWrap="wrap">
          <Text fontSize="$2" color="$color11" fontWeight="600" width={80}>
            Order by
          </Text>
          <YStack width={220}>
            <FieldSelect value={orderBy} options={orderOptions} placeholder="Default" onChange={setOrderBy} />
          </YStack>
        </XStack>
      </Card>

      {error ? (
        <ErrorState err={asApiError(error)} onRetry={() => void run()} />
      ) : result ? (
        <>
          {series.length >= 2 ? (
            <Panel title="Events over time" grow={false}>
              <LineChart data={series} height={200} formatValue={(v) => fmtCount(v)} />
            </Panel>
          ) : null}
          <DataTable<DiscoverRow>
            columns={columns.length ? columns : [{ key: '_', header: 'Result', render: () => <Text>—</Text> }]}
            rows={result.rows}
            loading={loading}
            rowKey={(r) => JSON.stringify(r)}
            empty="No results for this query. Adjust the filters, aggregation, or time range."
          />
        </>
      ) : (
        <Card p="$6" borderWidth={1} borderColor="$borderColor" items="center" gap="$2">
          <Text fontSize="$4" fontWeight="600" color="$color12">
            Build a query
          </Text>
          <Text fontSize="$3" color="$color11" text="center" maxW={420}>
            Pick filters, aggregations, and a group-by, then Run to explore your events. Results and a time-series chart appear here.
          </Text>
          <Button bg="$color5" borderWidth={1} borderColor="$borderColor" icon={<Play size={15} />} onPress={() => void run()}>
            Run query
          </Button>
        </Card>
      )}
    </YStack>
  )
}

/** A toggle chip for a multi-select set (aggregation / group-by). */
function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Button
      size="$2"
      bg={on ? '$color5' : 'transparent'}
      borderWidth={1}
      borderColor={on ? '$color8' : '$borderColor'}
      onPress={onPress}
    >
      <Text fontSize="$1" color={on ? '$color12' : '$color11'} className="hz-mono">
        {label}
      </Text>
    </Button>
  )
}
