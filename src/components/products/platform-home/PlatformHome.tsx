'use client'

/**
 * Platform home — the deploy-focused landing that platform.<brand> boots into (the
 * `platform` shell's `home`, and the Platform product's index everywhere). It ties the
 * deploy platform together: a hero, quick tiles into the deploy primitives (App Store ·
 * Containers · Functions · Usage), a featured strip of one-click OSS apps (the live
 * catalog), and the org's real projects (the reused `PlatformList`). Everything links to
 * a real in-console surface; the featured apps + deploy are the same real path as the
 * full App Store — no fabricated data, honest states throughout.
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowRight, BarChart3, Container, Rocket, Store, Zap } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { fetchOssApps, type OssApp } from '~/lib/api/oss-apps'
import { ProductIcon } from '~/components/ui/ProductIcon'
import { PlatformList } from '~/components/products/platform-hub/PlatformList'
import { AppsRow } from '~/components/products/store/AppsRow'
import { featuredApps } from '~/components/products/store/logic'
import { PrimaryButton, type IconLike } from '@hanzo/ui/product'

/** A compact, whole-card-clickable deploy shortcut. */
function DeployTile({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: IconLike
  title: string
  subtitle: string
  onPress: () => void
}) {
  return (
    <Card
      flex={1}
      minW={190}
      borderWidth={1}
      borderColor="$borderColor"
      p="$3.5"
      gap="$2"
      cursor="pointer"
      hoverStyle={{ borderColor: '$color8' }}
      onPress={onPress}
    >
      <ProductIcon icon={icon} size={34} />
      <YStack gap="$0.5">
        <Text fontSize="$4" fontWeight="700">
          {title}
        </Text>
        <Text fontSize="$2" color="$color10" numberOfLines={2}>
          {subtitle}
        </Text>
      </YStack>
    </Card>
  )
}

/** The featured one-click OSS apps strip — the live catalog, curated to well-known apps. */
function FeaturedApps() {
  const router = useRouter()
  const [apps, setApps] = useState<OssApp[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    fetchOssApps(config.ossCatalogUrl)
      .then((all) => live && setApps(featuredApps(all, 8)))
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [])

  // On a catalog failure, don't fabricate — just offer the App Store entry point.
  if (failed) return null

  return (
    <YStack gap="$3">
      <XStack items="center" justify="space-between" flexWrap="wrap" gap="$2">
        <XStack items="center" gap="$2">
          <Store size={18} color="$color11" />
          <Text fontSize="$5" fontWeight="800" color="$color12">
            One-click apps
          </Text>
        </XStack>
        <Button size="$2" chromeless iconAfter={<ArrowRight size={14} />} onPress={() => router.push('/store')}>
          Browse 1000+ apps
        </Button>
      </XStack>
      {apps === null ? (
        <Text color="$color10">Loading open-source apps…</Text>
      ) : apps.length === 0 ? null : (
        <AppsRow apps={apps} base={config.ossCatalogUrl} />
      )}
    </YStack>
  )
}

export function PlatformHome() {
  const router = useRouter()
  const push = (p: string) => router.push(p)

  return (
    <YStack gap="$7">
      {/* Hero — the deploy platform's front door. */}
      <Card borderWidth={1} borderColor="$borderColor" bg="$color2" p="$5" gap="$3">
        <XStack items="center" gap="$2">
          <Rocket size={18} color="$color11" />
          <Text fontSize="$2" color="$color10" fontWeight="500">
            {config.brandName} Platform
          </Text>
        </XStack>
        <Text fontSize="$9" fontWeight="900" color="$color12">
          Deploy anything.
        </Text>
        <Text fontSize="$4" color="$color11" maxW={620}>
          Ship your projects and 1000+ open-source apps — Postgres, n8n, Grafana, and more — to production on{' '}
          {config.brandName} in one click.
        </Text>
        <XStack gap="$2" flexWrap="wrap" pt="$1">
          <PrimaryButton size="$3" icon={<Store size={16} />} onPress={() => push('/store')}>
            Browse the App Store
          </PrimaryButton>
          <Button size="$3" icon={<Rocket size={16} />} onPress={() => push('/platform')}>
            New project
          </Button>
        </XStack>
      </Card>

      {/* Deploy primitives — quick tiles. */}
      <XStack gap="$3" flexWrap="wrap">
        <DeployTile icon={Store} title="App Store" subtitle="1000+ open-source apps, one-click deploy." onPress={() => push('/store')} />
        <DeployTile icon={Container} title="Containers" subtitle="Your running container apps + workloads." onPress={() => push('/containers')} />
        <DeployTile icon={Zap} title="Functions" subtitle="Event-driven serverless functions." onPress={() => push('/functions')} />
        <DeployTile icon={BarChart3} title="Usage" subtitle="Track spend and resource usage." onPress={() => push('/usage')} />
      </XStack>

      {/* Featured one-click OSS apps (live catalog). */}
      <FeaturedApps />

      {/* The org's real projects (reused list, re-headed as "Your projects"). */}
      <PlatformList
        title="Your projects"
        subtitle="Create, deploy, and ship — drop a build, bind a domain, and edit or chat about the same project across hanzo.app and hanzo.chat."
      />
    </YStack>
  )
}
