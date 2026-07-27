'use client'

/**
 * Beta features — the CUSTOMER self-service surface (NOT admin). Any signed-in user
 * sees the betas their org can opt into and the ones they've enabled, and can opt
 * in / out. It hits `/v1/enablement` through the per-tenant `/v1` proxy, which
 * scopes to the caller's OWN validated org — a customer can only ever enable their
 * own org, only for a beta item, and can never bypass an admin `off` or flip global
 * state (all enforced server-side).
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { FlaskConical, RefreshCw } from '@hanzogui/lucide-icons-2'

import { ApiError } from '~/lib/api'
import { EnablementApi, type UserEnablementItem } from '~/lib/api/admin-cockpit'
import { PageHeader } from '@hanzo/ui/product'
import { EmptyState } from '@hanzo/ui/product'
import { ErrorState, asApiError } from '~/components/ui/States'

export function BetaFeaturesModule() {
  const [view, setView] = useState<{ items: UserEnablementItem[]; betas: UserEnablementItem[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try { const v = await EnablementApi.view(); setView({ items: v.items, betas: v.betas }) } catch (e) { setErr(asApiError(e)) } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const toggle = useCallback(async (it: UserEnablementItem, on: boolean) => {
    setBusy(`${it.kind}/${it.id}`)
    try { on ? await EnablementApi.optIn({ kind: it.kind, id: it.id }) : await EnablementApi.optOut({ kind: it.kind, id: it.id }); await load() }
    catch (e) { setErr(asApiError(e)) } finally { setBusy('') }
  }, [load])

  if (err) return <YStack p="$4" gap="$4"><PageHeader title="Beta features" /><ErrorState err={err} onRetry={load} /></YStack>

  // Enabled = beta items this org has opted into (effective + state beta).
  const enabled = (view?.items ?? []).filter((i) => i.state === 'beta' && i.optedIn)
  const available = view?.betas ?? []

  const Row = ({ it, on }: { it: UserEnablementItem; on: boolean }) => (
    <XStack key={`${it.kind}/${it.id}`} p="$3" gap="$3" items="center" rounded="$3" borderWidth={1} borderColor="$borderColor" bg="$color2" flexWrap="wrap">
      <YStack flex={1} minW={200}>
        <Text fontSize="$3" color="$color12">{it.id}</Text>
        <Text fontSize="$1" color="$color9">{it.kind} · beta</Text>
      </YStack>
      <Button size="$3" theme={on ? 'red' : 'light'} disabled={busy === `${it.kind}/${it.id}`} onPress={() => void toggle(it, !on)}>
        {on ? 'Opt out' : 'Enable'}
      </Button>
    </XStack>
  )

  return (
    <YStack p="$4" gap="$4">
      <PageHeader
        title="Beta features"
        subtitle="Enable early-access models and features for your organization."
        actions={<Button size="$3" icon={<RefreshCw size={15} />} onPress={load}>Refresh</Button>}
      />
      <YStack gap="$2">
        <XStack items="center" gap="$2"><FlaskConical size={16} /><Text fontSize="$5" color="$color12">Enabled for your org</Text></XStack>
        {loading ? <Text color="$color10">Loading…</Text>
          : enabled.length === 0 ? <EmptyState icon={FlaskConical} title="No betas enabled" description="Enable an available beta below to turn it on for your organization." />
          : <YStack gap="$1">{enabled.map((it) => <Row key={`${it.kind}/${it.id}`} it={it} on />)}</YStack>}
      </YStack>
      <YStack gap="$2">
        <Text fontSize="$5" color="$color12">Available betas</Text>
        {loading ? null
          : available.length === 0 ? <EmptyState icon={FlaskConical} title="No betas available" description="New early-access models and features appear here as they open." />
          : <YStack gap="$1">{available.map((it) => <Row key={`${it.kind}/${it.id}`} it={it} on={false} />)}</YStack>}
      </YStack>
    </YStack>
  )
}
