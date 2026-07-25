'use client'

/**
 * AI Accounts — Machines (the unified login manager). Every AI provider account
 * signed into Claude Code / Codex / dev / the API across your machines, grouped by
 * device, with each account's live usage (session/weekly rate limits, tokens,
 * spend), how it BILLS (a subscription bills your plan; an api key bills credits),
 * the device's active sessions, and a per-account / per-device LOG OUT that revokes
 * the account and stops its running sessions. Plus the redundancy route plan — the
 * order across your accounts (two Claude Max, then the metered API) a run fails over.
 *
 * Every number is REAL from `/v1/links` (fed by the @hanzo/usage collector on each
 * machine) or an honest "—"; nothing is fabricated.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Boxes, RefreshCw, Gauge, Laptop, LogOut, KeyRound, Activity, Route } from '@hanzogui/lucide-icons-2'

import {
  LinksApi,
  type LinksList,
  type Link,
  type Device,
  type RoutePlan,
  type RouteCandidate,
} from '~/lib/api/links'
import {
  accountTitle,
  billingLabel,
  compact,
  headroomTone,
  kindLabel,
  pctText,
  sinceText,
  summarize,
  usd,
} from './links-logic'
import { PageHeader } from '~/components/ui/PageHeader'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { EmptyState } from '~/components/ui/EmptyState'
import { MetricCard, UtilBar } from '~/components/ui/Metric'
import { Loader } from '~/components/ui/Loader'
import { toneColor } from '~/components/ui/tone'
import { toneVar } from '~/components/ui/tone-var'

type Async<T> = { phase: 'loading' } | { phase: 'error'; error: BackendState } | { phase: 'ready'; data: T }

/** A labeled rate-limit lane: used % + a bar colored by remaining headroom. */
function Lane({ title, used }: { title: string; used?: number }) {
  if (typeof used !== 'number') return null
  return (
    <YStack gap="$1">
      <XStack justify="space-between" width={200}>
        <Text fontSize="$1" color="$color11">
          {title}
        </Text>
        <Text fontSize="$1" color="$color12" className="hz-mono">
          {pctText(used)}
        </Text>
      </XStack>
      <UtilBar value={used} width={200} color={headroomTone(100 - used)} />
    </YStack>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <YStack gap="$1">
      <Text fontSize="$1" color="$color10">
        {label}
      </Text>
      <Text fontSize="$3" fontWeight="600" color="$color12" className="hz-mono">
        {value}
      </Text>
    </YStack>
  )
}

/** A small pill — the account kind + billing lane. */
function Badge({ text, tone }: { text: string; tone?: string }) {
  return (
    <Text
      fontSize="$1"
      color="$color11"
      style={tone ? { color: tone } : undefined}
      bg="$color3"
      px="$2"
      py="$1"
      rounded="$10"
      borderWidth={1}
      borderColor="$borderColor"
    >
      {text}
    </Text>
  )
}

/** One linked (or revoked) account within a device. */
function AccountRow({ link, busy, onRevoke }: { link: Link; busy: boolean; onRevoke: (l: Link) => void }) {
  const revoked = link.status === 'revoked'
  const u = link.usage
  return (
    <YStack
      gap="$2"
      p="$3"
      rounded="$4"
      borderWidth={1}
      borderColor="$borderColor"
      bg="$color1"
      opacity={revoked ? 0.55 : 1}
    >
      <XStack items="center" justify="space-between" flexWrap="wrap" gap="$2">
        <XStack items="center" gap="$2" flex={1} minW={200}>
          {link.kind === 'apikey' ? <KeyRound size={15} /> : <Gauge size={15} />}
          <YStack>
            <Text fontSize="$4" fontWeight="700">
              {accountTitle(link)}
            </Text>
            <Text fontSize="$1" color="$color10">
              {link.provider}
              {link.account && link.account !== accountTitle(link) ? ` · ${link.account}` : ''}
            </Text>
          </YStack>
        </XStack>
        <XStack items="center" gap="$2" flexWrap="wrap">
          <Badge text={kindLabel(link.kind)} />
          <Badge text={billingLabel(link.billing)} tone={link.billing === 'plan' ? toneVar('positive') : undefined} />
          {revoked ? (
            <Badge text="logged out" tone={toneVar('critical')} />
          ) : (
            <Button
              size="$2"
              theme="red"
              icon={<LogOut size={14} />}
              disabled={busy}
              onPress={() => onRevoke(link)}
            >
              {busy ? 'Logging out…' : 'Log out'}
            </Button>
          )}
        </XStack>
      </XStack>

      {!revoked && u ? (
        <XStack gap="$5" flexWrap="wrap" items="flex-end">
          <Lane title="Session" used={u.sessionPct} />
          <Lane title="Weekly" used={u.weeklyPct} />
          {u.tokens ? <Fact label="Tokens" value={compact(u.tokens)} /> : null}
          <Fact label={link.billing === 'plan' ? 'Plan spend' : 'Spend'} value={link.billing === 'plan' ? 'on plan' : usd(u.spendCents)} />
          {u.resetsAt ? <Fact label="Resets" value={sinceText(u.resetsAt)} /> : null}
        </XStack>
      ) : !revoked ? (
        <Text fontSize="$1" color="$color10">
          No usage reported yet — waiting for the collector on this machine.
        </Text>
      ) : null}
    </YStack>
  )
}

/** One machine (device) card: its accounts + active sessions + a device log-out. */
function DeviceCard({
  device,
  busyId,
  onRevoke,
  onRevokeDevice,
}: {
  device: Device
  busyId: string | null
  onRevoke: (l: Link) => void
  onRevokeDevice: (d: Device) => void
}) {
  const hasLinked = device.accounts.some((a) => a.status === 'linked')
  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
      <XStack items="center" justify="space-between" flexWrap="wrap" gap="$2">
        <XStack items="center" gap="$2">
          <Laptop size={18} />
          <YStack>
            <Text fontSize="$5" fontWeight="700">
              {device.host || device.machine}
            </Text>
            <Text fontSize="$1" color="$color10">
              {device.os ? `${device.os} · ` : ''}last seen {sinceText(device.lastSeen)}
            </Text>
          </YStack>
        </XStack>
        <XStack items="center" gap="$3">
          <XStack items="center" gap="$1">
            <Activity size={14} />
            <Text fontSize="$2" color="$color11">
              {device.activeSessions} active {device.activeSessions === 1 ? 'session' : 'sessions'}
            </Text>
          </XStack>
          {hasLinked ? (
            <Button
              size="$2"
              theme="red"
              icon={<LogOut size={14} />}
              disabled={busyId === device.machine}
              onPress={() => onRevokeDevice(device)}
            >
              Log out device
            </Button>
          ) : null}
        </XStack>
      </XStack>

      <YStack gap="$2">
        {device.accounts.map((a) => (
          <AccountRow key={a.id} link={a} busy={busyId === a.id} onRevoke={onRevoke} />
        ))}
      </YStack>
    </Card>
  )
}

/** The redundancy route plan across the caller's linked accounts. */
function RoutePanel({ plan }: { plan: RoutePlan }) {
  if (plan.candidates.length === 0) return null
  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" bg="$color2">
      <XStack items="center" gap="$2">
        <Route size={16} />
        <Text fontSize="$5" fontWeight="700">
          Redundancy routing
        </Text>
      </XStack>
      <Text fontSize="$2" color="$color11" maxW={720}>
        The order a run fails over across your accounts — your flat-rate subscriptions first (redundant across
        multiple), then the metered API as the always-available backstop. Availability reads each account's live
        rate-limit headroom.
      </Text>
      <YStack gap="$2">
        {plan.candidates.map((c, i) => (
          <CandidateRow key={c.linkId || `${c.provider}-${i}`} c={c} rank={i + 1} primary={plan.primary?.linkId === c.linkId} />
        ))}
      </YStack>
    </Card>
  )
}

function CandidateRow({ c, rank, primary }: { c: RouteCandidate; rank: number; primary: boolean }) {
  return (
    <XStack
      items="center"
      justify="space-between"
      gap="$2"
      p="$2.5"
      rounded="$4"
      borderWidth={1}
      borderColor={primary ? toneColor('positive') : '$borderColor'}
      bg="$color1"
      flexWrap="wrap"
    >
      <XStack items="center" gap="$2" flex={1} minW={200}>
        <Text fontSize="$2" color="$color10" className="hz-mono">
          {rank}
        </Text>
        <Text fontSize="$3" fontWeight="600">
          {c.plan || c.account || c.provider}
        </Text>
        <Text fontSize="$1" color="$color10">
          {c.provider}
        </Text>
        {primary ? <Badge text="primary" tone={toneVar('positive')} /> : null}
      </XStack>
      <XStack items="center" gap="$3" flexWrap="wrap">
        <Badge text={billingLabel(c.billing)} tone={c.billing === 'plan' ? toneVar('positive') : undefined} />
        <Text fontSize="$2" color={c.available ? '$color12' : toneColor('critical')} className="hz-mono">
          {c.available ? `${pctText(c.headroomPct)} left` : c.reason || 'unavailable'}
        </Text>
      </XStack>
    </XStack>
  )
}

export function AIAccountsMachines(_props: { params: Record<string, string> }) {
  const [state, setState] = useState<Async<LinksList>>({ phase: 'loading' })
  const [plan, setPlan] = useState<RoutePlan | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    LinksApi.list()
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
    // The route plan is best-effort — its failure never blanks the device list.
    LinksApi.route()
      .then(setPlan)
      .catch(() => setPlan(null))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const revokeLink = useCallback(
    async (l: Link) => {
      if (typeof window !== 'undefined' && !window.confirm(`Log out ${accountTitle(l)} on ${l.host || l.machine}? This revokes the account and stops its running sessions.`)) {
        return
      }
      setBusyId(l.id)
      try {
        await LinksApi.revoke(l.id)
      } catch {
        /* the reload surfaces the true state */
      } finally {
        setBusyId(null)
        load()
      }
    },
    [load],
  )

  const revokeDevice = useCallback(
    async (d: Device) => {
      if (typeof window !== 'undefined' && !window.confirm(`Log out every account on ${d.host || d.machine}? This stops the device's running sessions.`)) {
        return
      }
      setBusyId(d.machine)
      try {
        await LinksApi.revokeDevice(d.machine)
      } catch {
        /* the reload surfaces the true state */
      } finally {
        setBusyId(null)
        load()
      }
    },
    [load],
  )

  const header = (
    <PageHeader
      title="Machines"
      subtitle="Every AI account signed in across your machines, with live usage. Log out to revoke an account and stop its sessions."
      actions={
        <Button size="$2" icon={<RefreshCw size={15} />} onPress={load}>
          Refresh
        </Button>
      }
    />
  )

  if (state.phase === 'loading') {
    return (
      <>
        {header}
        <Loader label="Loading your linked accounts…" />
      </>
    )
  }
  if (state.phase === 'error') {
    return (
      <>
        {header}
        <BackendStateCard state={state.error} onRetry={load} />
      </>
    )
  }

  const devices = state.data.devices
  if (devices.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={Boxes}
          title="No linked accounts yet"
          description="Sign into Claude Code, Codex, or the Hanzo CLI on a machine and run the usage collector — the account and its live usage show up here, across every machine."
          bullets={[
            'Your subscription login (Claude Max, ChatGPT Plus) or an API key is detected on the machine.',
            'The collector registers the device + account and pushes its usage — no secret leaves the machine.',
            'Track usage per account per machine here, and route across accounts for redundancy.',
          ]}
        />
      </>
    )
  }

  const s = summarize(devices)
  return (
    <>
      {header}

      <XStack gap="$3" flexWrap="wrap">
        <MetricCard icon={<Laptop size={16} />} label="Machines" value={String(s.devices)} />
        <MetricCard icon={<Boxes size={16} />} label="Accounts" value={String(s.accounts)} caption={`${s.subscriptions} subscription · ${s.apikeys} API`} />
        <MetricCard icon={<Activity size={16} />} label="Active sessions" value={String(s.activeSessions)} />
        <MetricCard icon={<Gauge size={16} />} label="API spend" value={usd(s.spendCents)} caption="subscriptions bill your plan" />
      </XStack>

      {plan ? <RoutePanel plan={plan} /> : null}

      <YStack gap="$3">
        {devices.map((d) => (
          <DeviceCard key={d.machine} device={d} busyId={busyId} onRevoke={revokeLink} onRevokeDevice={revokeDevice} />
        ))}
      </YStack>
    </>
  )
}

