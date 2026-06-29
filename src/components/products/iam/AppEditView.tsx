'use client'

/**
 * IAM application create + edit. `name === 'new'` is the create form; any other
 * name loads the application (`get-application`) and edits its display name +
 * description. Read-only fields (clientId) are shown for reference. Delete is
 * available in edit mode. Mirrors the ProviderEditView/ApplicationEditView shape.
 */
import { useEffect, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Trash } from '@hanzogui/lucide-icons-2'

import { ApiError, IamAdminApi, type IamApplication } from '~/lib/api'
import { FieldRow, FieldText } from '~/components/ui/Field'
import { PageHeader } from '~/components/ui/PageHeader'
import { useToast } from '~/components/ui/Toast'
import { newApplication } from './logic'

export function AppEditView({ org, name, onDone }: { org: string; name: string; onDone: () => void }) {
  const toast = useToast()
  const creating = name === 'new'

  const [app, setApp] = useState<IamApplication | null>(creating ? newApplication(org) : null)
  const [loading, setLoading] = useState(!creating)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (creating) return
    let live = true
    setLoading(true)
    IamAdminApi.application(`admin/${name}`)
      .then((a) => {
        if (live) {
          setApp(a)
          setError(null)
        }
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof ApiError ? e.message : 'Failed to load application')
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [name, creating])

  if (loading) {
    return (
      <XStack p="$6" justify="center">
        <Spinner size="large" color="$color11" />
      </XStack>
    )
  }
  if (error && !app) {
    return (
      <YStack gap="$3">
        <Text color="$color12">{error}</Text>
        <Button self="flex-start" onPress={onDone}>
          Back
        </Button>
      </YStack>
    )
  }
  if (!app) return null

  const a = app
  const set = (patch: Partial<IamApplication>) => setApp({ ...a, ...patch })

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      if (creating) {
        if (!a.name.trim()) {
          setError('An application name is required.')
          setSaving(false)
          return
        }
        await IamAdminApi.addApplication(a)
        toast.success(`Created ${a.name}`)
      } else {
        await IamAdminApi.updateApplication(`admin/${name}`, a)
        toast.success(`Saved ${a.name}`)
      }
      onDone()
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Failed to save application'
      setError(msg)
      toast.error(creating ? 'Could not create application' : 'Could not save application', msg)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (typeof window !== 'undefined' && !window.confirm(`Delete application "${a.name}"?`)) return
    setSaving(true)
    setError(null)
    try {
      await IamAdminApi.deleteApplication(a)
      toast.success(`Deleted ${a.name}`)
      onDone()
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Failed to delete application'
      setError(msg)
      toast.error('Could not delete application', msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        title={creating ? 'New application' : 'Edit application'}
        subtitle={creating ? org : a.name}
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
        <FieldRow label="Name">
          <FieldText value={a.name} onChange={(v) => set({ name: v })} disabled={!creating} placeholder="my-app" />
        </FieldRow>
        <FieldRow label="Display name">
          <FieldText value={a.displayName ?? ''} onChange={(v) => set({ displayName: v })} />
        </FieldRow>
        <FieldRow label="Organization">
          <FieldText value={a.organization ?? org} onChange={(v) => set({ organization: v })} />
        </FieldRow>
        <FieldRow label="Description">
          <FieldText value={a.description ?? ''} onChange={(v) => set({ description: v })} />
        </FieldRow>
        {!creating && a.clientId ? (
          <FieldRow label="Client ID">
            <FieldText value={a.clientId} onChange={() => undefined} disabled />
          </FieldRow>
        ) : null}
      </Card>
    </>
  )
}
