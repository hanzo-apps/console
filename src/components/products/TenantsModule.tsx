'use client'

/**
 * Tenants / White-Label — the operator's board for launching, branding,
 * domain-binding, and managing white-label tenants + resold sub-orgs.
 *
 * GLOBAL-ADMIN / reseller surface (`admin: true` in the registry): a Hanzo global
 * admin sees every tenant; the honest data path today is global-admin only (the
 * IAM org list + the admin cockpit both gate on the global-admin proxy). Reseller
 * self-scoping — a reseller seeing only its own sub-tree — is a foundation follow-up
 * that needs a reseller-scoped org-list endpoint + a real `parentOrgId` column
 * (flagged in the honest banner, never faked).
 *
 * It COMPOSES three real backends (no new backend, no fabrication):
 *   - IAM orgs (`IamAdminApi.organizations`, /admin/iam) → the tenant list + brand.
 *   - Admin cockpit customers (`AdminCockpitApi.customers`, /v1/admin/customers) →
 *     plan / wallet / status / users / owner (real cross-tenant data).
 *   - Platform clusters (`TenantsApi.clusters`, /paas) → the dedicated cluster.
 *
 * Two views + a detail SlideOver:
 *   - Tenants: a flat list OR the reseller tree (org → sub-orgs), searchable.
 *   - Packages: the preset-bundle catalog (`packages.ts`) a tenant can be granted.
 *   - Detail: `TenantDetail` — brand, cluster, domain, IAM, billing, packages.
 *
 * Honest states everywhere: real where the API answers, honest empty / not-connected
 * where a provisioning endpoint isn't bound yet. Reuses the shared primitives.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Boxes, ChevronRight, Building2, Layers, List as ListIcon, RefreshCw, Search } from '@hanzogui/lucide-icons-2'

import { ApiError, IamAdminApi, TenantsApi } from '~/lib/api'
import { AdminCockpitApi, type CustomerRow } from '~/lib/api/admin-cockpit'
import type { Organization } from '~/lib/api/admin'
import { SlideOver } from '~/components/ui/SlideOver'
import { SERVICE_LABELS, fillPattern, type Package } from './tenants/packages'
import { PlatformStateCard, interpretPlatformError, type PlatformError } from './platform/state'
import {
  composeTenants,
  deriveResellerParents,
  buildResellerTree,
  flattenTree,
  treeIsInferred,
  filterTenants,
  type Tenant,
  type TenantClusterInput,
} from './tenants/model'
import { TenantDetail } from './tenants/TenantDetail'
import { BackendStateCard, DataTable, EmptyState, FieldText, PageHeader, StatusTag, classifyRead, type BackendState, type Column } from '@hanzo/ui/product'
import { usd } from '~/lib/money'


type Tab = 'tenants' | 'packages'
type Layout = 'flat' | 'tree'

export function TenantsModule({ params }: { params: Record<string, string> }) {
  const tab: Tab = params.tab === 'packages' ? 'packages' : 'tenants'
  return tab === 'packages' ? <PackageCatalog /> : <TenantsBoard />
}

// ── Tenants board (list + reseller tree + detail) ────────────────────────────

function TenantsBoard() {
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [clusters, setClusters] = useState<TenantClusterInput[]>([])
  const [packages, setPackages] = useState<Package[]>([])
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
      // The org list is the authoritative tenant set (global-admin only). Cockpit +
      // clusters ENRICH it — each is best-effort so one being down never blanks the
      // board (honest partial: brand from IAM, "—" for the missing enrichment).
      const orgPage = await IamAdminApi.organizations({ pageSize: 200 })
      setOrgs(orgPage.rows)
      const [cust, allClusters, pkgs] = await Promise.all([
        AdminCockpitApi.customers().catch(() => [] as CustomerRow[]),
        // Fan out cluster reads per org would be heavy; the cockpit already carries
        // enough to identify tenants. Clusters are enriched lazily in the detail
        // panel (per-tenant). Here we keep the list light — no cross-org cluster scan.
        Promise.resolve([] as TenantClusterInput[]),
        // Packages are DATA from the platform; best-effort (honest empty when the
        // catalog route isn't served yet — the detail grant list stays empty).
        TenantsApi.packages().catch(() => [] as Package[]),
      ])
      setCustomers(cust)
      setClusters(allClusters)
      setPackages(pkgs)
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
      clusters,
    )
    return deriveResellerParents(composed)
  }, [orgs, customers, clusters])

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
        subtitle="Launch, brand, domain-bind, and manage white-label tenants and resold sub-orgs."
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
              description="White-label tenants are organizations with packages provisioned — their own brand, IAM scope, and resources."
              bullets={[
                'Every existing brand (zoo / lux / pars) is a tenant record in this model.',
                'Grant a preset package from the Packages tab to provision a tenant’s services.',
                'A tenant can be a reseller — it provisions packages for its own sub-orgs.',
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
            billing cockpit · cluster enriched per-tenant in the detail panel.
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
        {selectedTenant ? (
          <TenantDetail tenant={selectedTenant} packages={packages} onChanged={() => void load()} />
        ) : null}
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
      setMsg({ tone: 'ok', text: `Created tenant "${name}". Manage its packages, cluster, and domain from the list.` })
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
        real org fields). Bind a domain and grant packages from the tenant’s manage panel.
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

// ── Package catalog (DATA — read from the platform, never hardcoded) ─────────

function PackageCatalog() {
  const [packages, setPackages] = useState<Package[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<PlatformError | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setPackages(await TenantsApi.packages())
    } catch (e) {
      setError(interpretPlatformError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <>
      <PageHeader
        title="Packages"
        subtitle="Preset bundles of Hanzo services a tenant can be granted — read from the platform package catalog."
        actions={
          <Button icon={<RefreshCw size={16} />} onPress={() => void load()}>
            Refresh
          </Button>
        }
      />

      {error ? (
        <>
          <PlatformStateCard error={error} onRetry={() => void load()} />
          <Card p="$3" borderWidth={1} borderColor="$borderColor" borderStyle="dashed">
            <Text fontSize="$2" color="$color10">
              The package catalog is data. The platform serves it at `/v1/packages`, seeded from
              `platform-seed/packages.json`, so adding a package is a database row rather than a console change. The
              catalog appears here once the platform serves the `package` table.
            </Text>
          </Card>
        </>
      ) : loading ? (
        <Text fontSize="$2" color="$color10">
          Loading catalog…
        </Text>
      ) : packages.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No packages yet"
          description="The package catalog is data served by the platform. Seed the package table from platform-seed/packages.json to populate it."
        />
      ) : (
        <>
          <YStack gap="$3">
            {packages.map((pkg) => (
              <PackageCard key={pkg.id} pkg={pkg} />
            ))}
          </YStack>
          <Card p="$3" borderWidth={1} borderColor="$borderColor" borderStyle="dashed">
            <Text fontSize="$2" color="$color10">
              Granting a package to a tenant provisions its services. The cluster + IAM (org/app/brand) pieces are
              wired to real endpoints today; the composite one-click provision (`provisionPackage`) is the
              foundation-phase follow-up — until it ships, granting runs the real pieces and honestly marks the rest
              as not-connected.
            </Text>
          </Card>
        </>
      )}
    </>
  )
}

function PackageCard({ pkg }: { pkg: Package }) {
  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
      <XStack gap="$2" items="center" flexWrap="wrap">
        <Boxes size={18} color="$color11" />
        <Text fontSize="$5" fontWeight="800" flex={1} minW={140}>
          {pkg.name}
        </Text>
        {pkg.sovereign ? (
          <Text fontSize="$1" px="$2" py="$1" rounded="$2" bg="$color5" color="$color12">
            Sovereign L1
          </Text>
        ) : null}
        <Text fontSize="$1" px="$2" py="$1" rounded="$2" bg="$color3" color="$color11">
          {pkg.plan}
        </Text>
      </XStack>
      <Text fontSize="$3" color="$color11">
        {pkg.description}
      </Text>
      <XStack gap="$1.5" flexWrap="wrap">
        {pkg.services.map((s) => (
          <Text key={s} fontSize="$1" px="$1.5" py="$0.5" rounded="$2" bg="$color3" color="$color11">
            {SERVICE_LABELS[s]}
          </Text>
        ))}
      </XStack>
      <XStack gap="$4" flexWrap="wrap" borderTopWidth={1} borderColor="$borderColor" pt="$2.5">
        <YStack minW={160}>
          <Text fontSize="$1" color="$color10">Domain pattern</Text>
          <Text fontSize="$2" color="$color11" style={{ fontFamily: 'monospace' }}>
            {fillPattern(pkg.domainPattern, '<slug>')}
          </Text>
        </YStack>
        <YStack minW={160}>
          <Text fontSize="$1" color="$color10">IAM app</Text>
          <Text fontSize="$2" color="$color11" style={{ fontFamily: 'monospace' }}>
            {fillPattern(pkg.iamTemplate.appPattern, '<slug>')}
            {pkg.iamTemplate.ownIssuer ? ' · own issuer' : ''}
          </Text>
        </YStack>
      </XStack>
    </Card>
  )
}
