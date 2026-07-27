'use client'

/**
 * The functions inventory table — search + namespace/status filters + pagination
 * over the REAL rows passed in, with row selection (drives the detail rail) and a
 * per-row menu. Pure presentation over `filterFunctions` / `paginate`; it invents
 * no rows and shows the shared inline empty when the (real) result set is empty.
 */
import { useMemo, useState } from 'react'
import { Button, Input, Popover, Text, XStack, YStack } from '@hanzo/gui'
import { ChevronRight, ExternalLink, MoreHorizontal, Trash } from '@hanzogui/lucide-icons-2'

import {
  filterFunctions,
  namespacesOf,
  paginate,
  fmtCompact,
  fmtPct,
  fmtDuration,
  fmtRelative,
  type ServerlessFunction,
} from '~/lib/api/functions'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { StatusTag } from '~/components/ui/StatusTag'
import { Pager } from '~/components/products/observability/Pager'
import { FieldSelect } from '~/components/ui/Field'
import { paper } from '~/components/ui/paper'

const PAGE_SIZE = 10

/** Per-row actions menu — View always; Delete only when the backend is live. */
function RowMenu({ fn, onSelect, onDelete }: { fn: ServerlessFunction; onSelect: () => void; onDelete?: () => void }) {
  const [open, setOpen] = useState(false)
  const close = (run: () => void) => () => {
    setOpen(false)
    run()
  }
  return (
    <Popover open={open} onOpenChange={setOpen} placement="bottom-end">
      <Popover.Trigger asChild>
        <Button size="$2" chromeless icon={<MoreHorizontal size={16} />} aria-label="Row menu" />
      </Popover.Trigger>
      <Popover.Content {...paper} p="$1.5" width={208}>
        <YStack gap="$0.5">
          <Button size="$2" justify="flex-start" chromeless icon={<ChevronRight size={14} />} onPress={close(onSelect)}>
            View detail
          </Button>
          {fn.endpoint ? (
            <Button
              size="$2"
              justify="flex-start"
              chromeless
              icon={<ExternalLink size={14} />}
              onPress={close(() => {
                if (typeof window !== 'undefined') window.open(fn.endpoint, '_blank', 'noopener')
              })}
            >
              Open endpoint
            </Button>
          ) : null}
          {onDelete ? (
            <Button size="$2" justify="flex-start" chromeless theme="red" icon={<Trash size={14} />} onPress={close(onDelete)}>
              Delete
            </Button>
          ) : null}
        </YStack>
      </Popover.Content>
    </Popover>
  )
}

export function FunctionsTable({
  functions,
  loading,
  selected,
  onSelect,
  onDelete,
  empty,
}: {
  functions: ServerlessFunction[]
  loading?: boolean
  selected?: string | null
  onSelect: (fn: ServerlessFunction) => void
  /** Provided only when the backend is live (real DELETE); absent → no delete affordance. */
  onDelete?: (fn: ServerlessFunction) => void
  empty?: string
}) {
  const [search, setSearch] = useState('')
  const [namespace, setNamespace] = useState('all')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)

  const namespaces = useMemo(() => ['all', ...namespacesOf(functions)], [functions])
  const statuses = useMemo(
    () => ['all', ...Array.from(new Set(functions.map((f) => f.status).filter(Boolean))).sort()],
    [functions],
  )

  const filtered = useMemo(
    () => filterFunctions(functions, { search, namespace, status }),
    [functions, search, namespace, status],
  )
  const pageState = paginate(filtered, page, PAGE_SIZE)
  const meta = { page: pageState.page, limit: PAGE_SIZE, totalItems: filtered.length, totalPages: pageState.totalPages }

  const columns: Column<ServerlessFunction>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (f) => (
        <Button chromeless px="$0" justify="flex-start" onPress={() => onSelect(f)}>
          <XStack gap="$1.5" items="center">
            <YStack width={6} height={6} rounded="$10" bg={selected === f.name ? '$color12' : 'transparent'} />
            <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
              {f.name}
            </Text>
          </XStack>
        </Button>
      ),
    },
    { key: 'namespace', header: 'Namespace', width: 120, render: (f) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{f.namespace}</Text> },
    { key: 'image', header: 'Image', width: 200, render: (f) => <Text fontSize="$2" color="$color10" numberOfLines={1}>{f.image ?? '—'}</Text> },
    { key: 'invocations7d', header: 'Invocations 7D', width: 130, render: (f) => <Text fontSize="$3" color="$color11">{fmtCompact(f.invocations7d)}</Text> },
    { key: 'successRate', header: 'Success rate', width: 120, render: (f) => <Text fontSize="$3" color="$color11">{fmtPct(f.successRate)}</Text> },
    { key: 'avgDurationMs', header: 'Avg duration', width: 120, render: (f) => <Text fontSize="$3" color="$color11">{fmtDuration(f.avgDurationMs)}</Text> },
    { key: 'lastDeployedAt', header: 'Last deployed', width: 130, render: (f) => <Text fontSize="$3" color="$color11">{fmtRelative(f.lastDeployedAt)}</Text> },
    { key: 'status', header: 'Status', width: 110, render: (f) => <StatusTag status={f.status} /> },
    {
      key: 'menu',
      header: '',
      width: 56,
      render: (f) => (
        <XStack justify="flex-end" flex={1}>
          <RowMenu fn={f} onSelect={() => onSelect(f)} onDelete={onDelete ? () => onDelete(f) : undefined} />
        </XStack>
      ),
    },
  ]

  return (
    <YStack gap="$3">
      <XStack gap="$2" flexWrap="wrap" items="center">
        <YStack flex={1} minW={220}>
          <Input
            size="$3"
            value={search}
            onChangeText={(v) => {
              setSearch(v)
              setPage(1)
            }}
            placeholder="Search functions by name, namespace, or image…"
            autoCapitalize="none"
          />
        </YStack>
        <XStack gap="$2" items="center">
          <YStack width={150}>
            <FieldSelect value={namespace} options={namespaces} onChange={(v) => { setNamespace(v); setPage(1) }} />
          </YStack>
          <YStack width={150}>
            <FieldSelect value={status} options={statuses} onChange={(v) => { setStatus(v); setPage(1) }} />
          </YStack>
        </XStack>
      </XStack>

      <DataTable
        columns={columns}
        rows={pageState.rows}
        loading={loading}
        rowKey={(f) => `${f.namespace}/${f.name}`}
        empty={empty ?? 'No functions match these filters.'}
      />
      <Pager meta={meta} onPage={setPage} />
    </YStack>
  )
}
