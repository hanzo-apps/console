import { describe, it, expect } from 'vitest'
import { toCSV } from './csv'

describe('toCSV — RFC 4180', () => {
  it('emits a header + rows, CRLF-joined', () => {
    const csv = toCSV(['a', 'b'], [[1, 2], [3, 4]])
    expect(csv).toBe('a,b\r\n1,2\r\n3,4')
  })

  it('quotes fields containing a comma, quote, or newline; doubles internal quotes', () => {
    const csv = toCSV(['name', 'note'], [['Doe, Jane', 'she said "hi"'], ['multi\nline', 'plain']])
    expect(csv).toBe('name,note\r\n"Doe, Jane","she said ""hi"""\r\n"multi\nline",plain')
  })

  it('renders null/undefined as empty and never truncates a long row', () => {
    const csv = toCSV(['a', 'b'], [[null, undefined], [1, 2, 3]])
    expect(csv).toBe('a,b\r\n,\r\n1,2,3')
  })

  it('pads a short row to the header width', () => {
    const csv = toCSV(['a', 'b', 'c'], [[1]])
    expect(csv).toBe('a,b,c\r\n1,,')
  })

  it('leaves a bare value bare (no gratuitous quoting)', () => {
    expect(toCSV(['x'], [['plain-value']])).toBe('x\r\nplain-value')
  })
})
