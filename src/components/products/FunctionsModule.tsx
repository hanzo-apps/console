'use client'

/**
 * Functions — the "Hanzo Functions" product surface (serverless / FaaS). A polished
 * tabbed console over the REAL `hanzoai/functions` inventory: Overview · Functions ·
 * Deployments · Triggers · Secrets · Settings. The engine is **Fission** (Kubernetes-
 * native FaaS), branded "Hanzo Functions" — never the underlying OSS name.
 *
 * The inventory is loaded ONCE here (`FunctionsApi.list` → the documented same-origin
 * `GET /v1/functions`, with X-Org-Id stamped by the client) and shared to the tabs;
 * `live` records whether it loaded over a real 200, which gates destructive actions in
 * the detail rail. Every aggregate is DERIVED from real rows and the time-series/cost
 * come from `FunctionsApi.metrics`; until those routes are bound the page shows honest
 * loading/empty/not-connected states — never fabricated functions, invocations, or spend.
 *
 * Tabs map to the registry `:tab` route (`/functions/:tab`), the same pattern as GPUs
 * and Models. Style props use the v5 shorthand set (bg/p/px/py/gap/rounded/items/...).
 */
import { livingOverviewModule } from './overview/living/LivingOverviewModule'
import { SubNav } from '~/components/ui/SubNav'
import { productSubpageSlug } from '~/lib/products/match'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Text, XStack } from '@hanzo/gui'
import { BookOpen, Plus, RefreshCw, Terminal } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { useReloadOnFocus } from '~/lib/use-reload-on-focus'
import { FunctionsApi, type ServerlessFunction } from '~/lib/api/functions'
import { PageHeader } from '~/components/ui/PageHeader'
import { classifyBackend, BackendStateCard, type BackendState } from '~/components/ui/BackendState'
import { EngineBadge } from './functions/parts'
import { FunctionsBrowser } from './functions/FunctionsBrowser'
import { DeploymentsTab, TriggersTab, SecretsTab, SettingsTab } from './functions/tabs'

const openExternal = (href: string) => {
  if (typeof window !== 'undefined') window.open(href, '_blank', 'noopener')
}

/** Load the inventory once; `live` = it loaded over a real 200 (gates mutations). */
function useInventory() {
  const [functions, setFunctions] = useState<ServerlessFunction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<BackendState | null>(null)
  const [live, setLive] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const data = await FunctionsApi.list()
      setFunctions(data)
      setLive(true)
      setError(null)
    } catch (e) {
      setFunctions([])
      setLive(false)
      setError(classifyBackend(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  // Refetch when the operator returns to the tab, so a function deployed out-of-band
  // (the API / CLI / another tab) appears without a manual reload.
  useReloadOnFocus(reload)

  return { functions, loading, error, live, reload, setFunctions }
}

/** The index board — the ONE Functions overview (real inventory + metrics). */
const FunctionsLiving = livingOverviewModule('functions')

export function FunctionsModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const inv = useInventory()
  const tab = productSubpageSlug('functions', params.tab)
  const docsHref = config.docsUrl + '/docs/functions'

  const hint = 'endpoint · GET /v1/functions'

  // The inventory-load error short-circuits only the tabs that READ the inventory
  // (Overview, Functions). The other tabs run independent reads (Deployments/
  // Triggers/Secrets) or are useful offline (Settings shows the honest "not
  // connected" runtime + the deploy CLI), so they always render.
  const inventoryTab = tab === '' || tab === 'functions'

  // Removing a function locally keeps the shared inventory honest after a real delete.
  const onAfterDelete = useCallback(
    (name: string) => inv.setFunctions((rows) => rows.filter((f) => f.name !== name)),
    [inv],
  )

  return (
    <>
      <PageHeader
        title="Functions"
        subtitle="Event-driven serverless functions, deployed and invoked by the platform."
        actions={
          <>
            <Button size="$3" chromeless icon={<RefreshCw size={15} />} onPress={() => void inv.reload()}>
              Refresh
            </Button>
            <Button size="$3" chromeless icon={<Terminal size={15} />} onPress={() => openExternal(docsHref)}>
              CLI
            </Button>
            <Button size="$3" chromeless icon={<BookOpen size={15} />} onPress={() => openExternal(docsHref)}>
              Documentation
            </Button>
            <Button size="$3" theme="light" icon={<Plus size={15} />} onPress={() => router.push('/functions/settings')}>
              Deploy function
            </Button>
          </>
        }
      />

      {/* Brand tag — "Hanzo Functions" (Fission engine), never the OSS name */}
      <XStack items="center" gap="$2">
        <Text fontSize="$2" px="$2" py="$1" rounded="$10" bg="$color4" color="$color12" fontWeight="800">
          Hanzo Functions
        </Text>
        <EngineBadge />
        <Text fontSize="$1" color="$color10">
          Kubernetes-native serverless
        </Text>
      </XStack>

      {/* Tab strip */}
      <SubNav id="functions" />

      {/* A hard backend failure on the inventory is surfaced honestly on the tabs
          that depend on it; the per-tab reads and Settings render their own states. */}
      {inv.error && inventoryTab ? (
        <BackendStateCard state={inv.error} onRetry={() => void inv.reload()} hint={hint} />
      ) : tab === '' ? (
        <FunctionsLiving params={{}} />
      ) : tab === 'functions' ? (
        <FunctionsBrowser
          functions={inv.functions}
          loading={inv.loading}
          live={inv.live}
          docsHref={docsHref}
          onAfterDelete={onAfterDelete}
        />
      ) : tab === 'deployments' ? (
        <DeploymentsTab hint="endpoint · GET /v1/functions/deployments" />
      ) : tab === 'triggers' ? (
        <TriggersTab hint="endpoint · GET /v1/functions/triggers" />
      ) : tab === 'secrets' ? (
        <SecretsTab hint="endpoint · GET /v1/functions/secrets" docsHref={config.docsUrl + '/docs/kms'} />
      ) : (
        <SettingsTab functions={inv.functions} live={inv.live} docsHref={docsHref} />
      )}
    </>
  )
}
