'use client'

/**
 * Domains — REGISTER new domain names (buy/transfer/renew), backed by the Hanzo
 * Domains control plane (cloud clients/domain → name.com reseller). DISTINCT from the
 * DNS product: DNS manages records for a domain you already control; Domains ACQUIRES
 * the domain. After a purchase the domain is born on Hanzo's nameservers and its zone
 * is handed to hanzoai/dns — so you buy here, then manage records under DNS.
 *
 * The browser hits the same-origin /v1/domain surface with just the session cookie;
 * purchases are org-scoped and billed through the org's prepaid balance server-side.
 * Honest states on 401/402/404/409/503 — a search never fabricates availability, and a
 * price is always the real (marked-up) quote from the registrar.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Input, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { DataTable, type FieldDefinition } from '@hanzo/data'

import { ApiError } from '~/lib/api/client'
import { BackendStateCard, PageHeader, classifyBackend, type BackendState } from '@hanzo/ui/product'

/** A priced availability quote as /v1/domain/search|availability returns it. */
interface Quote {
  domain: string
  available: boolean
  premium?: boolean
  priceCents: number
  renewalPriceCents: number
  currency: string
  tld?: string
}

/** A domain the org owns as /v1/domain/domains returns it. */
interface OwnedDomain {
  org: string
  domain: string
  registeredAt: number
  expiresAt?: string
  priceCents: number
  nameservers?: string[]
  [k: string]: unknown
}

const usd = (cents: number) =>
  typeof cents === 'number' && cents > 0 ? `$${(cents / 100).toFixed(2)}` : '—'

const OWNED_FIELDS: FieldDefinition[] = [
  { name: 'domain', label: 'Domain', type: 'text', width: 240 },
  { name: 'expiresAt', label: 'Expires', type: 'dateTime' },
  { name: 'priceCents', label: 'Paid', type: 'text', width: 100 },
  { name: 'nameservers', label: 'Nameservers', type: 'text' },
]

async function getJSON<T>(path: string, key: string): Promise<T[]> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
  if (!res.ok) {
    let msg = `Domains ${res.status}`
    try {
      const body = await res.json()
      if (body?.error || body?.msg) msg = String(body.error ?? body.msg)
    } catch {
      /* not JSON */
    }
    throw new ApiError(msg, res.status)
  }
  const json = await res.json().catch(() => null)
  const items = Array.isArray(json) ? json : (json?.[key] ?? json?.data ?? [])
  return Array.isArray(items) ? items : []
}

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let msg = `Domains ${res.status}`
    try {
      const b = await res.json()
      if (b?.error || b?.msg) msg = String(b.error ?? b.msg)
    } catch {
      /* not JSON */
    }
    throw new ApiError(msg, res.status)
  }
  return (await res.json()) as T
}

export function DomainsModule(_props: { params: Record<string, string> }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Quote[] | null>(null)
  const [owned, setOwned] = useState<OwnedDomain[]>([])
  const [searching, setSearching] = useState(false)
  const [buying, setBuying] = useState<string | null>(null)
  const [loadingOwned, setLoadingOwned] = useState(true)
  const [state, setState] = useState<BackendState | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const loadOwned = useCallback(async () => {
    setLoadingOwned(true)
    setState(null)
    try {
      setOwned(await getJSON<OwnedDomain>('/v1/domain/domains', 'domains'))
    } catch (e) {
      setState(classifyBackend(e))
    } finally {
      setLoadingOwned(false)
    }
  }, [])

  useEffect(() => {
    loadOwned()
  }, [loadOwned])

  const search = useCallback(async () => {
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setNotice(null)
    setState(null)
    try {
      // A bare word searches keywords + alternate TLDs; a dotted name checks it exactly.
      const path = q.includes('.')
        ? `/v1/domain/availability?domain=${encodeURIComponent(q)}`
        : `/v1/domain/search?q=${encodeURIComponent(q)}`
      setResults(await getJSON<Quote>(path, 'results'))
    } catch (e) {
      setResults(null)
      setState(classifyBackend(e))
    } finally {
      setSearching(false)
    }
  }, [query])

  const buy = useCallback(
    async (domain: string) => {
      setBuying(domain)
      setNotice(null)
      try {
        await postJSON('/v1/domain/register', { domain })
        setNotice(`${domain} is yours — pointed at Hanzo nameservers. Manage its records under DNS.`)
        setResults((r) => (r ? r.filter((q) => q.domain !== domain) : r))
        await loadOwned()
      } catch (e) {
        if (e instanceof ApiError && e.status === 402) {
          setNotice('Not enough balance to buy this domain — add credits and try again.')
        } else if (e instanceof ApiError && e.status === 409) {
          setNotice(`${domain} is no longer available.`)
        } else {
          setNotice(e instanceof Error ? e.message : 'Could not complete the purchase.')
        }
      } finally {
        setBuying(null)
      }
    },
    [loadOwned],
  )

  const ownedRows = owned.map((d) => ({
    ...d,
    priceCents: usd(d.priceCents),
    nameservers: Array.isArray(d.nameservers) ? d.nameservers.join(', ') : '',
  }))

  return (
    <YStack gap="$4">
      <PageHeader
        title="Domains"
        subtitle="Search, register, and renew domain names. They are billed to your org and served by Hanzo nameservers from the moment you buy them."
        actions={
          <Button size="$3" onPress={loadOwned} disabled={loadingOwned}>
            Refresh
          </Button>
        }
      />

      {/* Search + buy */}
      <Card p="$4" gap="$3">
        <XStack gap="$2" items="center" flexWrap="wrap">
          <XStack flex={1} minW={240} items="center" gap="$2">
            <Input
              flex={1}
              value={query}
              onChangeText={setQuery}
              placeholder="Find a domain — e.g. acme or acme.ai"
              autoCapitalize="none"
              onSubmitEditing={() => void search()}
            />
            <Button size="$3" onPress={() => void search()} disabled={searching || !query.trim()}>
              {searching ? 'Searching…' : 'Search'}
            </Button>
          </XStack>
        </XStack>

        {notice && (
          <Text fontSize="$2" color="$color11">
            {notice}
          </Text>
        )}

        {searching && !results && <Spinner />}

        {results && results.length === 0 && (
          <Text fontSize="$2" color="$color10">
            No matches. Try another name or TLD.
          </Text>
        )}

        {results && results.length > 0 && (
          <YStack gap="$2">
            {results.map((q) => (
              <XStack key={q.domain} gap="$3" items="center" justify="space-between" flexWrap="wrap">
                <YStack>
                  <Text fontWeight="600">{q.domain}</Text>
                  <Text fontSize="$1" color="$color10">
                    {q.available
                      ? `${usd(q.priceCents)}/yr${q.premium ? ' · premium' : ''} · renews ${usd(q.renewalPriceCents)}/yr`
                      : 'Taken'}
                  </Text>
                </YStack>
                <Button
                  size="$3"
                  disabled={!q.available || buying === q.domain}
                  onPress={() => buy(q.domain)}
                >
                  {buying === q.domain ? 'Buying…' : q.available ? 'Buy' : 'Unavailable'}
                </Button>
              </XStack>
            ))}
          </YStack>
        )}
      </Card>

      {/* Owned domains */}
      {state ? (
        <BackendStateCard state={state} onRetry={loadOwned} hint="endpoint · GET /v1/domain/domains" />
      ) : (
        <DataTable
          fields={OWNED_FIELDS}
          records={ownedRows as Array<Record<string, unknown>>}
          loading={loadingOwned}
          empty="No domains yet. Search above to register your first one."
        />
      )}
    </YStack>
  )
}

export default DomainsModule
