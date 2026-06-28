'use client'

/**
 * Generic managed-resource admin module — ONE factory, every data/storage kind.
 *
 * `resourceModule({ kind, productLabel, connectionHint })` returns a route
 * component that drives the provisioning contract for a single kind, with a
 * list+detail surface (GCP-style) selected by the `name` route param — list at
 * `/<kind>`, instance detail at `/<kind>/<name>`:
 *   - GET  /v1/<kind>          -> a table of resources (name, status, endpoint, created)
 *   - POST /v1/<kind> {name}   -> create; the 201 carries `connectionString` and a
 *     `password` returned ONCE — surfaced immediately in a copyable reveal with a
 *     "store this now" warning, never re-fetched.
 *   - GET  /v1/<kind>/<name>   -> one resource (no secret) — the detail overview.
 *   - DELETE /v1/<kind>/<name> -> delete (with confirm).
 *
 * Resources are provisioned on a shared multi-tenant backend (serverless model:
 * create-by-name → connection string), not sized instances — so there are no
 * tier/size/region knobs to surface; the rate card lives in the Plans module.
 *
 * Tenancy is server-side (the gateway injects X-Org-Id from the session), so the
 * browser sends cookie credentials only. Built entirely on the shared GUI
 * primitives + DataTable/PageHeader/Field, so all kinds look and behave the same.
 *
 * `resourceRoutes(opts)` returns the index + `:name` routes bound to ONE component
 * instance — registry entries declare a managed kind with a single call.
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Plus, Trash, RefreshCw, Copy, Check, ArrowLeft, ChevronRight } from '@hanzogui/lucide-icons-2'

import {
  ApiError,
  ProvisioningApi,
  type Resource,
  type ResourceCreated,
  type ResourceKind,
} from '~/lib/api'
import type { ProductRoute } from '~/lib/products/registry'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { FieldRow, FieldText } from '~/components/ui/Field'
import { StatusTag } from '~/components/ui/StatusTag'
import { useToast } from '~/components/ui/Toast'
import { slugError } from '~/lib/slug'

const fmtDate = (v?: string): string => {
  if (!v) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString()
}

/** A monospace-ish value box with copy, and optional masked reveal for secrets. */
function CopyField({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [shown, setShown] = useState(!secret)
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — value is visible to select manually */
    }
  }

  const masked = '•'.repeat(Math.min(value.length, 32))
  return (
    <YStack gap="$1.5">
      <Text fontSize="$2" fontWeight="700" color="$color11">
        {label}
      </Text>
      <XStack gap="$2" items="center">
        <Text
          flex={1}
          fontSize="$3"
          px="$3"
          py="$2"
          bg="$color2"
          rounded="$3"
          borderWidth={1}
          borderColor="$borderColor"
          numberOfLines={1}
        >
          {shown ? value : masked}
        </Text>
        {secret ? (
          <Button size="$2" onPress={() => setShown((v) => !v)}>
            {shown ? 'Hide' : 'Show'}
          </Button>
        ) : null}
        <Button
          size="$2"
          icon={copied ? <Check size={14} /> : <Copy size={14} />}
          onPress={() => void copy()}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </XStack>
    </YStack>
  )
}

export type ResourceModuleOpts = {
  /** Provisioning wire kind, e.g. 'sql'. */
  kind: ResourceKind
  /** Product display name, e.g. 'Hanzo SQL'. */
  productLabel: string
  /** One-line hint on how to use the connection string (shown under the reveal). */
  connectionHint?: string
}

/** A single label/value row in the detail overview. */
function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <XStack justify="space-between" items="center" py="$2" borderBottomWidth={1} borderColor="$borderColor">
      <Text fontSize="$3" color="$color11" fontWeight="600">
        {label}
      </Text>
      <Text fontSize="$3" color="$color12" numberOfLines={1}>
        {value}
      </Text>
    </XStack>
  )
}

/**
 * Instance detail — the GCP-style "manage one resource" surface. Loads a single
 * resource (no secret; the connection string/password are shown once at create),
 * shows its overview + connection guidance, and a danger zone to delete.
 */
function ResourceDetailScreen({
  opts,
  name,
  onBack,
}: {
  opts: ResourceModuleOpts
  name: string
  onBack: () => void
}) {
  const { kind, productLabel, connectionHint } = opts
  const toast = useToast()
  const [resource, setResource] = useState<Resource | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await ProvisioningApi.get(kind, name)
      setResource(data)
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : `Failed to load "${name}"`)
    } finally {
      setLoading(false)
    }
  }, [name])

  useEffect(() => {
    void load()
  }, [load])

  const onDelete = async () => {
    if (typeof window !== 'undefined' && !window.confirm(`Delete "${name}"? This cannot be undone.`))
      return
    try {
      await ProvisioningApi.remove(kind, name)
      toast.success(`Deleted ${name}`)
      onBack()
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : `Failed to delete "${name}"`
      setError(msg)
      toast.error(`Could not delete ${name}`, msg)
    }
  }

  return (
    <>
      <PageHeader
        title={name}
        subtitle={`${productLabel} instance`}
        actions={
          <XStack gap="$2">
            <Button icon={<ArrowLeft size={16} />} onPress={onBack}>
              Back
            </Button>
            <Button icon={<RefreshCw size={16} />} onPress={() => void load()}>
              Refresh
            </Button>
          </XStack>
        }
      />

      {error ? <Text color="$color12">{error}</Text> : null}

      {loading && !resource ? (
        <Text color="$color11">Loading…</Text>
      ) : resource ? (
        <>
          <Card p="$4" gap="$1" borderWidth={1} borderColor="$borderColor">
            <Text fontSize="$5" fontWeight="700" mb="$2">
              Overview
            </Text>
            <DetailRow label="Status" value={<StatusTag status={resource.status} />} />
            <DetailRow label="Kind" value={resource.kind || kind} />
            <DetailRow
              label="Endpoint"
              value={resource.host ? `${resource.host}:${resource.port}` : '—'}
            />
            {resource.username ? <DetailRow label="Username" value={resource.username} /> : null}
            {resource.database ? <DetailRow label="Database" value={resource.database} /> : null}
            {resource.createdAt ? <DetailRow label="Created" value={fmtDate(resource.createdAt)} /> : null}
          </Card>

          <Card p="$4" gap="$2.5" borderWidth={1} borderColor="$borderColor">
            <Text fontSize="$5" fontWeight="700">
              Connection
            </Text>
            {resource.host ? <CopyField label="Host" value={`${resource.host}:${resource.port}`} /> : null}
            <Text fontSize="$2" color="$color10">
              {connectionHint
                ? `${connectionHint} `
                : ''}
              The password and full connection string are shown only once, at creation. If you no
              longer have them, rotate the credential from your client or recreate the resource.
            </Text>
          </Card>

          <Card p="$4" gap="$2.5" borderWidth={1} borderColor="$color7">
            <Text fontSize="$5" fontWeight="700">
              Danger zone
            </Text>
            <Text fontSize="$3" color="$color11">
              Deleting an instance is permanent and removes all its data.
            </Text>
            <XStack>
              <Button self="flex-start" theme="red" icon={<Trash size={16} />} onPress={() => void onDelete()}>
                Delete {name}
              </Button>
            </XStack>
          </Card>
        </>
      ) : null}
    </>
  )
}

/** List + create surface — the index view for a managed kind. */
function ResourceListScreen({
  opts,
  onOpen,
}: {
  opts: ResourceModuleOpts
  onOpen: (r: Resource) => void
}) {
  const { kind, productLabel, connectionHint } = opts
  const toast = useToast()
  const [rows, setRows] = useState<Resource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<ResourceCreated | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await ProvisioningApi.list(kind)
      setRows(data ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : `Failed to load ${productLabel}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const nameErr = name ? slugError(name) : null

  const onCreate = async () => {
    const err = slugError(name)
    if (err) {
      setError(err)
      return
    }
    setCreating(true)
    setError(null)
    try {
      const res = await ProvisioningApi.create(kind, name)
      setCreated(res)
      toast.success(`Created ${res.name}`, 'Save the credentials shown — they appear only once.')
      setName('')
      await load()
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : `Failed to create ${productLabel}`
      setError(msg)
      toast.error(`Could not create ${productLabel}`, msg)
    } finally {
      setCreating(false)
    }
  }

  const onDelete = async (r: Resource) => {
    if (typeof window !== 'undefined' && !window.confirm(`Delete "${r.name}"? This cannot be undone.`))
      return
    try {
      await ProvisioningApi.remove(kind, r.name)
      setRows((rs) => rs.filter((x) => x.name !== r.name))
      toast.success(`Deleted ${r.name}`)
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : `Failed to delete "${r.name}"`
      setError(msg)
      toast.error(`Could not delete ${r.name}`, msg)
    }
  }

  const columns: Column<Resource>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (r) => (
        <Button chromeless px="$0" onPress={() => onOpen(r)}>
          <Text fontSize="$3" fontWeight="600" color="$color12">
            {r.name}
          </Text>
        </Button>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 130,
      render: (r) => <StatusTag status={r.status} />,
    },
    {
      key: 'endpoint',
      header: 'Endpoint',
      width: 240,
      render: (r) => (
        <Text fontSize="$3" color="$color11" numberOfLines={1}>
          {r.host ? `${r.host}:${r.port}` : '—'}
        </Text>
      ),
    },
    {
      key: 'createdAt',
      header: 'Created',
      width: 190,
      render: (r) => (
        <Text fontSize="$3" color="$color11">
          {fmtDate(r.createdAt)}
        </Text>
      ),
    },
    {
      key: 'action',
      header: '',
      width: 150,
      render: (r) => (
        <XStack gap="$2" justify="flex-end" flex={1}>
          <Button size="$2" iconAfter={<ChevronRight size={14} />} onPress={() => onOpen(r)}>
            Manage
          </Button>
          <Button size="$2" icon={<Trash size={14} />} onPress={() => void onDelete(r)} />
        </XStack>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title={productLabel}
        subtitle={`Provision and manage ${productLabel} instances.`}
        actions={
          <Button icon={<RefreshCw size={16} />} onPress={() => void load()}>
            Refresh
          </Button>
        }
      />

      {error ? <Text color="$color12">{error}</Text> : null}

      {created ? (
        <Card p="$4" gap="$3.5" borderWidth={1} borderColor="$color7" bg="$color2">
          <YStack gap="$1">
            <Text fontSize="$5" fontWeight="800">
              {created.name} created — save your credentials now
            </Text>
            <Text fontSize="$3" color="$color12">
              The password is shown ONCE and cannot be retrieved later. Copy it somewhere safe
              before you dismiss this panel.
            </Text>
          </YStack>

          <CopyField label="Connection string" value={created.connectionString} />
          {created.password ? <CopyField label="Password" value={created.password} secret /> : null}

          {connectionHint ? (
            <Text fontSize="$2" color="$color10">
              {connectionHint}
            </Text>
          ) : null}

          <XStack>
            <Button self="flex-start" onPress={() => setCreated(null)}>
              I&apos;ve saved it — dismiss
            </Button>
          </XStack>
        </Card>
      ) : null}

      <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
        <Text fontSize="$5" fontWeight="700">
          Create {productLabel}
        </Text>
        <FieldRow label="Name">
          <YStack gap="$1.5" flex={1}>
            <FieldText value={name} onChange={setName} placeholder="my-resource" />
            <Text fontSize="$2" color={nameErr ? '$color12' : '$color10'}>
              {nameErr ?? 'Lowercase letters, numbers and hyphens. 2–40 chars.'}
            </Text>
          </YStack>
        </FieldRow>
        <XStack>
          <Button
            theme="light"
            icon={<Plus size={16} />}
            disabled={creating || !name || !!nameErr}
            onPress={() => void onCreate()}
          >
            {creating ? 'Creating…' : 'Create'}
          </Button>
        </XStack>
      </Card>

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        rowKey={(r) => r.id || r.name}
        empty={`No ${productLabel} instances yet. Create one above.`}
      />
    </>
  )
}

/**
 * Build a resource admin module bound to one provisioning kind. The returned
 * component is a registry route component (`{ params }`): list at the index,
 * instance detail when a `name` param is present (mirrors ProvidersModule).
 */
export function resourceModule(opts: ResourceModuleOpts) {
  return function ResourceModuleScreen({ params }: { params: Record<string, string> }) {
    const router = useRouter()
    const name = params.name
    const base = `/${opts.kind}`
    if (name) {
      return (
        <ResourceDetailScreen
          opts={opts}
          name={decodeURIComponent(name)}
          onBack={() => router.push(base)}
        />
      )
    }
    return (
      <ResourceListScreen
        opts={opts}
        onOpen={(r) => router.push(`${base}/${encodeURIComponent(r.name)}`)}
      />
    )
  }
}

/**
 * The index + `:name` routes for a managed kind, bound to ONE component instance
 * — a registry entry declares a data product with a single call.
 */
export function resourceRoutes(opts: ResourceModuleOpts): ProductRoute[] {
  const component = resourceModule(opts)
  return [
    { path: '', component },
    { path: ':name', component },
  ]
}
