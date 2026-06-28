'use client'

/**
 * Pagination footer for an observability list — reads the `{ page, limit,
 * totalItems, totalPages }` meta the list endpoints return. Renders nothing when
 * there is no data; shows the row range always and prev/next when paginated.
 */
import { Button, Text, XStack } from '@hanzo/gui'
import { ChevronLeft, ChevronRight } from '@hanzogui/lucide-icons-2'

import type { O11yPageMeta } from '~/lib/api'

export function Pager({ meta, onPage }: { meta: O11yPageMeta | null; onPage: (page: number) => void }) {
  if (!meta || meta.totalItems === 0) return null
  const { page, limit, totalItems, totalPages } = meta
  const from = (page - 1) * limit + 1
  const to = Math.min(page * limit, totalItems)
  return (
    <XStack items="center" justify="space-between" gap="$3">
      <Text fontSize="$2" color="$color11">
        {from}–{to} of {totalItems}
      </Text>
      <XStack gap="$2" items="center">
        <Button size="$2" icon={<ChevronLeft size={14} />} disabled={page <= 1} onPress={() => onPage(page - 1)}>
          Prev
        </Button>
        <Text fontSize="$2" color="$color11">
          Page {page} / {Math.max(totalPages, 1)}
        </Text>
        <Button
          size="$2"
          iconAfter={<ChevronRight size={14} />}
          disabled={page >= totalPages}
          onPress={() => onPage(page + 1)}
        >
          Next
        </Button>
      </XStack>
    </XStack>
  )
}
