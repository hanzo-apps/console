'use client'

/**
 * Pagination footer for an observability list — reads the `{ page, limit,
 * totalItems, totalPages }` meta the list endpoints return.
 *
 * The page CONTROL is `Pagination` from `@hanzo/ui/product`: it offers numbered
 * jumps with an ellipsis, which prev/next alone never could — a reader 40 pages
 * into a trace list had to press Prev 40 times. What stays here is the sentence
 * only this surface can write, because only it knows the shape of its meta: the
 * row range, which answers "how far in am I" in a way a page number does not.
 *
 * Renders nothing when there is no data.
 */
import { Text, XStack } from '@hanzo/gui'
import { Pagination } from '@hanzo/ui/product'

import type { O11yPageMeta } from '~/lib/api'

export function Pager({ meta, onPage }: { meta: O11yPageMeta | null; onPage: (page: number) => void }) {
  if (!meta || meta.totalItems === 0) return null
  const { page, limit, totalItems, totalPages } = meta
  const from = (page - 1) * limit + 1
  const to = Math.min(page * limit, totalItems)
  return (
    <XStack items="center" justify="space-between" gap="$3" flexWrap="wrap">
      <Text fontSize="$2" color="$color11">
        {from}–{to} of {totalItems}
      </Text>
      <Pagination page={page} count={Math.max(totalPages, 1)} onChange={onPage} />
    </XStack>
  )
}
