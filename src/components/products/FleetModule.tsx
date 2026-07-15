'use client'

/**
 * Fleet — the org's WHOLE compute surface on ONE board.
 *
 * Backed by the REAL `GET /v1/fleet` (units + last heartbeat) and
 * `GET /v1/fleet/samples` (a unit's utilization trend), read through the same-origin
 * `/v1` user-bearer BFF: the org is resolved SERVER-SIDE from the Bearer owner claim,
 * and this module never sends — or accepts — an org.
 *
 * Two routes, matched by segment count (the `/chat/:owner/:name` precedent):
 *   ''              the board
 *   ':source/:unit' one unit — a unit id is unique only WITHIN a source, so the
 *                   identity is the PAIR, and a detail URL must carry both.
 *
 * Honest states: a 404/503 (the backend is not routed on this deployment yet) or a
 * 403 renders the shared BackendStateCard, an empty fleet renders the real first-run
 * state, and no cell is ever a fabricated 0 — see `~/lib/api/fleet` for the rule.
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { RefreshCw } from '@hanzogui/lucide-icons-2'

import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { PageHeader } from '~/components/ui/PageHeader'
import { FleetApi, findUnit, type FleetUnit } from '~/lib/api/fleet'
import { FleetBoard } from './fleet/Board'
import { UnitDetail } from './fleet/Detail'

type Async =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; data: FleetUnit[] }

/** How often the board re-reads the fleet. Heartbeats are ~seconds old; this keeps up. */
const POLL_MS = 20_000

export function FleetModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const [state, setState] = useState<Async>({ phase: 'loading' })
  // The staleness clock. Held in state (not read inline) so every "12s ago" on a
  // render agrees, and so the ages advance between polls.
  const [nowS, setNowS] = useState(() => Math.floor(Date.now() / 1000))

  const load = useCallback((quiet = false) => {
    if (!quiet) setState({ phase: 'loading' })
    FleetApi.units()
      .then((data) => {
        setState({ phase: 'ready', data })
        setNowS(Math.floor(Date.now() / 1000))
      })
      // A background refresh must never replace a board that already has real data
      // with an error card; only a first load surfaces the failure.
      .catch((e) => setState((prev) => (quiet && prev.phase === 'ready' ? prev : { phase: 'error', error: classifyBackend(e) })))
  }, [])

  useEffect(() => load(), [load])

  // Poll while the tab is visible; a hidden tab neither fetches nor ages its clock.
  useEffect(() => {
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      setNowS(Math.floor(Date.now() / 1000))
      load(true)
    }
    const id = setInterval(tick, POLL_MS)
    return () => clearInterval(id)
  }, [load])

  const source = params.source
  const unitId = params.unit
  const selected = state.phase === 'ready' && source && unitId ? findUnit(state.data, source, unitId) : undefined
  const open = (u: FleetUnit) => router.push(`/fleet/${encodeURIComponent(u.source ?? '')}/${encodeURIComponent(u.unit)}`)
  const back = () => router.push('/fleet')

  // A deep link to a unit that is no longer in the fleet: say so, don't 404 or hang.
  if (source && unitId && state.phase === 'ready' && !selected) {
    return (
      <YStack gap="$4" p="$4">
        <PageHeader title="Unit not found" subtitle={`No ${source} unit "${unitId}" is linked to your organization.`} />
        <Button size="$2" self="flex-start" onPress={back}>
          Back to Fleet
        </Button>
      </YStack>
    )
  }

  if (selected) {
    return (
      <YStack gap="$4" p="$4">
        <UnitDetail unit={selected} nowS={nowS} onBack={back} />
      </YStack>
    )
  }

  return (
    <YStack gap="$4" p="$4">
      <PageHeader
        title="Fleet"
        subtitle="Every machine your organization owns or links — with live load."
        actions={
          <Button size="$2" icon={<RefreshCw size={14} />} onPress={() => load()} aria-label="Reload the fleet">
            Refresh
          </Button>
        }
      />

      {state.phase === 'loading' ? (
        <XStack p="$6" justify="center">
          <Spinner size="large" color="$color11" />
        </XStack>
      ) : state.phase === 'error' ? (
        <BackendStateCard
          state={state.error}
          onRetry={() => load()}
          hint={
            <Text fontSize="$1" color="$color10">
              GET /v1/fleet
            </Text>
          }
        />
      ) : (
        <FleetBoard units={state.data} nowS={nowS} onOpen={open} />
      )}
    </YStack>
  )
}
