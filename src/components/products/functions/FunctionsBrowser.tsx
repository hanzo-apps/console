'use client'

/**
 * The functions table + selected-function detail rail, with the selection state
 * they share. ONE browser used by both the Overview tab (below the charts) and the
 * dedicated Functions tab, so the table/rail wiring isn't duplicated (DRY). Pure
 * presentation over the real rows passed in.
 */
import { useState } from 'react'
import { XStack, YStack } from '@hanzo/gui'

import type { ServerlessFunction } from '~/lib/api/functions'
import { FunctionsTable } from './FunctionsTable'
import { DetailRail } from './DetailRail'

export function FunctionsBrowser({
  functions,
  loading,
  live,
  docsHref,
  onAfterDelete,
}: {
  functions: ServerlessFunction[]
  loading: boolean
  /** The inventory loaded over a real 200 — gates the rail's destructive actions. */
  live: boolean
  docsHref: string
  onAfterDelete: (name: string) => void
}) {
  const [selected, setSelected] = useState<string | null>(null)
  return (
    <XStack gap="$4" items="flex-start" flexWrap="wrap">
      <YStack flex={1} minW={320}>
        <FunctionsTable
          functions={functions}
          loading={loading}
          selected={selected}
          onSelect={(f) => setSelected(f.name)}
          empty={live ? 'No functions deployed yet.' : 'Connect the Functions backend to list functions.'}
        />
      </YStack>
      {selected ? (
        <DetailRail
          name={selected}
          live={live}
          docsHref={docsHref}
          onClose={() => setSelected(null)}
          onDeleted={(name) => {
            setSelected(null)
            onAfterDelete(name)
          }}
        />
      ) : null}
    </XStack>
  )
}
