'use client'

/**
 * Score Configs — list of score definitions (HIP-0106), native on @hanzo/gui.
 *
 * A score config defines a score's data type and its valid range (numeric) or
 * categories (categorical/boolean). Reads the REAL `/v1/o11y/score-configs`
 * surface; when the runtime is not initialized (503) or unrouted (404) it shows
 * an honest RuntimeNotice — never fabricated configs. Read-only here; configs are
 * authored where scores are recorded.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Text } from '@hanzo/gui'
import { RefreshCw } from '@hanzogui/lucide-icons-2'

import { O11yApi, type O11yPageMeta, type ScoreConfig } from '~/lib/api'
import { PageHeader } from '@hanzo/ui/product'
import { DataTable, type Column } from '@hanzo/ui/product'
import { RuntimeNotice } from './observability/RuntimeNotice'
import { Pager } from './observability/Pager'
import { Badge } from './observability/parts'
import { fmtDate } from './observability/format'

const PAGE_LIMIT = 50

/** A one-line summary of a config's valid range or categories. */
const rangeOf = (c: ScoreConfig): string => {
  if (c.categories && c.categories.length > 0) {
    const labels = c.categories.map((x) => x.label).join(', ')
    return `${c.categories.length} categories · ${labels}`
  }
  const hasMin = c.minValue !== undefined && c.minValue !== null
  const hasMax = c.maxValue !== undefined && c.maxValue !== null
  if (hasMin && hasMax) return `${c.minValue} – ${c.maxValue}`
  if (hasMin) return `≥ ${c.minValue}`
  if (hasMax) return `≤ ${c.maxValue}`
  return '—'
}

export function ScoreConfigsModule(_props: { params: Record<string, string> }) {
  const [rows, setRows] = useState<ScoreConfig[]>([])
  const [meta, setMeta] = useState<O11yPageMeta | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(async (p: number) => {
    setLoading(true)
    try {
      const res = await O11yApi.scoreConfigs({ page: p, limit: PAGE_LIMIT })
      setRows(res.data ?? [])
      setMeta(res.meta ?? null)
      setError(null)
    } catch (e) {
      setError(e)
      setRows([])
      setMeta(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(page)
  }, [load, page])

  const columns: Column<ScoreConfig>[] = [
    { key: 'name', header: 'Name', render: (c) => <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{c.name}</Text> },
    { key: 'dataType', header: 'Type', width: 120, render: (c) => <Badge label={c.dataType} /> },
    { key: 'range', header: 'Range / Categories', render: (c) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{rangeOf(c)}</Text> },
    { key: 'isArchived', header: 'Status', width: 110, render: (c) => (c.isArchived ? <Badge label="archived" /> : <Text fontSize="$3" color="$color11">active</Text>) },
    { key: 'createdAt', header: 'Created', width: 190, render: (c) => <Text fontSize="$3" color="$color11">{fmtDate(c.createdAt)}</Text> },
  ]

  return (
    <>
      <PageHeader
        title="Score Configs"
        subtitle="Score definitions — data type and valid range or categories."
        actions={
          <Button icon={<RefreshCw size={16} />} onPress={() => void load(page)}>
            Refresh
          </Button>
        }
      />

      {error ? (
        <RuntimeNotice surface="score-configs" error={error} />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={rows}
            loading={loading}
            rowKey={(c) => c.id}
            empty="No score configs yet. Define a score config to standardize how scores are recorded."
          />
          <Pager meta={meta} onPage={setPage} />
        </>
      )}
    </>
  )
}
