#!/usr/bin/env node
/**
 * sync-benchmarks — regenerate `src/lib/api/benchmarks.data.json` from the
 * enso-bench prior corpus.
 *
 * The benchmark corpus is a VERSIONED ARTEFACT, not live state: it changes when a
 * bench run lands in hanzoai/enso-bench, not per request. So it is checked in as a
 * fixture and imported at build time — the leaderboard renders with no network, no
 * endpoint, no loading state, and every number keeps the `source` string the corpus
 * carries. `src/lib/api/benchmarks.ts` is the ONE reader.
 *
 * Two inputs, both from the enso-bench checkout (ENSO_BENCH, default ../enso-bench):
 *   • priors/leaderboard.json — the scored corpus (per model: vendor + per-benchmark
 *     {value, source}). Already JSON, consumed as-is.
 *   • harness/arms.py CATALOG — the (canonical, gateway_model_id) alias pairs, so a
 *     LIVE gateway model id ("openai-gpt-5.2") can find its corpus row ("gpt-5.2").
 *
 * Keys are copied RAW. Normalizing/indexing is the reader's job (`normalizeModelKey`
 * in benchmarks.ts) so there is exactly one implementation of the join.
 *
 * Usage: node scripts/sync-benchmarks.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const bench = process.env.ENSO_BENCH ?? resolve(here, '../../enso-bench')
const out = resolve(here, '../src/lib/api/benchmarks.data.json')

/** Fail loudly: a silently-empty fixture would render an empty leaderboard as if the
 *  corpus were genuinely empty, which is exactly the fabrication we refuse. */
const assert = (cond, msg) => {
  if (!cond) {
    console.error(`sync-benchmarks: ${msg}`)
    process.exit(1)
  }
}

// ── The scored corpus ────────────────────────────────────────────────────────
const board = JSON.parse(readFileSync(resolve(bench, 'priors/leaderboard.json'), 'utf8'))
assert(Array.isArray(board.models) && board.models.length > 0, 'leaderboard.json has no models')
assert(board.benchmarks && Object.keys(board.benchmarks).length > 0, 'leaderboard.json has no benchmarks')

// ── The canonical → gateway-id alias pairs ───────────────────────────────────
// A CATALOG row is ("canonical", "model_id", supports_temp, price_in, price_out[, provider]).
// Only the first two fields matter here; the prices shown in the console come from the
// LIVE gateway catalog, never from this table.
const arms = readFileSync(resolve(bench, 'harness/arms.py'), 'utf8')
const catalog = arms.slice(arms.indexOf('CATALOG = ['), arms.indexOf(']', arms.indexOf('CATALOG = [')))
const aliases = []
for (const m of catalog.matchAll(/\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,/g)) {
  const [, canonical, modelId] = m
  if (canonical !== modelId) aliases.push([modelId, canonical])
}
assert(aliases.length >= 20, `parsed only ${aliases.length} alias pairs from arms.py CATALOG — format changed?`)

const data = {
  source: 'hanzoai/enso-bench priors/leaderboard.json + harness/arms.py',
  benchmarks: board.benchmarks,
  taskBench: board.task_bench ?? {},
  models: board.models,
  aliases,
}

writeFileSync(out, `${JSON.stringify(data, null, 2)}\n`)
console.log(`sync-benchmarks: ${data.models.length} models · ${Object.keys(data.benchmarks).length} benchmarks · ${aliases.length} aliases → ${out}`)
