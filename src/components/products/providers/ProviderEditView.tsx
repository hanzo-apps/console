'use client'

import { useEffect, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'

import { ApiError, ProviderApi, type Provider } from '~/lib/api'
import { currentOrg } from '~/lib/org-scope'
import {
  CATEGORY_OPTIONS,
  CURRENCY_OPTIONS,
  STATE_OPTIONS,
  applyCategory,
  applyType,
  showClientSecret,
  showRegion,
  showSampling,
  showSubType,
  temperatureEnabled,
  topPEnabled,
} from './logic'
import { FieldRow, FieldSelect, FieldSlider, FieldSwitch, FieldText, PageHeader } from '@hanzo/ui/product'

export function ProviderEditView({ name, onDone }: { name: string; onDone: () => void }) {
  const [provider, setProvider] = useState<Provider | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setLoading(true)
    // Scope the edit-load to the SAME org as the list/create path (currentOrg()),
    // not a hardcoded 'admin' — otherwise create-under-brand-org → edit-GET breaks
    // for every non-admin org (the record lives under the active org, not 'admin').
    ProviderApi.get(currentOrg(), name)
      .then((p) => {
        if (live) {
          setProvider(p)
          setError(null)
        }
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof ApiError ? e.message : 'Failed to load provider')
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
  if (error && !provider) {
    return (
      <YStack gap="$3">
        <Text color="$color12">{error}</Text>
        <Button self="flex-start" onPress={onDone}>
          Back
        </Button>
      </YStack>
    )
  }
  if (!provider) return null

  const p = provider
  const disabled = !!p.isRemote
  const set = (patch: Partial<Provider>) => setProvider({ ...p, ...patch })

  const save = async (exit: boolean) => {
    setSaving(true)
    setError(null)
    try {
      await ProviderApi.update(p.owner, name, p)
      if (exit) onDone()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to save provider')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        title={disabled ? 'View provider' : 'Edit provider'}
        subtitle={p.name}
        actions={
          <XStack gap="$2">
            <Button onPress={onDone}>Back</Button>
            {!disabled ? (
              <>
                <Button disabled={saving} onPress={() => void save(false)}>
                  Save
                </Button>
                <Button theme="light" disabled={saving} onPress={() => void save(true)}>
                  Save & Exit
                </Button>
              </>
            ) : null}
          </XStack>
        }
      />
      {error ? <Text color="$color12">{error}</Text> : null}

      <Card p="$4" gap="$3.5" borderWidth={1} borderColor="$borderColor">
        <FieldRow label="Name">
          <FieldText value={p.name} onChange={(v) => set({ name: v })} disabled={disabled} />
        </FieldRow>
        <FieldRow label="Display name">
          <FieldText
            value={p.displayName ?? ''}
            onChange={(v) => set({ displayName: v })}
            disabled={disabled}
          />
        </FieldRow>
        <FieldRow label="Category">
          <FieldSelect
            value={p.category}
            options={[...CATEGORY_OPTIONS]}
            onChange={(v) => setProvider(applyCategory(p, v))}
            disabled={disabled}
          />
        </FieldRow>
        <FieldRow label="Type">
          <FieldText
            value={p.type}
            onChange={(v) => setProvider(applyType(p, v))}
            disabled={disabled}
          />
        </FieldRow>
        {showSubType(p) ? (
          <FieldRow label="Sub type">
            <FieldText
              value={p.subType ?? ''}
              onChange={(v) => set({ subType: v })}
              disabled={disabled}
              placeholder="Model name"
            />
          </FieldRow>
        ) : null}
        <FieldRow label="Client ID">
          <FieldText
            value={p.clientId ?? ''}
            onChange={(v) => set({ clientId: v })}
            disabled={disabled}
          />
        </FieldRow>
        {showClientSecret(p) ? (
          <FieldRow label="Client secret">
            <FieldText
              value={p.clientSecret ?? ''}
              onChange={(v) => set({ clientSecret: v })}
              disabled={disabled}
              secure
            />
          </FieldRow>
        ) : null}
        <FieldRow label="API key">
          <FieldText
            value={p.apiKey ?? ''}
            onChange={(v) => set({ apiKey: v })}
            disabled={disabled}
            secure
          />
        </FieldRow>
        {showRegion(p) ? (
          <FieldRow label="Region">
            <FieldText
              value={p.region ?? ''}
              onChange={(v) => set({ region: v })}
              disabled={disabled}
            />
          </FieldRow>
        ) : null}
        <FieldRow label="Provider URL">
          <FieldText
            value={p.providerUrl ?? ''}
            onChange={(v) => set({ providerUrl: v })}
            disabled={disabled}
          />
        </FieldRow>

        {showSampling(p) ? (
          <YStack gap="$3.5">
            <FieldRow label="Input $/1K tokens">
              <FieldText
                value={String(p.inputPricePerThousandTokens ?? 0)}
                onChange={(v) => set({ inputPricePerThousandTokens: Number(v) || 0 })}
                disabled={disabled}
              />
            </FieldRow>
            <FieldRow label="Output $/1K tokens">
              <FieldText
                value={String(p.outputPricePerThousandTokens ?? 0)}
                onChange={(v) => set({ outputPricePerThousandTokens: Number(v) || 0 })}
                disabled={disabled}
              />
            </FieldRow>
            <FieldRow label="Currency">
              <FieldSelect
                value={p.currency ?? 'USD'}
                options={[...CURRENCY_OPTIONS]}
                onChange={(v) => set({ currency: v })}
                disabled={disabled}
              />
            </FieldRow>
            {temperatureEnabled(p) ? (
              <FieldRow label="Temperature">
                <FieldSlider
                  value={p.temperature ?? 1}
                  min={0}
                  max={2}
                  step={0.01}
                  onChange={(v) => set({ temperature: v })}
                  disabled={disabled}
                />
              </FieldRow>
            ) : null}
            {topPEnabled(p) ? (
              <FieldRow label="Top P">
                <FieldSlider
                  value={p.topP ?? 1}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(v) => set({ topP: v })}
                  disabled={disabled}
                />
              </FieldRow>
            ) : null}
            <FieldRow label="Top K">
              <FieldSlider
                value={p.topK ?? 4}
                min={1}
                max={6}
                step={1}
                onChange={(v) => set({ topK: v })}
                disabled={disabled}
              />
            </FieldRow>
          </YStack>
        ) : null}

        <FieldRow label="Default">
          <FieldSwitch
            checked={!!p.isDefault}
            onChange={(v) => set({ isDefault: v })}
            disabled={disabled}
          />
        </FieldRow>
        <FieldRow label="State">
          <FieldSelect
            value={p.state ?? 'Active'}
            options={[...STATE_OPTIONS]}
            onChange={(v) => set({ state: v })}
            disabled={disabled}
          />
        </FieldRow>
      </Card>
    </>
  )
}
