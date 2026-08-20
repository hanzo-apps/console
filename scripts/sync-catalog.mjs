#!/usr/bin/env node
/**
 * sync-catalog — write the one record of what the platform serves.
 *
 * WHAT A PRODUCT IS has one owner, and it is not this repo. `api.hanzo.ai/v1/openapi.json`
 * is a projection of the routers the platform mounted: a tag in that document exists by
 * construction, the tag IS the `/v1` segment, and its one line is the owning package's own
 * words about itself. This reads it and writes `src/lib/products/served.data.json`. The
 * console renders that record, so the console cannot disagree with the platform about
 * whether a product exists or what it is for.
 *
 * WHAT STAYS IN THE REGISTRY is the half the platform has no opinion about: which module a
 * route renders, the glyph, the order, how finished a surface is. A page that names no
 * served operation is a console-only surface and keeps its own line — the platform never
 * wrote one, so there is nothing here to disagree with.
 *
 * ONE FACT, ONE PLACE, both directions. A row that types a description the platform also
 * publishes is a second copy and fails `--check`. A console-only row that types none has no
 * line at all and fails too. `served.test.ts` asserts the same two things offline, so the
 * pair cannot drift between runs of this script.
 *
 * NEVER FAIL ON AN UNREACHABLE PLATFORM. The console must build with no network; the
 * committed record is the designed answer, and it is read at build time like every other
 * `*.data.json` in this repo. The one exception is having no record at all, because the
 * bundle imports it.
 *
 * NEVER GO QUIET. Every run prints what it read and every disagreement it found. The
 * failure this catalogue actually had was never a wrong list — it was a stale one that
 * nothing announced.
 *
 * Usage:
 *   node scripts/sync-catalog.mjs
 *   node scripts/sync-catalog.mjs --check      # exit 1 on any disagreement
 *   node scripts/sync-catalog.mjs --dry-run
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const RECORD = resolve(here, '../src/lib/products/served.data.json')
const REGISTRY = resolve(here, '../src/lib/products/registry.tsx')
const API = process.env.CATALOG_API ?? 'https://api.hanzo.ai'
const DOCUMENT = `${API}/v1/openapi.json`
const CHECK = process.argv.includes('--check')
const DRY = process.argv.includes('--dry-run')

const VERBS = new Set(['get', 'post', 'put', 'patch', 'delete'])

/**
 * The owning package's synopsis, as a sentence rather than as a doc comment.
 *
 * Go opens a synopsis with the package's own name — "Package iam is …" — which is the
 * convention where it is written and noise where it is read: the name is already the
 * heading above the line. Dropping that opener and raising the next letter is a projection
 * of the one description, not a second one, so the words stay the platform's own.
 */
const prose = (s) => {
  const t = (s ?? '').trim().replace(/^Package\s+\S+\s+is\s+/, '')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/** The document, or the reason it did not arrive — an unreachable platform is a fact,
 *  not an exception, and each caller answers it differently. */
async function read() {
  try {
    const res = await fetch(DOCUMENT, { headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${DOCUMENT}`)
    return { document: await res.json() }
  } catch (e) {
    return { error: e.message }
  }
}

/**
 * Every product the document declares: its prose and how many operations stand behind it.
 * A tag with no operation is not a product — it is a label nobody used — so the count is
 * carried rather than assumed and the zeroes are dropped.
 */
function products(document) {
  const out = new Map()
  for (const t of document?.tags ?? []) out.set(t.name, { description: prose(t.description), operations: 0 })
  for (const item of Object.values(document?.paths ?? {})) {
    for (const [verb, op] of Object.entries(item)) {
      if (!VERBS.has(verb)) continue
      for (const tag of op.tags ?? []) {
        const p = out.get(tag)
        if (p) p.operations += 1
      }
    }
  }
  return new Map([...out].filter(([, p]) => p.operations > 0).sort((a, b) => a[0].localeCompare(b[0])))
}

/**
 * What the shipped registry declares, READ AS SOURCE.
 *
 * The registry cannot be imported outside the bundler (icon ESM), and reading the text is
 * the only way to assert about the file a person edits next — the convention its own tests
 * already follow.
 */
function declared() {
  const src = readFileSync(REGISTRY, 'utf8')
  const rows = []
  for (const block of src.split(/^  \{$/m).slice(1)) {
    const body = block.split(/^  \},?$/m)[0]
    const id = (body.match(/^ {4}id: '([^']+)',$/m) ?? [])[1]
    if (id) rows.push({ id, description: /^ {4}description: /m.test(body) })
  }
  return rows
}

async function main() {
  let record = null
  try {
    record = JSON.parse(readFileSync(RECORD, 'utf8'))
  } catch {
    record = null
  }

  console.log(`sync-catalog: reading ${DOCUMENT}`)
  const { document, error } = await read()
  if (error) {
    // A check that could not read the document compared nothing, and reporting
    // agreement it never observed would be silence from the one thing added to
    // break it. A BUILD keeps the committed record; a CHECK says what it missed.
    if (CHECK) {
      console.error(`sync-catalog: could not read ${DOCUMENT} — ${error}`)
      console.error('sync-catalog: nothing was compared')
      return 1
    }
    if (!record) throw new Error(`no record at ${RECORD} and the platform is unreachable: ${error}`)
    console.warn(`sync-catalog: keeping the committed record — ${error}`)
    return 0
  }

  const served = products(document)
  const rows = declared()
  console.log(
    `sync-catalog: ${served.size} products served · ${rows.length} rows in the registry · ` +
      `${rows.filter((r) => served.has(r.id)).length} of those answer under /v1`,
  )

  const complaints = []

  // A row that types a line the platform also publishes is the second copy this record
  // exists to delete. Named, not counted — each one is a file to edit.
  const copies = rows.filter((r) => r.description && served.get(r.id)?.description)
  if (copies.length) {
    complaints.push(`${copies.length} row(s) type a description the platform publishes: ${copies.map((r) => r.id).join(', ')}`)
  }

  // The other direction: a surface nobody describes renders a blank line. A console-only
  // page must carry its own, and so must a served product whose package wrote none.
  const mute = rows.filter((r) => !r.description && !served.get(r.id)?.description)
  if (mute.length) {
    complaints.push(`${mute.length} row(s) carry no description and the platform publishes none: ${mute.map((r) => r.id).join(', ')}`)
  }

  // Not drift, and not a failure: the platform serves plenty this console has no page for.
  // Printed so the gap is visible where it can be closed.
  const unopened = [...served.keys()].filter((id) => !rows.some((r) => r.id === id))
  console.log(`sync-catalog: ${unopened.length} served products have no console surface — ${unopened.join(' ')}`)

  for (const c of complaints) console.log(`  ${c}`)

  const next = {
    source: DOCUMENT,
    fetched: new Date().toISOString(),
    products: Object.fromEntries(served),
  }

  if (CHECK) {
    // `fetched` is when, not what. Comparing it would report every run as drift.
    const same = (a, b) => JSON.stringify({ ...a, fetched: null }) === JSON.stringify({ ...b, fetched: null })
    if (!same(next, record ?? {})) {
      const stale = `${RECORD} disagrees with the platform — run \`pnpm sync:catalog\``
      complaints.push(stale)
      console.log(`  ${stale}`)
    }
    if (complaints.length) {
      console.error(`sync-catalog: ${complaints.length} disagreement(s)`)
      return 1
    }
    console.log('sync-catalog: the record, the registry and the platform agree')
    return 0
  }

  if (DRY) {
    console.log(`sync-catalog: --dry-run: would write ${RECORD}`)
    return 0
  }

  writeFileSync(RECORD, JSON.stringify(next, null, 2) + '\n')
  console.log(`sync-catalog: wrote ${RECORD}`)
  return 0
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`sync-catalog: ${err.message}`)
    process.exit(1)
  })
