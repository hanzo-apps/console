'use client'

/**
 * Cap Table — the per-org capitalization ledger as a dashboard over the REAL cloud
 * `/v1/captable` surface (cloud `clients/captable`, HIP-0106). Tabs: Summary (the
 * computed cap table — fully-diluted totals, an ownership donut, per-share-class
 * authorized-vs-issued, and the convertibles/rounds roll-up) · Stakeholders · Shares
 * (issued certificates) · Classes (share classes) · Fundraising (SAFEs + rounds).
 * Forms add a stakeholder, issue shares, create a share class, record a SAFE, and open
 * a round — each a THIN POST to the live endpoint; the cap-table MATH is computed
 * server-side (the `summary` route), never here.
 *
 * Every read/write is same-origin, keyless and org-scoped SERVER-SIDE — the `/v1`
 * bearer BFF mints a short-lived user token and the backend resolves the org from the
 * token owner (which selects the tenant DB file AND scopes every row), so a browser can
 * never read or write another org's cap table. States are honest: a Loader, a
 * BackendStateCard on failure, and real empty states — it never fabricates a holder or
 * a certificate.
 */
import { SubNav } from '~/components/ui/SubNav'
import { productSubpageSlug } from '~/lib/products/match'
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import {
  Coins, Layers, Percent, Plus, RefreshCw, ScrollText, Table as TableIcon, Trash2,
  TrendingUp, Users,
} from '@hanzogui/lucide-icons-2'

import {
  CapTableApi,
  STAKEHOLDER_TYPES,
  STAKEHOLDER_RELATIONSHIPS,
  SHARE_CLASS_TYPES,
  SECURITIES_STATUS,
  SAFE_TYPES,
  SAFE_STATUS,
  ROUND_TYPES,
  enumLabel,
  ownershipSlices,
  convertibleCapital,
  usd,
  int,
  pct,
  today,
  validateStakeholder,
  validateShareForm,
  validateShareClassForm,
  validateSafeForm,
  validateRoundForm,
  type CapTableSummary,
  type Stakeholder,
  type ShareClass,
  type Share,
  type Safe,
  type Round,
} from '~/lib/api/captable'
import { PageHeader } from '~/components/ui/PageHeader'
import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { EmptyState } from '~/components/ui/EmptyState'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { StatusTag } from '~/components/ui/StatusTag'
import { SlideOver } from '~/components/ui/SlideOver'
import { FieldRow, FieldText, FieldSelect, FieldOptionSelect } from '~/components/ui/Field'
import { MetricCard } from '~/components/ui/Metric'
import { Donut } from '~/components/ui/Charts'
import { RAMP } from '~/lib/theme/ramp'
import { Loader } from '~/components/ui/Loader'
import { useToast } from '~/components/ui/Toast'
import { ConfirmDelete } from '~/components/ui/ConfirmDelete'
import { toneColor } from '~/components/ui/tone'

type Tab = 'summary' | 'stakeholders' | 'shares' | 'classes' | 'fundraising'
const tabPath = (id: Tab): string => (id === 'summary' ? '/captable' : `/captable/${id}`)

const enumOpts = (xs: readonly string[]) => xs.map((v) => ({ value: v, label: enumLabel(v) }))

// ── Async cell ────────────────────────────────────────────────────────────────
type Async<T> = { phase: 'loading' } | { phase: 'error'; error: BackendState } | { phase: 'ready'; data: T }

function useList<T>(load: () => Promise<T>): [Async<T>, () => void] {
  const [state, setState] = useState<Async<T>>({ phase: 'loading' })
  const run = useCallback(() => {
    setState({ phase: 'loading' })
    load()
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [load])
  useEffect(() => {
    run()
  }, [run])
  return [state, run]
}

// ── Summary tab ────────────────────────────────────────────────────────────────

function OwnershipDonut({ summary }: { summary: CapTableSummary }) {
  const slices = ownershipSlices(summary).map((s, i) => ({ ...s, color: RAMP[i % RAMP.length] }))
  if (slices.length === 0) {
    return <Text fontSize="$2" color="$color10">No equity issued yet — issue shares to see the ownership split.</Text>
  }
  return (
    <XStack gap="$5" items="center" flexWrap="wrap">
      <Donut slices={slices} size={168} center={<YStack items="center"><Text fontSize="$2" color="$color10">Holders</Text><Text fontSize="$6" fontWeight="600" className="hz-mono">{summary.byStakeholder.length}</Text></YStack>} />
      <YStack gap="$2" flex={1} minW={220}>
        {slices.slice(0, 8).map((s) => {
          const holder = summary.byStakeholder.find((h) => (h.name || 'Unnamed') === s.label)
          return (
            <XStack key={s.label} items="center" gap="$2" justify="space-between">
              <XStack items="center" gap="$2" minW={0} flex={1}>
                <XStack width={10} height={10} rounded="$10" style={{ backgroundColor: s.color }} />
                <Text fontSize="$2" color="$color12" numberOfLines={1}>{s.label}</Text>
              </XStack>
              <Text fontSize="$2" color="$color11" className="hz-tnum">{holder ? pct(holder.ownershipPct) : ''}</Text>
            </XStack>
          )
        })}
      </YStack>
    </XStack>
  )
}

function SummaryTab({ summary }: { summary: CapTableSummary }) {
  const t = summary.totals
  const conv = summary.convertibles
  return (
    <YStack gap="$4">
      <XStack gap="$3" flexWrap="wrap">
        <MetricCard icon={<Coins size={16} color="$color11" />} label="Fully diluted" value={int(t.fullyDilutedShares)} caption="shares (incl. granted options)" />
        <MetricCard icon={<ScrollText size={16} color={toneColor('positive')} />} label="Outstanding" value={int(t.outstandingShares)} caption="issued shares" />
        <MetricCard icon={<Percent size={16} color={toneColor('warning')} />} label="Options" value={int(t.grantedOptions)} caption="granted, dilutive" />
        <MetricCard icon={<Users size={16} color={toneColor('neutral')} />} label="Stakeholders" value={int(t.stakeholders)} caption={`${int(t.shareClasses)} share class${t.shareClasses === 1 ? '' : 'es'}`} />
      </XStack>

      <XStack gap="$4" flexWrap="wrap">
        <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" flex={1} minW={320}>
          <Text fontSize="$4" fontWeight="500" color="$color12">Ownership (fully diluted)</Text>
          <OwnershipDonut summary={summary} />
        </Card>
        <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" flex={1} minW={280}>
          <Text fontSize="$4" fontWeight="500" color="$color12">Convertibles & rounds</Text>
          <YStack gap="$2">
            <XStack justify="space-between"><Text fontSize="$2" color="$color10">SAFEs</Text><Text fontSize="$2" color="$color12" className="hz-tnum">{conv.safes.count} · {usd(conv.safes.capital)}</Text></XStack>
            <XStack justify="space-between"><Text fontSize="$2" color="$color10">Convertible notes</Text><Text fontSize="$2" color="$color12" className="hz-tnum">{conv.notes.count} · {usd(conv.notes.capital)}</Text></XStack>
            <XStack justify="space-between"><Text fontSize="$2" color="$color10">Convertible capital</Text><Text fontSize="$2" color="$color12" className="hz-tnum">{usd(convertibleCapital(summary))}</Text></XStack>
            <XStack justify="space-between" pt="$2" borderColor="$borderColor" style={{ borderTopWidth: 1 }}><Text fontSize="$2" color="$color10">Rounds</Text><Text fontSize="$2" color="$color12" className="hz-tnum">{summary.rounds.count} · raised {usd(summary.rounds.totalRaised)}</Text></XStack>
          </YStack>
        </Card>
      </XStack>

      <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
        <Text fontSize="$4" fontWeight="500" color="$color12">Share classes</Text>
        {summary.byShareClass.length === 0 ? (
          <Text fontSize="$2" color="$color10">No share classes yet.</Text>
        ) : (
          <YStack gap="$1">
            <XStack px="$2" pb="$1"><Text fontSize="$1" color="$color10" flex={2}>Class</Text><Text fontSize="$1" color="$color10" flex={1} style={{ textAlign: 'right' }}>Issued</Text><Text fontSize="$1" color="$color10" flex={1} style={{ textAlign: 'right' }}>Authorized</Text></XStack>
            {summary.byShareClass.map((c) => (
              <XStack key={c.shareClassId} px="$2" py="$2" items="center" borderColor="$borderColor" style={{ borderTopWidth: 1 }}>
                <XStack flex={2} items="center" gap="$2" minW={0}><Text fontSize="$3" color="$color12" numberOfLines={1}>{c.name}</Text><StatusTag status={enumLabel(c.classType)} /></XStack>
                <Text fontSize="$3" flex={1} className="hz-mono" color="$color12" style={{ textAlign: 'right' }}>{int(c.issued)}</Text>
                <Text fontSize="$3" flex={1} className="hz-mono" color="$color11" style={{ textAlign: 'right' }}>{int(c.authorized)}</Text>
              </XStack>
            ))}
          </YStack>
        )}
      </Card>
    </YStack>
  )
}

// ── Forms ────────────────────────────────────────────────────────────────────

function useSubmit(onDone: () => void) {
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const submit = useCallback(
    async (validate: () => string | null, run: () => Promise<void>, ok: string) => {
      const v = validate()
      if (v) return setErr(v)
      setErr(null)
      setSaving(true)
      try {
        await run()
        toast.success(ok)
        onDone()
      } catch (e) {
        setErr(classifyBackend(e).message || 'Save failed.')
        setSaving(false)
      }
    },
    [onDone, toast],
  )
  return { saving, err, submit }
}

function AddStakeholderForm({ onDone }: { onDone: () => void }) {
  const { saving, err, submit } = useSubmit(onDone)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [type, setType] = useState<string>('INDIVIDUAL')
  const [rel, setRel] = useState<string>('FOUNDER')
  const [inst, setInst] = useState('')
  return (
    <YStack gap="$3">
      <FieldRow label="Name"><FieldText value={name} onChange={setName} placeholder="Full name" disabled={saving} /></FieldRow>
      <FieldRow label="Email"><FieldText value={email} onChange={setEmail} placeholder="person@company.com" disabled={saving} /></FieldRow>
      <FieldRow label="Type"><FieldOptionSelect value={type} options={enumOpts(STAKEHOLDER_TYPES)} onChange={setType} disabled={saving} /></FieldRow>
      <FieldRow label="Relationship"><FieldOptionSelect value={rel} options={enumOpts(STAKEHOLDER_RELATIONSHIPS)} onChange={setRel} disabled={saving} /></FieldRow>
      {type === 'INSTITUTION' ? <FieldRow label="Institution"><FieldText value={inst} onChange={setInst} placeholder="Fund / entity name" disabled={saving} /></FieldRow> : null}
      {err ? <Text fontSize="$2" color="$red10">{err}</Text> : null}
      <PrimaryButton
        disabled={saving}
        icon={<Plus size={16} />}
        onPress={() =>
          void submit(
            () => validateStakeholder({ name, email, stakeholderType: type, currentRelationship: rel }),
            () => CapTableApi.stakeholders.add({ name: name.trim(), email: email.trim(), stakeholderType: type, currentRelationship: rel, institutionName: inst.trim() || undefined }),
            `Added ${name}`,
          )
        }
      >
        {saving ? 'Adding…' : 'Add stakeholder'}
      </PrimaryButton>
    </YStack>
  )
}

function IssueSharesForm({ stakeholders, classes, onDone }: { stakeholders: Stakeholder[]; classes: ShareClass[]; onDone: () => void }) {
  const { saving, err, submit } = useSubmit(onDone)
  const [stakeholderId, setStakeholderId] = useState('')
  const [shareClassId, setShareClassId] = useState('')
  const [certificateId, setCertificateId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [status, setStatus] = useState('ACTIVE')

  if (classes.length === 0)
    return <Text fontSize="$2" color="$color10">Create a share class first — every certificate references one.</Text>
  if (stakeholders.length === 0)
    return <Text fontSize="$2" color="$color10">Add a stakeholder first — a certificate is issued to a holder.</Text>

  return (
    <YStack gap="$3">
      <FieldRow label="Stakeholder"><FieldOptionSelect value={stakeholderId} options={stakeholders.map((s) => ({ value: s.id, label: s.name || s.email }))} onChange={setStakeholderId} disabled={saving} placeholder="Choose a holder" /></FieldRow>
      <FieldRow label="Share class"><FieldOptionSelect value={shareClassId} options={classes.map((c) => ({ value: c.id, label: `${c.name} (${enumLabel(c.classType)})` }))} onChange={setShareClassId} disabled={saving} placeholder="Choose a class" /></FieldRow>
      <FieldRow label="Certificate id"><FieldText value={certificateId} onChange={setCertificateId} placeholder="CS-1" disabled={saving} /></FieldRow>
      <FieldRow label="Quantity"><FieldText value={quantity} onChange={setQuantity} placeholder="1000000" disabled={saving} /></FieldRow>
      <FieldRow label="Status"><FieldOptionSelect value={status} options={enumOpts(SECURITIES_STATUS)} onChange={setStatus} disabled={saving} /></FieldRow>
      {err ? <Text fontSize="$2" color="$red10">{err}</Text> : null}
      <PrimaryButton
        disabled={saving}
        icon={<Plus size={16} />}
        onPress={() =>
          void submit(
            () => validateShareForm({ stakeholderId, shareClassId, certificateId, quantity: Number(quantity), status }),
            () =>
              CapTableApi.shares.add({
                stakeholderId, shareClassId, certificateId: certificateId.trim(), quantity: Math.round(Number(quantity)),
                status, cliffYears: 0, vestingYears: 0, companyLegends: [], issueDate: today(), boardApprovalDate: today(),
              }),
            `Issued ${int(Number(quantity))} shares`,
          )
        }
      >
        {saving ? 'Issuing…' : 'Issue shares'}
      </PrimaryButton>
    </YStack>
  )
}

function CreateClassForm({ onDone }: { onDone: () => void }) {
  const { saving, err, submit } = useSubmit(onDone)
  const [name, setName] = useState('')
  const [classType, setClassType] = useState('COMMON')
  const [authorized, setAuthorized] = useState('10000000')
  const [price, setPrice] = useState('0.0001')
  const [par, setPar] = useState('0.0001')
  const [votes, setVotes] = useState('1')
  return (
    <YStack gap="$3">
      <FieldRow label="Class name"><FieldText value={name} onChange={setName} placeholder="Common Stock" disabled={saving} /></FieldRow>
      <FieldRow label="Type"><FieldOptionSelect value={classType} options={enumOpts(SHARE_CLASS_TYPES)} onChange={setClassType} disabled={saving} /></FieldRow>
      <FieldRow label="Authorized shares"><FieldText value={authorized} onChange={setAuthorized} placeholder="10000000" disabled={saving} /></FieldRow>
      <FieldRow label="Price / share ($)"><FieldText value={price} onChange={setPrice} placeholder="0.0001" disabled={saving} /></FieldRow>
      <FieldRow label="Par value ($)"><FieldText value={par} onChange={setPar} placeholder="0.0001" disabled={saving} /></FieldRow>
      <FieldRow label="Votes / share"><FieldText value={votes} onChange={setVotes} placeholder="1" disabled={saving} /></FieldRow>
      {err ? <Text fontSize="$2" color="$red10">{err}</Text> : null}
      <PrimaryButton
        disabled={saving}
        icon={<Plus size={16} />}
        onPress={() =>
          void submit(
            () => validateShareClassForm({ name, classType, initialSharesAuthorized: Number(authorized), pricePerShare: Number(price), parValue: Number(par), votesPerShare: Number(votes) }),
            () =>
              CapTableApi.shareClasses.create({
                name: name.trim(), classType, initialSharesAuthorized: Math.round(Number(authorized)),
                votesPerShare: Math.round(Number(votes)), parValue: Number(par), pricePerShare: Number(price),
                seniority: 0, conversionRights: 'CONVERTS_TO_FUTURE_ROUND', liquidationPreferenceMultiple: classType === 'PREFERRED' ? 1 : 0,
                participationCapMultiple: 0, boardApprovalDate: today(), stockholderApprovalDate: today(),
              }),
            `Created ${name}`,
          )
        }
      >
        {saving ? 'Creating…' : 'Create share class'}
      </PrimaryButton>
    </YStack>
  )
}

function RecordSafeForm({ stakeholders, onDone }: { stakeholders: Stakeholder[]; onDone: () => void }) {
  const { saving, err, submit } = useSubmit(onDone)
  const [publicId, setPublicId] = useState('')
  const [stakeholderId, setStakeholderId] = useState('')
  const [capital, setCapital] = useState('')
  const [type, setType] = useState('POST_MONEY')
  const [status, setStatus] = useState('ACTIVE')
  const [cap, setCap] = useState('')
  const [discount, setDiscount] = useState('')
  if (stakeholders.length === 0) return <Text fontSize="$2" color="$color10">Add an investor as a stakeholder first.</Text>
  return (
    <YStack gap="$3">
      <FieldRow label="SAFE id"><FieldText value={publicId} onChange={setPublicId} placeholder="SAFE-1" disabled={saving} /></FieldRow>
      <FieldRow label="Investor"><FieldOptionSelect value={stakeholderId} options={stakeholders.map((s) => ({ value: s.id, label: s.name || s.email }))} onChange={setStakeholderId} disabled={saving} placeholder="Choose an investor" /></FieldRow>
      <FieldRow label="Capital ($)"><FieldText value={capital} onChange={setCapital} placeholder="100000" disabled={saving} /></FieldRow>
      <FieldRow label="Type"><FieldOptionSelect value={type} options={enumOpts(SAFE_TYPES)} onChange={setType} disabled={saving} /></FieldRow>
      <FieldRow label="Status"><FieldOptionSelect value={status} options={enumOpts(SAFE_STATUS)} onChange={setStatus} disabled={saving} /></FieldRow>
      <FieldRow label="Valuation cap ($)"><FieldText value={cap} onChange={setCap} placeholder="optional" disabled={saving} /></FieldRow>
      <FieldRow label="Discount (%)"><FieldText value={discount} onChange={setDiscount} placeholder="optional" disabled={saving} /></FieldRow>
      {err ? <Text fontSize="$2" color="$red10">{err}</Text> : null}
      <PrimaryButton
        disabled={saving}
        icon={<Plus size={16} />}
        onPress={() =>
          void submit(
            () => validateSafeForm({ publicId, stakeholderId, capital: Number(capital), type, status }),
            () =>
              CapTableApi.safes.create({
                publicId: publicId.trim(), stakeholderId, capital: Number(capital), type, status,
                valuationCap: cap.trim() ? Number(cap) : undefined, discountRate: discount.trim() ? Number(discount) : undefined,
                issueDate: today(), boardApprovalDate: today(),
              }),
            `Recorded SAFE ${publicId}`,
          )
        }
      >
        {saving ? 'Recording…' : 'Record SAFE'}
      </PrimaryButton>
    </YStack>
  )
}

function RecordRoundForm({ classes, onDone }: { classes: ShareClass[]; onDone: () => void }) {
  const { saving, err, submit } = useSubmit(onDone)
  const [name, setName] = useState('')
  const [roundType, setRoundType] = useState('PRICED')
  const [target, setTarget] = useState('')
  const [shareClassId, setShareClassId] = useState('')
  const [price, setPrice] = useState('')
  const [preMoney, setPreMoney] = useState('')
  const priced = roundType === 'PRICED'
  return (
    <YStack gap="$3">
      <FieldRow label="Round name"><FieldText value={name} onChange={setName} placeholder="Seed" disabled={saving} /></FieldRow>
      <FieldRow label="Type"><FieldOptionSelect value={roundType} options={enumOpts(ROUND_TYPES)} onChange={setRoundType} disabled={saving} /></FieldRow>
      <FieldRow label="Target amount ($)"><FieldText value={target} onChange={setTarget} placeholder="1000000" disabled={saving} /></FieldRow>
      {priced ? (
        <>
          <FieldRow label="Share class">
            {classes.length ? (
              <FieldOptionSelect value={shareClassId} options={classes.map((c) => ({ value: c.id, label: c.name }))} onChange={setShareClassId} disabled={saving} placeholder="Choose a class" />
            ) : (
              <Text fontSize="$2" color="$color10">Create a share class first.</Text>
            )}
          </FieldRow>
          <FieldRow label="Price / share ($)"><FieldText value={price} onChange={setPrice} placeholder="1.25" disabled={saving} /></FieldRow>
          <FieldRow label="Pre-money ($)"><FieldText value={preMoney} onChange={setPreMoney} placeholder="optional" disabled={saving} /></FieldRow>
        </>
      ) : null}
      {err ? <Text fontSize="$2" color="$red10">{err}</Text> : null}
      <PrimaryButton
        disabled={saving}
        icon={<Plus size={16} />}
        onPress={() =>
          void submit(
            () => validateRoundForm({ name, roundType, targetAmount: Number(target), shareClassId, pricePerShare: Number(price) }),
            () =>
              CapTableApi.rounds.create({
                name: name.trim(), roundType, targetAmount: Number(target) || 0,
                ...(priced ? { shareClassId, pricePerShare: Number(price), preMoneyValuation: preMoney.trim() ? Number(preMoney) : undefined } : {}),
              }),
            `Opened ${name}`,
          )
        }
      >
        {saving ? 'Opening…' : 'Open round'}
      </PrimaryButton>
    </YStack>
  )
}

// ── Dialog model (ONE SlideOver) ──────────────────────────────────────────────

type Dialog =
  | { kind: 'none' }
  | { kind: 'stakeholder' }
  | { kind: 'shares' }
  | { kind: 'class' }
  | { kind: 'safe' }
  | { kind: 'round' }
  | { kind: 'deleteStakeholder'; row: Stakeholder }
  | { kind: 'deleteShare'; row: Share }
  | { kind: 'deleteSafe'; row: Safe }

const DIALOG_TITLE: Record<Dialog['kind'], string> = {
  none: '', stakeholder: 'Add stakeholder', shares: 'Issue shares', class: 'New share class',
  safe: 'Record a SAFE', round: 'Open a round', deleteStakeholder: 'Remove stakeholder',
  deleteShare: 'Delete certificate', deleteSafe: 'Delete SAFE',
}

// ── Module ───────────────────────────────────────────────────────────────────

export function CapTableModule({ params }: { params: Record<string, string> }) {
  const active: Tab = (productSubpageSlug('captable', params.tab) || 'summary') as Tab
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' })

  // Stakeholders + classes are loaded always — the forms' reference pickers need them.
  const [summary, refreshSummary] = useList<CapTableSummary>(useCallback(() => CapTableApi.summary(), []))
  const [stakeholders, refreshStakeholders] = useList<Stakeholder[]>(useCallback(() => CapTableApi.stakeholders.list(), []))
  const [classes, refreshClasses] = useList<ShareClass[]>(useCallback(() => CapTableApi.shareClasses.list(), []))
  const [shares, refreshShares] = useList<Share[]>(useCallback(() => CapTableApi.shares.list(), []))
  const [safes, refreshSafes] = useList<Safe[]>(useCallback(() => CapTableApi.safes.list(), []))
  const [rounds, refreshRounds] = useList<Round[]>(useCallback(() => CapTableApi.rounds.list(), []))

  const stakeholderList = stakeholders.phase === 'ready' ? stakeholders.data : []
  const classList = classes.phase === 'ready' ? classes.data : []

  const refreshAll = useCallback(() => {
    refreshSummary(); refreshStakeholders(); refreshClasses(); refreshShares(); refreshSafes(); refreshRounds()
  }, [refreshSummary, refreshStakeholders, refreshClasses, refreshShares, refreshSafes, refreshRounds])

  const afterMutation = useCallback(() => {
    setDialog({ kind: 'none' })
    refreshAll()
  }, [refreshAll])

  const stakeholderCols: Column<Stakeholder>[] = [
    { key: 'name', header: 'Name', render: (s) => <Text fontSize="$3" color="$color12" numberOfLines={1}>{s.name || '—'}</Text> },
    { key: 'email', header: 'Email', render: (s) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{s.email}</Text> },
    { key: 'rel', header: 'Relationship', width: 150, render: (s) => <StatusTag status={enumLabel(s.currentRelationship)} /> },
    { key: 'type', header: 'Type', width: 120, render: (s) => <Text fontSize="$2" color="$color10">{enumLabel(s.stakeholderType)}</Text> },
    { key: 'actions', header: '', width: 56, align: 'right', render: (s) => <Button chromeless width={40} height={40} icon={<Trash2 size={15} />} aria-label="Remove" onPress={() => setDialog({ kind: 'deleteStakeholder', row: s })} /> },
  ]
  const shareCols: Column<Share>[] = [
    { key: 'cert', header: 'Certificate', render: (s) => <Text fontSize="$3" className="hz-mono" color="$color12" numberOfLines={1}>{s.certificateId}</Text> },
    { key: 'holder', header: 'Holder', render: (s) => <Text fontSize="$3" color="$color12" numberOfLines={1}>{s.stakeholderName}</Text> },
    { key: 'class', header: 'Class', width: 150, render: (s) => <Text fontSize="$2" color="$color11" numberOfLines={1}>{s.shareClassName}</Text> },
    { key: 'qty', header: 'Shares', width: 120, align: 'right', mono: true, render: (s) => int(s.quantity) },
    { key: 'status', header: 'Status', width: 100, render: (s) => <StatusTag status={s.status} /> },
    { key: 'actions', header: '', width: 56, align: 'right', render: (s) => <Button chromeless width={40} height={40} icon={<Trash2 size={15} />} aria-label="Delete" onPress={() => setDialog({ kind: 'deleteShare', row: s })} /> },
  ]
  const classCols: Column<ShareClass>[] = [
    { key: 'name', header: 'Class', render: (c) => <XStack items="center" gap="$2" minW={0}><Text fontSize="$3" color="$color12" numberOfLines={1}>{c.name}</Text><StatusTag status={enumLabel(c.classType)} /></XStack> },
    { key: 'auth', header: 'Authorized', width: 140, align: 'right', mono: true, render: (c) => int(c.initialSharesAuthorized) },
    { key: 'price', header: 'Price', width: 110, align: 'right', mono: true, render: (c) => usd(c.pricePerShare) },
    { key: 'votes', header: 'Votes', width: 90, align: 'right', mono: true, render: (c) => int(c.votesPerShare) },
  ]
  const safeCols: Column<Safe>[] = [
    { key: 'id', header: 'SAFE', render: (s) => <Text fontSize="$3" className="hz-mono" color="$color12" numberOfLines={1}>{s.publicId}</Text> },
    { key: 'holder', header: 'Investor', render: (s) => <Text fontSize="$3" color="$color12" numberOfLines={1}>{s.stakeholderName}</Text> },
    { key: 'capital', header: 'Capital', width: 130, align: 'right', mono: true, render: (s) => usd(s.capital) },
    { key: 'cap', header: 'Cap', width: 130, align: 'right', mono: true, render: (s) => (s.valuationCap ? usd(s.valuationCap) : '—') },
    { key: 'type', header: 'Type', width: 120, render: (s) => <Text fontSize="$2" color="$color10">{enumLabel(s.type)}</Text> },
    { key: 'actions', header: '', width: 56, align: 'right', render: (s) => <Button chromeless width={40} height={40} icon={<Trash2 size={15} />} aria-label="Delete" onPress={() => setDialog({ kind: 'deleteSafe', row: s })} /> },
  ]
  const roundCols: Column<Round>[] = [
    { key: 'name', header: 'Round', render: (r) => <Text fontSize="$3" color="$color12" numberOfLines={1}>{r.name}</Text> },
    { key: 'type', header: 'Type', width: 130, render: (r) => <Text fontSize="$2" color="$color11">{enumLabel(r.roundType)}</Text> },
    { key: 'target', header: 'Target', width: 130, align: 'right', mono: true, render: (r) => usd(r.targetAmount) },
    { key: 'raised', header: 'Raised', width: 130, align: 'right', mono: true, render: (r) => usd(r.raisedAmount) },
    { key: 'status', header: 'Status', width: 100, render: (r) => <StatusTag status={r.status} /> },
  ]

  const primaryAction = (): { label: string; open: Dialog['kind'] } | null => {
    switch (active) {
      case 'stakeholders': return { label: 'Add stakeholder', open: 'stakeholder' }
      case 'shares': return { label: 'Issue shares', open: 'shares' }
      case 'classes': return { label: 'New share class', open: 'class' }
      case 'fundraising': return { label: 'Record a SAFE', open: 'safe' }
      default: return null
    }
  }
  const pa = primaryAction()

  return (
    <YStack gap="$4" p="$4">
      <PageHeader
        title="Cap Table"
        subtitle="Your capitalization ledger — stakeholders, share classes, issued equity, SAFEs, and rounds. Ownership is computed server-side."
        actions={
          <XStack gap="$2" flexWrap="wrap">
            <Button onPress={refreshAll} icon={<RefreshCw size={16} />}>Refresh</Button>
            {pa ? <PrimaryButton onPress={() => setDialog({ kind: pa.open } as Dialog)} icon={<Plus size={16} />}>{pa.label}</PrimaryButton> : null}
          </XStack>
        }
      />
      <SubNav id="captable" />

      {active === 'summary' ? (
        summary.phase === 'loading' ? <Loader label="Computing your cap table…" />
        : summary.phase === 'error' ? <BackendStateCard state={summary.error} onRetry={refreshSummary} hint="endpoint · GET /v1/captable/summary" />
        : <SummaryTab summary={summary.data} />
      ) : null}

      {active === 'stakeholders' ? (
        stakeholders.phase === 'error' ? <BackendStateCard state={stakeholders.error} onRetry={refreshStakeholders} hint="endpoint · GET /v1/captable/stakeholders" />
        : stakeholders.phase === 'ready' && stakeholders.data.length === 0 ? (
          <EmptyState icon={Users} title="No stakeholders yet" description="Add founders, employees, and investors — every certificate is issued to a stakeholder." primary={{ label: 'Add stakeholder', onPress: () => setDialog({ kind: 'stakeholder' }) }} />
        ) : <DataTable<Stakeholder> columns={stakeholderCols} rows={stakeholderList} loading={stakeholders.phase === 'loading'} rowKey={(s) => s.id} empty="No stakeholders yet." />
      ) : null}

      {active === 'shares' ? (
        shares.phase === 'error' ? <BackendStateCard state={shares.error} onRetry={refreshShares} hint="endpoint · GET /v1/captable/shares" />
        : shares.phase === 'ready' && shares.data.length === 0 ? (
          <EmptyState icon={ScrollText} title="No shares issued yet" description="Issue a share certificate to a stakeholder from an existing share class." primary={{ label: 'Issue shares', onPress: () => setDialog({ kind: 'shares' }) }} secondary={{ label: 'New share class', onPress: () => setDialog({ kind: 'class' }) }} />
        ) : <DataTable<Share> columns={shareCols} rows={shares.phase === 'ready' ? shares.data : []} loading={shares.phase === 'loading'} rowKey={(s) => s.id} empty="No shares issued yet." />
      ) : null}

      {active === 'classes' ? (
        classes.phase === 'error' ? <BackendStateCard state={classes.error} onRetry={refreshClasses} hint="endpoint · GET /v1/captable/share-classes" />
        : classes.phase === 'ready' && classes.data.length === 0 ? (
          <EmptyState icon={Layers} title="No share classes yet" description="Create a share class (Common, Preferred) — certificates and rounds reference it." primary={{ label: 'New share class', onPress: () => setDialog({ kind: 'class' }) }} />
        ) : <DataTable<ShareClass> columns={classCols} rows={classList} loading={classes.phase === 'loading'} rowKey={(c) => c.id} empty="No share classes yet." />
      ) : null}

      {active === 'fundraising' ? (
        <YStack gap="$4">
          <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
            <XStack justify="space-between" items="center" gap="$2" flexWrap="wrap">
              <Text fontSize="$4" fontWeight="500" color="$color12">SAFEs</Text>
              <PrimaryButton size="$2" onPress={() => setDialog({ kind: 'safe' })} icon={<Plus size={15} />}>Record a SAFE</PrimaryButton>
            </XStack>
            {safes.phase === 'error' ? <BackendStateCard state={safes.error} onRetry={refreshSafes} hint="endpoint · GET /v1/captable/safes" />
              : safes.phase === 'ready' && safes.data.length === 0 ? <Text fontSize="$2" color="$color10">No SAFEs recorded yet.</Text>
              : <DataTable<Safe> columns={safeCols} rows={safes.phase === 'ready' ? safes.data : []} loading={safes.phase === 'loading'} rowKey={(s) => s.id} empty="No SAFEs yet." />}
          </Card>
          <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
            <XStack justify="space-between" items="center" gap="$2" flexWrap="wrap">
              <Text fontSize="$4" fontWeight="500" color="$color12">Rounds</Text>
              <PrimaryButton size="$2" onPress={() => setDialog({ kind: 'round' })} icon={<Plus size={15} />}>Open a round</PrimaryButton>
            </XStack>
            {rounds.phase === 'error' ? <BackendStateCard state={rounds.error} onRetry={refreshRounds} hint="endpoint · GET /v1/captable/rounds" />
              : rounds.phase === 'ready' && rounds.data.length === 0 ? <Text fontSize="$2" color="$color10">No rounds yet — open one to track a raise.</Text>
              : <DataTable<Round> columns={roundCols} rows={rounds.phase === 'ready' ? rounds.data : []} loading={rounds.phase === 'loading'} rowKey={(r) => r.id} empty="No rounds yet." />}
          </Card>
        </YStack>
      ) : null}

      <SlideOver open={dialog.kind !== 'none'} onClose={() => setDialog({ kind: 'none' })} title={DIALOG_TITLE[dialog.kind]} icon={TableIcon} ariaLabel="Cap table dialog">
        {dialog.kind === 'stakeholder' ? <AddStakeholderForm onDone={afterMutation} />
          : dialog.kind === 'shares' ? <IssueSharesForm stakeholders={stakeholderList} classes={classList} onDone={afterMutation} />
          : dialog.kind === 'class' ? <CreateClassForm onDone={afterMutation} />
          : dialog.kind === 'safe' ? <RecordSafeForm stakeholders={stakeholderList} onDone={afterMutation} />
          : dialog.kind === 'round' ? <RecordRoundForm classes={classList} onDone={afterMutation} />
          : dialog.kind === 'deleteStakeholder' ? <ConfirmDelete message={`Remove ${dialog.row.name}? A stakeholder that still holds shares or options cannot be removed.`} confirmLabel="Remove" run={() => CapTableApi.stakeholders.remove(dialog.row.id)} onDone={afterMutation} />
          : dialog.kind === 'deleteShare' ? <ConfirmDelete message={`Delete certificate ${dialog.row.certificateId} (${int(dialog.row.quantity)} shares)?`} confirmLabel="Delete" run={() => CapTableApi.shares.remove(dialog.row.id)} onDone={afterMutation} />
          : dialog.kind === 'deleteSafe' ? <ConfirmDelete message={`Delete SAFE ${dialog.row.publicId}?`} confirmLabel="Delete" run={() => CapTableApi.safes.remove(dialog.row.id)} onDone={afterMutation} />
          : null}
      </SlideOver>
    </YStack>
  )
}

export default CapTableModule
