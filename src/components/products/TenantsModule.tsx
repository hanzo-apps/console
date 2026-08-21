'use client'

/**
 * Tenants / White-Label — the operator's board for launching, branding, and
 * managing white-label tenants + resold sub-orgs.
 *
 * GLOBAL-ADMIN / reseller surface (`admin: true` in the registry): a Hanzo global
 * admin sees every tenant; the honest data path today is global-admin only (the
 * IAM org list + the admin cockpit both gate on the global-admin proxy). Reseller
 * self-scoping — a reseller seeing only its own sub-tree — is a foundation follow-up
 * that needs a reseller-scoped org-list endpoint + a real `parentOrgId` column
 * (flagged in the honest banner, never faked).
 *
 * It COMPOSES two real backends (no new backend, no fabrication):
 *   - IAM orgs (`IamAdminApi.organizations`, /admin/iam) → the tenant list + brand.
 *   - Admin cockpit customers (`AdminCockpitApi.customers`, /v1/admin/customers) →
 *     plan / wallet / status / users / owner (real cross-tenant data).
 *
 * One view + a detail SlideOver:
 *   - Tenants: a flat list OR the reseller tree (org → sub-orgs), searchable.
 *   - Detail: `TenantDetail` — brand, IAM, billing.
 *
 * Honest states everywhere: real where the API answers, honest empty where it does
 * not. Reuses the shared primitives.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { ChevronRight, Building2, Layers, List as ListIcon, RefreshCw, Search } from '@hanzogui/lucide-icons-2'

import { ApiError, IamAdminApi } from '~/lib/api'
import { AdminCockpitApi, type CustomerRow } from '~/lib/api/admin-cockpit'
import type { Organization } from '~/lib/api/admin'
import { SlideOver } from '~/components/ui/SlideOver'
import {
  composeTenants,
  deriveResellerParents,
  buildResellerTree,
  flattenTree,
  treeIsInferred,
  filterTenants,
  type Tenant,
} from './tenants/model'
import { TenantDetail } from './tenants/TenantDetail'
import { BackendStateCard, DataTable, EmptyState, FieldText, PageHeader, StatusTag, classifyRead, type BackendState, type Column } from '@hanzo/ui/product'
import { usd } from '~/lib/money'

type Layout = 'flat' | 'tree'

// ── Tenants board (list + reseller tree + detail) ────────────────────────────

export function TenantsModule(_props: { params: Record<string, string> }) {
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [state, setState] = useState<BackendState | null>(null)
  const [query, setQuery] = useState('')
  const [layout, setLayout] = useState<Layout>('flat')
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setState(null)
    try {
      // The org list is the authoritative tenant set (global-admin only). The cockpit
      // ENRICHES it — best-effort, so it being down never blanks the board (honest
      // partial: brand from IAM, "—" for the missing enrichment).
      const orgPage = await IamAdminApi.organizations({ pageSize: 200 })
      setOrgs(orgPage.rows)
      setCustomers(await AdminCockpitApi.customers().catch(() => [] as CustomerRow[]))
    } catch (e) {
      const s = classifyRead(e)
      if (s) setState(s)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const tenants = useMemo<Tenant[]>(() => {
    const composed = composeTenants(
      orgs.map((o) => ({
        name: o.name,
        displayName: o.displayName,
        logo: o.logo,
        favicon: o.favicon,
        metadata: (o as { metadata?: string }).metadata,
        themeColor: o.themeData?.colorPrimary,
      })),
      customers.map((c) => ({
        org: c.org,
        display: c.display,
        ownerEmail: c.ownerEmail,
        plan: c.plan,
        status: c.status,
        users: c.users,
        balanceCents: c.balanceCents,
        spendCents: c.spendCents,
        mrrCents: c.mrrCents,
      })),
      [],
    )
    return deriveResellerParents(composed)
  }, [orgs, customers])

  const filtered = useMemo(() => filterTenants(tenants, query), [tenants, query])
  const inferred = useMemo(() => treeIsInferred(tenants), [tenants])
  const selectedTenant = useMemo(() => tenants.find((t) => t.org === selected) ?? null, [tenants, selected])

  // Flat rows or tree-flattened (indented) rows, depending on layout.
  const rows = useMemo(() => {
    if (layout === 'flat') return filtered.map((t) => ({ tenant: t, depth: 0 }))
    const tree = buildResellerTree(filtered)
    return flattenTree(tree)
  }, [filtered, layout])

  const columns: Column<{ tenant: Tenant; depth: number }>[] = [
    {
      key: 'name',
      header: 'Tenant',
      render: ({ tenant, depth }) => (
        <XStack gap="$2" items="center" style={{ paddingLeft: depth * 18 }}>
          {depth > 0 ? <ChevronRight size={12} color="$color9" /> : null}
          {tenant.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={tenant.logo} alt="" style={{ height: 20, width: 20, borderRadius: 4, objectFit: 'contain' }} />
          ) : (
            <YStack width={20} height={20} rounded="$2" bg="$color4" items="center" justify="center">
              <Text fontSize="$1" fontWeight="800" color="$color11">
                {tenant.display.slice(0, 1).toUpperCase()}
              </Text>
            </YStack>
          )}
          <YStack flex={1} minW={0}>
            <Text fontSize="$3" fontWeight="600" numberOfLines={1}>
              {tenant.display}
            </Text>
            <Text fontSize="$1" color="$color10" numberOfLines={1}>
              {tenant.org}
            </Text>
          </YStack>
        </XStack>
      ),
    },
    {
      key: 'plan',
      header: 'Plan',
      width: 120,
      render: ({ tenant }) => (
        <Text fontSize="$3" color="$color11" numberOfLines={1}>
          {tenant.plan ?? '—'}
        </Text>
      ),
    },
    {
      key: 'wallet',
      header: 'Wallet',
      width: 100,
      render: ({ tenant }) => (
        <Text fontSize="$3" color="$color11">
          {usd(tenant.balanceCents)}
        </Text>
      ),
    },
    {
      key: 'users',
      header: 'Users',
      width: 80,
      render: ({ tenant }) => (
        <Text fontSize="$3" color="$color11">
          {tenant.users ?? '—'}
        </Text>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 120,
      render: ({ tenant }) => <StatusTag status={tenant.status} />,
    },
  ]

  return (
    <>
      <PageHeader
        title="Tenants"
        subtitle="Launch, brand, and manage white-label tenants and resold sub-orgs."
        actions={
          <XStack gap="$2">
            <Button theme="light" icon={<Building2 size={16} />} onPress={() => setCreating(true)}>
              New tenant
            </Button>
            <Button icon={<RefreshCw size={16} />} onPress={() => void load()}>
              Refresh
            </Button>
          </XStack>
        }
      />

      {state ? (
        <BackendStateCard state={state} onRetry={() => void load()} />
      ) : (
        <>
          {/* Controls: search + layout toggle */}
          <XStack gap="$2" items="center" flexWrap="wrap">
            <XStack flex={1} minW={200} items="center" gap="$2" borderWidth={1} borderColor="$borderColor" rounded="$3" px="$3">
              <Search size={15} color="$color10" />
              <YStack flex={1}>
                <FieldText value={query} onChange={setQuery} placeholder="Search tenants…" />
              </YStack>
            </XStack>
            <XStack gap="$1" borderWidth={1} borderColor="$borderColor" rounded="$3" p="$1">
              <Button
                size="$2"
                chromeless={layout !== 'flat'}
                theme={layout === 'flat' ? 'light' : undefined}
                icon={<ListIcon size={14} />}
                onPress={() => setLayout('flat')}
              >
                List
              </Button>
              <Button
                size="$2"
                chromeless={layout !== 'tree'}
                theme={layout === 'tree' ? 'light' : undefined}
                icon={<Layers size={14} />}
                onPress={() => setLayout('tree')}
              >
                Reseller tree
              </Button>
            </XStack>
          </XStack>

          {layout === 'tree' && inferred ? (
            <Card p="$3" borderWidth={1} borderColor="$borderColor" borderStyle="dashed">
              <Text fontSize="$2" color="$color10">
                This tree is inferred from shared owner emails. The platform has no `parentOrgId` column yet, so a
                branch here is a guess rather than a declared parent.
              </Text>
            </Card>
          ) : null}

          {!loading && filtered.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No tenants yet"
              description="White-label tenants are organizations with their own brand, IAM scope, and resources."
              bullets={[
                'Every existing brand (zoo / lux / pars) is a tenant record in this model.',
                'A tenant can be a reseller — its sub-orgs hang off it in the tree.',
              ]}
            />
          ) : (
            <DataTable
              columns={columns}
              rows={rows}
              loading={loading}
              rowKey={(r) => r.tenant.org}
              empty="No tenants match your search."
              onRowPress={(r) => setSelected(r.tenant.org)}
            />
          )}

          <Text fontSize="$1" color="$color9">
            {filtered.length} tenant{filtered.length === 1 ? '' : 's'} · brand from IAM · plan/wallet from the
            billing cockpit.
          </Text>
        </>
      )}

      <SlideOver
        open={!!selectedTenant}
        onClose={() => setSelected(null)}
        size={520}
        title={selectedTenant ? `Manage · ${selectedTenant.display}` : 'Manage tenant'}
        icon={Building2}
      >
        {selectedTenant ? <TenantDetail tenant={selectedTenant} onChanged={() => void load()} /> : null}
      </SlideOver>

      <SlideOver
        open={creating}
        onClose={() => setCreating(false)}
        size={480}
        title="New tenant"
        icon={Building2}
      >
        <NewTenantForm
          onCreated={() => {
            setCreating(false)
            void load()
          }}
        />
      </SlideOver>
    </>
  )
}

// ── New tenant (create the org RECORD + brand — data-driven) ─────────────────

function NewTenantForm({ onCreated }: { onCreated: () => void }) {
  const [slug, setSlug] = useState('')
  const [display, setDisplay] = useState('')
  const [logo, setLogo] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)

  // Slugify as the operator types the display name (only when slug is untouched).
  const [slugTouched, setSlugTouched] = useState(false)
  const onDisplay = (v: string) => {
    setDisplay(v)
    if (!slugTouched) setSlug(v.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, ''))
  }

  const create = async () => {
    const name = slug.trim()
    if (!name) return
    setBusy(true)
    setMsg(null)
    try {
      // The tenant IS an org RECORD (brand fields — logo — are real IAM org fields),
      // created via the global-admin IAM proxy. No hardcoded brand map.
      await IamAdminApi.addOrganization({
        owner: 'admin',
        name,
        displayName: display.trim() || name,
        ...(logo.trim() ? { logo: logo.trim() } : {}),
      })
      setMsg({ tone: 'ok', text: `Created tenant "${name}". Manage its brand and IAM scope from the list.` })
      onCreated()
    } catch (e) {
      setMsg({ tone: 'err', text: e instanceof ApiError ? e.message : 'Could not create tenant' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <YStack gap="$3">
      <Text fontSize="$2" color="$color10">
        A tenant is an organization record. Creating one writes a real IAM org (its brand — logo/favicon/theme — are
        real org fields). Edit the brand and its IAM apps from the tenant’s manage panel.
      </Text>
      <YStack gap="$1">
        <Text fontSize="$2" color="$color11">Display name</Text>
        <FieldText value={display} onChange={onDisplay} placeholder="Acme Inc" />
      </YStack>
      <YStack gap="$1">
        <Text fontSize="$2" color="$color11">Slug (org id)</Text>
        <FieldText
          value={slug}
          onChange={(v) => {
            setSlugTouched(true)
            setSlug(v.toLowerCase().replace(/[^a-z0-9-]+/g, '-'))
          }}
          placeholder="acme"
        />
      </YStack>
      <YStack gap="$1">
        <Text fontSize="$2" color="$color11">Logo URL (optional)</Text>
        <FieldText value={logo} onChange={setLogo} placeholder="https://…/logo.svg" />
      </YStack>
      <XStack gap="$3" items="center">
        <Button theme="light" disabled={busy || !slug.trim()} onPress={() => void create()}>
          {busy ? 'Creating…' : 'Create tenant'}
        </Button>
        {msg ? (
          <Text fontSize="$2" color={msg.tone === 'ok' ? '$green10' : '$red10'} flex={1}>
            {msg.text}
          </Text>
        ) : null}
      </XStack>
    </YStack>
  )
}
