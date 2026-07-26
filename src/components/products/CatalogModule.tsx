'use client'

/**
 * Catalog & Pricing — the platform product/pricing CATALOG editor (admin.hanzo.ai).
 *
 * GLOBAL-ADMIN ONLY. commerce owns the catalog as the source of truth: the 17 infra
 * tiers increment 1 seeded (11 cloud + 3 gpu + 3 datastore), plus every product
 * surface docs/pricing/the console read from. This is the CMS write surface for it —
 * a filterable table of entries and a create/edit form. An edit here flows to the
 * live pricing pages (the pricing service reads `GET /v1/commerce/catalog`, which
 * projects these same rows), so this is the ONE place a price or spec is edited.
 *
 * Every call goes through the console's OWN same-origin `/v1/catalog/*` user-bearer
 * proxy → commerce, whose `requireSuperAdmin` (owner=="admin") is the AUTHORITATIVE
 * gate: a signed-in non-admin gets an honest 403 (the OperatorAccessRequired panel),
 * never catalog write access. The browser holds no credential.
 *
 * The structured `Metadata` spec is edited as a type-preserving key/value list
 * (`catalog/logic.ts`): a value keeps its real JSON type across the round-trip, so a
 * cloud tier's `vcpus` stays the number 2, `features` stays an array, and a nested
 * datastore `usage`/`support` block stays an object — nothing is flattened or lossy.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Boxes, Check, Pencil, Plus, RefreshCw, Save, Trash2 } from '@hanzogui/lucide-icons-2'

import { ApiError } from '~/lib/api'
import { CatalogAdminApi, type CatalogEntry, type CatalogEntryInput } from '~/lib/api/catalog-admin'
import { config } from '~/config'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { FieldRow, FieldSelect, FieldSwitch, FieldText, FieldTextArea } from '~/components/ui/Field'
import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { SlideOver } from '~/components/ui/SlideOver'
import { ConfirmDelete } from '~/components/ui/ConfirmDelete'
import { ErrorState, asApiError, isForbidden, OperatorAccessRequired, type HonestCopy } from '~/components/ui/States'
import { MetadataEditor } from './pricing/MetadataEditor'
import {
  centsToInput,
  distinctCategories,
  formatUsd,
  inputToCents,
  INFRA_CATEGORIES,
  metadataTemplate,
  metadataToRows,
  type MetadataRow,
  priceUnit,
  rowsToMetadata,
  specSummary,
} from './catalog/logic'
import { toneVar } from '~/components/ui/tone'

const CATALOG_COPY: HonestCopy = {
  notFound:
    'The catalog editor requires the commerce catalog surface (GET/POST/PUT/DELETE /v1/catalog/entries). Entries appear once the catalog backend is routed on this deployment.',
  unauthorized:
    'This is the platform product/pricing catalog — cross-tenant data. Access is enforced server-side by commerce (SuperAdmin, owner=="admin"); sign in with an @hanzo.ai admin account.',
}

/** The category options the form offers: the infra tiers first, then whatever else
 *  the live catalog already uses, plus `subscription` (the plan surface). */
function categoryOptions(entries: CatalogEntry[], current: string): string[] {
  const set = new Set<string>([...INFRA_CATEGORIES, 'subscription', ...entries.map((e) => e.category)])
  if (current) set.add(current)
  return [...set].filter(Boolean)
}

type Edit =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; entry: CatalogEntry }
  | { mode: 'delete'; entry: CatalogEntry }

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; err: ApiError }
  | { phase: 'ready'; rows: CatalogEntry[] }

export function CatalogModule(_props: { params: Record<string, string> }) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const [edit, setEdit] = useState<Edit>({ mode: 'closed' })
  const [filter, setFilter] = useState<string | null>(null)
  const [seeding, setSeeding] = useState(false)

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    CatalogAdminApi.list()
      .then((rows) => setState({ phase: 'ready', rows: rows.slice().sort(byCategoryThenOrder) }))
      .catch((e) => setState({ phase: 'error', err: asApiError(e) }))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const rows = state.phase === 'ready' ? state.rows : []
  const categories = useMemo(() => distinctCategories(rows), [rows])
  const shown = useMemo(() => (filter ? rows.filter((r) => r.category === filter) : rows), [rows, filter])

  const seed = useCallback(async () => {
    setSeeding(true)
    try {
      await CatalogAdminApi.seed()
      load()
    } catch {
      // The refetch below surfaces the authoritative state; a failed seed (e.g. 403)
      // shows in the list's own error card on reload.
      load()
    } finally {
      setSeeding(false)
    }
  }, [load])

  const columns: Column<CatalogEntry>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (e) => (
        <YStack gap="$0.5" minW={0}>
          <Text fontSize="$3" fontWeight="700" numberOfLines={1}>
            {e.name || e.slug}
          </Text>
          <Text fontSize="$1" color="$color10" numberOfLines={1}>
            {e.slug}
          </Text>
        </YStack>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      width: 120,
      render: (e) => (
        <XStack bg="$color4" px="$2" py="$1" rounded="$10" self="flex-start">
          <Text fontSize="$1" fontWeight="600" color="$color11">
            {e.category || '—'}
          </Text>
        </XStack>
      ),
    },
    {
      key: 'price',
      header: 'Price',
      width: 120,
      align: 'right',
      mono: true,
      render: (e) => (
        <Text fontSize="$3" color="$color12" className="hz-mono">
          {formatUsd(e.priceCents)}
          <Text fontSize="$1" color="$color10">
            {priceUnit(e.category)}
          </Text>
        </Text>
      ),
    },
    {
      key: 'spec',
      header: 'Spec',
      render: (e) => {
        const parts = specSummary(e.category, e.metadata)
        if (parts.length === 0) return <Text fontSize="$2" color="$color9">—</Text>
        return (
          <Text fontSize="$2" color="$color11" numberOfLines={1}>
            {parts.join(' · ')}
          </Text>
        )
      },
    },
    {
      key: 'published',
      header: 'Published',
      width: 96,
      render: (e) =>
        e.published ? (
          <XStack gap="$1.5" items="center">
            <Check size={14} color="$green10" />
            <Text fontSize="$2" color="$color12">Live</Text>
          </XStack>
        ) : (
          <Text fontSize="$2" color="$color9">Draft</Text>
        ),
    },
    {
      key: 'edit',
      header: '',
      width: 44,
      render: () => <Pencil size={15} color="$color10" />,
    },
  ]

  return (
    <>
      <PageHeader
        title="Catalog & Pricing"
        subtitle={`Edit the ${config.brandName} product and pricing catalog — the source of truth the pricing pages and docs read. Changes here flow to the live prices.`}
        actions={
          <XStack gap="$2" items="center" flexWrap="wrap">
            {seeding ? <Spinner size="small" color="$color11" /> : null}
            <Button size="$2" icon={<RefreshCw size={15} />} onPress={load}>
              Refresh
            </Button>
            <Button size="$2" icon={<Boxes size={15} />} onPress={seed} disabled={seeding}>
              Seed
            </Button>
            <PrimaryButton size="$2" icon={<Plus size={15} />} onPress={() => setEdit({ mode: 'create' })}>
              New entry
            </PrimaryButton>
          </XStack>
        }
      />

      {/* Category filter — chips built from the categories actually present. */}
      {state.phase === 'ready' && categories.length > 0 ? (
        <XStack gap="$2" flexWrap="wrap" items="center">
          <FilterChip label="All" count={rows.length} active={filter === null} onPress={() => setFilter(null)} />
          {categories.map((c) => (
            <FilterChip
              key={c}
              label={c}
              count={rows.filter((r) => r.category === c).length}
              active={filter === c}
              onPress={() => setFilter(c)}
            />
          ))}
        </XStack>
      ) : null}

      {state.phase === 'error' ? (
        isForbidden(state.err) ? (
          <OperatorAccessRequired />
        ) : (
          <ErrorState err={state.err} onRetry={load} copy={CATALOG_COPY} />
        )
      ) : (
        <DataTable
          columns={columns}
          rows={shown}
          loading={state.phase === 'loading'}
          rowKey={(e) => e.slug || e.name}
          onRowPress={(e) => setEdit({ mode: 'edit', entry: e })}
          empty="No catalog entries yet. Seed the embedded catalog, or create one."
        />
      )}

      <Text fontSize="$2" color="$color10">
        endpoint · /v1/catalog/entries · {config.brandName}
      </Text>

      {/* Create / edit form (SlideOver). */}
      <SlideOver
        open={edit.mode === 'create' || edit.mode === 'edit'}
        onClose={() => setEdit({ mode: 'closed' })}
        title={edit.mode === 'edit' ? `Edit ${edit.entry.name || edit.entry.slug}` : 'New catalog entry'}
        icon={Boxes}
        size={560}
      >
        {edit.mode === 'create' || edit.mode === 'edit' ? (
          <CatalogForm
            entry={edit.mode === 'edit' ? edit.entry : null}
            categoryChoices={categoryOptions(rows, edit.mode === 'edit' ? edit.entry.category : '')}
            onSaved={() => {
              setEdit({ mode: 'closed' })
              load()
            }}
            onDelete={edit.mode === 'edit' ? () => setEdit({ mode: 'delete', entry: edit.entry }) : undefined}
            onCancel={() => setEdit({ mode: 'closed' })}
          />
        ) : null}
      </SlideOver>

      {/* Delete confirm (SlideOver). */}
      <SlideOver
        open={edit.mode === 'delete'}
        onClose={() => setEdit({ mode: 'closed' })}
        title={edit.mode === 'delete' ? `Delete ${edit.entry.name || edit.entry.slug}?` : 'Delete'}
        icon={Trash2}
        size={480}
      >
        {edit.mode === 'delete' ? (
          <ConfirmDelete
            message={`Delete the catalog entry "${edit.entry.name || edit.entry.slug}" (${edit.entry.slug})? This removes it from the catalog and the pricing pages. This cannot be undone.`}
            confirmLabel="Delete entry"
            run={() => CatalogAdminApi.remove(edit.entry.slug)}
            onDone={() => {
              setEdit({ mode: 'closed' })
              load()
            }}
          />
        ) : null}
      </SlideOver>
    </>
  )
}

/** Sort by category (infra first via the same rule as the filter), then display order. */
function byCategoryThenOrder(a: CatalogEntry, b: CatalogEntry): number {
  if (a.category !== b.category) return a.category.localeCompare(b.category)
  return a.order - b.order
}

function FilterChip({ label, count, active, onPress }: { label: string; count: number; active: boolean; onPress: () => void }) {
  return (
    <Button
      size="$1"
      onPress={onPress}
      theme={active ? 'light' : undefined}
      borderWidth={1}
      borderColor={active ? '$color8' : '$borderColor'}
    >
      {label} · {count}
    </Button>
  )
}

// ── The create/edit form ─────────────────────────────────────────────────────

function CatalogForm({
  entry,
  categoryChoices,
  onSaved,
  onDelete,
  onCancel,
}: {
  entry: CatalogEntry | null
  categoryChoices: string[]
  onSaved: () => void
  onDelete?: () => void
  onCancel: () => void
}) {
  const creating = entry === null
  const [slug, setSlug] = useState(entry?.slug ?? '')
  const [name, setName] = useState(entry?.name ?? '')
  const [category, setCategory] = useState(entry?.category ?? 'cloud')
  const [description, setDescription] = useState(entry?.description ?? '')
  const [price, setPrice] = useState(centsToInput(entry?.priceCents ?? 0))
  const [pricingId, setPricingId] = useState(entry?.pricingId ?? '')
  const [order, setOrder] = useState(String(entry?.order ?? 0))
  const [published, setPublished] = useState(entry?.published ?? true)
  const [cost, setCost] = useState(centsToInput(entry?.costCents ?? 0))
  const [margin, setMargin] = useState(String(entry?.marginPct ?? 0))
  const [rows, setRows] = useState<MetadataRow[]>(() =>
    entry ? metadataToRows(entry.metadata) : metadataTemplate('cloud'),
  )

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // On CREATE, changing the category to an infra one prefills the canonical scalar
  // spec keys — but only while the spec is still untouched (empty), so a picked
  // template is never clobbered once the admin starts editing.
  const onCategory = useCallback(
    (c: string) => {
      setCategory(c)
      if (creating && rows.length === 0) setRows(metadataTemplate(c))
    },
    [creating, rows.length],
  )

  const save = useCallback(async () => {
    setErr(null)
    if (!slug.trim()) {
      setErr('A slug is required — it is the unique catalog key.')
      return
    }
    if (!name.trim()) {
      setErr('A name is required.')
      return
    }
    const input: CatalogEntryInput = {
      slug: slug.trim(),
      name: name.trim(),
      category: category.trim(),
      description: description.trim(),
      priceCents: inputToCents(price),
      currency: entry?.currency || 'usd',
      pricingId: pricingId.trim(),
      costCents: inputToCents(cost),
      marginPct: Number.parseFloat(margin) || 0,
      order: Number.parseInt(order, 10) || 0,
      published,
      metadata: rowsToMetadata(rows),
    }
    setBusy(true)
    try {
      if (creating) await CatalogAdminApi.create(input)
      else await CatalogAdminApi.update(entry.slug, input)
      onSaved()
    } catch (e) {
      setErr(asApiError(e).message || 'Failed to save.')
      setBusy(false)
    }
  }, [creating, entry, slug, name, category, description, price, pricingId, cost, margin, order, published, rows, onSaved])

  const unit = priceUnit(category)

  return (
    <YStack gap="$3">
      <FieldRow label="Slug">
        <FieldText
          value={slug}
          onChange={setSlug}
          disabled={!creating}
          placeholder="cloud-dev"
        />
        {!creating ? (
          <Text fontSize="$1" color="$color9" mt="$1">
            The slug is the immutable catalog key — create a new entry to change it.
          </Text>
        ) : null}
      </FieldRow>

      <FieldRow label="Name">
        <FieldText value={name} onChange={setName} placeholder="Dev" />
      </FieldRow>

      <FieldRow label="Category">
        <FieldSelect value={category} options={categoryChoices} onChange={onCategory} />
      </FieldRow>

      <FieldRow label="Description">
        <FieldTextArea value={description} onChange={setDescription} rows={2} />
      </FieldRow>

      <FieldRow label={`Price (USD${unit ? ` ${unit}` : ''})`}>
        <FieldText value={price} onChange={setPrice} placeholder="15" />
        <Text fontSize="$1" color="$color9" mt="$1">
          Stored as {inputToCents(price)} cents. The public price customers pay.
        </Text>
      </FieldRow>

      <FieldRow label="Published">
        <FieldSwitch checked={published} onChange={setPublished} />
      </FieldRow>

      <FieldRow label="Pricing plan id">
        <FieldText value={pricingId} onChange={setPricingId} placeholder="(optional) plans/<key> reference" />
      </FieldRow>

      <FieldRow label="Order">
        <FieldText value={order} onChange={setOrder} placeholder="0" />
      </FieldRow>

      {/* Structured spec (Metadata) — the type-preserving key/value editor. */}
      <YStack gap="$2" borderTopWidth={1} borderColor="$borderColor" pt="$3">
        <XStack items="center" justify="space-between">
          <Text fontSize="$3" fontWeight="700">
            Spec (metadata)
          </Text>
          <Text fontSize="$1" color="$color10">
            {rows.length} field{rows.length === 1 ? '' : 's'}
          </Text>
        </XStack>
        <Text fontSize="$1" color="$color10">
          {INFRA_CATEGORIES.includes(category as (typeof INFRA_CATEGORIES)[number])
            ? 'The structured tier spec (vcpus / memoryGB / diskGB / priceHourly …). Numbers, booleans, and nested objects keep their type.'
            : 'Free-form spec. Numbers, booleans, arrays, and nested objects keep their JSON type.'}
        </Text>
        <MetadataEditor rows={rows} onChange={setRows} />
      </YStack>

      {/* Economics — admin-only unit cost + margin (never in the public projection). */}
      <YStack gap="$2" borderTopWidth={1} borderColor="$borderColor" pt="$3">
        <Text fontSize="$3" fontWeight="700">
          Economics (admin-only)
        </Text>
        <FieldRow label="Unit cost (USD)">
          <FieldText value={cost} onChange={setCost} placeholder="0" />
        </FieldRow>
        <FieldRow label="Margin %">
          <FieldText value={margin} onChange={setMargin} placeholder="0" />
        </FieldRow>
      </YStack>

      {err ? (
        <Card bg="$red2" borderColor="$red6" borderWidth={1} p="$2.5">
          <Text fontSize="$2" color="$red11">
            {err}
          </Text>
        </Card>
      ) : null}

      <XStack gap="$2" flexWrap="wrap" pt="$1">
        <PrimaryButton icon={<Save size={15} />} onPress={save} disabled={busy}>
          {busy ? 'Saving…' : creating ? 'Create entry' : 'Save changes'}
        </PrimaryButton>
        <Button chromeless onPress={onCancel} disabled={busy}>
          Cancel
        </Button>
        {onDelete ? (
          <Button
            chromeless
            icon={<Trash2 size={15} />}
            onPress={onDelete}
            disabled={busy}
            ml="auto"
            style={{ color: toneVar('critical') }}
          >
            Delete
          </Button>
        ) : null}
      </XStack>
    </YStack>
  )
}

