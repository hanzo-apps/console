'use client'

import { useEffect, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'

import { ApiError, StoreApi, type Store } from '~/lib/api'
import { currentOrg } from '~/lib/org-scope'
import { SPLIT_OPTIONS, SEARCH_OPTIONS, STATE_OPTIONS } from './logic'
import { FieldRow, FieldSelect, FieldSwitch, FieldText, FieldTextArea, PageHeader } from '@hanzo/ui/product'

/** Store editor. Loaded by owner/name. Mirrors StoreEditPage.js core fields. */
export function StoreEditView({ name, onDone }: { name: string; onDone: () => void }) {
  const [store, setStore] = useState<Store | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setLoading(true)
    StoreApi.get(currentOrg(), name)
      .then((s) => {
        if (live) {
          setStore(s)
          setError(null)
        }
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof ApiError ? e.message : 'This store did not load. Go back and open it again.')
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
  if (error && !store) {
    return (
      <YStack gap="$3">
        <Text color="$color12">{error}</Text>
        <Button self="flex-start" onPress={onDone}>
          Back
        </Button>
      </YStack>
    )
  }
  if (!store) return null

  const s = store
  const set = (patch: Partial<Store>) => setStore({ ...s, ...patch })
  const int = (v: string) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.trunc(Number(v)) : 0)

  const save = async (exit: boolean) => {
    setSaving(true)
    setError(null)
    try {
      await StoreApi.update(s.owner, name, s)
      if (exit) onDone()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The store was not saved. Your edits are still here — try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Edit store"
        subtitle={s.name}
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
          <FieldText value={s.name} onChange={(v) => set({ name: v })} disabled />
        </FieldRow>
        <FieldRow label="Display name">
          <FieldText value={s.displayName ?? ''} onChange={(v) => set({ displayName: v })} />
        </FieldRow>
        <FieldRow label="Title">
          <FieldText value={s.title ?? ''} onChange={(v) => set({ title: v })} />
        </FieldRow>
        <FieldRow label="Default">
          <FieldSwitch checked={!!s.isDefault} onChange={(v) => set({ isDefault: v })} />
        </FieldRow>
        <FieldRow label="State">
          <FieldSelect
            value={s.state ?? 'Active'}
            options={[...STATE_OPTIONS]}
            onChange={(v) => set({ state: v })}
          />
        </FieldRow>
        <FieldRow label="Storage provider">
          <FieldText value={s.storageProvider ?? ''} onChange={(v) => set({ storageProvider: v })} />
        </FieldRow>
        <FieldRow label="Storage subpath">
          <FieldText value={s.storageSubpath ?? ''} onChange={(v) => set({ storageSubpath: v })} />
        </FieldRow>
        <FieldRow label="Image provider">
          <FieldText value={s.imageProvider ?? ''} onChange={(v) => set({ imageProvider: v })} />
        </FieldRow>
        <FieldRow label="Split provider">
          <FieldSelect
            value={s.splitProvider ?? 'Default'}
            options={[...SPLIT_OPTIONS]}
            onChange={(v) => set({ splitProvider: v })}
          />
        </FieldRow>
        <FieldRow label="Search provider">
          <FieldSelect
            value={s.searchProvider ?? 'Default'}
            options={[...SEARCH_OPTIONS]}
            onChange={(v) => set({ searchProvider: v })}
          />
        </FieldRow>
        <FieldRow label="Model provider">
          <FieldText value={s.modelProvider ?? ''} onChange={(v) => set({ modelProvider: v })} />
        </FieldRow>
        <FieldRow label="Embedding provider">
          <FieldText value={s.embeddingProvider ?? ''} onChange={(v) => set({ embeddingProvider: v })} />
        </FieldRow>
        <FieldRow label="Agent provider">
          <FieldText value={s.agentProvider ?? ''} onChange={(v) => set({ agentProvider: v })} />
        </FieldRow>
        <FieldRow label="Memory limit">
          <FieldText value={String(s.memoryLimit ?? 0)} onChange={(v) => set({ memoryLimit: int(v) })} />
        </FieldRow>
        <FieldRow label="Frequency">
          <FieldText value={String(s.frequency ?? 0)} onChange={(v) => set({ frequency: int(v) })} />
        </FieldRow>
        <FieldRow label="Limit minutes">
          <FieldText value={String(s.limitMinutes ?? 0)} onChange={(v) => set({ limitMinutes: int(v) })} />
        </FieldRow>
        <FieldRow label="Knowledge count">
          <FieldText value={String(s.knowledgeCount ?? 0)} onChange={(v) => set({ knowledgeCount: int(v) })} />
        </FieldRow>
        <FieldRow label="Suggestion count">
          <FieldText value={String(s.suggestionCount ?? 0)} onChange={(v) => set({ suggestionCount: int(v) })} />
        </FieldRow>
        <FieldRow label="Welcome">
          <FieldText value={s.welcome ?? ''} onChange={(v) => set({ welcome: v })} />
        </FieldRow>
        <FieldRow label="Welcome title">
          <FieldText value={s.welcomeTitle ?? ''} onChange={(v) => set({ welcomeTitle: v })} />
        </FieldRow>
        <FieldRow label="Welcome text">
          <FieldText value={s.welcomeText ?? ''} onChange={(v) => set({ welcomeText: v })} />
        </FieldRow>
        <FieldRow label="Prompt">
          <FieldTextArea value={s.prompt ?? ''} onChange={(v) => set({ prompt: v })} rows={5} />
        </FieldRow>
      </Card>
    </>
  )
}
