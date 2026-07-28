'use client'

/**
 * admin.hanzo.ai GROWTH cockpit — the SuperAdmin operator view of the Zen-of-Hanzo
 * Guide engine (cloud `clients/guide`, `/v1/guide/*`). It makes the whole growth-OS
 * backend observable AND editable at a glance: the authored blueprint (64 archetype
 * principles + the launch journey), the strategy corpus (the ~888 modern + 114 heritage
 * tactics), and the org's own live growth read (stage · signals · key metrics · ranked
 * next-best moves). A UI to SCAN and OPERATE — summary before detail, state encoded in
 * form, one live enable/disable lever (PATCH) + inline edit per item.
 *
 * GLOBAL-ADMIN ONLY. The catalog entry is `admin: true` (hidden from every customer's
 * nav/palette) and this module additionally gates on `useIsSuperAdmin()` — the
 * matching UI gate over the authoritative server-side SuperAdmin gate (a non-admin sees
 * the honest SuperAdminRequired panel, never a 403 crash). Every read is REAL over
 * the `/v1` user-bearer BFF; honest loading/empty/error states throughout, no fabrication.
 *
 * SCOPE: the Live-state section reads the admin org's OWN `/v1/guide/profile` (Hanzo's
 * dogfood). The cross-tenant "every org's stage" macro table lands in `<GrowthOrgOverview>`
 * once the SuperAdmin cross-org endpoint ships — a clean drop-in seam, no rewiring.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import {
  Compass,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Pencil,
  Check,
  X,
  History,
  UploadCloud,
  Sparkles,
  Route as RouteIcon,
  Layers,
  ListChecks,
  Zap,
  TrendingUp,
  Database,
  Rocket,
  CircleCheck,
  Circle,
  Bot,
  Filter,
} from '@hanzogui/lucide-icons-2'

import { ApiError } from '~/lib/api'
import { useIsSuperAdmin } from '~/lib/auth/admin'
import {
  GuideBlueprintApi,
  GROWTH_STAGES,
  type BlueprintCollection,
  type BlueprintResult,
  type BlueprintVersion,
  type GrowthProfile,
  type GrowthSuggest,
  type Principle,
  type Section,
  type Step,
  type Strategy,
} from '~/lib/guide/client'
import { PageHeader } from '~/components/ui/PageHeader'
import { MetricCard, UtilBar, LegendDot } from '~/components/ui/Metric'
import { Panel } from '~/components/ui/Panel'
import { Donut, type Slice } from '~/components/ui/Charts'
import { RAMP } from '~/lib/theme/ramp'
import { asColor } from '~/components/ui/color'
import { ErrorState, asApiError, isForbidden, SuperAdminRequired } from '~/components/ui/States'
import { BackendStateCard, classifyRead } from '~/components/ui/BackendState'
import { EmptyState } from '~/components/ui/EmptyState'
import { FieldRow, FieldText, FieldTextArea } from '~/components/ui/Field'
import { useToast } from '~/components/ui/Toast'
import { toneColor } from '~/components/ui/tone'
import { toneVar } from '~/components/ui/tone'

// ── semantic palette (deliberately separate from the brand accent) ──────────
const ON = toneVar('positive') // enabled / on-track
const OFF = toneVar('critical') // disabled
const AUTO = toneVar('neutral') // automatable
/** Growth-stage semantic weights + copy — a stage is a state, carried by emphasis + label. */
const STAGE_META: Record<string, { label: string; color: string; blurb: string }> = {
  formed: { label: 'Formed', color: toneVar('muted'), blurb: 'Set up — org created, first config in place.' },
  launched: { label: 'Launched', color: toneVar('neutral'), blurb: 'Live — a site or app is shipped.' },
  activated: { label: 'Activated', color: toneVar('warning'), blurb: 'Traction — real usage and signups.' },
  scaling: { label: 'Scaling', color: toneVar('positive'), blurb: 'Growing — revenue is compounding.' },
}

const SINGULAR: Record<BlueprintCollection, string> = {
  principles: 'Principle',
  sections: 'Section',
  steps: 'Step',
  strategies: 'Strategy',
  templates: 'Template',
}

const usd = (cents: number): string => '$' + (cents / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })

// ── enable/disable toggle (state encoded in form) ───────────────────────────
function EnableToggle({ enabled, busy, onToggle }: { enabled: boolean; busy: boolean; onToggle: (next: boolean) => void }) {
  return (
    <XStack
      items="center"
      gap="$1.5"
      px="$2.5"
      py="$1.5"
      rounded="$10"
      borderWidth={1}
      borderColor="$borderColor"
      opacity={busy ? 0.5 : 1}
      cursor={busy ? 'default' : 'pointer'}
      pressStyle={busy ? undefined : { opacity: 0.7 }}
      onPress={() => !busy && onToggle(!enabled)}
      style={{ background: enabled ? 'rgba(220,220,220,0.12)' : 'rgba(160,160,160,0.10)' }}
    >
      <YStack width={8} height={8} rounded="$10" style={{ backgroundColor: enabled ? ON : toneVar('muted') }} />
      <Text fontSize="$1" fontWeight="600" style={{ color: enabled ? ON : toneVar('muted') }}>
        {enabled ? 'Enabled' : 'Disabled'}
      </Text>
    </XStack>
  )
}

// ── generic inline editor (PATCH one item's fields) ─────────────────────────
type EditField = { key: string; label: string; area?: boolean; list?: boolean }
const EDITABLE: Record<BlueprintCollection, EditField[]> = {
  principles: [
    { key: 'principle', label: 'Principle', area: true },
    { key: 'sunTzu', label: 'Sun Tzu concept' },
    { key: 'domain', label: 'Domain' },
  ],
  sections: [
    { key: 'title', label: 'Title' },
    { key: 'detail', label: 'Detail', area: true },
  ],
  steps: [
    { key: 'title', label: 'Title' },
    { key: 'detail', label: 'Detail', area: true },
    { key: 'tool', label: 'Tool' },
  ],
  strategies: [
    { key: 'action', label: 'Action', area: true },
    { key: 'category', label: 'Category' },
    { key: 'workload', label: 'Workload' },
    { key: 'tags', label: 'Tags (comma-separated)', list: true },
  ],
  templates: [
    { key: 'title', label: 'Title' },
    { key: 'body', label: 'Body', area: true },
  ],
}

function InlineEditor({
  fields,
  item,
  busy,
  onSave,
  onCancel,
}: {
  fields: EditField[]
  item: Record<string, unknown>
  busy: boolean
  onSave: (patch: Record<string, unknown>) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      fields.map((f) => [f.key, f.list && Array.isArray(item[f.key]) ? (item[f.key] as string[]).join(', ') : String(item[f.key] ?? '')]),
    ),
  )
  const set = (k: string, v: string) => setDraft((d) => ({ ...d, [k]: v }))
  const save = () => {
    const patch: Record<string, unknown> = {}
    for (const f of fields) {
      patch[f.key] = f.list ? draft[f.key].split(',').map((s) => s.trim()).filter(Boolean) : draft[f.key]
    }
    onSave(patch)
  }
  return (
    <YStack gap="$2.5" p="$3" mt="$2" rounded="$3" bg="$color2" borderWidth={1} borderColor="$borderColor">
      {fields.map((f) => (
        <FieldRow key={f.key} label={f.label}>
          {f.area ? (
            <FieldTextArea value={draft[f.key]} onChange={(v) => set(f.key, v)} disabled={busy} rows={3} />
          ) : (
            <FieldText value={draft[f.key]} onChange={(v) => set(f.key, v)} disabled={busy} />
          )}
        </FieldRow>
      ))}
      <XStack gap="$2" self="flex-end">
        <Button size="$2" chromeless icon={<X size={14} />} disabled={busy} onPress={onCancel}>
          Cancel
        </Button>
        <Button size="$2" theme="light" icon={<Check size={14} />} disabled={busy} onPress={save}>
          Save
        </Button>
      </XStack>
    </YStack>
  )
}

/** One expandable, toggleable, editable blueprint item — DRY across principles/steps/sections. */
function GuideItem({
  collection,
  id,
  enabled,
  header,
  detail,
  extra,
  item,
  expanded,
  editing,
  busy,
  onExpand,
  onEdit,
  onToggle,
  onSave,
}: {
  collection: BlueprintCollection
  id: string
  enabled: boolean
  header: ReactNode
  detail?: ReactNode
  extra?: ReactNode
  item: Record<string, unknown>
  expanded: boolean
  editing: boolean
  busy: boolean
  onExpand: () => void
  onEdit: (on: boolean) => void
  onToggle: (next: boolean) => void
  onSave: (patch: Record<string, unknown>) => void
}) {
  return (
    <YStack
      rounded="$3"
      borderWidth={1}
      borderColor="$borderColor"
      bg="$color2"
      p="$3"
      gap="$1"
      opacity={enabled ? 1 : 0.7}
    >
      <XStack items="center" gap="$2" flexWrap="wrap">
        <XStack items="center" gap="$2" flex={1} minW={0} cursor="pointer" onPress={onExpand}>
          {expanded ? <ChevronDown size={15} color="$color10" /> : <ChevronRight size={15} color="$color10" />}
          <YStack flex={1} minW={0}>{header}</YStack>
        </XStack>
        <XStack items="center" gap="$2">
          <Button size="$1" chromeless icon={<Pencil size={13} />} onPress={() => onEdit(!editing)} aria-label="Edit" />
          <EnableToggle enabled={enabled} busy={busy} onToggle={onToggle} />
        </XStack>
      </XStack>
      {expanded && (detail || extra) ? (
        <YStack gap="$2" pl="$6" pt="$1">
          {detail}
          {extra}
        </YStack>
      ) : null}
      {editing ? (
        <InlineEditor fields={EDITABLE[collection]} item={item} busy={busy} onSave={onSave} onCancel={() => onEdit(false)} />
      ) : null}
    </YStack>
  )
}

// A tiny inline chip.
function Chip({ children, tone }: { children: ReactNode; tone?: string }) {
  return (
    <XStack px="$2" py="$0.5" rounded="$10" bg="$color3" items="center">
      <Text fontSize="$1" style={tone ? { color: tone } : undefined} color={tone ? undefined : '$color11'}>
        {children}
      </Text>
    </XStack>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// BLUEPRINT — the Zen-of-Hanzo spine
// ════════════════════════════════════════════════════════════════════════════
function BlueprintPanel({
  bp,
  loading,
  err,
  reload,
  onMutated,
}: {
  bp: BlueprintResult | null
  loading: boolean
  err: ApiError | null
  reload: () => void
  onMutated: () => void
}) {
  const toast = useToast()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [versions, setVersions] = useState<BlueprintVersion[] | null>(null)
  const [publishing, setPublishing] = useState(false)

  const keyOf = (c: BlueprintCollection, id: string) => `${c}:${id}`
  const toggleExpand = (k: string) => setExpanded((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })

  const tacticsByPrinciple = useMemo(() => {
    const m = new Map<string, Strategy[]>()
    for (const s of bp?.blueprint.strategies ?? []) {
      const arr = m.get(s.principle) ?? []
      arr.push(s)
      m.set(s.principle, arr)
    }
    return m
  }, [bp])

  const stepsBySection = useMemo(() => {
    const m = new Map<string, Step[]>()
    for (const s of bp?.blueprint.steps ?? []) {
      const arr = m.get(s.section) ?? []
      arr.push(s)
      m.set(s.section, arr)
    }
    return m
  }, [bp])

  const patch = useCallback(
    async (c: BlueprintCollection, id: string, label: string, body: Record<string, unknown>, verb: string): Promise<boolean> => {
      setBusy(keyOf(c, id))
      try {
        await GuideBlueprintApi.patchItem(c, id, body)
        toast.success(verb, `${SINGULAR[c]} · ${label}`)
        onMutated()
        return true
      } catch (e) {
        toast.error('Could not update', asApiError(e).message)
        return false
      } finally {
        setBusy('')
      }
    },
    [toast, onMutated],
  )

  const doToggle = (c: BlueprintCollection, id: string, label: string, next: boolean) =>
    void patch(c, id, label, { enabled: next }, next ? 'Enabled' : 'Disabled')
  const doSave = (c: BlueprintCollection, id: string, label: string, body: Record<string, unknown>) => {
    void patch(c, id, label, body, 'Saved').then((ok) => { if (ok) setEditing(null) })
  }

  const publish = useCallback(async () => {
    if (!bp) return
    setPublishing(true)
    try {
      await GuideBlueprintApi.publish(bp.raw)
      toast.success('Published version', bp.blueprint.version || 'snapshot saved')
      if (showHistory) setVersions(await GuideBlueprintApi.versions())
      reload()
    } catch (e) {
      toast.error('Could not publish', asApiError(e).message)
    } finally {
      setPublishing(false)
    }
  }, [bp, toast, showHistory, reload])

  const openHistory = useCallback(async () => {
    const next = !showHistory
    setShowHistory(next)
    if (next && versions == null) {
      try {
        setVersions(await GuideBlueprintApi.versions())
      } catch {
        setVersions([])
      }
    }
  }, [showHistory, versions])

  if (err && isForbidden(err)) return <SuperAdminRequired />
  if (err) {
    const state = classifyRead(err)
    return state ? <BackendStateCard state={state} onRetry={reload} hint="GET /v1/guide/blueprint" /> : <ErrorState err={err} onRetry={reload} />
  }
  if (loading && !bp) return <Text color="$color10">Loading blueprint…</Text>
  if (!bp) return null
  const { blueprint } = bp

  const renderPrinciple = (p: Principle) => {
    const k = keyOf('principles', p.slug)
    const tactics = tacticsByPrinciple.get(p.slug) ?? []
    return (
      <GuideItem
        key={k}
        collection="principles"
        id={p.slug}
        enabled={p.enabled}
        item={p as unknown as Record<string, unknown>}
        expanded={expanded.has(k)}
        editing={editing === k}
        busy={busy === k}
        onExpand={() => toggleExpand(k)}
        onEdit={(on) => setEditing(on ? k : null)}
        onToggle={(next) => doToggle('principles', p.slug, p.name, next)}
        onSave={(body) => doSave('principles', p.slug, p.name, body)}
        header={
          <XStack items="center" gap="$2" flexWrap="wrap">
            <Text fontSize="$5">{p.hexagram || '·'}</Text>
            <Text fontSize="$3" fontWeight="600" color="$color12">{p.name}</Text>
            <Text fontSize="$1" color="$color9">#{p.n}</Text>
            {p.domain ? <Chip>{p.domain}</Chip> : null}
            {p.sunTzu ? <Chip tone={AUTO}>{p.sunTzu}</Chip> : null}
          </XStack>
        }
        detail={p.principle ? <Text fontSize="$2" color="$color11">{p.principle}</Text> : undefined}
        extra={
          <YStack gap="$1.5">
            {p.change ? <Text fontSize="$1" color="$color9">Change: {p.change}</Text> : null}
            <Text fontSize="$1" color="$color10" fontWeight="600">{tactics.length} tactic{tactics.length === 1 ? '' : 's'}</Text>
            {tactics.slice(0, 8).map((t) => (
              <XStack key={t.id} gap="$2" items="center">
                <YStack width={5} height={5} rounded="$10" style={{ backgroundColor: t.enabled ? ON : toneVar('muted') }} />
                <Text fontSize="$1" color="$color11" flex={1} numberOfLines={1}>{t.action}</Text>
              </XStack>
            ))}
            {tactics.length > 8 ? <Text fontSize="$1" color="$color9">+{tactics.length - 8} more in the Corpus tab</Text> : null}
          </YStack>
        }
      />
    )
  }

  const renderStep = (s: Step) => {
    const k = keyOf('steps', s.id)
    return (
      <GuideItem
        key={k}
        collection="steps"
        id={s.id}
        enabled={s.enabled}
        item={s as unknown as Record<string, unknown>}
        expanded={expanded.has(k)}
        editing={editing === k}
        busy={busy === k}
        onExpand={() => toggleExpand(k)}
        onEdit={(on) => setEditing(on ? k : null)}
        onToggle={(next) => doToggle('steps', s.id, s.title, next)}
        onSave={(body) => doSave('steps', s.id, s.title, body)}
        header={
          <XStack items="center" gap="$2" flexWrap="wrap">
            <Text fontSize="$3" color="$color12" flex={1} minW={0} numberOfLines={1}>{s.title}</Text>
            {s.tool ? <Chip tone={AUTO}>{s.tool}</Chip> : null}
          </XStack>
        }
        detail={s.detail ? <Text fontSize="$2" color="$color11">{s.detail}</Text> : undefined}
        extra={s.deps.length ? <Text fontSize="$1" color="$color9">Depends on: {s.deps.join(', ')}</Text> : undefined}
      />
    )
  }

  const renderSection = (sec: Section) => {
    const steps = stepsBySection.get(sec.id) ?? []
    const k = keyOf('sections', sec.id)
    return (
      <YStack key={k} gap="$2">
        <GuideItem
          collection="sections"
          id={sec.id}
          enabled={sec.enabled}
          item={sec as unknown as Record<string, unknown>}
          expanded={expanded.has(k)}
          editing={editing === k}
          busy={busy === k}
          onExpand={() => toggleExpand(k)}
          onEdit={(on) => setEditing(on ? k : null)}
          onToggle={(next) => doToggle('sections', sec.id, sec.title, next)}
          onSave={(body) => doSave('sections', sec.id, sec.title, body)}
          header={
            <XStack items="center" gap="$2">
              <Layers size={14} color="$color10" />
              <Text fontSize="$4" fontWeight="600" color="$color12">{sec.title || sec.id}</Text>
              <Text fontSize="$1" color="$color9">{steps.length} step{steps.length === 1 ? '' : 's'}</Text>
            </XStack>
          }
          detail={sec.detail ? <Text fontSize="$2" color="$color11">{sec.detail}</Text> : undefined}
        />
        <YStack gap="$1.5" pl="$4">{steps.map(renderStep)}</YStack>
      </YStack>
    )
  }

  // Steps that belong to no declared section render under a synthetic "Unsectioned" group.
  const knownSections = new Set(blueprint.sections.map((s) => s.id))
  const orphanSteps = blueprint.steps.filter((s) => !s.section || !knownSections.has(s.section))
  const enabledCount = <T extends { enabled: boolean }>(a: T[]) => a.filter((x) => x.enabled).length

  return (
    <YStack gap="$4">
      {/* version + publish + history toolbar */}
      <Card p="$3" gap="$3" borderWidth={1} borderColor="$borderColor" bg="$color2">
        <XStack items="center" justify="space-between" gap="$2" flexWrap="wrap">
          <XStack items="center" gap="$2" flexWrap="wrap">
            <Sparkles size={16} color="$color11" />
            <Text fontSize="$4" fontWeight="600" color="$color12">{blueprint.title || 'The Zen of Hanzo'}</Text>
            <Chip tone={AUTO}>version {blueprint.version || '—'}</Chip>
            {blueprint.brand ? <Chip>{blueprint.brand}</Chip> : null}
            <Chip tone={blueprint.enabled ? ON : OFF}>{blueprint.enabled ? 'guide live' : 'guide off'}</Chip>
          </XStack>
          <XStack items="center" gap="$2">
            <Button size="$2" chromeless icon={<History size={14} />} onPress={openHistory}>
              {showHistory ? 'Hide history' : 'History'}
            </Button>
            <Button size="$2" theme="light" icon={<UploadCloud size={14} />} disabled={publishing} onPress={publish}>
              Publish version
            </Button>
          </XStack>
        </XStack>
        {showHistory ? (
          versions == null ? (
            <Text fontSize="$1" color="$color10">Loading history…</Text>
          ) : versions.length === 0 ? (
            <Text fontSize="$1" color="$color9">No prior versions recorded yet.</Text>
          ) : (
            <YStack gap="$1">
              {versions.map((v, i) => (
                <XStack key={`${v.version}:${i}`} gap="$2" items="center" justify="space-between">
                  <Text fontSize="$1" color="$color11" className="hz-mono">version {v.version || '—'}</Text>
                  <Text fontSize="$1" color="$color9" numberOfLines={1}>{v.note || (v.savedAt ? new Date(v.savedAt).toLocaleString() : '')}</Text>
                </XStack>
              ))}
            </YStack>
          )
        ) : null}
      </Card>

      {/* THE 64 PRINCIPLES */}
      <YStack gap="$2">
        <XStack items="center" gap="$2" flexWrap="wrap">
          <Text fontSize="$5" color="$color12">Principles</Text>
          <Text fontSize="$1" color="$color10">
            {blueprint.principles.length} archetypes · {enabledCount(blueprint.principles)} enabled — each an I Ching hexagram fused with a Sun Tzu concept.
          </Text>
        </XStack>
        {blueprint.principles.length === 0 ? (
          <Text fontSize="$2" color="$color9">No principles authored yet.</Text>
        ) : (
          <YStack gap="$1.5">{blueprint.principles.map(renderPrinciple)}</YStack>
        )}
      </YStack>

      {/* THE JOURNEY */}
      <YStack gap="$2">
        <XStack items="center" gap="$2" flexWrap="wrap">
          <Text fontSize="$5" color="$color12">Journey</Text>
          <Text fontSize="$1" color="$color10">
            {blueprint.sections.length} sections · {blueprint.steps.length} steps ({enabledCount(blueprint.steps)} enabled) — each step names its tool + dependencies.
          </Text>
        </XStack>
        {blueprint.sections.length === 0 && blueprint.steps.length === 0 ? (
          <Text fontSize="$2" color="$color9">No journey steps authored yet.</Text>
        ) : (
          <YStack gap="$3">
            {blueprint.sections.map(renderSection)}
            {orphanSteps.length ? (
              <YStack gap="$2">
                <XStack items="center" gap="$2"><ListChecks size={14} color="$color10" /><Text fontSize="$4" fontWeight="600" color="$color12">Other steps</Text></XStack>
                <YStack gap="$1.5" pl="$4">{orphanSteps.map(renderStep)}</YStack>
              </YStack>
            ) : null}
          </YStack>
        )}
      </YStack>
    </YStack>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// CORPUS — the strategic genome (~888 tactics)
// ════════════════════════════════════════════════════════════════════════════
const CORPUS_ROW_CAP = 60

function CorpusPanel({ nonce }: { nonce: number }) {
  const [all, setAll] = useState<Strategy[] | null>(null)
  const [rows, setRows] = useState<Strategy[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<ApiError | null>(null)
  const [category, setCategory] = useState('')
  const [workload, setWorkload] = useState('')
  const [stage, setStage] = useState('')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [retry, setRetry] = useState(0)

  // Baseline (unfiltered) — powers the facet options, the coverage summary, and the total.
  useEffect(() => {
    let live = true
    setLoading(true)
    setErr(null)
    GuideBlueprintApi.strategies({})
      .then((s) => { if (live) { setAll(s); setRows(s) } })
      .catch((e) => { if (live) setErr(asApiError(e)) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [nonce, retry])

  // Filtered browse — re-fetch server-side when a facet changes (the endpoint owns `stage`).
  useEffect(() => {
    if (all == null) return // wait for the baseline
    if (!category && !workload && !stage) { setRows(all); return }
    let live = true
    GuideBlueprintApi.strategies({ category, workload, stage })
      .then((s) => { if (live) setRows(s) })
      .catch(() => { if (live) setRows([]) })
    return () => { live = false }
  }, [category, workload, stage, all])

  const facet = (pick: (s: Strategy) => string): string[] =>
    Array.from(new Set((all ?? []).map(pick).filter(Boolean))).sort()
  const categories = useMemo(() => facet((s) => s.category), [all])
  const workloads = useMemo(() => facet((s) => s.workload), [all])

  const coverage = useMemo<Slice[]>(() => {
    const counts = new Map<string, number>()
    for (const s of all ?? []) counts.set(s.category || 'uncategorized', (counts.get(s.category || 'uncategorized') ?? 0) + 1)
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
    const top = sorted.slice(0, 7).map(([label, value], i) => ({ label, value, color: RAMP[i % RAMP.length] }))
    const rest = sorted.slice(7).reduce((n, [, v]) => n + v, 0)
    return rest > 0 ? [...top, { label: 'other', value: rest, color: toneVar('muted') }] : top
  }, [all])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    const base = rows ?? []
    return q ? base.filter((s) => `${s.action} ${s.principle} ${s.tags.join(' ')} ${s.source}`.toLowerCase().includes(q)) : base
  }, [rows, search])

  if (err && isForbidden(err)) return <SuperAdminRequired />
  if (err) {
    const onRetry = () => setRetry((r) => r + 1)
    const state = classifyRead(err)
    return state ? <BackendStateCard state={state} onRetry={onRetry} hint="GET /v1/guide/strategies" /> : <ErrorState err={err} onRetry={onRetry} />
  }
  if (loading && all == null) return <Text color="$color10">Loading corpus…</Text>

  const total = all?.length ?? 0
  const capped = shown.slice(0, CORPUS_ROW_CAP)
  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const selectStyle = { background: 'var(--background)', color: 'var(--color12)', border: '1px solid var(--borderColor)', borderRadius: 8, padding: '8px 10px', fontSize: 13, height: 38 } as const

  return (
    <YStack gap="$4">
      {/* scale + coverage summary — make the genome legible before the detail */}
      <XStack gap="$4" flexWrap="wrap">
        <XStack gap="$3" flexWrap="wrap" flex={1} minW={280}>
          <MetricCard icon={<Sparkles size={15} />} label="Tactics" value={total.toLocaleString()} caption="the enabled corpus" />
          <MetricCard icon={<Filter size={15} />} label="In view" value={shown.length.toLocaleString()} caption={category || workload || stage || search ? 'filtered' : 'all'} />
          <MetricCard icon={<Layers size={15} />} label="Categories" value={String(categories.length)} caption="coverage areas" />
        </XStack>
        <Panel title="Category coverage" grow={false} minW={280}>
          {coverage.length ? (
            <Donut slices={coverage} legend size={140} center={<Text fontSize="$5" fontWeight="800" color="$color12">{total}</Text>} />
          ) : (
            <Text fontSize="$2" color="$color9">No categories yet.</Text>
          )}
        </Panel>
      </XStack>

      {/* filters */}
      <XStack gap="$3" items="flex-end" flexWrap="wrap">
        <YStack gap="$1" minW={160}>
          <Text fontSize="$1" color="$color10">Category</Text>
          <select value={category} onChange={(e) => setCategory(e.currentTarget.value)} style={selectStyle}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </YStack>
        <YStack gap="$1" minW={160}>
          <Text fontSize="$1" color="$color10">Workload</Text>
          <select value={workload} onChange={(e) => setWorkload(e.currentTarget.value)} style={selectStyle}>
            <option value="">All workloads</option>
            {workloads.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </YStack>
        <YStack gap="$1" minW={140}>
          <Text fontSize="$1" color="$color10">Stage</Text>
          <select value={stage} onChange={(e) => setStage(e.currentTarget.value)} style={selectStyle}>
            <option value="">Any stage</option>
            {GROWTH_STAGES.map((s) => <option key={s} value={s}>{STAGE_META[s]?.label ?? s}</option>)}
          </select>
        </YStack>
        <YStack gap="$1" flex={1} minW={200}>
          <Text fontSize="$1" color="$color10">Search actions</Text>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. launch, referral, SEO"
            style={{ ...selectStyle, cursor: 'text' }} />
        </YStack>
        {(category || workload || stage || search) ? (
          <Button size="$2" chromeless icon={<X size={13} />} onPress={() => { setCategory(''); setWorkload(''); setStage(''); setSearch('') }}>Clear</Button>
        ) : null}
      </XStack>

      {/* rows */}
      {shown.length === 0 ? (
        <EmptyState icon={Sparkles} title="No tactics match" description="Clear a filter to widen the corpus. The strategic genome is enabled-only here." />
      ) : (
        <YStack gap="$1.5">
          {capped.map((s) => (
            <YStack key={s.id} rounded="$3" borderWidth={1} borderColor="$borderColor" bg="$color2" p="$3" gap="$1">
              <XStack items="center" gap="$2" cursor="pointer" onPress={() => toggle(s.id)} flexWrap="wrap">
                {expanded.has(s.id) ? <ChevronDown size={14} color="$color10" /> : <ChevronRight size={14} color="$color10" />}
                <Text fontSize="$2" color="$color12" flex={1} minW={0}>{s.action}</Text>
                {s.category ? <Chip>{s.category}</Chip> : null}
                {s.workload ? <Chip tone={AUTO}>{s.workload}</Chip> : null}
              </XStack>
              <XStack gap="$2" items="center" pl="$6" flexWrap="wrap">
                {s.principle ? <Text fontSize="$1" color="$color9">↳ {s.principle}</Text> : null}
                {s.tags.slice(0, 6).map((t) => <Text key={t} fontSize="$1" color="$color10">#{t}</Text>)}
                {s.source ? <Text fontSize="$1" color="$color9">· {s.source}{s.era ? ` (${s.era})` : ''}</Text> : null}
              </XStack>
              {expanded.has(s.id) ? (
                <YStack gap="$1.5" pl="$6" pt="$1">
                  {s.blog.why ? <Text fontSize="$1" color="$color11"><Text fontSize="$1" color="$color9">Why · </Text>{s.blog.why}</Text> : null}
                  {s.blog.how ? <Text fontSize="$1" color="$color11"><Text fontSize="$1" color="$color9">How · </Text>{s.blog.how}</Text> : null}
                  {s.blog.caseStudy ? <Text fontSize="$1" color="$color11"><Text fontSize="$1" color="$color9">Case study · </Text>{s.blog.caseStudy}</Text> : null}
                  {!s.blog.why && !s.blog.how && !s.blog.caseStudy ? <Text fontSize="$1" color="$color9">No blog stub authored for this tactic.</Text> : null}
                </YStack>
              ) : null}
            </YStack>
          ))}
          {shown.length > CORPUS_ROW_CAP ? (
            <Text fontSize="$1" color="$color9" p="$2">Showing {CORPUS_ROW_CAP} of {shown.length.toLocaleString()} — refine the filters to narrow the corpus.</Text>
          ) : null}
        </YStack>
      )}
    </YStack>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// LIVE STATE — the Guide's read for the org (dogfood)
// ════════════════════════════════════════════════════════════════════════════

/** Growth-stage indicator (formed → launched → activated → scaling). */
function StageStepper({ stage }: { stage: string }) {
  const idx = GROWTH_STAGES.indexOf(stage as (typeof GROWTH_STAGES)[number])
  return (
    <XStack gap="$2" items="stretch" flexWrap="wrap">
      {GROWTH_STAGES.map((s, i) => {
        const meta = STAGE_META[s]
        const active = i === idx
        const reached = idx >= 0 && i <= idx
        return (
          <YStack key={s} flex={1} minW={150} p="$3" gap="$1" rounded="$3" borderWidth={active ? 2 : 1}
            borderColor="$borderColor"
            style={{ borderColor: active ? meta.color : undefined, background: reached ? `${meta.color}1f` : undefined, opacity: reached ? 1 : 0.55 }}>
            <XStack items="center" gap="$1.5">
              <YStack width={9} height={9} rounded="$10" style={{ backgroundColor: reached ? meta.color : toneVar('muted') }} />
              <Text fontSize="$2" fontWeight="700" style={{ color: reached ? meta.color : toneVar('muted') }}>{meta.label}</Text>
              {active ? <Text fontSize="$1" color="$color9">· now</Text> : null}
            </XStack>
            <Text fontSize="$1" color="$color10">{meta.blurb}</Text>
          </YStack>
        )
      })}
    </XStack>
  )
}

function LivePanel({ nonce }: { nonce: number }) {
  const [profile, setProfile] = useState<GrowthProfile | null>(null)
  const [suggest, setSuggest] = useState<GrowthSuggest | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<ApiError | null>(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let live = true
    setLoading(true)
    setErr(null)
    // Two independent reads — one failing never blanks the other (honest, resilient).
    Promise.allSettled([GuideBlueprintApi.profile(), GuideBlueprintApi.suggest()]).then(([p, s]) => {
      if (!live) return
      if (p.status === 'fulfilled') setProfile(p.value)
      else setErr(asApiError(p.reason))
      if (s.status === 'fulfilled') setSuggest(s.value)
      setLoading(false)
    })
    return () => { live = false }
  }, [nonce, retry])

  if (err && isForbidden(err)) return <SuperAdminRequired />
  if (err && !profile) {
    const onRetry = () => setRetry((r) => r + 1)
    const state = classifyRead(err)
    return state ? <BackendStateCard state={state} onRetry={onRetry} hint="GET /v1/guide/profile" /> : <ErrorState err={err} onRetry={onRetry} />
  }
  if (loading && !profile) return <Text color="$color10">Loading live state…</Text>

  const km = profile?.keyMetrics
  const funnel = km?.funnel
  const funnelStages = funnel ? [funnel.pageviews, funnel.visitors, funnel.signups, funnel.orders] : []
  const signals = Object.entries(profile?.signals ?? {})

  return (
    <YStack gap="$4">
      {/* stage indicator */}
      <YStack gap="$2">
        <Text fontSize="$5" color="$color12">Growth stage</Text>
        <StageStepper stage={profile?.stage ?? 'formed'} />
      </YStack>

      {/* key metrics */}
      <XStack gap="$3" flexWrap="wrap">
        <MetricCard icon={<TrendingUp size={15} />} label="Revenue" value={km ? usd(km.revenueCents) : '—'} caption="lifetime, metered" />
        <MetricCard icon={<Database size={15} />} label="Records" value={km ? km.records.toLocaleString() : '—'} caption="business objects" />
        <MetricCard icon={<Rocket size={15} />} label="Launch progress" value={km ? `${Math.round(km.launchProgress)}%` : '—'}
          caption="journey completion" spark={funnelStages.length >= 2 ? funnelStages : undefined} sparkColor={ON} />
        <MetricCard icon={<Zap size={15} />} label="Orders" value={funnel ? funnel.orders.toLocaleString() : '—'} caption={funnel ? `${funnel.signups.toLocaleString()} signups` : 'top-of-funnel'} />
      </XStack>

      <XStack gap="$4" flexWrap="wrap">
        {/* funnel */}
        <Panel title="Funnel" grow minW={280}>
          {funnel ? (
            <YStack gap="$2">
              {km ? <UtilBar value={Math.min(100, km.launchProgress)} width={240} color={ON} /> : null}
              <LegendDot color={toneVar("neutral")} label="Pageviews" value={funnel.pageviews.toLocaleString()} />
              <LegendDot color={toneVar("muted")} label="Visitors" value={funnel.visitors.toLocaleString()} />
              <LegendDot color={toneVar('warning')} label="Signups" value={funnel.signups.toLocaleString()} />
              <LegendDot color={ON} label="Orders" value={funnel.orders.toLocaleString()} />
            </YStack>
          ) : (
            <Text fontSize="$2" color="$color9">No funnel data yet — connect analytics to light this up.</Text>
          )}
        </Panel>

        {/* signals */}
        <Panel title="Signals" grow minW={280}>
          {signals.length === 0 ? (
            <Text fontSize="$2" color="$color9">No signals reported yet.</Text>
          ) : (
            <XStack gap="$2" flexWrap="wrap">
              {signals.map(([name, on]) => (
                <XStack key={name} items="center" gap="$1.5" px="$2.5" py="$1.5" rounded="$10" borderWidth={1} borderColor="$borderColor"
                  style={{ background: on ? 'rgba(220,220,220,0.12)' : 'rgba(160,160,160,0.08)' }}>
                  {on ? <CircleCheck size={13} color={toneColor('positive')} /> : <Circle size={13} color={toneColor('muted')} />}
                  <Text fontSize="$1" style={{ color: on ? ON : toneVar('muted') }}>{name}</Text>
                </XStack>
              ))}
            </XStack>
          )}
        </Panel>
      </XStack>

      {/* ranked next-best moves */}
      <YStack gap="$2">
        <XStack items="center" gap="$2" flexWrap="wrap">
          <Text fontSize="$5" color="$color12">Next-best moves</Text>
          <Text fontSize="$1" color="$color10">Ranked by leverage from the org&apos;s live progress.</Text>
        </XStack>
        {!suggest || suggest.suggestions.length === 0 ? (
          <Text fontSize="$2" color="$color9">{suggest ? 'The journey is complete — no moves queued.' : 'Suggestions unavailable.'}</Text>
        ) : (
          <YStack gap="$1.5">
            {suggest.suggestions.map((m) => (
              <YStack key={m.stepId} rounded="$3" borderWidth={1} borderColor="$borderColor" bg="$color2" p="$3" gap="$1"
                style={m.stepId === suggest.next ? { borderColor: ON } : undefined}>
                <XStack items="center" gap="$2" flexWrap="wrap">
                  <Text fontSize="$3" fontWeight="600" color="$color12" flex={1} minW={0}>{m.title}</Text>
                  {m.stepId === suggest.next ? <Chip tone={ON}>do next</Chip> : null}
                  {m.automatable ? (
                    <XStack items="center" gap="$1"><Bot size={12} color={asColor(AUTO)} /><Text fontSize="$1" style={{ color: AUTO }}>automatable</Text></XStack>
                  ) : null}
                  {m.unlocks > 0 ? <Chip>unblocks {m.unlocks}</Chip> : null}
                </XStack>
                {m.why ? <Text fontSize="$2" color="$color11">{m.why}</Text> : null}
                {m.rationale ? <Text fontSize="$1" color="$color9">{m.rationale}</Text> : null}
              </YStack>
            ))}
          </YStack>
        )}
        {suggest && suggest.recommendations.length ? (
          <YStack gap="$1" pt="$1">
            {suggest.recommendations.map((r, i) => (
              <XStack key={i} gap="$2" items="flex-start"><Text fontSize="$2" color="$color10">•</Text><Text fontSize="$2" color="$color11" flex={1}>{r}</Text></XStack>
            ))}
          </YStack>
        ) : null}
      </YStack>

      {/* SEAM: the cross-tenant all-orgs macro table drops in here. */}
      <GrowthOrgOverview />
    </YStack>
  )
}

/**
 * SEAM for the cross-tenant "every org's growth stage" macro table. This build reads the
 * admin org's OWN `/v1/guide/profile` (Hanzo's dogfood) above; the all-orgs table needs a
 * new SuperAdmin cross-org endpoint (a follow-on: `GET /v1/admin/guide/orgs`). This panel is
 * the drop-in point — wiring the table later is additive (fetch the aggregate here, render
 * an org → stage grid), no rewiring of the module.
 */
export function GrowthOrgOverview() {
  return (
    <Card p="$4" gap="$2" borderWidth={1} borderStyle="dashed" borderColor="$borderColor" bg="$color2">
      <XStack items="center" gap="$2">
        <Compass size={15} color="$color10" />
        <Text fontSize="$3" fontWeight="600" color="$color12">All-org growth overview</Text>
      </XStack>
      <Text fontSize="$1" color="$color10">
        The cross-tenant macro table (every org&apos;s stage, funnel, and top move) slots in here once the SuperAdmin
        cross-org endpoint lands. This build shows the admin org&apos;s own live read above (dogfood).
      </Text>
    </Card>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// MODULE
// ════════════════════════════════════════════════════════════════════════════
type Tab = 'blueprint' | 'corpus' | 'live'
const TABS: { key: Tab; label: string; icon: typeof Compass }[] = [
  { key: 'blueprint', label: 'Blueprint', icon: Sparkles },
  { key: 'corpus', label: 'Corpus', icon: RouteIcon },
  { key: 'live', label: 'Live state', icon: TrendingUp },
]

export function GrowthModule() {
  const isSuper = useIsSuperAdmin()
  const [section, setSection] = useState<Tab>('blueprint')
  const [nonce, setNonce] = useState(0)
  const [bp, setBp] = useState<BlueprintResult | null>(null)
  const [bpErr, setBpErr] = useState<ApiError | null>(null)
  const [bpLoading, setBpLoading] = useState(true)

  const loadBlueprint = useCallback(async () => {
    setBpLoading(true)
    setBpErr(null)
    try {
      setBp(await GuideBlueprintApi.blueprint())
    } catch (e) {
      setBpErr(asApiError(e))
    } finally {
      setBpLoading(false)
    }
  }, [])

  useEffect(() => { if (isSuper) void loadBlueprint() }, [isSuper, loadBlueprint, nonce])

  if (!isSuper) {
    return (
      <YStack p="$5" gap="$4">
        <PageHeader title="Growth" subtitle="The Zen-of-Hanzo Guide engine — operator cockpit." />
        <SuperAdminRequired />
      </YStack>
    )
  }

  const refresh = () => setNonce((n) => n + 1)

  return (
    <YStack p="$5" gap="$4">
      <PageHeader
        title="Growth"
        subtitle="Observe and operate the Zen-of-Hanzo Guide engine — the authored blueprint, the strategy corpus, and the live growth read. Global-admin only."
        actions={
          <XStack items="center" gap="$2" flexWrap="wrap">
            {bp ? <Chip tone={AUTO}>version {bp.blueprint.version || '—'}</Chip> : null}
            <Button size="$3" icon={<RefreshCw size={15} />} onPress={refresh}>Refresh</Button>
          </XStack>
        }
      />

      {/* section tabs — a UI to scan and operate */}
      <XStack gap="$1" bg="$color3" rounded="$4" p="$1" self="flex-start" flexWrap="wrap">
        {TABS.map((t) => {
          const Icon = t.icon
          const on = section === t.key
          return (
            <Button key={t.key} size="$2" chromeless={!on} icon={<Icon size={14} />} onPress={() => setSection(t.key)}>
              {t.label}
            </Button>
          )
        })}
      </XStack>

      {section === 'blueprint' ? (
        <BlueprintPanel bp={bp} loading={bpLoading} err={bpErr} reload={loadBlueprint} onMutated={loadBlueprint} />
      ) : section === 'corpus' ? (
        <CorpusPanel nonce={nonce} />
      ) : (
        <LivePanel nonce={nonce} />
      )}
    </YStack>
  )
}
