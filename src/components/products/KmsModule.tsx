'use client'

/**
 * Secrets (KMS) — full management in-console (the one FE for all).
 *
 * Hanzo KMS is zero-knowledge: there is no "list every value" endpoint, and a
 * browser session cookie is not KMS authorization. This module lists secret
 * METADATA (path / name / env / version) and drives the full lifecycle —
 * create/upsert, reveal ONE value on explicit audited access, and delete —
 * entirely through the server-gated `/admin/kms` proxy (KmsAdminApi), which
 * enforces the brand-admin gate and forwards as the user, scoped to the active
 * org. Values are revealed one at a time, shown once, never listed or stored.
 * States are honest: loading, superadmin-required (403), listing-
 * unavailable (404), error, and empty.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Eye, EyeOff, Plus, RefreshCw, ShieldCheck, Trash2 } from '@hanzogui/lucide-icons-2'

import { ApiError, KmsAdminApi, type KmsSecretMeta } from '~/lib/api'
import { currentOrg, isScopedAway } from '~/lib/org-scope'
import { config } from '~/config'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { FieldRow, FieldText } from '~/components/ui/Field'
import { ErrorState, asApiError, isForbidden, SuperAdminRequired, type HonestCopy } from '~/components/ui/States'

/** KMS-specific guidance for the honest 404 / unauthorized states. */
const KMS_COPY: HonestCopy = {
  notFound:
    'Secret listing requires Hanzo KMS with the metadata-list endpoint (v0.159.4+). The inventory appears automatically once KMS is upgraded — only names are listed, never values.',
  unauthorized:
    'This view requires an operator session. Access is enforced server-side by the admin gate — sign in with an @hanzo.ai admin account.',
}

const fmtDate = (v?: string): string => {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString()
}

const rowKey = (s: KmsSecretMeta): string => `${s.path}/${s.name}/${s.env}`

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; err: ApiError }
  | { phase: 'ready'; rows: KmsSecretMeta[] }

type Tone = { tone: 'ok' | 'err'; text: string }

export function KmsModule(_props: { params: Record<string, string> }) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const org = currentOrg()

  // Create/upsert form.
  const [showForm, setShowForm] = useState(false)
  const [fPath, setFPath] = useState('')
  const [fName, setFName] = useState('')
  const [fEnv, setFEnv] = useState('')
  const [fValue, setFValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [formMsg, setFormMsg] = useState<Tone | null>(null)

  const run = useCallback(() => {
    setState({ phase: 'loading' })
    setRevealed({})
    KmsAdminApi.list({ org })
      .then((rows) => setState({ phase: 'ready', rows }))
      .catch((e) => setState({ phase: 'error', err: asApiError(e) }))
  }, [org])

  useEffect(() => {
    run()
  }, [run])

  const reveal = useCallback(
    async (s: KmsSecretMeta) => {
      const k = rowKey(s)
      if (revealed[k] !== undefined) {
        setRevealed((r) => {
          const { [k]: _drop, ...rest } = r
          return rest
        })
        return
      }
      setBusy(k)
      try {
        const { value } = await KmsAdminApi.reveal({ org, path: s.path, name: s.name, env: s.env })
        setRevealed((r) => ({ ...r, [k]: value }))
      } catch (e) {
        setRevealed((r) => ({ ...r, [k]: `⚠ ${asApiError(e).message}` }))
      } finally {
        setBusy(null)
      }
    },
    [org, revealed],
  )

  const remove = useCallback(
    async (s: KmsSecretMeta) => {
      if (typeof window !== 'undefined' && !window.confirm(`Delete ${s.path}/${s.name} (${s.env || 'default'})? This cannot be undone.`)) return
      const k = rowKey(s)
      setBusy(k)
      try {
        await KmsAdminApi.remove({ org, path: s.path, name: s.name, env: s.env })
        run()
      } catch (e) {
        setState({ phase: 'error', err: asApiError(e) })
      } finally {
        setBusy(null)
      }
    },
    [org, run],
  )

  const submit = useCallback(async () => {
    if (!fPath.trim() || !fName.trim() || !fValue) {
      setFormMsg({ tone: 'err', text: 'Path, name, and value are required.' })
      return
    }
    setSaving(true)
    setFormMsg(null)
    try {
      const { version } = await KmsAdminApi.create({ org, path: fPath.trim(), name: fName.trim(), env: fEnv.trim(), value: fValue })
      setFormMsg({ tone: 'ok', text: `Saved ${fPath.trim()}/${fName.trim()} (v${version}).` })
      setFValue('')
      run()
    } catch (e) {
      setFormMsg({ tone: 'err', text: asApiError(e).message })
    } finally {
      setSaving(false)
    }
  }, [org, fPath, fName, fEnv, fValue, run])

  const columns: Column<KmsSecretMeta>[] = [
    { key: 'name', header: 'Name', render: (s) => <Text fontSize="$3" fontWeight="600" numberOfLines={1}>{s.name}</Text> },
    { key: 'path', header: 'Path', render: (s) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{s.path || '—'}</Text> },
    { key: 'env', header: 'Env', width: 110, render: (s) => <Text fontSize="$3" color="$color11">{s.env || 'default'}</Text> },
    { key: 'version', header: 'Ver', width: 64, render: (s) => <Text fontSize="$3" color="$color11">{s.version || '—'}</Text> },
    {
      key: 'value',
      header: 'Value',
      width: 260,
      render: (s) => {
        const v = revealed[rowKey(s)]
        return v !== undefined ? (
          <Text fontSize="$2" color="$color12" numberOfLines={1} style={{ fontFamily: 'monospace' }}>{v}</Text>
        ) : (
          <Text fontSize="$2" color="$color9">••••••••</Text>
        )
      },
    },
    { key: 'updatedTime', header: 'Updated', width: 180, render: (s) => <Text fontSize="$2" color="$color10">{fmtDate(s.updatedTime)}</Text> },
    {
      key: 'actions',
      header: '',
      width: 150,
      render: (s) => {
        const k = rowKey(s)
        const shown = revealed[k] !== undefined
        return (
          <XStack gap="$1.5">
            <Button size="$1" chromeless icon={shown ? <EyeOff size={14} /> : <Eye size={14} />} disabled={busy === k} onPress={() => void reveal(s)} />
            <Button size="$1" chromeless icon={<Trash2 size={14} />} disabled={busy === k} onPress={() => void remove(s)} />
          </XStack>
        )
      },
    },
  ]

  return (
    <>
      <PageHeader
        title="Secrets"
        subtitle={`Manage secrets for ${org}${isScopedAway() ? '' : ' — your organization'}. Values are revealed one at a time, shown once, never listed.`}
        actions={
          <XStack gap="$2">
            <Button size="$2" icon={<RefreshCw size={15} />} onPress={run}>Refresh</Button>
            <Button size="$2" icon={<Plus size={15} />} onPress={() => setShowForm((v) => !v)}>New secret</Button>
          </XStack>
        }
      />

      <Card p="$3.5" gap="$2" borderWidth={1} borderColor="$borderColor" maxWidth={820}>
        <XStack gap="$2" items="center">
          <ShieldCheck size={18} />
          <Text fontSize="$4" fontWeight="700">Zero-knowledge by design</Text>
        </XStack>
        <Text fontSize="$3" color="$color11">
          KMS encrypts secret names and values on the MPC nodes. This inventory lists names and
          versions; each value is revealed solely on explicit, audited access. Nothing is cached —
          revealing fetches once and never stores the value.
        </Text>
      </Card>

      {showForm && (
        <Card p="$3.5" gap="$2.5" borderWidth={1} borderColor="$borderColor" maxWidth={820}>
          <Text fontSize="$4" fontWeight="700">New / update secret</Text>
          <FieldRow label="Path"><FieldText value={fPath} onChange={setFPath} placeholder="providers/alpaca" disabled={saving} /></FieldRow>
          <FieldRow label="Name"><FieldText value={fName} onChange={setFName} placeholder="api_key" disabled={saving} /></FieldRow>
          <FieldRow label="Env"><FieldText value={fEnv} onChange={setFEnv} placeholder="default" disabled={saving} /></FieldRow>
          <FieldRow label="Value"><FieldText value={fValue} onChange={setFValue} placeholder="secret value" secure disabled={saving} /></FieldRow>
          <XStack gap="$2" items="center">
            <Button self="flex-start" icon={<Plus size={15} />} disabled={saving} onPress={() => void submit()}>
              {saving ? 'Saving…' : 'Save secret'}
            </Button>
            {formMsg && (
              <Text fontSize="$2" color={formMsg.tone === 'ok' ? '$green10' : '$red10'}>{formMsg.text}</Text>
            )}
          </XStack>
          <Text fontSize="$2" color="$color10">Saving an existing path/name rotates it (the version bumps).</Text>
        </Card>
      )}

      {state.phase === 'error' ? (
        isForbidden(state.err) ? (
          <SuperAdminRequired />
        ) : (
          <ErrorState err={state.err} onRetry={run} copy={KMS_COPY} />
        )
      ) : (
        <DataTable
          columns={columns}
          rows={state.phase === 'ready' ? state.rows : []}
          loading={state.phase === 'loading'}
          rowKey={rowKey}
          empty={`No secrets in ${org}. Use “New secret” to add one.`}
        />
      )}

      <Text fontSize="$2" color="$color10">
        endpoint · /v1/kms/secrets · org {org} · {config.brandName}
      </Text>
    </>
  )
}
