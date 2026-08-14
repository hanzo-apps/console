'use client'

/**
 * NativeOverview — the ONE native overview surface every product can render. It is
 * how the console keeps ZERO external link-outs: a product the console does not yet
 * deep-manage still opens to a real in-console page (header, live health, key facts,
 * native actions, and INLINE docs) instead of bouncing the user to another domain.
 *
 * Driven entirely by a pure `OverviewSpec` (overview/spec.ts + resolve.ts), so it
 * stays presentational and DRY across all products. Honest by construction:
 *  - the health band renders ONLY for a real platform source, and shows a truthful
 *    "not reporting on this deployment" when the apps inventory has no row for the
 *    service (never a fabricated "operational");
 *  - fact cards with no value read an em dash;
 *  - docs are rendered in-console; the docs SITE is offered only as a small
 *    secondary reference, never as the way to use the product.
 *
 * All style props use the v5 shorthand set (bg/p/px/py/gap/rounded/items/self/...).
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from '~/lib/router'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Github,
  KeyRound,
  Plus,
  Settings as SettingsIcon,
  Shield,
  Terminal,
  TriangleAlert,
} from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { githubUrl } from '~/lib/oss-program'
import { findEntry, type CatalogEntry, type ProductIcon as IconType } from '~/lib/products/registry'
import { PlatformApi, type PlatformApp } from '~/lib/api/platform'
import { useProductColors } from '~/lib/products/pins'
import { interpretPlatformError, type PlatformError } from '~/components/products/platform/state'
import { ProductIcon } from '~/components/ui/ProductIcon'
import type { OverviewAction, OverviewSpec } from './spec'
import { resolveSpec } from './resolve'
import { o11yServiceFor } from '~/components/products/subpage/sources'
import { ProductObservability } from '~/components/products/observability/ProductObservability'
import { toneVar } from '~/components/ui/tone'
import { PageHeader } from '@hanzo/ui/product'

/** Map a spec action's icon name to a real Lucide icon (kept out of the data layer). */
const ACTION_ICON: Record<NonNullable<OverviewAction['icon']>, IconType> = {
  arrow: ArrowRight,
  book: BookOpen,
  plus: Plus,
  settings: SettingsIcon,
  terminal: Terminal,
  key: KeyRound,
  shield: Shield,
}

const openExternal = (href: string) => {
  if (typeof window !== 'undefined') window.open(href, '_blank', 'noopener')
}

type HealthState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'reporting'; apps: PlatformApp[] }
  | { phase: 'silent' } // platform reachable but no row for this service (honest)
  | { phase: 'unconfigured'; error: PlatformError } // proxy/token not set up

/** Roll the (possibly multi-env) rows for a service into one health verdict. */
function verdict(apps: PlatformApp[]): { tone: 'green' | 'yellow' | 'red'; label: string } {
  if (apps.some((a) => a.health === 'red')) return { tone: 'red', label: 'Degraded' }
  if (apps.some((a) => a.health === 'yellow')) return { tone: 'yellow', label: 'Partial' }
  return { tone: 'green', label: 'Operational' }
}

const TONE_DOT = { green: toneVar('positive'), yellow: toneVar('warning'), red: toneVar('critical') } as const

/** Live health band — real signal from the platform apps inventory, or honest states. */
function HealthBand({ service, label }: { service: string; label: string }) {
  const [state, setState] = useState<HealthState>({ phase: 'idle' })

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const all = await PlatformApi.apps()
      const mine = all.filter((a) => a.app === service)
      setState(mine.length ? { phase: 'reporting', apps: mine } : { phase: 'silent' })
    } catch (e) {
      setState({ phase: 'unconfigured', error: interpretPlatformError(e) })
    }
  }, [service])

  useEffect(() => {
    void load()
  }, [load])

  if (state.phase === 'idle' || state.phase === 'loading') {
    return (
      <Card borderWidth={1} borderColor="$borderColor" p="$3.5" gap="$2">
        <Text fontSize="$2" color="$color10">
          Checking {label} health…
        </Text>
      </Card>
    )
  }

  if (state.phase === 'unconfigured') {
    return (
      <Card borderWidth={1} borderColor="$borderColor" p="$3.5" gap="$2">
        <XStack items="center" gap="$2">
          <TriangleAlert size={15} color="$color10" />
          <Text fontSize="$3" fontWeight="700" color="$color12">
            Health not reporting on this deployment
          </Text>
        </XStack>
        <Text fontSize="$2" color="$color10">
          Health comes from the platform control plane, which is not wired on this
          deployment yet. The status appears once it is.
        </Text>
      </Card>
    )
  }

  if (state.phase === 'silent') {
    return (
      <Card borderWidth={1} borderColor="$borderColor" p="$3.5" gap="$2">
        <XStack items="center" gap="$2">
          <YStack width={9} height={9} rounded="$10" bg="$color8" />
          <Text fontSize="$3" fontWeight="700" color="$color12">
            {label} not deployed in this org
          </Text>
        </XStack>
        <Text fontSize="$2" color="$color10">
          The control plane&apos;s operator inventory reports no running {label} service for your
          organization. Health appears here once one is reported.
        </Text>
      </Card>
    )
  }

  const v = verdict(state.apps)
  const envs = state.apps.length
  const rowDot = (h: PlatformApp['health']): string =>
    h === 'red' ? TONE_DOT.red : h === 'yellow' ? TONE_DOT.yellow : TONE_DOT.green
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$3.5" gap="$2.5">
      <XStack items="center" gap="$2" flexWrap="wrap">
        <YStack width={9} height={9} rounded="$10" style={{ backgroundColor: TONE_DOT[v.tone] }} />
        <Text fontSize="$4" fontWeight="800" color="$color12">
          {v.label}
        </Text>
        <Text fontSize="$2" color="$color10">
          · {envs} {envs === 1 ? 'deployment' : 'deployments'} across your clusters
        </Text>
      </XStack>
      <XStack flexWrap="wrap" gap="$2">
        {state.apps.map((a) => (
          <XStack key={a.id} items="center" gap="$1.5" px="$2.5" py="$1" rounded="$10" bg="$color3">
            <YStack width={7} height={7} rounded="$10" style={{ backgroundColor: rowDot(a.health) }} />
            <Text fontSize="$1" color="$color11" fontWeight="600">
              {a.env}
            </Text>
            <Text fontSize="$1" color="$color10">
              {a.cluster}
            </Text>
          </XStack>
        ))}
      </XStack>
    </Card>
  )
}

/** One key-fact / metric card. A null value reads an honest em dash. */
function FactCard({ label, value, hint }: { label: string; value?: string | null; hint?: string }) {
  return (
    <YStack flex={1} minW={180} p="$3.5" gap="$1.5" borderWidth={1} borderColor="$borderColor" rounded="$4" bg="$color1">
      <Text fontSize="$2" color="$color10" fontWeight="600" numberOfLines={1}>
        {label}
      </Text>
      <Text fontSize="$5" fontWeight="800" color="$color12" numberOfLines={1}>
        {value ?? '—'}
      </Text>
      {hint ? (
        <Text fontSize="$1" color="$color10" numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </YStack>
  )
}

/** One inline documentation section — rendered IN the console (no link-out). */
function DocBlock({ heading, body, code }: { heading: string; body: string; code?: string }) {
  return (
    <YStack gap="$2">
      <Text fontSize="$4" fontWeight="700" color="$color12">
        {heading}
      </Text>
      <Text fontSize="$3" color="$color11">
        {body}
      </Text>
      {code ? (
        <YStack bg="$color2" rounded="$3" p="$3" borderWidth={1} borderColor="$borderColor" overflow="scroll">
          <Text fontSize="$2" color="$color11" selectable style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
            {code}
          </Text>
        </YStack>
      ) : null}
    </YStack>
  )
}

/** The shared native product overview, resolved from the catalog entry. */
export function NativeOverview({ entry }: { entry: CatalogEntry }) {
  const router = useRouter()
  const { colorOf } = useProductColors()
  const spec: OverviewSpec = resolveSpec(entry)
  const Icon = entry.icon
  const docsHref = entry.docs ?? config.docsUrl

  const renderAction = (a: OverviewAction, i: number) => {
    const AIcon = a.icon ? ACTION_ICON[a.icon] : ArrowRight
    return (
      <Button
        key={`${a.to}-${i}`}
        size="$3"
        theme={a.secondary ? undefined : 'light'}
        chromeless={a.secondary}
        icon={<AIcon size={16} />}
        onPress={() => router.push(a.to)}
      >
        {a.label}
      </Button>
    )
  }

  return (
    <>
      <PageHeader
        title={entry.label}
        subtitle={entry.gcp ? `${entry.category} · ${entry.gcp}` : entry.category}
        actions={spec.actions.length ? <>{spec.actions.map(renderAction)}</> : undefined}
      />

      {/* Identity + what-it-is */}
      <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
        <XStack gap="$3" items="flex-start">
          <ProductIcon icon={Icon} color={colorOf(entry.id)} size={44} />
          <YStack flex={1} gap="$1">
            <Text fontSize="$6" fontWeight="800" color="$color12">
              {entry.label}
            </Text>
            <Text fontSize="$3" color="$color11">
              {spec.summary}
            </Text>
          </YStack>
        </XStack>
      </Card>

      {/* Live health — only for a real platform source */}
      {spec.health.kind === 'platform-app' ? (
        <HealthBand service={spec.health.service} label={entry.label} />
      ) : null}

      {/* Key facts / metrics */}
      {spec.facts.length ? (
        <XStack flexWrap="wrap" gap="$3" items="stretch">
          {spec.facts.map((f) => (
            <FactCard key={f.label} label={f.label} value={f.value} hint={f.hint} />
          ))}
        </XStack>
      ) : null}

      {/* Inline docs — the "use it from here" content, rendered in-console */}
      {spec.docs.length ? (
        <Card p="$4" gap="$4" borderWidth={1} borderColor="$borderColor">
          <XStack items="center" justify="space-between" gap="$2" flexWrap="wrap">
            <XStack items="center" gap="$2">
              <BookOpen size={18} />
              <Text fontSize="$5" fontWeight="800" color="$color12">
                Get started
              </Text>
            </XStack>
            <XStack gap="$2">
              {entry.repo ? (
                <Button
                  size="$2"
                  chromeless
                  icon={<Github size={14} />}
                  iconAfter={<ArrowUpRight size={13} opacity={0.5} />}
                  onPress={() => openExternal(githubUrl(entry.repo!))}
                >
                  Source
                </Button>
              ) : null}
              <Button
                size="$2"
                chromeless
                icon={<BookOpen size={14} />}
                iconAfter={<ArrowUpRight size={13} opacity={0.5} />}
                onPress={() => openExternal(docsHref)}
              >
                Full docs
              </Button>
            </XStack>
          </XStack>
          <YStack gap="$4">
            {spec.docs.map((d) => (
              <DocBlock key={d.heading} heading={d.heading} body={d.body} code={d.code} />
            ))}
          </YStack>
        </Card>
      ) : null}

      {/* Native per-product o11y — this product's live metrics/logs/traces from the
          ONE datastore, filtered to its OTel service. One reusable panel; every
          product overview surfaces its own signals (honest-empty until it emits). */}
      <ProductObservability service={o11yServiceFor(entry)} label={entry.label} />
    </>
  )
}

/**
 * Route adapter — the catch-all passes `{ params }`. Each native-overview catalog
 * entry routes here with its id baked in via `overviewFor(id)`, so one component
 * serves every product overview (DRY) and the registry stays declarative.
 */
export function overviewFor(id: string) {
  function ProductOverview(_props: { params: Record<string, string> }) {
    const entry = findEntry(id)
    if (!entry) return null
    return <NativeOverview entry={entry} />
  }
  ProductOverview.displayName = `Overview(${id})`
  return ProductOverview
}
