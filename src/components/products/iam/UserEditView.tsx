'use client'

/**
 * IAM user create + edit. `name === 'new'` is the create form (name / display
 * name / email / password); any other name loads the user (`get-user`, incl. the
 * authoritative MFA fields) and edits role (isAdmin), enabled state (isForbidden),
 * and display name. Mirrors the ProviderEditView/ApplicationEditView shape; every
 * mutation reports through the shared toast, every result honest.
 */
import { useEffect, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Trash } from '@hanzogui/lucide-icons-2'

import { ApiError, IamAdminApi, type IamUser } from '~/lib/api'
import { FieldRow, FieldText, FieldSwitch } from '~/components/ui/Field'
import { PageHeader } from '~/components/ui/PageHeader'
import { useToast } from '~/components/ui/Toast'
import { newUser, mfaLabel } from './logic'

export function UserEditView({ org, name, onDone }: { org: string; name: string; onDone: () => void }) {
  const toast = useToast()
  const creating = name === 'new'

  const [user, setUser] = useState<IamUser | null>(creating ? newUser(org) : null)
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(!creating)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (creating) return
    let live = true
    setLoading(true)
    IamAdminApi.getUser(`${org}/${name}`)
      .then((u) => {
        if (live) {
          setUser(u)
          setError(null)
        }
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof ApiError ? e.message : 'Failed to load user')
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [org, name, creating])

  if (loading) {
    return (
      <XStack p="$6" justify="center">
        <Spinner size="large" color="$color11" />
      </XStack>
    )
  }
  if (error && !user) {
    return (
      <YStack gap="$3">
        <Text color="$color12">{error}</Text>
        <Button self="flex-start" onPress={onDone}>
          Back
        </Button>
      </YStack>
    )
  }
  if (!user) return null

  const u = user
  const set = (patch: Partial<IamUser>) => setUser({ ...u, ...patch })

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      if (creating) {
        if (!u.name.trim()) {
          setError('A username is required.')
          setSaving(false)
          return
        }
        await IamAdminApi.addUser({ ...u, ...(password ? { password } : {}) })
        toast.success(`Created ${u.name}`)
      } else {
        await IamAdminApi.updateUser(`${org}/${name}`, u)
        toast.success(`Saved ${u.name}`)
      }
      onDone()
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Failed to save user'
      setError(msg)
      toast.error(creating ? 'Could not create user' : 'Could not save user', msg)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (typeof window !== 'undefined' && !window.confirm(`Delete user "${u.name}"?`)) return
    setSaving(true)
    setError(null)
    try {
      await IamAdminApi.deleteUser(u)
      toast.success(`Deleted ${u.name}`)
      onDone()
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Failed to delete user'
      setError(msg)
      toast.error('Could not delete user', msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        title={creating ? 'New user' : 'Edit user'}
        subtitle={creating ? org : `${org}/${name}`}
        actions={
          <XStack gap="$2">
            <Button onPress={onDone}>Back</Button>
            <Button theme="light" disabled={saving} onPress={() => void save()}>
              {creating ? 'Create' : 'Save'}
            </Button>
            {!creating ? (
              <Button theme="red" icon={<Trash size={15} />} disabled={saving} onPress={() => void remove()}>
                Delete
              </Button>
            ) : null}
          </XStack>
        }
      />
      {error ? <Text color="$color12">{error}</Text> : null}

      <Card p="$4" gap="$3.5" borderWidth={1} borderColor="$borderColor" maxWidth={680}>
        <FieldRow label="Username">
          <FieldText value={u.name} onChange={(v) => set({ name: v })} disabled={!creating} placeholder="jane" />
        </FieldRow>
        <FieldRow label="Display name">
          <FieldText value={u.displayName ?? ''} onChange={(v) => set({ displayName: v })} />
        </FieldRow>
        <FieldRow label="Email">
          <FieldText value={u.email ?? ''} onChange={(v) => set({ email: v })} placeholder="jane@example.com" />
        </FieldRow>
        {creating ? (
          <FieldRow label="Password">
            <FieldText value={password} onChange={setPassword} secure placeholder="Set an initial password" />
          </FieldRow>
        ) : null}
        <FieldRow label="Admin role">
          <FieldSwitch checked={!!u.isAdmin} onChange={(v) => set({ isAdmin: v })} />
        </FieldRow>
        {!creating ? (
          <>
            <FieldRow label="Enabled">
              <FieldSwitch checked={!u.isForbidden} onChange={(v) => set({ isForbidden: !v })} />
            </FieldRow>
            <FieldRow label="2FA">
              <Text fontSize="$3" color="$color11" pt="$2">
                {mfaLabel(u)}
              </Text>
            </FieldRow>
          </>
        ) : null}
      </Card>
    </>
  )
}
