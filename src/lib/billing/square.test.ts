import { describe, it, expect } from 'vitest'

import {
  squareSdkUrl,
  isLiveSquareEnv,
  dollarsToCents,
  validateTopupCents,
  MIN_TOPUP_CENTS,
  MAX_TOPUP_CENTS,
} from './square'

describe('squareSdkUrl — fail-safe to sandbox', () => {
  it('loads the production SDK only for an explicit "production"', () => {
    expect(squareSdkUrl('production')).toBe('https://web.squarecdn.com/v1/square.js')
  })
  it('loads the sandbox SDK for sandbox', () => {
    expect(squareSdkUrl('sandbox')).toBe('https://sandbox.web.squarecdn.com/v1/square.js')
  })
  it('loads the sandbox SDK for anything unrecognized (never a live tokenizer by accident)', () => {
    for (const env of ['', 'prod', 'Production', 'test', 'typo']) {
      expect(squareSdkUrl(env)).toBe('https://sandbox.web.squarecdn.com/v1/square.js')
    }
  })
})

describe('isLiveSquareEnv', () => {
  it('is live only for production', () => {
    expect(isLiveSquareEnv('production')).toBe(true)
    expect(isLiveSquareEnv('sandbox')).toBe(false)
    expect(isLiveSquareEnv('')).toBe(false)
  })
})

describe('dollarsToCents — clean money parsing', () => {
  it('parses integers and decimals to cents', () => {
    expect(dollarsToCents('25')).toBe(2500)
    expect(dollarsToCents('25.5')).toBe(2550)
    expect(dollarsToCents('25.00')).toBe(2500)
    expect(dollarsToCents('0.50')).toBe(50)
    expect(dollarsToCents('1000')).toBe(100000)
  })
  it('tolerates $, commas, and whitespace', () => {
    expect(dollarsToCents(' $25.00 ')).toBe(2500)
    expect(dollarsToCents('1,000')).toBe(100000)
  })
  it('rejects non-money / sub-cent / non-positive input', () => {
    for (const bad of ['', 'abc', '-5', '1.234', '.', '$', '5.', 'NaN', '1e3']) {
      expect(dollarsToCents(bad)).toBeNull()
    }
    expect(dollarsToCents('0')).toBeNull()
    expect(dollarsToCents('0.00')).toBeNull()
  })
})

describe('validateTopupCents — bounds', () => {
  it('accepts an in-range amount', () => {
    expect(validateTopupCents(2500)).toBeNull()
    expect(validateTopupCents(MIN_TOPUP_CENTS)).toBeNull()
    expect(validateTopupCents(MAX_TOPUP_CENTS)).toBeNull()
  })
  it('rejects below the minimum', () => {
    expect(validateTopupCents(MIN_TOPUP_CENTS - 1)).toMatch(/Minimum/)
    expect(validateTopupCents(50)).toMatch(/Minimum/)
  })
  it('rejects above the maximum', () => {
    expect(validateTopupCents(MAX_TOPUP_CENTS + 1)).toMatch(/Maximum/)
  })
  it('rejects non-positive / non-integer', () => {
    expect(validateTopupCents(0)).toMatch(/valid/)
    expect(validateTopupCents(-100)).toMatch(/valid/)
    expect(validateTopupCents(10.5)).toMatch(/valid/)
  })
})
