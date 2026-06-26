'use client'

/**
 * Generic managed-resource admin module — ONE factory, every data/storage kind.
 *
 * `resourceModule({ kind, productLabel, connectionHint })` returns a route
 * component that drives the provisioning contract for a single kind:
 *   - GET  /v1/<kind>        -> a table of resources (name, status, endpoint, created)
 *   - POST /v1/<kind> {name} -> create; the 201 carries `connectionString` and a
 *     `password` returned ONCE — surfaced immediately in a copyable reveal with a
 *     "store this now" warning, never re-fetched.
 *   - DELETE /v1/<kind>/<name> -> delete (with confirm).
 *
 * Tenancy is server-side (the gateway injects X-Org-Id from the session), so the
 * browser sends cookie credentials only. Built entirely on the shared GUI
 * primitives + DataTable/PageHeader/Field, so all kinds look and behave the same.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Plus, Trash, RefreshCw, Copy, Check } from '@hanzogui/lucide-icons-2'

import {
  ApiError,
  ProvisioningApi,
  type Resource,
  type ResourceCreated,
  type ResourceKind,
} from '~/lib/api'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { FieldRow, FieldText } from '~/components/ui/Field'
import { StatusTag } from '~/components/ui/StatusTag'
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
          theme={copied ? 'green' : undefined}
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

/**
 * Build a resource admin module bound to one provisioning kind. The returned
 * component is a registry route component (`{ params }`), though it renders a
 * single screen and ignores params.
 */
export function resourceModule(opts: ResourceModuleOpts) {
  const { kind, productLabel, connectionHint } = opts

  return function ResourceModuleScreen(_props: { params: Record<string, string> }) {
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
        setName('')
        await load()
      } catch (e) {
        setError(e instanceof ApiError ? e.message : `Failed to create ${productLabel}`)
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
      } catch (e) {
        setError(e instanceof ApiError ? e.message : `Failed to delete "${r.name}"`)
      }
    }

    const columns: Column<Resource>[] = [
      { key: 'name', header: 'Name', render: (r) => <Text fontSize="$3">{r.name}</Text> },
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
        width: 110,
        render: (r) => (
          <XStack gap="$2" justify="flex-end" flex={1}>
            <Button size="$2" theme="red" icon={<Trash size={14} />} onPress={() => void onDelete(r)} />
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

        {error ? <Text color="$red10">{error}</Text> : null}

        {created ? (
          <Card p="$4" gap="$3.5" borderWidth={1} borderColor="$yellow7" bg="$yellow2">
            <YStack gap="$1">
              <Text fontSize="$5" fontWeight="800">
                {created.name} created — save your credentials now
              </Text>
              <Text fontSize="$3" color="$yellow11">
                The password is shown ONCE and cannot be retrieved later. Copy it somewhere safe
                before you dismiss this panel.
              </Text>
            </YStack>

            <CopyField label="Connection string" value={created.connectionString} />
            {created.password ? (
              <CopyField label="Password" value={created.password} secret />
            ) : null}

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
              <Text fontSize="$2" color={nameErr ? '$red10' : '$color10'}>
                {nameErr ?? 'Lowercase letters, numbers and hyphens. 2–40 chars.'}
              </Text>
            </YStack>
          </FieldRow>
          <XStack>
            <Button
              theme="blue"
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
}
