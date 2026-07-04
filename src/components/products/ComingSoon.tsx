'use client'

/**
 * Coming-soon overview — the in-console surface for a catalog leaf that is a
 * real cloud primitive but does not yet have a product UI. It is NOT a dead
 * link and NOT a fake product: it honestly states the capability is on the
 * roadmap and points at the real way to use it today (the API/CLI). Rendered
 * for every `status: 'soon'` catalog entry, resolved by id from the path, so
 * one component serves them all (DRY).
 */
import { usePathname } from 'next/navigation'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowUpRight } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { findEntry } from '~/lib/products/registry'
import { PageHeader } from '~/components/ui/PageHeader'
import { FadeIn } from '~/components/ui/FadeIn'
import { WaitlistForm } from '~/components/products/WaitlistForm'

export function ComingSoon() {
  const pathname = usePathname() ?? ''
  const id = pathname.split('/').filter(Boolean)[0] ?? ''
  const entry = findEntry(id)
  const Icon = entry?.icon
  const label = entry?.label ?? 'This product'

  return (
    <>
      <PageHeader title={label} subtitle={entry?.description ?? 'A Hanzo Cloud capability.'} />
      <FadeIn>
        <Card borderWidth={1} borderColor="$borderColor" p="$5" gap="$4" maxWidth={640}>
          <XStack gap="$3" items="center">
            {Icon ? <Icon size={22} /> : null}
            <YStack flex={1}>
              <Text fontSize="$6" fontWeight="800" color="$color12">
                {label} is coming soon
              </Text>
              <Text fontSize="$3" color="$color11">
                A dedicated console for {label} is on the way. Join the waitlist to be the first
                to know — it’s also reachable today through the API and CLI.
              </Text>
            </YStack>
          </XStack>

          <WaitlistForm waitlist={id || 'cloud'} label={label} />

          <XStack>
            <Button
              size="$3"
              borderWidth={1}
              borderColor="$borderColor"
              iconAfter={<ArrowUpRight size={15} />}
              onPress={() => window.open(entry?.docs ?? config.docsUrl, '_blank', 'noopener')}
            >
              API docs
            </Button>
          </XStack>
        </Card>
      </FadeIn>
    </>
  )
}
