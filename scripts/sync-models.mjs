#!/usr/bin/env node
/**
 * sync-models — regenerate `src/lib/api/catalog.data.json` from the enso-bench
 * `priors/openrouter_models.json` prior.
 *
 * WHY A CHECKED-IN FIXTURE (the data decision). The model catalog the console browses
 * must be complete and available even when the live gateway is unreachable — a browse
 * surface that blanks on a backend roll is a worse experience than a stale-but-honest
 * one. The openrouter prior is a VERSIONED ARTEFACT (it changes when a catalog sync
 * lands in hanzoai/enso-bench, not per request), so like `benchmarks.data.json` it is
 * checked in and imported at BUILD TIME. `aicatalog.fetchCatalog` uses it as the
 * guaranteed base and overlays the LIVE gateway (`/v1/models` availability + the
 * current Zen family, `/v1/pricing/models` fresh pricing) on top when reachable — so
 * the console always has a browsable ~400-model catalog, and live data always wins
 * where it exists. Nothing here is fabricated: every field is copied from the prior.
 *
 * Each catalog row is projected onto the console's `RichModel` shape (id · name ·
 * provider · contextWindow · pricing in/out/cache · isFree · capability features).
 * Capabilities are read from the prior's own flags (`accepts_image` → Vision, etc.),
 * never guessed. No description is emitted (the prior carries none — an em-dash beats a
 * fabricated blurb).
 *
 * Input: ENSO_BENCH/priors/openrouter_models.json (ENSO_BENCH default ../enso-bench).
 * Usage: node scripts/sync-models.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const bench = process.env.ENSO_BENCH ?? resolve(here, '../../enso-bench')
const out = resolve(here, '../src/lib/api/catalog.data.json')

/** Fail loudly: a silently-empty fixture would render an empty catalog as if the prior
 *  were genuinely empty, exactly the fabrication we refuse. */
const assert = (cond, msg) => {
  if (!cond) {
    console.error(`sync-models: ${msg}`)
    process.exit(1)
  }
}

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined)

const src = JSON.parse(readFileSync(resolve(bench, 'priors/openrouter_models.json'), 'utf8'))
assert(Array.isArray(src.models) && src.models.length > 0, 'openrouter_models.json has no models')

const models = src.models.map((m) => {
  // Capability tags from the prior's OWN flags — drives the Vision badge (supportsVision
  // reads `features`) and the detail-panel feature chips. Never inferred beyond the flag.
  const features = []
  if (m.accepts_image) features.push('Vision')
  if (m.accepts_audio) features.push('Audio')
  if (m.accepts_video) features.push('Video')
  if (m.supports_tools) features.push('Tools')
  if (m.supports_reasoning) features.push('Reasoning')
  if (m.supports_structured_outputs) features.push('Structured output')

  const pricing = {}
  const pin = num(m.price_in_per_mtok)
  const pout = num(m.price_out_per_mtok)
  const cr = num(m.price_cache_read_per_mtok)
  const cw = num(m.price_cache_write_per_mtok)
  if (pin !== undefined) pricing.input = pin
  if (pout !== undefined) pricing.output = pout
  if (cr !== undefined) pricing.cacheRead = cr
  if (cw !== undefined) pricing.cacheWrite = cw

  const row = {
    id: m.id,
    name: m.name ?? m.id,
    // The vendor slug (`openai`, `ai21`, …) — the id-first brand resolver keys off the
    // model id, so this is a fallback vendor tell for the family/logo + a display label.
    provider: m.vendor ?? undefined,
    contextWindow: num(m.context_length) ?? num(m.provider_context_length),
  }
  if (Object.keys(pricing).length) row.pricing = pricing
  if (features.length) row.features = features
  if (m.is_free === true) row.isFree = true
  return row
})

const data = {
  source: 'hanzoai/enso-bench priors/openrouter_models.json',
  count: models.length,
  models,
}

writeFileSync(out, `${JSON.stringify(data, null, 2)}\n`)
console.log(`sync-models: ${models.length} models → ${out}`)
