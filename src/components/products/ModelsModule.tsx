'use client'

import { ModelRouteApi, type ModelRoute } from '~/lib/api'
import { ResourceList } from '~/components/ui/ResourceList'
import { useSession } from '~/lib/auth/session'

export function ModelsModule(_props: { params: Record<string, string> }) {
  const { account } = useSession()
  const owner = account?.name ?? 'admin'

  return (
    <ResourceList<ModelRoute>
      title="Models"
      subtitle="Model routes and routing policy."
      rowKey={(r) => `${r.owner}/${r.name}`}
      columns={[
        { key: 'name', header: 'Name' },
        { key: 'modelName', header: 'Model' },
        { key: 'state', header: 'State', width: 120 },
      ]}
      load={async () => (await ModelRouteApi.list({ owner })).rows}
    />
  )
}
