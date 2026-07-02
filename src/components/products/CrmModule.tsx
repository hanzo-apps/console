'use client'

/**
 * CRM — the first Hanzo Business-OS brick, over the REAL cloud `/v1/crm` surface
 * (cloud `clients/crm`: a native-Go, per-org CRM on Base/SQLite — companies,
 * contacts, opportunities, a port of Twenty's core model). Every read/write goes
 * through the console's OWN user-bearer `/cloud` proxy (`CrmApi` →
 * `cloudProxyV1Url('crm/...')`): the server mints a short-lived user token and the
 * backend resolves the org from the token owner claim, so every row is org-scoped
 * SERVER-SIDE and no credential reaches the browser — the SAME per-tenant path
 * Prompts/Agents/Functions use.
 *
 * One module, three collections selected by a local tab (`/crm/:tab`, default
 * companies). Each collection is a real list + an inline create form; a header
 * shows the per-org `/v1/crm/summary` counts. Every state is honest: loading, the
 * shared BackendStateCard on 401/403/404/503, and a true empty state — never
 * placeholder rows.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Building2, Plus, RefreshCw, Users, Target } from '@hanzogui/lucide-icons-2'

import {
  CrmApi,
  STAGES,
  type Company,
  type Contact,
  type Opportunity,
  type Summary,
} from '~/lib/api/crm'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { FieldRow, FieldText, FieldSelect } from '~/components/ui/Field'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'

type Async<T> =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; data: T }

type Tab = 'companies' | 'contacts' | 'opportunities'
const TABS: { id: Tab; label: string; icon: typeof Building2 }[] = [
  { id: 'companies', label: 'Companies', icon: Building2 },
  { id: 'contacts', label: 'Contacts', icon: Users },
  { id: 'opportunities', label: 'Opportunities', icon: Target },
]

const fmtTime = (s?: number) => (s ? new Date(s * 1000).toLocaleString() : '-')
const fmtMoney = (amount: number, currency: string) =>
  amount ? `${(amount / 100).toLocaleString(undefined, { style: 'currency', currency: currency || 'USD' })}` : '-'
const dash = (s: string) => (s.trim() ? s : '-')

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
        <Card key={c.label} p="$3" minWidth={160} borderWidth={1} borderColor="$borderColor">
          <Text fontSize="$2" color="$color10">{c.label}</Text>
          <Text fontSize="$7" fontWeight="800">{c.value}</Text>
        </Card>
      ))}
    </XStack>
  )
}

// ── Companies ────────────────────────────────────────────────────────────────

function CompaniesView({ onChanged }: { onChanged: () => void }) {
  const [state, setState] = useState<Async<Company[]>>({ phase: 'loading' })
  const [creating, setCreating] = useState(false)

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    CrmApi.companies
      .list()
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])
  useEffect(() => { load() }, [load])

  const columns: Column<Company>[] = [
    { key: 'name', header: 'Name', render: (r) => <Text fontSize="$3" fontWeight="600">{dash(r.name)}</Text> },
    { key: 'domainName', header: 'Domain', render: (r) => <Text fontSize="$3" color="$color11">{dash(r.domainName)}</Text> },
    { key: 'employees', header: 'Employees', width: 110, render: (r) => <Text fontSize="$3" color="$color11">{r.employees || '-'}</Text> },
    { key: 'arr', header: 'ARR', width: 130, render: (r) => <Text fontSize="$3" color="$color11">{fmtMoney(r.arr, r.currency)}</Text> },
    { key: 'country', header: 'Country', width: 120, render: (r) => <Text fontSize="$3" color="$color11">{dash(r.country)}</Text> },
    { key: 'createdAt', header: 'Created', width: 190, render: (r) => <Text fontSize="$3" color="$color10">{fmtTime(r.createdAt)}</Text> },
  ]

  return (
    <>
      <Toolbar onNew={() => setCreating((v) => !v)} onRefresh={load} newLabel="New company" />
      {creating ? <CompanyForm onDone={() => { setCreating(false); load(); onChanged() }} /> : null}
      {state.phase === 'error' ? (
        <BackendStateCard state={state.error} onRetry={load} hint="endpoint · GET /v1/crm/companies" />
      ) : (
        <DataTable
          columns={columns}
          rows={state.phase === 'ready' ? state.data : []}
          loading={state.phase === 'loading'}
          rowKey={(r) => r.id}
          empty="No companies yet. Create your first company to start your CRM."
        />
      )}
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
      await CrmApi.companies.create({
        name: name.trim(),
        domainName: domainName.trim(),
        employees: employees.trim() ? Number(employees) : 0,
        country: country.trim(),
      })
      onDone()
    } catch (e) { setError(classifyBackend(e)) } finally { setWorking(false) }
  }

  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" maxWidth={760} mb="$3">
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

function ContactsView({ onChanged }: { onChanged: () => void }) {
  const [state, setState] = useState<Async<Contact[]>>({ phase: 'loading' })
  const [creating, setCreating] = useState(false)

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    CrmApi.contacts
      .list()
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])
  useEffect(() => { load() }, [load])

  const columns: Column<Contact>[] = [
    { key: 'name', header: 'Name', render: (r) => <Text fontSize="$3" fontWeight="600">{dash(`${r.firstName} ${r.lastName}`.trim())}</Text> },
    { key: 'email', header: 'Email', render: (r) => <Text fontSize="$3" color="$color11">{dash(r.email)}</Text> },
    { key: 'jobTitle', header: 'Title', render: (r) => <Text fontSize="$3" color="$color11">{dash(r.jobTitle)}</Text> },
    { key: 'phone', header: 'Phone', width: 150, render: (r) => <Text fontSize="$3" color="$color11">{dash(r.phone)}</Text> },
    { key: 'createdAt', header: 'Created', width: 190, render: (r) => <Text fontSize="$3" color="$color10">{fmtTime(r.createdAt)}</Text> },
  ]

  return (
    <>
      <Toolbar onNew={() => setCreating((v) => !v)} onRefresh={load} newLabel="New contact" />
      {creating ? <ContactForm onDone={() => { setCreating(false); load(); onChanged() }} /> : null}
      {state.phase === 'error' ? (
        <BackendStateCard state={state.error} onRetry={load} hint="endpoint · GET /v1/crm/contacts" />
      ) : (
        <DataTable
          columns={columns}
          rows={state.phase === 'ready' ? state.data : []}
          loading={state.phase === 'loading'}
          rowKey={(r) => r.id}
          empty="No contacts yet. Add your first contact."
        />
      )}
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
      await CrmApi.contacts.create({
        firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim(),
        jobTitle: jobTitle.trim(), phone: phone.trim(),
      })
      onDone()
    } catch (e) { setError(classifyBackend(e)) } finally { setWorking(false) }
  }

  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" maxWidth={760} mb="$3">
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

function OpportunitiesView({ onChanged }: { onChanged: () => void }) {
  const [state, setState] = useState<Async<Opportunity[]>>({ phase: 'loading' })
  const [creating, setCreating] = useState(false)

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    CrmApi.opportunities
      .list()
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])
  useEffect(() => { load() }, [load])

  const columns: Column<Opportunity>[] = [
    { key: 'name', header: 'Name', render: (r) => <Text fontSize="$3" fontWeight="600">{dash(r.name)}</Text> },
    { key: 'stage', header: 'Stage', width: 130, render: (r) => <Text fontSize="$3" color="$color11">{r.stage}</Text> },
    { key: 'amount', header: 'Amount', width: 140, render: (r) => <Text fontSize="$3" color="$color11">{fmtMoney(r.amount, r.currency)}</Text> },
    { key: 'createdAt', header: 'Created', width: 190, render: (r) => <Text fontSize="$3" color="$color10">{fmtTime(r.createdAt)}</Text> },
  ]

  return (
    <>
      <Toolbar onNew={() => setCreating((v) => !v)} onRefresh={load} newLabel="New opportunity" />
      {creating ? <OpportunityForm onDone={() => { setCreating(false); load(); onChanged() }} /> : null}
      {state.phase === 'error' ? (
        <BackendStateCard state={state.error} onRetry={load} hint="endpoint · GET /v1/crm/opportunities" />
      ) : (
        <DataTable
          columns={columns}
          rows={state.phase === 'ready' ? state.data : []}
          loading={state.phase === 'loading'}
          rowKey={(r) => r.id}
          empty="No opportunities yet. Create your first deal."
        />
      )}
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
      await CrmApi.opportunities.create({
        name: name.trim(), stage,
        amount: amount.trim() ? Math.round(Number(amount) * 100) : 0,
      })
      onDone()
    } catch (e) { setError(classifyBackend(e)) } finally { setWorking(false) }
  }

  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" maxWidth={760} mb="$3">
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

// ── Shared toolbar ───────────────────────────────────────────────────────────

function Toolbar({ onNew, onRefresh, newLabel }: { onNew: () => void; onRefresh: () => void; newLabel: string }) {
  return (
    <XStack gap="$2" mb="$3">
      <Button size="$2" icon={<Plus size={15} />} onPress={onNew}>{newLabel}</Button>
      <Button size="$2" icon={<RefreshCw size={15} />} onPress={onRefresh}>Refresh</Button>
    </XStack>
  )
}

// ── Module ───────────────────────────────────────────────────────────────────

export function CrmModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const active: Tab = (['companies', 'contacts', 'opportunities'] as Tab[]).includes(params.tab as Tab)
    ? (params.tab as Tab)
    : 'companies'
  const [summary, setSummary] = useState<Summary | null>(null)

  const loadSummary = useCallback(() => {
    CrmApi.summary().then(setSummary).catch(() => setSummary(null))
  }, [])
  useEffect(() => { loadSummary() }, [loadSummary])

  const nav = useMemo(
    () =>
      TABS.map(({ id, label, icon: Icon }) => (
        <Button
          key={id}
          size="$2"
          theme={active === id ? 'light' : undefined}
          icon={<Icon size={15} />}
          onPress={() => router.push(id === 'companies' ? '/crm' : `/crm/${id}`)}
        >
          {label}
        </Button>
      )),
    [active, router],
  )

  return (
    <>
      <PageHeader
        title="CRM"
        subtitle="Companies, contacts, and opportunities — your Hanzo Business-OS CRM, per org."
        actions={<XStack gap="$2">{nav}</XStack>}
      />
      <SummaryBar summary={summary} />
      {active === 'companies' ? <CompaniesView onChanged={loadSummary} /> : null}
      {active === 'contacts' ? <ContactsView onChanged={loadSummary} /> : null}
      {active === 'opportunities' ? <OpportunitiesView onChanged={loadSummary} /> : null}
    </>
  )
}
