'use client'

/**
 * GPUs · Settings — the org scope this surface acts in, and where GPU capacity comes
 * from. Connecting a provider has no backend yet, so that action is honestly disabled
 * with a tooltip; provider credentials live in KMS (a real in-console surface).
 */
import { Card, Text, XStack, YStack } from '@hanzo/gui'
import { KeyRound, Server } from '@hanzogui/lucide-icons-2'

import { currentOrg } from '~/lib/org-scope'
import { config } from '~/config'
import { FieldRow } from '~/components/ui/Field'
import { HintButton } from './charts'

const Row = ({ label, value }: { label: string; value: string }) => (
  <FieldRow label={label}>
    <Text fontSize="$3" color="$color12" pt="$2">{value}</Text>
  </FieldRow>
)

export function SettingsTab({ onNav }: { onNav: (to: string) => void }) {
  return (
    <YStack gap="$4">
      <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" maxWidth={560}>
        <Text fontSize="$5" fontWeight="800">Organization</Text>
        <Row label="Active org" value={currentOrg()} />
        <Row label="Brand" value={config.brandName} />
        <Text fontSize="$2" color="$color10">
          GPU inventory, clusters, and cost are scoped to the active org. Switch orgs from the top-bar switcher.
        </Text>
      </Card>

      <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" maxWidth={560}>
        <XStack items="center" gap="$2">
          <Server size={16} />
          <Text fontSize="$5" fontWeight="800">Compute providers</Text>
        </XStack>
        <Text fontSize="$3" color="$color11">
          Hanzo Cloud GPUs resell capacity over DigitalOcean (primary) and AWS (secondary). Connecting a provider
          lights up live inventory, telemetry, pricing, and alerts across this surface.
        </Text>
        <XStack gap="$2" flexWrap="wrap">
          <HintButton icon={<Server size={15} />} theme="light" disabled hint="The compute-provider connector is not available yet">
            Connect DigitalOcean
          </HintButton>
          <HintButton icon={<Server size={15} />} disabled hint="The compute-provider connector is not available yet">
            Connect AWS
          </HintButton>
        </XStack>
        <XStack>
          <HintButton icon={<KeyRound size={15} />} onPress={() => onNav('/secrets')}>
            Manage provider credentials in KMS
          </HintButton>
        </XStack>
      </Card>
    </YStack>
  )
}
