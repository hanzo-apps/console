'use client'

/**
 * Evals — evaluate model outputs with scored runs (ported from the old console's
 * evals feature). Two REAL surfaces over the cloud `/v1/evals/*` facade:
 *   - Run    : POST /v1/evals/runs — run a dataset against a model + LLM judge.
 *   - Scores : GET  /v1/evals/scores — the resulting scores.
 * Routing: `/evals` opens Run; `/evals/scores` opens Scores. Both render honest
 * states (loading / backend-unavailable / empty) — never fabricated results.
 */
import { useRouter } from 'next/navigation'
import { Button, XStack } from '@hanzo/gui'

import { PageHeader } from '@hanzo/ui/product'
import { EvalRunView } from './evals/EvalRunView'
import { EvalScoresView } from './evals/EvalScoresView'

const TABS = [
  { id: 'run', label: 'Run', path: '/evals' },
  { id: 'scores', label: 'Scores', path: '/evals/scores' },
] as const

export function EvalsModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const tab = params.tab === 'scores' ? 'scores' : 'run'

  return (
    <>
      <PageHeader title="Evals" subtitle="Evaluate model and agent outputs with scored runs." />

      <XStack gap="$1" flexWrap="wrap">
        {TABS.map((t) => (
          <Button
            key={t.id}
            size="$2"
            bg={t.id === tab ? '$color5' : 'transparent'}
            borderWidth={1}
            borderColor="$borderColor"
            onPress={() => router.push(t.path)}
          >
            {t.label}
          </Button>
        ))}
      </XStack>

      {tab === 'scores' ? <EvalScoresView /> : <EvalRunView />}
    </>
  )
}
