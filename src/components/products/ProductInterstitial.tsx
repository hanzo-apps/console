'use client'

/**
 * Product interstitial — the "discover" screen for one catalog entry: what it
 * is, where its docs and OSS source live, the open-source revenue-share it
 * carries, and the action to open or get started. Rendered from the catalog, so
 * every product (in-console module or external surface) gets a discover screen
 * with no per-product code.
 */
import { useRouter } from '~/lib/router'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Github,
  Coins,
  Lock,
} from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { findEntry } from '~/lib/products/registry'
import { openProduct } from '~/lib/products/open'
import { OSS_PROGRAM, githubUrl, DOCS_URL } from '~/lib/oss-program'
import { PageHeader } from '@hanzo/ui/product'

const open = (url: string) => {
  if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener')
}

/** A titled link card (docs / source / etc). */
function LinkCard({
  icon,
  title,
  body,
  cta,
  onPress,
}: {
  icon: React.ReactNode
  title: string
  body: string
  cta: string
  onPress: () => void
}) {
  return (
    <Card p="$4" gap="$2.5" borderWidth={1} borderColor="$borderColor" flex={1} minW={260}>
      <XStack gap="$2" items="center">
        {icon}
        <Text fontSize="$5" fontWeight="700">
          {title}
        </Text>
      </XStack>
      <Text fontSize="$3" color="$color11" minH={40}>
        {body}
      </Text>
      <XStack>
        <Button self="flex-start" size="$2" iconAfter={<ArrowUpRight size={14} />} onPress={onPress}>
          {cta}
        </Button>
      </XStack>
    </Card>
  )
}

export function ProductInterstitial({ id }: { id: string }) {
  const router = useRouter()
  const entry = findEntry(id)

  if (!entry) {
    return (
      <>
        <PageHeader title="Not found" subtitle="No such product." />
        <Button self="flex-start" icon={<ArrowLeft size={16} />} onPress={() => router.push('/')}>
          Back to catalog
        </Button>
      </>
    )
  }

  const Icon = entry.icon

  return (
    <>
      <PageHeader
        title={entry.label}
        subtitle={entry.description}
        actions={
          <Button icon={<ArrowLeft size={16} />} onPress={() => router.push('/')}>
            Back
          </Button>
        }
      />

      {/* Identity + primary action */}
      <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
        <XStack gap="$3" items="center">
          <Icon size={28} />
          <YStack flex={1}>
            <Text fontSize="$6" fontWeight="800">
              {entry.label}
            </Text>
            <Text fontSize="$2" color="$color10">
              {entry.category}
              {entry.gcp ? ` · ${entry.gcp}` : ''}
              {entry.admin ? ' · admin' : ''}
            </Text>
          </YStack>
          <Button
            theme="light"
            iconAfter={<ArrowRight size={16} />}
            onPress={() => openProduct(entry, (p) => router.push(p))}
          >
            Open
          </Button>
        </XStack>
        {entry.admin ? (
          <XStack gap="$2" items="center">
            <Lock size={13} opacity={0.6} />
            <Text fontSize="$2" color="$color10">
              Access is enforced server-side by your role.
            </Text>
          </XStack>
        ) : null}
      </Card>

      {/* Docs + source */}
      <XStack flexWrap="wrap" gap="$3">
        <LinkCard
          icon={<BookOpen size={20} />}
          title="Docs & guides"
          body={`Quickstarts, how-tos, and API reference for ${entry.label}.`}
          cta="Read the docs"
          onPress={() => open(entry.docs ?? DOCS_URL)}
        />
        {entry.repo ? (
          <LinkCard
            icon={<Github size={20} />}
            title="Open source"
            body={`${entry.label} is open source at ${entry.repo}. Read the code, file issues, or contribute.`}
            cta="View on GitHub"
            onPress={() => open(githubUrl(entry.repo!))}
          />
        ) : null}
      </XStack>

      {/* OSS revenue share — the economic model, stated identically everywhere */}
      {entry.repo ? (
        <Card p="$4" gap="$2.5" borderWidth={1} borderColor="$color7" bg="$color2">
          <XStack gap="$2" items="center">
            <Coins size={20} />
            <Text fontSize="$5" fontWeight="700">
              Open source gets paid
            </Text>
          </XStack>
          <Text fontSize="$3" color="$color12">
            {`Run ${entry.label} on ${config.brandName} and the people who built it earn. `}
            {`${OSS_PROGRAM.revenueSharePct}% of the revenue this product generates in the cloud is `}
            {`distributed to its open-source contributors — computed from ${OSS_PROGRAM.basis} and `}
            {`settled on-chain in ${OSS_PROGRAM.payoutAsset}. Anyone can contribute code, compute, or `}
            {`capacity and share in what the network earns.`}
          </Text>
          <XStack gap="$2" flexWrap="wrap">
            <Button size="$2" iconAfter={<ArrowUpRight size={14} />} onPress={() => open(githubUrl(entry.repo!))}>
              Contribute
            </Button>
            <Button size="$2" iconAfter={<ArrowUpRight size={14} />} onPress={() => open(OSS_PROGRAM.dividendsUrl)}>
              OSS dividends
            </Button>
          </XStack>
        </Card>
      ) : null}
    </>
  )
}
