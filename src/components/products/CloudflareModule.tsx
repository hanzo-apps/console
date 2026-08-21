'use client'

/**
 * Cloudflare — an org's Cloudflare Pages + Workers managed from the console, over
 * the cloud asset plane at `/v1/cloudflare/*` (cloud `apps/cloudflare`, a sibling of
 * the `cloudflare` CONNECTOR in `apps/integrations` that seals the token and of
 * hanzodns which drives the same token for `/v1/dns`).
 *
 * Tabs: Pages (projects → deployments + custom domains), Workers (scripts, the
 * account workers.dev subdomain, zone routes), and R2 / KV / D1 which are Phase 2 —
 * their routes exist and answer an honest 501, so they render a truthful "not yet
 * available" panel and are NEVER shown as broken or filled with fake rows.
 *
 * Every read/write is same-origin, keyless and org-scoped SERVER-SIDE (the `/v1`
 * bearer BFF mints a short-lived user token; cloud resolves the org from the token
 * owner and reads THAT org's KMS-sealed Cloudflare token), so no credential reaches
 * the browser. States are honest end to end:
 *   - 503 → the org has not connected Cloudflare → prompt to connect (the generic
 *     `OrgConnectorsModule` already renders the connect card; we LINK to it rather
 *     than rebuilding a second connect flow);
 *   - 403 → reads are open to any org member, mutations require ORG ADMIN — say so;
 *   - 501 → an honest Phase-2 answer;
 *   - anything else → the shared `BackendStateCard`. Never placeholder data.
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from '~/lib/router'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowLeft, Cloud, ExternalLink, Globe, Plus, Power, RefreshCw, Rocket, Trash2, Upload, Zap } from '@hanzogui/lucide-icons-2'

import {
  CloudflareApi,
  isCustomDomain,
  validateDomain,
  validateName,
  validatePattern,
  validateScript,
  validateZoneId,
  workersDevUrl,
  type PagesProject,
  type WorkerRoute,
  type WorkerScript,
} from '~/lib/api/cloudflare'
import { SlideOver } from '~/components/ui/SlideOver'
import { useToast } from '~/components/ui/Toast'
import { BackendStateCard, ConfirmDelete, DataTable, EmptyState, FieldRow, FieldText, FieldTextArea, PageHeader, PrimaryButton, StatusTag, classifyBackend, type BackendState, type Column } from '@hanzo/ui/product'

/** Cloudflare brand orange — used ONLY for Cloudflare-specific affordances. */
const CF_TONE = 'var(--color11)' // the Cloudflare lane reads by icon + label, not hue

type Async<T> =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; data: T }

type TabId = 'pages' | 'workers' | 'r2' | 'kv' | 'd1'

/** The tab bar. `phase2` tabs are visibly disabled — their backend answers 501. */
const TABS: { id: TabId; label: string; phase2?: boolean }[] = [
  { id: 'pages', label: 'Pages' },
  { id: 'workers', label: 'Workers' },
  { id: 'r2', label: 'R2', phase2: true },
  { id: 'kv', label: 'KV', phase2: true },
  { id: 'd1', label: 'D1', phase2: true },
]

/** What each Phase-2 capability WILL be, stated plainly (no promise of a date). */
const PHASE2_COPY: Record<'r2' | 'kv' | 'd1', string> = {
  r2: 'R2 object storage buckets — create, list and delete an org’s R2 buckets.',
  kv: 'Workers KV namespaces — create, list and delete an org’s KV namespaces.',
  d1: 'D1 serverless SQL databases — create, list and delete an org’s D1 databases.',
}

// ── Honest shared states ─────────────────────────────────────────────────────

/**
 * The ONE error surface for this module. A 503 on the Cloudflare plane means exactly
 * one thing — the org has not connected Cloudflare — so it becomes a connect prompt
 * rather than the generic "backend not initialized" card, which would be true but
 * useless. A 403 is explained in terms of THIS surface's real gate (reads open to
 * members, writes org-admin only).
 */
function CloudflareError({ state, onRetry }: { state: BackendState; onRetry?: () => void }) {
  const router = useRouter()
  if (state.kind === 'not-initialized') {
    return (
      <EmptyState
        icon={Cloud}
        title="Connect Cloudflare to continue"
        description="This organization has not connected a Cloudflare account yet. Connect one and its Pages projects, Workers and routes appear here — managed with your own scoped API token, which is sealed in KMS and never shown to the browser."
        bullets={[
          'Connect on the Integrations page with a scoped Cloudflare API token, or via OAuth.',
          'The same connection also backs Cloudflare-synced zones in DNS.',
          'Connecting requires org admin.',
        ]}
        primary={{ label: 'Connect Cloudflare', onPress: () => router.push('/connectors'), icon: <Cloud size={16} /> }}
      />
    )
  }
  return (
    <BackendStateCard
      state={state}
      onRetry={onRetry}
      hint={
        state.kind === 'access'
          ? 'Reading Cloudflare is open to every member of the organization; creating, changing or deleting requires ORG ADMIN. Ask an admin of your organization to make the change, or to grant you admin.'
          : undefined
      }
    />
  )
}

/** A Phase-2 capability: the route exists and answers 501 — say that, show nothing else. */
function Phase2Panel({ tab }: { tab: 'r2' | 'kv' | 'd1' }) {
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$2" maxWidth={640}>
      <XStack gap="$2" items="center">
        <Cloud size={16} color={CF_TONE} />
        <Text fontSize="$4" fontWeight="700">
          {tab.toUpperCase()} — Phase 2
        </Text>
      </XStack>
      <Text fontSize="$3" color="$color11">
        {PHASE2_COPY[tab]}
      </Text>
      <Text fontSize="$2" color="$color10">
        Not yet available. The API route answers, but the capability behind it has not shipped. This tab fills in when
        it does.
      </Text>
    </Card>
  )
}

/** A quiet section heading inside a tab. */
function Section({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <XStack justify="space-between" items="flex-start" gap="$3" flexWrap="wrap">
      <YStack gap="$1" flex={1} minW={180}>
        <Text fontSize="$5" fontWeight="500">
          {title}
        </Text>
        {subtitle ? (
          <Text fontSize="$2" color="$color10">
            {subtitle}
          </Text>
        ) : null}
      </YStack>
      {actions ? (
        <XStack gap="$2" items="center" flexWrap="wrap">
          {actions}
        </XStack>
      ) : null}
    </XStack>
  )
}

/** An external link chip (a live pages.dev / workers.dev URL), or nothing when unset. */
function LinkOut({ href, label }: { href: string; label?: string }) {
  if (!href) return <Text fontSize="$2" color="$color9">—</Text>
  return (
    <XStack
      items="center"
      gap="$1"
      // `render`, not `tag`: gui 8 renamed the host-element prop, and gui drops a prop
      // it does not know without erroring — `tag="a"` type-checked, built, and shipped
      // a <div>, so this chip was an inert link that nothing reported.
      render="a"
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {...({ href, target: '_blank', rel: 'noopener noreferrer' } as any)}
    >
      <Text fontSize="$2" style={{ color: CF_TONE }} numberOfLines={1}>
        {label ?? href.replace(/^https:\/\//, '')}
      </Text>
      <ExternalLink size={12} color={CF_TONE} />
    </XStack>
  )
}

// ── Forms ────────────────────────────────────────────────────────────────────

/** Create a Pages project → POST /pages/projects (org admin). */
function ProjectForm({ onDone }: { onDone: () => void }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [branch, setBranch] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    const v = validateName(name, 'Project name')
    if (v) return setErr(v)
    setSaving(true)
    setErr(null)
    try {
      const p = await CloudflareApi.pages.create(name, branch)
      toast.success(`Created Pages project ${p.name || name.trim()}`)
      onDone()
    } catch (e) {
      setErr(classifyBackend(e).message || 'The Pages project was not created. Try again.')
      setSaving(false)
    }
  }

  return (
    <YStack gap="$3">
      <FieldRow label="Project name">
        <FieldText value={name} onChange={setName} placeholder="my-site" disabled={saving} />
      </FieldRow>
      <FieldRow label="Production branch (optional)">
        <FieldText value={branch} onChange={setBranch} placeholder="main" disabled={saving} />
      </FieldRow>
      <Text fontSize="$2" color="$color10">
        Creates an empty Pages project on your Cloudflare account. Upload builds with Wrangler or trigger a deployment
        here once a Git repository is connected in Cloudflare.
      </Text>
      {err ? <Text fontSize="$2" color="$red10">{err}</Text> : null}
      <PrimaryButton onPress={submit} disabled={saving} icon={<Plus size={16} />}>
        {saving ? 'Creating…' : 'Create project'}
      </PrimaryButton>
    </YStack>
  )
}

/** Add a custom domain to a Pages project → POST /pages/projects/:p/domains (org admin). */
function DomainForm({ project, onDone }: { project: string; onDone: () => void }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    const v = validateDomain(name)
    if (v) return setErr(v)
    setSaving(true)
    setErr(null)
    try {
      await CloudflareApi.pages.addDomain(project, name)
      toast.success(`Added ${name.trim()} to ${project}`)
      onDone()
    } catch (e) {
      setErr(classifyBackend(e).message || `The domain was not added to ${project}. Try again.`)
      setSaving(false)
    }
  }

  return (
    <YStack gap="$3">
      <FieldRow label="Domain">
        <FieldText value={name} onChange={setName} placeholder="app.example.com" disabled={saving} />
      </FieldRow>
      <Text fontSize="$2" color="$color10">
        The domain must be on a zone in the same Cloudflare account. Cloudflare validates it and issues a certificate;
        until validation completes it shows as pending in Cloudflare.
      </Text>
      {err ? <Text fontSize="$2" color="$red10">{err}</Text> : null}
      <PrimaryButton onPress={submit} disabled={saving} icon={<Plus size={16} />}>
        {saving ? 'Adding…' : 'Add domain'}
      </PrimaryButton>
    </YStack>
  )
}

/** Trigger a deployment → POST /pages/projects/:p/deployments (org admin). */
function DeployForm({ project, onDone }: { project: PagesProject; onDone: () => void }) {
  const toast = useToast()
  const [branch, setBranch] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setErr(null)
    try {
      await CloudflareApi.pages.deploy(project.name, branch)
      toast.success(`Deployment queued for ${project.name}`)
      onDone()
    } catch (e) {
      setErr(classifyBackend(e).message || `No deployment was queued for ${project.name}. Try again.`)
      setBusy(false)
    }
  }

  return (
    <YStack gap="$3">
      <FieldRow label="Branch (optional)">
        <FieldText
          value={branch}
          onChange={setBranch}
          placeholder={project.productionBranch || 'production branch'}
          disabled={busy}
        />
      </FieldRow>
      <Text fontSize="$2" color="$color10">
        Builds from the project’s connected Git repository. Leave the branch empty to build
        {project.productionBranch ? ` ${project.productionBranch}` : ' the production branch'}. A project with no Git
        connection in Cloudflare cannot be deployed this way — upload it with Wrangler instead.
      </Text>
      {err ? <Text fontSize="$2" color="$red10">{err}</Text> : null}
      <PrimaryButton onPress={submit} disabled={busy} icon={<Rocket size={16} />}>
        {busy ? 'Starting…' : 'Start deployment'}
      </PrimaryButton>
    </YStack>
  )
}

/** Upload/replace a module Worker → PUT /workers/scripts/:script (org admin). */
function ScriptForm({ script, onDone }: { script?: WorkerScript; onDone: () => void }) {
  const toast = useToast()
  const editing = !!script
  const [name, setName] = useState(script?.name ?? '')
  const [source, setSource] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    const v = validateName(name, 'Script name') ?? validateScript(source)
    if (v) return setErr(v)
    setSaving(true)
    setErr(null)
    try {
      await CloudflareApi.workers.put(name, source)
      toast.success(`${editing ? 'Updated' : 'Uploaded'} Worker ${name.trim()}`)
      onDone()
    } catch (e) {
      setErr(classifyBackend(e).message || 'The Worker was not uploaded. Nothing changed on Cloudflare — try again.')
      setSaving(false)
    }
  }

  return (
    <YStack gap="$3">
      <FieldRow label="Script name">
        <FieldText value={name} onChange={setName} placeholder="my-worker" disabled={saving || editing} />
      </FieldRow>
      <FieldRow label="Module source (ES module)">
        <FieldTextArea value={source} onChange={setSource} rows={12} disabled={saving} />
      </FieldRow>
      <Text fontSize="$2" color="$color10">
        Uploaded as a Workers ES module with `worker.js` as the entry point — it must `export default {'{ fetch }'}`.
        {editing ? ' Uploading replaces the current version of this script.' : ''}
      </Text>
      {err ? <Text fontSize="$2" color="$red10">{err}</Text> : null}
      <PrimaryButton onPress={submit} disabled={saving} icon={<Upload size={16} />}>
        {saving ? 'Uploading…' : editing ? 'Replace script' : 'Upload script'}
      </PrimaryButton>
    </YStack>
  )
}

/** Bind a Worker to a URL pattern in a zone → POST /workers/zones/:zone/routes (org admin). */
function RouteForm({ zone, scripts, onDone }: { zone: string; scripts: WorkerScript[]; onDone: () => void }) {
  const toast = useToast()
  const [pattern, setPattern] = useState('')
  const [script, setScript] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    const v = validatePattern(pattern)
    if (v) return setErr(v)
    setSaving(true)
    setErr(null)
    try {
      await CloudflareApi.workers.routes.create(zone, pattern, script)
      toast.success(`Route ${pattern.trim()} created`)
      onDone()
    } catch (e) {
      setErr(classifyBackend(e).message || 'The route was not created. Traffic still routes as it did — try again.')
      setSaving(false)
    }
  }

  return (
    <YStack gap="$3">
      <FieldRow label="Pattern">
        <FieldText value={pattern} onChange={setPattern} placeholder="example.com/*" disabled={saving} />
      </FieldRow>
      <FieldRow label="Worker (optional)">
        <FieldText value={script} onChange={setScript} placeholder={scripts[0]?.name ?? 'my-worker'} disabled={saving} />
      </FieldRow>
      <Text fontSize="$2" color="$color10">
        A route sends matching requests on this zone to the named Worker. Leave the Worker empty to create a route that
        bypasses Workers for the pattern.
        {scripts.length ? ` Uploaded Workers: ${scripts.map((s) => s.name).join(', ')}.` : ''}
      </Text>
      {err ? <Text fontSize="$2" color="$red10">{err}</Text> : null}
      <PrimaryButton onPress={submit} disabled={saving} icon={<Plus size={16} />}>
        {saving ? 'Creating…' : 'Create route'}
      </PrimaryButton>
    </YStack>
  )
}

// ── Pages tab ────────────────────────────────────────────────────────────────

type PagesDialog =
  | { kind: 'none' }
  | { kind: 'newProject' }
  | { kind: 'deleteProject'; project: PagesProject }
  | { kind: 'deploy'; project: PagesProject }
  | { kind: 'newDomain'; project: PagesProject }
  | { kind: 'deleteDomain'; project: PagesProject; domain: string }

function PagesTab() {
  const [state, setState] = useState<Async<PagesProject[]>>({ phase: 'loading' })
  const [active, setActive] = useState<PagesProject | null>(null)
  const [dialog, setDialog] = useState<PagesDialog>({ kind: 'none' })

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      setState({ phase: 'ready', data: await CloudflareApi.pages.list() })
    } catch (e) {
      setState({ phase: 'error', error: classifyBackend(e) })
    }
  }, [])

  // Re-read the ACTIVE project from the server — it is the authoritative source for
  // domains + latest deployment (there is no domains-list route).
  const reloadActive = useCallback(async (name: string) => {
    try {
      setActive(await CloudflareApi.pages.get(name))
    } catch {
      // A detail refresh failure leaves the last known project on screen; the list
      // reload below surfaces any real error.
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const close = () => setDialog({ kind: 'none' })
  const afterChange = async (projectName?: string) => {
    close()
    await load()
    if (projectName) await reloadActive(projectName)
  }

  if (state.phase === 'error') return <CloudflareError state={state.error} onRetry={() => void load()} />

  // ── detail ──
  if (active) {
    const custom = active.domains.filter(isCustomDomain)
    const columns: Column<string>[] = [
      { key: 'domain', header: 'Domain', render: (d) => <LinkOut href={`https://${d}`} label={d} /> },
      {
        key: 'actions',
        header: '',
        width: 60,
        align: 'right',
        render: (d) => (
          <Button
            chromeless
            width={44}
            height={44}
            icon={<Trash2 size={15} />}
            aria-label={`Remove ${d}`}
            onPress={() => setDialog({ kind: 'deleteDomain', project: active, domain: d })}
          />
        ),
      },
    ]
    return (
      <YStack gap="$4">
        <PageHeader
          title={active.name}
          subtitle={`Pages project${active.productionBranch ? ` · production branch ${active.productionBranch}` : ''}`}
          actions={
            <>
              <Button size="$3" chromeless icon={<ArrowLeft size={15} />} onPress={() => setActive(null)}>
                All projects
              </Button>
              <Button size="$3" theme="light" icon={<Rocket size={15} />} onPress={() => setDialog({ kind: 'deploy', project: active })}>
                Deploy
              </Button>
              <Button
                size="$3"
                chromeless
                icon={<Trash2 size={15} />}
                onPress={() => setDialog({ kind: 'deleteProject', project: active })}
              >
                Delete
              </Button>
            </>
          }
        />

        <XStack gap="$3" flexWrap="wrap">
          <YStack gap="$1" borderWidth={1} borderColor="$borderColor" rounded="$4" px="$4" py="$3" minW={220}>
            <Text fontSize="$1" color="$color10">pages.dev</Text>
            <LinkOut href={active.subdomain ? `https://${active.subdomain}` : ''} />
          </YStack>
          <YStack gap="$1" borderWidth={1} borderColor="$borderColor" rounded="$4" px="$4" py="$3" minW={220}>
            <Text fontSize="$1" color="$color10">Latest deployment</Text>
            {active.latestDeployment ? (
              <XStack gap="$2" items="center" flexWrap="wrap">
                <StatusTag status={active.latestDeployment.status} />
                <Text fontSize="$2" color="$color11">
                  {active.latestDeployment.environment}
                  {active.latestDeployment.branch ? ` · ${active.latestDeployment.branch}` : ''}
                </Text>
              </XStack>
            ) : (
              <Text fontSize="$2" color="$color10">No deployment yet</Text>
            )}
          </YStack>
        </XStack>

        <Section
          title="Custom domains"
          subtitle="Domains bound to this Pages project, read from the project itself."
          actions={
            <Button size="$3" theme="light" icon={<Plus size={15} />} onPress={() => setDialog({ kind: 'newDomain', project: active })}>
              Add domain
            </Button>
          }
        />
        {custom.length === 0 ? (
          <Card borderWidth={1} borderColor="$borderColor" p="$4">
            <Text fontSize="$3" color="$color11">
              No custom domain yet. The project is served at {active.subdomain || 'its pages.dev subdomain'}.
            </Text>
          </Card>
        ) : (
          <DataTable columns={columns} rows={custom} rowKey={(d) => d} empty="No custom domains." />
        )}

        <PagesDialogs dialog={dialog} onClose={close} onDone={afterChange} onDeleted={() => { setActive(null); void afterChange() }} />
      </YStack>
    )
  }

  // ── list ──
  const projects = state.phase === 'ready' ? state.data : []
  const columns: Column<PagesProject>[] = [
    { key: 'name', header: 'Project', render: (p) => <Text fontSize="$3">{p.name}</Text> },
    {
      key: 'url',
      header: 'pages.dev',
      render: (p) => <LinkOut href={p.subdomain ? `https://${p.subdomain}` : ''} />,
    },
    { key: 'branch', header: 'Branch', width: 120, render: (p) => <Text fontSize="$2" color="$color11">{p.productionBranch || '—'}</Text> },
    {
      key: 'deploy',
      header: 'Last deployment',
      width: 150,
      render: (p) => (p.latestDeployment?.status ? <StatusTag status={p.latestDeployment.status} /> : <Text fontSize="$2" color="$color9">—</Text>),
    },
    { key: 'domains', header: 'Domains', width: 90, align: 'right', mono: true, render: (p) => <Text fontSize="$2">{p.domains.filter(isCustomDomain).length}</Text> },
  ]

  return (
    <YStack gap="$4">
      <Section
        title="Pages projects"
        subtitle="Static sites and full-stack apps on your Cloudflare account."
        actions={
          <>
            <Button size="$3" chromeless icon={<RefreshCw size={15} />} aria-label="Refresh" onPress={() => void load()} />
            <Button size="$3" theme="light" icon={<Plus size={15} />} onPress={() => setDialog({ kind: 'newProject' })}>
              New project
            </Button>
          </>
        }
      />
      {state.phase === 'ready' && projects.length === 0 ? (
        <EmptyState
          icon={Globe}
          title="No Pages projects yet"
          description="This Cloudflare account has no Pages projects. Create one here, then push a build with Wrangler or connect a Git repository in Cloudflare to deploy it."
          primary={{ label: 'New project', onPress: () => setDialog({ kind: 'newProject' }), icon: <Plus size={16} /> }}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={projects}
          loading={state.phase === 'loading'}
          rowKey={(p) => p.name}
          onRowPress={(p) => { setActive(p); void reloadActive(p.name) }}
          empty="No Pages projects."
        />
      )}
      <PagesDialogs dialog={dialog} onClose={close} onDone={afterChange} onDeleted={() => { setActive(null); void afterChange() }} />
    </YStack>
  )
}

/** ONE SlideOver for every Pages dialog (list + detail share it). */
function PagesDialogs({
  dialog,
  onClose,
  onDone,
  onDeleted,
}: {
  dialog: PagesDialog
  onClose: () => void
  onDone: (project?: string) => void | Promise<void>
  onDeleted: () => void
}) {
  const title =
    dialog.kind === 'newProject'
      ? 'New Pages project'
      : dialog.kind === 'deleteProject'
        ? `Delete ${dialog.project.name}`
        : dialog.kind === 'deploy'
          ? `Deploy ${dialog.project.name}`
          : dialog.kind === 'newDomain'
            ? `Add domain · ${dialog.project.name}`
            : dialog.kind === 'deleteDomain'
              ? 'Remove domain'
              : ''

  return (
    <SlideOver
      open={dialog.kind !== 'none'}
      onClose={onClose}
      title={title}
      icon={dialog.kind === 'deleteProject' || dialog.kind === 'deleteDomain' ? Trash2 : Cloud}
      iconColor={CF_TONE}
      ariaLabel="Cloudflare Pages dialog"
    >
      {dialog.kind === 'newProject' ? (
        <ProjectForm onDone={() => void onDone()} />
      ) : dialog.kind === 'deploy' ? (
        <DeployForm project={dialog.project} onDone={() => void onDone(dialog.project.name)} />
      ) : dialog.kind === 'newDomain' ? (
        <DomainForm project={dialog.project.name} onDone={() => void onDone(dialog.project.name)} />
      ) : dialog.kind === 'deleteProject' ? (
        <ConfirmDelete
          message={`Delete the Pages project “${dialog.project.name}”, its deployments and its domain bindings? This cannot be undone.`}
          confirmLabel="Delete project"
          run={() => CloudflareApi.pages.remove(dialog.project.name)}
          onDone={onDeleted}
        />
      ) : dialog.kind === 'deleteDomain' ? (
        <ConfirmDelete
          message={`Remove ${dialog.domain} from ${dialog.project.name}? The project stays; the domain stops serving it.`}
          confirmLabel="Remove domain"
          run={() => CloudflareApi.pages.removeDomain(dialog.project.name, dialog.domain)}
          onDone={() => void onDone(dialog.project.name)}
        />
      ) : null}
    </SlideOver>
  )
}

// ── Workers tab ──────────────────────────────────────────────────────────────

type WorkersDialog =
  | { kind: 'none' }
  | { kind: 'newScript' }
  | { kind: 'editScript'; script: WorkerScript }
  | { kind: 'deleteScript'; script: WorkerScript }
  | { kind: 'newRoute' }
  | { kind: 'deleteRoute'; route: WorkerRoute }

function WorkersTab() {
  const toast = useToast()
  const [state, setState] = useState<Async<WorkerScript[]>>({ phase: 'loading' })
  const [subdomain, setSubdomain] = useState('')
  const [dialog, setDialog] = useState<WorkersDialog>({ kind: 'none' })
  // Zone routes are keyed by the 32-hex Cloudflare ZONE ID, so the zone is an
  // explicit input rather than a guess.
  const [zone, setZone] = useState('')
  const [zoneErr, setZoneErr] = useState<string | null>(null)
  const [routes, setRoutes] = useState<Async<WorkerRoute[]> | null>(null)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const scripts = await CloudflareApi.workers.list()
      setState({ phase: 'ready', data: scripts })
      // The account workers.dev subdomain is a separate, non-fatal read: an account
      // without one is normal, so a failure here must not blank the scripts table.
      CloudflareApi.workers.subdomain().then(setSubdomain).catch(() => setSubdomain(''))
    } catch (e) {
      setState({ phase: 'error', error: classifyBackend(e) })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const loadRoutes = useCallback(async (zoneId: string) => {
    const v = validateZoneId(zoneId)
    if (v) {
      setZoneErr(v)
      setRoutes(null)
      return
    }
    setZoneErr(null)
    setRoutes({ phase: 'loading' })
    try {
      setRoutes({ phase: 'ready', data: await CloudflareApi.workers.routes.list(zoneId) })
    } catch (e) {
      setRoutes({ phase: 'error', error: classifyBackend(e) })
    }
  }, [])

  const setDev = async (script: WorkerScript, enabled: boolean) => {
    try {
      await CloudflareApi.workers.setSubdomain(script.name, enabled)
      toast.success(`${script.name} ${enabled ? 'enabled on' : 'disabled from'} workers.dev`)
    } catch (e) {
      toast.error('Could not change workers.dev', classifyBackend(e).message)
    }
  }

  const close = () => setDialog({ kind: 'none' })
  const afterChange = async () => {
    close()
    await load()
  }
  const afterRouteChange = async () => {
    close()
    if (zone) await loadRoutes(zone)
  }

  if (state.phase === 'error') return <CloudflareError state={state.error} onRetry={() => void load()} />

  const scripts = state.phase === 'ready' ? state.data : []
  const columns: Column<WorkerScript>[] = [
    { key: 'name', header: 'Worker', render: (s) => <Text fontSize="$3">{s.name}</Text> },
    {
      key: 'url',
      header: 'workers.dev',
      render: (s) => <LinkOut href={workersDevUrl(s.name, subdomain)} />,
    },
    {
      key: 'modified',
      header: 'Modified',
      width: 170,
      render: (s) => <Text fontSize="$2" color="$color11">{s.modifiedAt ? new Date(s.modifiedAt).toLocaleString() : '—'}</Text>,
    },
    {
      key: 'actions',
      header: '',
      width: 190,
      align: 'right',
      render: (s) => (
        <XStack gap="$1" items="center" justify="flex-end">
          <Button size="$2" chromeless icon={<Power size={14} />} aria-label={`Enable ${s.name} on workers.dev`} onPress={() => void setDev(s, true)}>
            On
          </Button>
          <Button size="$2" chromeless aria-label={`Disable ${s.name} on workers.dev`} onPress={() => void setDev(s, false)}>
            Off
          </Button>
          <Button size="$2" chromeless icon={<Upload size={14} />} aria-label={`Replace ${s.name}`} onPress={() => setDialog({ kind: 'editScript', script: s })} />
          <Button size="$2" chromeless icon={<Trash2 size={14} />} aria-label={`Delete ${s.name}`} onPress={() => setDialog({ kind: 'deleteScript', script: s })} />
        </XStack>
      ),
    },
  ]

  const routeColumns: Column<WorkerRoute>[] = [
    { key: 'pattern', header: 'Pattern', render: (r) => <Text fontSize="$3">{r.pattern}</Text> },
    { key: 'script', header: 'Worker', render: (r) => <Text fontSize="$2" color="$color11">{r.script || '— (bypass)'}</Text> },
    {
      key: 'actions',
      header: '',
      width: 60,
      align: 'right',
      render: (r) => (
        <Button chromeless width={44} height={44} icon={<Trash2 size={15} />} aria-label={`Delete route ${r.pattern}`} onPress={() => setDialog({ kind: 'deleteRoute', route: r })} />
      ),
    },
  ]

  return (
    <YStack gap="$4">
      <Section
        title="Workers"
        subtitle={
          subdomain
            ? `Serverless scripts on your account · workers.dev subdomain ${subdomain}`
            : 'Serverless scripts on your Cloudflare account.'
        }
        actions={
          <>
            <Button size="$3" chromeless icon={<RefreshCw size={15} />} aria-label="Refresh" onPress={() => void load()} />
            <Button size="$3" theme="light" icon={<Upload size={15} />} onPress={() => setDialog({ kind: 'newScript' })}>
              Upload Worker
            </Button>
          </>
        }
      />

      {state.phase === 'ready' && scripts.length === 0 ? (
        <EmptyState
          icon={Zap}
          title="No Workers yet"
          description="This Cloudflare account has no Worker scripts. Upload an ES module here, then enable it on workers.dev or bind it to a route on one of your zones."
          primary={{ label: 'Upload Worker', onPress: () => setDialog({ kind: 'newScript' }), icon: <Upload size={16} /> }}
        />
      ) : (
        <DataTable columns={columns} rows={scripts} loading={state.phase === 'loading'} rowKey={(s) => s.name} empty="No Workers." />
      )}

      {scripts.length > 0 ? (
        <Text fontSize="$2" color="$color10">
          On / Off publish or unpublish a Worker on workers.dev. Cloudflare exposes no read for a script’s current
          workers.dev state on this surface, so these are actions — the table does not claim to know which is active.
        </Text>
      ) : null}

      {/* ── zone routes ── */}
      <Section title="Routes" subtitle="Bind a Worker to a URL pattern on one of your zones." />
      <XStack gap="$2" items="flex-start" flexWrap="wrap">
        <YStack flex={1} minW={260} gap="$1">
          <FieldText value={zone} onChange={setZone} placeholder="Cloudflare zone ID (32-character hex)" />
          {zoneErr ? <Text fontSize="$2" color="$red10">{zoneErr}</Text> : null}
        </YStack>
        <Button size="$3" theme="light" onPress={() => void loadRoutes(zone)}>
          Load routes
        </Button>
        <Button size="$3" chromeless icon={<Plus size={15} />} disabled={!!validateZoneId(zone)} onPress={() => setDialog({ kind: 'newRoute' })}>
          New route
        </Button>
      </XStack>
      <Text fontSize="$2" color="$color10">
        Find a zone ID on the zone’s overview page in the Cloudflare dashboard. Routes are listed per zone.
      </Text>

      {routes?.phase === 'error' ? (
        <CloudflareError state={routes.error} onRetry={() => void loadRoutes(zone)} />
      ) : routes ? (
        <DataTable
          columns={routeColumns}
          rows={routes.phase === 'ready' ? routes.data : []}
          loading={routes.phase === 'loading'}
          rowKey={(r) => r.id}
          empty="No routes on this zone."
        />
      ) : null}

      <SlideOver
        open={dialog.kind !== 'none'}
        onClose={close}
        title={
          dialog.kind === 'newScript'
            ? 'Upload Worker'
            : dialog.kind === 'editScript'
              ? `Replace ${dialog.script.name}`
              : dialog.kind === 'deleteScript'
                ? `Delete ${dialog.script.name}`
                : dialog.kind === 'newRoute'
                  ? 'New route'
                  : dialog.kind === 'deleteRoute'
                    ? 'Delete route'
                    : ''
        }
        icon={dialog.kind === 'deleteScript' || dialog.kind === 'deleteRoute' ? Trash2 : Zap}
        iconColor={CF_TONE}
        size={560}
        ariaLabel="Cloudflare Workers dialog"
      >
        {dialog.kind === 'newScript' ? (
          <ScriptForm onDone={() => void afterChange()} />
        ) : dialog.kind === 'editScript' ? (
          <ScriptForm script={dialog.script} onDone={() => void afterChange()} />
        ) : dialog.kind === 'deleteScript' ? (
          <ConfirmDelete
            message={`Delete the Worker “${dialog.script.name}”? Routes pointing at it will stop resolving. This cannot be undone.`}
            confirmLabel="Delete Worker"
            run={() => CloudflareApi.workers.remove(dialog.script.name)}
            onDone={() => void afterChange()}
          />
        ) : dialog.kind === 'newRoute' ? (
          <RouteForm zone={zone} scripts={scripts} onDone={() => void afterRouteChange()} />
        ) : dialog.kind === 'deleteRoute' ? (
          <ConfirmDelete
            message={`Delete the route “${dialog.route.pattern}”? Requests matching it stop going to ${dialog.route.script || 'the bypass'}. This cannot be undone — the route has to be created again.`}
            confirmLabel="Delete route"
            run={() => CloudflareApi.workers.routes.remove(zone, dialog.route.id)}
            onDone={() => void afterRouteChange()}
          />
        ) : null}
      </SlideOver>
    </YStack>
  )
}

// ── Module ───────────────────────────────────────────────────────────────────

export function CloudflareModule(_props: { params: Record<string, string> }) {
  const [tab, setTab] = useState<TabId>('pages')

  return (
    <YStack gap="$4">
      <PageHeader
        title="Cloudflare"
        subtitle="Manage your organization’s Cloudflare Pages, Workers and routes with your own connected account."
      />

      <XStack gap="$1" flexWrap="wrap">
        {TABS.map((t) => (
          <Button
            key={t.id}
            size="$2"
            bg={t.id === tab ? '$color5' : 'transparent'}
            borderWidth={1}
            borderColor="$borderColor"
            // A Phase-2 tab is SELECTABLE (so its honest explanation is reachable)
            // but visibly de-emphasized and labeled — never presented as working.
            opacity={t.phase2 ? 0.55 : 1}
            onPress={() => setTab(t.id)}
            aria-label={t.phase2 ? `${t.label} (Phase 2, not yet available)` : t.label}
          >
            {t.phase2 ? `${t.label} · soon` : t.label}
          </Button>
        ))}
      </XStack>

      {tab === 'pages' ? <PagesTab /> : tab === 'workers' ? <WorkersTab /> : <Phase2Panel tab={tab} />}
    </YStack>
  )
}

export default CloudflareModule
