'use client'

/**
 * Storage — the "Hanzo S3" product surface (S3 file manager). A real
 * file manager over the org-scoped `/v1/s3` control plane in the unified cloud
 * binary (`hanzoai/cloud` clients/s3): the browser calls the same-origin `/v1`
 * user-bearer proxy, the server scopes every op to the caller's own org, and this
 * module renders buckets + objects with folder navigation, upload, download and
 * delete. No external s3.hanzo.ai UI — one console, one backend.
 *
 * Two panes composed here (no external state): a bucket list (create/delete) and,
 * once a bucket is selected, an object browser with breadcrumb folder navigation.
 * Uploads/downloads use PRESIGNED URLs minted by the backend — the bytes go
 * DIRECTLY to S3, never through the proxy (which would corrupt binary), and the
 * admin credential never reaches the browser. Honest states throughout: loading,
 * empty (real first-run onboarding), and `BackendStateCard` for 503/404/403 —
 * never a fabricated bucket or object.
 *
 * Style props use the @hanzo/gui v5 shorthand set (bg/p/px/py/gap/rounded/items/
 * self/…), matching every existing module.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import {
  ChevronRight,
  Download,
  FileText,
  Folder,
  HardDrive,
  Home,
  Plus,
  Trash2,
  Upload,
} from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import {
  StorageApi,
  uploadTo,
  joinKey,
  type Bucket,
  type S3Object,
} from '~/lib/api/storage'
import { SlideOver } from '~/components/ui/SlideOver'
import { useToast } from '~/components/ui/Toast'
import { BackendStateCard, DataTable, EmptyState, FieldRow, FieldText, PageHeader, PrimaryButton, classifyRead, type BackendState, type Column } from '@hanzo/ui/product'

/** Human-readable byte size (folders and unknowns render "—"). */
function fmtSize(o: S3Object): string {
  if (o.isDir || o.size === undefined) return '—'
  const b = o.size
  if (b < 1024) return `${b} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = b / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

/** Unix-seconds → short local date; 0/undefined → "—". */
function fmtTime(sec?: number): string {
  if (!sec) return '—'
  return new Date(sec * 1000).toLocaleString()
}

/** The bucket-name display for a folder row is the segment before the trailing "/". */
function folderLabel(key: string): string {
  return key.replace(/\/$/, '')
}

export function StorageModule() {
  const [bucket, setBucket] = useState<string | null>(null)
  return bucket ? (
    <ObjectBrowser bucket={bucket} onBack={() => setBucket(null)} />
  ) : (
    <BucketList onOpen={setBucket} />
  )
}

// ── Bucket list ───────────────────────────────────────────────────────────────

function BucketList({ onOpen }: { onOpen: (bucket: string) => void }) {
  const toast = useToast()
  const [buckets, setBuckets] = useState<Bucket[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<BackendState | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setBuckets(await StorageApi.buckets())
      setError(null)
    } catch (e) {
      setBuckets([])
      // A read is never credit-gated — a 402 here means "no buckets yet", shown as
      // the honest first-run empty state (not an "add credits" wall).
      setError(classifyRead(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const create = useCallback(async () => {
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    try {
      await StorageApi.createBucket(name)
      toast.success('Bucket created', name)
      setCreating(false)
      setNewName('')
      await reload()
    } catch (e) {
      toast.error('Could not create bucket', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [newName, reload, toast])

  const remove = useCallback(
    async (name: string) => {
      if (
        typeof window !== 'undefined' &&
        !window.confirm(`Delete bucket "${name}"? It has to be empty first, and once it is gone it cannot be brought back.`)
      )
        return
      try {
        await StorageApi.deleteBucket(name)
        toast.success('Bucket deleted', name)
        await reload()
      } catch (e) {
        toast.error('Could not delete bucket', e instanceof Error ? e.message : String(e))
      }
    },
    [reload, toast],
  )

  const columns: Column<Bucket>[] = [
    {
      key: 'name',
      header: 'Bucket',
      render: (b) => (
        <XStack gap="$2" items="center">
          <HardDrive size={15} color="$color10" />
          <Text fontSize="$3" fontWeight="600" numberOfLines={1}>
            {b.name}
          </Text>
        </XStack>
      ),
    },
    { key: 'createdAt', header: 'Created', width: 200, render: (b) => <MonoMuted>{fmtTime(b.createdAt)}</MonoMuted> },
    {
      key: 'actions',
      header: '',
      width: 100,
      align: 'right',
      render: (b) => (
        <XStack gap="$1" items="center" justify="flex-end">
          <Button
            size="$2"
            chromeless
            icon={<Trash2 size={14} />}
            onPress={(e) => {
              e.stopPropagation?.()
              void remove(b.name)
            }}
          />
        </XStack>
      ),
    },
  ]

  return (
    <YStack gap="$4">
      <PageHeader
        title="S3"
        subtitle="Buckets and objects over the S3 API, scoped to your organization."
        actions={
          <PrimaryButton icon={<Plus size={15} />} onPress={() => setCreating(true)}>
            New bucket
          </PrimaryButton>
        }
      />

      {error ? (
        <BackendStateCard
          state={error}
          onRetry={reload}
          hint="endpoint · GET /v1/s3/buckets"
        />
      ) : !loading && buckets.length === 0 ? (
        <EmptyState
          icon={HardDrive}
          title="Create your first bucket"
          description="Store and serve files over the S3 API. A bucket is private to your organization until you say otherwise."
          bullets={[
            'Upload and download objects right here in the console.',
            'Use the same bucket as an S3 endpoint from your app with your access key.',
          ]}
          primary={{ label: 'New bucket', icon: <Plus size={15} />, onPress: () => setCreating(true) }}
          secondary={{ label: 'Docs', href: `${config.docsUrl}/docs/storage` }}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={buckets}
          loading={loading}
          rowKey={(b) => b.name}
          onRowPress={(b) => onOpen(b.name)}
          empty="No buckets yet."
        />
      )}

      <SlideOver open={creating} onClose={() => setCreating(false)} title="New bucket" icon={HardDrive}>
        <YStack gap="$4" p="$4">
          <FieldRow label="Bucket name">
            <FieldText
              value={newName}
              onChange={setNewName}
              placeholder="my-bucket"
              disabled={busy}
            />
          </FieldRow>
          <Text fontSize="$2" color="$color10">
            Lowercase letters, numbers and hyphens; 1–40 characters. The name is unique within your organization.
          </Text>
          <XStack gap="$2" justify="flex-end">
            <Button chromeless onPress={() => setCreating(false)} disabled={busy}>
              Cancel
            </Button>
            <PrimaryButton onPress={create} disabled={busy || !newName.trim()}>
              {busy ? 'Creating…' : 'Create bucket'}
            </PrimaryButton>
          </XStack>
        </YStack>
      </SlideOver>
    </YStack>
  )
}

// ── Object browser ─────────────────────────────────────────────────────────────

function ObjectBrowser({ bucket, onBack }: { bucket: string; onBack: () => void }) {
  const toast = useToast()
  const [prefix, setPrefix] = useState('') // current folder path, "" = root
  const [objects, setObjects] = useState<S3Object[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<BackendState | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef<HTMLInputElement | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setObjects(await StorageApi.objects(bucket, prefix))
      setError(null)
    } catch (e) {
      setObjects([])
      // Listing objects is a read — a 402 is "empty", not a paywall.
      setError(classifyRead(e))
    } finally {
      setLoading(false)
    }
  }, [bucket, prefix])

  useEffect(() => {
    void reload()
  }, [reload])

  // Breadcrumb segments derived from the current prefix.
  const segments = prefix.split('/').filter(Boolean)

  const openFolder = useCallback(
    (obj: S3Object) => {
      if (!obj.isDir) return
      // obj.key is relative to the current prefix and ends with "/".
      setPrefix((p) => `${p}${obj.key}`)
    },
    [],
  )

  const goToSegment = useCallback((depth: number) => {
    setPrefix((p) => {
      const segs = p.split('/').filter(Boolean).slice(0, depth)
      return segs.length ? segs.join('/') + '/' : ''
    })
  }, [])

  const download = useCallback(
    async (obj: S3Object) => {
      try {
        const p = await StorageApi.presignDownload(bucket, joinKey(prefix, obj.key))
        if (p?.url && typeof window !== 'undefined') window.open(p.url, '_blank', 'noopener')
        else toast.error('Download unavailable', 'The storage backend has no public endpoint configured.')
      } catch (e) {
        toast.error('Could not download the object', e instanceof Error ? e.message : String(e))
      }
    },
    [bucket, prefix, toast],
  )

  const remove = useCallback(
    async (obj: S3Object) => {
      const full = joinKey(prefix, obj.key)
      if (
        typeof window !== 'undefined' &&
        !window.confirm(`Delete the object "${full}"? It is removed from bucket "${bucket}" and cannot be recovered.`)
      )
        return
      try {
        await StorageApi.deleteObject(bucket, full)
        toast.success('Object deleted', full)
        await reload()
      } catch (e) {
        toast.error('Could not delete the object', e instanceof Error ? e.message : String(e))
      }
    },
    [bucket, prefix, reload, toast],
  )

  const onPickFile = useCallback(
    async (file: File) => {
      setUploading(true)
      try {
        const key = joinKey(prefix, file.name)
        const p = await StorageApi.presignUpload(bucket, key)
        if (!p?.url) {
          toast.error('Upload unavailable', 'The storage backend has no public endpoint configured.')
          return
        }
        await uploadTo(p.url, file)
        toast.success('Uploaded', file.name)
        await reload()
      } catch (e) {
        toast.error('Upload failed', e instanceof Error ? e.message : String(e))
      } finally {
        setUploading(false)
      }
    },
    [bucket, prefix, reload, toast],
  )

  const columns: Column<S3Object>[] = [
    {
      key: 'key',
      header: 'Name',
      render: (o) =>
        o.isDir ? (
          <XStack gap="$2" items="center">
            <Folder size={15} color="$color11" />
            <Text fontSize="$3" fontWeight="600" numberOfLines={1}>
              {folderLabel(o.key)}
            </Text>
          </XStack>
        ) : (
          <XStack gap="$2" items="center">
            <FileText size={15} color="$color10" />
            <Text fontSize="$3" numberOfLines={1}>
              {o.key}
            </Text>
          </XStack>
        ),
    },
    { key: 'size', header: 'Size', width: 110, align: 'right', render: (o) => <MonoMuted>{fmtSize(o)}</MonoMuted> },
    { key: 'lastModified', header: 'Modified', width: 190, render: (o) => <MonoMuted>{fmtTime(o.lastModified)}</MonoMuted> },
    {
      key: 'actions',
      header: '',
      width: 110,
      align: 'right',
      render: (o) =>
        o.isDir ? null : (
          <XStack gap="$1" items="center" justify="flex-end">
            <Button
              size="$2"
              chromeless
              icon={<Download size={14} />}
              onPress={(e) => {
                e.stopPropagation?.()
                void download(o)
              }}
            />
            <Button
              size="$2"
              chromeless
              icon={<Trash2 size={14} />}
              onPress={(e) => {
                e.stopPropagation?.()
                void remove(o)
              }}
            />
          </XStack>
        ),
    },
  ]

  return (
    <YStack gap="$4">
      <PageHeader
        title={bucket}
        subtitle="S3 object browser"
        actions={
          <XStack gap="$2" items="center">
            <Button chromeless onPress={onBack}>
              All buckets
            </Button>
            <PrimaryButton
              icon={uploading ? undefined : <Upload size={15} />}
              disabled={uploading}
              onPress={() => fileInput.current?.click()}
            >
              {uploading ? 'Uploading…' : 'Upload'}
            </PrimaryButton>
          </XStack>
        }
      />

      {/* Hidden file picker — drives the presigned direct-to-S3 upload. */}
      <input
        ref={fileInput}
        type="file"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void onPickFile(f)
          e.target.value = '' // allow re-picking the same file
        }}
      />

      {/* Breadcrumb */}
      <XStack gap="$1.5" items="center" flexWrap="wrap">
        <Button size="$2" chromeless icon={<Home size={14} />} onPress={() => goToSegment(0)}>
          {bucket}
        </Button>
        {segments.map((seg, i) => (
          <XStack key={`${seg}-${i}`} gap="$1.5" items="center">
            <ChevronRight size={13} color="$color9" />
            <Button size="$2" chromeless onPress={() => goToSegment(i + 1)}>
              {seg}
            </Button>
          </XStack>
        ))}
        {uploading ? <Spinner size="small" color="$color10" /> : null}
      </XStack>

      {error ? (
        <BackendStateCard state={error} onRetry={reload} hint="endpoint · GET /v1/s3/buckets/:bucket/objects" />
      ) : !loading && objects.length === 0 ? (
        <EmptyState
          icon={Upload}
          title="This folder is empty"
          description="Upload a file to get started. Objects you add appear here with size and modified time."
          primary={{ label: 'Upload a file', icon: <Upload size={15} />, onPress: () => fileInput.current?.click() }}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={objects}
          loading={loading}
          rowKey={(o) => o.key}
          onRowPress={(o) => (o.isDir ? openFolder(o) : undefined)}
          empty="No objects."
        />
      )}
    </YStack>
  )
}

// ── small shared bits ──────────────────────────────────────────────────────────

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <Text fontSize="$3" color="$color11" numberOfLines={1}>
      {children}
    </Text>
  )
}

/** Muted, monospaced, tabular — for timestamps and byte sizes (data, not prose). */
function MonoMuted({ children }: { children: React.ReactNode }) {
  return (
    <Text fontSize="$2" color="$color10" numberOfLines={1} className="hz-mono">
      {children}
    </Text>
  )
}
