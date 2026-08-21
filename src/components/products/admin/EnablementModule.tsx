'use client'

/**
 * admin.hanzo.ai ENABLEMENT board (#30/#31) — the global feature/model registry.
 * GLOBAL-ADMIN sets each item off | beta | ga (and optionally grants a beta to
 * specific orgs). GLOBAL-ADMIN ONLY (`admin: true`; the `/v1/admin/pricing/enablement`
 * surface is server-gated). `off` is an absolute kill switch; `beta` is visible only
 * to opted-in/granted orgs; `ga` is on for everyone. Customers opt into betas from
 * their own Settings › Beta features (a separate, non-admin surface).
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { RefreshCw, ToggleLeft } from '@hanzogui/lucide-icons-2'

import { ApiError } from '~/lib/api'
import { EnablementApi, type AdminEnablementItem, type EnablementState } from '~/lib/api/admin-cockpit'
import { ErrorState, asApiError, isForbidden, SuperAdminRequired } from '~/components/ui/States'
import { EmptyState, PageHeader } from '@hanzo/ui/product'

const STATES: EnablementState[] = ['off', 'beta', 'ga']
const KINDS = ['model', 'provider', 'feature'] as const

function StatePicker({ value, disabled, onChange }: { value: EnablementState; disabled?: boolean; onChange: (s: EnablementState) => void }) {
  const colorOf = (s: EnablementState) => (s === 'ga' ? '$green3' : s === 'beta' ? '$yellow3' : '$red3')
  const textOf = (s: EnablementState) => (s === 'ga' ? '$green11' : s === 'beta' ? '$yellow11' : '$red11')
  return (
    <XStack gap="$1" bg="$color3" rounded="$4" p="$1">
      {STATES.map((s) => (
        <Button key={s} size="$2" chromeless={value !== s} disabled={disabled}
          bg={value === s ? colorOf(s) : undefined} onPress={() => onChange(s)}>
          <Text fontSize="$1" color={value === s ? textOf(s) : '$color10'}>{s.toUpperCase()}</Text>
        </Button>
      ))}
    </XStack>
  )
}

export function EnablementModule() {
  const [items, setItems] = useState<AdminEnablementItem[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState<{ ok: boolean; msg: string } | null>(null)
  // manage-new form
  const [newKind, setNewKind] = useState<(typeof KINDS)[number]>('feature')
  const [newId, setNewId] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try { setItems(await EnablementApi.list()) } catch (e) { setErr(asApiError(e)) } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const setState = useCallback(async (kind: string, id: string, state: EnablementState) => {
    setBusy(`${kind}/${id}`); setNotice(null)
    try {
      await EnablementApi.set({ kind, id, state })
      setNotice({ ok: true, msg: `${kind}/${id} → ${state.toUpperCase()}` })
      await load()
    } catch (e) { setNotice({ ok: false, msg: asApiError(e).message }) } finally { setBusy('') }
  }, [load])

  const manageNew = useCallback(async () => {
    const id = newId.trim()
    if (!id) { setNotice({ ok: false, msg: 'Enter an item id.' }); return }
    await setState(newKind, id, 'beta')
    setNewId('')
  }, [newKind, newId, setState])

  if (err && isForbidden(err)) return <SuperAdminRequired />
  if (err) return <YStack p="$4" gap="$4"><PageHeader title="Enablement" /><ErrorState err={err} onRetry={load} /></YStack>

  return (
    <YStack p="$4" gap="$4">
      <PageHeader
        title="Enablement"
        subtitle="Turn models, providers, and features off · beta · ga across the whole fleet. Global-admin only."
        actions={<Button size="$3" icon={<RefreshCw size={15} />} onPress={load}>Refresh</Button>}
      />

      {notice && (
        <XStack p="$3" rounded="$4" bg={notice.ok ? '$green3' : '$red3'}><Text fontSize="$2" color={notice.ok ? '$green11' : '$red11'}>{notice.msg}</Text></XStack>
      )}

      <YStack p="$4" gap="$3" rounded="$4" borderWidth={1} borderColor="$borderColor" bg="$color2">
        <Text fontSize="$4" color="$color12">Manage an item</Text>
        <Text fontSize="$1" color="$color10">Put a model / provider / feature into beta (opt-in), then flip it to GA or OFF. Untouched items are GA (on) by default.</Text>
        <XStack gap="$3" items="flex-end" flexWrap="wrap">
          <YStack gap="$1">
            <Text fontSize="$1" color="$color10">Kind</Text>
            <XStack gap="$1" bg="$color3" rounded="$4" p="$1">
              {KINDS.map((k) => <Button key={k} size="$2" chromeless={newKind !== k} onPress={() => setNewKind(k)}>{k}</Button>)}
            </XStack>
          </YStack>
          <YStack gap="$1" flex={1} minW={220}>
            <Text fontSize="$1" color="$color10">Item id</Text>
            <input value={newId} onChange={(e) => setNewId(e.target.value)} placeholder={newKind === 'model' ? 'anthropic/claude-opus-4.6' : 'beta-agents'}
              style={{ background: 'transparent', border: '1px solid var(--borderColor)', borderRadius: 8, padding: '8px 10px', color: 'var(--color12)', width: '100%' }} />
          </YStack>
          <Button size="$3" icon={<ToggleLeft size={15} />} disabled={busy !== ''} onPress={manageNew}>Add to beta</Button>
        </XStack>
      </YStack>

      <YStack gap="$2">
        <Text fontSize="$5" color="$color12">Managed items</Text>
        {loading ? <Text color="$color10">Loading…</Text>
          : items.length === 0 ? <EmptyState icon={ToggleLeft} title="No managed items" description="Everything is GA (on) by default. Put an item into beta above to manage it." />
          : (
            <YStack gap="$1">
              {items.map((it) => (
                <XStack key={`${it.kind}/${it.id}`} p="$3" gap="$3" items="center" rounded="$3" borderWidth={1} borderColor="$borderColor" bg="$color2" flexWrap="wrap">
                  <YStack flex={1} minW={200}>
                    <Text fontSize="$3" color="$color12">{it.id}</Text>
                    <Text fontSize="$1" color="$color9">{it.kind}{it.betaOrgs.length ? ` · beta orgs: ${it.betaOrgs.join(', ')}` : ''}</Text>
                  </YStack>
                  <StatePicker value={it.state} disabled={busy === `${it.kind}/${it.id}`} onChange={(s) => void setState(it.kind, it.id, s)} />
                </XStack>
              ))}
            </YStack>
          )}
      </YStack>
    </YStack>
  )
}
