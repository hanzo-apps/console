import { describe, it, expect } from 'vitest'
import { envelopeTotal } from './client'

/**
 * The ONE count read for the `{status,msg,data,total}` envelope: named `total`
 * first, legacy Casdoor `data2` second, the rows themselves last. Every list
 * reader (getList, iamList, makeIamClient, AuditApi) goes through this.
 */
describe('envelopeTotal — total, then data2, then rows', () => {
  it('prefers the named total over data2 and the rows', () => {
    expect(envelopeTotal({ total: 9, data2: 7 }, [1])).toBe(9)
    expect(envelopeTotal({ total: 0, data2: 7 }, [1])).toBe(0)
  })

  it('falls back to a numeric data2 while legacy emitters remain', () => {
    expect(envelopeTotal({ data2: 7 }, [1])).toBe(7)
    expect(envelopeTotal({ data2: 0 }, [1, 2])).toBe(0)
  })

  it('falls back to the rows when neither field is a number', () => {
    expect(envelopeTotal({}, [1, 2])).toBe(2)
    expect(envelopeTotal({ total: '9', data2: null }, [1, 2])).toBe(2)
    expect(envelopeTotal({}, undefined)).toBe(0)
  })
})
