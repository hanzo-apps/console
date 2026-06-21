'use client'

import { ApplicationApi, type Application } from '~/lib/api'
import { ResourceList } from '~/components/ui/ResourceList'
import { useSession } from '~/lib/auth/session'

export function ApplicationsModule(_props: { params: Record<string, string> }) {
  const { account } = useSession()
  const owner = account?.name ?? 'admin'

  return (
    <ResourceList<Application>
      title="Applications"
      subtitle="Deployed applications."
      rowKey={(r) => `${r.owner}/${r.name}`}
      columns={[
        { key: 'name', header: 'Name' },
        { key: 'displayName', header: 'Display name' },
        { key: 'category', header: 'Category', width: 140 },
        { key: 'state', header: 'State', width: 120 },
      ]}
      load={async () => (await ApplicationApi.list({ owner })).rows}
    />
  )
}
