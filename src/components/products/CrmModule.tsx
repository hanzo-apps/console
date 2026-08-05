'use client'

/**
 * CRM — the first Hanzo Business-OS brick, over the REAL cloud `/v1/crm` surface
 * (cloud `clients/crm`: a native-Go, per-org CRM on Base/SQLite — companies,
 * contacts, opportunities). Every read/write is same-origin and keyless (`CrmApi`
 * → `<origin>/v1/crm`, rewritten to the console's user-bearer `/v1` proxy), so
 * every row is org-scoped SERVER-SIDE and no credential reaches the browser.
 *
 * CRM = BASE VIEWS. Each collection is rendered by the SAME @hanzo/data
 * `RecordsView` (table ⇆ board, filter, sort, group, detail) that powers the
 * generic Base records surface — the live `/v1/crm` entities are expressed as
 * `FieldDefinition[]` schemas + pure record mappers (`crm/collections`). This is
 * the demonstration that a CRM is just a curated set of views on the Base
 * object/field/record engine: opportunities get a stage PIPELINE board; contacts
 * and opportunities resolve their company relation to a named chip. The live
 * create + delete flow stays (per-org POST / DELETE); delete is bulk via row
 * selection. Views are read-only over live data (no `/v1/crm` update endpoint yet)
 * — honest by construction; every state is loading / BackendStateCard / empty.
 */
import { SubNav } from '~/components/ui/SubNav'
import { productSubpageSlug } from '~/lib/products/match'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button, Card, Text, XStack } from '@hanzo/gui'
import { Building2, Plus, RefreshCw, Target, Trash2, Users } from '@hanzogui/lucide-icons-2'
import { RecordsView, RecordDetail, type FieldDefinition, type SelectOption } from '@hanzo/data'

import {
  CrmApi,
  STAGES,
  type Company,
  type Contact,
  type Opportunity,
  type Summary,
} from '~/lib/api/crm'
import {
  COMPANY_FIELDS, CONTACT_FIELDS, OPPORTUNITY_FIELDS,
  companyRecord, contactRecord, opportunityRecord,
  companyOptions, companyNameLookup,
} from './crm/collections'
import { BackendStateCard, FieldRow, FieldSelect, FieldText, PageHeader, classifyBackend, type BackendState } from '@hanzo/ui/product'

type Async<T> =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; data: T }

type Tab = 'companies' | 'contacts' | 'opportunities'

/** The per-org summary bar (real `/v1/crm/summary` counts). */
function SummaryBar({ summary }: { summary: Summary | null }) {
  const cells: { label: string; value: number | string }[] = [
    { label: 'Companies', value: summary ? summary.companies : '—' },
    { label: 'Contacts', value: summary ? summary.contacts : '—' },
    { label: 'Opportunities', value: summary ? summary.opportunities : '—' },
  ]
  return (
    <XStack gap="$3" mb="$3" flexWrap="wrap">
      {cells.map((c) => (
        <Card key={c.label} p="$3" minW={160} borderWidth={1} borderColor="$borderColor">
          <Text fontSize="$2" color="$color10">{c.label}</Text>
          <Text fontSize="$7" fontWeight="800">{c.value}</Text>
        </Card>
      ))}
    </XStack>
  )
}

/** Bulk-delete affordance in the RecordsView selection bar — confirms, then removes each id. */
function BulkDelete({ ids, onDelete }: { ids: string[]; onDelete: (ids: string[]) => Promise<void> }) {
  const [working, setWorking] = useState(false)
  return (
    <Button
      size="$2"
      theme="red"
      icon={<Trash2 size={15} />}
      disabled={working}
      onPress={async () => {
        if (typeof window !== 'undefined' && !window.confirm(`Delete ${ids.length} record${ids.length > 1 ? 's' : ''}? This cannot be undone.`)) return
        setWorking(true)
        try { await onDelete(ids) } finally { setWorking(false) }
      }}
    >
      {working ? 'Deleting…' : `Delete ${ids.length}`}
    </Button>
  )
}

/** A read-only record detail drawer over the @hanzo/data RecordDetail panel. */
function RecordDrawer({ title, fields, record, onClose }: { title: string; fields: FieldDefinition[]; record: Record<string, unknown>; onClose: () => void }) {
  return (
    <Card mt="$3" p="$4" gap="$2" borderWidth={1} borderColor="$borderColor" maxW={640}>
      <XStack items="center" justify="space-between" mb="$2">
        <Text fontSize="$4" fontWeight="700">Details</Text>
        <Button size="$2" chromeless onPress={onClose}>Close</Button>
      </XStack>
      <RecordDetail title={title} fields={fields} record={record} />
    </Card>
  )
}

/** One collection panel: @hanzo/data RecordsView over mapped live rows + bulk delete + detail drawer. */
function CollectionPanel({
  state, fields, records, onReload, onCreate, createLabel, onDelete, empty, hint, boardDisabled, fieldOptions, drawerTitle,
}: {
  state: Async<unknown>
  fields: FieldDefinition[]
  records: Record<string, unknown>[]
  onReload: () => void
  onCreate: () => void
  createLabel: string
  onDelete: (ids: string[]) => Promise<void>
  empty: string
  hint: string
  boardDisabled?: boolean
  fieldOptions?: (f: FieldDefinition) => SelectOption[] | undefined
  drawerTitle: (r: Record<string, unknown>) => string
}) {
  const [open, setOpen] = useState<Record<string, unknown> | null>(null)
  if (state.phase === 'error') return <BackendStateCard state={state.error} onRetry={onReload} hint={hint} />
  return (
    <>
      <RecordsView
        fields={fields}
        records={records}
        loading={state.phase === 'loading'}
        editable={false}
        boardDisabled={boardDisabled}
        onOpen={setOpen}
        onCreate={onCreate}
        createLabel={createLabel}
        bulkActions={(ids) => <BulkDelete ids={ids} onDelete={onDelete} />}
        fieldOptions={fieldOptions}
        toolbarExtra={<Button size="$2" icon={<RefreshCw size={15} />} onPress={onReload}>Refresh</Button>}
        empty={empty}
      />
      {open ? <RecordDrawer title={drawerTitle(open)} fields={fields} record={open} onClose={() => setOpen(null)} /> : null}
    </>
  )
}

// ── Companies ────────────────────────────────────────────────────────────────

function CompaniesView({ onChanged }: { onChanged: () => void }) {
  const [state, setState] = useState<Async<Company[]>>({ phase: 'loading' })
  const [creating, setCreating] = useState(false)

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    CrmApi.companies.list().then((data) => setState({ phase: 'ready', data })).catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])
  useEffect(() => { load() }, [load])

  const records = useMemo(() => (state.phase === 'ready' ? state.data.map(companyRecord) : []), [state])
  const del = useCallback(async (ids: string[]) => {
    try { await Promise.all(ids.map((id) => CrmApi.companies.remove(id))); load(); onChanged() }
    catch (e) { setState({ phase: 'error', error: classifyBackend(e) }) }
  }, [load, onChanged])

  return (
    <>
      {creating ? <CompanyForm onDone={() => { setCreating(false); load(); onChanged() }} /> : null}
      <CollectionPanel
        state={state} fields={COMPANY_FIELDS} records={records} onReload={load}
        onCreate={() => setCreating((v) => !v)} createLabel="New company" onDelete={del}
        empty="No companies yet. Create your first company to start your CRM."
        hint="endpoint · GET /v1/crm/companies" boardDisabled
        drawerTitle={(r) => String(r.name ?? 'Company')}
      />
    </>
  )
}

function CompanyForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [domainName, setDomain] = useState('')
  const [employees, setEmployees] = useState('')
  const [country, setCountry] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<BackendState | null>(null)

  const submit = async () => {
    if (!name.trim()) { setError({ kind: 'error', message: 'Name is required.' }); return }
    setWorking(true); setError(null)
    try {
      await CrmApi.companies.create({ name: name.trim(), domainName: domainName.trim(), employees: employees.trim() ? Number(employees) : 0, country: country.trim() })
      onDone()
    } catch (e) { setError(classifyBackend(e)) } finally { setWorking(false) }
  }

  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" maxW={760} mb="$3">
      {error ? <BackendStateCard state={error} hint="endpoint · POST /v1/crm/companies" /> : null}
      <FieldRow label="Name"><FieldText value={name} onChange={setName} placeholder="Acme Inc" /></FieldRow>
      <FieldRow label="Domain"><FieldText value={domainName} onChange={setDomain} placeholder="acme.com" /></FieldRow>
      <FieldRow label="Employees"><FieldText value={employees} onChange={setEmployees} placeholder="50" /></FieldRow>
      <FieldRow label="Country"><FieldText value={country} onChange={setCountry} placeholder="US" /></FieldRow>
      <Button self="flex-start" icon={<Plus size={15} />} disabled={working} onPress={() => void submit()}>
        {working ? 'Creating…' : 'Create company'}
      </Button>
    </Card>
  )
}

// ── Contacts ─────────────────────────────────────────────────────────────────

function ContactsView({ companies, onChanged }: { companies: Company[]; onChanged: () => void }) {
  const [state, setState] = useState<Async<Contact[]>>({ phase: 'loading' })
  const [creating, setCreating] = useState(false)

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    CrmApi.contacts.list().then((data) => setState({ phase: 'ready', data })).catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])
  useEffect(() => { load() }, [load])

  const nameOf = useMemo(() => companyNameLookup(companies), [companies])
  const records = useMemo(() => (state.phase === 'ready' ? state.data.map((c) => contactRecord(c, nameOf)) : []), [state, nameOf])
  const fieldOptions = useCallback((f: FieldDefinition) => (f.name === 'company' ? companyOptions(companies) : undefined), [companies])
  const del = useCallback(async (ids: string[]) => {
    try { await Promise.all(ids.map((id) => CrmApi.contacts.remove(id))); load(); onChanged() }
    catch (e) { setState({ phase: 'error', error: classifyBackend(e) }) }
  }, [load, onChanged])

  return (
    <>
      {creating ? <ContactForm onDone={() => { setCreating(false); load(); onChanged() }} /> : null}
      <CollectionPanel
        state={state} fields={CONTACT_FIELDS} records={records} onReload={load}
        onCreate={() => setCreating((v) => !v)} createLabel="New contact" onDelete={del}
        empty="No contacts yet. Add your first contact."
        hint="endpoint · GET /v1/crm/contacts" boardDisabled fieldOptions={fieldOptions}
        drawerTitle={(r) => String(r.name ?? 'Contact')}
      />
    </>
  )
}

function ContactForm({ onDone }: { onDone: () => void }) {
  const [firstName, setFirst] = useState('')
  const [lastName, setLast] = useState('')
  const [email, setEmail] = useState('')
  const [jobTitle, setTitle] = useState('')
  const [phone, setPhone] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<BackendState | null>(null)

  const submit = async () => {
    if (!firstName.trim() && !lastName.trim() && !email.trim()) {
      setError({ kind: 'error', message: 'One of first name, last name, or email is required.' }); return
    }
    setWorking(true); setError(null)
    try {
      await CrmApi.contacts.create({ firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim(), jobTitle: jobTitle.trim(), phone: phone.trim() })
      onDone()
    } catch (e) { setError(classifyBackend(e)) } finally { setWorking(false) }
  }

  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" maxW={760} mb="$3">
      {error ? <BackendStateCard state={error} hint="endpoint · POST /v1/crm/contacts" /> : null}
      <FieldRow label="First name"><FieldText value={firstName} onChange={setFirst} placeholder="Ada" /></FieldRow>
      <FieldRow label="Last name"><FieldText value={lastName} onChange={setLast} placeholder="Lovelace" /></FieldRow>
      <FieldRow label="Email"><FieldText value={email} onChange={setEmail} placeholder="ada@acme.com" /></FieldRow>
      <FieldRow label="Job title"><FieldText value={jobTitle} onChange={setTitle} placeholder="CTO" /></FieldRow>
      <FieldRow label="Phone"><FieldText value={phone} onChange={setPhone} placeholder="+1 555 0100" /></FieldRow>
      <Button self="flex-start" icon={<Plus size={15} />} disabled={working} onPress={() => void submit()}>
        {working ? 'Creating…' : 'Create contact'}
      </Button>
    </Card>
  )
}

// ── Opportunities ────────────────────────────────────────────────────────────

function OpportunitiesView({ companies, onChanged }: { companies: Company[]; onChanged: () => void }) {
  const [state, setState] = useState<Async<Opportunity[]>>({ phase: 'loading' })
  const [creating, setCreating] = useState(false)

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    CrmApi.opportunities.list().then((data) => setState({ phase: 'ready', data })).catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])
  useEffect(() => { load() }, [load])

  const nameOf = useMemo(() => companyNameLookup(companies), [companies])
  const records = useMemo(() => (state.phase === 'ready' ? state.data.map((o) => opportunityRecord(o, nameOf)) : []), [state, nameOf])
  const fieldOptions = useCallback((f: FieldDefinition) => (f.name === 'company' ? companyOptions(companies) : undefined), [companies])
  const del = useCallback(async (ids: string[]) => {
    try { await Promise.all(ids.map((id) => CrmApi.opportunities.remove(id))); load(); onChanged() }
    catch (e) { setState({ phase: 'error', error: classifyBackend(e) }) }
  }, [load, onChanged])

  return (
    <>
      {creating ? <OpportunityForm onDone={() => { setCreating(false); load(); onChanged() }} /> : null}
      <CollectionPanel
        state={state} fields={OPPORTUNITY_FIELDS} records={records} onReload={load}
        onCreate={() => setCreating((v) => !v)} createLabel="New opportunity" onDelete={del}
        empty="No opportunities yet. Create your first deal — then switch to the Board for the stage pipeline."
        hint="endpoint · GET /v1/crm/opportunities" fieldOptions={fieldOptions}
        drawerTitle={(r) => String(r.name ?? 'Opportunity')}
      />
    </>
  )
}

function OpportunityForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [stage, setStage] = useState<string>('NEW')
  const [amount, setAmount] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<BackendState | null>(null)

  const submit = async () => {
    if (!name.trim()) { setError({ kind: 'error', message: 'Name is required.' }); return }
    setWorking(true); setError(null)
    try {
      // Amount is entered in whole currency units; the backend stores minor units (cents).
      await CrmApi.opportunities.create({ name: name.trim(), stage, amount: amount.trim() ? Math.round(Number(amount) * 100) : 0 })
      onDone()
    } catch (e) { setError(classifyBackend(e)) } finally { setWorking(false) }
  }

  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" maxW={760} mb="$3">
      {error ? <BackendStateCard state={error} hint="endpoint · POST /v1/crm/opportunities" /> : null}
      <FieldRow label="Name"><FieldText value={name} onChange={setName} placeholder="Acme — enterprise plan" /></FieldRow>
      <FieldRow label="Stage"><FieldSelect value={stage} options={[...STAGES]} onChange={setStage} /></FieldRow>
      <FieldRow label="Amount"><FieldText value={amount} onChange={setAmount} placeholder="50000" /></FieldRow>
      <Button self="flex-start" icon={<Plus size={15} />} disabled={working} onPress={() => void submit()}>
        {working ? 'Creating…' : 'Create opportunity'}
      </Button>
    </Card>
  )
}

// ── Module ───────────────────────────────────────────────────────────────────

export function CrmModule({ params }: { params: Record<string, string> }) {
  const active: Tab = (productSubpageSlug('crm', params.tab) || 'companies') as Tab
  const [summary, setSummary] = useState<Summary | null>(null)
  const [companies, setCompanies] = useState<Company[]>([])

  const loadSummary = useCallback(() => {
    CrmApi.summary().then(setSummary).catch(() => setSummary(null))
    CrmApi.companies.list().then(setCompanies).catch(() => setCompanies([]))
  }, [])
  useEffect(() => { loadSummary() }, [loadSummary])

  return (
    <>
      <PageHeader
        title="CRM"
        subtitle="Companies, contacts, and opportunities — a curated set of Base views. Switch Table ⇆ Board, filter, sort, group."
      />
      <SubNav id="crm" />
      <SummaryBar summary={summary} />
      {active === 'companies' ? <CompaniesView onChanged={loadSummary} /> : null}
      {active === 'contacts' ? <ContactsView companies={companies} onChanged={loadSummary} /> : null}
      {active === 'opportunities' ? <OpportunitiesView companies={companies} onChanged={loadSummary} /> : null}
    </>
  )
}

