'use client'

/**
 * Platform project detail — the HUB for ONE IAM-native project: deploy a build,
 * view deployments + status/logs, bind custom domains, edit config, and DEEP-LINK
 * the same project to hanzo.app (edit) and hanzo.chat (chat about it) on the ONE
 * shared key (`?project=<iamProjectId>`).
 *
 * The project is IAM-native (`ProjectApi`, keyed by `name`); its deploy state is the
 * cloud site store (`PlatformSitesApi`, slug === the IAM name). All real data / honest
 * states — a not-yet-deployed project shows the deploy zone, never a fake "live".
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from '~/lib/router'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import {
  ArrowLeft,
  ExternalLink,
  Globe,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
} from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { useScope } from '~/lib/scope-context'
import {
  PlatformSitesApi,
  SITE_FRAMEWORKS,
  type Site,
  type SiteDeployment,
} from '~/lib/api/platform-sites'
import { crossSurfaceLinks } from '~/lib/products/cross-surface'
import { fmtBytes, fmtWhen, latestDeployment, siteSlugForProject } from './logic'
import { DeployDropzone } from './DeployDropzone'
import { asApiError } from '~/components/ui/States'
import { useToast } from '~/components/ui/Toast'
import { BackendStateCard, DataTable, FieldRow, FieldSelect, FieldText, FieldTextArea, PageHeader, PrimaryButton, StatusTag, classifyRead, type Column } from '@hanzo/ui/product'

const openExt = (href: string) => {
  if (typeof window !== 'undefined') window.open(href, '_blank', 'noopener')
}

function SectionCard({ title, subtitle, actions, children }: {
  title: string
  subtitle?: string
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3">
      <XStack justify="space-between" items="flex-start" gap="$2" flexWrap="wrap">
        <YStack gap="$1" flex={1} minW={200}>
          <Text fontSize="$5" fontWeight="700">{title}</Text>
          {subtitle ? <Text fontSize="$2" color="$color10">{subtitle}</Text> : null}
        </YStack>
        {actions}
      </XStack>
      {children}
    </Card>
  )
}

export function PlatformDetail({ name }: { name: string }) {
  const router = useRouter()
  const toast = useToast()
  const { projects, selectProject } = useScope()

  const project = projects.find((p) => p.name === name)
  const displayName = project?.displayName || project?.name || name
  const slug = siteSlugForProject(name)

  const [site, setSite] = useState<Site | null>(null)
  const [deployments, setDeployments] = useState<SiteDeployment[]>([])
  const [domains, setDomains] = useState<string[]>([])
  const [loadErr, setLoadErr] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [openDeployment, setOpenDeployment] = useState<string | null>(null)

  // Scope every other module to this project while the hub is open (the shared scope).
  useEffect(() => {
    if (project && project.name !== undefined) selectProject(project.name)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.name])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadErr(null)
    try {
      const s = await PlatformSitesApi.get(slug)
      setSite(s)
      if (s) {
        const [deps, doms] = await Promise.all([
          PlatformSitesApi.listDeployments(slug).catch(() => [] as SiteDeployment[]),
          PlatformSitesApi.listDomains(slug).catch(() => [] as string[]),
        ])
        setDeployments(deps)
        setDomains(doms)
      } else {
        setDeployments([])
        setDomains([])
      }
    } catch (e) {
      setLoadErr(e)
    } finally {
      setLoading(false)
    }
  }, [slug])

  useEffect(() => {
    void load()
  }, [load])

  const onDeploy = async (artifact: Uint8Array, contentType: string, label: string) => {
    setBusy(true)
    try {
      await PlatformSitesApi.ensure({ slug, name: displayName, framework: 'static' })
      const dep = await PlatformSitesApi.deploy(slug, artifact, contentType)
      if (dep.status === 'error') {
        toast.error('Deploy failed', dep.message || 'The upload could not be published.')
      } else {
        toast.success('Deployed', `${label} is live${dep.liveUrl ? '' : ''}.`)
      }
      await load()
    } catch (e) {
      toast.error('Could not deploy', asApiError(e).message)
    } finally {
      setBusy(false)
    }
  }

  const links = crossSurfaceLinks(name, { appUrl: config.appUrl, chatUrl: config.chatUrl })
  const liveUrl = site?.liveUrl
  const latest = latestDeployment(deployments)

  const deploymentColumns: Column<SiteDeployment>[] = [
    { key: 'version', header: 'Ver', width: 64, render: (d) => <Text fontSize="$3" fontWeight="600">v{d.version || '—'}</Text> },
    { key: 'status', header: 'Status', width: 120, render: (d) => <StatusTag status={d.status} /> },
    { key: 'source', header: 'Source', width: 90, render: (d) => <Text fontSize="$3" color="$color11">{d.source || '—'}</Text> },
    { key: 'files', header: 'Files', width: 70, render: (d) => <Text fontSize="$3" color="$color11">{d.files || 0}</Text> },
    { key: 'size', header: 'Size', width: 90, render: (d) => <Text fontSize="$3" color="$color11">{fmtBytes(d.bytes)}</Text> },
    { key: 'when', header: 'Deployed', width: 170, render: (d) => <Text fontSize="$3" color="$color11">{fmtWhen(d.createdAt)}</Text> },
    {
      key: 'actions',
      header: '',
      width: 120,
      render: (d) => (
        <XStack gap="$1" justify="flex-end">
          <Button size="$2" chromeless onPress={() => setOpenDeployment(openDeployment === d.id ? null : d.id)}>
            {openDeployment === d.id ? 'Hide' : 'Details'}
          </Button>
          {d.liveUrl ? (
            <Button size="$2" chromeless icon={<ExternalLink size={13} />} onPress={() => d.liveUrl && openExt(d.liveUrl)} aria-label="Visit deployment" />
          ) : null}
        </XStack>
      ),
    },
  ]

  return (
    <YStack gap="$4">
      <PageHeader
        title={displayName}
        subtitle={`Platform project · ${slug}${site ? ` · ${site.framework}` : ''}`}
        actions={
          <>
            <Button size="$2" chromeless icon={<ArrowLeft size={15} />} onPress={() => router.push('/platform')}>
              All projects
            </Button>
            <Button size="$2" icon={<RefreshCw size={14} />} onPress={() => void load()}>
              Refresh
            </Button>
          </>
        }
      />

      {/* Status + cross-surface deep links (the SAME IAM project id everywhere). */}
      <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3">
        <XStack justify="space-between" items="center" gap="$3" flexWrap="wrap">
          <XStack gap="$3" items="center" flexWrap="wrap">
            <StatusTag status={site?.status || 'draft'} />
            {liveUrl ? (
              <XStack gap="$1.5" items="center">
                <Globe size={14} opacity={0.7} />
                <Text
                  fontSize="$3"
                  color="$color12"
                  style={{ cursor: 'pointer', textDecoration: 'underline' }}
                  onPress={() => openExt(liveUrl)}
                >
                  {liveUrl.replace(/^https?:\/\//, '')}
                </Text>
              </XStack>
            ) : (
              <Text fontSize="$3" color="$color10">Not deployed yet — drop a build below to publish.</Text>
            )}
          </XStack>
          <XStack gap="$2" flexWrap="wrap">
            <Button size="$2" theme="blue" icon={<Pencil size={14} />} iconAfter={<ExternalLink size={12} />} onPress={() => openExt(links.editInApp)}>
              Edit in hanzo.app
            </Button>
            <Button size="$2" icon={<MessageSquare size={14} />} iconAfter={<ExternalLink size={12} />} onPress={() => openExt(links.chatAbout)}>
              Chat in hanzo.chat
            </Button>
            {liveUrl ? (
              <Button size="$2" chromeless icon={<Globe size={14} />} iconAfter={<ExternalLink size={12} />} onPress={() => openExt(liveUrl)}>
                Visit
              </Button>
            ) : null}
          </XStack>
        </XStack>
      </Card>

      {loadErr && !site ? (
        <BackendStateCard state={classifyRead(loadErr) ?? { kind: 'error', message: asApiError(loadErr).message }} onRetry={() => void load()} hint="GET /v1/projects/:slug" />
      ) : null}

      {/* Deploy */}
      <SectionCard
        title={latest ? 'Deploy a new version' : 'Deploy your build'}
        subtitle="A zip/tar.gz of the built static site (index.html at the root), or a folder — uploaded to /v1/projects/:slug/deploy."
      >
        <DeployDropzone busy={busy} onDeploy={onDeploy} />
      </SectionCard>

      {/* Deployments + status/logs */}
      <SectionCard title="Deployments" subtitle={`${deployments.length} deploy${deployments.length === 1 ? '' : 's'} · newest first`}>
        <DataTable
          columns={deploymentColumns}
          rows={deployments}
          loading={loading}
          rowKey={(d) => d.id}
          empty="No deployments yet. Drop a build above to publish your first version."
        />
        {openDeployment ? (
          <DeploymentDetail dep={deployments.find((d) => d.id === openDeployment) ?? null} />
        ) : null}
      </SectionCard>

      {/* Domains */}
      <DomainsSection slug={slug} siteReady={!!site} domains={domains} onChanged={() => void load()} />

      {/* Configuration */}
      {site ? <ConfigSection site={site} onSaved={() => void load()} /> : null}
    </YStack>
  )
}


/** The honest "status/logs" for a static deploy: the deployment record + its message. */
function DeploymentDetail({ dep }: { dep: SiteDeployment | null }) {
  if (!dep) return null
  const fact = (k: string, v: string) => (
    <XStack gap="$2" justify="space-between">
      <Text fontSize="$2" color="$color10">{k}</Text>
      <Text fontSize="$2" color="$color12" numberOfLines={1}>{v || '—'}</Text>
    </XStack>
  )
  return (
    <Card borderWidth={1} borderColor="$borderColor" bg="$color1" p="$3" gap="$2" mt="$2">
      <XStack gap="$2" items="center"><StatusTag status={dep.status} /><Text fontSize="$3" fontWeight="700">Deployment v{dep.version}</Text></XStack>
      {fact('ID', dep.id)}
      {fact('Source', dep.source)}
      {fact('Commit', dep.commit || '—')}
      {fact('Files', String(dep.files))}
      {fact('Size', fmtBytes(dep.bytes))}
      {fact('Prefix', dep.prefix || '—')}
      {fact('Created', fmtWhen(dep.createdAt))}
      {fact('Updated', fmtWhen(dep.updatedAt))}
      {dep.message ? (
        <YStack gap="$1" mt="$1">
          <Text fontSize="$2" color="$color10">Log / message</Text>
          <Card bg="$color2" p="$2" borderWidth={1} borderColor="$borderColor">
            <Text fontSize="$2" color={dep.status === 'error' ? '$red11' : '$color11'} style={{ fontFamily: 'ui-monospace, monospace', whiteSpace: 'pre-wrap' }}>{dep.message}</Text>
          </Card>
        </YStack>
      ) : (
        <Text fontSize="$2" color="$color10" mt="$1">
          {dep.status === 'live'
            ? 'Published successfully — static uploads deploy synchronously (no build log).'
            : 'No message recorded.'}
        </Text>
      )}
    </Card>
  )
}

function DomainsSection({ slug, siteReady, domains, onChanged }: {
  slug: string
  siteReady: boolean
  domains: string[]
  onChanged: () => void
}) {
  const toast = useToast()
  const [host, setHost] = useState('')
  const [busy, setBusy] = useState(false)

  const bind = async () => {
    const h = host.trim().toLowerCase()
    if (!h) return
    setBusy(true)
    try {
      const r = await PlatformSitesApi.bindDomains(slug, [h])
      toast.success('Domain bound', `${r.bound.join(', ') || h} — point its DNS at this edge to serve.`)
      setHost('')
      onChanged()
    } catch (e) {
      toast.error('Could not bind domain', asApiError(e).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <SectionCard
      title="Custom domains"
      subtitle="Bind a domain, then point its DNS at this edge. Binding may require the platform-operator org (honest 403 otherwise)."
    >
      {domains.length ? (
        <YStack gap="$1.5">
          {domains.map((d) => (
            <XStack key={d} gap="$2" items="center" justify="space-between" py="$1.5" borderBottomWidth={1} borderColor="$borderColor">
              <XStack gap="$2" items="center"><Globe size={14} opacity={0.7} /><Text fontSize="$3" color="$color12">{d}</Text></XStack>
              <Button size="$1" chromeless icon={<ExternalLink size={13} />} onPress={() => openExt(`https://${d}/`)} aria-label="Open domain" />
            </XStack>
          ))}
        </YStack>
      ) : (
        <Text fontSize="$3" color="$color10">No custom domains yet.{siteReady ? '' : ' Deploy first, then bind a domain.'}</Text>
      )}
      <XStack gap="$2" items="flex-end" flexWrap="wrap" mt="$1">
        <YStack flex={1} minW={220}>
          <FieldText value={host} onChange={setHost} placeholder="app.example.com" disabled={busy || !siteReady} />
        </YStack>
        <PrimaryButton size="$3" icon={<Plus size={15} />} disabled={busy || !siteReady || !host.trim()} onPress={() => void bind()}>
          Bind domain
        </PrimaryButton>
      </XStack>
    </SectionCard>
  )
}

function ConfigSection({ site, onSaved }: { site: Site; onSaved: () => void }) {
  const toast = useToast()
  const [framework, setFramework] = useState(site.framework || 'static')
  const [cacheControl, setCacheControl] = useState(site.cacheControl || '')
  const [description, setDescription] = useState(site.description || '')
  const [busy, setBusy] = useState(false)
  const dirty = framework !== (site.framework || 'static') || cacheControl !== (site.cacheControl || '') || description !== (site.description || '')

  const save = async () => {
    setBusy(true)
    try {
      await PlatformSitesApi.update(site.slug, { framework, cacheControl, description })
      toast.success('Saved', 'Project configuration updated.')
      onSaved()
    } catch (e) {
      toast.error('Could not save the configuration', asApiError(e).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <SectionCard title="Configuration">
      <FieldRow label="Framework">
        <FieldSelect value={framework} onChange={setFramework} options={[...SITE_FRAMEWORKS]} disabled={busy} />
      </FieldRow>
      <FieldRow label="Cache-Control">
        <FieldText value={cacheControl} onChange={setCacheControl} placeholder="public, max-age=0, must-revalidate" disabled={busy} />
      </FieldRow>
      <FieldRow label="Description">
        <FieldTextArea value={description} onChange={setDescription} rows={2} disabled={busy} />
      </FieldRow>
      <XStack>
        <PrimaryButton size="$3" disabled={busy || !dirty} onPress={() => void save()}>
          {busy ? 'Saving…' : 'Save configuration'}
        </PrimaryButton>
      </XStack>
    </SectionCard>
  )
}
