'use client'

/**
 * LivingOverview — the ONE reusable, videogame-like overview. Given a
 * `LivingOverviewConfig` (a product's tiles + its REAL data loader + live/motion
 * settings) it renders the board and keeps it alive: a single throttled poll loop
 * refetches on an interval (paused on a hidden tab), the range selector re-scopes,
 * and every number counts up on change (unless reduced motion / count-up off).
 *
 * DRY + orthogonal: this file knows nothing about any specific product or endpoint.
 * The tiles read their slice out of the normalized `OverviewData` the loader returns;
 * a product is added by writing a config, never overview UI (see `registry.ts`).
 *
 * Honest by construction: the FIRST load shows a spinner; a failure shows the
 * shared `ErrorState`; thereafter a background refetch never blanks the board (the
 * last real data stays until new real data lands), and any tile whose slice is
 * absent renders its own skeleton/empty. Style props are the v5 shorthand set.
 */
import { useEffect, useRef, useState } from 'react'
import { Button, Spinner, Text, XStack, YStack } from '@hanzo/gui'

import { ApiError } from '~/lib/api'
import { useIsSuperAdmin } from '~/lib/auth/admin'
import { ErrorState, asApiError } from '~/components/ui/States'
import { effectiveInterval } from './motion'
import { usePageHidden, usePoll } from './hooks'
import { type Loadable } from './logic'
import type { LivingOverviewConfig, OverviewData, OverviewRange, OverviewTile } from './config'
import {
  ActivityTileView,
  AlertsTileView,
  DistributionTileView,
  HealthTileView,
  MetricTileView,
  PanelSpinner,
  TimeseriesTileView,
} from './tiles'
import { FadeIn, PageHeader } from '@hanzo/ui/product'

/** Throttle floor: a config can ask for faster, but never faster than this. */
const POLL_FLOOR_MS = 5000

const RANGES: { key: OverviewRange; label: string }[] = [
  { key: '24h', label: '24H' },
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
]

export function LivingOverview({ config, allOrgs }: { config: LivingOverviewConfig; allOrgs?: boolean }) {
  const [range, setRange] = useState<OverviewRange>('24h')
  const [state, setState] = useState<Loadable<OverviewData>>({ s: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const reqRef = useRef(0)

  // A tenant (non-global) admin can't read cross-tenant admin aggregates; loaders
  // use this to skip those calls (which would 403) and source org-scoped data.
  const isSuperAdmin = useIsSuperAdmin()

  const hidden = usePageHidden()
  // Pause polling while the tab is hidden OR the board is in its error state — an
  // errored source should not be hammered on a loop; the user retries explicitly.
  const pollMs = effectiveInterval(config.live?.pollMs ?? 0, POLL_FLOOR_MS, hidden || state.s === 'error')
  const { tick, bump } = usePoll(pollMs)
  const live = (config.live?.pollMs ?? 0) > 0
  const countUp = config.live?.countUp !== false

  // One load path for the first paint, the range change, and every poll tick. The
  // reqRef guard drops a stale in-flight response so a fast range toggle can't
  // render older data over newer.
  useEffect(() => {
    const id = ++reqRef.current
    const first = state.s === 'loading'
    if (!first) setRefreshing(true)
    config
      .load({ range, allOrgs, isSuperAdmin })
      .then((v) => {
        if (id === reqRef.current) setState({ s: 'ready', v })
      })
      .catch((e) => {
        // A background refetch that fails must NOT blank a board that already has
        // real data — keep the last data, surface the error only on the first load.
        if (id !== reqRef.current) return
        if (first) {
          const err = asApiError(e)
          setState({ s: 'error', message: err.message, status: err.status })
        }
      })
      .finally(() => {
        if (id === reqRef.current) setRefreshing(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, allOrgs, isSuperAdmin, tick, config])

  const onRange = (k: OverviewRange) => {
    setRange(k)
    bump()
  }

  const data = state.s === 'ready' ? state.v : null

  return (
    <YStack gap="$4">
      <PageHeader
        title={allOrgs ? `${config.title} — all orgs` : config.title}
        subtitle={config.subtitle}
        actions={
          <XStack gap="$2" items="center">
            {refreshing ? <Spinner size="small" color="$color10" /> : null}
            {config.ranged === false ? null : <RangeSelector value={range} onChange={onRange} />}
          </XStack>
        }
      />

      {state.s === 'error' ? (
        <ErrorState
          err={new ApiError(state.message, state.status)}
          onRetry={() => {
            setState({ s: 'loading' })
            bump()
          }}
          copy={{
            notFound:
              'This overview’s data source is not routed on this deployment yet — it appears automatically once the backend is reachable for your org.',
          }}
        />
      ) : state.s === 'loading' ? (
        <PanelSpinner />
      ) : (
        <YStack gap="$4">
          {config.rows.map((row, ri) => (
            <FadeIn key={ri} index={ri} step={60}>
              <XStack flexWrap="wrap" gap="$3">
                {row.map((tile, ti) => (
                  <TileView key={ti} tile={tile} data={data} loading={false} live={live && countUp} index={ti} />
                ))}
              </XStack>
            </FadeIn>
          ))}
        </YStack>
      )}
    </YStack>
  )
}

/** Route a tile spec to its view (exhaustive on the `tile` discriminant). */
function TileView({ tile, data, loading, live, index }: { tile: OverviewTile; data: OverviewData | null; loading: boolean; live: boolean; index: number }) {
  switch (tile.tile) {
    case 'metric':
      return <MetricTileView tile={tile} data={data} loading={loading} live={live} index={index} />
    case 'timeseries':
      return <TimeseriesTileView tile={tile} data={data} loading={loading} />
    case 'distribution':
      return <DistributionTileView tile={tile} data={data} loading={loading} />
    case 'activity':
      return <ActivityTileView tile={tile} data={data} loading={loading} />
    case 'alerts':
      return <AlertsTileView tile={tile} data={data} loading={loading} />
    case 'health':
      return <HealthTileView tile={tile} data={data} loading={loading} />
  }
}

function RangeSelector({ value, onChange }: { value: OverviewRange; onChange: (k: OverviewRange) => void }) {
  return (
    <XStack borderWidth={1} borderColor="$borderColor" rounded="$4" overflow="hidden">
      {RANGES.map((r) => {
        const active = r.key === value
        return (
          <Button key={r.key} size="$2" chromeless={!active} bg={active ? '$color5' : 'transparent'} rounded="$0" onPress={() => onChange(r.key)}>
            <Text fontSize="$2" fontWeight={active ? '700' : '500'} color={active ? '$color12' : '$color10'}>
              {r.label}
            </Text>
          </Button>
        )
      })}
    </XStack>
  )
}
