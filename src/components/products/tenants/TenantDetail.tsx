'use client'

/**
 * Per-tenant manage panel — the SlideOver body for one tenant.
 *
 * Sections:
 *   - Billing: plan + wallet + suspend/reactivate — READ + suspend REAL (cockpit).
 *   - Brand: logo/favicon/accent — the tenant's IAM org record, read AND written.
 *   - IAM: the tenant's org + app scope — READ real, CREATE app real (`/admin/iam`).
 *
 * All state is the caller's; this is a presentation + action component. Reuses the
 * shared Field* / DataTable / StatusTag / EmptyState primitives — nothing bespoke.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Ban, CheckCircle2, Globe, IdCard } from '@hanzogui/lucide-icons-2'

import { ApiError, IamAdminApi, type IamApplication } from '~/lib/api'
import { AdminCockpitApi } from '~/lib/api/admin-cockpit'
import { ActionNotice, classifyAction, type ActionOutcome } from './state'
import type { Tenant } from './model'
import { FieldRow, FieldText, StatusTag } from '@hanzo/ui/product'
import { usd } from '~/lib/money'

/** Section wrapper — a titled card with an icon. */
function Section({ icon: Icon, title, children }: { icon: typeof Globe; title: string; children: React.ReactNode }) {
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

export function TenantDetail({ tenant, onChanged }: { tenant: Tenant; onChanged: () => void }) {
  // ── Brand — logo/favicon/theme are real, writable IAM org fields ──
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
    void loadApps()
  }, [loadApps])

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
          Logo, favicon, and accent WRITE to the tenant’s IAM org record — the one store the console brand resolver
          reads per host.
        </Text>
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
    </YStack>
  )
}
