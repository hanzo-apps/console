'use client'

/**
 * Base — manage your organization's Hanzo Base INSTANCES ("Bases").
 *
 * A Base is a full realtime backend (hanzoai/base): content types + records +
 * auth, on its own `<slug>.base.hanzo.ai`. This module is the instance manager —
 * SEE all your Bases, CREATE a new one, and CONFIGURE one (name, size, status,
 * delete). Each Base is a row in the managed Base's `tenants` collection; we drive
 * its real `/v1/collections/tenants/records` API same-origin at `/v1` → cloud's
 * `/v1/collections/*` Base data-plane forward (clients/base/collections.go), which
 * validates the caller's Bearer and forwards it to the managed Base — so the
 * list/create/configure are scoped to THIS org/user. We do not re-implement Base; a
 * Base is a tenants record. (Browsing a Base's data — its collections + records — is
 * the sibling `Records` product.)
 *
 * Routes (declared in the registry, resolved by segment):
 *   /base            — your Bases (+ New Base)
 *   /base/new        — create a Base
 *   /base/:base      — configure one Base (`:base` = its record id)
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowLeft, Boxes, ExternalLink, Plus, Server, Trash2 } from '@hanzogui/lucide-icons-2'

import { PageHeader } from '~/components/ui/PageHeader'
import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { EmptyState } from '~/components/ui/EmptyState'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { StatusTag } from '~/components/ui/StatusTag'
import { FieldRow, FieldText, FieldSelect } from '~/components/ui/Field'
import { BaseTenantsApi, type BaseInstance } from '~/lib/base-data/tenants'
import { ApiError } from '~/lib/api'
import {
  slugify,
  validateBase,
  SIZE_PRESETS,
  DEFAULT_SIZE,
  specForSize,
  sizeForSpec,
  specSummary,
  statusOf,
  baseHref,
} from './bases-logic'

/** Product base path — must match the registry entry id (`base`). */
const BASE_PATH = '/base'
/** Same-origin Base data-plane root: `/v1` → cloud's `/v1/collections/*` forward
 *  (the client attaches the PKCE Bearer + X-Org-Id; cloud forwards to the Base). */
const BASE_PROXY = '/v1'

const SIZE_LABELS = SIZE_PRESETS.map((p) => p.label)
const labelToSize = (label: string): string => SIZE_PRESETS.find((p) => p.label === label)?.id ?? DEFAULT_SIZE
const sizeToLabel = (id: string): string => SIZE_PRESETS.find((p) => p.id === id)?.label ?? ''

export function BasesManager({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const pathname = usePathname()
  const api = useMemo(() => new BaseTenantsApi(BASE_PROXY), [])

  const baseId = params.base
  const isNew = baseId === undefined && (pathname?.endsWith('/new') ?? false)

  const nav = useMemo(
    () => ({
      toList: () => router.push(BASE_PATH),
      toNew: () => router.push(`${BASE_PATH}/new`),
      toBase: (id: string) => router.push(`${BASE_PATH}/${encodeURIComponent(id)}`),
    }),
    [router],
  )

  if (baseId) return <BaseConfig api={api} id={baseId} nav={nav} />
  if (isNew) return <NewBase api={api} nav={nav} />
  return <BasesList api={api} nav={nav} />
}


type Nav = { toList: () => void; toNew: () => void; toBase: (id: string) => void }

// ── List ────────────────────────────────────────────────────────────────────

type ListState =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; bases: BaseInstance[] }

/** All the org's Bases + the "New Base" affordance. */
function BasesList({ api, nav }: { api: BaseTenantsApi; nav: Nav }) {
  const [state, setState] = useState<ListState>({ phase: 'loading' })

  const load = useCallback(
    async (signal: { cancelled: boolean }) => {
      setState({ phase: 'loading' })
      try {
        const bases = (await api.list()).sort((a, b) => a.name.localeCompare(b.name))
        if (!signal.cancelled) setState({ phase: 'ready', bases })
      } catch (e) {
        if (!signal.cancelled) setState({ phase: 'error', error: classifyBackend(e) })
      }
    },
    [api],
  )

  useEffect(() => {
    const signal = { cancelled: false }
    void load(signal)
    return () => {
      signal.cancelled = true
    }
  }, [load])

  const reload = useCallback(() => void load({ cancelled: false }), [load])

  return (
    <YStack gap="$4">
      <PageHeader
        title="Base"
        subtitle="Your organization's Hanzo Base instances — a realtime backend per Base, with content types, records, and auth."
        actions={
          <XStack gap="$2">
            <Button size="$3" onPress={reload}>
              Refresh
            </Button>
            <PrimaryButton size="$3" icon={<Plus size={16} />} onPress={nav.toNew}>
              New Base
            </PrimaryButton>
          </XStack>
        }
      />

      {state.phase === 'error' ? (
        <BackendStateCard state={state.error} onRetry={reload} hint="base · GET /v1/collections/tenants/records" />
      ) : state.phase === 'loading' ? (
        <XStack p="$4" gap="$2" items="center">
          <Spinner />
          <Text color="$color11">Loading your Bases…</Text>
        </XStack>
      ) : state.bases.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No Bases yet"
          description="Create your first Base — a realtime backend for your organization. Model content types, store records, and add auth, all on its own subdomain."
          bullets={['Each Base is isolated and provisioned on its own <slug>.base.hanzo.ai', 'Configure size (replicas + storage) per Base', 'Browse and edit a Base’s data in Records']}
          primary={{ label: 'New Base', onPress: nav.toNew, icon: <Plus size={16} /> }}
        />
      ) : (
        <YStack gap="$2" maxW={860}>
          {state.bases.map((b) => (
            <BaseRow key={b.id || b.slug} base={b} onOpen={() => nav.toBase(b.id)} />
          ))}
        </YStack>
      )}
    </YStack>
  )
}

/** One Base in the list — name, slug, status, size, and (when ready) its live URL. */
function BaseRow({ base, onOpen }: { base: BaseInstance; onOpen: () => void }) {
  const status = statusOf(base)
  const href = baseHref(base)
  return (
    <XStack
      items="center"
      justify="space-between"
      gap="$3"
      borderWidth={1}
      borderColor="$borderColor"
      rounded="$4"
      px="$4"
      py="$3"
      cursor="pointer"
      hoverStyle={{ bg: '$color3', borderColor: '$color7' }}
      onPress={onOpen}
    >
      <XStack items="center" gap="$3" flex={1}>
        <Server size={16} />
        <YStack flex={1} gap="$0.5">
          <XStack items="center" gap="$2">
            <Text fontSize="$4" fontWeight="700">
              {base.name}
            </Text>
            <StatusTag status={status.label} />
          </XStack>
          <Text fontSize="$2" color="$color10">
            {base.slug} · {specSummary(base.spec)}
          </Text>
        </YStack>
      </XStack>
      {href ? (
        <Button
          size="$2"
          chromeless
          icon={<ExternalLink size={14} />}
          onPress={(e) => {
            e.stopPropagation?.()
            window.open(href, '_blank', 'noopener,noreferrer')
          }}
        >
          Open
        </Button>
      ) : null}
    </XStack>
  )
}

// ── Create ──────────────────────────────────────────────────────────────────

type Submit = { phase: 'idle' } | { phase: 'saving' } | { phase: 'error'; message: string }

/** Map a mutation error to an honest message (superuser/balance gate → clear ask). */
function mutationMessage(e: unknown, fallback: string): string {
  const status = e instanceof ApiError ? e.status : 0
  if (status === 401 || status === 403) {
    return 'Creating and configuring Bases requires an organization admin. Ask an org admin, or sign in with an admin account.'
  }
  if (status === 402) return 'This organization needs available credit to provision a new Base. Add credit and try again.'
  return e instanceof Error ? e.message : fallback
}

/** Create a Base — name → slug + a size preset → real POST to the tenants API. */
function NewBase({ api, nav }: { api: BaseTenantsApi; nav: Nav }) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [size, setSize] = useState(DEFAULT_SIZE)
  const [existingSlugs, setExistingSlugs] = useState<string[]>([])
  const [submit, setSubmit] = useState<Submit>({ phase: 'idle' })
  const [showErrors, setShowErrors] = useState(false)

  // Load existing slugs for the uniqueness check (best-effort; never blocks create).
  useEffect(() => {
    let cancelled = false
    api
      .list()
      .then((bases) => {
        if (!cancelled) setExistingSlugs(bases.map((b) => b.slug).filter(Boolean))
      })
      .catch(() => {
        /* create still validates server-side */
      })
    return () => {
      cancelled = true
    }
  }, [api])

  const effectiveSlug = slugEdited ? slug.trim() : slugify(name)
  const validation = useMemo(
    () => validateBase(name, effectiveSlug, existingSlugs),
    [name, effectiveSlug, existingSlugs],
  )

  const create = async () => {
    setShowErrors(true)
    if (!validation.ok) return
    setSubmit({ phase: 'saving' })
    try {
      const created = await api.create({ name: name.trim(), slug: effectiveSlug, spec: specForSize(size) })
      if (created.id) nav.toBase(created.id)
      else nav.toList()
    } catch (e) {
      setSubmit({ phase: 'error', message: mutationMessage(e, 'Could not create the Base.') })
    }
  }

  const disabled = submit.phase === 'saving'
  return (
    <YStack gap="$4" maxW={720}>
      <PageHeader
        title="New Base"
        subtitle="Provision a realtime backend for your organization — it gets its own subdomain."
        actions={
          <XStack gap="$2">
            <Button size="$3" icon={<ArrowLeft size={15} />} onPress={nav.toList} disabled={disabled}>
              All Bases
            </Button>
            <PrimaryButton size="$3" icon={<Boxes size={16} />} onPress={create} disabled={disabled}>
              {submit.phase === 'saving' ? 'Creating…' : 'Create Base'}
            </PrimaryButton>
          </XStack>
        }
      />

      <Card p="$4" gap="$4" borderWidth={1} borderColor="$borderColor">
        <FieldRow label="Name">
          <FieldText
            value={name}
            onChange={setName}
            disabled={disabled}
            placeholder="Production, Staging, Blog…"
          />
        </FieldRow>

        <FieldRow label="Slug">
          <YStack gap="$1.5">
            <FieldText
              value={effectiveSlug}
              onChange={(v) => {
                setSlugEdited(true)
                setSlug(v)
              }}
              disabled={disabled}
              placeholder="my-base"
            />
            {showErrors && validation.slugError ? (
              <Text fontSize="$2" color="$red10">
                {validation.slugError}
              </Text>
            ) : (
              <Text fontSize="$2" color="$color10">
                Its subdomain: {effectiveSlug || 'my-base'}.base.hanzo.ai · lowercase letters, numbers, hyphens.
              </Text>
            )}
            {showErrors && validation.nameError ? (
              <Text fontSize="$2" color="$red10">
                {validation.nameError}
              </Text>
            ) : null}
          </YStack>
        </FieldRow>

        <FieldRow label="Size">
          <YStack gap="$1.5">
            <FieldSelect
              value={sizeToLabel(size)}
              options={SIZE_LABELS}
              onChange={(label) => setSize(labelToSize(label))}
              disabled={disabled}
            />
            <Text fontSize="$2" color="$color10">
              {SIZE_PRESETS.find((p) => p.id === size)?.hint ?? ''}
            </Text>
          </YStack>
        </FieldRow>
      </Card>

      {submit.phase === 'error' ? (
        <Card p="$3.5" gap="$1" borderWidth={1} borderColor="$red7" bg="$red2" maxW={720}>
          <Text fontSize="$3" fontWeight="700" color="$red11">
            Couldn’t create the Base
          </Text>
          <Text fontSize="$2" color="$red11">
            {submit.message}
          </Text>
        </Card>
      ) : null}
    </YStack>
  )
}

// ── Configure ─────────────────────────────────────────────────────────────────

type ConfigState =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; base: BaseInstance }

/** Configure ONE Base — edit name + size, see live status, open it, or delete it. */
function BaseConfig({ api, id, nav }: { api: BaseTenantsApi; id: string; nav: Nav }) {
  const [state, setState] = useState<ConfigState>({ phase: 'loading' })
  const [name, setName] = useState('')
  const [size, setSize] = useState(DEFAULT_SIZE)
  const [submit, setSubmit] = useState<Submit>({ phase: 'idle' })
  const [confirmDelete, setConfirmDelete] = useState(false)

  const load = useCallback(
    async (signal: { cancelled: boolean }) => {
      setState({ phase: 'loading' })
      try {
        const base = await api.get(id)
        if (signal.cancelled) return
        setName(base.name)
        setSize(sizeForSpec(base.spec))
        setState({ phase: 'ready', base })
      } catch (e) {
        if (!signal.cancelled) setState({ phase: 'error', error: classifyBackend(e) })
      }
    },
    [api, id],
  )

  useEffect(() => {
    const signal = { cancelled: false }
    void load(signal)
    return () => {
      signal.cancelled = true
    }
  }, [load])

  if (state.phase === 'loading') {
    return (
      <XStack p="$4" gap="$2" items="center">
        <Spinner />
        <Text color="$color11">Loading Base…</Text>
      </XStack>
    )
  }
  if (state.phase === 'error') {
    return (
      <YStack gap="$4">
        <PageHeader
          title="Base"
          actions={
            <Button size="$3" icon={<ArrowLeft size={15} />} onPress={nav.toList}>
              All Bases
            </Button>
          }
        />
        <BackendStateCard state={state.error} onRetry={() => void load({ cancelled: false })} hint="base · GET /v1/collections/tenants/records" />
      </YStack>
    )
  }

  const base = state.base
  const status = statusOf(base)
  const href = baseHref(base)
  const disabled = submit.phase === 'saving'
  const dirty = name.trim() !== base.name || (sizeForSpec(base.spec) !== size && size !== 'custom')

  const save = async () => {
    if (!name.trim()) {
      setSubmit({ phase: 'error', message: 'Name is required.' })
      return
    }
    setSubmit({ phase: 'saving' })
    try {
      const patch: { name?: string; spec?: ReturnType<typeof specForSize> } = { name: name.trim() }
      if (size !== 'custom' && sizeForSpec(base.spec) !== size) patch.spec = specForSize(size)
      const updated = await api.update(base.id, patch)
      setState({ phase: 'ready', base: updated })
      setName(updated.name)
      setSize(sizeForSpec(updated.spec))
      setSubmit({ phase: 'idle' })
    } catch (e) {
      setSubmit({ phase: 'error', message: mutationMessage(e, 'Could not save the Base.') })
    }
  }

  const remove = async () => {
    setSubmit({ phase: 'saving' })
    try {
      await api.remove(base.id)
      nav.toList()
    } catch (e) {
      setSubmit({ phase: 'error', message: mutationMessage(e, 'Could not delete the Base.') })
      setConfirmDelete(false)
    }
  }

  const sizeOptions = size === 'custom' ? [...SIZE_LABELS, 'Custom'] : SIZE_LABELS
  const sizeValue = size === 'custom' ? 'Custom' : sizeToLabel(size)

  return (
    <YStack gap="$4" maxW={720}>
      <PageHeader
        title={base.name}
        subtitle={`${base.slug}.base.hanzo.ai`}
        actions={
          <XStack gap="$2" items="center">
            <StatusTag status={status.label} />
            {href ? (
              <Button size="$3" icon={<ExternalLink size={15} />} onPress={() => window.open(href, '_blank', 'noopener,noreferrer')}>
                Open
              </Button>
            ) : null}
            <Button size="$3" icon={<ArrowLeft size={15} />} onPress={nav.toList}>
              All Bases
            </Button>
          </XStack>
        }
      />

      {base.lastError ? (
        <Card p="$3.5" gap="$1" borderWidth={1} borderColor="$red7" bg="$red2">
          <Text fontSize="$3" fontWeight="700" color="$red11">
            Reconcile error
          </Text>
          <Text fontSize="$2" color="$red11">
            {base.lastError}
          </Text>
        </Card>
      ) : null}

      <Card p="$4" gap="$4" borderWidth={1} borderColor="$borderColor">
        <FieldRow label="Name">
          <FieldText value={name} onChange={setName} disabled={disabled} />
        </FieldRow>
        <FieldRow label="Slug">
          <YStack gap="$1.5">
            <Text fontSize="$4" fontWeight="600">
              {base.slug}
            </Text>
            <Text fontSize="$2" color="$color10">
              The slug is fixed after creation (it names the subdomain and workload).
            </Text>
          </YStack>
        </FieldRow>
        <FieldRow label="Size">
          <YStack gap="$1.5">
            <FieldSelect
              value={sizeValue}
              options={sizeOptions}
              onChange={(label) => setSize(labelToSize(label))}
              disabled={disabled}
            />
            <Text fontSize="$2" color="$color10">
              {size === 'custom' ? `Current: ${specSummary(base.spec)}` : SIZE_PRESETS.find((p) => p.id === size)?.hint ?? ''}
            </Text>
          </YStack>
        </FieldRow>
        <FieldRow label="Status">
          <XStack items="center" gap="$2" flexWrap="wrap">
            <StatusTag status={status.label} />
            <Text fontSize="$2" color="$color10">
              {status.ready ? `Live at ${base.subdomain}` : 'Provisioning — its subdomain appears here once it’s ready.'}
            </Text>
          </XStack>
        </FieldRow>

        <XStack gap="$2" pt="$1">
          <PrimaryButton size="$3" onPress={save} disabled={disabled || !dirty}>
            {submit.phase === 'saving' ? 'Saving…' : 'Save changes'}
          </PrimaryButton>
        </XStack>
      </Card>

      {/* Data lives in the sibling Records product (a Base's collections + records). */}
      <Card p="$3.5" gap="$1" borderWidth={1} borderColor="$borderColor">
        <Text fontSize="$3" fontWeight="700">
          Data
        </Text>
        <Text fontSize="$2" color="$color11">
          Model this Base’s content types and browse its records in Records. Its own Base dashboard is available at{' '}
          {href ? base.subdomain : `${base.slug}.base.hanzo.ai`} once provisioned.
        </Text>
      </Card>

      {/* Danger zone. */}
      <Card p="$3.5" gap="$3" borderWidth={1} borderColor="$red7">
        <YStack gap="$1">
          <Text fontSize="$3" fontWeight="700" color="$red11">
            Delete this Base
          </Text>
          <Text fontSize="$2" color="$color11">
            Deprovisions the Base and permanently removes its data. This cannot be undone.
          </Text>
        </YStack>
        {confirmDelete ? (
          <XStack gap="$2" items="center" flexWrap="wrap">
            <Text fontSize="$2" color="$red11">
              Delete “{base.name}”?
            </Text>
            <Button size="$2" theme="red" icon={<Trash2 size={14} />} onPress={remove} disabled={disabled}>
              {submit.phase === 'saving' ? 'Deleting…' : 'Yes, delete'}
            </Button>
            <Button size="$2" onPress={() => setConfirmDelete(false)} disabled={disabled}>
              Cancel
            </Button>
          </XStack>
        ) : (
          <XStack>
            <Button size="$2" icon={<Trash2 size={14} />} onPress={() => setConfirmDelete(true)} disabled={disabled}>
              Delete Base
            </Button>
          </XStack>
        )}
      </Card>

      {submit.phase === 'error' ? (
        <Card p="$3.5" gap="$1" borderWidth={1} borderColor="$red7" bg="$red2">
          <Text fontSize="$2" color="$red11">
            {submit.message}
          </Text>
        </Card>
      ) : null}
    </YStack>
  )
}
