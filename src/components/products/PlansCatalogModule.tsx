'use client'

/**
 * Subscription Plans — the platform PLAN authority editor (admin.hanzo.ai).
 *
 * GLOBAL-ADMIN ONLY. commerce owns the subscription/DNS plan authority as the source of
 * truth (`models/plan`): the tiers `GET /v1/billing/plans` and the internal-ledger
 * renewal charge derive from. This is the CMS write surface for it — a filterable table
 * of plans and a create/edit form. The sibling of the Catalog editor, over the SAME
 * SuperAdmin CRUD pattern (`/v1/plans/entries`), reusing its tested money + metadata
 * logic.
 *
 * LIVE BILLING CONTROL: a plan's monthly PRICE is the real renewal charge — editing it
 * changes what existing subscribers pay on their next cycle. The form states this
 * explicitly, and every write is SuperAdmin-gated by commerce (`requireSuperAdmin`,
 * owner=="admin") — a signed-in non-admin gets an honest 403. The SLUG is IMMUTABLE on
 * edit (commerce rejects a rename; a subscription's stored PlanId must never be
 * orphaned), enforced in the UI to match the backend guard. `contactSales` marks a
 * CUSTOM plan (price is null, not $0) — surfaced distinctly from a free tier.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Boxes, Pencil, Plus, RefreshCw, Save, Star, Trash2, TriangleAlert } from '@hanzogui/lucide-icons-2'

import { ApiError } from '~/lib/api'
import { PlansAdminApi, type Plan, type PlanInput } from '~/lib/api/plans-admin'
import { config } from '~/config'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { FieldRow, FieldSelect, FieldSwitch, FieldText, FieldTextArea } from '~/components/ui/Field'
import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { SlideOver } from '~/components/ui/SlideOver'
import { ConfirmDelete } from '~/components/ui/ConfirmDelete'
import { ErrorState, asApiError, isForbidden, OperatorAccessRequired, type HonestCopy } from '~/components/ui/States'
import { MetadataEditor } from './pricing/MetadataEditor'
import { centsToInput, distinctCategories, formatUsd, inputToCents, metadataToRows, type MetadataRow, rowsToMetadata } from './catalog/logic'
import { annualDisplay, PLAN_CATEGORIES, priceDisplay } from './plans/logic'

const PLANS_COPY: HonestCopy = {
  notFound:
    'The plans editor requires the commerce plan surface (GET/POST/PUT/DELETE /v1/plans/entries). Plans appear once the plan backend is routed on this deployment.',
  unauthorized:
    'This is the platform subscription/DNS plan authority — cross-tenant PRICING data (a plan price is the real renewal charge). Access is enforced server-side by commerce (SuperAdmin, owner=="admin"); sign in with an @hanzo.ai admin account.',
}

/** The category options the form offers: the known plan families first, then whatever
 *  else the live plan set already uses. */
function categoryOptions(plans: Plan[], current: string): string[] {
  const set = new Set<string>([...PLAN_CATEGORIES, ...plans.map((p) => p.category)])
  if (current) set.add(current)
  return [...set].filter(Boolean)
}

type Edit =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; plan: Plan }
  | { mode: 'delete'; plan: Plan }

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; err: ApiError }
  | { phase: 'ready'; rows: Plan[] }

export function PlansCatalogModule(_props: { params: Record<string, string> }) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const [edit, setEdit] = useState<Edit>({ mode: 'closed' })
  const [filter, setFilter] = useState<string | null>(null)
  const [seeding, setSeeding] = useState(false)

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    PlansAdminApi.list()
      .then((rows) => setState({ phase: 'ready', rows: rows.slice().sort(byCategoryThenPrice) }))
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
      await PlansAdminApi.seed()
    } finally {
      setSeeding(false)
      load()
    }
  }, [load])

  const columns: Column<Plan>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (p) => (
        <YStack gap="$0.5" minW={0}>
          <XStack gap="$1.5" items="center">
            <Text fontSize="$3" fontWeight="700" numberOfLines={1}>
              {p.name || p.slug}
            </Text>
            {p.popular ? <Star size={12} color="$color10" /> : null}
          </XStack>
          <Text fontSize="$1" color="$color10" numberOfLines={1}>
            {p.slug}
          </Text>
        </YStack>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      width: 120,
      render: (p) => (
        <XStack bg="$color4" px="$2" py="$1" rounded="$10" self="flex-start">
          <Text fontSize="$1" fontWeight="600" color="$color11">
            {p.category || '—'}
          </Text>
        </XStack>
      ),
    },
    {
      key: 'price',
      header: 'Monthly',
      width: 130,
      align: 'right',
      mono: true,
      render: (p) => (
        <Text fontSize="$3" color="$color12" className="hz-mono">
          {priceDisplay(p.price, p.contactSales)}
        </Text>
      ),
    },
    {
      key: 'annual',
      header: 'Annual',
      width: 150,
      render: (p) => {
        const a = annualDisplay(p.priceAnnual)
        return a ? (
          <Text fontSize="$2" color="$color11" numberOfLines={1}>
            {a}
          </Text>
        ) : (
          <Text fontSize="$2" color="$color9">—</Text>
        )
      },
    },
    {
      key: 'flags',
      header: '',
      width: 96,
      render: (p) =>
        p.contactSales ? (
          <Text fontSize="$1" px="$2" py="$1" rounded="$2" bg="$color4" color="$color11" self="flex-start">
            Custom
          </Text>
        ) : p.perSeat ? (
          <Text fontSize="$1" color="$color10">
            per seat
          </Text>
        ) : null,
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
        title="Subscription Plans"
        subtitle={`Edit the ${config.brandName} subscription and DNS plan authority — the plans Billing and the renewal charge read. Editing a monthly price changes the real charge.`}
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
              New plan
            </PrimaryButton>
          </XStack>
        }
      />

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
          <ErrorState err={state.err} onRetry={load} copy={PLANS_COPY} />
        )
      ) : (
        <DataTable
          columns={columns}
          rows={shown}
          loading={state.phase === 'loading'}
          rowKey={(p) => p.slug || p.name}
          onRowPress={(p) => setEdit({ mode: 'edit', plan: p })}
          empty="No plans yet. Seed the embedded plans, or create one."
        />
      )}

      <Text fontSize="$2" color="$color10">
        endpoint · /v1/plans/entries · {config.brandName}
      </Text>

      {/* Create / edit form (SlideOver). */}
      <SlideOver
        open={edit.mode === 'create' || edit.mode === 'edit'}
        onClose={() => setEdit({ mode: 'closed' })}
        title={edit.mode === 'edit' ? `Edit ${edit.plan.name || edit.plan.slug}` : 'New plan'}
        icon={Boxes}
        size={560}
      >
        {edit.mode === 'create' || edit.mode === 'edit' ? (
          <PlanForm
            plan={edit.mode === 'edit' ? edit.plan : null}
            categoryChoices={categoryOptions(rows, edit.mode === 'edit' ? edit.plan.category : '')}
            onSaved={() => {
              setEdit({ mode: 'closed' })
              load()
            }}
            onDelete={edit.mode === 'edit' ? () => setEdit({ mode: 'delete', plan: edit.plan }) : undefined}
            onCancel={() => setEdit({ mode: 'closed' })}
          />
        ) : null}
      </SlideOver>

      {/* Delete confirm (SlideOver). */}
      <SlideOver
        open={edit.mode === 'delete'}
        onClose={() => setEdit({ mode: 'closed' })}
        title={edit.mode === 'delete' ? `Delete ${edit.plan.name || edit.plan.slug}?` : 'Delete'}
        icon={Trash2}
        size={480}
      >
        {edit.mode === 'delete' ? (
          <ConfirmDelete
            message={`Delete the plan "${edit.plan.name || edit.plan.slug}" (${edit.plan.slug})? Existing subscriptions reference this plan by slug — deleting it can orphan them. This cannot be undone.`}
            confirmLabel="Delete plan"
            run={() => PlansAdminApi.remove(edit.plan.slug)}
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

/** Sort by category, then by monthly price ascending (a custom/contactSales plan last). */
function byCategoryThenPrice(a: Plan, b: Plan): number {
  if (a.category !== b.category) return a.category.localeCompare(b.category)
  const pa = a.contactSales ? Number.MAX_SAFE_INTEGER : a.price
  const pb = b.contactSales ? Number.MAX_SAFE_INTEGER : b.price
  return pa - pb
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

function PlanForm({
  plan,
  categoryChoices,
  onSaved,
  onDelete,
  onCancel,
}: {
  plan: Plan | null
  categoryChoices: string[]
  onSaved: () => void
  onDelete?: () => void
  onCancel: () => void
}) {
  const creating = plan === null
  const [slug, setSlug] = useState(plan?.slug ?? '')
  const [name, setName] = useState(plan?.name ?? '')
  const [category, setCategory] = useState(plan?.category ?? 'personal')
  const [description, setDescription] = useState(plan?.description ?? '')
  const [price, setPrice] = useState(centsToInput(plan?.price ?? 0))
  const [annual, setAnnual] = useState(centsToInput(plan?.priceAnnual ?? 0))
  const [trialDays, setTrialDays] = useState(String(plan?.trialPeriodDays ?? 0))
  const [contactSales, setContactSales] = useState(plan?.contactSales ?? false)
  const [popular, setPopular] = useState(plan?.popular ?? false)
  const [perSeat, setPerSeat] = useState(plan?.perSeat ?? false)
  const [rows, setRows] = useState<MetadataRow[]>(() => metadataToRows(plan?.metadata))

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const save = useCallback(async () => {
    setErr(null)
    if (!slug.trim()) {
      setErr('A slug is required — it is the unique, immutable plan key.')
      return
    }
    if (!name.trim()) {
      setErr('A name is required.')
      return
    }
    const input: PlanInput = {
      slug: slug.trim(),
      name: name.trim(),
      description: description.trim(),
      category: category.trim(),
      // A custom (contactSales) plan carries price 0 with the flag — never a fabricated
      // number; the free-vs-custom distinction is preserved exactly as commerce stores it.
      price: contactSales ? 0 : inputToCents(price),
      priceAnnual: contactSales ? 0 : inputToCents(annual),
      currency: plan?.currency || 'usd',
      trialPeriodDays: Number.parseInt(trialDays, 10) || 0,
      perSeat,
      contactSales,
      popular,
      metadata: rowsToMetadata(rows),
    }
    setBusy(true)
    try {
      if (creating) await PlansAdminApi.create(input)
      else await PlansAdminApi.update(plan.slug, input) // slug immutable — path slug wins
      onSaved()
    } catch (e) {
      setErr(asApiError(e).message || 'Failed to save.')
      setBusy(false)
    }
  }, [creating, plan, slug, name, category, description, price, annual, trialDays, contactSales, popular, perSeat, rows, onSaved])

  return (
    <YStack gap="$3">
      <FieldRow label="Slug">
        <FieldText value={slug} onChange={setSlug} disabled={!creating} placeholder="pro" />
        {!creating ? (
          <Text fontSize="$1" color="$color9" mt="$1">
            The slug is IMMUTABLE — subscriptions reference the plan by it. Create a new plan to change it.
          </Text>
        ) : null}
      </FieldRow>

      <FieldRow label="Name">
        <FieldText value={name} onChange={setName} placeholder="Pro" />
      </FieldRow>

      <FieldRow label="Category">
        <FieldSelect value={category} options={categoryChoices} onChange={setCategory} />
      </FieldRow>

      <FieldRow label="Description">
        <FieldTextArea value={description} onChange={setDescription} rows={2} />
      </FieldRow>

      {/* Live-billing warning — a plan's monthly price is the real renewal charge. */}
      <Card bg="$color3" borderColor="$color6" borderWidth={1} p="$2.5" gap="$1.5">
        <XStack gap="$2" items="center">
          <TriangleAlert size={15} color="$yellow10" />
          <Text fontSize="$2" fontWeight="700" color="$color12">
            Editing the price changes the real renewal charge
          </Text>
        </XStack>
        <Text fontSize="$1" color="$color11">
          The monthly price is what existing subscribers are billed on their next cycle. Change it deliberately.
        </Text>
      </Card>

      <FieldRow label="Monthly price (USD)">
        <FieldText value={price} onChange={setPrice} disabled={contactSales} placeholder="20" />
        <Text fontSize="$1" color="$color9" mt="$1">
          {contactSales ? 'Custom plan — price is “Contact sales”, not a number.' : `Stored as ${inputToCents(price)} cents. $0 = a free tier.`}
        </Text>
      </FieldRow>

      <FieldRow label="Annual price (USD /mo)">
        <FieldText value={annual} onChange={setAnnual} disabled={contactSales} placeholder="(optional) per-month when billed annually" />
      </FieldRow>

      <FieldRow label="Contact sales (custom)">
        <FieldSwitch checked={contactSales} onChange={setContactSales} />
        <Text fontSize="$1" color="$color9" mt="$1">
          A custom plan: the price is null (“Contact sales”), never $0.
        </Text>
      </FieldRow>

      <FieldRow label="Popular">
        <FieldSwitch checked={popular} onChange={setPopular} />
      </FieldRow>

      <FieldRow label="Per seat">
        <FieldSwitch checked={perSeat} onChange={setPerSeat} />
      </FieldRow>

      <FieldRow label="Trial days">
        <FieldText value={trialDays} onChange={setTrialDays} placeholder="0" />
      </FieldRow>

      {/* Features / limits envelope — the type-preserving key/value editor. */}
      <YStack gap="$2" borderTopWidth={1} borderColor="$borderColor" pt="$3">
        <XStack items="center" justify="space-between">
          <Text fontSize="$3" fontWeight="700">
            Features & limits (metadata)
          </Text>
          <Text fontSize="$1" color="$color10">
            {rows.length} field{rows.length === 1 ? '' : 's'}
          </Text>
        </XStack>
        <Text fontSize="$1" color="$color10">
          Free-form plan envelope. Numbers, booleans, arrays, and nested objects keep their JSON type.
        </Text>
        <MetadataEditor rows={rows} onChange={setRows} />
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
          {busy ? 'Saving…' : creating ? 'Create plan' : 'Save changes'}
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
            style={{ color: '#dc2626' }}
          >
            Delete
          </Button>
        ) : null}
      </XStack>
    </YStack>
  )
}
