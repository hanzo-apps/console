'use client'

/**
 * Inbound cross-surface deep-link. When the console is opened from another surface
 * (hanzo.app / hanzo.chat) with `?project=<iamProjectId>`, select that project as the
 * active scope AND land on its Platform hub detail — the mirror of the outbound
 * `?project=` links the hub emits. One shared key, both directions.
 *
 * `useSearchParams` needs a Suspense boundary (Next 15); this renders nothing.
 */
import { Suspense, useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRouter } from '~/lib/router'

import { useScope } from '~/lib/scope-context'
import { PROJECT_PARAM } from '~/lib/products/cross-surface'

function ProjectDeepLinkInner() {
  const sp = useSearchParams()
  const router = useRouter()
  const { selectProject } = useScope()
  const handled = useRef<string | null>(null)

  useEffect(() => {
    const id = (sp?.get(PROJECT_PARAM) || '').trim()
    if (!id || handled.current === id) return
    handled.current = id
    selectProject(id) // scope every module to it
    router.replace(`/platform/${encodeURIComponent(id)}`) // open its hub; drops ?project=
  }, [sp, selectProject, router])

  return null
}

export function ProjectDeepLink() {
  return (
    <Suspense fallback={null}>
      <ProjectDeepLinkInner />
    </Suspense>
  )
}
