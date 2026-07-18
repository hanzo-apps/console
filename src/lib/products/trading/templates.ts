/**
 * Trading bot app-templates — the deployable-app DEFINITIONS the Trading module's
 * deploy form renders, and the ONE place that maps a filled config → a PaaS
 * `CreateAppInput`. Pure + dependency-free (no React, no I/O) so the schema and
 * the env mapping are unit-tested in isolation (templates.test.ts).
 *
 * A "template" is a bot the console can deploy on the Hanzo PaaS as an ordinary
 * git app: the PaaS BuildKit builds the repo's Dockerfile → GHCR → deploys it
 * per-org. There is NO new deploy system — the template is a typed config SCHEMA
 * plus the pure `toCreateAppInput` that turns the user's answers into the exact
 * `{ source:'git', repo, port, env }` the existing `PaasApi.createApp` already
 * takes. One way to deploy (the PaaS); the template just shapes the config.
 *
 * Both bots are 12-factor (every knob is an env var), so the schema is a list of
 * typed FIELDS and the mapping is `field.env = <value>`. The maker's signer key is
 * NEVER a form field — it is a KMS secret reference (an env var whose VALUE the
 * user leaves to a KMSSecret sync, never typed into the browser).
 */

/** A configurable field the deploy form renders. `env` is the container env var it sets. */
export interface BotConfigField {
  /** Stable field key (also the form control id). */
  key: string
  /** Container env var this field sets (12-factor). */
  env: string
  /** Human label. */
  label: string
  /** One-line help under the control. */
  help: string
  /** Control kind — `select` renders `options`; `secretRef` is a KMS key name, never a typed value. */
  kind: 'text' | 'number' | 'duration' | 'select' | 'secretRef'
  /** Default value (the network overlay's proven default where one exists). */
  default: string
  /** For `select`. */
  options?: { value: string; label: string }[]
  /** Whether the field must be non-empty to deploy. */
  required?: boolean
}

/** A network a bot can be deployed against — the RPC + market defaults per env. */
export interface BotNetwork {
  /** Stable id, aligned with the node-network ids (lux-mainnet/testnet/devnet). */
  id: string
  label: string
  /** Comma-separated in-cluster C-Chain RPC endpoints (COHERENCE_RPC / LUX_RPC). */
  rpc: string
  /** The proven COHERENCE_MARKETS spec for this network (the deploy-form default). */
  markets: string
  /** Whether real value is at risk (mainnet) — the form warns and defaults probe OFF. */
  mainnet?: boolean
}

/** A deployable bot template — image, build source, port, config schema, networks. */
export interface BotTemplate {
  /** Stable template id (also the deploy-form route + the app-name prefix). */
  id: 'market-maker' | 'trader'
  label: string
  description: string
  /** GitHub repo the PaaS BuildKit builds (owner/name). */
  repo: string
  /** The image the build publishes (documentation + the drift check). */
  image: string
  /** Dockerfile path in the repo (BuildKit context). */
  dockerfile: string
  /** The container port to expose (the maker's :2112 metrics; 0 = no server). */
  port: number
  /** Env vars set on EVERY deploy of this template, before the user's fields. */
  fixedEnv: { key: string; value: string }[]
  /** Networks the bot can target (RPC + market defaults per env). */
  networks: BotNetwork[]
  /** The user-configurable fields (rendered as the deploy form). */
  fields: BotConfigField[]
  /**
   * True when the bot exposes a Prometheus `/metrics` + `/healthz` server on `port`
   * (drives whether the console shows a live status view or an honest "no metrics
   * endpoint" note). The maker does; the trader CLI does not.
   */
  hasMetrics: boolean
}

// The proven testnet/mainnet market specs (from k8s/coherence/{testnet,mainnet}) —
// the deploy-form defaults so a one-click testnet deploy is correct out of the box.
const LUX_TESTNET_RPC =
  'http://luxd-0.luxd-headless.lux-testnet.svc:9640/v1/bc/C/rpc,http://luxd-1.luxd-headless.lux-testnet.svc:9640/v1/bc/C/rpc,http://luxd-2.luxd-headless.lux-testnet.svc:9640/v1/bc/C/rpc'
const LUX_MAINNET_RPC =
  'http://luxd-0.luxd-headless.lux-mainnet.svc:9630/v1/bc/C/rpc,http://luxd-1.luxd-headless.lux-mainnet.svc:9630/v1/bc/C/rpc,http://luxd-2.luxd-headless.lux-mainnet.svc:9630/v1/bc/C/rpc'
// The live testnet L*/LUX ratio markets (LETH/LBTC/LSOL priced base/USD ÷ 12.5 LUX/USD).
const LUX_TESTNET_MARKETS =
  'LETH/LUX=ratio:ETHUSD/12.5:0xD785C18B7FaBD72D9A0417a5b7834DD79d5a47E3:0x5Ee3C2607C926f24F590Ec895Ac8B8e6D2c84525,LBTC/LUX=ratio:XBTUSD/12.5:0x24aa1c80a31935B3577882cB28c3e3CdBbB91582:0x5Ee3C2607C926f24F590Ec895Ac8B8e6D2c84525,LSOL/LUX=ratio:SOLUSD/12.5:0x3542F2DE1fD9015c0095D09C20ee8d40C754f5DF:0x5Ee3C2607C926f24F590Ec895Ac8B8e6D2c84525'

/** The market-maker networks — the same node networks the Nodes surface reports on. */
const MAKER_NETWORKS: BotNetwork[] = [
  { id: 'lux-testnet', label: 'Lux Testnet', rpc: LUX_TESTNET_RPC, markets: LUX_TESTNET_MARKETS },
  {
    // Mainnet markets are gated (real ERC-20 addresses supplied at go-live) — the
    // default is empty so a mainnet deploy MUST fill real addresses (never a throwaway).
    id: 'lux-mainnet',
    label: 'Lux Mainnet',
    rpc: LUX_MAINNET_RPC,
    markets: '',
    mainnet: true,
  },
]

/**
 * The market-maker (`ghcr.io/luxfi/maker`, `MAKER_MODE=coherence`) — the continuous
 * Kraken-oracle maker that pegs a 2-sided book to the live CEX mid for each market
 * and requotes every interval. Exposes Prometheus metrics + /healthz on :2112.
 */
export const MAKER_TEMPLATE: BotTemplate = {
  id: 'market-maker',
  label: 'Market Maker',
  description:
    'Continuous Kraken-oracle market maker — pegs a 2-sided book to the live CEX mid per market and requotes on a fixed cadence. Exposes live peg-error metrics on :2112.',
  repo: 'luxfi/maker',
  image: 'ghcr.io/luxfi/maker',
  dockerfile: './Dockerfile',
  port: 2112,
  hasMetrics: true,
  fixedEnv: [
    { key: 'MAKER_MODE', value: 'coherence' },
    { key: 'COHERENCE_METRICS_ADDR', value: ':2112' },
  ],
  networks: MAKER_NETWORKS,
  fields: [
    {
      key: 'markets',
      env: 'COHERENCE_MARKETS',
      label: 'Markets',
      help: 'SYMBOL=SOURCE:BASE:QUOTE per market (a Kraken pair, fixed:<price>, or ratio:<pair>/<denom>). Defaults to this network’s live L*/LUX markets.',
      kind: 'text',
      default: '',
      required: true,
    },
    {
      key: 'spreadBps',
      env: 'COHERENCE_SPREAD_BPS',
      label: 'Spread (bps)',
      help: 'Half-spread each side in basis points. The book mid tracks Kraken; this is the maker’s income band.',
      kind: 'number',
      default: '10',
    },
    {
      key: 'requote',
      env: 'COHERENCE_REQUOTE',
      label: 'Requote interval',
      help: 'Book re-peg cadence (study optimum 60–120s).',
      kind: 'duration',
      default: '90s',
    },
    {
      key: 'arbBandBps',
      env: 'COHERENCE_ARB_BAND_BPS',
      label: 'Arb band (bps)',
      help: 'Corrective arb fires when the book mid drifts past this many bps from Kraken (0 = use the spread).',
      kind: 'number',
      default: '10',
    },
    {
      key: 'probe',
      env: 'COHERENCE_PROBE',
      label: 'Taker probe',
      help: 'Probe-taker cadence for realized-price measurement (0s = off; ALWAYS off on mainnet — never wash-trade real flow).',
      kind: 'duration',
      default: '0s',
    },
    {
      // The signer key is NEVER a typed field — it is a KMS-synced env var. The
      // form shows the KMS key name and leaves the value to a KMSSecret sync.
      key: 'makerKeyRef',
      env: 'COHERENCE_MAKER_KEY',
      label: 'Maker signer key (KMS ref)',
      help: 'The treasury/maker signer — supplied by a KMSSecret sync, NEVER typed here. Provision it in KMS and reference the synced env var.',
      kind: 'secretRef',
      default: 'COHERENCE_MAKER_KEY',
    },
  ],
}

/** The trader networks — same env split; the trader is net-agnostic over LUX_RPC. */
const TRADER_NETWORKS: BotNetwork[] = [
  { id: 'lux-testnet', label: 'Lux Testnet', rpc: LUX_TESTNET_RPC, markets: '' },
  { id: 'lux-mainnet', label: 'Lux Mainnet', rpc: LUX_MAINNET_RPC, markets: '', mainnet: true },
]

/**
 * The trader (`ghcr.io/luxfi/trader`) — the net-agnostic 0x9999 maker/taker/bot that
 * drives the V4 money path against any Lux EVM C-Chain. Runs the `bot` command
 * (sporadic two-sided flow on an existing market). It is a CLI bot with NO metrics
 * server, so the console shows deployment health only (honest "no metrics endpoint").
 */
export const TRADER_TEMPLATE: BotTemplate = {
  id: 'trader',
  label: 'Trader',
  description:
    'Net-agnostic 0x9999 trading bot — drives sporadic two-sided flow on a market to exercise the book. A CLI bot (no metrics server); the console shows deployment health.',
  repo: 'luxfi/trader',
  image: 'ghcr.io/luxfi/trader',
  dockerfile: './Dockerfile',
  port: 0,
  hasMetrics: false,
  // The trader takes its command + pair as ARGS, not env, so the fixed args run the
  // `bot` subcommand; base/quote are set as flags via TRADER_ARGS the entrypoint reads.
  fixedEnv: [],
  networks: TRADER_NETWORKS,
  fields: [
    {
      key: 'base',
      env: 'TRADER_BASE',
      label: 'Base token',
      help: 'Base token (currency0) ERC-20 address of the market to trade.',
      kind: 'text',
      default: '',
      required: true,
    },
    {
      key: 'quote',
      env: 'TRADER_QUOTE',
      label: 'Quote token',
      help: 'Quote token (currency1) ERC-20 address of the market to trade.',
      kind: 'text',
      default: '',
      required: true,
    },
    {
      key: 'rounds',
      env: 'TRADER_ROUNDS',
      label: 'Rounds',
      help: 'Number of bot rounds (0 = run until stopped).',
      kind: 'number',
      default: '0',
    },
    {
      key: 'mnemonicRef',
      env: 'LUX_MNEMONIC',
      label: 'Signer mnemonic (KMS ref)',
      help: 'The BIP-39 mnemonic that derives the funded maker/taker accounts — supplied by a KMSSecret sync, NEVER typed here.',
      kind: 'secretRef',
      default: 'LUX_MNEMONIC',
    },
  ],
}

/** Every deployable bot template, in display order. */
export const BOT_TEMPLATES: BotTemplate[] = [MAKER_TEMPLATE, TRADER_TEMPLATE]

/** Look up a bot template by id. */
export const findBotTemplate = (id: string): BotTemplate | undefined =>
  BOT_TEMPLATES.find((t) => t.id === id)

/** The env var names a template's image reads that identify it as a bot of this kind. */

/**
 * True when a deployed app (by its image repository) is an instance of a bot
 * template — the filter the Trading module uses to pick bots out of the org's
 * whole PaaS app fleet. Matches on the image REPO (registry-agnostic tag/digest).
 */
export function isBotApp(imageRepository: string | undefined, t: BotTemplate): boolean {
  const repo = (imageRepository ?? '').trim().toLowerCase()
  if (!repo) return false
  const want = t.image.toLowerCase()
  return repo === want || repo.startsWith(want + ':') || repo.startsWith(want + '@')
}

/** Which template a deployed app's image matches, or undefined. */
export function templateForImage(imageRepository: string | undefined): BotTemplate | undefined {
  return BOT_TEMPLATES.find((t) => isBotApp(imageRepository, t))
}

// ── Deploy config → PaaS CreateAppInput ──────────────────────────────────────

/** The env pair shape the PaaS `CreateAppInput` takes (mirrors `PaasEnvVar`). */
export interface DeployEnvVar {
  key: string
  value: string
  secret?: boolean
}

/** The subset of `CreateAppInput` the trading deploy produces (git BuildKit app). */
export interface BotCreateAppInput {
  name: string
  slug: string
  description: string
  environment: string
  source: 'git'
  repo: { url: string; branch?: string }
  buildType: 'dockerfile'
  port?: number
  replicas: number
  env: DeployEnvVar[]
}

/** A slug-safe segment (lowercase, hyphenated, no leading/trailing hyphen). */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

/** The user's answers: the chosen network id + a value per field key. */
export interface BotDeployValues {
  network: string
  /** field.key -> value (a secretRef field's value is IGNORED — never sent). */
  values: Record<string, string>
  /** Optional custom app name; defaults to `<template.id>-<network>`. */
  name?: string
}

/** Validation problems, empty when the config is deployable. */
export function validateBotDeploy(t: BotTemplate, v: BotDeployValues): string[] {
  const errs: string[] = []
  const net = t.networks.find((n) => n.id === v.network)
  if (!net) {
    errs.push('Select a network.')
    return errs
  }
  for (const f of t.fields) {
    if (f.kind === 'secretRef') continue // supplied by KMS, never validated here
    const val = (v.values[f.key] ?? '').trim()
    if (f.required && !val) errs.push(`${f.label} is required.`)
  }
  return errs
}

/**
 * Map a template + the user's answers to the PaaS `CreateAppInput` — the ONE place
 * config becomes a deploy. Pure: the network sets COHERENCE_RPC (+ default markets),
 * every non-secret field sets its env var, and a `secretRef` field is DROPPED (its
 * value rides a KMSSecret sync, never the deploy body). The app is a git app the
 * PaaS BuildKit builds from the template's repo/Dockerfile → GHCR → deploys.
 */
export function toCreateAppInput(t: BotTemplate, v: BotDeployValues): BotCreateAppInput {
  const net = t.networks.find((n) => n.id === v.network)
  if (!net) throw new Error(`unknown network ${v.network}`)

  const name = (v.name?.trim() || `${t.id}-${net.id}`).trim()
  const slug = slugify(name)

  const env: DeployEnvVar[] = [...t.fixedEnv.map((e) => ({ key: e.key, value: e.value }))]

  // The RPC always comes from the chosen network (the in-cluster luxd endpoints).
  if (t.id === 'market-maker') env.push({ key: 'COHERENCE_RPC', value: net.rpc })
  else env.push({ key: 'LUX_RPC', value: net.rpc })

  for (const f of t.fields) {
    if (f.kind === 'secretRef') continue // KMS-synced; never in the deploy body
    let val = (v.values[f.key] ?? '').trim()
    // Markets default to the network's proven spec when the user left it blank.
    if (t.id === 'market-maker' && f.env === 'COHERENCE_MARKETS' && !val) val = net.markets
    if (val) env.push({ key: f.env, value: val })
  }

  return {
    name,
    slug,
    description: `${t.label} · ${net.label}`,
    environment: net.id.includes('mainnet') ? 'production' : 'staging',
    source: 'git',
    repo: { url: `https://github.com/${t.repo}.git`, branch: 'main' },
    buildType: 'dockerfile',
    port: t.port > 0 ? t.port : undefined,
    replicas: 1, // singleton: two makers/traders on one account would fight the book
    env,
  }
}
