'use client'

/**
 * CRM — companies, contacts, and opportunities (Apps). The first business-app
 * subsystem ported native-Go onto Base (cloud `clients/crm`, spec
 * `universe/docs/architecture/unified-backend-go.md`): a native `/v1/crm`
 * surface, per-org, NOT a proxy to a NestJS backend.
 *
 * At-a-glance board over the REAL registry (`CrmApi` → the user-bearer
 * `/cloud/v1/crm` proxy, org-scoped server-side): three summary cards + a tabbed
 * DataTable (Companies · Contacts · Opportunities), each with a real create form
 * and per-row delete. Honest by construction — counts and rows are real or the
 * cell reads "—"; a backend error renders `BackendStateCard`, never a fake row.
 *
 * Style props use the @hanzo/gui v5 shorthand set (bg/p/px/py/gap/rounded/…);
 * form controls go through the shared `FieldRow`/`FieldText` primitives.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Building2, Plus, RefreshCw, Target, Trash2, Users } from '@hanzogui/lucide-icons-2'

import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { Column, DataTable } from '~/components/ui/DataTable'
import { FieldRow, FieldText } from '~/components/ui/Field'
import { PageHeader } from '~/components/ui/PageHeader'
import { CrmApi, STAGES, type Company, type Contact, type Opportunity, type Summary } from '~/lib/api/crm'

type Tab = 'companies' | 'contacts' | 'opportunities'

const TABS: { id: Tab; label: string; icon: typeof Building2 }[] = [
  { id: 'companies', label: 'Companies', icon: Building2 },
  { id: 'contacts', label: 'Contacts', icon: Users },
  { id: 'opportunities', label: 'Opportunities', icon: Target },
]

/** Minor units (cents) → a compact currency string; 0/absent → "—". */
function money(cents: number, currency: string): string {
  if (!cents) return '—'
  const v = cents / 100
  return `${currency === 'USD' ? '$' : `${currency} `}${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

export function CrmModule(_props: { params: Record<string, string> }) {
  const [tab, setTab] = useState<Tab>('companies')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [companies, setCompanies] = useState<Company[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [opps, setOpps] = useState<Opportunity[]>([])
  const [loading, setLoading] = useState(true)
  const [state, setState] = useState<BackendState | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const setField = (k: string) => (v: string) => setForm((f) => ({ ...f, [k]: v }))

  const load = useCallback(async () => {
    setLoading(true)
    setState(null)
    try {
      const [s, c, p, o] = await Promise.all([
        CrmApi.summary(),
        CrmApi.companies(),
        CrmApi.contacts(),
        CrmApi.opportunities(),
      ])
      setSummary(s)
      setCompanies(c)
      setContacts(p)
      setOpps(o)
    } catch (e) {
      setState(classifyBackend(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const resetForm = () => {
    setCreating(false)
    setForm({})
  }

  const submit = useCallback(async () => {
    setBusy(true)
    try {
      if (tab === 'companies') {
        if (!form.name?.trim()) return
        await CrmApi.createCompany({
          name: form.name.trim(),
          domainName: form.domainName?.trim() || undefined,
          employees: form.employees ? Number(form.employees) : undefined,
          city: form.city?.trim() || undefined,
        })
      } else if (tab === 'contacts') {
        if (!form.firstName?.trim() && !form.lastName?.trim() && !form.email?.trim()) return
        await CrmApi.createContact({
          firstName: form.firstName?.trim() || undefined,
          lastName: form.lastName?.trim() || undefined,
          email: form.email?.trim() || undefined,
          jobTitle: form.jobTitle?.trim() || undefined,
        })
      } else {
        if (!form.name?.trim()) return
        await CrmApi.createOpportunity({
          name: form.name.trim(),
          amount: form.amount ? Math.round(Number(form.amount) * 100) : undefined,
          stage: form.stage || 'NEW',
        })
      }
      resetForm()
      await load()
    } catch (e) {
      setState(classifyBackend(e))
    } finally {
      setBusy(false)
    }
  }, [tab, form, load])

  const del = useCallback(
    async (kind: Tab, id: string) => {
      setBusy(true)
      try {
        if (kind === 'companies') await CrmApi.removeCompany(id)
        else if (kind === 'contacts') await CrmApi.removeContact(id)
        else await CrmApi.removeOpportunity(id)
        await load()
      } catch (e) {
        setState(classifyBackend(e))
      } finally {
        setBusy(false)
      }
    },
    [load],
  )

  const delCell = (kind: Tab, id: string) => (
    <Button size="$2" chromeless icon={<Trash2 size={14} />} disabled={busy} onPress={() => void del(kind, id)} />
  )

  const companyCols: Column<Company>[] = useMemo(
    () => [
      { key: 'name', header: 'Name', render: (r) => r.name || '—' },
      { key: 'domainName', header: 'Domain', render: (r) => r.domainName || '—' },
      { key: 'employees', header: 'Employees', render: (r) => (r.employees ? String(r.employees) : '—'), width: 110 },
      { key: 'arr', header: 'ARR', render: (r) => money(r.arr, r.currency), width: 120 },
      { key: 'del', header: '', render: (r) => delCell('companies', r.id), width: 56 },
    ],
    [busy],
  )

  const contactCols: Column<Contact>[] = useMemo(
    () => [
      { key: 'name', header: 'Name', render: (r) => `${r.firstName} ${r.lastName}`.trim() || '—' },
      { key: 'email', header: 'Email', render: (r) => r.email || '—' },
      { key: 'jobTitle', header: 'Title', render: (r) => r.jobTitle || '—' },
      { key: 'company', header: 'Company', render: (r) => r.companyId || '—' },
      { key: 'del', header: '', render: (r) => delCell('contacts', r.id), width: 56 },
    ],
    [busy],
  )

  const oppCols: Column<Opportunity>[] = useMemo(
    () => [
      { key: 'name', header: 'Name', render: (r) => r.name || '—' },
      { key: 'stage', header: 'Stage', render: (r) => r.stage, width: 120 },
      { key: 'amount', header: 'Amount', render: (r) => money(r.amount, r.currency), width: 120 },
      { key: 'del', header: '', render: (r) => delCell('opportunities', r.id), width: 56 },
    ],
    [busy],
  )

  const cards: { label: string; value: number; icon: typeof Building2 }[] = [
    { label: 'Companies', value: summary?.companies ?? 0, icon: Building2 },
    { label: 'Contacts', value: summary?.contacts ?? 0, icon: Users },
    { label: 'Opportunities', value: summary?.opportunities ?? 0, icon: Target },
  ]

  return (
    <YStack gap="$4" p="$4">
      <PageHeader
        title="CRM"
        subtitle="Companies, contacts, and opportunities — native /v1/crm on Base, per-org."
        actions={
          <XStack gap="$2">
            <Button size="$3" theme="light" icon={<RefreshCw size={15} />} disabled={loading} onPress={() => void load()}>
              Refresh
            </Button>
            <Button size="$3" theme="light" icon={<Plus size={15} />} onPress={() => setCreating((v) => !v)}>
              New
            </Button>
          </XStack>
        }
      />

      {/* Summary cards (real counts) */}
      <XStack gap="$3" flexWrap="wrap">
        {cards.map((c) => {
          const Icon = c.icon
          return (
            <Card key={c.label} flex={1} minW={160} p="$4" gap="$2" borderWidth={1} borderColor="$borderColor">
              <XStack items="center" gap="$2">
                <Icon size={16} color="$color11" />
                <Text color="$color11">{c.label}</Text>
              </XStack>
              <Text fontSize="$8" fontWeight="700">
                {c.value}
              </Text>
            </Card>
          )
        })}
      </XStack>

      {/* Tabs */}
      <XStack gap="$2" borderBottomWidth={1} borderColor="$borderColor" pb="$2">
        {TABS.map((t) => {
          const Icon = t.icon
          const active = t.id === tab
          return (
            <Button
              key={t.id}
              size="$3"
              chromeless={!active}
              theme={active ? 'light' : undefined}
              icon={<Icon size={15} />}
              onPress={() => setTab(t.id)}
            >
              {t.label}
            </Button>
          )
        })}
      </XStack>

      {/* Inline create form (shared Field primitives) */}
      {creating ? (
        <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" maxWidth={560}>
          <Text fontWeight="600">New {tab.slice(0, -1)}</Text>
          {tab === 'companies' ? (
            <>
              <FieldRow label="Name *">
                <FieldText value={form.name ?? ''} onChange={setField('name')} placeholder="Acme Inc" />
              </FieldRow>
              <FieldRow label="Domain">
                <FieldText value={form.domainName ?? ''} onChange={setField('domainName')} placeholder="acme.com" />
              </FieldRow>
              <FieldRow label="Employees">
                <FieldText value={form.employees ?? ''} onChange={setField('employees')} placeholder="50" />
              </FieldRow>
            </>
          ) : null}
          {tab === 'contacts' ? (
            <>
              <FieldRow label="First name">
                <FieldText value={form.firstName ?? ''} onChange={setField('firstName')} placeholder="Ada" />
              </FieldRow>
              <FieldRow label="Last name">
                <FieldText value={form.lastName ?? ''} onChange={setField('lastName')} placeholder="Lovelace" />
              </FieldRow>
              <FieldRow label="Email">
                <FieldText value={form.email ?? ''} onChange={setField('email')} placeholder="ada@acme.com" />
              </FieldRow>
            </>
          ) : null}
          {tab === 'opportunities' ? (
            <>
              <FieldRow label="Name *">
                <FieldText value={form.name ?? ''} onChange={setField('name')} placeholder="Enterprise deal" />
              </FieldRow>
              <FieldRow label="Amount ($)">
                <FieldText value={form.amount ?? ''} onChange={setField('amount')} placeholder="50000" />
              </FieldRow>
            </>
          ) : null}
          <XStack gap="$2" justify="flex-end">
            <Button size="$3" chromeless onPress={resetForm}>
              Cancel
            </Button>
            <Button size="$3" theme="light" disabled={busy} onPress={() => void submit()}>
              Create
            </Button>
          </XStack>
        </Card>
      ) : null}

      {/* Backend error, else the active table */}
      {state ? (
        <BackendStateCard state={state} onRetry={load} hint="endpoint · GET /v1/crm/*" />
      ) : tab === 'companies' ? (
        <DataTable columns={companyCols} rows={companies} loading={loading} rowKey={(r) => r.id} empty="No companies yet." />
      ) : tab === 'contacts' ? (
        <DataTable columns={contactCols} rows={contacts} loading={loading} rowKey={(r) => r.id} empty="No contacts yet." />
      ) : (
        <DataTable columns={oppCols} rows={opps} loading={loading} rowKey={(r) => r.id} empty="No opportunities yet." />
      )}

      <Text fontSize="$1" color="$color10">
        Stages: {STAGES.join(' · ')}
      </Text>
    </YStack>
  )
}
