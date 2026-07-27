'use client'

/**
 * Per-product Settings — REAL, product-specific configuration, honest where a product
 * has none to self-serve; never a generic dead form.
 *
 *  - A product with a bespoke settings ROUTE (`settings: { kind: 'route' }`) links
 *    to its own real settings surface.
 *  - Otherwise: the product's REAL configuration surfaced read-only —
 *    a **Configuration** card (endpoint / auth / connection facts the backend
 *    exposes + links to where that config is administered: API keys, the product's
 *    own admin surface), **About** (category / OSS repo), for an operator-managed
 *    service its live **Deployment** facts (declared/running image tag, cluster,
 *    namespace) from the apps inventory, and a pointer to org-wide **Settings**.
 *    Configuration a customer can't self-serve is stated honestly ("managed by
 *    Hanzo") — never faked into an editable field, and every value is real or "—".
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowRight, ExternalLink, Settings as SettingsIcon, SlidersHorizontal } from '@hanzogui/lucide-icons-2'

import type { CatalogEntry } from '~/lib/products/registry'
import { config } from '~/config'
import { githubUrl } from '~/lib/oss-program'
import { PlatformApi, type PlatformApp } from '~/lib/api/platform'
import { PageHeader } from '@hanzo/ui/product'
import { settingsConfigFor, subpageSourcesFor } from './sources'

const openExternal = (href: string) => {
  if (typeof window !== 'undefined') window.open(href, '_blank', 'noopener')
}

/** One read-only key/value row. A missing value reads an honest em dash. */
function Row({ label, value, hint }: { label: string; value?: string | null; hint?: string }) {
  const text = value === undefined || value === null || value === '' ? '—' : value
  return (
    <XStack justify="space-between" gap="$3" flexWrap="wrap" items="baseline">
      <Text fontSize="$3" color="$color10" fontWeight="600">{label}</Text>
      <YStack items="flex-end" flex={1}>
        <Text fontSize="$3" color={text === '—' ? '$color10' : '$color12'} numberOfLines={1}>{text}</Text>
        {hint ? <Text fontSize="$1" color="$color10" numberOfLines={1}>{hint}</Text> : null}
      </YStack>
    </XStack>
  )
}

export function ProductSettingsView({ entry }: { entry: CatalogEntry }) {
  const router = useRouter()
  const { service, settings } = subpageSourcesFor(entry)
  const cfg = settingsConfigFor(entry)
  const [deploys, setDeploys] = useState<PlatformApp[] | null>(null)

  const load = useCallback(() => {
    if (!service) return
    // Best-effort — deployment facts are an admin surface; a customer 403 simply
    // omits the section (they still see Configuration + About + the org-settings pointer).
    PlatformApi.apps()
      .then((all) => setDeploys(all.filter((a) => a.app === service)))
      .catch(() => setDeploys(null))
  }, [service])

  useEffect(() => {
    load()
  }, [load])

  if (settings.kind === 'route') {
    return (
      <>
        <PageHeader title={`${entry.label} · Settings`} subtitle={`Configuration for ${entry.label}.`} />
        <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" maxWidth={640}>
          <Text fontSize="$3" color="$color11">{entry.label} has its own settings surface.</Text>
          <Button size="$3" theme="light" self="flex-start" icon={<ArrowRight size={16} />} onPress={() => router.push(settings.to)}>
            Open {entry.label} settings
          </Button>
        </Card>
      </>
    )
  }

  const deployment = deploys?.[0]
  return (
    <>
      <PageHeader title={`${entry.label} · Settings`} subtitle={`Configuration for ${entry.label}.`} />

      <YStack gap="$4" maxW={720}>
        {/* Configuration — the product's REAL, product-specific config (endpoint / auth /
            connection), read-only, plus links to where it is administered. */}
        <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
          <XStack gap="$2" items="center">
            <SlidersHorizontal size={16} />
            <Text fontSize="$5" fontWeight="700">Configuration</Text>
          </XStack>
          {cfg.facts.length ? (
            <YStack gap="$2.5">
              {cfg.facts.map((f) => (
                <Row key={f.label} label={f.label} value={f.value} hint={f.hint} />
              ))}
            </YStack>
          ) : (
            <Text fontSize="$3" color="$color11">
              {entry.label} has no self-serve configuration here — it is a managed Hanzo Cloud capability.
            </Text>
          )}
          {cfg.links.length ? (
            <XStack gap="$2" pt="$1" flexWrap="wrap">
              {cfg.links.map((l, i) => (
                <Button
                  key={l.to}
                  size="$3"
                  theme={i === 0 ? 'light' : undefined}
                  chromeless={i !== 0}
                  icon={<ArrowRight size={15} />}
                  onPress={() => router.push(l.to)}
                >
                  {l.label}
                </Button>
              ))}
            </XStack>
          ) : null}
        </Card>

        {/* About — real catalog facts, read-only. */}
        <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
          <Text fontSize="$5" fontWeight="700">About</Text>
          <Row label="Category" value={entry.category} />
          {entry.gcp ? <Row label="Equivalent to" value={entry.gcp} /> : null}
          <Row label="Open source" value={entry.repo ?? null} />
          <XStack gap="$2" pt="$1" flexWrap="wrap">
            {entry.repo ? (
              <Button size="$2" chromeless icon={<ExternalLink size={14} />} onPress={() => openExternal(githubUrl(entry.repo!))}>
                Source
              </Button>
            ) : null}
            <Button size="$2" chromeless icon={<ExternalLink size={14} />} onPress={() => openExternal(entry.docs ?? config.docsUrl)}>
              Docs
            </Button>
          </XStack>
        </Card>

        {/* Deployment — real per-service config (image/tag/cluster), read-only, when reported. */}
        {deployment ? (
          <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
            <Text fontSize="$5" fontWeight="700">Deployment</Text>
            <Text fontSize="$2" color="$color10">
              Managed by the Hanzo control plane. {deploys && deploys.length > 1 ? `${deploys.length} environments.` : ''}
            </Text>
            <Row label="Environment" value={deployment.env} />
            <Row label="Cluster" value={deployment.cluster} />
            <Row label="Namespace" value={deployment.namespace ?? null} />
            <Row label="Declared image" value={deployment.declaredTag ?? null} />
            <Row label="Running image" value={deployment.runningTag ?? null} />
          </Card>
        ) : null}

        {/* Org-wide settings — the one home for identity, branding, and members. */}
        <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
          <XStack gap="$2" items="center">
            <SettingsIcon size={16} />
            <Text fontSize="$5" fontWeight="700">Organization settings</Text>
          </XStack>
          <Text fontSize="$3" color="$color11">
            Identity, branding, and members are managed in one place for every product: Settings.
          </Text>
          <Button size="$3" self="flex-start" icon={<ArrowRight size={16} />} onPress={() => router.push('/settings')}>
            Open Settings
          </Button>
        </Card>
      </YStack>
    </>
  )
}
