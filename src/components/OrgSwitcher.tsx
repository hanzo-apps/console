'use client'

/**
 * Org switcher — a Vercel-style, LAZY-LOADING team/org switcher that shows the org
 * the console is scoped to, lets the user switch between the orgs they can see, and
 * CREATE a new one.
 *
 * The org LIST comes from IAM (`get-organizations`, via the gated `/admin/iam`
 * proxy): a super admin sees every org, a regular user sees only their own. For a
 * super admin the list is TRULY lazy — `useOrgList` fetches ONE page at a time
 * (`orgQuery` / `ORG_PAGE_SIZE`), pushes the search term to the server, and loads
 * more on demand (infinite-scroll + "Load more") so it scales to thousands of orgs
 * without loading them all up front. A regular user (who 403s the cross-tenant list)
 * simply sees their current org, synthesized from the scope — never fabricated.
 *
 * Selecting an org re-scopes the console IN PLACE — `switchOrg` persists the choice
 * and reloads so every module refetches under the new `X-Org-Id` (the super-admin
 * masquerade / god-view is unchanged). Create posts to the same-origin `/onboard`
 * route (zero-org user → created + joined as admin; existing user → an ADDITIONAL
 * org they're scope-switched into). Keyboard: ↑/↓ move, ↵ select, Esc close.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, Popover, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Check, ChevronsUpDown, LayoutGrid, Plus, Search } from '@hanzogui/lucide-icons-2'

import { currentOrg, switchOrg, leaveOrg } from '~/lib/org-scope'
import {
  mergeOrgs,
  orgQuery,
  orgRows,
  pageIsFull,
  rowFor,
  type OrgRow,
  type OrgTier,
} from '~/lib/org-list'
import { IamAdminApi, type Organization } from '~/lib/api'
import { v1Url } from '~/lib/api/client'
import { useIsSuperAdmin } from '~/lib/auth/admin'

const titleCase = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

// ── Lazy-load hook ────────────────────────────────────────────────────────────

type OrgListState = {
  /** Accumulated raw orgs (server page order), appended across pages. */
  rows: Organization[]
  /** First page in flight (blank list). */
  loading: boolean
  /** A subsequent page in flight (list already shown). */
  loadingMore: boolean
  error: string | null
  /** Whether another page is likely available (last page was full). */
  hasMore: boolean
}

const EMPTY: OrgListState = { rows: [], loading: false, loadingMore: false, error: null, hasMore: false }

/**
 * Fetch the cross-tenant org list lazily: page 0 on open, more pages on demand,
 * and re-query (debounced) when the search term changes. Only runs when `enabled`
 * (a super admin) — a regular user never fires the admin-gated list.
 */
function useOrgList(enabled: boolean) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [state, setState] = useState<OrgListState>(EMPTY)
  const pageRef = useRef(0)
  const reqRef = useRef(0) // race token — a newer request supersedes older ones
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  // Debounce the raw query so search-as-you-type re-hits the server at most ~4×/s.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 250)
    return () => clearTimeout(id)
  }, [query])

  const fetchPage = useCallback(async (page: number, q: string, append: boolean) => {
    const token = ++reqRef.current
    setState((s) => ({ ...s, loading: !append, loadingMore: append, error: null }))
    try {
      const res = await IamAdminApi.organizations(orgQuery(page, q))
      if (token !== reqRef.current) return // superseded by a newer query/page
      const incoming = res.rows ?? []
      pageRef.current = page
      setState((s) => ({
        rows: append ? mergeOrgs(s.rows, incoming) : incoming,
        loading: false,
        loadingMore: false,
        error: null,
        hasMore: pageIsFull(incoming.length),
      }))
    } catch (e) {
      if (token !== reqRef.current) return
      // The cross-tenant list isn't available to this account — honest empty, never
      // a fabricated list. (A regular user 403s here; the hook is disabled for them.)
      setState((s) => ({
        rows: append ? s.rows : [],
        loading: false,
        loadingMore: false,
        error: append ? (e instanceof Error ? e.message : 'Could not load more.') : null,
        hasMore: false,
      }))
    }
  }, [])

  // (Re)load page 0 when enabled toggles on or the debounced query changes.
  useEffect(() => {
    if (!enabled) {
      reqRef.current++ // cancel any in-flight page
      pageRef.current = 0
      setState(EMPTY)
      return
    }
    pageRef.current = 0
    void fetchPage(0, debounced, false)
  }, [enabled, debounced, fetchPage])

  const loadMore = useCallback(() => {
    const s = stateRef.current
    if (s.loading || s.loadingMore || !s.hasMore) return
    void fetchPage(pageRef.current + 1, debounced, true)
  }, [debounced, fetchPage])

  return { ...state, query, setQuery, loadMore }
}

// ── Presentational bits ───────────────────────────────────────────────────────

/** Monochrome plan/tier pill — rendered only when the org carries a real tier. */
function TierBadge({ tier }: { tier: OrgTier }) {
  return (
    <XStack items="center" bg="$color3" rounded="$10" px="$2" py="$0.5" borderWidth={1} borderColor="$borderColor">
      <Text fontSize="$1" color="$color11" fontWeight="600">
        {tier.label}
      </Text>
    </XStack>
  )
}

/** An org's avatar — its logo when set, else a monogram tile. */
function OrgAvatar({ row, size = 22 }: { row: OrgRow; size?: number }) {
  if (row.logo) {
    // Arbitrary external org logo — raw <img> (next/image would need a per-tenant
    // remote allowlist).
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={row.logo} alt="" style={{ height: size, width: size, objectFit: 'contain', display: 'block', borderRadius: 6 }} />
  }
  return (
    <YStack width={size} height={size} rounded="$3" bg="$color4" items="center" justify="center">
      <Text fontSize="$1" fontWeight="800" color="$color12">
        {row.initials}
      </Text>
    </YStack>
  )
}

/** One selectable org row. */
function OrgRowView({
  row,
  current,
  active,
  onPress,
}: {
  row: OrgRow
  current: boolean
  active: boolean
  onPress: () => void
}) {
  return (
    <XStack
      id={active ? 'org-active' : undefined}
      onPress={onPress}
      cursor="pointer"
      items="center"
      gap="$2.5"
      px="$2"
      py="$2"
      rounded="$3"
      bg={active ? '$color5' : current ? '$color4' : 'transparent'}
      hoverStyle={{ bg: '$color5' }}
    >
      <OrgAvatar row={row} />
      <Text flex={1} fontSize="$2" color="$color12" numberOfLines={1}>
        {row.title}
      </Text>
      {row.tier ? <TierBadge tier={row.tier} /> : null}
      {current ? <Check size={15} /> : null}
    </XStack>
  )
}

// ── Switcher ──────────────────────────────────────────────────────────────────

export function OrgSwitcher() {
  const currentId = currentOrg()
  const isSuperAdmin = useIsSuperAdmin()
  const list = useOrgList(isSuperAdmin)

  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState(0)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const searchRef = useRef<{ focus?: () => void } | null>(null)

  // Rows to render. Super admin → the (lazy, server-paged) cross-tenant list,
  // client-filtered over name+displayName. Regular user → only their own org,
  // synthesized from the active scope (unchanged behavior; never fabricated).
  const rows: OrgRow[] = useMemo(() => {
    if (isSuperAdmin) return orgRows(list.rows, list.query)
    return [rowFor({ owner: 'admin', name: currentId, displayName: titleCase(currentId) } as Organization)]
  }, [isSuperAdmin, list.rows, list.query, currentId])

  // The current org's human label for the trigger — real displayName once loaded.
  const currentName = useMemo(() => {
    const hit = list.rows.find((o) => o.name === currentId)
    return hit?.displayName || titleCase(currentId)
  }, [list.rows, currentId])

  // The current org's avatar row for the trigger — its real logo/displayName when
  // the loaded list carries it, else a synthesized monogram row (initials come free
  // from rowFor). Reuses the same synth shape as the non-admin `rows` memo.
  const currentRow: OrgRow = useMemo(() => {
    const hit = list.rows.find((o) => o.name === currentId)
    return rowFor(hit ?? ({ owner: 'admin', name: currentId, displayName: titleCase(currentId) } as Organization))
  }, [list.rows, currentId])

  // Selectable items: the org rows, then the "Create" footer, then "All organizations".
  const itemCount = rows.length + 2
  const createIndex = rows.length
  const allOrgsIndex = rows.length + 1

  // Reset the highlight to the top whenever the visible set changes.
  useEffect(() => {
    setSel(0)
  }, [list.query, rows.length])

  // Focus the search box when the popover opens (super admin only).
  useEffect(() => {
    if (open && !creating && isSuperAdmin) {
      const id = setTimeout(() => searchRef.current?.focus?.(), 0)
      return () => clearTimeout(id)
    }
  }, [open, creating, isSuperAdmin])

  const select = useCallback((org: string) => {
    setOpen(false)
    switchOrg(org) // persists + reloads so every module re-scopes under the new X-Org-Id
  }, [])

  const activate = useCallback(
    (index: number) => {
      if (index === createIndex) {
        setCreating(true)
        setErr(null)
        return
      }
      if (index === allOrgsIndex) {
        setOpen(false)
        leaveOrg() // de-scope back to the org picker (clears selection + resets scope)
        return
      }
      const row = rows[index]
      if (row) select(row.name)
    },
    [createIndex, allOrgsIndex, rows, select],
  )

  // Keyboard while open (and not in the create form): ↑/↓ move, ↵ select, Esc close.
  useEffect(() => {
    if (!open || creating) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSel((s) => Math.min(s + 1, itemCount - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSel((s) => Math.max(s - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        activate(sel)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, creating, itemCount, sel, activate])

  // Keep the highlighted row in view as ↑/↓ moves past the fold.
  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    document.getElementById('org-active')?.scrollIntoView({ block: 'nearest' })
  }, [sel, open])

  const create = async () => {
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(v1Url('iam/onboard'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = (await res.json().catch(() => ({}))) as { org?: string; error?: string }
      if (!res.ok || !data.org) throw new Error(data.error || `Could not create organization (${res.status}).`)
      // Scope into the new org (persists + reloads so every module refetches).
      switchOrg(data.org)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create the organization.')
      setBusy(false)
    }
  }

  const showSearch = isSuperAdmin
  const isEmpty = !list.loading && rows.length === 0

  return (
    <Popover open={open} onOpenChange={setOpen} placement="bottom-end">
      <Popover.Trigger asChild>
        <Button size="$2" chromeless icon={<OrgAvatar row={currentRow} size={18} />} iconAfter={<ChevronsUpDown size={13} />}>
          {currentName}
        </Button>
      </Popover.Trigger>
      <Popover.Content bordered elevate p="$2" width={320} bg="$color2" borderColor="$borderColor">
        {creating ? (
          <YStack gap="$2">
            <Text fontSize="$2" color="$color12" fontWeight="700">
              Create organization
            </Text>
            <Input
              size="$3"
              placeholder="Organization name"
              value={newName}
              onChangeText={setNewName}
              autoCapitalize="words"
              onSubmitEditing={() => void create()}
            />
            {err ? (
              <Text fontSize="$1" color="$red10">
                {err}
              </Text>
            ) : null}
            <XStack gap="$2" justify="flex-end">
              <Button
                size="$2"
                chromeless
                onPress={() => {
                  setCreating(false)
                  setErr(null)
                }}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                size="$2"
                onPress={() => void create()}
                disabled={busy || !newName.trim()}
                icon={busy ? <Spinner size="small" /> : <Plus size={14} />}
              >
                Create
              </Button>
            </XStack>
          </YStack>
        ) : (
          <YStack gap="$1">
            {showSearch ? (
              <XStack items="center" gap="$2" px="$2" py="$1" rounded="$3" borderWidth={1} borderColor="$borderColor">
                <Search size={13} opacity={0.6} />
                <Input
                  ref={searchRef as never}
                  flex={1}
                  size="$2"
                  borderWidth={0}
                  bg="transparent"
                  placeholder="Find organization…"
                  value={list.query}
                  onChangeText={list.setQuery}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </XStack>
            ) : null}

            <div
              style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}
              onScroll={(e) => {
                const el = e.currentTarget
                if (el.scrollHeight - el.scrollTop - el.clientHeight < 48) list.loadMore()
              }}
            >
              {list.loading ? (
                <XStack items="center" gap="$2" px="$2" py="$3">
                  <Spinner size="small" color="$color11" />
                  <Text fontSize="$2" color="$color10">
                    Loading organizations…
                  </Text>
                </XStack>
              ) : isEmpty ? (
                list.query.trim() ? (
                  <Text px="$2" py="$2" fontSize="$2" color="$color10">
                    No organizations match “{list.query.trim()}”.
                  </Text>
                ) : (
                  <YStack px="$2" py="$3" gap="$1">
                    <Text fontSize="$2" color="$color11" fontWeight="600">
                      No organizations yet
                    </Text>
                    <Text fontSize="$1" color="$color10">
                      Teams you create and join appear here for quick context switching.
                    </Text>
                  </YStack>
                )
              ) : (
                rows.map((row, i) => (
                  <OrgRowView
                    key={row.key}
                    row={row}
                    current={row.name === currentId}
                    active={i === sel}
                    onPress={() => activate(i)}
                  />
                ))
              )}

              {list.loadingMore ? (
                <XStack items="center" gap="$2" px="$2" py="$2">
                  <Spinner size="small" color="$color11" />
                  <Text fontSize="$1" color="$color10">
                    Loading more…
                  </Text>
                </XStack>
              ) : list.hasMore ? (
                <XStack
                  onPress={() => list.loadMore()}
                  cursor="pointer"
                  items="center"
                  justify="center"
                  px="$2"
                  py="$1.5"
                  rounded="$3"
                  hoverStyle={{ bg: '$color4' }}
                >
                  <Text fontSize="$1" color="$color11" fontWeight="600">
                    Load more
                  </Text>
                </XStack>
              ) : null}
            </div>

            <XStack
              id={sel === createIndex ? 'org-active' : undefined}
              onPress={() => activate(createIndex)}
              cursor="pointer"
              items="center"
              gap="$2.5"
              px="$2"
              py="$2"
              mt="$1"
              rounded="$3"
              borderTopWidth={1}
              borderColor="$borderColor"
              bg={sel === createIndex ? '$color5' : 'transparent'}
              hoverStyle={{ bg: '$color5' }}
            >
              <YStack width={22} height={22} rounded="$3" bg="$color3" items="center" justify="center">
                <Plus size={14} />
              </YStack>
              <Text fontSize="$2" color="$color12">
                Create organization
              </Text>
            </XStack>

            <XStack
              id={sel === allOrgsIndex ? 'org-active' : undefined}
              onPress={() => activate(allOrgsIndex)}
              cursor="pointer"
              items="center"
              gap="$2.5"
              px="$2"
              py="$2"
              rounded="$3"
              bg={sel === allOrgsIndex ? '$color5' : 'transparent'}
              hoverStyle={{ bg: '$color5' }}
            >
              <YStack width={22} height={22} rounded="$3" bg="$color3" items="center" justify="center">
                <LayoutGrid size={14} />
              </YStack>
              <Text fontSize="$2" color="$color12">
                All organizations
              </Text>
            </XStack>
          </YStack>
        )}
      </Popover.Content>
    </Popover>
  )
}
