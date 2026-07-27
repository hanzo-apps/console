'use client'

/**
 * One open-source app's detail page — everything the catalog knows about it, shown
 * BEFORE the commitment to run it.
 *
 * Choosing what to deploy into your own cloud is a decision, and a 300px tile can only
 * carry a name and two lines of description. This page answers the questions that
 * actually decide it: what containers will start, which images they pull, what ports
 * they publish, and what configuration they expect. Those facts are read from the
 * blueprint's own `docker-compose.yml` — not restated from the tile — so the page tells
 * you what will really run.
 *
 * Honest by construction: the catalog carries no license/stars/author fields, so this
 * page does not invent them. A blueprint with no compose file says so plainly rather
 * than rendering an empty "services" table that implies nothing starts.
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowLeft, ArrowUpRight, BookOpen, Boxes, Github, Globe, HandCoins, Rocket, Settings2 } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { blueprintBase, claimPath, fetchCompose, fetchOssApps, logoUrl, ownerRepo, type OssApp } from '~/lib/api/oss-apps'
import { PageHeader } from '~/components/ui/PageHeader'
import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { hasDeploySource, parseBlueprint, type Blueprint } from './logic'
import { DeployDialog } from './DeployDialog'

const openExt = (href?: string) => {
  if (href && typeof window !== 'undefined') window.open(href, '_blank', 'noopener,noreferrer')
}

type Async =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'missing' }
  | { phase: 'ready'; app: OssApp }

/** A labelled fact in the side rail. Renders nothing when the value is absent. */
function Fact({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <YStack gap="$0.5">
      <Text fontSize="$1" color="$color10" textTransform="uppercase" letterSpacing={0.6}>
        {label}
      </Text>
      <Text fontSize="$2">{value}</Text>
    </YStack>
  )
}

/** A titled block in the main column. */
function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <YStack gap="$2.5">
      <XStack gap="$2" items="center">
        {icon}
        <Text fontSize="$4" fontWeight="700">
          {title}
        </Text>
      </XStack>
      {children}
    </YStack>
  )
}

/**
 * What the blueprint provisions. Each row is one container the deploy will start —
 * the single most load-bearing thing to know before running someone else's stack.
 */
function Services({ blueprint }: { blueprint: Blueprint }) {
  return (
    <YStack borderWidth={1} borderColor="$borderColor" rounded="$3" overflow="hidden">
      {blueprint.services.map((s, i) => (
        <XStack
          key={s.name}
          gap="$3"
          p="$3"
          items="center"
          flexWrap="wrap"
          borderTopWidth={i === 0 ? 0 : 1}
          borderColor="$borderColor"
        >
          <Text fontSize="$3" fontWeight="600" minW={120}>
            {s.name}
          </Text>
          <Text fontSize="$2" color="$color11" flex={1} minW={200} style={{ fontFamily: 'monospace' }}>
            {s.image ?? 'built from source'}
          </Text>
          {s.ports.length ? (
            <Text fontSize="$1" color="$color10" style={{ fontFamily: 'monospace' }}>
              {s.ports.join('  ')}
            </Text>
          ) : null}
        </XStack>
      ))}
    </YStack>
  )
}

export function StoreDetail({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const id = params.id ?? ''
  const [state, setState] = useState<Async>({ phase: 'loading' })
  const [blueprint, setBlueprint] = useState<Blueprint | null>(null)
  const [deploying, setDeploying] = useState<OssApp | null>(null)

  useEffect(() => {
    let live = true
    setState({ phase: 'loading' })
    setBlueprint(null)
    fetchOssApps(config.ossCatalogUrl)
      .then((apps) => {
        if (!live) return
        const app = apps.find((a) => a.id === id)
        if (!app) {
          setState({ phase: 'missing' })
          return
        }
        setState({ phase: 'ready', app })
        // The blueprint is supplementary: it loads after the page is already useful,
        // and its absence never blocks or fails the page.
        return fetchCompose(config.ossCatalogUrl, app.id).then((yaml) => {
          if (live && yaml) setBlueprint(parseBlueprint(yaml))
        })
      })
      .catch((e) => {
        if (live) setState({ phase: 'error', error: classifyBackend(e) })
      })
    return () => {
      live = false
    }
  }, [id])

  const back = (
    <Button size="$2" chromeless icon={<ArrowLeft size={15} />} onPress={() => router.push('/store')}>
      App Store
    </Button>
  )

  if (state.phase === 'loading') {
    return (
      <YStack gap="$4">
        {back}
        <Text color="$color11" py="$4">
          Loading…
        </Text>
      </YStack>
    )
  }

  if (state.phase === 'error') {
    return (
      <YStack gap="$4">
        {back}
        <BackendStateCard
          state={state.error}
          onRetry={() => router.refresh()}
          hint={`catalog · ${config.ossCatalogUrl}/meta.json`}
        />
      </YStack>
    )
  }

  if (state.phase === 'missing') {
    return (
      <YStack gap="$4">
        {back}
        <XStack gap="$2" items="center" py="$4">
          <Boxes size={18} color="$color10" />
          <Text color="$color10">No app named “{id}” in the catalog.</Text>
        </XStack>
      </YStack>
    )
  }

  const { app } = state
  const deployable = hasDeploySource(app)
  const repo = ownerRepo(app.links.github)
  const logo = logoUrl(config.ossCatalogUrl, app)

  return (
    <YStack gap="$4">
      {back}

      <XStack gap="$3.5" items="flex-start">
        <YStack
          width={56}
          height={56}
          rounded="$4"
          bg="$color3"
          items="center"
          justify="center"
          overflow="hidden"
          borderWidth={1}
          borderColor="$borderColor"
        >
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote CDN catalog logo
            <img src={logo} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          ) : (
            <Text fontSize="$8" fontWeight="800" color="$color11">
              {app.name.charAt(0).toUpperCase()}
            </Text>
          )}
        </YStack>
        <YStack flex={1} minW={0}>
          <PageHeader
            title={app.name}
            subtitle={app.description || 'Open-source app — deploy it to your cloud in one click.'}
            actions={
              <XStack gap="$2" items="center" flexWrap="wrap">
                {app.links.github ? (
                  <Button size="$2" icon={<Github size={15} />} onPress={() => openExt(app.links.github)}>
                    Source
                  </Button>
                ) : null}
                {app.links.docs ? (
                  <Button size="$2" icon={<BookOpen size={15} />} onPress={() => openExt(app.links.docs)}>
                    Docs
                  </Button>
                ) : null}
                {app.links.website ? (
                  <Button size="$2" icon={<Globe size={15} />} onPress={() => openExt(app.links.website)}>
                    Website
                  </Button>
                ) : null}
                {deployable ? (
                  <PrimaryButton size="$2" icon={<Rocket size={15} />} onPress={() => setDeploying(app)}>
                    Deploy
                  </PrimaryButton>
                ) : (
                  <Button
                    size="$2"
                    icon={<ArrowUpRight size={15} />}
                    disabled={!app.links.website && !app.links.docs}
                    onPress={() => openExt(app.links.website ?? app.links.docs)}
                  >
                    View app
                  </Button>
                )}
              </XStack>
            }
          />
        </YStack>
      </XStack>

      <XStack gap="$4" flexWrap="wrap" items="flex-start">
        {/* Main column — what running this actually means. */}
        <YStack flex={1} minW={320} gap="$5">
          {blueprint && blueprint.services.length ? (
            <Section icon={<Boxes size={17} color="$color11" />} title="What gets deployed">
              <Text fontSize="$2" color="$color11">
                {blueprint.services.length === 1
                  ? 'One container starts in your cloud:'
                  : `${blueprint.services.length} containers start in your cloud:`}
              </Text>
              <Services blueprint={blueprint} />
            </Section>
          ) : null}

          {blueprint?.env.length ? (
            <Section icon={<Settings2 size={17} color="$color11" />} title="Configuration">
              <Text fontSize="$2" color="$color11">
                The blueprint expects these environment values. Hanzo fills in what it can;
                set the rest from the app’s settings after the first deploy.
              </Text>
              <XStack gap="$1.5" flexWrap="wrap">
                {blueprint.env.map((k) => (
                  <Text key={k} fontSize="$1" style={{ fontFamily: 'monospace' }} color="$color11" bg="$color2" px="$2" py="$1" rounded="$2">
                    {k}
                  </Text>
                ))}
              </XStack>
            </Section>
          ) : null}

          {!deployable ? (
            <Card bg="$color2" borderWidth={1} borderColor="$borderColor" p="$3.5" gap="$1">
              <Text fontSize="$3" fontWeight="600">
                Not one-click deployable
              </Text>
              <Text fontSize="$2" color="$color11">
                This entry publishes no buildable source, so Hanzo has nothing to build from.
                Use the links above to run it yourself.
              </Text>
            </Card>
          ) : null}
        </YStack>

        {/* Side rail — the catalog facts, only those that exist. */}
        <YStack width={280} minW={240} gap="$3.5">
          <Card borderWidth={1} borderColor="$borderColor" p="$3.5" gap="$3">
            <Fact label="Version" value={app.version} />
            <Fact label="Catalog id" value={app.id} />
            <Fact label="Source" value={repo} />
            {app.tags.length ? (
              <YStack gap="$1.5">
                <Text fontSize="$1" color="$color10" textTransform="uppercase" letterSpacing={0.6}>
                  Tags
                </Text>
                <XStack gap="$1.5" flexWrap="wrap">
                  {app.tags.map((t) => (
                    <Text
                      key={t}
                      fontSize="$1"
                      color="$color11"
                      bg="$color2"
                      px="$2"
                      py="$0.5"
                      rounded="$10"
                      cursor="pointer"
                      hoverStyle={{ opacity: 0.7 }}
                      onPress={() => router.push(`/store?tag=${encodeURIComponent(t)}`)}
                    >
                      {t}
                    </Text>
                  ))}
                </XStack>
              </YStack>
            ) : null}
            <Button
              size="$1"
              chromeless
              self="flex-start"
              icon={<ArrowUpRight size={13} />}
              onPress={() => openExt(blueprintBase(config.ossCatalogUrl, app.id))}
            >
              Blueprint
            </Button>
          </Card>

          {repo ? (
            <Card bg="$color2" borderWidth={1} borderColor="$borderColor" p="$3.5" gap="$2">
              <XStack gap="$2" items="center">
                <HandCoins size={17} color="$color11" />
                <Text fontSize="$3" fontWeight="700">
                  Maintain {repo}?
                </Text>
              </XStack>
              <Text fontSize="$2" color="$color11">
                Earn up to 20% of the compute margin every time a team runs it here.
              </Text>
              <Button size="$2" self="flex-start" onPress={() => router.push(claimPath(app))}>
                Claim your project
              </Button>
            </Card>
          ) : null}
        </YStack>
      </XStack>

      <DeployDialog app={deploying} onClose={() => setDeploying(null)} />
    </YStack>
  )
}
