import { describe, expect, it } from 'vitest'
import { fmtValue } from './research-fmt'

// fmtValue renders a research aggregate on a board whose premise is "every figure is a
// real measured value" — so it must never corrupt a number. The regression: at abs>=100
// toFixed(0) yields a dotless integer string and a naive trailing-zero trim ate its real
// zeros (150.4 -> "150" -> "15", 100x wrong at 1000.4).
describe('fmtValue', () => {
  it('does NOT eat integer trailing zeros on non-integer values >= 100', () => {
    expect(fmtValue(150.4)).toBe('150')
    expect(fmtValue(200.3)).toBe('200')
    expect(fmtValue(1000.4)).toBe('1,000')
    expect(fmtValue(100.4)).toBe('100')
    expect(fmtValue(250.4)).toBe('250')
  })
  it('keeps the current kernel-perf corpus unchanged', () => {
    expect(fmtValue(1.022)).toBe('1.022')
    expect(fmtValue(14)).toBe('14') // integer path
    expect(fmtValue(0.79)).toBe('0.79')
    expect(fmtValue(4.55)).toBe('4.55')
  })
  it('degrades non-finite safely', () => {
    expect(fmtValue(NaN)).toBe('—')
    expect(fmtValue(Infinity)).toBe('—')
  })
})
