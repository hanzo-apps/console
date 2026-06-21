'use client'

import { StoreApi, type Store } from '~/lib/api'
import { ResourceList } from '~/components/ui/ResourceList'
import { useSession } from '~/lib/auth/session'

export function StoresModule(_props: { params: Record<string, string> }) {
  const { account } = useSession()
  const owner = account?.name ?? 'admin'

  return (
    <ResourceList<Store>
      title="Stores"
      subtitle="Knowledge stores and vectors."
      rowKey={(r) => `${r.owner}/${r.name}`}
      columns={[
        { key: 'name', header: 'Name' },
        { key: 'displayName', header: 'Display name' },
        { key: 'modelProvider', header: 'Model provider' },
        { key: 'embeddingProvider', header: 'Embedding provider' },
      ]}
      load={async () => await StoreApi.list(owner)}
    />
  )
}
