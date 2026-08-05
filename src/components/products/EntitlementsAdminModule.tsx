'use client'

/**
 * Entitlements (super-admin) — manage which products the ACTIVE org has enabled.
 *
 * A super admin masquerades into an org (the org picker / switcher scopes
 * `currentOrg()`), then this surface reads + edits that org's entitlement set over
 * the real `/v1/orgs/{org}/entitlements` API. Toggling a product POSTs a patch and
 * adopts the returned set. Always-on essentials are shown as "Included" (locked —
 * an org can never lose billing/settings/its own home). Access is super-admin only
 * (the catalog entry is `admin: true`) and enforced server-side too.
 *
 * The console renders every product for the org's brand (`visibleCatalog(false)` —
 * the full customer catalog), so a super admin sees the complete on/off picture,
 * not just what's currently enabled.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { ShieldCheck } from '@hanzogui/lucide-icons-2'

import { visibleCatalog } from '~/lib/products/registry'
import { EntitlementsApi } from '~/lib/entitlements'
import { currentOrg } from '~/lib/org-scope'
import { useProductColors } from '~/lib/products/pins'
import { entitlementRows, togglePatch, enabledCount, type EntitlementRow } from './entitlements/logic'
import type { CatalogEntry } from '~/lib/products/registry'
import { BackendStateCard, FieldSwitch, PageHeader, asColor, classifyBackend } from '@hanzo/ui/product'

function Row({
  row,
  busy,
  onToggle,
}: {
  row: EntitlementRow<CatalogEntry>
  busy: boolean
  onToggle: () => void
}) {
  const { colorOf } = useProductColors()
  const Icon = row.entry.icon
  return (
    <XStack items="center" gap="$3" py="$2.5" px="$3" borderBottomWidth={1} borderColor="$borderColor">
      <YStack width={32} height={32} rounded="$3" bg="$color3" items="center" justify="center">
        <Icon size={16} color={asColor(colorOf(row.entry.id))} />
      </YStack>
      <YStack flex={1} minW={0}>
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {row.entry.label}
        </Text>
        <Text fontSize="$1" color="$color10" numberOfLines={1}>
          {row.entry.category} · {row.entry.description}
        </Text>
      </YStack>
      {row.locked ? (
        <Text fontSize="$2" color="$color10" fontWeight="600">
          Included
        </Text>
      ) : (
        <XStack items="center" gap="$2">
          {busy ? <Spinner size="small" color="$color10" /> : null}
          <FieldSwitch checked={row.enabled} onChange={onToggle} disabled={busy} />
        </XStack>
      )}
    </XStack>
  )
}

export function EntitlementsAdminModule() {
  const org = currentOrg()
  const [enabled, setEnabled] = useState<string[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setEnabled((await EntitlementsApi.get(org)).enabled)
    } catch (e) {
      setError(e)
      setEnabled(null)
    }
  }, [org])

  useEffect(() => {
    void load()
  }, [load])

  // Every product the org's brand offers a customer (full on/off picture).
  const products = useMemo(() => visibleCatalog(false), [])
  const rows = useMemo(
    () => (enabled ? entitlementRows(products, enabled) : []),
    [products, enabled],
  )

  const toggle = async (id: string, currentlyEnabled: boolean) => {
    const patch = togglePatch(id, currentlyEnabled)
    if (!patch.add && !patch.remove) return
    setBusyId(id)
    try {
      setEnabled((await EntitlementsApi.update(org, patch)).enabled)
    } catch (e) {
      setError(e)
    } finally {
      setBusyId(null)
    }
  }

  const extras = enabled ? enabledCount(enabled) : 0

  return (
    <YStack gap="$4" p="$4" maxW={860}>
      <PageHeader
        title="Entitlements"
        subtitle={`Products enabled for ${org}${enabled ? ` · ${extras} beyond the essentials` : ''}`}
      />

      {error ? (
        <BackendStateCard
          state={classifyBackend(error)}
          onRetry={load}
          hint="GET /v1/orgs/{org}/entitlements — the entitlement API may not be deployed on this environment yet."
        />
      ) : !enabled ? (
        <XStack items="center" gap="$2" py="$4">
          <Spinner size="small" color="$color10" />
          <Text fontSize="$3" color="$color10">
            Loading {org}'s entitlements…
          </Text>
        </XStack>
      ) : (
        <Card borderWidth={1} borderColor="$borderColor" overflow="hidden">
          <XStack items="center" gap="$2" px="$3" py="$2.5" bg="$color2">
            <ShieldCheck size={14} color="$color10" />
            <Text fontSize="$1" color="$color10" fontWeight="500">
              {rows.length} products · super-admin control
            </Text>
          </XStack>
          {rows.map((row) => (
            <Row
              key={row.entry.id}
              row={row}
              busy={busyId === row.entry.id}
              onToggle={() => toggle(row.entry.id, row.enabled)}
            />
          ))}
        </Card>
      )}
    </YStack>
  )
}
