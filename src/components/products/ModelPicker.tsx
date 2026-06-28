'use client'

/**
 * Model picker — the ONE way to choose a gateway model across the console
 * (Playground, Evals run). Loads the real catalog from GET /v1/models; renders a
 * select when it's available and a free-text id field otherwise, so a model can
 * always be chosen even when the catalog can't be read. Honest: it never invents
 * model names, and surfaces a retry when the catalog is unreachable.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { RefreshCw } from '@hanzogui/lucide-icons-2'

import { PlaygroundApi } from '~/lib/api'
import { FieldSelect, FieldText } from '~/components/ui/Field'
import { classifyBackend, type BackendState } from '~/components/ui/BackendState'

type State =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; models: string[] }

export function ModelPicker({
  value,
  onChange,
  placeholder = 'model id, e.g. zen-omni',
  autoselect = false,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  /** When set, pick the first catalog model if `value` is still empty on load. */
  autoselect?: boolean
}) {
  const [state, setState] = useState<State>({ phase: 'loading' })
  // Refs so `load` can autoselect without depending on `value`/`onChange`
  // (which would re-create it on every keystroke and re-fetch the catalog).
  const valueRef = useRef(value)
  valueRef.current = value
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    PlaygroundApi.listModels()
      .then((models) => {
        setState({ phase: 'ready', models })
        if (autoselect && !valueRef.current && models[0]) onChangeRef.current(models[0])
      })
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [autoselect])

  useEffect(() => {
    load()
  }, [load])

  return (
    <YStack gap="$1.5">
      {state.phase === 'ready' && state.models.length > 0 ? (
        <FieldSelect value={value} options={state.models} onChange={onChange} />
      ) : (
        <FieldText value={value} onChange={onChange} placeholder={placeholder} />
      )}
      {state.phase === 'loading' ? (
        <Text fontSize="$2" color="$color10">
          Loading model catalog…
        </Text>
      ) : state.phase === 'error' ? (
        <XStack gap="$2" items="center">
          <Text fontSize="$2" color="$color10">
            Model list unavailable — enter a model id.
          </Text>
          <Button size="$1" chromeless icon={<RefreshCw size={12} />} onPress={load}>
            Retry
          </Button>
        </XStack>
      ) : null}
    </YStack>
  )
}
