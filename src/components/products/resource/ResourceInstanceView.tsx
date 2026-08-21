'use client'

/**
 * Single-instance console — the "manage one resource" surface (GCP-style),
 * reached at `/<kind>/<name>`. Loads one resource (no secret; the connection
 * string/password are shown once at create) and presents it as a tabbed console:
 *   Overview  the real facts — status, endpoint, username/database, created
 *   Access    connection guidance + a connect snippet bound to THIS endpoint
 *   Settings  configuration facts + a real, confirmed delete (danger zone)
 *
 * Every field is the real `GET /v1/provisioning/<kind>/<name>` response or an honest "—".
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowLeft, BookOpen, ExternalLink, Github, KeyRound, LayoutDashboard, RefreshCw, Settings2, Trash } from '@hanzogui/lucide-icons-2'

import { ApiError, ProvisioningApi, type Resource, type ResourceKind } from '~/lib/api'
import { currentOrg } from '~/lib/org-scope'
import { useToast } from '~/components/ui/Toast'

import { connectSnippet, docsUrl, endpoint, provisionSnippet, repoUrl, specFor } from './logic'
import { DetailRow, openHref, SectionCard, SnippetBlock, TabBar, type TabDef } from './parts'
import { BackendStateCard, PageHeader, StatusTag, classifyBackend, type BackendState } from '@hanzo/ui/product'

const fmtDate = (v?: string): string => {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString()
}

export type ResourceInstanceProps = {
  kind: ResourceKind
  productLabel: string
  connectionHint?: string
  name: string
  onBack: () => void
}

export function ResourceInstanceView({ kind, productLabel, connectionHint, name, onBack }: ResourceInstanceProps) {
  const spec = specFor(kind)
  const toast = useToast()
  const [resource, setResource] = useState<Resource | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<BackendState | null>(null)
  const [tab, setTab] = useState<string>('overview')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setResource(await ProvisioningApi.get(kind, name))
    } catch (e) {
      setError(classifyBackend(e))
    } finally {
      setLoading(false)
    }
  }, [kind, name])

  useEffect(() => {
    void load()
  }, [load])

  const onDelete = async () => {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(`Delete the ${spec.instanceNoun} "${name}"? This removes it and everything in it, permanently.`)
    )
      return
    try {
      await ProvisioningApi.remove(kind, name)
      toast.success(`Deleted ${name}`)
      onBack()
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : `Nothing was removed — the ${spec.instanceNoun} is still there. Try again.`
      toast.error(`Could not delete ${name}`, msg)
    }
  }

  const hint = connectionHint ?? spec.connectHint
  const host = resource && resource.host ? endpoint(resource) : `${name}.${kind}.hanzo.ai`
  const tabs: TabDef[] = [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard size={15} /> },
    { id: 'access', label: 'Access', icon: <KeyRound size={15} /> },
    { id: 'settings', label: 'Settings', icon: <Settings2 size={15} /> },
  ]

  return (
    <YStack gap="$4">
      <PageHeader
        title={name}
        subtitle={`${productLabel} ${spec.instanceNoun}`}
        actions={
          <XStack gap="$2">
            <Button size="$2" icon={<ArrowLeft size={15} />} onPress={onBack}>
              Back
            </Button>
            <Button size="$2" icon={<RefreshCw size={15} />} onPress={() => void load()}>
              Refresh
            </Button>
          </XStack>
        }
      />

      {loading && !resource ? (
        <XStack p="$6" justify="center">
          <Spinner size="large" color="$color11" />
        </XStack>
      ) : error ? (
        <BackendStateCard state={error} onRetry={() => void load()} hint={`endpoint · GET /v1/provisioning/${kind}/${name}`} />
      ) : resource ? (
        <>
          <TabBar tabs={tabs} active={tab} onSelect={setTab} />

          {tab === 'overview' ? (
            <SectionCard title="Overview">
              <DetailRow label="Status" value={<StatusTag status={resource.status} />} />
              <DetailRow label="Kind" value={resource.kind || kind} />
              <DetailRow label="Endpoint" value={endpoint(resource)} />
              {resource.username ? <DetailRow label="Username" value={resource.username} /> : null}
              {resource.database ? <DetailRow label="Database" value={resource.database} /> : null}
              <DetailRow label="Created" value={fmtDate(resource.createdAt)} />
            </SectionCard>
          ) : null}

          {tab === 'access' ? (
            <YStack gap="$4">
              <SectionCard title="Connection">
                <Text fontSize="$3" color="$color11">
                  {hint}
                </Text>
                <Text fontSize="$2" color="$color10">
                  The password and full connection string are shown only once, at creation. If you no longer have them,
                  rotate the credential from your client or recreate the {spec.instanceNoun}.
                </Text>
              </SectionCard>
              <SectionCard title="Quick start">
                <XStack flexWrap="wrap" gap="$4">
                  <YStack flex={1} minW={300}>
                    <SnippetBlock snippet={connectSnippet(spec, host)} />
                  </YStack>
                  <YStack flex={1} minW={300}>
                    <SnippetBlock snippet={provisionSnippet(kind, name)} />
                  </YStack>
                </XStack>
              </SectionCard>
            </YStack>
          ) : null}

          {tab === 'settings' ? (
            <YStack gap="$4">
              <SectionCard title="Configuration">
                <DetailRow label="Organization" value={currentOrg()} />
                <DetailRow
                  label="Source"
                  value={
                    <Button size="$1" chromeless icon={<Github size={13} />} iconAfter={<ExternalLink size={12} />} onPress={() => openHref(repoUrl(spec))}>
                      {spec.repo}
                    </Button>
                  }
                />
                <DetailRow
                  label="Documentation"
                  value={
                    <Button size="$1" chromeless icon={<BookOpen size={13} />} iconAfter={<ExternalLink size={12} />} onPress={() => openHref(docsUrl(kind))}>
                      docs.hanzo.ai/{kind}
                    </Button>
                  }
                />
              </SectionCard>
              <SectionCard title="Danger zone">
                <Text fontSize="$3" color="$color11">
                  Deleting this {spec.instanceNoun} is permanent and removes all of its data.
                </Text>
                <XStack>
                  <Button self="flex-start" theme="red" icon={<Trash size={16} />} onPress={() => void onDelete()}>
                    Delete {name}
                  </Button>
                </XStack>
              </SectionCard>
            </YStack>
          ) : null}
        </>
      ) : null}
    </YStack>
  )
}
