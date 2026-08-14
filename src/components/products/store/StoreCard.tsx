'use client'

/**
 * One OSS App Store card — logo (lazy, monogram fallback), name + version, tags,
 * description, external links, and a Deploy CTA. Purely presentational: open + deploy
 * are INJECTED callbacks (the grid owns the detail route and the deploy dialog), so the
 * card has no data/router coupling.
 *
 * The card itself is the primary target: it OPENS the app's detail page, because
 * choosing what to run is a decision that needs the full picture (what it provisions,
 * what it costs, what it needs configured) and a 300px tile cannot carry that. Deploy
 * stays on the card as the fast path for someone who already knows what they want.
 *
 * The maker payout hook used to repeat on every tile; it now lives once, in the module
 * banner. Saying it 1000 times is not 1000 times more persuasive.
 */
import { useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowUpRight, BookOpen, Github, Globe, Rocket } from '@hanzogui/lucide-icons-2'

import { logoUrl, type OssApp } from '~/lib/api/oss-apps'
import { hasDeploySource } from './logic'

const openExt = (href?: string) => {
  if (href && typeof window !== 'undefined') window.open(href, '_blank', 'noopener,noreferrer')
}

/**
 * Keep a nested control's press from also firing the card's open handler. Every
 * interactive child inside a pressable card needs this, so it is written once.
 */
const stop = (fn: () => void) => (e?: { stopPropagation?: () => void }) => {
  e?.stopPropagation?.()
  fn()
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
  onOpen,
}: {
  app: OssApp
  base: string
  onDeploy: (app: OssApp) => void
  onOpen: (app: OssApp) => void
}) {
  const deployable = hasDeploySource(app)
  return (
    <Card
      width={300}
      p="$3.5"
      gap="$2.5"
      borderWidth={1}
      borderColor="$borderColor"
      cursor="pointer"
      hoverStyle={{ borderColor: '$color8' }}
      focusStyle={{ borderColor: '$color8' }}
      tabIndex={0}
      role="link"
      aria-label={`${app.name} — details`}
      onPress={() => onOpen(app)}
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
        {app.description || 'An open-source app you can deploy to your cloud.'}
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
          <Button size="$1" chromeless circular icon={<Github size={14} />} aria-label="Source on GitHub" onPress={stop(() => openExt(app.links.github))} />
        ) : null}
        {app.links.website ? (
          <Button size="$1" chromeless circular icon={<Globe size={14} />} aria-label="Website" onPress={stop(() => openExt(app.links.website))} />
        ) : null}
        {app.links.docs ? (
          <Button size="$1" chromeless circular icon={<BookOpen size={14} />} aria-label="Docs" onPress={stop(() => openExt(app.links.docs))} />
        ) : null}
      </XStack>

      {/* Primary action: one-click deploy over the real PaaS path; honest when there is
          no buildable source (open the app's site/source instead of a dead Deploy). */}
      {deployable ? (
        <Button size="$2" self="flex-start" icon={<Rocket size={14} />} onPress={stop(() => onDeploy(app))}>
          Deploy
        </Button>
      ) : (
        <Button
          size="$2"
          chromeless
          self="flex-start"
          icon={<ArrowUpRight size={14} />}
          disabled={!app.links.website && !app.links.docs && !app.links.github}
          onPress={stop(() => openExt(app.links.website ?? app.links.docs ?? app.links.github))}
        >
          View app
        </Button>
      )}
    </Card>
  )
}
