'use client'

/**
 * Launch Control (admin) — the GLOBAL-ADMIN launch dashboard on admin.hanzo.ai.
 * The ONE place to govern access to every hosted Hanzo service, two boards:
 *
 *   1. SERVICES — a row per hosted service with a WAITLIST-MODE toggle. Flip it OFF
 *      to remove the waitlist (open to any signed-up user); ON to gate (approved
 *      users only). This is the "remove the waitlist one service at a time" lever.
 *      Backed by cloud `clients/featuregate` (`/v1/admin/services*`), the ONE
 *      registry both enforcement points read.
 *   2. PENDING USERS — the approval queue (approve / reject), REUSING the IAM
 *      approval API (iam#104) through the /admin/iam proxy. Global approval = off
 *      the waitlist everywhere. No second approval store.
 *
 * All reads/writes terminate at a global-admin-gated proxy (server 403 for a
 * non-admin); `admin: true` hides the entry from every customer. Honest states
 * throughout — never a fabricated row.
 */
import { useCallback, useEffect, useState } from 'react'
import { Card, Text, XStack, YStack } from '@hanzo/gui'
import { BadgeCheck, DoorOpen, Lock, ShieldCheck, UserCheck, UserX, Users } from '@hanzogui/lucide-icons-2'

import { FeatureGateApi, type FeatureService } from '~/lib/api/admin-featuregate'
import { IamAdminApi, type IamUser } from '~/lib/api/admin'
import { PageHeader } from '~/components/ui/PageHeader'
import { MetricCard } from '~/components/ui/Metric'
import { EmptyState } from '~/components/ui/EmptyState'
import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { FieldSwitch } from '~/components/ui/Field'
import { asApiError, ErrorState, isForbidden, OperatorAccessRequired } from '~/components/ui/States'
import { ApiError } from '~/lib/api'

type Async<T> = { phase: 'loading' } | { phase: 'error'; err: ApiError } | { phase: 'ready'; data: T }

type Board = { services: FeatureService[]; pending: IamUser[] }

const userId = (u: IamUser): string => `${u.owner ?? ''}/${u.name ?? ''}`

export function FeatureGateModule() {
  const [state, setState] = useState<Async<Board>>({ phase: 'loading' })
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    Promise.all([
      FeatureGateApi.list().catch(() => [] as FeatureService[]),
      IamAdminApi.pendingUsers().then((p) => p.rows).catch(() => [] as IamUser[]),
    ])
      .then(([services, pending]) => setState({ phase: 'ready', data: { services, pending } }))
      .catch((e) => setState({ phase: 'error', err: asApiError(e) }))
  }, [])
  useEffect(() => load(), [load])

  const withBusy = useCallback(async (key: string, fn: () => Promise<void>) => {
    setBusy((b) => ({ ...b, [key]: true }))
    setNote(null)
    try {
      await fn()
    } catch (e) {
      const err = asApiError(e)
      setNote(isForbidden(err) ? 'Global admin required.' : err.message)
    } finally {
      setBusy((b) => ({ ...b, [key]: false }))
    }
  }, [])

  const toggleMode = useCallback(
    (svc: FeatureService, waitlistMode: boolean) =>
      withBusy(`svc:${svc.service}`, async () => {
        const updated = await FeatureGateApi.setMode(svc.service, waitlistMode)
        setState((s) =>
          s.phase === 'ready'
            ? { ...s, data: { ...s.data, services: s.data.services.map((x) => (x.service === updated.service ? updated : x)) } }
            : s,
        )
      }),
    [withBusy],
  )

  const decide = useCallback(
    (u: IamUser, approve: boolean) =>
      withBusy(`usr:${userId(u)}`, async () => {
        if (approve) await IamAdminApi.approveUser(userId(u))
        else await IamAdminApi.rejectUser(userId(u))
        setState((s) =>
          s.phase === 'ready'
            ? { ...s, data: { ...s.data, pending: s.data.pending.filter((x) => userId(x) !== userId(u)) } }
            : s,
        )
      }),
    [withBusy],
  )

  if (state.phase === 'loading') {
    return (
      <YStack p="$4" gap="$4">
        <PageHeader title="Launch Control" subtitle="Loading services and the approval queue…" />
      </YStack>
    )
  }
  if (state.phase === 'error') {
    return isForbidden(state.err) ? <OperatorAccessRequired /> : <ErrorState err={state.err} onRetry={load} />
  }

  const { services, pending } = state.data
  const gated = services.filter((s) => s.waitlistMode).length
  const open = services.length - gated

  return (
    <YStack p="$4" gap="$5">
      <PageHeader
        title="Launch Control"
        subtitle="Govern access to every hosted service — remove the waitlist one service at a time, and approve users."
        actions={<PrimaryButton onPress={load}>Refresh</PrimaryButton>}
      />

      <XStack gap="$3" flexWrap="wrap">
        <MetricCard icon={<ShieldCheck size={16} />} label="Services" value={String(services.length)} />
        <MetricCard icon={<Lock size={16} />} label="Gated (waitlist on)" value={String(gated)} />
        <MetricCard icon={<DoorOpen size={16} />} label="Open" value={String(open)} />
        <MetricCard icon={<Users size={16} />} label="Pending users" value={String(pending.length)} />
      </XStack>

      {note ? (
        <Card p="$3" rounded="$4" bg="$red2" borderColor="$red6" borderWidth={1}>
          <Text color="$red11">{note}</Text>
        </Card>
      ) : null}

      {/* ── Services board ─────────────────────────────────────────────── */}
      <YStack gap="$3">
        <Text fontSize="$6" fontWeight="600">
          Services
        </Text>
        {services.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="No services registered" description="The feature-gate registry is empty on this deployment." />
        ) : (
          <YStack gap="$2">
            {services.map((svc) => (
              <Card key={svc.service} p="$3" rounded="$4" borderWidth={1} borderColor="$borderColor">
                <XStack items="center" justify="space-between" gap="$3" flexWrap="wrap">
                  <YStack gap="$1" flex={1} minW={220}>
                    <XStack items="center" gap="$2">
                      <Text fontWeight="600">{svc.displayName}</Text>
                      {svc.waitlistMode ? (
                        <XStack items="center" gap="$1">
                          <Lock size={14} color="$yellow10" />
                          <Text fontSize="$2" color="$yellow10">Waitlist</Text>
                        </XStack>
                      ) : (
                        <XStack items="center" gap="$1">
                          <DoorOpen size={14} color="$green10" />
                          <Text fontSize="$2" color="$green10">Open</Text>
                        </XStack>
                      )}
                    </XStack>
                    <Text fontSize="$2" color="$color10">{svc.hosts.join(' · ') || svc.description}</Text>
                    {svc.updatedBy ? (
                      <Text fontSize="$1" color="$color9">Last changed by {svc.updatedBy}</Text>
                    ) : null}
                  </YStack>
                  <XStack items="center" gap="$2">
                    <Text fontSize="$2" color="$color10">Waitlist mode</Text>
                    <FieldSwitch
                      checked={svc.waitlistMode}
                      disabled={!!busy[`svc:${svc.service}`]}
                      onChange={(v) => toggleMode(svc, v)}
                    />
                  </XStack>
                </XStack>
              </Card>
            ))}
          </YStack>
        )}
      </YStack>

      {/* ── Pending-users queue ────────────────────────────────────────── */}
      <YStack gap="$3">
        <Text fontSize="$6" fontWeight="600">
          Pending users
        </Text>
        {pending.length === 0 ? (
          <EmptyState icon={BadgeCheck} title="No one is waiting" description="Every signed-up user has been reviewed. New signups appear here for approval." />
        ) : (
          <YStack gap="$2">
            {pending.map((u) => (
              <Card key={userId(u)} p="$3" rounded="$4" borderWidth={1} borderColor="$borderColor">
                <XStack items="center" justify="space-between" gap="$3" flexWrap="wrap">
                  <YStack gap="$1" flex={1} minW={220}>
                    <Text fontWeight="600">{u.displayName || u.name}</Text>
                    <Text fontSize="$2" color="$color10">
                      {u.email || u.name} · {u.owner}
                    </Text>
                  </YStack>
                  <XStack items="center" gap="$2">
                    <PrimaryButton
                      icon={UserCheck}
                      disabled={!!busy[`usr:${userId(u)}`]}
                      onPress={() => decide(u, true)}
                    >
                      Approve
                    </PrimaryButton>
                    <PrimaryButton
                      icon={UserX}
                      theme="red"
                      disabled={!!busy[`usr:${userId(u)}`]}
                      onPress={() => decide(u, false)}
                    >
                      Reject
                    </PrimaryButton>
                  </XStack>
                </XStack>
              </Card>
            ))}
          </YStack>
        )}
      </YStack>
    </YStack>
  )
}
