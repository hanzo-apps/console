'use client'

/**
 * Routing (admin) — the config-as-Base auto-routing editor on admin.hanzo.ai. The
 * ONE place a super-admin sets the platform auto-routing policy as DATA (Base/SQLite
 * OrgSettings rows), not an env var or a code toggle:
 *
 *   1. GLOBAL DEFAULT — the reserved "*" row: the platform-wide auto-routing default
 *      every org inherits until it sets its own. Three-state (inherit / enabled /
 *      disabled); inherit clears it so the gateway conf decides.
 *   2. PER-ORG OVERRIDES — one row per org, the same three-state, edited inline. An
 *      org not yet listed is added by id and managed the same way. Setting a single
 *      org (e.g. `hanzo`) to Enabled is the "org-first" rollout — turn one org on
 *      before flipping the global default. Reverting to inherit deletes the row
 *      (unless it also holds router policy, then it just clears the field).
 *
 * Every edit is a write to the OrgSettings row via OrgSettingsApi (read-modify-write,
 * so sibling routing-policy fields are never clobbered). GLOBAL-ADMIN ONLY: the
 * endpoints are RequireSuperAdmin upstream, so a non-admin who reaches this sees the
 * real SuperAdminRequired panel — never a faked success. Honest states, no
 * fabricated rows.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { RefreshCw, Route, Plus, Globe } from '@hanzogui/lucide-icons-2'

import { ApiError } from '~/lib/api'
import {
  OrgSettingsApi,
  routingState,
  emptyOrgSettings,
  GLOBAL_DEFAULT_OWNER,
  type OrgSettings,
  type RoutingState,
} from '~/lib/api/org-settings'
import { getBrand } from '~/lib/branding/brands'
import { PageHeader } from '~/components/ui/PageHeader'
import { MetricCard } from '~/components/ui/Metric'
import { EmptyState } from '~/components/ui/EmptyState'
import { ErrorState, asApiError, isForbidden, SuperAdminRequired } from '~/components/ui/States'

const STATES: RoutingState[] = ['inherit', 'enabled', 'disabled']
const LABEL: Record<RoutingState, string> = { inherit: 'Inherit', enabled: 'Enabled', disabled: 'Disabled' }

/** The three-state segmented control — inherit (neutral) / enabled (green) / disabled (red). */
function RoutingControl({
  value,
  disabled,
  onChange,
}: {
  value: RoutingState
  disabled?: boolean
  onChange: (s: RoutingState) => void
}) {
  const bgOf = (s: RoutingState) => (s === 'enabled' ? '$green3' : s === 'disabled' ? '$red3' : '$color5')
  const fgOf = (s: RoutingState) => (s === 'enabled' ? '$green11' : s === 'disabled' ? '$red11' : '$color11')
  return (
    <XStack gap="$1" bg="$color3" rounded="$4" p="$1" opacity={disabled ? 0.6 : 1}>
      {STATES.map((s) => (
        <Button
          key={s}
          size="$2"
          chromeless={value !== s}
          disabled={disabled}
          bg={value === s ? bgOf(s) : undefined}
          onPress={() => onChange(s)}
          aria-label={`Auto-routing ${LABEL[s]}`}
        >
          <Text fontSize="$1" color={value === s ? fgOf(s) : '$color10'}>
            {LABEL[s]}
          </Text>
        </Button>
      ))}
    </XStack>
  )
}

export function RoutingModule() {
  // The reserved "*" default row (null = unset → gateway conf decides).
  const [globalRow, setGlobalRow] = useState<OrgSettings | null>(null)
  // The per-org working set — seeded from the list read + admin-added orgs.
  const [orgs, setOrgs] = useState<OrgSettings[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState<{ ok: boolean; msg: string } | null>(null)
  const [newOrg, setNewOrg] = useState('')

  // On the Hanzo brand, seed the "org-first" activation target so it is one row in
  // the list (set it to Enabled). White-label safe: only Hanzo admin, never Lux/Zoo.
  const seedOwner = useMemo(() => (getBrand().id === 'hanzo' ? 'hanzo' : null), [])

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      // The global "*" read is the auth canary — a 403 here is the honest gate.
      const g = await OrgSettingsApi.get(GLOBAL_DEFAULT_OWNER)
      const [list, seed] = await Promise.all([
        OrgSettingsApi.list().catch(() => [] as OrgSettings[]),
        seedOwner ? OrgSettingsApi.get(seedOwner).catch(() => null) : Promise.resolve(null),
      ])
      const rows = list.filter((s) => s.owner !== GLOBAL_DEFAULT_OWNER)
      if (seedOwner && !rows.some((s) => s.owner === seedOwner)) {
        rows.unshift(seed ?? emptyOrgSettings(seedOwner))
      }
      setGlobalRow(g)
      setOrgs(rows)
    } catch (e) {
      setErr(asApiError(e))
    } finally {
      setLoading(false)
    }
  }, [seedOwner])

  useEffect(() => {
    void load()
  }, [load])

  const setGlobal = useCallback(async (state: RoutingState) => {
    setBusy(GLOBAL_DEFAULT_OWNER)
    setNotice(null)
    try {
      const updated = await OrgSettingsApi.setRouting(GLOBAL_DEFAULT_OWNER, state)
      setGlobalRow(updated)
      setNotice({ ok: true, msg: `Global default → ${LABEL[state]}` })
    } catch (e) {
      setNotice({ ok: false, msg: asApiError(e).message })
    } finally {
      setBusy('')
    }
  }, [])

  const setOrg = useCallback(async (owner: string, state: RoutingState) => {
    setBusy(owner)
    setNotice(null)
    try {
      await OrgSettingsApi.setRouting(owner, state)
      // Refetch the one row so the control reflects the real stored value.
      const fresh = await OrgSettingsApi.get(owner)
      setOrgs((prev) => prev.map((s) => (s.owner === owner ? fresh ?? emptyOrgSettings(owner) : s)))
      setNotice({ ok: true, msg: `${owner} → ${LABEL[state]}` })
    } catch (e) {
      setNotice({ ok: false, msg: asApiError(e).message })
    } finally {
      setBusy('')
    }
  }, [])

  const addOrg = useCallback(async () => {
    const owner = newOrg.trim()
    if (!owner) {
      setNotice({ ok: false, msg: 'Enter an organization id.' })
      return
    }
    if (owner === GLOBAL_DEFAULT_OWNER) {
      setNotice({ ok: false, msg: 'Use the global default above for the platform-wide "*" row.' })
      return
    }
    setBusy('add')
    setNotice(null)
    try {
      const row = await OrgSettingsApi.get(owner)
      setOrgs((prev) => [row ?? emptyOrgSettings(owner), ...prev.filter((s) => s.owner !== owner)])
      setNewOrg('')
    } catch (e) {
      setNotice({ ok: false, msg: asApiError(e).message })
    } finally {
      setBusy('')
    }
  }, [newOrg])

  if (err && isForbidden(err)) return <SuperAdminRequired />
  if (err)
    return (
      <YStack p="$4" gap="$4">
        <PageHeader title="Routing" />
        <ErrorState err={err} onRetry={load} />
      </YStack>
    )

  const overrides = orgs.filter((s) => routingState(s) !== 'inherit').length

  return (
    <YStack p="$4" gap="$4">
      <PageHeader
        title="Routing"
        subtitle="Set the platform auto-routing default and per-org overrides as data. Global-admin only."
        actions={
          <Button size="$3" icon={<RefreshCw size={15} />} disabled={loading} onPress={load}>
            Refresh
          </Button>
        }
      />

      <XStack gap="$3" flexWrap="wrap">
        <MetricCard icon={<Globe size={16} />} label="Global default" value={LABEL[routingState(globalRow)]} />
        <MetricCard icon={<Route size={16} />} label="Org overrides" value={String(overrides)} />
      </XStack>

      {notice && (
        <XStack p="$3" rounded="$4" bg={notice.ok ? '$green3' : '$red3'}>
          <Text fontSize="$2" color={notice.ok ? '$green11' : '$red11'}>
            {notice.msg}
          </Text>
        </XStack>
      )}

      {/* ── Global default ("*") ─────────────────────────────────────────── */}
      <YStack p="$4" gap="$3" rounded="$4" borderWidth={1} borderColor="$borderColor" bg="$color2">
        <XStack items="center" justify="space-between" gap="$3" flexWrap="wrap">
          <YStack gap="$1" flex={1} minW={240}>
            <Text fontSize="$5" color="$color12">
              Global default
            </Text>
            <Text fontSize="$1" color="$color10">
              The platform-wide auto-routing default (the reserved “*” row). Every org inherits this until it sets its
              own override below. Inherit clears it, so the gateway configuration decides.
            </Text>
          </YStack>
          <RoutingControl
            value={routingState(globalRow)}
            disabled={loading || busy === GLOBAL_DEFAULT_OWNER}
            onChange={(s) => void setGlobal(s)}
          />
        </XStack>
      </YStack>

      {/* ── Add an org override ──────────────────────────────────────────── */}
      <YStack p="$4" gap="$3" rounded="$4" borderWidth={1} borderColor="$borderColor" bg="$color2">
        <Text fontSize="$4" color="$color12">
          Override an organization
        </Text>
        <Text fontSize="$1" color="$color10">
          Turn auto-routing on (or off) for a single org first — the org-first rollout — before flipping the global
          default. Add the org, then set its state. Reverting to Inherit removes the override.
        </Text>
        <XStack gap="$3" items="flex-end" flexWrap="wrap">
          <YStack gap="$1" flex={1} minW={220}>
            <Text fontSize="$1" color="$color10">
              Organization id
            </Text>
            <input
              value={newOrg}
              onChange={(e) => setNewOrg(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void addOrg()
              }}
              placeholder="organization id"
              style={{
                background: 'transparent',
                border: '1px solid var(--borderColor)',
                borderRadius: 8,
                padding: '8px 10px',
                color: 'var(--color12)',
                width: '100%',
              }}
            />
          </YStack>
          <Button size="$3" icon={<Plus size={15} />} disabled={busy === 'add'} onPress={() => void addOrg()}>
            Add override
          </Button>
        </XStack>
      </YStack>

      {/* ── Per-org overrides ────────────────────────────────────────────── */}
      <YStack gap="$2">
        <Text fontSize="$5" color="$color12">
          Per-org overrides
        </Text>
        {loading ? (
          <Text color="$color10">Loading…</Text>
        ) : orgs.length === 0 ? (
          <EmptyState
            icon={Route}
            title="No per-org overrides"
            description="Every org inherits the global default above. Add an org to turn auto-routing on or off just for it."
          />
        ) : (
          <YStack gap="$1">
            {orgs.map((s) => (
              <XStack
                key={s.owner}
                p="$3"
                gap="$3"
                items="center"
                rounded="$3"
                borderWidth={1}
                borderColor="$borderColor"
                bg="$color2"
                flexWrap="wrap"
              >
                <YStack flex={1} minW={200}>
                  <Text fontSize="$3" color="$color12">
                    {s.owner}
                  </Text>
                  <Text fontSize="$1" color="$color9">
                    {routingState(s) === 'inherit'
                      ? 'Inherits the global default'
                      : `Override${s.updatedTime ? ` · updated ${s.updatedTime}` : ''}`}
                  </Text>
                </YStack>
                <RoutingControl
                  value={routingState(s)}
                  disabled={busy === s.owner}
                  onChange={(state) => void setOrg(s.owner, state)}
                />
              </XStack>
            ))}
          </YStack>
        )}
      </YStack>
    </YStack>
  )
}
