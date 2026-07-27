'use client'

/**
 * Company — self-service incorporation as an 8-step wizard over the REAL cloud
 * `/v1/company` formation state machine (cloud `clients/company`). ONE screen walks a
 * non-technical founder through: Structure → Founders → Identity (KYC) → Payment →
 * Documents → E-sign → Equity genesis → Incorporated, plus the already-incorporated
 * IMPORT branch. This is the COMPANY side only (formation + the org's own cap table);
 * a securities RAISE runs on the funding portal, not here.
 *
 * The state machine lives in the BACKEND — the wizard renders the panel for the
 * formation's CURRENT stage (the source of truth returned by `/v1/company`), performs
 * that stage's action(s), then advances through the guarded transition door
 * (`POST /v1/company/advance {to}`); a guard that isn't satisfied returns an honest
 * 422 the panel surfaces, never a client-side jump. Tenancy is org-scoped SERVER-SIDE
 * (the `/v1` bearer BFF resolves the org from the token owner), so a browser can never
 * read another org's formation.
 *
 * HONEST STATES: the KYC, e-sign, and state-filing providers are stubs today, so those
 * steps report "pending — manual review" and the founder KYC chips reflect ONLY the
 * backend `kycStatus` — the UI NEVER paints an unverified founder as verified, and the
 * payment gate stays closed until the backend says every founder cleared.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import {
  ArrowRight, Building2, Check, CircleCheck, CreditCard, FileText, Landmark, Plus,
  RefreshCw, Rocket, ShieldCheck, Signature, Trash2, Users,
} from '@hanzogui/lucide-icons-2'

import {
  CompanyApi,
  WIZARD_STEPS,
  STRUCTURE_OPTIONS,
  JURISDICTION_OPTIONS,
  stepStatus,
  structureLabel,
  jurisdictionLabel,
  foundersEquityBps,
  equityPct,
  allKycVerified,
  kycVerifiedCount,
  validateStructure,
  validateFounders,
  filingStatusLabel,
  genesisStatusLabel,
  type Formation,
  type FormationView,
  type Founder,
  type Stage,
  type StepKey,
  type Structure,
  type Jurisdiction,
} from '~/lib/api/company'
import { PageHeader } from '~/components/ui/PageHeader'
import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { FieldRow, FieldText, FieldOptionSelect } from '~/components/ui/Field'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { Loader } from '~/components/ui/Loader'
import { StatusTag } from '~/components/ui/StatusTag'
import { useToast } from '~/components/ui/Toast'
import { toneColor, toneVar } from '~/components/ui/tone'

type Async =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'empty' } // no formation yet — offer to begin one
  | { phase: 'ready'; view: FormationView }

const opt = <T extends string>(xs: { value: T; label: string }[]) => xs.map((o) => ({ value: o.value, label: o.label }))

// ── Progress rail (8 steps mapped from the machine stage) ────────────────────

function StepDot({ status }: { status: 'done' | 'current' | 'upcoming' }) {
  if (status === 'done')
    return (
      <XStack width={26} height={26} rounded="$10" items="center" justify="center" style={{ backgroundColor: toneVar('positive') }}>
        <Check size={15} color="$color1" />
      </XStack>
    )
  return (
    <XStack
      width={26}
      height={26}
      rounded="$10"
      items="center"
      justify="center"
      borderWidth={2}
      borderColor={status === 'current' ? '$color12' : '$color7'}
    >
      <XStack width={8} height={8} rounded="$10" bg={status === 'current' ? '$color12' : 'transparent'} />
    </XStack>
  )
}

function ProgressRail({ formation }: { formation: Formation }) {
  return (
    <Card p="$4" borderWidth={1} borderColor="$borderColor">
      <XStack gap="$2" flexWrap="wrap" items="flex-start">
        {WIZARD_STEPS.map((s, i) => {
          const status = stepStatus(s.key, formation)
          return (
            <XStack key={s.key} items="center" gap="$2" minW={150} flex={1}>
              <StepDot status={status} />
              <YStack minW={0} flex={1}>
                <Text
                  fontSize="$2"
                  fontWeight={status === 'current' ? '600' : '400'}
                  color={status === 'upcoming' ? '$color10' : '$color12'}
                  numberOfLines={1}
                >
                  {i + 1}. {s.label}
                </Text>
                {status === 'current' && s.stub ? (
                  <Text fontSize="$1" color="$color10" numberOfLines={1}>
                    manual review
                  </Text>
                ) : null}
              </YStack>
            </XStack>
          )
        })}
      </XStack>
    </Card>
  )
}

// ── Shared panel scaffold + advance action ───────────────────────────────────

function Panel({ icon, title, blurb, children }: { icon: React.ReactElement; title: string; blurb: string; children: React.ReactNode }) {
  return (
    <Card p="$5" gap="$4" borderWidth={1} borderColor="$borderColor">
      <XStack gap="$3" items="flex-start">
        <XStack width={40} height={40} rounded="$3" items="center" justify="center" bg="$color3">
          {icon}
        </XStack>
        <YStack flex={1} minW={0} gap="$1">
          <Text fontSize="$6" fontWeight="500" color="$color12">{title}</Text>
          <Text fontSize="$3" color="$color11">{blurb}</Text>
        </YStack>
      </XStack>
      {children}
    </Card>
  )
}

/** The one guarded transition door. Surfaces the machine's honest 422 on an unmet guard. */
function useAction(onUpdate: (v: FormationView) => void) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const run = useCallback(
    async (fn: () => Promise<FormationView>, ok?: string) => {
      setBusy(true)
      try {
        onUpdate(await fn())
        if (ok) toast.success(ok)
      } catch (e) {
        toast.error('Could not continue', classifyBackend(e).message)
      } finally {
        setBusy(false)
      }
    },
    [onUpdate, toast],
  )
  return { busy, run }
}

function InlineError({ text }: { text: string | null }) {
  if (!text) return null
  return <Text fontSize="$2" color="$red10">{text}</Text>
}

function ContinueButton({ label, disabled, onPress, busy }: { label: string; disabled?: boolean; onPress: () => void; busy: boolean }) {
  return (
    <PrimaryButton onPress={onPress} disabled={disabled || busy} iconAfter={<ArrowRight size={16} />}>
      {busy ? 'Working…' : label}
    </PrimaryButton>
  )
}

// ── Stage 0 — no formation yet ────────────────────────────────────────────────

function StartPanel({ onUpdate }: { onUpdate: (v: FormationView) => void }) {
  const { busy, run } = useAction(onUpdate)
  const [structure, setStructure] = useState<Structure | ''>('')
  const [jurisdiction, setJurisdiction] = useState<Jurisdiction | ''>('')
  const [name, setName] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const begin = () => {
    const v = validateStructure({ structure, jurisdiction, name })
    if (v) return setErr(v)
    setErr(null)
    void run(() => CompanyApi.begin({ structure, jurisdiction, name }), 'Formation started')
  }

  return (
    <Panel icon={<Building2 size={20} color="$color11" />} title="Form your company" blurb="Incorporate a new entity, or import one you already have.">
      <FieldRow label="Entity type">
        <FieldOptionSelect value={structure} options={opt(STRUCTURE_OPTIONS)} onChange={(v) => setStructure(v as Structure)} disabled={busy} placeholder="Choose an entity" />
      </FieldRow>
      <FieldRow label="Jurisdiction">
        <FieldOptionSelect value={jurisdiction} options={opt(JURISDICTION_OPTIONS)} onChange={(v) => setJurisdiction(v as Jurisdiction)} disabled={busy} placeholder="Choose a state" />
      </FieldRow>
      <FieldRow label="Proposed name">
        <FieldText value={name} onChange={setName} placeholder="Acme, Inc." disabled={busy} />
      </FieldRow>
      <InlineError text={err} />
      <XStack gap="$3" flexWrap="wrap">
        <PrimaryButton onPress={begin} disabled={busy} icon={<Rocket size={16} />}>
          {busy ? 'Starting…' : 'Begin formation'}
        </PrimaryButton>
        <Button onPress={() => void run(() => CompanyApi.begin({ alreadyIncorporated: true }).then(() => CompanyApi.skip()), 'Import path started')} disabled={busy} icon={<Landmark size={16} />}>
          Already incorporated — import
        </Button>
      </XStack>
    </Panel>
  )
}

// ── Stage: structure ─────────────────────────────────────────────────────────

function StructurePanel({ view, onUpdate }: { view: FormationView; onUpdate: (v: FormationView) => void }) {
  const f = view.formation
  const { busy, run } = useAction(onUpdate)
  const [structure, setStructureV] = useState<Structure | ''>(f.structure)
  const [jurisdiction, setJurisdiction] = useState<Jurisdiction | ''>(f.jurisdiction)
  const [name, setName] = useState(f.name)
  const [err, setErr] = useState<string | null>(null)

  const save = () => {
    const v = validateStructure({ structure, jurisdiction, name })
    if (v) return setErr(v)
    setErr(null)
    void run(() => CompanyApi.setStructure({ structure, jurisdiction, name }), 'Saved')
  }

  return (
    <Panel icon={<Building2 size={20} color="$color11" />} title="Entity structure" blurb="Choose the legal entity, jurisdiction, and proposed name.">
      <FieldRow label="Entity type">
        <FieldOptionSelect value={structure} options={opt(STRUCTURE_OPTIONS)} onChange={(v) => setStructureV(v as Structure)} disabled={busy} placeholder="Choose an entity" />
      </FieldRow>
      <FieldRow label="Jurisdiction">
        <FieldOptionSelect value={jurisdiction} options={opt(JURISDICTION_OPTIONS)} onChange={(v) => setJurisdiction(v as Jurisdiction)} disabled={busy} placeholder="Choose a state" />
      </FieldRow>
      <FieldRow label="Proposed name">
        <FieldText value={name} onChange={setName} placeholder="Acme, Inc." disabled={busy} />
      </FieldRow>
      <InlineError text={err} />
      <XStack gap="$3" flexWrap="wrap">
        <Button onPress={save} disabled={busy} icon={<Check size={16} />}>Save</Button>
        <ContinueButton
          label="Continue to founders"
          busy={busy}
          onPress={() => void run(() => CompanyApi.advance('founders'), 'On to founders')}
        />
      </XStack>
    </Panel>
  )
}

// ── Stage: founders (founders editor + KYC) ──────────────────────────────────

type Row = { name: string; email: string; pct: string }

function FoundersPanel({ view, onUpdate }: { view: FormationView; onUpdate: (v: FormationView) => void }) {
  const f = view.formation
  const { busy, run } = useAction(onUpdate)
  const seed: Row[] = f.founders.length
    ? f.founders.map((x) => ({ name: x.name, email: x.email, pct: String(equityPct(x.equityBps)) }))
    : [{ name: '', email: '', pct: '' }]
  const [rows, setRows] = useState<Row[]>(seed)
  const [err, setErr] = useState<string | null>(null)

  const setRow = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const add = () => setRows((r) => [...r, { name: '', email: '', pct: '' }])
  const del = (i: number) => setRows((r) => (r.length > 1 ? r.filter((_, j) => j !== i) : r))

  const saveFounders = () => {
    const founders = rows.map((r) => ({ name: r.name.trim(), email: r.email.trim(), equityBps: Math.round(Number(r.pct.trim() || '0') * 100) }))
    const v = validateFounders(founders as Founder[])
    if (v) return setErr(v)
    setErr(null)
    void run(() => CompanyApi.setFounders(founders), 'Founders saved')
  }

  const totalPct = rows.reduce((n, r) => n + (Number(r.pct) || 0), 0)
  const hasFounders = f.founders.length > 0

  return (
    <YStack gap="$4">
      <Panel icon={<Users size={20} color="$color11" />} title="Founders & equity" blurb="Add each founding stakeholder and their ownership split.">
        <YStack gap="$3">
          {rows.map((r, i) => (
            <XStack key={i} gap="$2" items="center" flexWrap="wrap">
              <YStack flex={2} minW={160}><FieldText value={r.name} onChange={(v) => setRow(i, { name: v })} placeholder="Full name" disabled={busy} /></YStack>
              <YStack flex={2} minW={180}><FieldText value={r.email} onChange={(v) => setRow(i, { email: v })} placeholder="founder@acme.com" disabled={busy} /></YStack>
              <YStack width={96}><FieldText value={r.pct} onChange={(v) => setRow(i, { pct: v })} placeholder="% equity" disabled={busy} /></YStack>
              <Button chromeless width={40} height={40} icon={<Trash2 size={15} />} aria-label="Remove founder" onPress={() => del(i)} disabled={busy} />
            </XStack>
          ))}
          <XStack justify="space-between" items="center" flexWrap="wrap" gap="$2">
            <Button chromeless size="$2" icon={<Plus size={15} />} onPress={add} disabled={busy}>Add founder</Button>
            <Text fontSize="$2" color={Math.round(totalPct) === 100 ? '$green10' : '$color10'} className="hz-tnum">
              Total equity: {totalPct}%
            </Text>
          </XStack>
          <InlineError text={err} />
          <Button onPress={saveFounders} disabled={busy} icon={<Check size={16} />} self="flex-start">Save founders</Button>
        </YStack>
      </Panel>

      {hasFounders ? <KycPanel view={view} onUpdate={onUpdate} /> : null}
    </YStack>
  )
}

function KycPanel({ view, onUpdate }: { view: FormationView; onUpdate: (v: FormationView) => void }) {
  const f = view.formation
  const { busy, run } = useAction(onUpdate)
  const verified = kycVerifiedCount(f)
  const ready = allKycVerified(f)

  return (
    <Panel icon={<ShieldCheck size={20} color="$color11" />} title="Identity verification (KYC)" blurb="Every founder must clear identity verification before the formation fee.">
      <Card p="$3" bg="$color2" borderWidth={1} borderColor="$borderColor">
        <Text fontSize="$2" color="$color11">
          The automated KYC provider is not connected yet — verification is a manual review. Start the sessions, then record each founder’s result. A founder is treated as verified ONLY once the backend records it.
        </Text>
      </Card>
      <YStack gap="$2">
        {f.founders.map((fo) => (
          <XStack key={fo.email} justify="space-between" items="center" gap="$2" py="$2" borderColor="$borderColor" style={{ borderBottomWidth: 1 }}>
            <YStack minW={0} flex={1}>
              <Text fontSize="$3" color="$color12" numberOfLines={1}>{fo.name}</Text>
              <Text fontSize="$1" color="$color10" numberOfLines={1}>{fo.email}</Text>
            </YStack>
            <StatusTag status={fo.kycStatus} />
            {fo.kycStatus !== 'verified' ? (
              <Button size="$2" disabled={busy} onPress={() => void run(() => CompanyApi.kycCallback(fo.email, 'verified'), `Recorded ${fo.name} verified`)}>
                Record verified
              </Button>
            ) : null}
          </XStack>
        ))}
      </YStack>
      <XStack gap="$3" items="center" flexWrap="wrap">
        <Button onPress={() => void run(() => CompanyApi.startKyc().then((r) => r.view), 'KYC sessions started')} disabled={busy} icon={<RefreshCw size={15} />}>
          Start verification
        </Button>
        <Text fontSize="$2" color="$color10">{verified}/{f.founders.length} verified</Text>
        <ContinueButton
          label="Continue to payment"
          busy={busy}
          disabled={!ready}
          onPress={() => void run(() => CompanyApi.advance('payment'), 'On to payment')}
        />
      </XStack>
      {!ready ? <Text fontSize="$1" color="$color10">Payment unlocks once every founder is verified.</Text> : null}
    </Panel>
  )
}

// ── Stage: payment ────────────────────────────────────────────────────────────

function PaymentPanel({ view, onUpdate }: { view: FormationView; onUpdate: (v: FormationView) => void }) {
  const f = view.formation
  const { busy, run } = useAction(onUpdate)
  return (
    <Panel icon={<CreditCard size={20} color="$color11" />} title="Formation fee" blurb="A one-time $999 fee covers document generation and the state filing.">
      <XStack items="baseline" gap="$2">
        <Text fontSize="$9" fontWeight="600" color="$color12" className="hz-mono">$999</Text>
        <Text fontSize="$3" color="$color10">one-time</Text>
      </XStack>
      {f.paid ? (
        <XStack items="center" gap="$2">
          <CircleCheck size={16} color={toneColor('positive')} />
          <Text fontSize="$3" color="$green10">Paid{f.paymentRef ? ` · ${f.paymentRef}` : ''}</Text>
        </XStack>
      ) : null}
      <XStack gap="$3" flexWrap="wrap">
        {!f.paid ? (
          <PrimaryButton onPress={() => void run(() => CompanyApi.pay(), 'Payment complete')} disabled={busy} icon={<CreditCard size={16} />}>
            {busy ? 'Charging…' : 'Pay $999'}
          </PrimaryButton>
        ) : null}
        <ContinueButton label="Continue to documents" busy={busy} disabled={!f.paid} onPress={() => void run(() => CompanyApi.advance('documents'), 'On to documents')} />
      </XStack>
    </Panel>
  )
}

// ── Stage: documents ──────────────────────────────────────────────────────────

function DocumentsPanel({ view, onUpdate }: { view: FormationView; onUpdate: (v: FormationView) => void }) {
  const f = view.formation
  const { busy, run } = useAction(onUpdate)
  const generated = f.documentIds.length > 0
  return (
    <Panel icon={<FileText size={20} color="$color11" />} title="Formation documents" blurb="Generate the incorporation documents into your data room.">
      {generated ? (
        <YStack gap="$2">
          <Text fontSize="$2" color="$color11">{f.documentIds.length} document{f.documentIds.length === 1 ? '' : 's'} generated.</Text>
          <XStack items="center" gap="$2">
            <Text fontSize="$2" color="$color10">State filing:</Text>
            <StatusTag status={filingStatusLabel(f.filing)} />
          </XStack>
          <Text fontSize="$1" color="$color10">The state-filing partner is not connected yet — the filing is recorded honestly as pending manual review.</Text>
        </YStack>
      ) : (
        <Text fontSize="$2" color="$color10">No documents generated yet.</Text>
      )}
      <XStack gap="$3" flexWrap="wrap">
        <Button onPress={() => void run(() => CompanyApi.generateDocuments(), 'Documents generated')} disabled={busy} icon={<FileText size={16} />}>
          {generated ? 'Regenerate' : 'Generate documents'}
        </Button>
        <ContinueButton label="Continue to e-sign" busy={busy} disabled={!generated} onPress={() => void run(() => CompanyApi.advance('esign'), 'On to e-sign')} />
      </XStack>
    </Panel>
  )
}

// ── Stage: esign ──────────────────────────────────────────────────────────────

function EsignPanel({ view, onUpdate }: { view: FormationView; onUpdate: (v: FormationView) => void }) {
  const f = view.formation
  const { busy, run } = useAction(onUpdate)
  return (
    <Panel icon={<Signature size={20} color="$color11" />} title="Sign the documents" blurb="Every founder signs the formation documents.">
      <Card p="$3" bg="$color2" borderWidth={1} borderColor="$borderColor">
        <Text fontSize="$2" color="$color11">
          The e-signature provider is not connected yet — signing is recorded manually. Request signatures, then mark the set signed once every founder has signed.
        </Text>
      </Card>
      <XStack items="center" gap="$2">
        <Text fontSize="$2" color="$color10">Status:</Text>
        <StatusTag status={f.signed ? 'signed' : f.esignRef ? 'pending' : 'not requested'} />
      </XStack>
      <XStack gap="$3" flexWrap="wrap">
        <Button onPress={() => void run(() => CompanyApi.requestEsign(), 'Signature request sent')} disabled={busy} icon={<Signature size={16} />}>
          Request signatures
        </Button>
        {!f.signed ? (
          <Button onPress={() => void run(() => CompanyApi.completeEsign(true), 'Marked signed')} disabled={busy || !f.esignRef} icon={<Check size={16} />}>
            Mark signed
          </Button>
        ) : null}
        <ContinueButton label="Continue to equity genesis" busy={busy} disabled={!f.signed} onPress={() => void run(() => CompanyApi.advance('genesis'), 'On to equity genesis')} />
      </XStack>
    </Panel>
  )
}

// ── Stage: genesis ────────────────────────────────────────────────────────────

function GenesisPanel({ view, onUpdate }: { view: FormationView; onUpdate: (v: FormationView) => void }) {
  const f = view.formation
  const { busy, run } = useAction(onUpdate)
  const recorded = !!f.genesis?.root
  return (
    <Panel icon={<Landmark size={20} color="$color11" />} title="Equity genesis" blurb="Seed the cap table with the founding allocation and anchor its root on-chain.">
      {recorded ? (
        <YStack gap="$2">
          <XStack items="center" gap="$2"><Text fontSize="$2" color="$color10">Genesis root:</Text><Text fontSize="$2" className="hz-mono" color="$color12" numberOfLines={1}>{f.genesis!.root}</Text></XStack>
          <XStack items="center" gap="$2"><Text fontSize="$2" color="$color10">Anchor:</Text><StatusTag status={genesisStatusLabel(f.genesis)} /></XStack>
          <Text fontSize="$1" color="$color10">The root is the tamper-evident witness; the on-chain anchor stays honestly pending until the L1 anchor is wired.</Text>
        </YStack>
      ) : (
        <Text fontSize="$2" color="$color10">The founding allocation ({foundersEquityBps(f.founders) / 100}% assigned across {f.founders.length} founder{f.founders.length === 1 ? '' : 's'}) will seed the cap table.</Text>
      )}
      <XStack gap="$3" flexWrap="wrap">
        {!recorded ? (
          <Button onPress={() => void run(() => CompanyApi.recordGenesis(), 'Equity genesis recorded')} disabled={busy} icon={<Landmark size={16} />}>
            Record equity genesis
          </Button>
        ) : null}
        <ContinueButton label="Complete incorporation" busy={busy} disabled={!recorded} onPress={() => void run(() => CompanyApi.advance('company'), 'Incorporated 🎉')} />
      </XStack>
    </Panel>
  )
}

// ── Stage: company (terminal) ────────────────────────────────────────────────

function DonePanel({ view }: { view: FormationView }) {
  const f = view.formation
  return (
    <Panel icon={<CircleCheck size={20} color={toneColor('positive')} />} title={`${f.name || 'Your company'} is incorporated`} blurb="Formation complete. Manage your equity from the Cap Table.">
      <YStack gap="$2">
        <XStack gap="$2" items="center"><Text fontSize="$2" color="$color10">Entity:</Text><Text fontSize="$2" color="$color12">{structureLabel(f.structure)} · {jurisdictionLabel(f.jurisdiction)}</Text></XStack>
        <XStack gap="$2" items="center"><Text fontSize="$2" color="$color10">Founders:</Text><Text fontSize="$2" color="$color12">{f.founders.length}</Text></XStack>
        <XStack gap="$2" items="center"><Text fontSize="$2" color="$color10">Equity genesis:</Text><StatusTag status={genesisStatusLabel(f.genesis)} /></XStack>
      </YStack>
      <PrimaryButton onPress={() => window.location.assign('/captable')} icon={<Rocket size={16} />}>
        Open Cap Table
      </PrimaryButton>
    </Panel>
  )
}

// ── Stage: import (skip branch) ──────────────────────────────────────────────

function ImportPanel({ view, onUpdate }: { view: FormationView; onUpdate: (v: FormationView) => void }) {
  const f = view.formation
  const { busy, run } = useAction(onUpdate)
  const [folderId, setFolderId] = useState('')
  const [sheetId, setSheetId] = useState('')
  const ready = f.imported && f.capTableImported
  return (
    <Panel icon={<Landmark size={20} color="$color11" />} title="Import your company" blurb="Bring an already-incorporated company’s documents and cap table into Hanzo.">
      <FieldRow label="Drive folder id (documents)">
        <XStack gap="$2" items="center" flexWrap="wrap">
          <YStack flex={1} minW={200}><FieldText value={folderId} onChange={setFolderId} placeholder="Google Drive folder id" disabled={busy} /></YStack>
          <Button onPress={() => void run(() => CompanyApi.importDocuments(folderId.trim()), 'Documents imported')} disabled={busy || folderId.trim() === ''}>Import</Button>
        </XStack>
      </FieldRow>
      <FieldRow label="Sheet id (cap table)">
        <XStack gap="$2" items="center" flexWrap="wrap">
          <YStack flex={1} minW={200}><FieldText value={sheetId} onChange={setSheetId} placeholder="Google Sheets id" disabled={busy} /></YStack>
          <Button onPress={() => void run(() => CompanyApi.importCapTable(sheetId.trim()), 'Cap table imported')} disabled={busy || sheetId.trim() === ''}>Import</Button>
        </XStack>
      </FieldRow>
      <XStack gap="$3" items="center" flexWrap="wrap">
        <StatusTag status={f.imported ? 'documents imported' : 'documents pending'} />
        <StatusTag status={f.capTableImported ? 'cap table imported' : 'cap table pending'} />
        <ContinueButton label="Complete" busy={busy} disabled={!ready} onPress={() => void run(() => CompanyApi.advance('company'), 'Company imported 🎉')} />
      </XStack>
    </Panel>
  )
}

// ── The stage router ──────────────────────────────────────────────────────────

const PANEL: Record<Stage, (p: { view: FormationView; onUpdate: (v: FormationView) => void }) => React.ReactElement> = {
  structure: StructurePanel,
  founders: FoundersPanel,
  payment: PaymentPanel,
  documents: DocumentsPanel,
  esign: EsignPanel,
  genesis: GenesisPanel,
  company: ({ view }) => <DonePanel view={view} />,
  import: ImportPanel,
}

export function CompanyModule(_props: { params: Record<string, string> }) {
  const [state, setState] = useState<Async>({ phase: 'loading' })

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const view = await CompanyApi.get()
      setState(view ? { phase: 'ready', view } : { phase: 'empty' })
    } catch (e) {
      setState({ phase: 'error', error: classifyBackend(e) })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const onUpdate = useCallback((view: FormationView) => setState({ phase: 'ready', view }), [])

  const stepKey: StepKey | null = state.phase === 'ready' ? (WIZARD_STEPS.find((s) => s.stage === state.view.formation.stage)?.key ?? null) : null

  return (
    <YStack gap="$4" p="$4">
      <PageHeader
        title="Company"
        subtitle="Incorporate your company and manage its formation — the company side of going from idea to fundable entity."
        actions={<Button onPress={() => void load()} icon={<RefreshCw size={16} />}>Refresh</Button>}
      />

      {state.phase === 'loading' ? (
        <Loader label="Loading your formation…" />
      ) : state.phase === 'error' ? (
        <BackendStateCard state={state.error} onRetry={() => void load()} hint="endpoint · GET /v1/company" />
      ) : state.phase === 'empty' ? (
        <StartPanel onUpdate={onUpdate} />
      ) : (
        <YStack gap="$4">
          <ProgressRail formation={state.view.formation} />
          {(() => {
            const Body = PANEL[state.view.formation.stage]
            return <Body view={state.view} onUpdate={onUpdate} />
          })()}
          {stepKey ? <Text fontSize="$1" color="$color9" self="center">Stage {WIZARD_STEPS.findIndex((s) => s.key === stepKey) + 1} of {WIZARD_STEPS.length} · the formation state machine runs server-side</Text> : null}
        </YStack>
      )}
    </YStack>
  )
}

export default CompanyModule
