'use client'

/**
 * Settings — a panel of groups, one per subject a person comes here for:
 * organization · account · security · billing · developer.
 *
 * Only the organization is this console's to hold. Identity belongs to the
 * brand's ID host, billing to commerce, keys to their own product — so a group
 * shows the values it can read and carries the way to the one place that owns
 * them. Nothing here is a second editor for something that already has one.
 *
 * Every group is a `Fieldset` and every value a `FieldRow`, both from
 * @hanzo/ui/product: the surface, its radius, fill and legend are decided once,
 * in the package that draws them, so this file contributes layout and data and
 * no measurements of its own.
 *
 * The General tab reads the REAL signed-in account (`get-account`) and the active
 * organization (`get-organization` via the org-scoped `/org/iam` proxy, so an ORG
 * admin — not only a global admin — sees it). Branding shows the REAL per-host
 * runtime config the app resolved. Every read has honest loading / 404 / access
 * states; nothing is fabricated.
 */
import { SubNav } from '~/components/ui/SubNav'
import { productSubpageSlug } from '~/lib/products/match'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from '~/lib/router'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import {
  ArrowUpRight,
  Building2,
  Check,
  CreditCard,
  ExternalLink,
  IdCard,
  KeySquare,
  Lock,
  ShieldCheck,
} from '@hanzogui/lucide-icons-2'

import { ApiError, TeamApi, type Organization } from '~/lib/api'
import { config } from '~/config'
import { currentOrg } from '~/lib/org-scope'
import { setOrgAccent } from '@hanzo/ui/product'
import { useSession } from '~/lib/auth/session'
import { useIsSuperAdmin } from '~/lib/auth/admin'
import { useBeta } from '~/lib/products/viewer'
import { ErrorState, asApiError, type HonestCopy } from '~/components/ui/States'
import { FieldRow, FieldSwitch, FieldText, Fieldset, PageHeader } from '@hanzo/ui/product'
import { Appearance } from '@hanzo/appearance'

/**
 * Read a chosen logo file into a compact data URL the IAM `logo` string can
 * carry. An SVG passes through verbatim (it is already small and scales);
 * a raster is downscaled to 64px tall on a canvas — twice the largest render
 * (the 28px settings preview, the 22px switcher row) — so a 4MB photo becomes
 * a few KB. The cap refuses anything that still encodes large, because a
 * megabyte logo would ride EVERY IAM org read from then on.
 */
const LOGO_DATA_CAP = 140 * 1024
async function fileToLogoDataUrl(file: File): Promise<string> {
  if (file.type === 'image/svg+xml') {
    const text = await file.text()
    const url = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(text)))}`
    if (url.length > LOGO_DATA_CAP) throw new Error('That SVG is too large for a logo — simplify it or host it and paste the URL')
    return url
  }
  const bitmap = await createImageBitmap(file)
  const h = Math.min(64, bitmap.height)
  const w = Math.round((bitmap.width / bitmap.height) * h)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not read the image')
  ctx.drawImage(bitmap, 0, 0, w, h)
  const url = canvas.toDataURL('image/png')
  if (url.length > LOGO_DATA_CAP) throw new Error('That image is too complex for a logo — use a simpler mark or host it and paste the URL')
  return url
}


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

/**
 * Where a section's subject is actually owned — inside this console (`Go`) or on
 * the identity host (`Out`).
 *
 * Settings is an index, not a second implementation. Members, billing, keys and
 * identity each have exactly one home, and a section that shows their values
 * carries the way to that home rather than a duplicate editor for it.
 */
function Go({ label, to }: { label: string; to: string }) {
  const router = useRouter()
  return (
    <Button size="$2" chromeless iconAfter={<ArrowUpRight size={15} />} onPress={() => router.push(to)}>
      {label}
    </Button>
  )
}

function Out({ label, href }: { label: string; href: string }) {
  return (
    <Button
      size="$2"
      chromeless
      iconAfter={<ExternalLink size={15} />}
      onPress={() => { if (typeof window !== 'undefined') window.open(href, '_blank', 'noopener') }}
    >
      {label}
    </Button>
  )
}

/** The state a section is in before its read lands, sized so the panel does not jump. */
function Loading() {
  return <XStack p="$5" justify="center"><Spinner size="large" color="$color11" /></XStack>
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

/**
 * The settings panel — one column of groups, each naming what it holds and where
 * that thing is owned.
 *
 * The five subjects a person comes here for are the organization, their account,
 * their security, what they are billed, and their API credential. Only the first
 * is this console's to hold: identity belongs to the brand's ID host, billing to
 * commerce, keys to their own product. So each group shows the values it can read
 * and hands off, and the panel stays an index of one system rather than five
 * half-copies of it.
 */
function GeneralTab() {
  const { account } = useSession()
  const org = currentOrg()
  const fetchOrg = useCallback(() => TeamApi.organization(org), [org])
  const { state, reload } = useAsync<Organization>(fetchOrg)
  const idHost = config.iamUrl.replace(/^https?:\/\//, '')
  const accountUrl = `${config.iamUrl}/account`

  return (
    <YStack gap="$4" maxW={720}>
      <Fieldset
        icon={<Building2 size={15} />}
        title="Organization"
        description={`How this organization is identified across ${config.brandName}.`}
        action={<Go label="Members" to="/team" />}
      >
        {state.phase === 'error' ? (
          <ErrorState err={state.err} onRetry={reload} copy={IAM_COPY} />
        ) : state.phase === 'loading' ? (
          <Loading />
        ) : (
          <>
            <InfoRow label="Name" value={state.data.displayName || state.data.name} />
            <InfoRow label="Slug" value={state.data.name} />
            <InfoRow label="Website" value={state.data.websiteUrl} />
            <InfoRow label="Created" value={fmtDate(state.data.createdTime)} />
            <Text fontSize="$2" color="$color10">
              These are held by Hanzo IAM. Change the name, logo and accent under Branding; renaming the
              organization itself is done in the IAM console.
            </Text>
          </>
        )}
      </Fieldset>

      <EarlyAccess />

      <Fieldset
        icon={<IdCard size={15} />}
        title="Account"
        description={`Your identity, shared by every ${config.brandName} product you sign in to.`}
        action={<Out label={idHost} href={accountUrl} />}
      >
        <InfoRow label="Email" value={account?.email} />
        <InfoRow label="Display name" value={account?.displayName} />
        <InfoRow label="Username" value={account?.name} />
      </Fieldset>

      <Fieldset
        icon={<ShieldCheck size={15} />}
        title="Security"
        description={`Password, two-factor, passkeys and connected accounts are held by ${idHost} and changed there.`}
        action={<Out label="Manage security" href={accountUrl} />}
      >
        <Text fontSize="$2" color="$color11">
          Nothing here reads or stores a credential. One sign-in covers every product on this account, so
          it is changed once, in one place, and applies everywhere.
        </Text>
      </Fieldset>

      <Fieldset
        icon={<CreditCard size={15} />}
        title="Billing"
        description="Balance, spend, budgets, invoices, subscriptions and payment methods."
        action={<Go label="Billing center" to="/billing" />}
      >
        <Text fontSize="$2" color="$color11">
          Billing is charged to the organization above, not to a person, so it follows whichever
          organization the console is scoped to.
        </Text>
      </Fieldset>

      <Fieldset
        icon={<KeySquare size={15} />}
        title="Developer"
        description="The cloud API credential this account uses from the SDKs, the CLI and the gateway."
        action={<Go label="API keys" to="/api-keys" />}
      >
        <Text fontSize="$2" color="$color11">
          A key is shown once, when it is minted. Rotating replaces it immediately, so anything still
          holding the old one stops working the moment you rotate.
        </Text>
      </Fieldset>
    </YStack>
  )
}

/**
 * The org's pre-GA opt-in — the ONLY place in the console that mentions it.
 *
 * Deliberately unadvertised: nothing links here, no banner offers it, and a new
 * account never meets it. A first experience made of half-finished products is
 * worse than a small one, so someone who wants beta comes looking and everyone
 * else never learns it exists.
 *
 * ORG-WIDE, not per-person. It rides `/v1/enablement`, which keys on the caller's
 * validated org, so two members of one org can never see different products —
 * which is what makes a bug report mean something.
 *
 * The row is absent, not disabled, when the platform is not offering pre-GA
 * products or the viewer cannot set it. A switch that refuses is worse than no
 * switch: it invites a question with no answer.
 */
function EarlyAccess() {
  const { account } = useSession()
  const isSuperAdmin = useIsSuperAdmin()
  const { on, offered, set } = useBeta()
  const [err, setErr] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)

  const canEdit = isSuperAdmin || !!account?.isAdmin
  if (!offered || !canEdit) return null

  const toggle = async (next: boolean) => {
    setBusy(true)
    setErr(null)
    try {
      await set(next)
    } catch (e) {
      setErr(asApiError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Fieldset title="Early access" description="Applies to everyone in this organization.">
      <FieldRow label="Beta products">
        <XStack items="center" gap="$3">
          <FieldSwitch checked={on} onChange={(v) => void toggle(v)} disabled={busy} />
          <Text fontSize="$2" color="$color10">Show products that are still in beta.</Text>
        </XStack>
      </FieldRow>
      {err ? <ErrorState err={err} /> : null}
    </Fieldset>
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
 * saving → saved / error. Never a fake success.
 *
 * Editing your own org's branding is org self-service, so the question is only
 * ever "is this caller an admin OF THIS ORG" — never the platform SuperAdmin
 * predicate. The browser cannot answer it: hanzo.id does not emit an org-scoped
 * `isAdmin` claim (it is absent from the IdP's own `claims_supported`), so a
 * client-side check reads `undefined` for EVERY caller and collapses to
 * SuperAdmin-only — which locked an org's own owner out of their own branding.
 * IAM is the authority and says so with a 403; until it does, the form edits.
 */
function BrandingForm({ org, onSaved }: { org: Organization; onSaved: () => void }) {
  const [displayName, setDisplayName] = useState(org.displayName ?? '')
  const [websiteUrl, setWebsiteUrl] = useState(org.websiteUrl ?? '')
  const [logo, setLogo] = useState(org.logo ?? '')
  const logoFileRef = useRef<HTMLInputElement>(null)
  const [favicon, setFavicon] = useState(org.favicon ?? '')
  const [colorPrimary, setColorPrimary] = useState(org.themeData?.colorPrimary ?? '')
  const [themeEnabled, setThemeEnabled] = useState(!!org.themeData?.isEnabled)
  const [save, setSave] = useState<SaveState>({ phase: 'idle' })
  // Set only when IAM has actually refused this caller. A guess belongs nowhere
  // near an authorization decision, so nothing sets this but a 403.
  const [denied, setDenied] = useState(false)

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
      const err = asApiError(e)
      // 403 is IAM answering the question the token could not: this caller is
      // not an admin of this org. Take it as the answer and stop offering a
      // control that cannot work.
      if (err.status === 403) setDenied(true)
      setSave({ phase: 'error', err })
    }
  }

  const ro = denied
  return (
    <YStack gap="$3" maxW={720}>
      {ro ? <GatedNotice /> : null}
      <Fieldset
        title="Organization branding"
        description="Your organization's identity across the console — display name, logo and accent colour. Saved to Hanzo IAM and applied wherever this org is shown."
      >
        <FieldRow label="Display name">
          <FieldText value={displayName} onChange={(v) => onEdit(() => setDisplayName(v))} disabled={ro} placeholder={org.name} />
        </FieldRow>
        <FieldRow label="Website">
          <FieldText value={websiteUrl} onChange={(v) => onEdit(() => setWebsiteUrl(v))} disabled={ro} placeholder="https://…" />
        </FieldRow>
        <FieldRow label="Logo">
          <YStack gap="$2">
            <XStack gap="$2" items="center" flexWrap="wrap">
              <YStack flex={1} minW={220}>
                <FieldText value={logo} onChange={(v) => onEdit(() => setLogo(v))} disabled={ro} placeholder="https://…/logo.svg" />
              </YStack>
              {/* Upload: the file becomes a compact data URL in the SAME field,
                  so one value, one save path, one preview serve it either way. */}
              <Button
                size="$2"
                disabled={ro}
                onPress={() => logoFileRef.current?.click()}
                aria-label="Upload a logo image"
              >
                Upload
              </Button>
              <input
                ref={logoFileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (!f) return
                  fileToLogoDataUrl(f)
                    .then((url) => onEdit(() => setLogo(url)))
                    .catch((err) => setSave({ phase: 'error', err: asApiError(err) }))
                }}
              />
            </XStack>
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

        {/* A control that cannot work is worse than no control: once IAM has
            refused, the values stay readable and the Save goes away. */}
        {ro ? null : (
          <XStack items="center" gap="$3" pt="$1">
            <Button
              size="$3"
              theme="light"
              disabled={!dirty || save.phase === 'saving'}
              icon={save.phase === 'saving' ? <Spinner size="small" /> : save.phase === 'saved' ? <Check size={15} /> : undefined}
              onPress={onSave}
            >
              {save.phase === 'saving' ? 'Saving…' : 'Save changes'}
            </Button>
            {save.phase === 'saved' ? (
              <Text fontSize="$2" color="$green10">Saved.</Text>
            ) : dirty ? (
              <Text fontSize="$2" color="$color10">Unsaved changes</Text>
            ) : null}
          </XStack>
        )}
      </Fieldset>
      {save.phase === 'error' ? <ErrorState err={save.err} copy={BRANDING_COPY} /> : null}
    </YStack>
  )
}

function BrandingTab() {
  const org = currentOrg()
  const fetchOrg = useCallback(() => TeamApi.organization(org), [org])
  const { state, reload } = useAsync<Organization>(fetchOrg)

  return (
    <YStack gap="$4" maxW={720}>
      {state.phase === 'error' ? (
        <ErrorState err={state.err} onRetry={reload} copy={IAM_COPY} />
      ) : state.phase === 'loading' ? (
        <Loading />
      ) : (
        <BrandingForm org={state.data} onSaved={reload} />
      )}

      <Fieldset
        title="Runtime (resolved per host)"
        description="One console image serves every brand; these come from the request hostname and are read-only."
      >
        <InfoRow label="Brand" value={config.brand} />
        <InfoRow label="Name" value={config.brandName} />
        <InfoRow label="IAM issuer" value={config.iamUrl} />
        <InfoRow label="IAM organization" value={config.iamOrgName} />
        <InfoRow label="IAM application" value={config.iamAppName} />
        <InfoRow label="Cloud API" value={config.cloudUrl} />
        <InfoRow label="Platform" value={config.platformUrl} />
        <InfoRow label="Billing" value={config.billingUrl} />
      </Fieldset>
    </YStack>
  )
}


/**
 * A person's own reading of the system — text size, density, accent.
 *
 * The panel is @hanzo/appearance, not written here: hanzo.app and hanzo.chat
 * show the SAME screen, and three near-identical ones is how "the same product"
 * stops looking like it. What this file contributes is where it sits.
 *
 * Org settings above are the ORG's; this is the signed-in person's and it lives
 * on their device, so it needs no save button and no permission check.
 */
function AppearanceTab() {
  // `Appearance` carries its own groups (Text size · Density · Accent), so a
  // legend here would box a box and repeat the tab's own name back at the reader.
  return <Appearance />
}

export function SettingsModule({ params }: { params: Record<string, string> }) {
  const tab = productSubpageSlug('settings', params.tab)
  const body =
    tab === 'branding' ? <BrandingTab />
    : tab === 'appearance' ? <AppearanceTab />
    : <GeneralTab />

  return (
    <>
      <PageHeader title="Settings" subtitle="Organization and account settings." actions={<ManageInIam />} />
      <SubNav id="settings" />
      {body}
    </>
  )
}
