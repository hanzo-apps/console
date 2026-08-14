'use client'

/**
 * Inference — the endpoints dashboard for managed model-serving on Hanzo Cloud.
 *
 * ONE module, routed by the `:tab` param (declared as specific sub-pages in the
 * registry so `/inference/status` + `/inference/logs` render these rich, endpoint-
 * oriented views instead of the generic shared sub-page):
 *   - ''       → the dashboard: header + the "Connected to Hanzo Cloud" hero + the
 *                endpoints panel (left) + Usage Overview / Quick Actions / Need help
 *                (right rail, stacks below on narrow viewports).
 *   - 'status' → the per-endpoint health board (StatusBoard).
 *   - 'logs'   → the recorded inference activity stream (LogsView).
 * (`/inference/metrics` + `/inference/settings` stay on the SHARED per-product sub-page
 * system — Metrics is the rich per-product LivingOverview dashboard.)
 *
 * Every number is REAL (the managed model catalog + the org's deployed KServe
 * InferenceServices for endpoints, the commerce usage ledger for requests/tokens/spend)
 * or an honest "—" / empty state — never the mockup's placeholder figures.
 */
import { useRouter } from '~/lib/router'
import { XStack, YStack } from '@hanzo/gui'
import { Plus } from '@hanzogui/lucide-icons-2'

import { useDetailPane } from '~/components/DetailPane'
import { useInferenceData } from './inference/data'
import { AccentButton } from './inference/parts'
import { HeroCard } from './inference/HeroCard'
import { EndpointsPanel } from './inference/EndpointsPanel'
import { RightRail } from './inference/RightRail'
import { StatusBoard } from './inference/StatusBoard'
import { LogsView } from './inference/LogsView'
import { openDeployPane } from './inference/panes'
import { PageHeader } from '@hanzo/ui/product'

export function InferenceModule({ params }: { params: Record<string, string> }) {
  const tab = params.tab ?? ''
  if (tab === 'status') return <StatusBoard />
  if (tab === 'logs') return <LogsView />
  return <Dashboard />
}

function Dashboard() {
  const router = useRouter()
  const pane = useDetailPane()
  const data = useInferenceData()

  const nav = (path: string) => {
    pane.close()
    router.push(path)
  }
  const onDeploy = () => openDeployPane(pane, { onDeployed: data.reload, nav })

  return (
    <YStack gap="$4">
      <PageHeader
        title="Inference"
        subtitle="Deploy, scale, and monitor model-serving endpoints across Hanzo Cloud."
        actions={
          <AccentButton icon={<Plus size={16} />} onPress={onDeploy}>
            Deploy Endpoint
          </AccentButton>
        }
      />
      <HeroCard />
      <XStack gap="$4" flexWrap="wrap" items="flex-start">
        <YStack flex={2} minW={480} gap="$4">
          <EndpointsPanel data={data} />
        </YStack>
        <RightRail data={data} onDeploy={onDeploy} nav={nav} />
      </XStack>
    </YStack>
  )
}
