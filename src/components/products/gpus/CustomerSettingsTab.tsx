'use client'

/**
 * GPUs · Settings (customer) — the org scope this surface acts in, where the org's GPU
 * capacity comes from, and its REAL per-org counts (accelerators available to launch,
 * GPU machines running, dedicated GPU clusters). Compute is a managed Hanzo Cloud
 * service (there is no customer-facing provider to "connect" — that is an admin
 * concern), so this is honest, informational state: real numbers + a launch affordance,
 * never an admin provider-connect form.
 */
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Rocket, Server } from '@hanzogui/lucide-icons-2'

import { currentOrg } from '~/lib/org-scope'
import { config } from '~/config'
import { FieldRow } from '@hanzo/ui/product'

const Row = ({ label, value }: { label: string; value: string }) => (
  <FieldRow label={label}>
    <Text fontSize="$3" color="$color12" pt="$2">{value}</Text>
  </FieldRow>
)

export function CustomerSettingsTab({
  accelerators,
  machines,
  clusters,
  onLaunch,
}: {
  accelerators: number
  machines: number
  clusters: number
  onLaunch: () => void
}) {
  return (
    <YStack gap="$4">
      <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" maxWidth={560}>
        <Text fontSize="$5" fontWeight="800">Organization</Text>
        <Row label="Active org" value={currentOrg()} />
        <Row label="Brand" value={config.brandName} />
        <Text fontSize="$2" color="$color10">
          GPU catalog, machines, clusters, and cost are scoped to the active org. Switch orgs from the top-bar switcher.
        </Text>
      </Card>

      <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" maxWidth={560}>
        <XStack items="center" gap="$2">
          <Server size={16} />
          <Text fontSize="$5" fontWeight="800">Compute</Text>
        </XStack>
        <Row label="Source" value="Hanzo Cloud · managed accelerators" />
        <Row label="Accelerators available" value={String(accelerators)} />
        <Row label="Your GPU machines" value={String(machines)} />
        <Row label="Dedicated GPU clusters" value={String(clusters)} />
        <Text fontSize="$2" color="$color10">
          GPUs are on-demand and fully managed — launch one in seconds, billed hourly to your Hanzo Cloud
          balance. Dedicated GPU clusters are optional (Clusters tab) for sustained capacity.
        </Text>
        <XStack>
          <Button size="$2" theme="light" icon={<Rocket size={15} />} onPress={onLaunch}>
            Launch a GPU
          </Button>
        </XStack>
      </Card>
    </YStack>
  )
}
