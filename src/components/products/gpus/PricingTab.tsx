'use client'

/**
 * GPUs · Pricing — Hanzo Cloud resells H100/A100 capacity over DigitalOcean (primary)
 * and AWS (secondary), metered hourly. We do NOT publish fabricated rates: live GPU
 * pricing comes from the compute-provider catalog (not yet connected), so this points
 * at the real surfaces — the in-console Plans & Pricing module and the gateway —
 * rather than invent a price table.
 */
import { Card, Text, XStack, YStack } from '@hanzo/gui'
import { Tag } from '@hanzogui/lucide-icons-2'
import { EmptyState } from '@hanzo/ui/product'


const MODELS = ['H100', 'A100', 'L40S', 'RTX 4090']

export function PricingTab({ onNav }: { onNav: (tab: string) => void }) {
  return (
    <YStack gap="$4">
      <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" maxWidth={680}>
        <XStack items="center" gap="$2">
          <Tag size={16} />
          <Text fontSize="$5" fontWeight="800">GPU pricing</Text>
        </XStack>
        <Text fontSize="$3" color="$color11">
          Hanzo Cloud GPUs are a metered resale layer over DigitalOcean GPU Droplets (primary) and AWS GPU
          instances (secondary), billed hourly to your account. Capacity types we target:
        </Text>
        <XStack gap="$2" flexWrap="wrap">
          {MODELS.map((m) => (
            <Text key={m} fontSize="$2" px="$3" py="$1.5" rounded="$3" bg="$color3" color="$color12" fontWeight="600">
              {m}
            </Text>
          ))}
        </XStack>
        <Text fontSize="$2" color="$color10">
          Live hourly rates publish here once the compute-provider catalog is connected. Until then, see the
          plans surface for current pricing — no indicative numbers are shown.
        </Text>
      </Card>

      <EmptyState
        icon={Tag}
        title="Live GPU rates are not published yet"
        description="Per-model hourly pricing appears here when the compute-provider (DigitalOcean / AWS) catalog is connected. Compare current plans meanwhile."
        primary={{ label: 'Compare plans & pricing', onPress: () => onNav('/plans') }}
        secondary={{ label: 'Gateway pricing', href: 'https://api.hanzo.ai' }}
      />
    </YStack>
  )
}
