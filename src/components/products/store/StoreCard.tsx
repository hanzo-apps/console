'use client'

/**
 * One OSS App Store card — logo (lazy, monogram fallback), name + version, tags,
 * description, external links, a Deploy CTA, and the maker "Earn 20%" hook. Purely
 * presentational: the deploy + earn actions are INJECTED callbacks (the grid owns the
 * deploy dialog + in-console navigation), so the card has no data/router coupling.
 */
import { useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowUpRight, BookOpen, Github, Globe, HandCoins, Rocket } from '@hanzogui/lucide-icons-2'

import { logoUrl, ownerRepo, type OssApp } from '~/lib/api/oss-apps'
import { hasDeploySource } from './logic'

const openExt = (href?: string) => {
  if (href && typeof window !== 'undefined') window.open(href, '_blank', 'noopener,noreferrer')
}

/** The app logo — a lazy `<img>` that degrades to a monogram on error / missing asset. */
function AppLogo({ app, base }: { app: OssApp; base: string }) {
  const [broken, setBroken] = useState(false)
  const src = logoUrl(base, app)
  const show = !!src && !broken
  return (
    <YStack
      width={44}
      height={44}
      rounded="$3"
      bg="$color3"
      items="center"
      justify="center"
      overflow="hidden"
      borderWidth={1}
      borderColor="$borderColor"
    >
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote CDN catalog logo, not a local asset
        <img
          src={src}
          alt={`${app.name} logo`}
          loading="lazy"
          onError={() => setBroken(true)}
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
        />
      ) : (
        <Text fontSize="$6" fontWeight="800" color="$color11">
          {app.name.charAt(0).toUpperCase()}
        </Text>
      )}
    </YStack>
  )
}

export function StoreCard({
  app,
  base,
  onDeploy,
  onEarn,
}: {
  app: OssApp
  base: string
  onDeploy: (app: OssApp) => void
  onEarn: (app: OssApp) => void
}) {
  const deployable = hasDeploySource(app)
  const repo = ownerRepo(app.links.github)
  return (
    <Card
      width={300}
      p="$3.5"
      gap="$2.5"
      borderWidth={1}
      borderColor="$borderColor"
      hoverStyle={{ borderColor: '$color8' }}
    >
      <XStack gap="$3" items="flex-start">
        <AppLogo app={app} base={base} />
        <YStack flex={1} gap="$0.5" minW={0}>
          <Text fontSize="$5" fontWeight="700" numberOfLines={1}>
            {app.name}
          </Text>
          <XStack gap="$1.5" items="center" self="flex-start" bg="$color3" px="$2" py="$0.5" rounded="$10">
            <Text fontSize="$1" color="$color11">
              {app.version}
            </Text>
          </XStack>
        </YStack>
      </XStack>

      <Text fontSize="$2" color="$color11" minH={40} numberOfLines={2}>
        {app.description || 'Open-source app — deploy it to your cloud in one click.'}
      </Text>

      {app.tags.length ? (
        <XStack gap="$1.5" flexWrap="wrap">
          {app.tags.slice(0, 3).map((t) => (
            <Text key={t} fontSize="$1" color="$color10" bg="$color2" px="$2" py="$0.5" rounded="$10">
              {t}
            </Text>
          ))}
        </XStack>
      ) : null}

      {/* External references — only the ones present, never a dead link. */}
      <XStack gap="$1" items="center">
        {app.links.github ? (
          <Button size="$1" chromeless circular icon={<Github size={14} />} aria-label="Source on GitHub" onPress={() => openExt(app.links.github)} />
        ) : null}
        {app.links.website ? (
          <Button size="$1" chromeless circular icon={<Globe size={14} />} aria-label="Website" onPress={() => openExt(app.links.website)} />
        ) : null}
        {app.links.docs ? (
          <Button size="$1" chromeless circular icon={<BookOpen size={14} />} aria-label="Docs" onPress={() => openExt(app.links.docs)} />
        ) : null}
      </XStack>

      {/* Primary action: one-click deploy over the real PaaS path; honest when there is
          no buildable source (open the app's site/source instead of a dead Deploy). */}
      {deployable ? (
        <Button size="$2" self="flex-start" icon={<Rocket size={14} />} onPress={() => onDeploy(app)}>
          Deploy
        </Button>
      ) : (
        <Button
          size="$2"
          chromeless
          self="flex-start"
          icon={<ArrowUpRight size={14} />}
          disabled={!app.links.website && !app.links.docs && !app.links.github}
          onPress={() => openExt(app.links.website ?? app.links.docs ?? app.links.github)}
        >
          View app
        </Button>
      )}

      {/* Maker hook — derived from links.github (no author field exists); routes to the
          in-console OSS Author program. Only shown when we can identify the repo owner. */}
      {repo ? (
        <XStack
          items="center"
          gap="$1.5"
          self="flex-start"
          cursor="pointer"
          hoverStyle={{ opacity: 0.7 }}
          onPress={() => onEarn(app)}
          aria-label={`Maintainer of ${repo}? Earn 20%`}
        >
          <HandCoins size={13} color="$color10" />
          <Text fontSize="$1" color="$color10">
            Maintainer? Earn 20% →
          </Text>
        </XStack>
      ) : null}
    </Card>
  )
}
