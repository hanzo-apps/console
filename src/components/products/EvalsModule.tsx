'use client'

/**
 * Evals — evaluate model outputs with scored runs (ported from the old console's
 * evals feature). Two REAL surfaces over the cloud `/v1/evals/*` facade:
 *   - Run    : POST /v1/evals/runs — run a dataset against a model + LLM judge.
 *   - Scores : GET  /v1/evals/scores — the resulting scores.
 * Routing: `/evals` opens Run; `/evals/scores` opens Scores. Both render honest
 * states (loading / backend-unavailable / empty) — never fabricated results.
 */
import { SubNav } from '~/components/ui/SubNav'
import { productSubpageSlug } from '~/lib/products/match'
import { EvalRunView } from './evals/EvalRunView'
import { EvalScoresView } from './evals/EvalScoresView'
import { PageHeader } from '@hanzo/ui/product'

export function EvalsModule({ params }: { params: Record<string, string> }) {
  const tab = productSubpageSlug('evals', params.tab)

  return (
    <>
      <PageHeader title="Evals" subtitle="Evaluate model and agent outputs with scored runs." />

      <SubNav id="evals" />

      {tab === 'scores' ? <EvalScoresView /> : <EvalRunView />}
    </>
  )
}
