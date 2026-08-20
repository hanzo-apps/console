'use client'

/**
 * Team — organization member management for a CUSTOMER's own org.
 *
 * Lists the org's members (and, read-only, its RBAC roles) from IAM via the
 * server-gated `/org/iam` proxy scoped to `currentOrg()`, and lets an ORG ADMIN
 * invite a member (email + role), change a member's role (admin ↔ member), and
 * DELETE a member's account. It does NOT require a global admin (unlike the
 * cross-tenant IAM module).
 *
 * The delete is `delete-user`, not a membership revoke: it ends the person's Hanzo
 * account everywhere, not their place in this org. `delete-membership` exists and
 * has no caller, because the invite path makes people members of their HOME org and
 * IAM refuses a home-org revoke — so pointing the button at it would fail for most
 * of the list. Until membership is separable from the account, the control says what
 * it does rather than what we wish it did.
 *
 * Honest by construction: real members / roles or an honest empty; loading, 404
 * (IAM not routed), and 403 (access) are truthful states, never fabricated rows.
 * Writes are gated in the UI (shown only to an org admin) AND server-side (the
 * proxy requires org admin + pins the caller to their own org).
 */
import { SubNav } from '~/components/ui/SubNav'
import { productSubpageSlug } from '~/lib/products/match'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Dialog, Spinner, Text, VisuallyHidden, XStack, YStack } from '@hanzo/gui'
import { Check, Copy, Link2, RefreshCw, Shield, Trash2, UserPlus, X } from '@hanzogui/lucide-icons-2'

import { ApiError, TeamApi, type IamUser, type Role, type Paged } from '~/lib/api'
import { config } from '~/config'
import { currentOrg } from '~/lib/org-scope'
import { useSession } from '~/lib/auth/session'
import { useIsSuperAdmin } from '~/lib/auth/admin'
import { ErrorState, asApiError, type HonestCopy } from '~/components/ui/States'
import { useToast } from '~/components/ui/Toast'
import { DataTable, FieldRow, FieldSelect, FieldText, PageHeader, PrimaryButton, type Column } from '@hanzo/ui/product'

const TEAM_COPY: HonestCopy = {
  notFound:
    'Member management (IAM) is not routed on this host yet. It appears automatically once the deployment proxies /org/iam to Hanzo IAM.',
  unauthorized:
    'Managing members requires an organization admin. You can view members; ask an admin to make changes.',
}

const fmtDate = (v?: string): string => {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString()
}

/** A member's role, derived from the IAM admin flag. */
const roleOf = (u: IamUser): 'admin' | 'member' => (u.isAdmin ? 'admin' : 'member')

/** Derive a stable IAM handle from an email local-part (a-z0-9-_. only). */
function handleFromEmail(email: string): string {
  const local = email.split('@')[0] ?? ''
  const slug = local.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || `member-${Math.random().toString(36).slice(2, 8)}`
}

type Async<T> = { phase: 'loading' } | { phase: 'error'; err: ApiError } | { phase: 'ready'; data: T }

function RoleBadge({ role }: { role: 'admin' | 'member' }) {
  return (
    <Text
      fontSize="$2"
      px="$2"
      py="$1"
      rounded="$2"
      bg={role === 'admin' ? '$color5' : '$color3'}
      color={role === 'admin' ? '$color12' : '$color11'}
    >
      {role}
    </Text>
  )
}

/** A member has a login credential once they've accepted their invite; until then
 *  they're PENDING (created, scoped, role assigned — but can't sign in yet). */
const isPending = (u: IamUser): boolean => !(typeof u.password === 'string' && u.password.length > 0)

/** MFA is on when a preferred channel is set or a channel is enabled. */
const mfaOn = (u: IamUser): boolean =>
  Boolean((u.preferredMfaType && u.preferredMfaType !== '') || u.mfaPhoneEnabled || u.mfaEmailEnabled)

/** Read-only, copyable link field with a transient "copied" state. */
function CopyLink({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard unavailable — the value is still visible + selectable */
    }
  }
  return (
    <XStack gap="$2" items="center">
      <Text
        flex={1}
        fontSize="$2"
        color="$color12"
        numberOfLines={1}
        px="$2.5"
        py="$2"
        rounded="$3"
        borderWidth={1}
        borderColor="$borderColor"
        bg="$color2"
      >
        {value}
      </Text>
      <Button size="$3" icon={copied ? <Check size={15} /> : <Copy size={15} />} onPress={() => void copy()}>
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </XStack>
  )
}

// ── Invite dialog ─────────────────────────────────────────────────────────────

function InviteDialog({
  open,
  onOpenChange,
  org,
  onInvited,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  org: string
  onInvited: () => void
}) {
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('member')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // Two phases: the invite form, then the shareable accept link to hand off.
  const [link, setLink] = useState<string | null>(null)
  const [invitedEmail, setInvitedEmail] = useState('')

  const reset = () => {
    setEmail('')
    setRole('member')
    setErr(null)
    setBusy(false)
    setLink(null)
    setInvitedEmail('')
  }

  const submit = async () => {
    const trimmed = email.trim()
    if (!trimmed || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
      setErr('Enter a valid email address.')
      return
    }
    setBusy(true)
    setErr(null)
    const name = handleFromEmail(trimmed)
    const user: IamUser = {
      owner: org,
      name,
      displayName: name,
      email: trimmed,
      isAdmin: role === 'admin',
      type: 'normal-user',
      createdTime: new Date().toISOString(),
    }
    try {
      // 1. Create the member (scoped to org, role assigned) — a real IAM row.
      await TeamApi.invite(user)
      // 2. Mint the shareable accept link so they can set a password + sign in
      //    (email/OTP delivery isn't wired — the link is the honest hand-off).
      let accept = ''
      try {
        accept = (await TeamApi.inviteLink({ org, name, email: trimmed })).link
      } catch {
        accept = '' // member exists regardless; the roster's row action can re-mint it
      }
      onInvited() // refresh the roster now — the member exists
      toast.success('Member invited', `${trimmed} was added to ${org} as ${role}.`)
      setInvitedEmail(trimmed)
      setLink(accept)
      setBusy(false)
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not invite the member.')
      setBusy(false)
    }
  }

  const showLink = link !== null

  return (
    <Dialog modal open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset() }}>
      <Dialog.Portal>
        <Dialog.Overlay key="invite-overlay" bg="rgba(0,0,0,0.55)" />
        <Dialog.Content key="invite-content" bordered elevate width={480} maxW="92vw" p="$4" gap="$3.5">
          <XStack items="center" justify="space-between">
            <Dialog.Title>
              <Text fontSize="$6" fontWeight="800">{showLink ? 'Invite sent' : 'Invite member'}</Text>
            </Dialog.Title>
            <Button size="$2" chromeless icon={<X size={18} />} onPress={() => onOpenChange(false)} aria-label="Close" />
          </XStack>

          {showLink ? (
            <>
              <Text fontSize="$3" color="$color11">
                <Text color="$color12" fontWeight="700">{invitedEmail}</Text> is now a {role} of {org}. Send them
                this link to set a password and sign in.
              </Text>
              {link ? (
                <YStack gap="$2">
                  <XStack gap="$1.5" items="center">
                    <Link2 size={14} />
                    <Text fontSize="$2" color="$color11" fontWeight="600">Invite link</Text>
                  </XStack>
                  <CopyLink value={link} />
                  <Text fontSize="$1" color="$color10">
                    Valid for 14 days. Email delivery isn't enabled on this deployment yet, so share the
                    link directly (chat, SMS, your own email).
                  </Text>
                </YStack>
              ) : (
                <Text fontSize="$2" color="$yellow10">
                  The member was created, but the invite link couldn't be generated. Use “Copy invite link”
                  on their row to try again.
                </Text>
              )}
              <XStack gap="$2" justify="flex-end">
                <Button onPress={() => reset()}>Invite another</Button>
                <PrimaryButton onPress={() => onOpenChange(false)}>Close</PrimaryButton>
              </XStack>
            </>
          ) : (
            <>
              <Text fontSize="$3" color="$color11">
                Add someone to {org}. We'll create their account and give you a link to share so they can set
                a password and sign in.
              </Text>
              <YStack gap="$3">
                <FieldRow label="Email">
                  <FieldText value={email} onChange={setEmail} placeholder="teammate@company.com" />
                </FieldRow>
                <FieldRow label="Role">
                  <FieldSelect value={role} options={['member', 'admin']} onChange={setRole} />
                </FieldRow>
              </YStack>
              {err ? <Text fontSize="$2" color="$red10">{err}</Text> : null}
              <XStack gap="$2" justify="flex-end">
                <Button chromeless onPress={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
                <PrimaryButton
                  onPress={() => void submit()}
                  disabled={busy || !email.trim()}
                  icon={busy ? <Spinner size="small" /> : <UserPlus size={16} />}
                >
                  Invite
                </PrimaryButton>
              </XStack>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

// ── Remove confirm ────────────────────────────────────────────────────────────

function RemoveDialog({
  member,
  onOpenChange,
  onRemoved,
}: {
  member: IamUser | null
  onOpenChange: (o: boolean) => void
  onRemoved: () => void
}) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!member) return
    setBusy(true)
    try {
      await TeamApi.remove(member)
      toast.success('Account deleted', `${member.email || member.name}'s Hanzo account was deleted.`)
      onOpenChange(false)
      onRemoved()
    } catch (e) {
      toast.error('Could not delete the account', e instanceof ApiError ? e.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog modal open={Boolean(member)} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay key="remove-overlay" bg="rgba(0,0,0,0.55)" />
        <Dialog.Content key="remove-content" bordered elevate width={440} maxW="92vw" p="$4" gap="$3">
          <VisuallyHidden>
            <Dialog.Title>Delete account</Dialog.Title>
          </VisuallyHidden>
          <Text fontSize="$6" fontWeight="800">Delete this account?</Text>
          <Text fontSize="$3" color="$color11">
            This deletes {member?.email || member?.name}'s Hanzo account outright — every
            session ends and their membership in every other organization goes with it.
            It does not scope to this organization, and it cannot be undone. Re-inviting
            them afterwards does not bring the old account back.
          </Text>
          <XStack gap="$2" justify="flex-end">
            <Button chromeless onPress={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button theme="red" onPress={() => void submit()} disabled={busy} icon={busy ? <Spinner size="small" /> : <Trash2 size={16} />}>
              Delete account
            </Button>
          </XStack>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

// ── Members ───────────────────────────────────────────────────────────────────

function MembersTab({ org, canManage }: { org: string; canManage: boolean }) {
  const toast = useToast()
  const [state, setState] = useState<Async<IamUser[]>>({ phase: 'loading' })
  const [inviting, setInviting] = useState(false)
  const [removing, setRemoving] = useState<IamUser | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    TeamApi.members(org)
      .then((p: Paged<IamUser>) => setState({ phase: 'ready', data: p.rows ?? [] }))
      .catch((e) => setState({ phase: 'error', err: asApiError(e) }))
  }, [org])

  useEffect(() => { load() }, [load])

  const toggleRole = useCallback(
    async (u: IamUser) => {
      const id = `${u.owner}/${u.name}`
      setBusyId(id)
      try {
        // update-user overwrites from the body, so send the FULL current user
        // with only isAdmin changed (never a partial that would blank fields).
        const full = await TeamApi.member(id).catch(() => u)
        await TeamApi.update(id, { ...full, isAdmin: !u.isAdmin })
        toast.success('Role updated', `${u.email || u.name} is now ${!u.isAdmin ? 'admin' : 'member'}.`)
        load()
      } catch (e) {
        toast.error('Could not change role', e instanceof ApiError ? e.message : undefined)
      } finally {
        setBusyId(null)
      }
    },
    [load, toast],
  )

  // Re-mint + copy a pending member's accept link (for a member created earlier, or
  // when the invite dialog couldn't mint it). Delivery is a link hand-off.
  const copyInviteLink = useCallback(
    async (u: IamUser) => {
      const id = `${u.owner}/${u.name}`
      setBusyId(id)
      try {
        const { link } = await TeamApi.inviteLink({ org: u.owner, name: u.name, email: u.email })
        try {
          await navigator.clipboard?.writeText(link)
          toast.success('Invite link copied', `Send it to ${u.email || u.name} so they can set a password.`)
        } catch {
          toast.success('Invite link ready', link)
        }
      } catch (e) {
        toast.error('Could not create invite link', e instanceof ApiError ? e.message : undefined)
      } finally {
        setBusyId(null)
      }
    },
    [toast],
  )

  const columns = useMemo<Column<IamUser>[]>(() => {
    const cols: Column<IamUser>[] = [
      {
        key: 'name',
        header: 'Member',
        render: (u) => (
          <YStack>
            <Text fontSize="$3" fontWeight="600" numberOfLines={1}>{u.displayName || u.name}</Text>
            <Text fontSize="$1" color="$color10" numberOfLines={1}>{u.email || '—'}</Text>
          </YStack>
        ),
      },
      { key: 'role', header: 'Role', width: 100, render: (u) => <RoleBadge role={roleOf(u)} /> },
      {
        key: 'status',
        header: 'Status',
        width: 130,
        render: (u) => (
          <XStack gap="$1.5" items="center" flexWrap="wrap">
            {isPending(u) ? (
              <Text fontSize="$2" px="$2" py="$1" rounded="$2" bg="$yellow4" color="$yellow11">Pending</Text>
            ) : (
              <Text fontSize="$2" px="$2" py="$1" rounded="$2" bg="$green4" color="$green11">Active</Text>
            )}
            {mfaOn(u) ? (
              <Text fontSize="$1" px="$1.5" py="$1" rounded="$2" bg="$color4" color="$color11">2FA</Text>
            ) : null}
          </XStack>
        ),
      },
      { key: 'createdTime', header: 'Joined', width: 120, render: (u) => <Text fontSize="$2" color="$color11">{fmtDate(u.createdTime)}</Text> },
    ]
    if (canManage) {
      cols.push({
        key: 'actions',
        header: '',
        width: 260,
        render: (u) => {
          const id = `${u.owner}/${u.name}`
          const busy = busyId === id
          return (
            <XStack gap="$2" justify="flex-end" flexWrap="wrap">
              {isPending(u) ? (
                <Button size="$2" chromeless icon={<Link2 size={14} />} disabled={busy} onPress={() => void copyInviteLink(u)}>
                  Copy invite link
                </Button>
              ) : (
                <Button size="$2" chromeless icon={<Shield size={14} />} disabled={busy} onPress={() => void toggleRole(u)}>
                  {u.isAdmin ? 'Make member' : 'Make admin'}
                </Button>
              )}
              <Button size="$2" chromeless theme="red" icon={<Trash2 size={14} />} disabled={busy} onPress={() => setRemoving(u)} aria-label={`Delete ${u.name}'s account`} />
            </XStack>
          )
        },
      })
    }
    return cols
  }, [canManage, busyId, toggleRole, copyInviteLink])

  return (
    <>
      <XStack justify="space-between" items="center" flexWrap="wrap" gap="$2">
        <Text fontSize="$3" color="$color11">
          {state.phase === 'ready' ? `${state.data.length} member${state.data.length === 1 ? '' : 's'} in ${org}` : `Members of ${org}`}
        </Text>
        <XStack gap="$2">
          <Button size="$2" icon={<RefreshCw size={15} />} onPress={load}>Refresh</Button>
          {canManage ? (
            <PrimaryButton size="$2" icon={<UserPlus size={15} />} onPress={() => setInviting(true)}>Invite member</PrimaryButton>
          ) : null}
        </XStack>
      </XStack>

      {!canManage ? (
        <Card p="$3" gap="$1" borderWidth={1} borderColor="$borderColor" maxWidth={640}>
          <Text fontSize="$2" color="$color11">
            You can view members. Inviting, changing roles, and removing members requires an organization admin.
          </Text>
        </Card>
      ) : null}

      {state.phase === 'error' ? (
        <ErrorState err={state.err} onRetry={load} copy={TEAM_COPY} />
      ) : (
        <DataTable
          columns={columns}
          rows={state.phase === 'ready' ? state.data : []}
          loading={state.phase === 'loading'}
          rowKey={(u) => `${u.owner}/${u.name}`}
          empty={`No members in ${org} yet.`}
        />
      )}

      <InviteDialog open={inviting} onOpenChange={setInviting} org={org} onInvited={load} />
      <RemoveDialog member={removing} onOpenChange={(o) => { if (!o) setRemoving(null) }} onRemoved={load} />
    </>
  )
}

// ── Roles (read-only) ─────────────────────────────────────────────────────────

const roleColumns: Column<Role>[] = [
  { key: 'name', header: 'Role', render: (r) => <Text fontSize="$3" fontWeight="600">{r.displayName || r.name}</Text> },
  { key: 'members', header: 'Members', width: 110, render: (r) => <Text fontSize="$3" color="$color11">{r.users?.length ?? 0}</Text> },
  { key: 'enabled', header: 'Enabled', width: 110, render: (r) => <Text fontSize="$3" color="$color11">{r.isEnabled === false ? 'no' : 'yes'}</Text> },
]

function RolesTab({ org }: { org: string }) {
  const [state, setState] = useState<Async<Role[]>>({ phase: 'loading' })
  const load = useCallback(() => {
    setState({ phase: 'loading' })
    TeamApi.roles(org)
      .then((p) => setState({ phase: 'ready', data: p.rows ?? [] }))
      .catch((e) => setState({ phase: 'error', err: asApiError(e) }))
  }, [org])
  useEffect(() => { load() }, [load])

  return (
    <>
      <XStack justify="space-between" items="center">
        <Text fontSize="$3" color="$color11">RBAC roles defined in {org}. Assigning named roles is managed in IAM.</Text>
        <Button size="$2" icon={<RefreshCw size={15} />} onPress={load}>Refresh</Button>
      </XStack>
      {state.phase === 'error' ? (
        <ErrorState err={state.err} onRetry={load} copy={TEAM_COPY} />
      ) : (
        <DataTable
          columns={roleColumns}
          rows={state.phase === 'ready' ? state.data : []}
          loading={state.phase === 'loading'}
          rowKey={(r) => `${r.owner}/${r.name}`}
          empty="No roles defined in this organization yet."
        />
      )}
    </>
  )
}

// ── Module ────────────────────────────────────────────────────────────────────

export function TeamModule({ params }: { params: Record<string, string> }) {
  const { account } = useSession()
  const isGlobal = useIsSuperAdmin()
  const tab = productSubpageSlug('team', params.tab)
  const org = currentOrg()
  // Writes are allowed for an org admin (own org) or a global admin — the server
  // proxy enforces the same; this only decides which controls to show.
  const canManage = Boolean(account?.isAdmin) || isGlobal

  return (
    <>
      <PageHeader
        title="Members"
        subtitle={`Members and roles for ${org === config.iamOrgName ? 'your organization' : org}.`}
      />
      <SubNav id="team" />
      {tab === 'roles' ? <RolesTab org={org} /> : <MembersTab org={org} canManage={canManage} />}
    </>
  )
}
