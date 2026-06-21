'use client'

/**
 * Resource list — fetch + table + error, the shared shape of every list module.
 *
 * Four product modules (Models, Applications, Stores, Chat) are a header over a
 * fetched table; this captures that once. Providers is richer (edit surface) and
 * builds on DataTable directly rather than through here.
 */
import { useEffect, useState } from 'react'
import { Text, YStack } from '@hanzo/gui'

import { ApiError } from '~/lib/api'
import { PageHeader } from './PageHeader'
import { DataTable, type Column } from './DataTable'

export function ResourceList<T>({
  title,
  subtitle,
  columns,
  rowKey,
  load,
}: {
  title: string
  subtitle: string
  columns: Column<T>[]
  rowKey: (row: T) => string
  load: () => Promise<T[]>
}) {
  const [rows, setRows] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setLoading(true)
    load()
      .then((data) => {
        if (live) {
          setRows(data)
          setError(null)
        }
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof ApiError ? e.message : 'Failed to load')
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
    // load is stable per module instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <YStack gap="$4">
      <PageHeader title={title} subtitle={subtitle} />
      {error ? <Text color="$red10">{error}</Text> : null}
      <DataTable columns={columns} rows={rows} loading={loading} rowKey={rowKey} />
    </YStack>
  )
}
