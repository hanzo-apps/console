import { describe, expect, it } from 'vitest'

import {
  allowBaseSurface,
  allowCloudSurface,
  allowVisorSurface,
  allowCommerceSurface,
  allowCmsSurface,
  allowErpSurface,
  allowTelemetrySurface,
  v1Head,
  CLOUD_HEADS,
  COMMERCE_HEADS,
} from './proxy-allow'

describe('v1Head', () => {
  it('extracts the head of a v1 path', () => {
    expect(v1Head('v1/vector')).toBe('vector')
    expect(v1Head('v1/vector/mydb')).toBe('vector')
    expect(v1Head('v1/functions/foo/logs')).toBe('functions')
    expect(v1Head('/v1/kv')).toBe('kv') // tolerant of a leading slash
  })

  it('returns null for a non-v1 path', () => {
    expect(v1Head('vector')).toBeNull()
    expect(v1Head('')).toBeNull()
  })
})

describe('allowCloudSurface', () => {
  it('admits every managed data kind and serverless surface', () => {
    for (const head of CLOUD_HEADS) {
      expect(allowCloudSurface(`v1/${head}`)).toBe(true)
      expect(allowCloudSurface(`v1/${head}/some-name`)).toBe(true)
    }
  })

  it('admits the functions/prompts/agents subtrees', () => {
    expect(allowCloudSurface('v1/functions/metrics')).toBe(true)
    expect(allowCloudSurface('v1/prompts/my-prompt')).toBe(true)
    expect(allowCloudSurface('v1/agents/agent-1/runs')).toBe(true)
  })

  it('admits the evals facade (scores/datasets/dataset-items/evaluators/runs)', () => {
    expect(CLOUD_HEADS).toContain('evals')
    for (const sub of ['scores', 'datasets', 'dataset-items', 'evaluators', 'runs']) {
      expect(allowCloudSurface(`v1/evals/${sub}`)).toBe(true)
    }
    // the bare head + a query-less path both admit
    expect(allowCloudSurface('v1/evals')).toBe(true)
  })

  it('admits the prompts metrics + detail sub-paths (the AI surface heads)', () => {
    expect(allowCloudSurface('v1/prompts/metrics')).toBe(true)
    expect(allowCloudSurface('v1/prompts/support-triage')).toBe(true)
  })

  it('admits the websearch surface (search + versioned scrape), one head', () => {
    expect(CLOUD_HEADS).toContain('websearch')
    expect(allowCloudSurface('v1/websearch/search')).toBe(true)
    expect(allowCloudSurface('v1/websearch/v1/scrape')).toBe(true)
  })

  it('admits the projects store incl. the template fork route', () => {
    expect(CLOUD_HEADS).toContain('projects')
    expect(allowCloudSurface('v1/projects')).toBe(true)
    expect(allowCloudSurface('v1/projects/fork')).toBe(true)
    expect(allowCloudSurface('v1/projects/my-site')).toBe(true)
  })

  it('admits the ML serving surface (the Inference endpoints source), per-org via the Bearer', () => {
    expect(CLOUD_HEADS).toContain('ml')
    expect(allowCloudSurface('v1/ml/models')).toBe(true)
    expect(allowCloudSurface('v1/ml/models/my-llama')).toBe(true)
    expect(allowCloudSurface('v1/ml/health')).toBe(true)
  })

  it('admits the casibase store-admin heads the console uses (Embeddings · Collections)', () => {
    for (const head of ['get-stores', 'get-store', 'add-store', 'update-store', 'delete-store', 'refresh-store-vectors']) {
      expect(CLOUD_HEADS).toContain(head)
      expect(allowCloudSurface(`v1/${head}`)).toBe(true)
    }
  })

  it('LEAST PRIVILEGE: does NOT tunnel the cross-tenant / unused store heads', () => {
    // get-global-stores is a cross-tenant read the console never invokes; get-store-names
    // is unused. Neither is allow-listed, so /v1 refuses them (not a general tunnel).
    expect(CLOUD_HEADS).not.toContain('get-global-stores')
    expect(CLOUD_HEADS).not.toContain('get-store-names')
    expect(allowCloudSurface('v1/get-global-stores')).toBe(false)
    expect(allowCloudSurface('v1/get-store-names')).toBe(false)
  })

  it('REFUSES privileged / unlisted cloud-api surfaces (not a general tunnel)', () => {
    expect(allowCloudSurface('v1/iam/get-users')).toBe(false)
    expect(allowCloudSurface('v1/admin/overview')).toBe(false)
    expect(allowCloudSurface('v1/kms/secrets')).toBe(false)
    expect(allowCloudSurface('v1/get-account')).toBe(false)
    expect(allowCloudSurface('functions')).toBe(false) // must be a v1 path
  })
})

describe('allowVisorSurface', () => {
  it('admits the whole visor v1 subtree', () => {
    expect(allowVisorSurface('v1')).toBe(true)
    expect(allowVisorSurface('v1/machines')).toBe(true)
    expect(allowVisorSurface('v1/regions')).toBe(true)
    expect(allowVisorSurface('v1/gpus/gpu-1')).toBe(true)
  })

  it('refuses anything outside v1', () => {
    expect(allowVisorSurface('admin/machines')).toBe(false)
    expect(allowVisorSurface('v2/machines')).toBe(false)
    expect(allowVisorSurface('')).toBe(false)
  })
})

describe('allowCommerceSurface', () => {
  it('admits every merchant store head', () => {
    for (const head of COMMERCE_HEADS) {
      expect(allowCommerceSurface(`v1/${head}`)).toBe(true)
      expect(allowCommerceSurface(`v1/${head}/some-id`)).toBe(true)
    }
  })

  it('refuses the money / tenant-admin surfaces that share the commerce binary', () => {
    // Billing rides its OWN scoped `/billing` proxy; checkout + tenant-admin are off-limits.
    expect(allowCommerceSurface('v1/billing/balance')).toBe(false)
    expect(allowCommerceSurface('v1/checkout/sessions')).toBe(false)
    expect(allowCommerceSurface('v1/namespace')).toBe(false)
    expect(allowCommerceSurface('_/commerce/tenants')).toBe(false)
    expect(allowCommerceSurface('product')).toBe(false) // must be a v1 path
  })
})

describe('allowBaseSurface', () => {
  it('admits the collection schema list/create, the scaffolds palette, and records CRUD', () => {
    expect(allowBaseSurface('v1/collections')).toBe(true) // list + create a content type
    expect(allowBaseSurface('/v1/collections')).toBe(true) // tolerant of a leading slash
    expect(allowBaseSurface('v1/collections/meta/scaffolds')).toBe(true) // field-template palette
    // list / create records
    expect(allowBaseSurface('v1/collections/tenants/records')).toBe(true)
    expect(allowBaseSurface('v1/collections/contacts/records')).toBe(true)
    // get / update / delete one record
    expect(allowBaseSurface('v1/collections/contacts/records/abc123')).toBe(true)
    // the Bases manager: get / configure / delete ONE Base (a tenants record by id)
    expect(allowBaseSurface('v1/collections/tenants/records/yj1om5gz64endii')).toBe(true)
  })

  it('admits single content-type admin (view/update/delete a collection) — the builder needs it', () => {
    // Base still gates every collection mutation behind its own superuser check,
    // scoped per-org; this is the content-type-builder surface, not a data leak.
    expect(allowBaseSurface('v1/collections/contacts')).toBe(true)
    expect(allowBaseSurface('v1/collections/posts')).toBe(true)
  })

  it('REFUSES Base NON-collection admin surfaces (not a general Base tunnel)', () => {
    expect(allowBaseSurface('v1/settings')).toBe(false)
    expect(allowBaseSurface('v1/backups')).toBe(false)
    expect(allowBaseSurface('v1/logs')).toBe(false)
    expect(allowBaseSurface('v1/collections/contacts/records/abc/extra')).toBe(false) // too deep
    expect(allowBaseSurface('v1')).toBe(false)
    expect(allowBaseSurface('collections/contacts/records')).toBe(false) // must be a v1 path
    expect(allowBaseSurface('')).toBe(false)
  })
})

describe('allowCmsSurface — Payload read boundary (per-org, no registry leak)', () => {
  it('admits the two tenant-scoped collection lists + the media bytes route', () => {
    expect(allowCmsSurface('api/pages')).toBe(true)
    expect(allowCmsSurface('api/media')).toBe(true)
    expect(allowCmsSurface('api/media/file/photo.jpg')).toBe(true)
    expect(allowCmsSurface('/api/pages')).toBe(true) // tolerant of a leading slash
  })

  it('REFUSES the non-tenant-scoped registry collections + any other path (no cross-org leak)', () => {
    expect(allowCmsSurface('api/users')).toBe(false) // NOT tenant-row-scoped → would leak users
    expect(allowCmsSurface('api/tenants')).toBe(false) // NOT tenant-row-scoped → would leak the org registry
    expect(allowCmsSurface('api/pages/some-id')).toBe(false) // single-doc GET not needed
    expect(allowCmsSurface('api/media/file/a/b')).toBe(false) // too deep
    expect(allowCmsSurface('api/globals/nav')).toBe(false)
    expect(allowCmsSurface('admin')).toBe(false)
    expect(allowCmsSurface('')).toBe(false)
  })
})

describe('allowErpSurface — Frappe read boundary (the 3 UI DocTypes ONLY)', () => {
  it('admits GET /api/resource/{Account,Item,Sales Order} — the exact summary DocTypes', () => {
    expect(allowErpSurface('api/resource/Account')).toBe(true)
    expect(allowErpSurface('api/resource/Item')).toBe(true)
    expect(allowErpSurface('api/resource/Sales Order')).toBe(true) // DocType with a space
    expect(allowErpSurface('/api/resource/Account')).toBe(true) // tolerant of a leading slash
  })

  it('REFUSES any OTHER DocType (RED LOW-1: no brand-internal over-read via a broad token)', () => {
    expect(allowErpSurface('api/resource/User')).toBe(false) // employee/user registry
    expect(allowErpSurface('api/resource/Salary Slip')).toBe(false) // HR/payroll
    expect(allowErpSurface('api/resource/OAuth Bearer Token')).toBe(false) // secrets
    expect(allowErpSurface('api/resource/Bin')).toBe(false) // not a UI summary DocType
  })

  it('REFUSES single-doc, methods, the desk, login, and any deeper path', () => {
    expect(allowErpSurface('api/resource/Item/WIDGET-1')).toBe(false) // single-doc (mutate surface)
    expect(allowErpSurface('api/method/frappe.client.get_list')).toBe(false) // arbitrary method
    expect(allowErpSurface('api/method/frappe.auth')).toBe(false)
    expect(allowErpSurface('app')).toBe(false) // the desk
    expect(allowErpSurface('login')).toBe(false)
    expect(allowErpSurface('')).toBe(false)
  })
})

describe('allowTelemetrySurface', () => {
  it('admits the READ-only VictoriaMetrics query endpoints', () => {
    expect(allowTelemetrySurface('api/v1/query')).toBe(true)
    expect(allowTelemetrySurface('api/v1/query_range')).toBe(true)
    expect(allowTelemetrySurface('api/v1/series')).toBe(true)
    expect(allowTelemetrySurface('api/v1/labels')).toBe(true)
    expect(allowTelemetrySurface('api/v1/label/job/values')).toBe(true)
    expect(allowTelemetrySurface('api/v1/label/__name__/values')).toBe(true)
    expect(allowTelemetrySurface('api/v1/status/tsdb')).toBe(true)
    expect(allowTelemetrySurface('/api/v1/query')).toBe(true) // tolerant of a leading slash
  })

  it('REFUSES every write / import / admin / mutating path (read-only boundary)', () => {
    expect(allowTelemetrySurface('api/v1/write')).toBe(false)
    expect(allowTelemetrySurface('api/v1/import')).toBe(false)
    expect(allowTelemetrySurface('api/v1/import/prometheus')).toBe(false)
    expect(allowTelemetrySurface('api/v1/admin/tsdb/delete_series')).toBe(false)
    expect(allowTelemetrySurface('-/reload')).toBe(false)
    expect(allowTelemetrySurface('api/v1/label//values')).toBe(false) // empty label segment
    expect(allowTelemetrySurface('api/v1/label/job/values/extra')).toBe(false) // too deep
    expect(allowTelemetrySurface('metrics')).toBe(false)
    expect(allowTelemetrySurface('')).toBe(false)
  })
})
