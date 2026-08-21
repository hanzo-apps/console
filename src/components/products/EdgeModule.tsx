'use client'

/**
 * Edge — globally-distributed edge compute nodes run by the platform.
 *
 * Cloud routes no edge-node inventory (HIP-0139), so the page says where a workload
 * runs today instead of polling an address that answers nothing and calling the
 * silence an empty fleet.
 */
import { Radio } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { EmptyState, PageHeader } from '@hanzo/ui/product'

export function EdgeModule(_props: { params: Record<string, string> }) {
  return (
    <>
      <PageHeader title="Edge" subtitle="Globally-distributed edge compute nodes." />

      <EmptyState
        icon={Radio}
        title="Managed by Hanzo"
        description="Edge compute runs your functions and containers close to the people calling them, on nodes Hanzo operates and does not hand out per org. There is nothing to provision: what you already deploy is what the edge serves."
        bullets={[
          'Deploy once — served from the edge location nearest each request',
          'Backed by the same functions + containers you already run',
        ]}
        primary={{ label: 'Edge docs', href: `${config.docsUrl}/docs/edge` }}
        secondary={{ label: 'Containers', onPress: () => { if (typeof window !== 'undefined') window.location.assign('/containers') } }}
      />
    </>
  )
}
