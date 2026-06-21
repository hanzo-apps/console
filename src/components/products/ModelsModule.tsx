'use client'

/**
 * Models admin — model-route list + create/edit, native on @hanzo/gui.
 *
 * Logic ported from ModelRouteListPage.js + ModelRouteEditPage.js +
 * backend/ModelRouteBackend.js: the route field set (provider/upstream/fallbacks/
 * pricing/flags), the new-route template, and the add/update/delete calls. UI
 * rebuilt clean on GUI primitives (no antd).
 *
 * Routing: `/models` lists; `/models/new` creates; `/models/<modelName>` edits.
 */
import { useRouter } from 'next/navigation'

import { ModelRouteListView } from './models/ModelRouteListView'
import { ModelRouteEditView } from './models/ModelRouteEditView'

export function ModelsModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const name = params.name

  if (name === 'new') {
    return <ModelRouteEditView modelName={null} onDone={() => router.push('/models')} />
  }
  if (name) {
    return (
      <ModelRouteEditView
        modelName={decodeURIComponent(name)}
        onDone={() => router.push('/models')}
      />
    )
  }
  return (
    <ModelRouteListView
      onOpen={(r) => router.push(`/models/${encodeURIComponent(r.modelName ?? '')}`)}
      onNew={() => router.push('/models/new')}
    />
  )
}
