'use client'

/**
 * Settings — organization configuration.
 *
 * The General tab reads the REAL signed-in account (`get-account`) and the active
 * organization (`get-organization` via the org-scoped `/org/iam` proxy, so an ORG
 * admin — not only a global admin — sees it). Branding shows the REAL per-host
 * runtime config the app resolved. Member management lives in Team and personal
 * account settings in Profile (one home each — this never duplicates them);
 * identity mutations are owned by IAM and deep-link there. Every read has honest
 * loading / 404 / access states; nothing is fabricated.
 */
import { SubNav } from '~/components/ui/SubNav'
import { productSubpageSlug } from '~/lib/products/match'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Check, ExternalLink, Lock, Users } from '@hanzogui/lucide-icons-2'

import { ApiError, TeamApi, type Organization } from '~/lib/api'
import { config } from '~/config'
import { currentOrg } from '~/lib/org-scope'
import { setOrgAccent } from '~/lib/theme/accent'
import { useSession } from '~/lib/auth/session'
import { useIsSuperAdmin } from '~/lib/auth/admin'
import { ErrorState, asApiError, type HonestCopy } from '~/components/ui/States'
import { FieldRow, FieldSwitch, FieldText, PageHeader } from '@hanzo/ui/product'

const IAM_COPY: HonestCopy = {
  notFound:
    'IAM (/org/iam) is not routed on this host yet. It appears automatically once the deployment proxies it to Hanzo IAM.',
  unauthorized:
    'This requires an authorized session, enforced server-side by IAM. Sign in with an account that has access.',
}

const fmtDate = (v?: string): string => {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString()
}

function InfoRow({ label, value }: { label: string; value?: string | number | boolean | null }) {
  const text = value === undefined || value === null || value === '' ? '—' : String(value)
  const empty = text === '—'
  return (
    <FieldRow label={label}>
      <Text fontSize="$3" color={empty ? '$color10' : '$color12'} pt="$2">{text}</Text>
    </FieldRow>
  )
}

type Async<T> = { phase: 'loading' } | { phase: 'error'; err: ApiError } | { phase: 'ready'; data: T }

function useAsync<T>(fn: () => Promise<T>): { state: Async<T>; reload: () => void } {
  const [state, setState] = useState<Async<T>>({ phase: 'loading' })
  const reload = useCallback(() => {
    setState({ phase: 'loading' })
    fn()
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', err: asApiError(e) }))
  }, [fn])
  useEffect(() => { reload() }, [reload])
  return { state, reload }
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <YStack gap="$2">
      <XStack items="center" justify="space-between">
        <Text fontSize="$5" fontWeight="700">{title}</Text>
        {action}
      </XStack>
      {children}
    </YStack>
  )
}

function ManageInIam() {
  return (
    <Button
      size="$2"
      icon={<ExternalLink size={15} />}
      onPress={() => { if (typeof window !== 'undefined') window.open(config.iamUrl, '_blank', 'noopener') }}
    >
      IAM console
    </Button>
  )
}

function GeneralTab() {
  const router = useRouter()
  const { account } = useSession()
  const org = currentOrg()
  const fetchOrg = useCallback(() => TeamApi.organization(org), [org])
  const { state, reload } = useAsync<Organization>(fetchOrg)

  return (
    <YStack gap="$5">
      <Section
        title="Organization"
        action={<Button size="$2" icon={<Users size={15} />} onPress={() => router.push('/team')}>Manage members</Button>}
      >
        {state.phase === 'error' ? (
          <ErrorState err={state.err} onRetry={reload} copy={IAM_COPY} />
        ) : state.phase === 'loading' ? (
          <XStack p="$6" justify="center"><Spinner size="large" color="$color11" /></XStack>
        ) : (
          <Card p="$4" gap="$3.5" borderWidth={1} borderColor="$borderColor" maxWidth={720}>
            <InfoRow label="Name" value={state.data.displayName || state.data.name} />
            <InfoRow label="Slug" value={state.data.name} />
            <InfoRow label="Website" value={state.data.websiteUrl} />
            <InfoRow label="Created" value={fmtDate(state.data.createdTime)} />
          </Card>
        )}
      </Section>

      <Section title="Your account">
        <Card p="$4" gap="$3.5" borderWidth={1} borderColor="$borderColor" maxWidth={720}>
          <InfoRow label="Email" value={account?.email} />
          <InfoRow label="Display name" value={account?.displayName} />
          <InfoRow label="Username" value={account?.name} />
        </Card>
        <Text fontSize="$2" color="$color10">
          Manage your identity, password, and 2FA in Profile → Security. Renaming the organization is
          managed in the IAM console.
        </Text>
      </Section>
    </YStack>
  )
}

const BRANDING_COPY: HonestCopy = {
  ...IAM_COPY,
  unauthorized:
    'Editing organization branding requires an admin role in this organization. Ask an organization admin, or contact the Hanzo team.',
}

/** True for a 3- or 6-digit CSS hex color (`#RGB` / `#RRGGBB`). */
const looksLikeHex = (v: string): boolean => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v.trim())

type SaveState =
  | { phase: 'idle' }
  | { phase: 'saving' }
  | { phase: 'saved' }
  | { phase: 'error'; err: ApiError }

/** Honest "not permitted" banner — the org write is gated to org admins server-side. */
function GatedNotice() {
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$3.5" gap="$2" maxWidth={720}>
      <XStack gap="$2" items="center">
        <Lock size={15} />
        <Text fontSize="$3" fontWeight="700">Read-only</Text>
      </XStack>
      <Text fontSize="$2" color="$color11">
        You need an admin role in this organization to change its branding. These are the current
        values; ask an organization admin to edit them.
      </Text>
    </Card>
  )
}

/** A live swatch for the primary color (fills with the hex, or an em-dash when unset/invalid). */
function ColorSwatch({ hex }: { hex: string }) {
  const valid = looksLikeHex(hex)
  return (
    <XStack
      width={32}
      height={32}
      rounded="$3"
      borderWidth={1}
      borderColor="$borderColor"
      items="center"
      justify="center"
      style={valid ? { backgroundColor: hex.trim() } : undefined}
    >
      {valid ? null : <Text fontSize="$1" color="$color10">—</Text>}
    </XStack>
  )
}

/**
 * The editable org-branding form. Loads the FULL org record and round-trips it on
 * save (spread + override) so no field IAM stores is dropped. Save is honest:
 * saving → saved / error; a non-admin sees the fields read-only with a gated
 * notice (the authoritative check is the server proxy, which 403s a non-admin —
 * surfaced here as the same honest access message). Never a fake success.
 */
function BrandingForm({ org, canEdit, onSaved }: { org: Organization; canEdit: boolean; onSaved: () => void }) {
  const [displayName, setDisplayName] = useState(org.displayName ?? '')
  const [websiteUrl, setWebsiteUrl] = useState(org.websiteUrl ?? '')
  const [logo, setLogo] = useState(org.logo ?? '')
  const [favicon, setFavicon] = useState(org.favicon ?? '')
  const [colorPrimary, setColorPrimary] = useState(org.themeData?.colorPrimary ?? '')
  const [themeEnabled, setThemeEnabled] = useState(!!org.themeData?.isEnabled)
  const [save, setSave] = useState<SaveState>({ phase: 'idle' })

  // Any edit clears a prior saved/error banner so status always reflects the pending change.
  const onEdit = (fn: () => void) => {
    fn()
    setSave((s) => (s.phase === 'saved' || s.phase === 'error' ? { phase: 'idle' } : s))
  }

  const dirty =
    displayName.trim() !== (org.displayName ?? '') ||
    websiteUrl.trim() !== (org.websiteUrl ?? '') ||
    logo.trim() !== (org.logo ?? '') ||
    favicon.trim() !== (org.favicon ?? '') ||
    colorPrimary.trim() !== (org.themeData?.colorPrimary ?? '') ||
    themeEnabled !== !!org.themeData?.isEnabled

  const onSave = async () => {
    setSave({ phase: 'saving' })
    const next: Organization = {
      ...org,
      displayName: displayName.trim(),
      websiteUrl: websiteUrl.trim(),
      logo: logo.trim(),
      favicon: favicon.trim(),
      themeData: {
        ...(org.themeData ?? {}),
        colorPrimary: colorPrimary.trim(),
        isEnabled: themeEnabled,
      },
    }
    try {
      await TeamApi.updateOrganization(next)
      // Apply the accent to the live console IMMEDIATELY (no reload) from the value we
      // just persisted — the same `setOrgAccent` the root provider calls on load, so the
      // accent survives reload too. Disabling the theme (or an invalid hex) clears it.
      setOrgAccent(next.themeData)
      setSave({ phase: 'saved' })
      onSaved()
    } catch (e) {
      setSave({ phase: 'error', err: asApiError(e) })
    }
  }

  const ro = !canEdit
  return (
    <YStack gap="$3">
      <Text fontSize="$3" color="$color10">
        Your organization's identity across the console — display name, logo, and accent color. Saved to
        Hanzo IAM and applied wherever this org is shown.
      </Text>
      {ro ? <GatedNotice /> : null}
      <Card p="$4" gap="$3.5" borderWidth={1} borderColor="$borderColor" maxWidth={720}>
        <FieldRow label="Display name">
          <FieldText value={displayName} onChange={(v) => onEdit(() => setDisplayName(v))} disabled={ro} placeholder={org.name} />
        </FieldRow>
        <FieldRow label="Website">
          <FieldText value={websiteUrl} onChange={(v) => onEdit(() => setWebsiteUrl(v))} disabled={ro} placeholder="https://…" />
        </FieldRow>
        <FieldRow label="Logo URL">
          <YStack gap="$2">
            <FieldText value={logo} onChange={(v) => onEdit(() => setLogo(v))} disabled={ro} placeholder="https://…/logo.svg" />
            {logo.trim() ? (
              // Arbitrary external org logo URL — raw <img> (next/image would need a
              // per-tenant remote allow-list). Matches BrandLogo's own preview.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logo.trim()}
                alt="Logo preview"
                style={{ height: 28, width: 'auto', maxWidth: 160, objectFit: 'contain', display: 'block' }}
              />
            ) : null}
          </YStack>
        </FieldRow>
        <FieldRow label="Favicon URL">
          <FieldText value={favicon} onChange={(v) => onEdit(() => setFavicon(v))} disabled={ro} placeholder="https://…/favicon.ico" />
        </FieldRow>
        <FieldRow label="Primary color">
          <XStack gap="$3" items="center" flexWrap="wrap">
            <YStack flex={1} minW={200}>
              <FieldText value={colorPrimary} onChange={(v) => onEdit(() => setColorPrimary(v))} disabled={ro} placeholder="#D4D4D4" />
            </YStack>
            <ColorSwatch hex={colorPrimary} />
          </XStack>
        </FieldRow>
        <FieldRow label="Apply custom theme">
          <XStack items="center" gap="$3">
            <FieldSwitch checked={themeEnabled} onChange={(v) => onEdit(() => setThemeEnabled(v))} disabled={ro} />
            <Text fontSize="$2" color="$color10">Use this org's accent color instead of the default.</Text>
          </XStack>
        </FieldRow>

        <XStack items="center" gap="$3" pt="$1">
          <Button
            size="$3"
            theme="light"
            disabled={ro || !dirty || save.phase === 'saving'}
            icon={save.phase === 'saving' ? <Spinner size="small" /> : save.phase === 'saved' ? <Check size={15} /> : undefined}
            onPress={onSave}
          >
            {save.phase === 'saving' ? 'Saving…' : 'Save changes'}
          </Button>
          {save.phase === 'saved' ? (
            <Text fontSize="$2" color="$green10">Saved.</Text>
          ) : dirty && !ro ? (
            <Text fontSize="$2" color="$color10">Unsaved changes</Text>
          ) : null}
        </XStack>
      </Card>
      {save.phase === 'error' ? <ErrorState err={save.err} copy={BRANDING_COPY} /> : null}
    </YStack>
  )
}

function BrandingTab() {
  const { account } = useSession()
  const isSuperAdmin = useIsSuperAdmin()
  const org = currentOrg()
  const fetchOrg = useCallback(() => TeamApi.organization(org), [org])
  const { state, reload } = useAsync<Organization>(fetchOrg)
  const canEdit = isSuperAdmin || !!account?.isAdmin

  return (
    <YStack gap="$5">
      <Section title="Organization branding">
        {state.phase === 'error' ? (
          <ErrorState err={state.err} onRetry={reload} copy={IAM_COPY} />
        ) : state.phase === 'loading' ? (
          <XStack p="$6" justify="center"><Spinner size="large" color="$color11" /></XStack>
        ) : (
          <BrandingForm org={state.data} canEdit={canEdit} onSaved={reload} />
        )}
      </Section>

      <Section title="Runtime (resolved per host)">
        <Text fontSize="$3" color="$color10">
          The runtime branding resolved for this host. One console image serves every brand; these values
          come from the request hostname and are not editable here.
        </Text>
        <Card p="$4" gap="$3.5" borderWidth={1} borderColor="$borderColor" maxWidth={720}>
          <InfoRow label="Brand" value={config.brand} />
          <InfoRow label="Name" value={config.brandName} />
          <InfoRow label="IAM issuer" value={config.iamUrl} />
          <InfoRow label="IAM organization" value={config.iamOrgName} />
          <InfoRow label="IAM application" value={config.iamAppName} />
          <InfoRow label="Cloud API" value={config.cloudUrl} />
          <InfoRow label="Platform" value={config.platformUrl} />
          <InfoRow label="Billing" value={config.billingUrl} />
        </Card>
      </Section>
    </YStack>
  )
}

export function SettingsModule({ params }: { params: Record<string, string> }) {
  const tab = productSubpageSlug('settings', params.tab)
  const body = tab === 'branding' ? <BrandingTab /> : <GeneralTab />

  return (
    <>
      <PageHeader title="Settings" subtitle="Organization and account settings." actions={<ManageInIam />} />
      <SubNav id="settings" />
      {body}
    </>
  )
}
