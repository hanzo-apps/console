'use client'

/**
 * Per-tenant manage panel — the SlideOver body for one tenant.
 *
 * Sections (each honest — real where the platform answers, an honest not-connected
 * follow-up where it doesn't):
 *   - Brand: logo/favicon/host — READ real (from IAM org), WRITE honest-not-connected.
 *   - Packages: grant/revoke a preset bundle — honest-not-connected (no composite yet).
 *   - Cluster: provision a dedicated DOKS cluster — REAL (`/paas` cluster endpoint).
 *   - Domain: bind a custom host (auto ingress+DNS+cert) — honest-not-connected.
 *   - IAM: the tenant's org + app scope — READ real, CREATE app real (`/admin/iam`).
 *   - Billing: plan + wallet + suspend/reactivate — READ + suspend REAL (cockpit).
 *
 * All state is the caller's; this is a presentation + action component. Reuses the
 * shared Field* / DataTable / StatusTag / EmptyState primitives — nothing bespoke.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Ban, Boxes, CheckCircle2, Globe, IdCard, Play, RefreshCw, Server } from '@hanzogui/lucide-icons-2'

import { ApiError, IamAdminApi, TenantsApi, DOKS_REGIONS, DOKS_NODE_SIZES, type IamApplication, type TenantDomain } from '~/lib/api'
import { AdminCockpitApi } from '~/lib/api/admin-cockpit'
import { packageAppId, packageHost, SERVICE_LABELS, type Package } from './packages'
import { ActionNotice, classifyAction, NotConnectedPanel, type ActionOutcome } from './state'
import type { Tenant } from './model'
import { FieldRow, FieldSelect, FieldText, StatusTag } from '@hanzo/ui/product'
import { usd } from '~/lib/money'

/** Section wrapper — a titled card with an icon. */
function Section({ icon: Icon, title, children }: { icon: typeof Server; title: string; children: React.ReactNode }) {
  return (
    <Card p="$3.5" gap="$3" borderWidth={1} borderColor="$borderColor">
      <XStack gap="$2" items="center">
        <Icon size={16} color="$color11" />
        <Text fontSize="$4" fontWeight="700">
          {title}
        </Text>
      </XStack>
      {children}
    </Card>
  )
}

const clampCount = (v: string): number => {
  const n = Math.trunc(Number(v))
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(n, 100)
}


export function TenantDetail({
  tenant,
  packages,
  onChanged,
}: {
  tenant: Tenant
  /** The DATA-driven package catalog (from the platform, passed by the board). */
  packages: Package[]
  onChanged: () => void
}) {
  // ── Brand (logo/favicon/theme WRITE is REAL via IAM — they are org fields; the
  //    per-tenant HOST write rides webServerSettings which has no route yet) ──
  const [logoUrl, setLogoUrl] = useState(tenant.logo ?? '')
  const [faviconUrl, setFaviconUrl] = useState(tenant.favicon ?? '')
  const [themeColor, setThemeColor] = useState(tenant.themeColor ?? '')
  const [brandBusy, setBrandBusy] = useState(false)
  const [brandOut, setBrandOut] = useState<ActionOutcome | null>(null)

  const saveBrand = async () => {
    setBrandBusy(true)
    setBrandOut(null)
    try {
      // The tenant's brand IS its IAM org record — logo/favicon/themeData are real
      // writable org fields, so this is DATA-driven and REAL (global-admin IAM proxy).
      await IamAdminApi.updateOrganization(tenant.org, {
        owner: 'admin',
        name: tenant.org,
        displayName: tenant.display,
        logo: logoUrl || undefined,
        favicon: faviconUrl || undefined,
        ...(themeColor ? { themeData: { colorPrimary: themeColor, isEnabled: true } } : {}),
      })
      setBrandOut({ tone: 'ok', text: 'Brand saved to the tenant’s IAM org record.' })
      onChanged()
    } catch (e) {
      setBrandOut(classifyAction(e, 'Brand write not connected on this deployment.'))
    } finally {
      setBrandBusy(false)
    }
  }

  // ── Packages (honest-not-connected: no composite provisionPackage yet) ──
  const [pkgBusy, setPkgBusy] = useState<string | null>(null)
  const [pkgOut, setPkgOut] = useState<Record<string, ActionOutcome | null>>({})

  const grantPackage = async (pkg: Package) => {
    setPkgBusy(pkg.id)
    setPkgOut((s) => ({ ...s, [pkg.id]: null }))
    try {
      await TenantsApi.provisionPackage(tenant.org, pkg.id)
      setPkgOut((s) => ({ ...s, [pkg.id]: { tone: 'ok', text: `${pkg.name} provisioning started.` } }))
      onChanged()
    } catch (e) {
      setPkgOut((s) => ({
        ...s,
        [pkg.id]: classifyAction(e, 'Package provisioning is a platform follow-up (no composite endpoint yet).'),
      }))
    } finally {
      setPkgBusy(null)
    }
  }

  // ── Cluster (REAL /paas provision) ──
  const [clusters, setClusters] = useState<{ name: string; region?: string; status?: string; phase?: string }[]>([])
  const [clustersLoading, setClustersLoading] = useState(true)
  const [region, setRegion] = useState<string>(DOKS_REGIONS[2])
  const [nodeSize, setNodeSize] = useState<string>(DOKS_NODE_SIZES[1])
  const [nodeCount, setNodeCount] = useState(3)
  const [clusterBusy, setClusterBusy] = useState(false)
  const [clusterOut, setClusterOut] = useState<ActionOutcome | null>(null)

  const loadClusters = useCallback(async () => {
    setClustersLoading(true)
    try {
      setClusters(await TenantsApi.clusters(tenant.org))
    } catch {
      setClusters([])
    } finally {
      setClustersLoading(false)
    }
  }, [tenant.org])

  const provisionCluster = async () => {
    setClusterBusy(true)
    setClusterOut(null)
    try {
      await TenantsApi.provisionCluster(tenant.org, { region, nodeSize, nodeCount })
      setClusterOut({ tone: 'ok', text: 'Cluster provisioning started.' })
      await loadClusters()
      onChanged()
    } catch (e) {
      setClusterOut(classifyAction(e, 'Cluster provisioning endpoint not connected on this deployment.'))
    } finally {
      setClusterBusy(false)
    }
  }

  // ── Domain (records → the platform auto-provisions ingress/DNS/cert). List is
  //    real when the platform serves it; bind is honest-not-connected today. ──
  const [domains, setDomains] = useState<TenantDomain[]>([])
  const [domain, setDomain] = useState('')
  const [domainSvc, setDomainSvc] = useState('')
  const [domainBusy, setDomainBusy] = useState(false)
  const [domainOut, setDomainOut] = useState<ActionOutcome | null>(null)

  const loadDomains = useCallback(async () => {
    try {
      setDomains(await TenantsApi.domains(tenant.org))
    } catch {
      setDomains([])
    }
  }, [tenant.org])

  const bindDomain = async () => {
    if (!domain.trim()) return
    setDomainBusy(true)
    setDomainOut(null)
    try {
      await TenantsApi.bindDomain(tenant.org, { host: domain.trim(), serviceName: domainSvc.trim() || undefined })
      setDomainOut({ tone: 'ok', text: `Bound ${domain.trim()} — ingress + DNS + cert provisioning.` })
      setDomain('')
      await loadDomains()
      onChanged()
    } catch (e) {
      setDomainOut(
        classifyAction(
          e,
          'Domain-bind API is a platform follow-up — createDomain/cloudflare/k8s-ingress have no HTTP route yet.',
        ),
      )
    } finally {
      setDomainBusy(false)
    }
  }

  // ── IAM (read the tenant's apps; create real via /admin/iam) ──
  const [apps, setApps] = useState<IamApplication[]>([])
  const [appsLoading, setAppsLoading] = useState(true)
  const [appsError, setAppsError] = useState<string | null>(null)
  const [newAppName, setNewAppName] = useState('')
  const [appBusy, setAppBusy] = useState(false)
  const [appOut, setAppOut] = useState<ActionOutcome | null>(null)

  const loadApps = useCallback(async () => {
    setAppsLoading(true)
    setAppsError(null)
    try {
      const r = await IamAdminApi.applications(tenant.org)
      setApps(r.rows)
    } catch (e) {
      setAppsError(e instanceof ApiError ? e.message : 'Could not load IAM apps')
    } finally {
      setAppsLoading(false)
    }
  }, [tenant.org])

  const createApp = async () => {
    const name = newAppName.trim()
    if (!name) return
    setAppBusy(true)
    setAppOut(null)
    try {
      await IamAdminApi.addApplication({ owner: 'admin', name, organization: tenant.org, displayName: name })
      setAppOut({ tone: 'ok', text: `Created IAM app "${name}".` })
      setNewAppName('')
      await loadApps()
    } catch (e) {
      setAppOut(classifyAction(e, 'IAM app-create is not connected on this deployment.'))
    } finally {
      setAppBusy(false)
    }
  }

  // ── Billing (plan + wallet real; suspend/reactivate real via cockpit) ──
  const [suspendBusy, setSuspendBusy] = useState(false)
  const [suspendOut, setSuspendOut] = useState<ActionOutcome | null>(null)
  const suspended = tenant.status === 'suspended'

  const toggleSuspend = async () => {
    setSuspendBusy(true)
    setSuspendOut(null)
    try {
      if (suspended) await AdminCockpitApi.reactivate(tenant.org)
      else await AdminCockpitApi.suspend(tenant.org)
      setSuspendOut({ tone: 'ok', text: suspended ? 'Tenant reactivated.' : 'Tenant suspended.' })
      onChanged()
    } catch (e) {
      setSuspendOut(classifyAction(e, 'Suspend/reactivate is not connected on this deployment.'))
    } finally {
      setSuspendBusy(false)
    }
  }

  useEffect(() => {
    void loadClusters()
    void loadApps()
    void loadDomains()
  }, [loadClusters, loadApps, loadDomains])

  const COUNT_OPTIONS = ['1', '2', '3', '4', '5', '6', '8', '10']

  return (
    <YStack gap="$3">
      {/* Identity header */}
      <Card p="$3.5" gap="$2" borderWidth={1} borderColor="$borderColor">
        <XStack gap="$3" items="center">
          {tenant.logo ? (
            // Arbitrary external org logo URL — raw <img> (matches BrandLogo/Settings).
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={tenant.logo}
              alt={`${tenant.display} logo`}
              style={{ height: 40, width: 40, borderRadius: 8, objectFit: 'contain', display: 'block' }}
            />
          ) : (
            <YStack width={40} height={40} rounded="$3" bg="$color4" items="center" justify="center">
              <Text fontSize="$5" fontWeight="800" color="$color11">
                {tenant.display.slice(0, 1).toUpperCase()}
              </Text>
            </YStack>
          )}
          <YStack flex={1}>
            <Text fontSize="$5" fontWeight="800">
              {tenant.display}
            </Text>
            <Text fontSize="$2" color="$color10">
              {tenant.org}
              {tenant.ownerEmail ? ` · ${tenant.ownerEmail}` : ''}
            </Text>
          </YStack>
          <StatusTag status={tenant.status} />
        </XStack>
        {tenant.parentOrg ? (
          <Text fontSize="$1" color="$color10">
            Sub-org of {tenant.parentOrg}
            {tenant.parentHint === 'owner' ? ' (inferred from owner — a real parentOrgId is the platform follow-up)' : ''}
          </Text>
        ) : null}
      </Card>

      {/* Billing */}
      <Section icon={IdCard} title="Billing">
        <XStack gap="$4" flexWrap="wrap">
          <YStack minW={100}>
            <Text fontSize="$1" color="$color10">Plan</Text>
            <Text fontSize="$3" fontWeight="600">{tenant.plan ?? '—'}</Text>
          </YStack>
          <YStack minW={100}>
            <Text fontSize="$1" color="$color10">Wallet</Text>
            <Text fontSize="$3" fontWeight="600">{usd(tenant.balanceCents)}</Text>
          </YStack>
          <YStack minW={100}>
            <Text fontSize="$1" color="$color10">MRR</Text>
            <Text fontSize="$3" fontWeight="600">{usd(tenant.mrrCents)}</Text>
          </YStack>
          <YStack minW={100}>
            <Text fontSize="$1" color="$color10">Users</Text>
            <Text fontSize="$3" fontWeight="600">{tenant.users ?? '—'}</Text>
          </YStack>
        </XStack>
        {tenant.isCustomer ? (
          <XStack gap="$3" items="center">
            <Button
              size="$2"
              theme={suspended ? 'green' : 'red'}
              icon={suspended ? <CheckCircle2 size={14} /> : <Ban size={14} />}
              disabled={suspendBusy}
              onPress={() => void toggleSuspend()}
            >
              {suspended ? 'Reactivate tenant' : 'Suspend tenant'}
            </Button>
          </XStack>
        ) : (
          <Text fontSize="$2" color="$color10">
            This org has no billing record yet (brand-only in IAM). Plan + wallet appear once it becomes a customer.
          </Text>
        )}
        <ActionNotice outcome={suspendOut} />
      </Section>

      {/* Brand — logo/favicon/theme are REAL IAM org fields (data-driven) */}
      <Section icon={Globe} title="Brand">
        <FieldRow label="Logo URL">
          <FieldText value={logoUrl} onChange={setLogoUrl} placeholder="https://…/logo.svg" />
        </FieldRow>
        <FieldRow label="Favicon URL">
          <FieldText value={faviconUrl} onChange={setFaviconUrl} placeholder="https://…/favicon.ico" />
        </FieldRow>
        <FieldRow label="Accent color">
          <FieldText value={themeColor} onChange={setThemeColor} placeholder="#D4D4D4" />
        </FieldRow>
        <XStack gap="$3" items="center">
          <Button size="$2" theme="light" disabled={brandBusy} onPress={() => void saveBrand()}>
            {brandBusy ? 'Saving…' : 'Save brand'}
          </Button>
        </XStack>
        <ActionNotice outcome={brandOut} />
        <Text fontSize="$1" color="$color10">
          Logo, favicon, and accent WRITE to the tenant’s IAM org record (real). The host binding lives in Custom
          domain below — the console brand resolver reading these records per-host is the config.ts follow-up.
        </Text>
      </Section>

      {/* Cluster */}
      <Section icon={Server} title="Cluster">
        {clustersLoading ? (
          <Text fontSize="$2" color="$color10">Loading clusters…</Text>
        ) : clusters.length ? (
          <YStack gap="$1.5">
            {clusters.map((c) => (
              <XStack key={c.name} gap="$2" items="center">
                <Text fontSize="$3" fontWeight="600" flex={1} numberOfLines={1}>
                  {c.name}
                </Text>
                <Text fontSize="$1" color="$color10">{c.region ?? '—'}</Text>
                <StatusTag status={c.phase || c.status} />
              </XStack>
            ))}
          </YStack>
        ) : (
          <Text fontSize="$2" color="$color10">
            No dedicated cluster — runs on shared Hanzo Cloud. Provision one below.
          </Text>
        )}
        <YStack gap="$2" borderTopWidth={1} borderColor="$borderColor" pt="$3">
          <FieldRow label="Region">
            <FieldSelect value={region} options={[...DOKS_REGIONS]} onChange={setRegion} />
          </FieldRow>
          <FieldRow label="Node size">
            <FieldSelect value={nodeSize} options={[...DOKS_NODE_SIZES]} onChange={setNodeSize} />
          </FieldRow>
          <FieldRow label="Node count">
            <FieldSelect value={String(nodeCount)} options={COUNT_OPTIONS} onChange={(v) => setNodeCount(clampCount(v))} />
          </FieldRow>
          <XStack gap="$3" items="center">
            <Button size="$2" icon={<Play size={14} />} disabled={clusterBusy} onPress={() => void provisionCluster()}>
              {clusterBusy ? 'Provisioning…' : 'Provision cluster'}
            </Button>
            <Button size="$2" chromeless icon={<RefreshCw size={14} />} onPress={() => void loadClusters()} aria-label="Refresh clusters" />
          </XStack>
        </YStack>
        <ActionNotice outcome={clusterOut} />
      </Section>

      {/* Domain — records drive the routed hosts (no hardcoded host list) */}
      <Section icon={Globe} title="Custom domains">
        {domains.length ? (
          <YStack gap="$1.5">
            {domains.map((d) => (
              <XStack key={d.host} gap="$2" items="center">
                <Text fontSize="$3" flex={1} numberOfLines={1} style={{ fontFamily: 'monospace' }}>
                  {d.host}
                </Text>
                {d.serviceName ? <Text fontSize="$1" color="$color10">{d.serviceName}</Text> : null}
                <StatusTag status={d.status} />
              </XStack>
            ))}
          </YStack>
        ) : (
          <Text fontSize="$2" color="$color10">
            No custom domains bound. Bind one below — the routed hosts derive from these records, not a hardcoded list.
          </Text>
        )}
        <FieldRow label="Host">
          <FieldText value={domain} onChange={setDomain} placeholder="admin.acme.com" />
        </FieldRow>
        <FieldRow label="Service">
          <FieldText value={domainSvc} onChange={setDomainSvc} placeholder="console (upstream service)" />
        </FieldRow>
        <XStack gap="$3" items="center">
          <Button size="$2" icon={<Globe size={14} />} disabled={domainBusy || !domain.trim()} onPress={() => void bindDomain()}>
            {domainBusy ? 'Binding…' : 'Bind domain'}
          </Button>
        </XStack>
        <ActionNotice outcome={domainOut} />
        <NotConnectedPanel
          title="Domain-bind is a platform follow-up"
          endpoint="POST /v1/org/{org}/domain → createDomain + cloudflare + k8s-ingress"
          note="Binding a domain should auto-create the ingress + DNS + cert (replacing hand-made ingresses). The platform's domain/cloudflare/ingress services have no HTTP route yet."
        />
      </Section>

      {/* IAM */}
      <Section icon={IdCard} title="Identity (IAM)">
        {appsLoading ? (
          <Text fontSize="$2" color="$color10">Loading apps…</Text>
        ) : appsError ? (
          <Text fontSize="$2" color="$red10">{appsError}</Text>
        ) : apps.length ? (
          <YStack gap="$1">
            {apps.map((a) => (
              <XStack key={a.name} gap="$2" items="center">
                <Text fontSize="$3" flex={1} numberOfLines={1}>
                  {a.displayName || a.name}
                </Text>
                <Text fontSize="$1" color="$color10" numberOfLines={1}>
                  {a.clientId ?? a.name}
                </Text>
              </XStack>
            ))}
          </YStack>
        ) : (
          <Text fontSize="$2" color="$color10">No IAM apps for this org yet. An app is what users of this org sign in through — create one below.</Text>
        )}
        <YStack gap="$2" borderTopWidth={1} borderColor="$borderColor" pt="$3">
          <FieldRow label="New app">
            <FieldText value={newAppName} onChange={setNewAppName} placeholder="acme-console" />
          </FieldRow>
          <XStack>
            <Button size="$2" disabled={appBusy || !newAppName.trim()} onPress={() => void createApp()}>
              {appBusy ? 'Creating…' : 'Create IAM app'}
            </Button>
          </XStack>
        </YStack>
        <ActionNotice outcome={appOut} />
      </Section>

      {/* Packages — the DATA-driven catalog from the platform */}
      <Section icon={Boxes} title="Packages">
        {packages.length === 0 ? (
          <Text fontSize="$2" color="$color10">
            No packages in the catalog yet. The catalog is data served by the platform (`/v1/packages`); seed the
            package table from platform-seed/packages.json to populate it.
          </Text>
        ) : (
          <Text fontSize="$2" color="$color10">
            Grant a preset bundle. Provisioning runs through the platform composite (a follow-up) — the cluster + IAM
            pieces above are real today.
          </Text>
        )}
        <YStack gap="$2.5">
          {packages.map((pkg) => (
            <YStack key={pkg.id} gap="$1.5" borderTopWidth={1} borderColor="$borderColor" pt="$2.5">
              <XStack gap="$2" items="center" flexWrap="wrap">
                <Text fontSize="$3" fontWeight="700" flex={1} minW={140}>
                  {pkg.name}
                  {pkg.sovereign ? ' · L1' : ''}
                </Text>
                <Button size="$1" disabled={pkgBusy === pkg.id} onPress={() => void grantPackage(pkg)}>
                  {pkgBusy === pkg.id ? 'Granting…' : 'Grant'}
                </Button>
              </XStack>
              <XStack gap="$1.5" flexWrap="wrap">
                {pkg.services.map((s) => (
                  <Text key={s} fontSize="$1" px="$1.5" py="$0.5" rounded="$2" bg="$color3" color="$color11">
                    {SERVICE_LABELS[s]}
                  </Text>
                ))}
              </XStack>
              <Text fontSize="$1" color="$color9" style={{ fontFamily: 'monospace' }}>
                {packageHost(pkg, tenant.org)} · {packageAppId(pkg, tenant.org)}
              </Text>
              <ActionNotice outcome={pkgOut[pkg.id] ?? null} />
            </YStack>
          ))}
        </YStack>
      </Section>
    </YStack>
  )
}
