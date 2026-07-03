import { describe, it, expect } from 'vitest'
import { normalizeAccount, normalizeItem, normalizeSalesOrder, ERP_IMAGE } from './erp'

describe('erp normalizers — bind to the REAL erpnext v15 DocType field names', () => {
  it('normalizeAccount reads the Account DocType (account_name/root_type/account_type/account_currency)', () => {
    const a = normalizeAccount({ name: 'Cash - HC', account_name: 'Cash', root_type: 'Asset', account_type: 'Cash', account_currency: 'USD' })
    expect(a.name).toBe('Cash - HC')
    expect(a.accountName).toBe('Cash')
    expect(a.rootType).toBe('Asset')
    expect(a.accountType).toBe('Cash')
    expect(a.currency).toBe('USD')
  })

  it('normalizeItem reads the Item DocType incl. the Frappe int-bool is_stock_item/disabled', () => {
    const i = normalizeItem({ name: 'WIDGET-1', item_code: 'WIDGET-1', item_name: 'Widget', item_group: 'Products', stock_uom: 'Nos', is_stock_item: 1, disabled: 0, valuation_rate: 12.5 })
    expect(i.itemCode).toBe('WIDGET-1')
    expect(i.itemName).toBe('Widget')
    expect(i.uom).toBe('Nos')
    expect(i.stockItem).toBe(true) // 1 → true
    expect(i.disabled).toBe(false) // 0 → false
    expect(i.valuationRate).toBe(12.5)
  })

  it('normalizeSalesOrder reads the Sales Order DocType (customer/transaction_date/grand_total/status)', () => {
    const s = normalizeSalesOrder({ name: 'SO-0001', customer: 'Acme', transaction_date: '2026-06-01', grand_total: 5000, currency: 'USD', status: 'To Deliver and Bill' })
    expect(s.name).toBe('SO-0001')
    expect(s.customer).toBe('Acme')
    expect(s.date).toBe('2026-06-01')
    expect(s.grandTotal).toBe(5000)
    expect(s.status).toBe('To Deliver and Bill')
  })

  it('normalizers never throw on a blank/drifted row (honest fields)', () => {
    expect(normalizeAccount({}).name).toBe('')
    expect(normalizeItem({}).stockItem).toBe(false)
    expect(normalizeSalesOrder({}).grandTotal).toBeUndefined()
  })

  it('the deploy image is the canonical stock ERPNext image (never a fictional ghcr tag)', () => {
    expect(ERP_IMAGE.repository).toBe('frappe/erpnext')
    expect(ERP_IMAGE.tag).toMatch(/^v15\./)
  })
})
