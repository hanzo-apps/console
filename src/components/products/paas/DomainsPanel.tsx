'use client'

/**
 * DomainsPanel — customer self-serve domain management for a PaaS app, over the
 * live `/v1/platform/projects/:project/apps/:app/domains` surface (via the `/v1` bearer proxy, org
 * resolved from the Bearer owner). Lists the app's domains with an HONEST
 * per-domain status derived from the operator CR (live / provisioning / awaiting
 * deploy / unverified — never fabricated), an Add-domain form, per-domain Remove,
 * and — for a BYO custom domain — the exact DNS records to publish plus a Verify
 * action. A customer points `yourco.com` at their app without ever touching k8s.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Check, Copy, ExternalLink, Globe, Plus, RefreshCw, Trash2 } from '@hanzogui/lucide-icons-2'

import { PaasApi, type PaasDomain } from '~/lib/api/paas'
import { canRemoveDomain, classifyPaasError, domainStatusLabel, isPendingCustom, orderDomains } from './logic'
import { FieldText, PrimaryButton, StatusTag } from '@hanzo/ui/product'

const openUrl = (href: string) => {
  if (typeof window !== 'undefined') window.open(href, '_blank', 'noopener')
}
const copyText = (t: string) => {
  if (typeof navigator !== 'undefined' && navigator.clipboard) void navigator.clipboard.writeText(t)
}

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; domains: PaasDomain[] }

export function DomainsPanel({ projectSlug, appSlug }: { projectSlug: string; appSlug: string }) {
  const [state, setState] = useState<State>({ phase: 'loading' })
  const [host, setHost] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [busyHost, setBusyHost] = useState<string | null>(null)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const domains = orderDomains(await PaasApi.listDomains(projectSlug, appSlug))
      setState({ phase: 'ready', domains })
    } catch (e) {
      setState({ phase: 'error', message: classifyPaasError(e).message })
    }
  }, [projectSlug, appSlug])

  useEffect(() => {
    void load()
  }, [load])

  const add = async () => {
    const h = host.trim()
    if (!h) return
    setAdding(true)
    setAddError(null)
    try {
      await PaasApi.addDomain(projectSlug, appSlug, h)
      setHost('')
      await load()
    } catch (e) {
      setAddError(classifyPaasError(e).message || `“${h}” was not added, and the app’s domains are unchanged. Try again.`)
    } finally {
      setAdding(false)
    }
  }

  // Verify / remove reload the list either way — the reloaded state is the honest
  // outcome (a still-pending verify is not an error, just "not yet").
  const act = async (fn: () => Promise<unknown>, h: string) => {
    setBusyHost(h)
    try {
      await fn()
    } catch {
      /* fall through to reload */
    } finally {
      await load()
      setBusyHost(null)
    }
  }

  return (
    <YStack gap="$2" pt="$2" borderTopWidth={1} borderColor="$borderColor">
      <XStack items="center" justify="space-between">
        <Text fontSize="$3" fontWeight="700">Domains</Text>
        <Button size="$1" chromeless icon={<RefreshCw size={13} />} onPress={() => void load()} aria-label="Refresh domains" />
      </XStack>

      <XStack gap="$2" items="center">
        <YStack flex={1}>
          <FieldText value={host} onChange={setHost} disabled={adding} placeholder="app.yourco.com" />
        </YStack>
        <PrimaryButton
          size="$2"
          icon={adding ? <Spinner size="small" /> : <Plus size={14} />}
          onPress={add}
          disabled={adding || host.trim() === ''}
        >
          Add domain
        </PrimaryButton>
      </XStack>
      {addError ? <Text fontSize="$1" color="$red10">{addError}</Text> : null}

      {state.phase === 'loading' ? (
        <XStack gap="$2" items="center">
          <Spinner size="small" />
          <Text fontSize="$2" color="$color10">Loading domains…</Text>
        </XStack>
      ) : state.phase === 'error' ? (
        <Text fontSize="$2" color="$color10">Couldn’t load domains. {state.message}</Text>
      ) : state.domains.length === 0 ? (
        <Text fontSize="$2" color="$color10">No domains yet.</Text>
      ) : (
        state.domains.map((d) => (
          <DomainRow
            key={d.host}
            d={d}
            busy={busyHost === d.host}
            onVerify={() => void act(() => PaasApi.verifyDomain(projectSlug, appSlug, d.host), d.host)}
            onRemove={() => void act(() => PaasApi.removeDomain(projectSlug, appSlug, d.host), d.host)}
          />
        ))
      )}
    </YStack>
  )
}

function DomainRow({
  d,
  busy,
  onVerify,
  onRemove,
}: {
  d: PaasDomain
  busy: boolean
  onVerify: () => void
  onRemove: () => void
}) {
  const pending = isPendingCustom(d)
  return (
    <YStack gap="$1.5" py="$1.5" borderBottomWidth={1} borderColor="$borderColor">
      <XStack items="center" justify="space-between" gap="$2">
        <XStack items="center" gap="$2" minW={0} flex={1}>
          <Globe size={13} color="$color10" />
          <Text fontSize="$2" fontWeight="600" color="$color12" numberOfLines={1}>{d.host}</Text>
          {d.primary ? <Text fontSize="$1" color="$color10">default</Text> : null}
        </XStack>
        <XStack items="center" gap="$2">
          <StatusTag status={domainStatusLabel(d)} />
          {d.url && d.status === 'live' ? (
            <Button size="$1" chromeless icon={<ExternalLink size={12} />} onPress={() => openUrl(d.url)} aria-label={`Open ${d.host}`} />
          ) : null}
          {canRemoveDomain(d) ? (
            <Button
              size="$1"
              chromeless
              icon={busy ? <Spinner size="small" /> : <Trash2 size={12} />}
              onPress={onRemove}
              disabled={busy}
              aria-label={`Remove ${d.host}`}
            />
          ) : null}
        </XStack>
      </XStack>

      {pending ? (
        <YStack gap="$1.5" bg="$color2" p="$2.5" rounded="$3">
          <Text fontSize="$1" color="$color11">{d.detail || 'Add these DNS records at your provider, then Verify.'}</Text>
          {(d.records ?? []).map((r) => (
            <XStack key={`${r.type}-${r.name}`} items="center" gap="$2" flexWrap="wrap">
              <Text fontSize="$1" fontWeight="700" color="$color11" width={48}>{r.type}</Text>
              <Text fontSize="$1" color="$color12" numberOfLines={1} flex={1}>{r.name}</Text>
              <Text fontSize="$1" color="$color12" numberOfLines={1} flex={1}>{r.value}</Text>
              <Button size="$1" chromeless icon={<Copy size={11} />} onPress={() => copyText(r.value)} aria-label={`Copy ${r.type} value`} />
            </XStack>
          ))}
          <XStack>
            <PrimaryButton size="$2" icon={busy ? <Spinner size="small" /> : <Check size={13} />} onPress={onVerify} disabled={busy}>
              {busy ? 'Verifying…' : 'Verify'}
            </PrimaryButton>
          </XStack>
        </YStack>
      ) : null}
    </YStack>
  )
}
