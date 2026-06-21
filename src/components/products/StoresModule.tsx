'use client'

/**
 * Stores admin — list + edit, native on @hanzo/gui.
 *
 * Logic ported from StoreListPage.js + StoreEditPage.js + backend/StoreBackend.js:
 * the new-store template, the provider/chunking/chat field set, and the add/update/
 * delete + refresh-vectors calls. UI rebuilt clean on GUI primitives (no antd).
 *
 * Routing: `/stores` lists; `/stores/<name>` edits one.
 */
import { useRouter } from 'next/navigation'

import { StoreListView } from './stores/StoreListView'
import { StoreEditView } from './stores/StoreEditView'

export function StoresModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const name = params.name

  if (name) {
    return <StoreEditView name={decodeURIComponent(name)} onDone={() => router.push('/stores')} />
  }
  return <StoreListView onOpen={(s) => router.push(`/stores/${encodeURIComponent(s.name)}`)} />
}
