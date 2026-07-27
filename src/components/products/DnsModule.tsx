'use client'

/**
 * DNS — per-org managed DNS as a full CRUD dashboard over the hanzodns control
 * plane (`hanzoai/dns`: CoreDNS + the `hanzodns` plugin), on the unified `/v1/dns`
 * surface. ONE screen manages BOTH authoritative zones (served from CoreDNS
 * in-cluster) AND connected Cloudflare zones (records synced to Cloudflare via the
 * per-org KMS-sealed connector token) — a provider badge on every zone says which
 * backend serves it.
 *
 * Master → detail, in-component: the zones list (name · provider · record count ·
 * DNSSEC · status) drills into a zone's records TABLE with add / edit / delete, the
 * Cloudflare orange-cloud Proxied toggle (only on a proxyable record of a Cloudflare
 * zone), TTL and type. "Connect Cloudflare" kicks the existing
 * `/v1/integrations/cloudflare/connect` OAuth flow (reusing `IntegrationsApi`, DRY).
 *
 * Every read/write is same-origin, keyless and org-scoped SERVER-SIDE (the `/v1`
 * bearer BFF mints a short-lived user token; the cloud `dns` head resolves the org
 * from the token owner), so no credential reaches the browser. States are honest:
 * loading skeletons, a `BackendStateCard` on a `/v1/dns` failure, and real empty
 * states — it never fabricates a zone or a record. Until the cloud `dns` provider
 * route is bound it shows the honest "not available yet" card, never placeholder data.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowLeft, Cloud, Globe, Pencil, Plus, RefreshCw, Server, ShieldCheck, Trash2 } from '@hanzogui/lucide-icons-2'

import {
  DnsApi,
  RECORD_TYPES,
  createBody,
  patchBody,
  validateRecord,
  validateZoneName,
  hasPriority,
  isProxyable,
  isCloudflare,
  providerLabel,
  displayZone,
  type DnsRecord,
  type RecordInput,
  type RecordType,
  type Zone,
} from '~/lib/api/dns'
import { IntegrationsApi } from '~/lib/api/integrations'
import { PageHeader } from '@hanzo/ui/product'
import { PrimaryButton } from '@hanzo/ui/product'
import { DataTable, type Column } from '@hanzo/ui/product'
import { EmptyState } from '@hanzo/ui/product'
import { BackendStateCard, classifyBackend, type BackendState } from '@hanzo/ui/product'
import { StatusTag } from '@hanzo/ui/product'
import { SlideOver } from '@hanzo/ui/product'
import { FieldRow, FieldText, FieldTextArea, FieldSelect, FieldSwitch } from '@hanzo/ui/product'
import { useToast } from '@hanzo/ui/product'
import { ConfirmDelete } from '@hanzo/ui/product'

/** Cloudflare brand orange — used ONLY for the Cloudflare provider/proxy affordances. */
const CF_ORANGE = '#F38020'

type Async<T> =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; data: T }

// ── Small presentational cells ───────────────────────────────────────────────

/** Provider pill — Cloudflare (orange cloud) vs Authoritative (CoreDNS, neutral). */
function ProviderBadge({ provider }: { provider: string }) {
  const cf = isCloudflare(provider)
  return (
    <XStack
      items="center"
      gap="$1.5"
      px="$2"
      py="$1"
      rounded="$2"
      bg="$color3"
      style={cf ? { backgroundColor: 'rgba(243,128,32,0.14)' } : undefined}
    >
      {cf ? <Cloud size={12} color={CF_ORANGE} /> : <Server size={12} color="#9a9a9a" />}
      <Text fontSize="$1" color={cf ? undefined : '$color11'} style={cf ? { color: CF_ORANGE } : undefined}>
        {providerLabel(provider)}
      </Text>
    </XStack>
  )
}

/** DNSSEC state cell. */
function DnssecCell({ dnssec }: { dnssec: boolean }) {
  if (!dnssec) return <Text fontSize="$2" color="$color10">Off</Text>
  return (
    <XStack items="center" gap="$1">
      <ShieldCheck size={13} color="$green10" />
      <Text fontSize="$2" color="$color11">On</Text>
    </XStack>
  )
}

/** Proxy cell — the orange-cloud state, meaningful only for a proxyable record of a
 *  Cloudflare zone; otherwise an honest em-dash (proxy N/A). */
function ProxiedCell({ zone, record }: { zone: Zone; record: DnsRecord }) {
  if (!isCloudflare(zone.provider) || !isProxyable(record.type)) return <Text fontSize="$2" color="$color9">—</Text>
  return record.proxied ? (
    <XStack items="center" gap="$1">
      <Cloud size={13} color={CF_ORANGE} />
      <Text fontSize="$2" style={{ color: CF_ORANGE }}>Proxied</Text>
    </XStack>
  ) : (
    <XStack items="center" gap="$1">
      <Cloud size={13} color="#9a9a9a" />
      <Text fontSize="$2" color="$color10">DNS only</Text>
    </XStack>
  )
}

/** The per-org summary bar (real derived counts). */
function SummaryBar({ zones }: { zones: Zone[] }) {
  const cf = zones.filter((z) => isCloudflare(z.provider)).length
  const cells: { label: string; value: number }[] = [
    { label: 'Zones', value: zones.length },
    { label: 'Cloudflare', value: cf },
    { label: 'Authoritative', value: zones.length - cf },
    { label: 'Records', value: zones.reduce((n, z) => n + z.recordCount, 0) },
  ]
  return (
    <XStack gap="$3" flexWrap="wrap">
      {cells.map((c) => (
        <YStack key={c.label} gap="$1" borderWidth={1} borderColor="$borderColor" rounded="$4" px="$4" py="$3" minW={140}>
          <Text fontSize="$1" color="$color10">{c.label}</Text>
          <Text fontSize="$6" fontWeight="500" className="hz-tnum">{c.value}</Text>
        </YStack>
      ))}
    </XStack>
  )
}

// ── Forms (rendered inside the shared SlideOver) ─────────────────────────────

/** Create-zone form → real POST /v1/dns/zones. */
function ZoneForm({ onDone }: { onDone: (created?: Zone) => void }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    const v = validateZoneName(name)
    if (v) {
      setErr(v)
      return
    }
    setSaving(true)
    setErr(null)
    try {
      const z = await DnsApi.zones.create(name)
      toast.success(`Created zone ${displayZone(z.name)}`)
      onDone(z)
    } catch (e) {
      setErr(classifyBackend(e).message || 'Failed to create zone.')
      setSaving(false)
    }
  }

  return (
    <YStack gap="$3">
      <FieldRow label="Zone (domain)">
        <FieldText value={name} onChange={setName} placeholder="example.com" disabled={saving} />
      </FieldRow>
      <Text fontSize="$2" color="$color10">
        Records for a new zone resolve from CoreDNS in-cluster (authoritative). Connect Cloudflare to sync a zone to
        Cloudflare instead.
      </Text>
      {err ? <Text fontSize="$2" color="$red10">{err}</Text> : null}
      <PrimaryButton onPress={submit} disabled={saving} icon={<Plus size={16} />}>
        {saving ? 'Creating…' : 'Create zone'}
      </PrimaryButton>
    </YStack>
  )
}

/** Sensible per-type placeholder for the Value field (honest examples, never fake data). */
function contentPlaceholder(type: RecordType): string {
  switch (type) {
    case 'A': return '192.0.2.1'
    case 'AAAA': return '2001:db8::1'
    case 'CNAME': return 'target.example.com'
    case 'MX': return 'mail.example.com'
    case 'TXT': return 'v=spf1 include:_spf.example.com ~all'
    case 'NS': return 'ns1.example.com'
    case 'SRV': return '10 5 5060 sip.example.com'
    case 'CAA': return '0 issue "letsencrypt.org"'
    default: return ''
  }
}

/** Create OR edit a record → POST (create) / PATCH minimal-diff (edit). */
function RecordForm({ zone, record, onDone }: { zone: Zone; record?: DnsRecord; onDone: () => void }) {
  const toast = useToast()
  const cf = isCloudflare(zone.provider)
  const [name, setName] = useState(record?.name ?? '')
  const [type, setType] = useState<RecordType>(record?.type ?? 'A')
  const [content, setContent] = useState(record?.content ?? '')
  const [ttl, setTtl] = useState(String(record?.ttl ?? 300))
  const [priority, setPriority] = useState(String(record?.priority ?? 10))
  const [proxied, setProxied] = useState(record?.proxied ?? false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const input = (): RecordInput => ({
    name,
    type,
    content,
    ttl: Number(ttl.trim()),
    priority: Number(priority.trim()),
    proxied,
  })

  const submit = async () => {
    const inp = input()
    const v = validateRecord(inp)
    if (v) {
      setErr(v)
      return
    }
    setSaving(true)
    setErr(null)
    try {
      if (record) {
        const patch = patchBody(record, inp, cf)
        if (Object.keys(patch).length === 0) {
          toast.info('No changes to save')
          onDone()
          return
        }
        await DnsApi.records.update(zone.name, record.id, patch)
        toast.success(`Updated ${inp.name}`)
      } else {
        await DnsApi.records.create(zone.name, createBody(inp, cf))
        toast.success(`Added ${inp.type} ${inp.name || '@'}`)
      }
      onDone()
    } catch (e) {
      setErr(classifyBackend(e).message || 'Failed to save record.')
      setSaving(false)
    }
  }

  const showProxy = cf && isProxyable(type)

  return (
    <YStack gap="$3">
      <FieldRow label="Name">
        <FieldText value={name} onChange={setName} placeholder="www  (or @ for the apex)" disabled={saving} />
      </FieldRow>
      <FieldRow label="Type">
        <FieldSelect value={type} options={[...RECORD_TYPES]} onChange={(v) => setType(v as RecordType)} disabled={saving} />
      </FieldRow>
      <FieldRow label="Value">
        {type === 'TXT' ? (
          <FieldTextArea value={content} onChange={setContent} disabled={saving} rows={3} />
        ) : (
          <FieldText value={content} onChange={setContent} placeholder={contentPlaceholder(type)} disabled={saving} />
        )}
      </FieldRow>
      <FieldRow label="TTL (seconds)">
        <FieldText value={ttl} onChange={setTtl} placeholder="300" disabled={saving} />
      </FieldRow>
      {hasPriority(type) ? (
        <FieldRow label="Priority">
          <FieldText value={priority} onChange={setPriority} placeholder="10" disabled={saving} />
        </FieldRow>
      ) : null}
      {showProxy ? (
        <FieldRow label="Proxy (Cloudflare)">
          <XStack items="center" gap="$2">
            <FieldSwitch checked={proxied} onChange={setProxied} disabled={saving} />
            <Text fontSize="$2" color="$color10">
              {proxied ? 'Proxied — traffic routes through Cloudflare.' : 'DNS only — resolves to the origin.'}
            </Text>
          </XStack>
        </FieldRow>
      ) : null}
      {err ? <Text fontSize="$2" color="$red10">{err}</Text> : null}
      <PrimaryButton onPress={submit} disabled={saving}>
        {saving ? 'Saving…' : record ? 'Save changes' : 'Add record'}
      </PrimaryButton>
    </YStack>
  )
}

// ── Dialog model (ONE SlideOver, many contents — DRY) ────────────────────────

type Dialog =
  | { kind: 'none' }
  | { kind: 'newZone' }
  | { kind: 'newRecord'; zone: Zone }
  | { kind: 'editRecord'; zone: Zone; record: DnsRecord }
  | { kind: 'deleteZone'; zone: Zone }
  | { kind: 'deleteRecord'; zone: Zone; record: DnsRecord }

// ── Module ───────────────────────────────────────────────────────────────────

export function DnsModule(_props: { params: Record<string, string> }) {
  const toast = useToast()
  const [zonesState, setZonesState] = useState<Async<Zone[]>>({ phase: 'loading' })
  const [active, setActive] = useState<Zone | null>(null)
  const [recordsState, setRecordsState] = useState<Async<DnsRecord[]>>({ phase: 'loading' })
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' })
  const [cf, setCf] = useState<{ available: boolean; connected: boolean } | null>(null)

  const loadZones = useCallback(async (): Promise<Zone[]> => {
    setZonesState({ phase: 'loading' })
    try {
      const zones = await DnsApi.zones.list()
      setZonesState({ phase: 'ready', data: zones })
      return zones
    } catch (e) {
      setZonesState({ phase: 'error', error: classifyBackend(e) })
      return []
    }
  }, [])

  const loadRecords = useCallback(async (zone: Zone) => {
    setRecordsState({ phase: 'loading' })
    try {
      setRecordsState({ phase: 'ready', data: await DnsApi.records.list(zone.name) })
    } catch (e) {
      setRecordsState({ phase: 'error', error: classifyBackend(e) })
    }
  }, [])

  useEffect(() => {
    void loadZones()
  }, [loadZones])

  // Cloudflare connection status — best-effort. A 404/unavailable (connector not
  // registered on this deployment) hides the chip; the Connect button stays and
  // reports honestly on press.
  useEffect(() => {
    let alive = true
    IntegrationsApi.get('cloudflare')
      .then((p) => alive && setCf({ available: p.available, connected: p.connected }))
      .catch(() => alive && setCf(null))
    return () => {
      alive = false
    }
  }, [])

  const openZone = useCallback(
    (zone: Zone) => {
      setActive(zone)
      void loadRecords(zone)
    },
    [loadRecords],
  )

  const backToZones = useCallback(() => {
    setActive(null)
    void loadZones()
  }, [loadZones])

  // After a record mutation: refresh zone counts + records, and re-sync the active
  // zone object (its recordCount changed).
  const afterRecordChange = useCallback(async () => {
    setDialog({ kind: 'none' })
    if (!active) return
    const zones = await loadZones()
    const fresh = zones.find((z) => z.name === active.name) ?? active
    setActive(fresh)
    await loadRecords(fresh)
  }, [active, loadZones, loadRecords])

  const afterZoneCreate = useCallback(
    (created?: Zone) => {
      setDialog({ kind: 'none' })
      void loadZones()
      // Land in the new zone so the user can add records immediately.
      if (created) openZone(created)
    },
    [loadZones, openZone],
  )

  const afterZoneDelete = useCallback(() => {
    setDialog({ kind: 'none' })
    setActive(null)
    void loadZones()
  }, [loadZones])

  const connectCloudflare = useCallback(async () => {
    try {
      const { authorizeUrl } = await IntegrationsApi.connect('cloudflare')
      if (authorizeUrl) {
        window.location.assign(authorizeUrl)
        return
      }
      toast.error('Could not start the Cloudflare connection.')
    } catch (e) {
      const s = classifyBackend(e)
      toast.error(
        'Cloudflare not connected',
        s.kind === 'not-initialized' || s.kind === 'unavailable'
          ? 'The Cloudflare connector isn’t configured on this deployment yet.'
          : s.message,
      )
    }
  }, [toast])

  // ── Column defs ──
  const zoneColumns: Column<Zone>[] = [
    {
      key: 'name',
      header: 'Zone',
      render: (z) => (
        <XStack items="center" gap="$2" flex={1} minW={0}>
          <Globe size={14} color="#9a9a9a" />
          <Text fontSize="$3" color="$color12" numberOfLines={1} flex={1} minW={0}>{displayZone(z.name)}</Text>
        </XStack>
      ),
    },
    { key: 'provider', header: 'Provider', width: 150, render: (z) => <ProviderBadge provider={z.provider} /> },
    { key: 'records', header: 'Records', width: 90, align: 'right', mono: true, render: (z) => String(z.recordCount) },
    { key: 'dnssec', header: 'DNSSEC', width: 100, render: (z) => <DnssecCell dnssec={z.dnssec} /> },
    { key: 'status', header: 'Status', width: 110, render: (z) => <StatusTag status={z.status} /> },
  ]

  const recordColumns: Column<DnsRecord>[] = [
    { key: 'name', header: 'Name', render: (r) => <Text fontSize="$3" color="$color12" numberOfLines={1}>{r.name || '@'}</Text> },
    { key: 'type', header: 'Type', width: 80, render: (r) => <Text fontSize="$2" className="hz-mono" color="$color11">{r.type}</Text> },
    { key: 'content', header: 'Value', render: (r) => <Text fontSize="$3" className="hz-mono" color="$color12" numberOfLines={1}>{r.content}</Text> },
    { key: 'ttl', header: 'TTL', width: 80, align: 'right', mono: true, render: (r) => String(r.ttl) },
    { key: 'priority', header: 'Prio', width: 64, align: 'right', mono: true, render: (r) => (hasPriority(r.type) ? String(r.priority) : '—') },
    { key: 'proxied', header: 'Proxy', width: 110, render: (r) => active ? <ProxiedCell zone={active} record={r} /> : null },
    {
      key: 'actions',
      header: '',
      width: 108,
      align: 'right',
      // ≥44px hit areas + a wide Edit↔Delete gap so the destructive Delete is hard
      // to mis-tap on touch (the icon glyph stays small; the tap target is 44×44).
      render: (r) =>
        active ? (
          <XStack gap="$3" justify="flex-end">
            <Button chromeless width={44} height={44} icon={<Pencil size={15} />} aria-label="Edit record" onPress={() => setDialog({ kind: 'editRecord', zone: active, record: r })} />
            <Button chromeless width={44} height={44} icon={<Trash2 size={15} />} aria-label="Delete record" onPress={() => setDialog({ kind: 'deleteRecord', zone: active, record: r })} />
          </XStack>
        ) : null,
    },
  ]

  const inZone = active !== null

  return (
    <YStack gap="$4" p="$4">
      {inZone ? (
        <Button chromeless size="$3" minH={44} icon={<ArrowLeft size={15} />} self="flex-start" onPress={backToZones}>
          All zones
        </Button>
      ) : null}

      <PageHeader
        title={inZone ? `DNS · ${displayZone(active!.name)}` : 'DNS'}
        subtitle={
          inZone
            ? isCloudflare(active!.provider)
              ? 'Cloudflare-backed zone — records sync to Cloudflare via the org connector.'
              : 'Authoritative zone — records resolve from CoreDNS in-cluster.'
            : 'Manage authoritative and connected Cloudflare zones + records from one screen.'
        }
        actions={
          inZone ? (
            <>
              <PrimaryButton onPress={() => setDialog({ kind: 'newRecord', zone: active! })} icon={<Plus size={16} />}>
                New record
              </PrimaryButton>
              <Button onPress={() => void loadRecords(active!)} icon={<RefreshCw size={16} />}>
                Refresh
              </Button>
              <Button
                icon={<Trash2 size={16} />}
                onPress={() => setDialog({ kind: 'deleteZone', zone: active! })}
                aria-label="Delete zone"
              >
                Delete zone
              </Button>
            </>
          ) : (
            <>
              {cf?.connected ? (
                <XStack items="center" gap="$1.5" px="$2.5" py="$1.5" rounded="$3" style={{ backgroundColor: 'rgba(243,128,32,0.14)' }}>
                  <Cloud size={14} color={CF_ORANGE} />
                  <Text fontSize="$2" style={{ color: CF_ORANGE }}>Cloudflare connected</Text>
                </XStack>
              ) : (
                <Button onPress={connectCloudflare} icon={<Cloud size={16} color={CF_ORANGE} />}>
                  Connect Cloudflare
                </Button>
              )}
              <PrimaryButton onPress={() => setDialog({ kind: 'newZone' })} icon={<Plus size={16} />}>
                New zone
              </PrimaryButton>
              <Button onPress={() => void loadZones()} icon={<RefreshCw size={16} />}>
                Refresh
              </Button>
            </>
          )
        }
      />

      {inZone ? (
        // ── Records view ──
        recordsState.phase === 'error' ? (
          <BackendStateCard
            state={recordsState.error}
            onRetry={() => void loadRecords(active!)}
            hint="endpoint · GET /v1/dns/zones/{zone}/records"
          />
        ) : recordsState.phase === 'ready' && recordsState.data.length === 0 ? (
          <EmptyState
            icon={Globe}
            title={`No records in ${displayZone(active!.name)}`}
            description="Add a record to start resolving names in this zone."
            primary={{ label: 'New record', onPress: () => setDialog({ kind: 'newRecord', zone: active! }) }}
          />
        ) : (
          <DataTable<DnsRecord>
            columns={recordColumns}
            rows={recordsState.phase === 'ready' ? recordsState.data : []}
            loading={recordsState.phase === 'loading'}
            empty="No records in this zone yet."
            rowKey={(r) => r.id}
          />
        )
      ) : // ── Zones view ──
      zonesState.phase === 'error' ? (
        <BackendStateCard state={zonesState.error} onRetry={() => void loadZones()} hint="endpoint · GET /v1/dns/zones" />
      ) : zonesState.phase === 'ready' && zonesState.data.length === 0 ? (
        <EmptyState
          icon={Globe}
          title="No DNS zones yet"
          description="Create a zone to manage its records, or connect Cloudflare to bring your existing zones in."
          primary={{ label: 'New zone', onPress: () => setDialog({ kind: 'newZone' }) }}
          secondary={{ label: 'Connect Cloudflare', onPress: connectCloudflare }}
        />
      ) : (
        <YStack gap="$4">
          {zonesState.phase === 'ready' ? <SummaryBar zones={zonesState.data} /> : null}
          <DataTable<Zone>
            columns={zoneColumns}
            rows={zonesState.phase === 'ready' ? zonesState.data : []}
            loading={zonesState.phase === 'loading'}
            empty="No DNS zones yet."
            rowKey={(z) => z.id}
            onRowPress={openZone}
          />
        </YStack>
      )}

      {/* ONE SlideOver, content by dialog kind. */}
      <SlideOver
        open={dialog.kind !== 'none'}
        onClose={() => setDialog({ kind: 'none' })}
        title={
          dialog.kind === 'newZone'
            ? 'New zone'
            : dialog.kind === 'newRecord'
              ? `New record · ${displayZone(dialog.zone.name)}`
              : dialog.kind === 'editRecord'
                ? `Edit ${dialog.record.name || '@'} (${dialog.record.type})`
                : dialog.kind === 'deleteZone'
                  ? `Delete zone ${displayZone(dialog.zone.name)}`
                  : dialog.kind === 'deleteRecord'
                    ? 'Delete record'
                    : ''
        }
        icon={dialog.kind === 'deleteZone' || dialog.kind === 'deleteRecord' ? Trash2 : Globe}
        ariaLabel="DNS dialog"
      >
        {dialog.kind === 'newZone' ? (
          <ZoneForm onDone={afterZoneCreate} />
        ) : dialog.kind === 'newRecord' ? (
          <RecordForm zone={dialog.zone} onDone={afterRecordChange} />
        ) : dialog.kind === 'editRecord' ? (
          <RecordForm zone={dialog.zone} record={dialog.record} onDone={afterRecordChange} />
        ) : dialog.kind === 'deleteZone' ? (
          <ConfirmDelete
            message={`Delete ${displayZone(dialog.zone.name)} and all ${dialog.zone.recordCount} of its records? This cannot be undone.`}
            confirmLabel="Delete zone"
            run={() => DnsApi.zones.remove(dialog.zone.name)}
            onDone={afterZoneDelete}
          />
        ) : dialog.kind === 'deleteRecord' ? (
          <ConfirmDelete
            message={`Delete the ${dialog.record.type} record “${dialog.record.name || '@'}” → ${dialog.record.content}?`}
            confirmLabel="Delete record"
            run={() => DnsApi.records.remove(dialog.zone.name, dialog.record.id)}
            onDone={afterRecordChange}
          />
        ) : null}
      </SlideOver>
    </YStack>
  )
}

export default DnsModule
