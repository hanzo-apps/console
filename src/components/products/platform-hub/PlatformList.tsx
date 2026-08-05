'use client'

/**
 * Platform — the project HUB home. Lists the org's IAM-native projects, each with its
 * live deploy state (from the cloud site store, joined by slug === the IAM name), and
 * a one-click "New project". A project opens its detail hub (`/platform/:name`) where
 * you deploy a build, view deployments, bind domains, and deep-link to hanzo.app /
 * hanzo.chat on the ONE shared key. Honest by construction — real projects/sites only.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { ExternalLink, Globe, MessageSquare, Pencil, Plus, Rocket } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { useScope } from '~/lib/scope-context'
import { ProjectApi, type Project } from '~/lib/api/projects'
import { PlatformSitesApi, type Site } from '~/lib/api/platform-sites'
import { crossSurfaceLinks } from '~/lib/products/cross-surface'
import { checkProjectName, fmtWhen, siteSlugForProject } from './logic'
import { ErrorState, asApiError } from '~/components/ui/States'
import { useToast } from '~/components/ui/Toast'
import { DataTable, EmptyState, FieldRow, FieldText, FieldTextArea, PageHeader, PrimaryButton, StatusTag, type Column } from '@hanzo/ui/product'

const openExt = (href: string) => {
  if (typeof window !== 'undefined') window.open(href, '_blank', 'noopener')
}

export function PlatformList({
  title = 'Platform',
  subtitle = 'Create, deploy, and ship your projects — drop a build, bind a domain, and edit or chat about it on the same project across hanzo.app and hanzo.chat.',
}: {
  /** Header title/subtitle — overridable so the Platform home can render this as a
   *  "Your projects" section under its own deploy hero (no duplicate "Platform" heading). */
  title?: string
  subtitle?: string
} = {}) {
  const router = useRouter()
  const toast = useToast()
  const { projects, projectsError, loadingProjects, refreshProjects } = useScope()

  const [sites, setSites] = useState<Map<string, Site>>(new Map())
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  const loadSites = useCallback(async () => {
    try {
      const list = await PlatformSitesApi.list()
      setSites(new Map(list.map((s) => [s.slug, s])))
    } catch {
      // Sites store not reachable → projects still list; deploy state shows as "draft".
      setSites(new Map())
    }
  }, [])

  useEffect(() => {
    void loadSites()
  }, [loadSites])

  const siteFor = useCallback((p: Project): Site | undefined => sites.get(siteSlugForProject(p.name)), [sites])

  const slugPreview = useMemo(() => {
    const c = checkProjectName(name)
    return c.ok ? c.slug : ''
  }, [name])

  const reset = () => {
    setName('')
    setDescription('')
    setCreating(false)
  }

  const create = async () => {
    const check = checkProjectName(name)
    if (!check.ok) {
      toast.error('Invalid name', check.error)
      return
    }
    setBusy(true)
    try {
      await ProjectApi.create({ name: check.slug, displayName: name.trim(), description: description.trim() })
      toast.success('Project created', `“${name.trim()}” is ready to deploy.`)
      reset()
      await refreshProjects()
      router.push(`/platform/${check.slug}`) // straight into its deploy hub
    } catch (e) {
      toast.error('Could not create project', asApiError(e).message)
    } finally {
      setBusy(false)
    }
  }

  const columns: Column<Project>[] = [
    {
      key: 'name',
      header: 'Project',
      render: (p) => (
        <XStack gap="$2" items="center">
          <Rocket size={15} opacity={0.7} />
          <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
            {p.displayName || p.name}
          </Text>
        </XStack>
      ),
    },
    {
      key: 'status',
      header: 'Deploy',
      width: 110,
      render: (p) => <StatusTag status={siteFor(p)?.status || 'draft'} />,
    },
    {
      key: 'live',
      header: 'Live URL',
      render: (p) => {
        const live = siteFor(p)?.liveUrl
        return live ? (
          <XStack gap="$1.5" items="center">
            <Globe size={13} opacity={0.6} />
            <Text
              fontSize="$3"
              color="$color12"
              numberOfLines={1}
              style={{ cursor: 'pointer', textDecoration: 'underline' }}
              onPress={() => openExt(live)}
            >
              {live.replace(/^https?:\/\//, '')}
            </Text>
          </XStack>
        ) : (
          <Text fontSize="$3" color="$color10">—</Text>
        )
      },
    },
    {
      key: 'created',
      header: 'Created',
      width: 170,
      render: (p) => <Text fontSize="$3" color="$color11">{fmtWhen(p.createdTime ? Math.floor(new Date(p.createdTime).getTime() / 1000) : undefined)}</Text>,
    },
    {
      key: 'actions',
      header: '',
      width: 200,
      render: (p) => {
        const links = crossSurfaceLinks(p.name, { appUrl: config.appUrl, chatUrl: config.chatUrl })
        return (
          <XStack gap="$1" justify="flex-end">
            <Button size="$2" onPress={() => router.push(`/platform/${p.name}`)}>Open</Button>
            <Button size="$2" chromeless icon={<Pencil size={13} />} onPress={() => openExt(links.editInApp)} aria-label="Edit in hanzo.app" />
            <Button size="$2" chromeless icon={<MessageSquare size={13} />} onPress={() => openExt(links.chatAbout)} aria-label="Chat in hanzo.chat" />
          </XStack>
        )
      },
    },
  ]

  return (
    <YStack gap="$4">
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          !projectsError ? (
            <Button icon={<Plus size={16} />} onPress={() => setCreating((v) => !v)}>
              New project
            </Button>
          ) : undefined
        }
      />

      {creating && !projectsError ? (
        <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3" maxWidth={640}>
          <Text fontSize="$5" fontWeight="700">New project</Text>
          <FieldRow label="Name">
            <FieldText value={name} onChange={setName} placeholder="My App" disabled={busy} />
          </FieldRow>
          {slugPreview ? (
            <Text fontSize="$2" color="$color10">
              id / deploy slug: <Text fontWeight="700" color="$color12">{slugPreview}</Text> — the shared key across console, hanzo.app, hanzo.chat.
            </Text>
          ) : null}
          <FieldRow label="Description">
            <FieldTextArea value={description} onChange={setDescription} rows={2} disabled={busy} />
          </FieldRow>
          <XStack gap="$2">
            <PrimaryButton disabled={busy} onPress={() => void create()}>
              {busy ? 'Creating…' : 'Create project'}
            </PrimaryButton>
            <Button chromeless disabled={busy} onPress={reset}>Cancel</Button>
          </XStack>
        </Card>
      ) : null}

      {projectsError ? (
        <ErrorState
          err={projectsError}
          onRetry={() => void refreshProjects()}
          copy={{
            notFound:
              'The projects service is not routed on this deployment yet. Create a project once it is provisioned.',
          }}
        />
      ) : projects.length === 0 && !loadingProjects ? (
        <EmptyState
          icon={Rocket}
          title="Deploy your first project"
          description="A project is your org-scoped unit to build, deploy, and ship — drop a static build, bind a domain, and open it in hanzo.app or hanzo.chat."
          bullets={[
            'Create a project (it becomes the shared key across every surface).',
            'Drag-and-drop a .zip / .tar.gz build (or a folder) to deploy.',
            'Bind a custom domain and edit or chat about it anywhere.',
          ]}
          primary={{ label: 'New project', icon: <Plus size={15} />, onPress: () => setCreating(true) }}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={projects}
          loading={loadingProjects}
          rowKey={(p) => p.name}
          onRowPress={(p) => router.push(`/platform/${p.name}`)}
          empty="No projects yet. Create one to deploy your first build."
        />
      )}
    </YStack>
  )
}
