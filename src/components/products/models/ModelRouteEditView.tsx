'use client'

import { useEffect, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'

import { ApiError, ModelRouteApi, type ModelRoute } from '~/lib/api'
import { currentOrg } from '~/lib/org-scope'
import { newModelRoute } from './logic'
import { FieldRow, FieldSwitch, FieldText, PageHeader } from '@hanzo/ui/product'

/**
 * Model-route editor. `modelName === null` => create mode (empty form, modelName
 * editable, POST add-model-route). Otherwise edit mode (loaded by owner/modelName,
 * modelName read-only, POST update-model-route). Ported from ModelRouteEditPage.js.
 */
export function ModelRouteEditView({
  modelName,
  onDone,
}: {
  modelName: string | null
  onDone: () => void
}) {
  // Tenant scope: model routes are org-owned. Use the active org scope so the
  // route loads by `<org>/<modelName>` and `newModelRoute(owner)` creates under it.
  const owner = currentOrg()
  const isNew = modelName === null

  const [route, setRoute] = useState<ModelRoute | null>(isNew ? newModelRoute(owner) : null)
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isNew) return
    let live = true
    setLoading(true)
    ModelRouteApi.get(owner, modelName)
      .then((r) => {
        if (live) {
          setRoute(r)
          setError(null)
        }
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof ApiError ? e.message : 'Failed to load model route')
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [isNew, owner, modelName])

  if (loading) {
    return (
      <XStack p="$6" justify="center">
        <Spinner size="large" color="$color11" />
      </XStack>
    )
  }
  if (error && !route) {
    return (
      <YStack gap="$3">
        <Text color="$color12">{error}</Text>
        <Button self="flex-start" onPress={onDone}>
          Back
        </Button>
      </YStack>
    )
  }
  if (!route) return null

  const r = route
  const set = (patch: Partial<ModelRoute>) => setRoute({ ...r, ...patch })
  const num = (v: string) => (Number(v) >= 0 ? Number(v) : 0)

  const save = async (exit: boolean) => {
    if (isNew && !r.modelName) {
      setError('Model name is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (isNew) {
        await ModelRouteApi.add(r)
      } else {
        await ModelRouteApi.update(owner, modelName, r)
      }
      if (exit || isNew) onDone()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to save model route')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        title={isNew ? 'New model route' : 'Edit model route'}
        subtitle={r.modelName || undefined}
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
        <FieldRow label="Model name">
          <FieldText
            value={r.modelName ?? ''}
            onChange={(v) => set({ modelName: v })}
            disabled={!isNew}
            placeholder="claude-sonnet-4-6"
          />
        </FieldRow>
        <FieldRow label="Provider">
          <FieldText
            value={r.provider ?? ''}
            onChange={(v) => set({ provider: v })}
            placeholder="Primary provider name (must match a Provider)"
          />
        </FieldRow>
        <FieldRow label="Upstream">
          <FieldText
            value={r.upstream ?? ''}
            onChange={(v) => set({ upstream: v })}
            placeholder="Model id sent to the upstream API"
          />
        </FieldRow>
        <FieldRow label="Owned by">
          <FieldText
            value={r.ownedBy ?? ''}
            onChange={(v) => set({ ownedBy: v })}
            placeholder="Override for owned_by in /v1/models"
          />
        </FieldRow>
        <FieldRow label="Fallback 1 provider">
          <FieldText value={r.fallback1Provider ?? ''} onChange={(v) => set({ fallback1Provider: v })} />
        </FieldRow>
        <FieldRow label="Fallback 1 upstream">
          <FieldText value={r.fallback1Upstream ?? ''} onChange={(v) => set({ fallback1Upstream: v })} />
        </FieldRow>
        <FieldRow label="Fallback 2 provider">
          <FieldText value={r.fallback2Provider ?? ''} onChange={(v) => set({ fallback2Provider: v })} />
        </FieldRow>
        <FieldRow label="Fallback 2 upstream">
          <FieldText value={r.fallback2Upstream ?? ''} onChange={(v) => set({ fallback2Upstream: v })} />
        </FieldRow>
        <FieldRow label="Input $/M">
          <FieldText
            value={String(r.inputPricePerMillion ?? 0)}
            onChange={(v) => set({ inputPricePerMillion: num(v) })}
            placeholder="0 = use default"
          />
        </FieldRow>
        <FieldRow label="Output $/M">
          <FieldText
            value={String(r.outputPricePerMillion ?? 0)}
            onChange={(v) => set({ outputPricePerMillion: num(v) })}
            placeholder="0 = use default"
          />
        </FieldRow>
        <FieldRow label="Premium">
          <FieldSwitch checked={!!r.premium} onChange={(v) => set({ premium: v })} />
        </FieldRow>
        <FieldRow label="Hidden">
          <FieldSwitch checked={!!r.hidden} onChange={(v) => set({ hidden: v })} />
        </FieldRow>
        <FieldRow label="Enabled">
          <FieldSwitch checked={!!r.enabled} onChange={(v) => set({ enabled: v })} />
        </FieldRow>
      </Card>
    </>
  )
}
