'use client'

import { useEffect, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'

import { ApiError, ApplicationApi, type Application } from '~/lib/api'
import { currentOrg } from '~/lib/org-scope'
import { FieldRow, FieldText, FieldTextArea } from '~/components/ui/Field'
import { PageHeader } from '~/components/ui/PageHeader'
import { isUndeployed } from './logic'

/** Application editor. Loaded by owner/name; supports deploy/undeploy. */
export function ApplicationEditView({ name, onDone }: { name: string; onDone: () => void }) {
  const [app, setApp] = useState<Application | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Scope the edit-load to the SAME org as the list/create path (currentOrg()),
  // not a hardcoded 'admin' — the application record lives under the active org.
  const reload = (n: string) =>
    ApplicationApi.get(currentOrg(), n)
      .then((a) => {
        setApp(a)
        setError(null)
      })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Failed to load application'))

  useEffect(() => {
    let live = true
    setLoading(true)
    ApplicationApi.get(currentOrg(), name)
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
  }, [name])

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
  const set = (patch: Partial<Application>) => setApp({ ...a, ...patch })

  const save = async (exit: boolean) => {
    setSaving(true)
    setError(null)
    try {
      await ApplicationApi.update(a.owner, name, a)
      if (exit) onDone()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to save application')
    } finally {
      setSaving(false)
    }
  }

  const deploy = async () => {
    setSaving(true)
    setError(null)
    try {
      await ApplicationApi.deploy(a)
      await reload(name)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to deploy application')
    } finally {
      setSaving(false)
    }
  }

  const undeploy = async () => {
    if (typeof window !== 'undefined' && !window.confirm(`Undeploy "${a.name}"?`)) return
    setSaving(true)
    setError(null)
    try {
      await ApplicationApi.undeploy(a.owner, name)
      await reload(name)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to undeploy application')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Edit application"
        subtitle={a.name}
        actions={
          <XStack gap="$2">
            <Button onPress={onDone}>Back</Button>
            <Button disabled={saving} onPress={() => void save(false)}>
              Save
            </Button>
            <Button theme="light" disabled={saving} onPress={() => void save(true)}>
              Save & Exit
            </Button>
          </XStack>
        }
      />
      {error ? <Text color="$color12">{error}</Text> : null}

      <Card p="$4" gap="$3.5" borderWidth={1} borderColor="$borderColor">
        <FieldRow label="Name">
          <FieldText value={a.name} onChange={(v) => set({ name: v })} disabled />
        </FieldRow>
        <FieldRow label="Display name">
          <FieldText value={a.displayName ?? ''} onChange={(v) => set({ displayName: v })} />
        </FieldRow>
        <FieldRow label="Description">
          <FieldText value={a.description ?? ''} onChange={(v) => set({ description: v })} />
        </FieldRow>
        <FieldRow label="Template">
          <FieldText value={a.template ?? ''} onChange={(v) => set({ template: v })} />
        </FieldRow>
        <FieldRow label="Namespace">
          <FieldText value={a.namespace ?? ''} onChange={(v) => set({ namespace: v })} />
        </FieldRow>
        <FieldRow label="Parameters">
          <FieldTextArea value={a.parameters ?? ''} onChange={(v) => set({ parameters: v })} rows={5} />
        </FieldRow>
        <FieldRow label="Status">
          <XStack gap="$3" items="center">
            <Text fontSize="$3" color="$color11">
              {a.status ?? 'Not Deployed'}
            </Text>
            {isUndeployed(a) ? (
              <Button size="$2" theme="light" disabled={saving} onPress={() => void deploy()}>
                Deploy
              </Button>
            ) : (
              <Button size="$2" disabled={saving} onPress={() => void undeploy()}>
                Undeploy
              </Button>
            )}
          </XStack>
        </FieldRow>
      </Card>
    </>
  )
}
