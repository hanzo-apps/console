'use client'

/**
 * Research — the R&D EVIDENCE board (HIP-0512 §"Hanzo Research"). Renders the
 * falsifiable-experiment corpus every product self-logs to `/v1/research`: a totals
 * band, a per-kind facet, the experiment ledger (each verdict a colored pill, expand
 * for the hypothesis/prediction/reasoning/log), and a refutation highlight — the
 * "don't re-chase" knowledge, where a REFUTATION is a first-class result, never an error.
 *
 * Gated twice, exactly like the Fleet Observability board: the registry entry is
 * `admin: true` (hidden from every customer's nav/palette) and this module
 * renders `SuperAdminRequired` for a non-super-admin client. The read is
 * org-scoped server-side (the `research` head resolves the org from the Bearer owner),
 * so a customer only ever reaches their OWN corpus — never Hanzo's platform R&D.
 *
 * Honest by construction: every figure is a real aggregate or an em-dash, a kind with
 * no data renders honest-empty, and a failed fetch shows the honest error/access state,
 * never a fabricated experiment.
 */
import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { FlaskConical, CheckCircle2, CircleSlash, FolderGit2, ListChecks, Coins, ScrollText, Microscope } from '@hanzogui/lucide-icons-2'

import { ResearchApi, type Experiment, type Totals, type Verdict } from '~/lib/api/research'
import { MetricCard } from '~/components/ui/Metric'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { asApiError, ErrorState, SuperAdminRequired } from '~/components/ui/States'
import { useIsSuperAdmin } from '~/lib/auth/admin'
import { fmtValue, fmtDate, rowKeyOf } from './research-fmt'
import { toneVar } from '~/components/ui/tone'

type State = { loading: boolean; error: unknown; totals: Totals | null; experiments: Experiment[] }

// ── formatters (compact + honest; a non-finite value is an em-dash, never faked) ──
const fmtCount = (n: number): string => (Number.isFinite(n) ? n.toLocaleString() : '—')
const fmtUsd = (n: number): string => (!Number.isFinite(n) ? '—' : n >= 100 ? `$${Math.round(n).toLocaleString()}` : `$${n.toFixed(2)}`)

// ── verdict pill — the console's tinted-chip grammar, verdict-aware tones ──
// A refutation is DELIBERATELY not dressed as a failure: it reads as ruled-out
// knowledge (the point of an evidentiary layer), so it takes the INFORMATIONAL tone,
// never the critical one. Emphasis + the word carry the verdict — the chrome has no hue.
const VERDICT_STYLE: Record<Exclude<Verdict, ''>, { fg: string; bg: string }> = {
  proven: { fg: toneVar('positive'), bg: 'var(--color4)' },
  refuted: { fg: toneVar('neutral'), bg: 'var(--color4)' },
  inconclusive: { fg: toneVar('warning'), bg: 'var(--color3)' },
}
const NEUTRAL = { fg: toneVar('muted'), bg: 'var(--color3)' }

/** The verdict as a colored pill; a hypothesis-free run shows its neutral run status so
 *  the column never blanks and never fabricates a verdict. */
function VerdictPill({ verdict, status }: { verdict: Verdict; status?: string }) {
  const s = verdict ? VERDICT_STYLE[verdict] : NEUTRAL
  const label = verdict || status || 'unknown'
  return (
    <Text fontSize="$1" fontWeight="600" px="$2" py="$1" rounded="$2" bg={s.bg as never} color={s.fg as never}>
      {label}
    </Text>
  )
}

const countVerdict = (rows: Experiment[], v: Verdict): number => rows.filter((e) => e.meta.verdict === v).length

const COLS: Column<Experiment>[] = [
  { key: 'subject', header: 'Subject', render: (e) => <Text fontSize="$3" fontWeight="500" numberOfLines={1}>{e.subject || '—'}</Text> },
  { key: 'task', header: 'Task', render: (e) => <Text fontSize="$2" color="$color11" numberOfLines={1}>{e.task || '—'}</Text> },
  { key: 'kind', header: 'Kind', width: 132, render: (e) => <Text fontSize="$2" color="$color10" className="mono" numberOfLines={1}>{e.kind || '—'}</Text> },
  { key: 'verdict', header: 'Verdict', width: 116, render: (e) => <VerdictPill verdict={e.meta.verdict} status={e.status} /> },
  {
    key: 'value',
    header: 'Value',
    width: 116,
    align: 'right',
    render: (e) => (
      <YStack items="flex-end">
        <Text fontSize="$3" color="$color12" className="mono">{fmtValue(e.value)}</Text>
        {e.metric ? <Text fontSize="$1" color="$color10" numberOfLines={1}>{e.metric}</Text> : null}
      </YStack>
    ),
  },
]

export function ResearchModule() {
  const isAdmin = useIsSuperAdmin()
  const [st, setSt] = useState<State>({ loading: true, error: null, totals: null, experiments: [] })
  const [kind, setKind] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!isAdmin) return
    let alive = true
    setSt((s) => ({ ...s, loading: true, error: null }))
    Promise.all([ResearchApi.totals(), ResearchApi.experiments()])
      .then(([totals, experiments]) => alive && setSt({ loading: false, error: null, totals, experiments }))
      .catch((error) => alive && setSt({ loading: false, error, totals: null, experiments: [] }))
    return () => {
      alive = false
    }
  }, [isAdmin, reloadKey])

  const { experiments, totals } = st
  const proven = useMemo(() => countVerdict(experiments, 'proven'), [experiments])
  const refuted = useMemo(() => countVerdict(experiments, 'refuted'), [experiments])
  const refutations = useMemo(() => experiments.filter((e) => e.meta.verdict === 'refuted'), [experiments])
  const shown = useMemo(() => (kind ? experiments.filter((e) => e.kind === kind) : experiments), [experiments, kind])

  // Client gate — the authoritative gate is server-side (the `research` head is
  // org-scoped by the Bearer owner); this is the honest matching UI gate.
  if (!isAdmin) return <SuperAdminRequired />

  return (
    <YStack gap="$4" p="$4" maxW={1200} self="center" width="100%">
      <YStack gap="$1">
        <XStack items="center" gap="$2">
          <FlaskConical size={20} />
          <Text fontSize="$7" fontWeight="800">
            Research
          </Text>
        </XStack>
        <Text fontSize="$3" color="$color11">
          Falsifiable R&amp;D experiments across the platform — every proof and every refutation, first-class. Each run
          states a hypothesis and a prediction, logs what it saw, then proves or refutes it.
        </Text>
      </YStack>

      {st.error ? (
        <ErrorState err={asApiError(st.error)} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : (
        <>
          {/* Corpus KPI band. */}
          <XStack gap="$3" flexWrap="wrap">
            <Kpi icon={<FlaskConical size={15} />} label="Experiments" value={totals ? fmtCount(totals.experiments) : '—'} caption="latest-run-canonical" />
            <Kpi icon={<CheckCircle2 size={15} />} label="Proven" value={fmtCount(proven)} caption="confirmed hypotheses" />
            <Kpi icon={<CircleSlash size={15} />} label="Refuted" value={fmtCount(refuted)} caption="ruled out — don't re-chase" />
            <Kpi icon={<FolderGit2 size={15} />} label="Projects" value={totals ? fmtCount(totals.projects) : '—'} caption={totals ? `${fmtCount(totals.byKind.length)} kinds` : ''} />
            <Kpi icon={<ListChecks size={15} />} label="Attempts" value={totals ? fmtCount(totals.attempts) : '—'} caption={totals ? `${fmtCount(totals.models)} models · ${fmtCount(totals.benchmarks)} benchmarks` : ''} />
            <Kpi icon={<Coins size={15} />} label="Spend" value={totals ? fmtUsd(totals.costUsd) : '—'} caption="measured corpus cost" />
          </XStack>

          {/* Refutation highlight — the "don't re-chase" knowledge, reasoning inline. */}
          <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
            <XStack items="center" gap="$2">
              <CircleSlash size={15} color="$color11" />
              <Text fontSize="$4" fontWeight="700">
                Refutations
              </Text>
              <Text fontSize="$2" color="$color10">
                {refutations.length ? `${refutations.length} ruled out` : ''}
              </Text>
            </XStack>
            {st.loading ? (
              <Text fontSize="$3" color="$color10">Loading…</Text>
            ) : refutations.length ? (
              <YStack gap="$2.5">
                {refutations.map((e) => (
                  <YStack key={e.id} gap="$1" borderLeftWidth={2} borderColor="$color11" pl="$3">
                    <XStack items="center" gap="$2" flexWrap="wrap">
                      <Text fontSize="$3" fontWeight="600">{e.subject}</Text>
                      <Text fontSize="$2" color="$color10" className="mono">{e.task}</Text>
                    </XStack>
                    {e.meta.because ? <Text fontSize="$2" color="$color11">{e.meta.because}</Text> : null}
                  </YStack>
                ))}
              </YStack>
            ) : (
              <Text fontSize="$3" color="$color10">
                No refutations recorded yet.
              </Text>
            )}
          </Card>

          {/* Facet by kind — research across the whole company, one discriminator at a time. */}
          <XStack gap="$1" flexWrap="wrap">
            <Chip label="All" count={totals?.experiments} active={kind === null} onPress={() => setKind(null)} />
            {(totals?.byKind ?? []).map((k) => (
              <Chip key={k.kind} label={k.kind} count={k.experiments} active={kind === k.kind} onPress={() => setKind(k.kind)} />
            ))}
          </XStack>

          {/* The experiment ledger — expand a row for its full scientific frame. */}
          <YStack gap="$3">
            <XStack items="center" gap="$2">
              <Microscope size={15} />
              <Text fontSize="$4" fontWeight="700">
                Experiment ledger
              </Text>
            </XStack>
            <DataTable
              columns={COLS}
              rows={shown}
              loading={st.loading}
              rowKey={rowKeyOf}
              onRowPress={(e) => setOpenId((id) => (id === rowKeyOf(e) ? null : rowKeyOf(e)))}
              isRowExpanded={(e) => rowKeyOf(e) === openId}
              renderExpanded={(e) => <Detail e={e} />}
              empty={kind ? `No ${kind} experiments yet.` : 'No experiments recorded yet.'}
            />
          </YStack>
        </>
      )}
    </YStack>
  )
}

/** A flexing KPI tile (wraps to stack on narrow viewports). */
function Kpi({ icon, label, value, caption }: { icon: React.ReactElement; label: string; value: string; caption?: string }) {
  return (
    <YStack flex={1} minW={168}>
      <MetricCard icon={icon} label={label} value={value} caption={caption} />
    </YStack>
  )
}

/** A facet chip (mirrors the console's range-selector buttons). */
function Chip({ label, count, active, onPress }: { label: string; count?: number; active: boolean; onPress: () => void }) {
  return (
    <Button size="$2" chromeless={!active} bg={active ? '$color5' : 'transparent'} onPress={onPress}>
      {count != null ? `${label} · ${count.toLocaleString()}` : label}
    </Button>
  )
}

/** The expanded row — the run's full scientific frame + narrative. */
function Detail({ e }: { e: Experiment }) {
  const m = e.meta
  const hasFrame = m.hypothesis || m.predict || m.because || m.log.length > 0
  return (
    <YStack p="$4" gap="$3">
      {hasFrame ? (
        <>
          {m.hypothesis ? <Section label="Hypothesis" body={m.hypothesis} /> : null}
          {m.predict ? <Section label="Prediction" body={m.predict} /> : null}
          {m.because ? <Section label={m.verdict === 'refuted' ? 'Why refuted' : m.verdict === 'proven' ? 'Why proven' : 'Reasoning'} body={m.because} /> : null}
          {m.log.length ? (
            <YStack gap="$1.5">
              <XStack items="center" gap="$2">
                <ScrollText size={13} />
                <Text fontSize="$1" color="$color10" fontWeight="600">
                  Log
                </Text>
              </XStack>
              <YStack gap="$1" pl="$1">
                {m.log.map((line, i) => (
                  <Text key={i} fontSize="$2" color="$color11" className="mono">
                    {line}
                  </Text>
                ))}
              </YStack>
            </YStack>
          ) : null}
        </>
      ) : (
        <Text fontSize="$2" color="$color10">
          No scientific frame recorded for this run — a measured result without a stated hypothesis.
        </Text>
      )}

      {/* Provenance footer — real facts only, each omitted when absent. */}
      <XStack gap="$4" flexWrap="wrap" pt="$1">
        {e.metric ? <Fact label="Metric" value={`${e.metric} = ${fmtValue(e.value)}`} /> : null}
        {e.n > 0 ? <Fact label="Scored" value={e.nTotal > 0 ? `${fmtCount(e.n)} / ${fmtCount(e.nTotal)}` : fmtCount(e.n)} /> : null}
        {m.host ? <Fact label="Host" value={m.host} /> : null}
        {e.ts > 0 ? <Fact label="Latest run" value={fmtDate(e.ts)} /> : null}
        {e.endpoint ? <Fact label="Endpoint" value={e.endpoint} /> : null}
        {m.doc ? <Fact label="Doc" value={m.doc} /> : null}
      </XStack>
    </YStack>
  )
}

function Section({ label, body }: { label: string; body: string }) {
  return (
    <YStack gap="$1">
      <Text fontSize="$1" color="$color10" fontWeight="600">
        {label}
      </Text>
      <Text fontSize="$3" color="$color12">
        {body}
      </Text>
    </YStack>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <XStack gap="$1.5" items="baseline">
      <Text fontSize="$1" color="$color10">
        {label}
      </Text>
      <Text fontSize="$2" color="$color11" className="mono">
        {value}
      </Text>
    </XStack>
  )
}
