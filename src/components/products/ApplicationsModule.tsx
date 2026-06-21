'use client'

/**
 * Applications admin — list + edit with deploy/undeploy, native on @hanzo/gui.
 *
 * Logic ported from ApplicationListPage.js + ApplicationEditPage.js +
 * backend/ApplicationBackend.js: the new-application template, the field set
 * (template/namespace/parameters/status), and the deploy/undeploy lifecycle. UI
 * rebuilt clean on GUI primitives (no antd).
 *
 * Routing: `/applications` lists; `/applications/<name>` edits one.
 */
import { useRouter } from 'next/navigation'

import { ApplicationListView } from './applications/ApplicationListView'
import { ApplicationEditView } from './applications/ApplicationEditView'

export function ApplicationsModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const name = params.name

  if (name) {
    return (
      <ApplicationEditView
        name={decodeURIComponent(name)}
        onDone={() => router.push('/applications')}
      />
    )
  }
  return (
    <ApplicationListView onOpen={(a) => router.push(`/applications/${encodeURIComponent(a.name)}`)} />
  )
}
