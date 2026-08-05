'use client'

/**
 * Run an eval — POST /v1/evals/runs. This is REAL orchestration: the cloud
 * evals facade runs each dataset item through the model gateway, records a trace
 * + dataset-run-item in the console, then scores it with an LLM-as-judge. The
 * response is a true per-item summary (avg score, scored count, per-item output
 * and errors), rendered as-is. Nothing is fabricated — a run that scores nothing
 * is shown as a real failure, not a fake success.
 */
import { useEffect, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Play } from '@hanzogui/lucide-icons-2'

import { EvalsApi, type EvalRunSummary, type EvalItemResult } from '~/lib/api'
import { ModelSelector } from '../ModelSelector'
import { useModelCatalog } from '../useModelCatalog'
import { groupByFamily } from '~/lib/api/families'
import { modelId } from '~/lib/api/aicatalog'
import { BackendStateCard, DataTable, FieldRow, FieldText, FieldTextArea, classifyBackend, type BackendState, type Column } from '@hanzo/ui/product'

const itemColumns: Column<EvalItemResult>[] = [
  { key: 'itemId', header: 'Item', width: 150, render: (r) => (
    <Text fontSize="$3" numberOfLines={1}>{r.itemId}</Text>
  ) },
  { key: 'score', header: 'Score', width: 90, render: (r) => (
    <Text fontSize="$3" color={r.error ? '$color10' : '$color12'}>
      {r.error ? '—' : r.score.toFixed(2)}
    </Text>
  ) },
  { key: 'output', header: 'Output / Error', render: (r) => (
    <Text fontSize="$3" color={r.error ? '$color12' : '$color11'} numberOfLines={2}>
      {r.error ? r.error : r.output || '—'}
    </Text>
  ) },
]

export function EvalRunView() {
  const [dataset, setDataset] = useState('')
  const [model, setModel] = useState('')
  const [runName, setRunName] = useState('')
  const [limit, setLimit] = useState('20')
  const [judgeModel, setJudgeModel] = useState('')
  const [criteria, setCriteria] = useState('')

  const [running, setRunning] = useState(false)
  const [summary, setSummary] = useState<EvalRunSummary | null>(null)
  const [error, setError] = useState<BackendState | null>(null)

  // The live gateway catalog feeds BOTH selectors (model under test + judge).
  const catalog = useModelCatalog()
  // Seed the model under test with the top family model (Zen default surfaces first)
  // once the catalog is ready, so the form is ready-to-run — the judge stays blank
  // (defaults to the model under test on the server).
  useEffect(() => {
    if (catalog.phase !== 'ready' || model) return
    const first = groupByFamily(catalog.entries)[0]?.models[0]
    if (first) setModel(modelId(first))
  }, [catalog.phase, catalog.entries, model])

  const run = async () => {
    if (!dataset.trim() || !model.trim()) {
      setError({ kind: 'error', message: 'Dataset and model are required.' })
      return
    }
    setRunning(true)
    setError(null)
    setSummary(null)
    try {
      const s = await EvalsApi.run({
        dataset: dataset.trim(),
        model: model.trim(),
        runName: runName.trim() || undefined,
        limit: Number(limit) || undefined,
        judge:
          judgeModel.trim() || criteria.trim()
            ? { model: judgeModel.trim() || undefined, criteria: criteria.trim() || undefined }
            : undefined,
      })
      setSummary(s)
    } catch (e) {
      setError(classifyBackend(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <XStack gap="$4" flexWrap="wrap" items="flex-start">
      {/* ── Left: run config ────────────────────────────────────────────── */}
      <YStack gap="$3" flex={1} minW={360}>
        <Card p="$4" gap="$3.5" borderWidth={1} borderColor="$borderColor">
          <FieldRow label="Dataset">
            <FieldText value={dataset} onChange={setDataset} placeholder="dataset name" />
          </FieldRow>
          <FieldRow label="Model under test">
            <ModelSelector models={catalog.entries} value={model} onChange={setModel} size="sm" />
          </FieldRow>
          <FieldRow label="Run name">
            <FieldText value={runName} onChange={setRunName} placeholder="auto if blank" />
          </FieldRow>
          <FieldRow label="Item limit">
            <FieldText value={limit} onChange={setLimit} placeholder="20" />
          </FieldRow>
          <FieldRow label="Judge model">
            <ModelSelector
              models={catalog.entries}
              value={judgeModel}
              onChange={setJudgeModel}
              size="sm"
              placeholder="defaults to model under test"
            />
          </FieldRow>
          <FieldRow label="Judge criteria">
            <FieldTextArea value={criteria} onChange={setCriteria} rows={3} />
          </FieldRow>
          <XStack>
            <Button self="flex-start" icon={<Play size={16} />} disabled={running} onPress={() => void run()}>
              {running ? 'Running…' : 'Run eval'}
            </Button>
          </XStack>
        </Card>
      </YStack>

      {/* ── Right: results ──────────────────────────────────────────────── */}
      <YStack gap="$3" flex={1} minW={360}>
        {running ? (
          <Card p="$4" borderWidth={1} borderColor="$borderColor">
            <XStack gap="$2" items="center">
              <Spinner color="$color11" />
              <Text color="$color11">Running each item through the model and judge…</Text>
            </XStack>
          </Card>
        ) : error ? (
          <BackendStateCard state={error} onRetry={() => void run()} hint="endpoint · POST /v1/evals/runs" />
        ) : summary ? (
          <>
            <Card p="$4" gap="$2" borderWidth={1} borderColor="$borderColor">
              <Text fontSize="$5" fontWeight="800">
                {summary.avgScore.toFixed(3)}
                <Text fontSize="$3" color="$color11"> avg score</Text>
              </Text>
              <XStack gap="$3" flexWrap="wrap">
                <Text fontSize="$2" color="$color10">run · {summary.runName}</Text>
                <Text fontSize="$2" color="$color10">model · {summary.model}</Text>
                <Text fontSize="$2" color="$color10">judge · {summary.judgeModel}</Text>
                <Text fontSize="$2" color="$color10">
                  scored {summary.scored}/{summary.items}
                </Text>
              </XStack>
            </Card>
            <DataTable
              columns={itemColumns}
              rows={summary.results ?? []}
              rowKey={(r) => r.itemId}
              empty="No item results returned."
            />
          </>
        ) : (
          <Card p="$4" borderWidth={1} borderColor="$borderColor">
            <Text fontSize="$3" color="$color10">
              Configure a run and press Run eval. Results — real per-item scores from the model and
              judge — appear here. Nothing is shown until a run returns.
            </Text>
          </Card>
        )}
      </YStack>
    </XStack>
  )
}
