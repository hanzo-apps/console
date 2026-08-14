'use client'

/**
 * ResourceOverview — the org's full RESOURCE picture on the console home, at a glance.
 *
 * ONE read-only board that unions the three real, per-org inventories every signed-in
 * org member already owns, so "what do I have running?" is answered without leaving the
 * home:
 *  - Apps   → `PlatformAppsApi.listAllApps()` (cloud `/v1/platform` — the same per-org
 *             PaaS the App Platform module renders; deployed container apps like studio).
 *  - GPUs   → `ComputeApi.gpus()` (cloud `/v1/gpus` — the unioned inventory: Hanzo Cloud
 *             DOKS GPUs AND bring-your-own fleet workers, each carrying `provider`).
 *  - Nodes  → `VisorApi.machines()` (cloud `/v1/machines` — the node-level view: DOKS
 *             machines AND BYO/on-prem workers; the union carries `provider` too).
 *
 * Honest by construction: the three sources load INDEPENDENTLY, so a slow/denied/unrouted
 * one never blanks the others — it degrades to its own "not reporting" line (an errored
 * source is never shown as an empty "you have none"). A bring-your-own GPU/node (a
 * DGX Spark GB10) is badged BYO distinctly from cloud. Every count is derived from real
 * rows; nothing is fabricated. Each tile/section deep-links to the product that owns it.
 *
 * Matches the existing design system (the same `@hanzo/gui` shorthand + StatusTag the
 * PaaS/GPU/Machines modules use) — this ADDS a section to the home, it does not restyle.
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from '~/lib/router'
import { Button, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowRight, Cpu, RefreshCw, Rocket, Server } from '@hanzogui/lucide-icons-2'

import { PlatformAppsApi, type PlatformApp } from '~/lib/api/platform-apps'
import { ComputeApi, fmtInt, type Gpu } from '~/lib/api/compute'
import { VisorApi, DASH, type VisorMachine } from '~/lib/api/visor'
import { productColorHex } from '~/lib/products/colors'
import { appDisplayStatus, summarize } from '../platform-apps/logic'
import { isOnline, onlineCaption, onlineSplit, providerKind, providerLabel } from './resource-logic'
import { StatusTag, asColor } from '@hanzo/ui/product'

/** How many rows each section previews before deferring to its full module. */
const PREVIEW = 6

// ── Async state (three independent sources; one never blocks another) ─────────

type Feed<T> = { data: T[]; loading: boolean; error: boolean }
const feed = <T,>(): Feed<T> => ({ data: [], loading: true, error: false })

function useResources() {
  const [apps, setApps] = useState<Feed<PlatformApp>>(feed)
  const [gpus, setGpus] = useState<Feed<Gpu>>(feed)
  const [machines, setMachines] = useState<Feed<VisorMachine>>(feed)

  const reload = useCallback(() => {
    setApps((s) => ({ ...s, loading: true, error: false }))
    PlatformAppsApi.listAllApps()
      .then((data) => setApps({ data, loading: false, error: false }))
      .catch(() => setApps({ data: [], loading: false, error: true }))

    setGpus((s) => ({ ...s, loading: true, error: false }))
    ComputeApi.gpus()
      .then((data) => setGpus({ data, loading: false, error: false }))
      .catch(() => setGpus({ data: [], loading: false, error: true }))

    setMachines((s) => ({ ...s, loading: true, error: false }))
    VisorApi.machines()
      .then((data) => setMachines({ data, loading: false, error: false }))
      .catch(() => setMachines({ data: [], loading: false, error: true }))
  }, [])

  useEffect(() => reload(), [reload])
  return { apps, gpus, machines, reload }
}

// ── Small shared cells (match StatusTag's pill style; nothing new invented) ────

/** Cloud-vs-BYO badge — BYO (a bring-your-own / on-prem node) reads bolder + darker. */
function ProviderBadge({ provider }: { provider?: string }) {
  const byo = providerKind(provider) === 'byo'
  return (
    <Text
      fontSize="$1"
      px="$2"
      py="$1"
      rounded="$2"
      bg={byo ? '$color6' : '$color3'}
      color={byo ? '$color12' : '$color11'}
      fontWeight={byo ? '700' : '500'}
    >
      {providerLabel(provider)}
    </Text>
  )
}

/** Green when up, muted otherwise (honest — an unknown status is not "online"). */
function OnlineDot({ online }: { online: boolean }) {
  return <YStack width={8} height={8} rounded="$10" bg={online ? '$green10' : '$color8'} />
}

function Row({ onPress, children }: { onPress: () => void; children: React.ReactNode }) {
  return (
    <XStack
      items="center"
      gap="$2"
      py="$2"
      px="$1"
      borderBottomWidth={1}
      borderColor="$borderColor"
      cursor="pointer"
      hoverStyle={{ bg: '$color2' }}
      onPress={onPress}
    >
      {children}
    </XStack>
  )
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <Text fontSize="$2" color="$color10">
      {children}
    </Text>
  )
}

// ── Top-line stat tile ────────────────────────────────────────────────────────

function StatTile({
  label,
  value,
  sub,
  icon: Icon,
  colorId,
  loading,
  onPress,
}: {
  label: string
  value: string
  sub: string
  icon: typeof Cpu
  colorId: string
  loading: boolean
  onPress: () => void
}) {
  return (
    <YStack
      flex={1}
      minW={200}
      p="$3.5"
      gap="$1.5"
      borderWidth={1}
      borderColor="$borderColor"
      rounded="$4"
      bg="$color1"
      cursor="pointer"
      hoverStyle={{ borderColor: '$color8' }}
      onPress={onPress}
    >
      <XStack items="center" justify="space-between">
        <Text fontSize="$2" color="$color11" fontWeight="600">
          {label}
        </Text>
        <Icon size={15} color={asColor(productColorHex(colorId))} />
      </XStack>
      {loading ? (
        <XStack height={34} items="center">
          <Spinner size="small" color="$color10" />
        </XStack>
      ) : (
        <Text fontSize="$8" fontWeight="900" color="$color12" numberOfLines={1}>
          {value}
        </Text>
      )}
      <Text fontSize="$1" color="$color10" numberOfLines={1}>
        {sub}
      </Text>
    </YStack>
  )
}

// ── Section card (shell owns the honest load/error/empty states) ──────────────

function ResourceCard<T>({
  title,
  icon: Icon,
  colorId,
  state,
  count,
  empty,
  onViewAll,
  renderRow,
  rowKey,
}: {
  title: string
  icon: typeof Cpu
  colorId: string
  state: Feed<T>
  count: number
  empty: string
  onViewAll: () => void
  renderRow: (item: T) => React.ReactNode
  rowKey: (item: T) => string
}) {
  const preview = state.data.slice(0, PREVIEW)
  const more = count - preview.length
  return (
    <YStack flex={1} minW={300} gap="$3" p="$4" borderWidth={1} borderColor="$borderColor" rounded="$4" bg="$color1">
      <XStack items="center" justify="space-between" gap="$2">
        <XStack items="center" gap="$2" minW={0}>
          <Icon size={16} color={asColor(productColorHex(colorId))} />
          <Text fontSize="$4" fontWeight="800" color="$color12">
            {title}
          </Text>
          {!state.loading && !state.error ? (
            <Text fontSize="$2" color="$color10">
              {count}
            </Text>
          ) : null}
        </XStack>
        <Button size="$1" chromeless iconAfter={<ArrowRight size={13} />} onPress={onViewAll} aria-label={`View all ${title}`}>
          View all
        </Button>
      </XStack>

      {state.loading ? (
        <XStack py="$3" justify="center">
          <Spinner size="small" color="$color10" />
        </XStack>
      ) : state.error ? (
        <Muted>This source did not answer, so nothing is listed. That is not the same as having none.</Muted>
      ) : count === 0 ? (
        <Muted>{empty}</Muted>
      ) : (
        <YStack>
          {preview.map((item) => (
            <YStack key={rowKey(item)}>{renderRow(item)}</YStack>
          ))}
          {more > 0 ? (
            <Text fontSize="$1" color="$color10" pt="$2">
              +{more} more
            </Text>
          ) : null}
        </YStack>
      )}
    </YStack>
  )
}

// ── Board ─────────────────────────────────────────────────────────────────────

export function ResourceOverview() {
  const router = useRouter()
  const go = useCallback((path: string) => router.push(path), [router])
  const { apps, gpus, machines, reload } = useResources()

  const appSum = summarize(apps.data)
  const gpuSplit = onlineSplit(gpus.data)
  const nodeSplit = onlineSplit(machines.data)

  const tileValue = (state: Feed<unknown>, n: number): string => (state.error ? DASH : fmtInt(n))

  return (
    <YStack gap="$4">
      <XStack items="center" justify="space-between" gap="$3" flexWrap="wrap">
        {/* `flex` + `minW={0}`: a bare View is `flex-shrink: 0`, so this column held
            its max-content width (533px inside a 366px pane at 390 wide), its text
            never wrapped, and the heading painted off the right edge with nothing to
            scroll it — the same defect the landing footer had in v8.5.29. */}
        <YStack flex={1} minW={0}>
          <Text fontSize="$7" fontWeight="800" color="$color12">
            Resources
          </Text>
          <Text fontSize="$3" color="$color11">
            Your apps, GPUs, and nodes across Hanzo Cloud and your own fleet.
          </Text>
        </YStack>
        <Button size="$2" chromeless icon={<RefreshCw size={15} />} onPress={reload} aria-label="Refresh resources" />
      </XStack>

      {/* Top-line stat tiles: apps running, GPUs online (cloud + BYO split), nodes. */}
      <XStack flexWrap="wrap" gap="$3" items="stretch">
        <StatTile
          label="Apps running"
          value={tileValue(apps, appSum.live)}
          sub={apps.error ? 'not reporting' : `of ${appSum.total} app${appSum.total === 1 ? '' : 's'}`}
          icon={Rocket}
          colorId="app-platform"
          loading={apps.loading}
          onPress={() => go('/app-platform')}
        />
        <StatTile
          label="GPUs online"
          value={tileValue(gpus, gpuSplit.online)}
          sub={gpus.error ? 'not reporting' : onlineCaption(gpuSplit)}
          icon={Cpu}
          colorId="gpus"
          loading={gpus.loading}
          onPress={() => go('/gpus')}
        />
        <StatTile
          label="Nodes"
          value={tileValue(machines, nodeSplit.total)}
          sub={machines.error ? 'not reporting' : onlineCaption(nodeSplit)}
          icon={Server}
          colorId="machines"
          loading={machines.loading}
          onPress={() => go('/machines')}
        />
      </XStack>

      {/* Three at-a-glance sections, each deep-linking to the product that owns it. */}
      <XStack flexWrap="wrap" gap="$3" items="stretch">
        <ResourceCard<PlatformApp>
          title="Apps"
          icon={Rocket}
          colorId="app-platform"
          state={apps}
          count={appSum.total}
          empty="No apps yet — deploy a container app from App Platform."
          onViewAll={() => go('/app-platform')}
          rowKey={(a) => a.id}
          renderRow={(a) => (
            <Row onPress={() => go('/app-platform')}>
              <YStack flex={1} minW={0}>
                <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
                  {a.name}
                </Text>
                <Text fontSize="$1" color="$color10" numberOfLines={1}>
                  {a.projectSlug ? `${a.projectSlug}/` : ''}
                  {a.slug}
                </Text>
              </YStack>
              <StatusTag status={appDisplayStatus(a)} />
            </Row>
          )}
        />

        <ResourceCard<Gpu>
          title="GPUs"
          icon={Cpu}
          colorId="gpus"
          state={gpus}
          count={gpuSplit.total}
          empty="No GPUs yet — launch one, or connect a bring-your-own worker."
          onViewAll={() => go('/gpus')}
          rowKey={(g) => g.id}
          renderRow={(g) => (
            <Row onPress={() => go('/gpus')}>
              <OnlineDot online={isOnline(g.status)} />
              <YStack flex={1} minW={0}>
                <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
                  {g.model || g.name || g.id}
                </Text>
                <Text fontSize="$1" color="$color10" numberOfLines={1}>
                  {g.location || g.region || g.cluster || DASH}
                  {g.memoryTotalGb != null ? ` · ${g.memoryTotalGb} GB` : ''}
                </Text>
              </YStack>
              <ProviderBadge provider={g.provider} />
            </Row>
          )}
        />

        <ResourceCard<VisorMachine>
          title="Nodes"
          icon={Server}
          colorId="machines"
          state={machines}
          count={nodeSplit.total}
          empty="No nodes yet — launch a machine, or connect a bring-your-own worker."
          onViewAll={() => go('/machines')}
          rowKey={(m) => m.id}
          renderRow={(m) => (
            <Row onPress={() => go('/machines')}>
              <OnlineDot online={isOnline(m.status)} />
              <YStack flex={1} minW={0}>
                <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
                  {m.name || m.id}
                </Text>
                <Text fontSize="$1" color="$color10" numberOfLines={1}>
                  {m.region || DASH}
                  {m.type ? ` · ${m.type}` : ''}
                </Text>
              </YStack>
              <ProviderBadge provider={m.provider} />
            </Row>
          )}
        />
      </XStack>
    </YStack>
  )
}
