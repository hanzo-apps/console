'use client'

/**
 * Providers admin — list + view/edit, native on @hanzo/gui.
 *
 * Logic ported from hanzoai/ai web/src/ProviderListPage.js + ProviderEditPage.js
 * + backend/ProviderBackend.js: the field set, the category→type→subType cascade,
 * conditional field visibility, and the get/update calls. UI rebuilt clean on GUI
 * primitives (no antd, no casibase JSX).
 *
 * Routing: `/providers` lists; `/providers/<name>` edits one. The module reads
 * the `name` route param to decide which view to show.
 */
import { useRouter } from '~/lib/router'

import { ProviderListView } from './providers/ProviderListView'
import { ProviderEditView } from './providers/ProviderEditView'
import { ProvidersExplore } from './providers/ProvidersExplore'

export function ProvidersModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const name = params.name

  // `/providers/manage` — the custom-provider CRUD (per-org overrides + Add).
  if (name === 'manage') {
    return <ProviderListView onOpen={(p) => router.push(`/providers/${encodeURIComponent(p.name)}`)} />
  }
  // `/providers/<name>` — view/edit one provider.
  if (name) {
    return (
      <ProviderEditView
        name={decodeURIComponent(name)}
        onDone={() => router.push('/providers')}
      />
    )
  }
  // `/providers` — the Explore grid (real provider catalog). "Add custom" → manage.
  return <ProvidersExplore onAddCustom={() => router.push('/providers/manage')} />
}
