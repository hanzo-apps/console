import { describe, it, expect } from 'vitest'

import {
  MAKER_TEMPLATE,
  TRADER_TEMPLATE,
  BOT_TEMPLATES,
  findBotTemplate,
  isBotApp,
  templateForImage,
  slugify,
  validateBotDeploy,
  toCreateAppInput,
  type BotDeployValues,
} from './templates'

describe('bot templates — the deployable-app definitions', () => {
  it('exposes exactly the maker + trader templates', () => {
    expect(BOT_TEMPLATES.map((t) => t.id)).toEqual(['market-maker', 'trader'])
    expect(findBotTemplate('market-maker')).toBe(MAKER_TEMPLATE)
    expect(findBotTemplate('trader')).toBe(TRADER_TEMPLATE)
    expect(findBotTemplate('nope')).toBeUndefined()
  })

  it('maker builds ghcr.io/luxfi/maker with a metrics port and coherence mode', () => {
    expect(MAKER_TEMPLATE.repo).toBe('luxfi/maker')
    expect(MAKER_TEMPLATE.image).toBe('ghcr.io/luxfi/maker')
    expect(MAKER_TEMPLATE.port).toBe(2112)
    expect(MAKER_TEMPLATE.hasMetrics).toBe(true)
    expect(MAKER_TEMPLATE.fixedEnv).toContainEqual({ key: 'MAKER_MODE', value: 'coherence' })
  })

  it('trader has no metrics endpoint (CLI bot)', () => {
    expect(TRADER_TEMPLATE.image).toBe('ghcr.io/luxfi/trader')
    expect(TRADER_TEMPLATE.hasMetrics).toBe(false)
    expect(TRADER_TEMPLATE.port).toBe(0)
  })

  it('a signer field is a secretRef — never a typed value', () => {
    const makerKey = MAKER_TEMPLATE.fields.find((f) => f.env === 'COHERENCE_MAKER_KEY')
    expect(makerKey?.kind).toBe('secretRef')
    const traderMn = TRADER_TEMPLATE.fields.find((f) => f.env === 'LUX_MNEMONIC')
    expect(traderMn?.kind).toBe('secretRef')
  })
})

describe('isBotApp / templateForImage — pick bots out of the app fleet', () => {
  it('matches by image repo (tag/digest agnostic)', () => {
    expect(isBotApp('ghcr.io/luxfi/maker', MAKER_TEMPLATE)).toBe(true)
    expect(isBotApp('ghcr.io/luxfi/maker:v1.2.3', MAKER_TEMPLATE)).toBe(true)
    expect(isBotApp('ghcr.io/luxfi/maker@sha256:abc', MAKER_TEMPLATE)).toBe(true)
    expect(isBotApp('ghcr.io/luxfi/trader', MAKER_TEMPLATE)).toBe(false)
    expect(isBotApp('', MAKER_TEMPLATE)).toBe(false)
    expect(isBotApp(undefined, MAKER_TEMPLATE)).toBe(false)
  })

  it('resolves a template from an image repo', () => {
    expect(templateForImage('ghcr.io/luxfi/maker:v1')?.id).toBe('market-maker')
    expect(templateForImage('ghcr.io/luxfi/trader')?.id).toBe('trader')
    expect(templateForImage('ghcr.io/hanzoai/bot')).toBeUndefined()
  })
})

describe('slugify', () => {
  it('lowercases, hyphenates, trims', () => {
    expect(slugify('Market Maker · Testnet')).toBe('market-maker-testnet')
    expect(slugify('  --Weird__Name!!  ')).toBe('weird-name')
  })
})

describe('validateBotDeploy', () => {
  it('requires a valid network', () => {
    expect(validateBotDeploy(MAKER_TEMPLATE, { network: 'nope', values: {} })).toContain('Select a network.')
  })

  it('requires the required non-secret fields', () => {
    const errs = validateBotDeploy(MAKER_TEMPLATE, { network: 'lux-testnet', values: {} })
    // COHERENCE_MARKETS is required and empty here.
    expect(errs.some((e) => /Markets/i.test(e))).toBe(true)
  })

  it('does not require secretRef fields (KMS-supplied)', () => {
    const v: BotDeployValues = { network: 'lux-testnet', values: { markets: 'ETH/USD=ETHUSD:0xA:0xB' } }
    expect(validateBotDeploy(MAKER_TEMPLATE, v)).toEqual([])
  })
})

describe('toCreateAppInput — config → PaaS git app', () => {
  it('maps maker fields → env, sets RPC from the network, defaults markets', () => {
    const v: BotDeployValues = { network: 'lux-testnet', values: { spreadBps: '15', requote: '60s' } }
    const input = toCreateAppInput(MAKER_TEMPLATE, v)
    expect(input.source).toBe('git')
    expect(input.repo.url).toBe('https://github.com/luxfi/maker.git')
    expect(input.buildType).toBe('dockerfile')
    expect(input.port).toBe(2112)
    expect(input.replicas).toBe(1)
    const env = Object.fromEntries(input.env.map((e) => [e.key, e.value]))
    expect(env.MAKER_MODE).toBe('coherence')
    expect(env.COHERENCE_METRICS_ADDR).toBe(':2112')
    expect(env.COHERENCE_RPC).toContain('lux-testnet.svc')
    expect(env.COHERENCE_SPREAD_BPS).toBe('15')
    expect(env.COHERENCE_REQUOTE).toBe('60s')
    // markets defaulted to the network's proven spec (user left it blank)
    expect(env.COHERENCE_MARKETS).toContain('LETH/LUX=ratio:ETHUSD/12.5')
  })

  it('NEVER puts a secretRef value in the deploy body', () => {
    const v: BotDeployValues = { network: 'lux-testnet', values: { markets: 'ETH/USD=ETHUSD:0xA:0xB', makerKeyRef: 'hunter2-should-be-dropped' } }
    const input = toCreateAppInput(MAKER_TEMPLATE, v)
    const env = Object.fromEntries(input.env.map((e) => [e.key, e.value]))
    // The secretRef env key is NOT set from the form (it rides a KMSSecret sync).
    expect(env.COHERENCE_MAKER_KEY).toBeUndefined()
    // And the typed value never leaks into ANY env value.
    expect(input.env.some((e) => e.value.includes('hunter2'))).toBe(false)
  })

  it('honors a custom markets spec over the default', () => {
    const v: BotDeployValues = { network: 'lux-testnet', values: { markets: 'LUX/USD=fixed:12.5:0xL:0xU' } }
    const env = Object.fromEntries(toCreateAppInput(MAKER_TEMPLATE, v).env.map((e) => [e.key, e.value]))
    expect(env.COHERENCE_MARKETS).toBe('LUX/USD=fixed:12.5:0xL:0xU')
  })

  it('maps trader fields → env with LUX_RPC and mainnet→production', () => {
    const v: BotDeployValues = { network: 'lux-mainnet', values: { base: '0xBASE', quote: '0xQUOTE', rounds: '5' } }
    const input = toCreateAppInput(TRADER_TEMPLATE, v)
    expect(input.environment).toBe('production')
    expect(input.port).toBeUndefined() // no metrics server
    const env = Object.fromEntries(input.env.map((e) => [e.key, e.value]))
    expect(env.LUX_RPC).toContain('lux-mainnet.svc')
    expect(env.TRADER_BASE).toBe('0xBASE')
    expect(env.TRADER_QUOTE).toBe('0xQUOTE')
    expect(env.TRADER_ROUNDS).toBe('5')
    expect(env.LUX_MNEMONIC).toBeUndefined() // secretRef never in body
  })

  it('names the app <template>-<network> by default and slugifies', () => {
    const input = toCreateAppInput(MAKER_TEMPLATE, { network: 'lux-testnet', values: { markets: 'x=y:0xA:0xB' } })
    expect(input.name).toBe('market-maker-lux-testnet')
    expect(input.slug).toBe('market-maker-lux-testnet')
  })
})
